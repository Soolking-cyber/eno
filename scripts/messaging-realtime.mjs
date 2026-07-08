// Realtime for messaging — PRIVATE content broadcast (super-fast path):
// An AFTER INSERT trigger on "Message" broadcasts the FULL message (id, body,
// senderProfileId, createdAt) on the PRIVATE topic 'convo:<conversationId>' via
// realtime.send(..., private=true). Receivers render straight from the socket
// payload — ZERO refetch round-trip. Content is gated by an RLS SELECT policy on
// realtime.messages so only the two conversation participants can receive it
// (Profile.id == auth.users.id == auth.uid(), compared directly to the
// Conversation buyer/seller columns — no join needed). The trigger is SECURITY
// DEFINER so it bypasses RLS to broadcast; clients can NEVER publish content
// themselves (no INSERT policy granted). Postgres stays source of truth; the
// client keeps a 20s/visibility backstop poll so a dropped/unauthorized socket
// never loses a message.
//
// Idempotent; re-run after any DB reset. Run over DIRECT_URL:
//   set -a; . ./.env; set +a; node scripts/messaging-realtime.mjs
//
// To REVERT to the old public content-free nudge: set the realtime.send payload
// back to {conversationId,id} with the 4th arg false, and drop the policy below.

import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()

// 1) Trigger: broadcast the full message body on the PRIVATE convo topic (the open
//    thread subscribes to this), AND a lightweight 'convo_activity' nudge to EACH
//    participant's PRIVATE user topic ('user:<profileId>'). The user topic lets a
//    client subscribe to ONE channel for the global unread badge / inbox refresh
//    instead of one channel per conversation (unbounded; no 30-convo cap).
await client.query(`
  create or replace function public.broadcast_new_message() returns trigger
  language plpgsql security definer set search_path = '' as $$
  declare c record;
  begin
    perform realtime.send(
      jsonb_build_object(
        'id', NEW.id,
        'conversationId', NEW."conversationId",
        'senderProfileId', NEW."senderProfileId",
        'body', NEW.body,
        'createdAt', NEW."createdAt"
      ),
      'new_message',
      'convo:' || NEW."conversationId",
      true  -- PRIVATE topic; only RLS-authorized participants receive the content
    );
    -- Per-participant nudge on their own user topic (content-free: ids only).
    select c2."buyerProfileId" as buyer, c2."sellerProfileId" as seller
      into c from public."Conversation" c2 where c2.id = NEW."conversationId";
    if c.buyer is not null then
      perform realtime.send(
        jsonb_build_object('conversationId', NEW."conversationId", 'senderProfileId', NEW."senderProfileId"),
        'convo_activity', 'user:' || c.buyer::text, true);
    end if;
    if c.seller is not null then
      perform realtime.send(
        jsonb_build_object('conversationId', NEW."conversationId", 'senderProfileId', NEW."senderProfileId"),
        'convo_activity', 'user:' || c.seller::text, true);
    end if;
    return NEW;
  end;
  $$;
`)
console.log('✓ broadcast_new_message() function (convo content + per-user activity nudge)')

await client.query(`drop trigger if exists message_broadcast on public."Message"`)
await client.query(`
  create trigger message_broadcast
    after insert on public."Message"
    for each row execute function public.broadcast_new_message();
`)
console.log('✓ message_broadcast trigger on "Message"')

// 1a) Deletes: broadcast a CONTENT-FREE 'message_deleted' (just the id) on the
//     same private topic so the other side removes the bubble instantly.
await client.query(`
  create or replace function public.broadcast_deleted_message() returns trigger
  language plpgsql security definer set search_path = '' as $$
  begin
    perform realtime.send(
      jsonb_build_object('id', OLD.id, 'conversationId', OLD."conversationId"),
      'message_deleted',
      'convo:' || OLD."conversationId",
      true
    );
    return OLD;
  end;
  $$;
`)
await client.query(`drop trigger if exists message_deleted_broadcast on public."Message"`)
await client.query(`
  create trigger message_deleted_broadcast
    after delete on public."Message"
    for each row execute function public.broadcast_deleted_message();
`)
console.log('✓ message_deleted_broadcast trigger on "Message"')

// 1b) Typing signal: a SECURITY DEFINER function the app calls to broadcast an
//     ephemeral "typing" event on the private convo channel. It re-checks that
//     p_from is a participant, so clients can never signal on conversations they
//     are not in (and can never broadcast message content — only this 'typing').
await client.query(`
  create or replace function public.broadcast_typing(p_convo text, p_from uuid) returns void
  language plpgsql security definer set search_path = '' as $$
  begin
    if exists (
      select 1 from public."Conversation" c
      where c.id = p_convo and (c."buyerProfileId" = p_from or c."sellerProfileId" = p_from)
    ) then
      perform realtime.send(
        jsonb_build_object('from', p_from),
        'typing',
        'convo:' || p_convo,
        true  -- private topic, same RLS gate as messages
      );
    end if;
  end;
  $$;
`)
console.log('✓ broadcast_typing() function (participant-gated)')

// 1c) Lock down the SECURITY DEFINER functions. They are invoked ONLY by triggers
//     (new_message / deleted_message) or by the service-role app via $executeRaw
//     (typing) — NEVER by a client. Revoke EXECUTE from the PostgREST API roles so
//     they can't be called via /rest/v1/rpc/... (Supabase security advisor 0028/0029).
//     Triggers + the service role keep working (they don't rely on these grants).
await client.query(`revoke execute on function public.broadcast_new_message() from public, anon, authenticated`)
await client.query(`revoke execute on function public.broadcast_deleted_message() from public, anon, authenticated`)
await client.query(`revoke execute on function public.broadcast_typing(text, uuid) from public, anon, authenticated`)
console.log('✓ revoked EXECUTE on broadcast_* from public/anon/authenticated')

// 2) Realtime Authorization: RLS SELECT (receive) policy on realtime.messages so
//    only the conversation's participants can receive the private broadcasts.
//    Only a SELECT/receive policy is needed — the definer trigger does the send.
//    GOTCHA (2026-07-08, prod outage): the policy MUST NOT read "Conversation"
//    directly — it evaluates AS the subscriber, and "Conversation" has RLS enabled
//    with no policies, so a plain EXISTS was always empty → every join Unauthorized
//    (realtime dead, clients retry-looping). The check lives in a SECURITY DEFINER
//    function (bypasses table RLS; boolean-only, no data exposure) which also covers
//    sellers via Seller."ownerId" (sellerProfileId is null until the seller claims).
await client.query(`
  create or replace function public.is_convo_participant(p_convo text)
  returns boolean
  language sql stable security definer
  set search_path = public
  as $$
    select exists (
      select 1
      from "Conversation" c
      left join "Seller" s on s.id = c."sellerId"
      where c.id = p_convo
        and (
          c."buyerProfileId" = auth.uid()
          or c."sellerProfileId" = auth.uid()
          or s."ownerId" = auth.uid()
        )
    );
  $$;
`)
await client.query(`revoke all on function public.is_convo_participant(text) from public`)
await client.query(`grant execute on function public.is_convo_participant(text) to authenticated`)
await client.query(`alter table realtime.messages enable row level security`)
await client.query(`drop policy if exists "convo participants can receive" on realtime.messages`)
await client.query(`
  create policy "convo participants can receive"
    on realtime.messages
    for select
    to authenticated
    using (
      realtime.messages.extension = 'broadcast'
      and public.is_convo_participant(split_part(realtime.topic(), ':', 2))
    );
`)
console.log('✓ RLS receive policy on realtime.messages (participants only, definer check)')

// 2a) Receive policy for a user's OWN topic ('user:<auth.uid()>'). Profile.id ==
//     auth.users.id == auth.uid(), so a user can only ever subscribe to their own
//     activity channel — never anyone else's.
await client.query(`drop policy if exists "own user channel" on realtime.messages`)
await client.query(`
  create policy "own user channel"
    on realtime.messages
    for select
    to authenticated
    using (
      realtime.messages.extension = 'broadcast'
      and realtime.topic() = 'user:' || (select auth.uid())::text
    );
`)
console.log('✓ RLS receive policy on realtime.messages (own user topic)')

const { rows: trg } = await client.query(`select tgname from pg_trigger where tgname = 'message_broadcast'`)
const { rows: pol } = await client.query(
  `select policyname from pg_policies where schemaname='realtime' and tablename='messages' and policyname='convo participants can receive'`,
)
console.log(trg.length && pol.length ? '\n✓ private messaging realtime in place (trigger + RLS policy).' : '\n✗ MISSING something')
await client.end()
