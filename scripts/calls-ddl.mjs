#!/usr/bin/env node
// ── In-app calls: session, busy lock, negotiation, consent, idempotency, telemetry (design v3, 2026-10-21) ────────
//
//   set -a; . ./.env; set +a; node scripts/calls-ddl.mjs
//   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/rls-guard.sql     # then: no open relation listed
//
// RUN ON PRODUCTION BEFORE THE DEPLOY (the house order: DB first). The code reads a missing switch table as "calls
// off" (the call config route answers mode 'off'), so the UI never reaches another call table before this has run —
// though a hand-made request to a call route would still get a 500 until then.
// Design: ~/eno-calls-research-2026-10/DESIGN.md (v3). Code: src/lib/calls/server/*.
//
// ⛔ POSTGRES IS THE SOURCE OF TRUTH FOR A CALL; REALTIME IS ONLY THE FAST PATH. A broadcast sent while a phone's
// socket is reconnecting is lost for good (realtime.send has no replay worth trusting), so every event a peer must
// see — the accept, the offer, the answer, the candidates — is ALSO written here, and clients re-read it on every
// (re)subscribe, on visibility, on 'online', and every 2 s while connecting (call_negotiation + call_session).
//
// ⛔ NO USER IPs, NO MEDIA, EVER. Calls are relay-only, so the SDP and candidates stored in call_negotiation carry
// only the relay's addresses (the server re-serialises them — src/lib/calls/sdp-guard.ts), and call_telemetry
// accepts only the numeric schema in src/lib/calls/telemetry.ts. call_negotiation rows are deleted when the call
// ends; nothing here needs to outlive the call except call_session (metadata) and call_consent.
//
// ⚠️ NO FOREIGN KEYS, deliberately (the apple_siwa_token / whatsapp_inbound pattern). Call metadata must outlive an
// erased account (Decree 333/2026 Art 16.6 system logs, legal holds on reports): erasure NULLs caller_id/callee_id
// and keeps the keyed hashes (src/lib/core/account-erasure.ts), and the retention purge deletes whole rows at the
// window counsel sets unless legal_hold. It also keeps these tables out of the profile_auth_fk dance.
//
// ⚠️ OUTSIDE PRISMA — prisma/schema.prisma does not know these tables (add them to CLAUDE.md's list of tables
// `db push` would DROP). Accessed only through db.$queryRaw / $executeRaw as postgres (BYPASSRLS).
//
// Idempotent; one transaction with a 5 s lock timeout; safe to re-run any time. ⚠️ CREATE TABLE IF NOT EXISTS never
// changes a table that is already there: a column (or CHECK) added AFTER a database got these tables needs its own
// ALTER below, as swept_at has. Production gets this version first (it has never run there).
import pg from 'pg'

const TABLES = ['call_session', 'call_lock', 'call_negotiation', 'call_signal_key', 'call_consent', 'call_telemetry', 'call_config', 'call_abandon']

const STATEMENTS = [
  [
    'call_session table',
    `CREATE TABLE IF NOT EXISTS public.call_session (
       id                   uuid        PRIMARY KEY,
       conversation_id      text        NOT NULL,
       -- NULLed by account erasure; the hashes survive (keyed, IDENTITY_HASH_PEPPER) so a legal request can still be
       -- matched to a person who is later re-identified, without the table holding who they are.
       caller_id            uuid,
       callee_id            uuid,
       caller_hash          char(64)    NOT NULL,
       callee_hash          char(64)    NOT NULL,
       -- The two ids the safety-code commitment binds (src/lib/calls/server/session.ts commitTag), computed ONCE at start
       -- by the caller's edition and served to the callee from here — if the two editions' env files ever disagreed on
       -- the key, a tag recomputed per edition would fail every cross-site call's code (commit-gate review).
       caller_tag           char(36),
       callee_tag           char(36),
       media                text        NOT NULL CHECK (media IN ('audio', 'video')),
       -- Monotonic (src/lib/calls/protocol.ts CALL_STATES): ringing → accepted → ready (the callee's call tab joined
       -- call:<conversationId> and said so) → connected; ended is terminal. A snapshot can be stale when it lands, so
       -- only a state that never goes backwards is safe to apply without a sequence number.
       state                text        NOT NULL CHECK (state IN ('ringing', 'accepted', 'ready', 'connected', 'ended')),
       end_reason           text,
       protocol_version     smallint    NOT NULL,
       edition              text        NOT NULL CHECK (edition IN ('marketplace', 'services')),
       relay_provider       text        NOT NULL CHECK (relay_provider IN ('cloudflare', 'eno')),
       caller_tab           text        NOT NULL,
       -- The phone's own id for THIS start (one per attempt): a start whose response never came back is ended by it —
       -- and a give-up that lands before the row exists leaves a tombstone the start finds (session.ts abandonStart).
       start_id             text,
       callee_tab           text,
       -- The safety code (src/lib/calls/sas.ts): the caller's commitment, the callee's nonce, the caller's reveal —
       -- lowercase hex. None is secret once sent; all are cleared when the call ends. ⚠️ Each is written ONCE (first
       -- write wins): a phone that could replace its nonce or reveal after the other side saw it would hand the box
       -- the offline grind the commit-reveal order exists to prevent.
       caller_commit        char(64)    NOT NULL CHECK (caller_commit ~ '^[0-9a-f]{64}$'),
       callee_nonce         char(64)    CHECK (callee_nonce ~ '^[0-9a-f]{64}$'),
       caller_reveal        char(64)    CHECK (caller_reveal ~ '^[0-9a-f]{64}$'),
       -- Each side's LATEST hold/resume as it sent it (held + its payload seq), so a lost hold or resume is healed by
       -- the resync snapshot (protocol.ts peerHold). Only a higher seq replaces a lower one.
       caller_hold          boolean,
       caller_hold_seq      integer     CHECK (caller_hold_seq >= 1),
       callee_hold          boolean,
       callee_hold_seq      integer     CHECK (callee_hold_seq >= 1),
       -- The relay provider's handle for each side's credential (Cloudflare: the generated TURN username), kept only
       -- to REVOKE it when the call ends or a block lands — never the secret. Cleared at the end.
       caller_relay_user    text,
       callee_relay_user    text,
       -- Capability reports (codec plan inputs). Device detail, so cleared when the call ends.
       caller_caps          jsonb,
       callee_caps          jsonb,
       ringing_at           timestamptz NOT NULL DEFAULT now(),
       accepted_at          timestamptz,
       ready_at             timestamptz,
       connected_at         timestamptz,
       ended_at             timestamptz,
       caller_heartbeat_at  timestamptz,
       callee_heartbeat_at  timestamptz,
       legal_hold           boolean     NOT NULL DEFAULT false
     )`,
  ],
  ['call_session conversation index', `CREATE INDEX IF NOT EXISTS call_session_convo_idx ON public.call_session (conversation_id, ringing_at DESC)`],
  ['call_session caller index', `CREATE INDEX IF NOT EXISTS call_session_caller_idx ON public.call_session (caller_id, ringing_at DESC)`],
  ['call_session callee index', `CREATE INDEX IF NOT EXISTS call_session_callee_idx ON public.call_session (callee_id, ringing_at DESC)`],
  [
    // The sweep and every busy check read only live rows; the partial index keeps that an index probe forever.
    'call_session live index',
    `CREATE INDEX IF NOT EXISTS call_session_live_idx ON public.call_session (state, ringing_at) WHERE state <> 'ended'`,
  ],
  ['call_session retention index', `CREATE INDEX IF NOT EXISTS call_session_ended_idx ON public.call_session (ended_at) WHERE legal_hold = false`],
  [
    // ⛔ THE UNIQUE KEY IS THE BUSY LOCK. A person holds at most one live call, whatever the number of devices, tabs
    // or simultaneous callers: a second accept or a second start conflicts here inside the same transaction that
    // writes the session. A lock whose call is stale (no heartbeat for 45 s, or ringing past its deadline) is taken
    // over in SQL — correctness never waits for the sweep timer (src/lib/calls/server/session.ts).
    'call_lock table',
    `CREATE TABLE IF NOT EXISTS public.call_lock (
       profile_id  uuid        PRIMARY KEY,
       call_id     uuid        NOT NULL,
       taken_at    timestamptz NOT NULL DEFAULT now()
     )`,
  ],
  [
    'call_negotiation table',
    `CREATE TABLE IF NOT EXISTS public.call_negotiation (
       call_id            uuid        NOT NULL,
       neg_id             integer     NOT NULL CHECK (neg_id >= 1),
       offer_sdp          text,
       offer_meta         jsonb,
       answer_sdp         text,
       caller_candidates  jsonb       NOT NULL DEFAULT '[]'::jsonb,
       callee_candidates  jsonb       NOT NULL DEFAULT '[]'::jsonb,
       updated_at         timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (call_id, neg_id)
     )`,
  ],
  [
    // Idempotency for every signalling POST: a retried request (lost response on 4G) must not append candidates
    // twice or broadcast twice. Deleted with the call's negotiation rows.
    // ⛔ SCOPED BY SENDER. Keys are `${instanceId}:${seq}` and every relayed event shows its key to the peer, so a key
    // space shared by both sides would let one participant pre-register the other's NEXT keys — and the box would then
    // swallow that side's offers, answers and hang-ups as "retries" (negotiation review, 2026-10-21). `sender` is the
    // role the box resolved from the session, never a value the phone sends.
    'call_signal_key table',
    `CREATE TABLE IF NOT EXISTS public.call_signal_key (
       call_id     uuid        NOT NULL,
       sender      text        NOT NULL CHECK (sender IN ('caller', 'callee')),
       -- 1..64 = protocol.ts idempotencyKeySchema exactly: a key the protocol accepts must never fail this INSERT
       -- (that was a 500 the phone retries forever — review C1).
       idem        text        NOT NULL CHECK (length(idem) BETWEEN 1 AND 64),
       created_at  timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (call_id, sender, idem)
     )`,
  ],
  [
    // "Allow calls from <name>" — the callee's explicit consent for ONE counterpart in ONE conversation, with the
    // exact copy version shown (PDPL 91/2025 + Decree 356/2025 Art 6: verifiable, stored, never a default).
    'call_consent table',
    `CREATE TABLE IF NOT EXISTS public.call_consent (
       conversation_id  text        NOT NULL,
       granter_id       uuid        NOT NULL,
       grantee_id       uuid        NOT NULL,
       copy_version     text        NOT NULL,
       granted_at       timestamptz NOT NULL DEFAULT now(),
       revoked_at       timestamptz,
       PRIMARY KEY (conversation_id, granter_id, grantee_id)
     )`,
  ],
  [
    'call_telemetry table',
    `CREATE TABLE IF NOT EXISTS public.call_telemetry (
       call_id     uuid        NOT NULL,
       role        text        NOT NULL CHECK (role IN ('caller', 'callee')),
       seq         integer     NOT NULL CHECK (seq >= 0),
       payload     jsonb       NOT NULL,
       created_at  timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (call_id, role, seq)
     )`,
  ],
  ['call_telemetry retention index', `CREATE INDEX IF NOT EXISTS call_telemetry_created_idx ON public.call_telemetry (created_at)`],
  [
    // ⛔ THE RUNTIME SWITCH (design §3.2 step 10): who may call, read by every call route with a 30 s cache, so 'off'
    // refuses new calls and every heartbeat ends live ones — no rebuild, no restart. ONE row, LOGGED on
    // purpose: kv_store is UNLOGGED (truncated after a crash), and a crash must never quietly undo a kill. No row =
    // 'off' (src/lib/calls/server/config.ts), so creating the table switches nothing on.
    'call_config table',
    `CREATE TABLE IF NOT EXISTS public.call_config (
       id          smallint    PRIMARY KEY CHECK (id = 1),
       mode        text        NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'staff', 'beta', 'all')),
       -- 'beta': these profiles may call (staff always may); ignored by the other modes.
       cohort      uuid[]      NOT NULL DEFAULT '{}',
       video       boolean     NOT NULL DEFAULT true,
       relay       text        NOT NULL DEFAULT 'cloudflare' CHECK (relay IN ('cloudflare', 'eno')),
       updated_at  timestamptz NOT NULL DEFAULT now(),
       updated_by  text,
       -- Stamped by every run of /api/cron/calls-sweep. Both writers of the switch refuse to turn calls ON unless it is
       -- recent: the sweep is what ends a call nobody is beating any more and replaces its lock-screen ring.
       swept_at    timestamptz
     )`,
  ],
  ['call_config.swept_at', `ALTER TABLE public.call_config ADD COLUMN IF NOT EXISTS swept_at timestamptz`],
  [
    // A start its phone gave up on before the answer came back (src/lib/calls/server/session.ts abandonStart): the
    // start, still on its way, finds its id here and never rings. Random ids only — nothing personal; the sweep drops
    // rows older than ten minutes.
    'call_abandon table',
    `CREATE TABLE IF NOT EXISTS public.call_abandon (
       start_id    text        PRIMARY KEY CHECK (char_length(start_id) BETWEEN 8 AND 64),
       created_at  timestamptz NOT NULL DEFAULT now()
     )`,
  ],
  ['call_session.start_id', `ALTER TABLE public.call_session ADD COLUMN IF NOT EXISTS start_id text`],
  [
    // The one door to Realtime for calls: the server has already checked participation and call state, so this only
    // shape-checks the topic and event name. Topics: 'call:<conversationId>' (in-call events — the existing
    // 'convo participants can receive' policy already admits exactly the two participants) and 'ring:<profileId>'
    // (ring/cancel/answered_elsewhere — the "own ring channel" policy below; a topic of its own so the call layer never
    // shares a channel object with chat-context's 'user:<id>': src/lib/calls/server/events.ts).
    'broadcast_call_event() function',
    `CREATE OR REPLACE FUNCTION public.broadcast_call_event(p_topic text, p_event text, p_payload jsonb) RETURNS void
     LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
     BEGIN
       IF p_topic !~ '^(call|ring):[A-Za-z0-9_-]{1,64}$' THEN
         RAISE EXCEPTION 'broadcast_call_event: bad topic %', p_topic;
       END IF;
       IF p_event !~ '^call_[a-z_]{1,32}$' THEN
         RAISE EXCEPTION 'broadcast_call_event: bad event %', p_event;
       END IF;
       PERFORM realtime.send(p_payload, p_event, p_topic, true);
     END;
     $$`,
  ],
  ['broadcast_call_event revoke API roles', `REVOKE EXECUTE ON FUNCTION public.broadcast_call_event(text, text, jsonb) FROM public, anon, authenticated`],
  [
    // Receive-only, like every policy on realtime.messages here (scripts/messaging-realtime.mjs): a phone can hear its
    // OWN ring topic and nothing else; nobody can send on it (no INSERT policy — the box sends through the definer
    // function above). Skipped on a database without Supabase Realtime (a scratch test database).
    'own ring channel receive policy',
    `DO $$ BEGIN
       IF to_regclass('realtime.messages') IS NOT NULL AND to_regprocedure('auth.uid()') IS NOT NULL THEN
         DROP POLICY IF EXISTS "own ring channel" ON realtime.messages;
         CREATE POLICY "own ring channel" ON realtime.messages FOR SELECT TO authenticated
           USING (realtime.messages.extension = 'broadcast' AND realtime.topic() = 'ring:' || (select auth.uid())::text);
       END IF;
     END $$`,
  ],
]

for (const t of TABLES) {
  STATEMENTS.push([`${t} RLS on`, `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`])
  // ⚠️⚠️ REVOKE FIRST — RLS IS NOT WHAT KEEPS PostgREST OUT, GRANTS ARE (auth-handoff-ddl.mjs).
  STATEMENTS.push([`${t} revoke API roles`, `REVOKE ALL ON public.${t} FROM anon, authenticated, PUBLIC`])
  STATEMENTS.push([
    `${t} service-role policy`,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = '${t}' AND policyname = 'service_only') THEN
         CREATE POLICY service_only ON public.${t} FOR ALL TO service_role USING (true) WITH CHECK (true);
       END IF;
     END $$`,
  ])
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) {
  console.error('DIRECT_URL or DATABASE_URL required')
  process.exit(1)
}
const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query('BEGIN')
  await client.query("SET LOCAL lock_timeout = '5s'")
  for (const [label, sql] of STATEMENTS) {
    await client.query(sql)
    console.log(`✓ ${label}`)
  }
  // Assert rather than assume: RLS on, and no grant left for the API roles, on every table.
  for (const t of TABLES) {
    const rls = await client.query(`SELECT relrowsecurity FROM pg_class WHERE oid = $1::regclass`, [`public.${t}`])
    if (!rls.rows[0]?.relrowsecurity) throw new Error(`RLS did not switch on for ${t} — rolled back.`)
    const grants = await client.query(
      `SELECT grantee, privilege_type FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = $1 AND grantee IN ('anon', 'authenticated', 'PUBLIC')`,
      [t],
    )
    if (grants.rows.length) throw new Error(`${t} still grants ${JSON.stringify(grants.rows)} — rolled back.`)
  }
  const fnGrants = await client.query(
    `SELECT grantee FROM information_schema.role_routine_grants
     WHERE routine_schema = 'public' AND routine_name = 'broadcast_call_event' AND grantee IN ('anon', 'authenticated', 'PUBLIC')`,
  )
  if (fnGrants.rows.length) throw new Error(`broadcast_call_event still executable by ${JSON.stringify(fnGrants.rows)} — rolled back.`)
  await client.query('COMMIT')
  console.log('✓ committed')
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await client.end()
}
