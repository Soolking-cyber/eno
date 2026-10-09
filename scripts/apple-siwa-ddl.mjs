#!/usr/bin/env node
// ── apple_siwa_token: Apple refresh tokens kept for revocation (Sign in with Apple, 2026-10-08) ──────────
//
//   set -a; . ./.env; set +a; node scripts/apple-siwa-ddl.mjs
//   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f scripts/rls-guard.sql     # then: no open relation listed
//
// RUN ON PRODUCTION BEFORE THE DEPLOY THAT SHIPS SIGN IN WITH APPLE (plan step I2). The code tolerates the table
// being absent (a missing table reads as "no tokens" and a store fails soft), but every Apple sign-in in that
// window would then keep no token, and its deletion could only send the person to revoke by hand.
//
// ⛔ WHY THE TABLE EXISTS: App Store Guideline 5.1.1(v) and Apple's TN3194 — an app offering Sign in with Apple
// must REVOKE the user's tokens when the account is deleted, and revoking needs a token. GoTrue does not keep
// one where erasure can reach it, so the app does: src/lib/auth/apple-siwa.ts.
//
// ⛔ token_enc IS AN AES-256-GCM ENVELOPE (APPLE_TOKEN_ENC_KEY), with (user_id, client_id) as its associated data
// — a ciphertext moved to another row will not open. A refresh token is a live credential at Apple: never store
// or log it in the clear.
//
// ⚠️ NO FOREIGN KEYS, deliberately (the whatsapp_inbound / auth_handoff pattern). A queued row MUST outlive its
// auth user: account erasure deletes the GoTrue user, and the daily retry (/api/cron/apple-revocations) still
// needs the token for up to 14 days afterwards. It also keeps this table out of the profile_auth_fk dance.
//
// ⚠️ OUTSIDE PRISMA — prisma/schema.prisma does not know it (CLAUDE.md lists it among the tables `db push` would
// DROP). Accessed only through db.$executeRaw / $queryRaw as postgres (BYPASSRLS).
//
// Idempotent; one transaction with a 5 s lock timeout (a fresh table takes no lock worth naming — the timeout is
// insurance for a re-run); safe to re-run any time.
import pg from 'pg'

const STATEMENTS = [
  [
    'apple_siwa_token table',
    `CREATE TABLE IF NOT EXISTS public.apple_siwa_token (
       user_id         uuid        NOT NULL,
       client_id       text        NOT NULL,
       apple_sub       text        NOT NULL,
       token_enc       text        NOT NULL,
       created_at      timestamptz NOT NULL DEFAULT now(),
       -- Every write. On an ACTIVE row also the orphan sweep's last look: it takes the least recently touched first.
       updated_at      timestamptz NOT NULL DEFAULT now(),
       -- NULL = active (an account holds it). Set by the erasure, in its own transaction: the daily retry's queue.
       queued_at       timestamptz,
       next_attempt_at timestamptz,
       attempts        smallint    NOT NULL DEFAULT 0,
       last_error      text,
       PRIMARY KEY (user_id, client_id)
     )`,
  ],
  [
    'apple_siwa_token due index (queued rows only)',
    `CREATE INDEX IF NOT EXISTS apple_siwa_token_due_idx ON public.apple_siwa_token (next_attempt_at) WHERE queued_at IS NOT NULL`,
  ],
  [
    // The retry's "does a live account hold this Apple ID?" — asked while it holds that Apple ID's advisory lock, which
    // every sign-in's token store waits on (src/lib/auth/apple-siwa.ts settleQueuedTokens), so it must stay an index probe.
    'apple_siwa_token Apple ID index',
    `CREATE INDEX IF NOT EXISTS apple_siwa_token_sub_idx ON public.apple_siwa_token (apple_sub)`,
  ],
  ['apple_siwa_token RLS on', `ALTER TABLE public.apple_siwa_token ENABLE ROW LEVEL SECURITY`],
  [
    // ⚠️⚠️ REVOKE FIRST — RLS IS NOT WHAT KEEPS PostgREST OUT, GRANTS ARE (auth-handoff-ddl.mjs). Supabase's
    // default privileges hand new public tables to `anon` and `authenticated`; this table holds credentials.
    'apple_siwa_token revoke API roles',
    `REVOKE ALL ON public.apple_siwa_token FROM anon, authenticated, PUBLIC`,
  ],
  [
    // `TO service_role` — a policy with no TO clause is TO PUBLIC (the auth_handoff lesson).
    'apple_siwa_token service-role policy',
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'apple_siwa_token' AND policyname = 'service_only') THEN
         CREATE POLICY service_only ON public.apple_siwa_token FOR ALL TO service_role USING (true) WITH CHECK (true);
       END IF;
     END $$`,
  ],
]

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
  // Assert rather than assume: RLS on, and no grant left for the API roles.
  const rls = await client.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.apple_siwa_token'::regclass`)
  if (!rls.rows[0]?.relrowsecurity) throw new Error('RLS did not switch on for apple_siwa_token — rolled back.')
  const grants = await client.query(
    `SELECT grantee, privilege_type FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'apple_siwa_token' AND grantee IN ('anon', 'authenticated', 'PUBLIC')`,
  )
  if (grants.rows.length) throw new Error(`apple_siwa_token still grants ${JSON.stringify(grants.rows)} — rolled back.`)
  await client.query('COMMIT')
  console.log('✓ committed')
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await client.end()
}
