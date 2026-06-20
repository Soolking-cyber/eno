// Realtime for messaging: an AFTER INSERT trigger on "Message" broadcasts a
// CONTENT-FREE nudge (just the conversationId/messageId — never the body) to the
// public topic 'convo:<conversationId>' via realtime.send(). Clients subscribed
// to that topic refetch the thread from the AUTHED API (which gates participants),
// so no message content is ever exposed over the channel. Postgres stays the
// source of truth; a slow backstop poll self-heals any missed broadcast.
//
// Idempotent; re-run after any DB reset. Run over DIRECT_URL:
//   set -a; . ./.env; set +a; node scripts/messaging-realtime.mjs

import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()

await client.query(`
  create or replace function public.broadcast_new_message() returns trigger
  language plpgsql security definer as $$
  begin
    perform realtime.send(
      jsonb_build_object('conversationId', NEW."conversationId", 'id', NEW.id),
      'new_message',
      'convo:' || NEW."conversationId",
      false  -- public topic; payload carries NO message content
    );
    return NEW;
  end;
  $$;
`)
console.log('✓ broadcast_new_message() function')

await client.query(`drop trigger if exists message_broadcast on public."Message"`)
await client.query(`
  create trigger message_broadcast
    after insert on public."Message"
    for each row execute function public.broadcast_new_message();
`)
console.log('✓ message_broadcast trigger on "Message"')

const { rows } = await client.query(
  `select tgname from pg_trigger where tgname = 'message_broadcast'`,
)
console.log(rows.length ? '\n✓ messaging realtime trigger in place.' : '\n✗ MISSING')
await client.end()
