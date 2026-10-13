/**
 * Does the DATABASE answer? — scripts/vehicle-rentals-weekly.sh asks this right before the import stage (and again
 * before its one retry). ⛔ A PORT THAT ANSWERS IS NOT A TUNNEL THAT WORKS (review 2026-10-13): `nc -z :5433` passes
 * on any listener — another job's bare `ssh -fN`, or a tunnel whose connection died while the Mac slept, which keeps
 * its local port for up to ~90 s — so the job runs a real `SELECT 1` through the same connection string the
 * importer uses, with a 10 s budget.
 *
 *   npx tsx scripts/vehicle-db-probe.ts      # exit 0 = answered; 1 = did not (the reason on stderr)
 *
 * Read-only: one SELECT 1, nothing else.
 */
import pg from 'pg'

const TIMEOUT_MS = 10_000

async function main() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('DIRECT_URL (or DATABASE_URL) is not set')
  const c = new pg.Client({ connectionString, connectionTimeoutMillis: TIMEOUT_MS, statement_timeout: TIMEOUT_MS, query_timeout: TIMEOUT_MS })
  // A dead socket must fail this probe, not hang it past the job's patience — the closing handshake included: the
  // timer stays armed until the process exits (gate review: it was cleared before `end()`, which can hang).
  setTimeout(() => { console.error(`  database did not answer in ${TIMEOUT_MS / 1000} s`); process.exit(1) }, TIMEOUT_MS + 2_000)
  try {
    await c.connect()
    const r = await c.query('SELECT 1 AS ok')
    if (r.rows[0]?.ok !== 1) throw new Error('SELECT 1 did not return 1')
    console.log(`  database answered (${new Date().toISOString()})`)
  } finally {
    // At most 2 s for a clean goodbye; the explicit exits below never wait on a socket that will not close.
    await Promise.race([c.end().catch(() => {}), new Promise((r) => setTimeout(r, 2_000))])
  }
}

main().then(
  () => process.exit(0),
  (e) => { console.error(`  database did not answer: ${(e as Error).message.slice(0, 200)}`); process.exit(1) },
)
