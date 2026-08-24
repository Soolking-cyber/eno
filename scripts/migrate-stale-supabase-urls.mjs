/**
 * REWRITE STORAGE URLs THAT STILL POINT AT THE RETIRED SUPABASE **CLOUD** PROJECT.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
 * Production moved to the self-hosted Supabase on the VN box (sb.eno.vn) at the 2026-08-22 cutover,
 * but rows written BEFORE that still carry absolute URLs on the Cloud host. Measured 2026-08-24
 * from the Cloud project's own edge logs: the ONLY external traffic left on it was
 * `facebookexternalhit/1.1` fetching `/storage/v1/object/public/listings/*.webp` — Facebook
 * re-crawling image URLs it learned from our catalog feed. Everything else in those logs was
 * Supabase's own platform health checks (`/auth/v1/health`, `/rest-admin/v1/ready`).
 *
 * ⚠️ THIS IS A PURE HOST SWAP, AND THAT IS WHY IT IS SAFE. The object exists at the SAME PATH on
 * both hosts (verified 2026-08-24: the file Facebook was fetching returns 200 on the Cloud host AND
 * on sb.eno.vn). Only the origin changes; the bucket, path and filename are untouched.
 *
 * ⚠️ IT SCANS EVERY TEXT COLUMN RATHER THAN A HAND-PICKED LIST. `Seller.avatarUrl` is the one that
 * leaked into eno.forum's HTML, but `Profile.avatarUrl` and `Listing.images` (a JSON array in a
 * text column) hold the same shape, and a list typed from memory is how the fourth one gets missed.
 * Scanning information_schema means a column added later is still found.
 *
 * ⛔ DisputeMessage.images stores PRIVATE-bucket PATHS, not absolute URLs, so it contains no host to
 * rewrite and the scan simply finds nothing there. Do not "fix" it by prefixing a host.
 *
 * Usage:
 *   node scripts/migrate-stale-supabase-urls.mjs            # DRY RUN — reports, changes nothing
 *   node scripts/migrate-stale-supabase-urls.mjs --apply    # performs the rewrite
 *
 * Needs DIRECT_URL (the box Postgres, normally over the SSH tunnel on 127.0.0.1:5433).
 */
import pg from 'pg'
import 'dotenv/config'

const OLD_HOST = 'https://xihiryllwmjoouipkyhw.supabase.co'
// ⚠️ MATCH THE HOST WITH ITS TRAILING SLASH. Replacing the bare host would also rewrite a
// look-alike such as `https://xihiryllwmjoouipkyhw.supabase.co.evil.example/x` into
// `https://sb.eno.vn.evil.example/x`. Every real storage URL has a path, so requiring the `/`
// costs nothing and makes the match a host boundary rather than a substring.
const OLD_PREFIX = OLD_HOST + '/'
const NEW_HOST = (process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://sb.eno.vn').replace(/\/+$/, '')
const APPLY = process.argv.includes('--apply')

if (NEW_HOST === OLD_HOST) {
  console.error('NEXT_PUBLIC_SUPABASE_URL still points at the retired Cloud project — refusing.')
  process.exit(1)
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!url) { console.error('DIRECT_URL / DATABASE_URL not set'); process.exit(1) }

const client = new pg.Client({ connectionString: url })
await client.connect()

// ⚠️ SAY WHICH DATABASE THIS IS BEFORE TOUCHING IT. `url` falls back to DATABASE_URL, and a stale
// or mis-set value would point at a pooler, a staging box, or the retired Cloud project itself.
{
  const { hostname, port } = new URL(url)
  const { rows } = await client.query('select current_database() db, inet_server_port() port')
  console.log(`Target: ${hostname}:${port} -> ${rows[0].db} (server port ${rows[0].port})`)
  if (/supabase\.co$/.test(hostname)) {
    console.error('Refusing to run against a *.supabase.co host — this migration moves data OFF it.')
    process.exit(1)
  }
}

/**
 * ⛔ TWO CLASSES OF TABLE MUST NEVER BE REWRITTEN, AND THE FIRST DRY RUN FOUND BOTH.
 *
 * · `_image_url_backup_20260822` (30 values) is the ROLLBACK SNAPSHOT taken at the cutover. Its
 *   whole job is to still hold the PRE-migration URLs; "fixing" them would delete the only record
 *   of what the values used to be, silently, and the script would report it as a success.
 * · `auth_handoff` (1 value) holds an EPHEMERAL nonce-bound SSO row. The one that carried a Cloud
 *   URL was 4.5 days old, `awaiting_pair`, 0 attempts — a dead pre-cutover handoff whose code
 *   expired long ago. Rewriting the host would resurrect nothing; such rows want deleting, and
 *   that is a different decision from a URL migration, so this script does not make it.
 *
 * Anything matching these is REPORTED and SKIPPED, never silently dropped — a skip you cannot see
 * reads exactly like a table that had no matches.
 */
/**
 * ⚠️ `next_cache` HOLDS 1,815 STALE VALUES AND MUST NOT BE REWRITTEN — IT IS THE ISR CACHE.
 * Those are rendered HTML/RSC payloads, not source data, and they are the reason eno.forum keeps
 * serving the old avatar URL even after the Seller row is fixed. Rewriting cache entries would be
 * editing a derived artifact; the correct move is to let them regenerate, or purge them, AFTER the
 * source rows are fixed. Reported as skipped so the operator knows a purge is the follow-up.
 */
const SKIP_TABLE = (t) => {
  const l = t.toLowerCase()
  return /^_/.test(t) || /backup/i.test(t) || l === 'auth_handoff' || l.startsWith('next_cache')
}

// Every text-ish column in the app schema. `quote_ident` on both sides so mixed-case Prisma
// table names ("Seller") survive.
const { rows: cols } = await client.query(`
  select c.table_name, c.column_name
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
  -- BASE TABLE only: information_schema.columns also lists VIEW columns, and an UPDATE on a
  -- non-updatable view raises, which would roll back the whole batch after other tables succeeded.
  where c.table_schema = 'public'
    and t.table_type = 'BASE TABLE'
    and c.data_type in ('text','character varying')
  order by c.table_name, c.column_name
`)

let total = 0
const hits = []
const scanErrors = []
const skipped = []
for (const { table_name, column_name } of cols) {
  if (SKIP_TABLE(table_name)) {
    const q0 = `select count(*)::int as n from ${JSON.stringify(table_name)} where ${JSON.stringify(column_name)} like $1`
    try {
      const n0 = (await client.query(q0, [`%${OLD_PREFIX}%`])).rows[0].n
      if (n0 > 0) skipped.push({ table_name, column_name, n: n0 })
    } catch { /* not a scannable column */ }
    continue
  }
  const q = `select count(*)::int as n from ${JSON.stringify(table_name)} where ${JSON.stringify(column_name)} like $1`
  // ⛔ A FAILED SCAN IS NOT AN EMPTY SCAN. `catch { continue }` used to swallow a permission or
  // quoting error, so a column holding stale URLs would be reported as clean and --apply would
  // print success. Surface it and refuse to proceed instead.
  let n = 0
  try { n = (await client.query(q, [`%${OLD_PREFIX}%`])).rows[0].n }
  catch (e) { scanErrors.push(`${table_name}.${column_name}: ${e.message.split('\n')[0]}`); continue }
  if (n > 0) { hits.push({ table_name, column_name, n }); total += n }
}

for (const s of skipped) {
  console.log(`  SKIPPED (protected): ${s.table_name}.${s.column_name}  ${s.n}`)
}

if (!hits.length) {
  console.log(`No rewritable rows reference ${OLD_HOST}. Nothing to do.`)
} else {
  console.log(`${APPLY ? 'REWRITING' : 'DRY RUN — would rewrite'} ${total} value(s):`)
  for (const h of hits) console.log(`  ${h.table_name}.${h.column_name}  ${h.n}`)
}

if (scanErrors.length) {
  console.error(`\n${scanErrors.length} column(s) could not be scanned — results are INCOMPLETE:`)
  for (const e of scanErrors) console.error(`  ${e}`)
  if (APPLY) { console.error('Refusing to --apply on an incomplete scan.'); process.exitCode = 1; await client.end(); process.exit(1) }
}

if (APPLY && hits.length) {
  let committed = false
  await client.query('begin')
  try {
    for (const { table_name, column_name } of hits) {
      const t = JSON.stringify(table_name), c = JSON.stringify(column_name)
      const r = await client.query(
        `update ${t} set ${c} = replace(${c}, $1, $2) where ${c} like $3`,
        [OLD_PREFIX, NEW_HOST + '/', `%${OLD_PREFIX}%`],
      )
      console.log(`  updated ${table_name}.${column_name}: ${r.rowCount}`)
    }
    await client.query('commit')
    committed = true
    // ⚠️ RE-SCAN AFTER COMMITTING, NEVER TRUST THE PRE-SCAN. Discovery ran before the transaction,
    // so a row written in between would be missed and the script would still print "Committed."
    let left = 0
    for (const { table_name, column_name } of hits) {
      const r = await client.query(
        `select count(*)::int as n from ${JSON.stringify(table_name)} where ${JSON.stringify(column_name)} like $1`,
        [`%${OLD_PREFIX}%`],
      )
      left += r.rows[0].n
    }
    if (left === 0) {
      console.log('Committed; re-scan confirms 0 remaining.')
    } else {
      // ⛔ NON-ZERO EXIT, NOT JUST A MESSAGE. A caller that only checks the status code would read
      // an incomplete migration as a success and move on.
      console.error(`Committed, but ${left} value(s) appeared during the run — RE-RUN. Exiting non-zero.`)
      process.exitCode = 1
    }
    console.log(
      '\nFOLLOW-UP REQUIRED: the ISR cache still holds rendered copies of the OLD url ' +
      '(next_cache, ~1,815 values). Until those entries regenerate or are purged, pages keep ' +
      'serving the retired host and Facebook keeps crawling it — the source fix alone is not visible.',
    )
  } catch (e) {
    // ⛔ ONLY CALL THIS A ROLLBACK IF IT ACTUALLY ROLLED BACK. The post-commit re-scan runs inside
    // this try, so a dropped connection during verification used to print "Rolled back:" about
    // changes that were already committed — the operator would then re-run or panic on a lie.
    if (!committed) {
      await client.query('rollback').catch(() => {})
      console.error('Rolled back:', e.message)
    } else {
      console.error(`COMMITTED, but verification failed to complete: ${e.message}. Re-run the dry run to confirm.`)
    }
    process.exitCode = 1
  }
}
await client.end()
