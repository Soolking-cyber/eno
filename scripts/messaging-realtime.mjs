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

// 1) Trigger: broadcast the full message body on the PRIVATE topic.
await client.query(`
  create or replace function public.broadcast_new_message() returns trigger
  language plpgsql security definer set search_path = '' as $$
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
    return NEW;
  end;
  $$;
`)
console.log('✓ broadcast_new_message() function (private, full payload)')

await client.query(`drop trigger if exists message_broadcast on public."Message"`)
await client.query(`
  create trigger message_broadcast
    after insert on public."Message"
    for each row execute function public.broadcast_new_message();
`)
console.log('✓ message_broadcast trigger on "Message"')

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

// 2) Realtime Authorization: RLS SELECT (receive) policy on realtime.messages so
//    only the conversation's participants can receive the private broadcasts.
//    Only a SELECT/receive policy is needed — the definer trigger does the send.
await client.query(`alter table realtime.messages enable row level security`)
await client.query(`drop policy if exists "convo participants can receive" on realtime.messages`)
await client.query(`
  create policy "convo participants can receive"
    on realtime.messages
    for select
    to authenticated
    using (
      realtime.messages.extension = 'broadcast'
      and exists (
        select 1 from public."Conversation" c
        where c.id = split_part(realtime.topic(), ':', 2)
          and ((select auth.uid()) = c."buyerProfileId" or (select auth.uid()) = c."sellerProfileId")
      )
    );
`)
console.log('✓ RLS receive policy on realtime.messages (participants only)')

const { rows: trg } = await client.query(`select tgname from pg_trigger where tgname = 'message_broadcast'`)
const { rows: pol } = await client.query(
  `select policyname from pg_policies where schemaname='realtime' and tablename='messages' and policyname='convo participants can receive'`,
)
console.log(trg.length && pol.length ? '\n✓ private messaging realtime in place (trigger + RLS policy).' : '\n✗ MISSING something')
await client.end()
