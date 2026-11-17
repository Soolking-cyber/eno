#!/usr/bin/env node
// ── ApiKey.sellerId becomes NULLABLE: person-only sign-in grants (owner, 2026-11-17: "ok to agents for all") ───────────
//
//   set -a; . ./.env; set +a; node scripts/apikey-person-grant-ddl.mjs
//
// A person with no shop may now connect an AI app for CHAT only (src/lib/api/oauth-grant.ts connectTarget): its grant
// row has no shop, so "ApiKey"."sellerId" must accept NULL. Every API key and every shop grant keeps its shop.
//
// ⛔ RUN ON PRODUCTION BEFORE THE DEPLOY THAT CARRIES person-only grants — and before any local `preview:vn` / `dev:vn` of
// that branch that should create one (both read the production database). Without it the code still runs: reads are
// unchanged, but EVERY person-only Allow fails — every chat-only connection and every account without a business shop,
// since MCP clients now ask for the chat scopes (a NOT NULL violation → "Sign-in is temporarily unavailable").
//
// EXACTLY Prisma's own DDL for `sellerId String?` (`prisma migrate diff` prints this one ALTER and nothing else).
// DROP NOT NULL is catalogue-only: no row is rewritten, no index or FK changes (the FK to "Seller" stays, ON DELETE
// CASCADE; NULL never references anything). One transaction under `SET LOCAL lock_timeout = '5s'` — ALTER TABLE takes an
// ACCESS EXCLUSIVE lock for the catalogue change only. 55P03 = the 5 s ran out: nothing changed; re-run in a quieter
// moment. Idempotent; safe to re-run. No DROP, no data change.
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) {
  console.error('DIRECT_URL or DATABASE_URL required — refusing to guess a target.')
  process.exit(1)
}
const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query('BEGIN')
  await client.query("SET LOCAL lock_timeout = '5s'")
  const base = await client.query(`SELECT to_regclass('public."ApiKey"') AS k`)
  if (!base.rows[0]?.k) throw new Error('ApiKey does not exist — this is not the eno database; rolled back.')
  await client.query('ALTER TABLE public."ApiKey" ALTER COLUMN "sellerId" DROP NOT NULL')
  const col = await client.query(
    `SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ApiKey' AND column_name = 'sellerId'`)
  if (col.rows[0]?.is_nullable !== 'YES') throw new Error(`ApiKey.sellerId is still NOT NULL (${JSON.stringify(col.rows)}) — rolled back.`)
  await client.query('COMMIT')
  console.log('✓ ApiKey.sellerId is nullable (person-only sign-in grants)')
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  console.error(e.code === '55P03' ? 'Lock not available within 5 s: nothing changed. Re-run in a quieter moment.' : e.message || e)
  process.exitCode = 1
} finally {
  await client.end()
}
