// 2026 e-commerce compliance — the DDL Prisma cannot express.
//
// IDEMPOTENT — safe to re-run, and MUST be re-applied after any `prisma db push` (Prisma does not
// manage partial indexes, rules, or partitions; same as profile_auth_fk and unique-constraints).
//
// Run:  cd /Users/mk1e3/eno.vn && DIRECT_URL="$DIRECT_URL" node scripts/compliance-ddl.mjs
//   (DIRECT_URL is read from .env — never hardcode the prod DB password in this file.)
//
// What it does, and why each piece cannot live in schema.prisma:
//
//   1. identity_subject_live_uniq — ONE HUMAN → ONE VERIFIED SELLER, enforced by the DATABASE.
//      ⚠️ PARTIAL, on `status = 'verified'` only. A plain @unique on subjectHash would make a
//      REJECTED attempt permanently block that person from ever retrying, which is both wrong and
//      unappealable. Prisma cannot express a predicate index, so it lives here.
//      ⚠️ And it must be the DATABASE, not a SELECT-then-INSERT: two tabs finishing verification
//      together both pass the read and both insert. Same lesson as the visa capture race.
//
//   2. compliance_audit append-only RULEs. The table's evidentiary value rests entirely on being
//      unalterable; "we never update it" is a convention, and a rushed psql session is not bound
//      by conventions. DO INSTEAD NOTHING makes UPDATE/DELETE silently no-op for everyone,
//      including us — which is the point.
//
//   3. compliance_audit chain-integrity check function. Verifying the hash chain is how the log
//      proves it was not edited; doing it in SQL means an auditor can run it without our code.
//
// ⚠️ RUN THIS AGAINST BOTH DATABASES if the editions are ever split. Today eno.vn and eno.forum
// share one database, so one run covers both — but that is a fact about today, not a guarantee.
import pg from 'pg'

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('Set DIRECT_URL / DATABASE_URL'); process.exit(1) }

const client = new pg.Client({ connectionString: url })

const STATEMENTS = [
  [
    'identity: one live verified identity per human',
    `CREATE UNIQUE INDEX IF NOT EXISTS identity_subject_live_uniq
       ON identity_verifications ("subjectHash")
       WHERE status = 'verified'`,
  ],
  [
    'identity: fast lookup of documents nearing expiry',
    `CREATE INDEX IF NOT EXISTS identity_expiring_idx
       ON identity_verifications ("documentExpiresAt")
       WHERE status = 'verified' AND "documentExpiresAt" IS NOT NULL`,
  ],
  [
    'audit: block UPDATE',
    `CREATE OR REPLACE RULE compliance_audit_no_update AS
       ON UPDATE TO compliance_audit DO INSTEAD NOTHING`,
  ],
  [
    'audit: block DELETE',
    `CREATE OR REPLACE RULE compliance_audit_no_delete AS
       ON DELETE TO compliance_audit DO INSTEAD NOTHING`,
  ],
  [
    'audit: chain verification function',
    // Walks the chain in id order and returns the first row whose stored prev_hash does not match
    // its predecessor's row_hash. Empty result = intact. ⚠️ Deliberately does NOT recompute
    // row_hash from `detail`: canonical JSON serialisation must match the app's byte-for-byte, and
    // a mismatch there would look like tampering when it is really a serialiser difference.
    // Linkage is what an edit or deletion breaks, and linkage is checkable in pure SQL.
    // ⚠️ LAG() GOES IN A CTE, NEVER IN `WHERE` — Postgres forbids window functions there and this
    // errored on the first draft (agy caught it). WHERE is evaluated before the window, so the
    // comparison has to happen in a later stage.
    // ⚠️ COLUMN NAMES ARE QUOTED camelCase. Prisma's @@map renames the TABLE only; without a
    // per-field @map the columns stay camelCase, and unquoted identifiers are folded to lower
    // case by Postgres — so `subject_hash` and even `subjectHash` unquoted both fail (codex).
    `CREATE OR REPLACE FUNCTION compliance_audit_verify_chain()
       RETURNS TABLE(broken_at bigint, expected text, found text)
       LANGUAGE sql STABLE AS $$
         WITH chained AS (
           SELECT a.id,
                  a."prevHash" AS found,
                  LAG(a."rowHash") OVER (ORDER BY a.id) AS expected
             FROM compliance_audit a
         )
         SELECT id, expected, found
           FROM chained
          WHERE expected IS NOT NULL
            AND found IS DISTINCT FROM expected
       $$`,
  ],
]

const main = async () => {
  await client.connect()
  for (const [label, sql] of STATEMENTS) {
    try {
      await client.query(sql)
      console.log(`  ✔ ${label}`)
    } catch (e) {
      // ⚠️ REPORT AND CONTINUE, THEN EXIT NON-ZERO. Aborting on the first failure leaves the rest
      // unapplied and the operator seeing one error rather than the full picture — and these are
      // independent guards, so a missing partition helper must not stop the append-only rules.
      console.error(`  ✖ ${label}: ${e.message}`)
      process.exitCode = 1
    }
  }
  // Report chain state so a run doubles as a health check.
  try {
    const { rows } = await client.query('SELECT * FROM compliance_audit_verify_chain() LIMIT 5')
    console.log(rows.length === 0
      ? '  ✔ audit chain intact'
      : `  ⚠️  AUDIT CHAIN BROKEN at ids: ${rows.map((r) => r.broken_at).join(', ')}`)
    if (rows.length) process.exitCode = 1
  } catch (e) {
    console.error(`  ✖ chain check: ${e.message}`)
    process.exitCode = 1
  }
  await client.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
