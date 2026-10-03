/**
 * Retire NEW-GOODS listings of ownerless import shops — the second-hand focus (owner, 2026-10-03: "remove
 * tiki and cellphones products from the app, we will have tight focus on second hand stores and rentals
 * plus job postings" → "yes correct all that are second hand we need the listings").
 *
 * The rule is src/lib/new-retail-retire.ts. It is the one that ran by psql on 2026-10-03 (68,250 rows,
 * journal new-goods-hide-20261003T040816Z.csv), so on the day it was written a dry run selects 0 rows —
 * its job is to CATCH LEAKS (an import, a re-listing) and to roll back any of that day's journals.
 *
 *   set -a; . ./.env; set +a          # DIRECT_URL; the dry run opens a READ-ONLY session
 *   npx tsx scripts/retire-new-retail.ts --ids-out <file>             # DRY RUN: report + the reviewed id list
 *   npx tsx scripts/retire-new-retail.ts --apply --ids <file> --journal-dir <durable dir>
 *   npx tsx scripts/retire-new-retail.ts --rollback <journal> [--seller <id>] [--exclude-journal <file>]… [--journals-dir <dir>]… [--apply]
 *
 * ⛔ --apply HIDES EXACTLY THE REVIEWED LIST OR NOTHING. It re-selects, and refuses on ANY difference from
 * the --ids file the dry run wrote (an import between the two would otherwise be hidden unseen). Every
 * row is re-checked by `retireVerdict` and the hide is src/lib/journaled-hide.ts: the journal (status +
 * updatedAt per row) is on disk BEFORE any write, the hide is conditional on both, raw SQL — so
 * `updatedAt` and sitemap ordering are untouched — and it refuses any row of an owned storefront.
 *
 * ⛔ HIDDEN, NEVER DELETED (Law 122/2025 Art 17.1(e); src/lib/listing-removed.ts). Images stay.
 *
 * ⛔ --rollback READS THREE FORMATS, and restores a row ONLY while it is exactly what the hide left:
 *   · this script's JSON journal → journaledRestore (hidden, same updatedAt, no compliance decision since,
 *     storefront still ownerless);
 *   · the psql `id,prior` CSVs (new-goods-hide-…, supersports-hide-…) → hidden, NOT WRITTEN SINCE
 *     (`updatedAt` < the journal's time, taken from its file name or --journal-created-at), no compliance
 *     decision since, ownerless, not labelled `used`;
 *   · the 04:21 condition-fix CSV (used-condition-fix-…) → each action inverted under the same guards.
 *   In every format, a row named by a LATER journal (its directory, ./scripts/journals, --journals-dir, or
 *   --exclude-journal) is left alone:
 *   a later decision is never undone by rolling back an earlier one. --seller scopes it to one shop.
 *
 * ⚠️ AFTER A WRITE: the script runs scripts/purge-isr-listings.mjs (the listing route's ISR tombstone);
 * Cloudflare `purge_everything` on both zones is the main session's step.
 */
import { spawnSync } from 'node:child_process'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { journaledHide, journaledRestore, rollbackPathArg, type HideJournal } from '../src/lib/journaled-hide'
import { journalDirProblem } from '../src/lib/honeycomb-listing'
import { isUsedTitle } from '../src/lib/used-signal'
import {
  RETIRE_KEEP_SELLERS, RETIRE_MIXED_SHOPS, RETIRE_PROTECTED_CATEGORIES, RETIRE_SELECT_SQL,
  compareIdSets, conditionFixRestore, formatIdsFile, idsDigest, journalCreatedAt, journalFormat,
  laterJournalExclusions, legacyRestore, parseConditionFixCsv, parseIdPriorCsv, parseIdsFile,
  retireJournalRows, retireSelectArgs, retireVerdict, type RetireRow,
} from '../src/lib/new-retail-retire'

const argv = process.argv.slice(2)
const str = (f: string) => { const i = argv.indexOf(f); const v = i >= 0 ? argv[i + 1] : undefined; return v && !v.startsWith('--') ? v : null }
const all = (f: string) => argv.flatMap((a, i) => (a === f && argv[i + 1] && !argv[i + 1].startsWith('--') ? [argv[i + 1]] : []))
const APPLY = argv.includes('--apply')
const LIST = argv.includes('--list')
const { path: ROLLBACK, error: rollbackError } = rollbackPathArg(process.argv)
if (rollbackError) { console.error(rollbackError); process.exit(1) }
const IDS = str('--ids')
const IDS_OUT = str('--ids-out')
const JOURNAL_DIR = str('--journal-dir')
const SELLER = str('--seller')
const CREATED_AT = str('--journal-created-at')
const EXCLUDE = all('--exclude-journal')
if (argv.includes('--seller') && !SELLER) { console.error('--seller needs a seller id'); process.exit(1) }

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!connectionString) { console.error('DIRECT_URL (or DATABASE_URL) is not set — source .env first'); process.exit(1) }
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString, ...(APPLY ? {} : { options: '-c default_transaction_read_only=on' }) }),
  log: ['warn', 'error'],
})

const pad = (v: unknown, w: number) => String(v).padStart(w)
const short = (t: string | null | undefined, n = 70) => (t ?? '').replace(/\s+/g, ' ').slice(0, n)

function purgeIsr() {
  console.log('\nPurging the baked listing pages (ISR route tombstone)…')
  const r = spawnSync(process.execPath, [join(process.cwd(), 'scripts/purge-isr-listings.mjs')], { stdio: 'inherit', env: process.env })
  // A failed purge fails the run (commit-gate review): the database write stands, but baked pages may still
  // show the rows, so the exit code must not say "done".
  if (r.status !== 0) { console.error('⛔ purge-isr-listings.mjs FAILED — run it by hand: node scripts/purge-isr-listings.mjs'); process.exitCode = 1 }
  console.log('NEXT: npx tsx scripts/recount-brand-listings.ts (dry run, then --apply --journal-dir <durable dir>) — Brand.listingCount')
  console.log('      never drops on a hide; then Cloudflare purge_everything on BOTH zones (eno.vn, eno.forum) — the main session\'s step.')
}

function durableDir(dir: string): string {
  const abs = resolve(dir)
  const roots = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', tmpdir()]
  try { roots.push(realpathSync(tmpdir())) } catch { /* the plain path is still checked */ }
  const problem = journalDirProblem(abs, roots)
  if (problem) throw new Error(problem)
  mkdirSync(abs, { recursive: true })
  const probe = join(abs, `.retire-journal-probe-${process.pid}`)
  const fd = openSync(probe, 'a')
  try { writeSync(fd, 'ok\n'); fsyncSync(fd) } finally { closeSync(fd) }
  unlinkSync(probe)
  return abs
}

// ── dry run / apply ───────────────────────────────────────────────────────────────────────────────────

async function select(): Promise<{ rows: RetireRow[]; candidates: RetireRow[]; keptMixed: RetireRow[] }> {
  const rows = await db.$queryRawUnsafe<RetireRow[]>(RETIRE_SELECT_SQL, ...retireSelectArgs())
  const candidates: RetireRow[] = []
  const keptMixed: RetireRow[] = []
  for (const r of rows) (retireVerdict(r).retire ? candidates : keptMixed).push(r)
  return { rows, candidates, keptMixed }
}

async function report(candidates: RetireRow[], keptMixed: RetireRow[], structural: number) {
  console.log(`${APPLY ? 'APPLY — WRITES TO THE DATABASE' : 'DRY RUN (read-only session)'} — retire rule: ownerless import, listingType sell, condition not used,`)
  console.log(`  not in ${RETIRE_PROTECTED_CATEGORIES.join('/')}, not a kept shop; a mixed shop's row only when it does not say used.\n`)

  console.log(`SELECTED ${candidates.length} row(s) to hide  (structural match ${structural}, of which ${keptMixed.length} kept: a mixed shop's row that says used)`)
  const t = new Map<string, number>()
  for (const r of candidates) {
    const k = `${r.seller} (${r.sellerId})\t${r.status}\t${r.condition ?? 'NULL'}\t${r.category}`
    t.set(k, (t.get(k) ?? 0) + 1)
  }
  if (t.size) {
    console.log('  count  seller · status · condition · category')
    for (const [k, n] of [...t].sort((a, b) => b[1] - a[1])) console.log(`  ${pad(n, 5)}  ${k.replace(/\t/g, ' · ')}`)
  }
  if (candidates.length && (LIST || candidates.length <= 40)) for (const r of candidates) console.log(`    ${r.id}  [${r.status}] ${short(r.titleVi || r.title)}  — ${retireVerdict(r).why}`)

  // ⛔ THE GUARD SECTION: re-checked row by row, independent of the SQL that selected them. Must be 0.
  const bad = candidates.filter((r) => r.ownerId || r.listingType !== 'sell' || RETIRE_PROTECTED_CATEGORIES.includes(r.category) || r.condition === 'used' || RETIRE_KEEP_SELLERS.has(r.sellerId) || (!r.externalId && !r.affiliateUrl))
  console.log(`\nGUARD — selected rows that are owned / not sell / protected / used / a kept shop / not imported: ${bad.length}${bad.length ? '  ⛔ REFUSING' : '  ✓'}`)
  return bad.length
}

async function context() {
  console.log('\nKEPT SHOPS (never selected) and MIXED SHOPS (used rows kept) — live rows by condition:')
  const ids = [...RETIRE_KEEP_SELLERS.keys(), ...RETIRE_MIXED_SHOPS.keys()]
  const rows = await db.$queryRawUnsafe<{ sellerId: string; name: string; status: string; condition: string | null; n: number }[]>(
    `SELECT s.id AS "sellerId", s.name, l.status, l.condition, count(*)::int AS n FROM "Listing" l JOIN "Seller" s ON s.id = l."sellerId" ` +
    `WHERE s.id = ANY($1::text[]) AND l.status IN ('active','sold','hidden') GROUP BY 1,2,3,4 ORDER BY 2,3,4`, ids)
  for (const id of ids) {
    const mine = rows.filter((r) => r.sellerId === id)
    const why = RETIRE_KEEP_SELLERS.get(id) ?? RETIRE_MIXED_SHOPS.get(id)
    console.log(`  ${RETIRE_KEEP_SELLERS.has(id) ? 'KEEP ' : 'MIXED'} ${mine[0]?.name ?? '(no rows)'} (${id}) — ${why}`)
    console.log(`         ${mine.map((r) => `${r.status}/${r.condition ?? 'NULL'} ${r.n}`).join(' · ') || '—'}`)
  }

  // For transparency: what the brief's LITERAL rule ("ownerless, sell, condition ≠ used", nothing else) would still take.
  const literal = await db.$queryRawUnsafe<{ name: string; id: string; category: string; condition: string | null; n: number }[]>(
    `SELECT s.name, s.id, c.slug AS category, l.condition, count(*)::int AS n FROM "Listing" l JOIN "Seller" s ON s.id = l."sellerId" JOIN "Category" c ON c.id = l."categoryId" ` +
    `WHERE l.status IN ('active','sold') AND s."ownerId" IS NULL AND l."listingType" = 'sell' AND l.condition IS DISTINCT FROM 'used' GROUP BY 1,2,3,4 ORDER BY 5 DESC`)
  const total = literal.reduce((n, r) => n + r.n, 0)
  console.log(`\nRESIDUAL — the brief's literal rule (ownerless + sell + not used, no exceptions) would ALSO hide ${total} live row(s):`)
  for (const r of literal) console.log(`  ${pad(r.n, 5)}  ${r.name} (${r.id}) · ${r.category} · ${r.condition ?? 'NULL'}${RETIRE_KEEP_SELLERS.has(r.id) ? '  — kept shop' : ''}`)
}

/**
 * ⚠️ THE CONDITION AUDIT — report only, nothing here writes. The rule trusts `condition` for most rows;
 * this is where a WRONG label shows: a hidden row of an affected shop whose own words say used (a restore
 * candidate for the owner), and a live row labelled used with no cue at all (a false "second-hand").
 */
async function conditionAudit() {
  const ids = [...RETIRE_MIXED_SHOPS.keys(), ...RETIRE_KEEP_SELLERS.keys()]
  const rows = await db.$queryRawUnsafe<{ id: string; status: string; condition: string | null; title: string; titleVi: string | null; affiliateUrl: string | null; seller: string; sellerId: string }[]>(
    `SELECT l.id, l.status, l.condition, l.title, l."titleVi", l."affiliateUrl", s.name AS seller, s.id AS "sellerId" FROM "Listing" l JOIN "Seller" s ON s.id = l."sellerId" ` +
    `WHERE s.id = ANY($1::text[]) AND s."ownerId" IS NULL AND l.status IN ('active','sold','hidden') ORDER BY s.name, l.id`, ids)
  const hiddenSaysUsed = rows.filter((r) => r.status === 'hidden' && r.condition !== 'used' && isUsedTitle(r.title, r.titleVi, r.affiliateUrl))
  // Only in the MIXED shops, where the label is what separates a kept row from a hidden one; a kept shop is
  // second-hand by the shop (its workstations say "Precision M6700", not "cũ").
  const usedNoCue = rows.filter((r) => r.status !== 'hidden' && r.condition === 'used' && RETIRE_MIXED_SHOPS.has(r.sellerId) && !isUsedTitle(r.title, r.titleVi, r.affiliateUrl))
  console.log(`\nCONDITION AUDIT (report only) over ${rows.length} rows of the mixed and kept shops:`)
  console.log(`  ${hiddenSaysUsed.length} HIDDEN row(s) whose own title/URL says used — candidates to restore as used (owner's call):`)
  for (const r of hiddenSaysUsed) console.log(`    ${r.id}  ${r.seller} · ${r.condition ?? 'NULL'} · ${short(r.titleVi || r.title)}`)
  console.log(`  ${usedNoCue.length} LIVE row(s) of a MIXED shop labelled used with no used cue anywhere — check before trusting the label:`)
  for (const r of usedNoCue.slice(0, LIST ? Infinity : 60)) console.log(`    ${r.id}  ${r.seller} · [${r.status}] ${short(r.titleVi || r.title)}`)
  if (!LIST && usedNoCue.length > 60) console.log(`    … and ${usedNoCue.length - 60} more (--list prints all)`)
}

async function run() {
  if (APPLY && (!IDS || !JOURNAL_DIR)) throw new Error('--apply needs --ids <file written by the dry run\'s --ids-out> and --journal-dir <durable dir>')
  const journalDir = APPLY ? durableDir(JOURNAL_DIR!) : null
  const { rows, candidates, keptMixed } = await select()
  const bad = await report(candidates, keptMixed, rows.length)
  if (bad) throw new Error('guard failed — a selected row is outside the rule; nothing written')

  if (!APPLY) {
    await context()
    await conditionAudit()
    console.log(`\nreviewed set: ${candidates.length} id(s), sha256 ${idsDigest(candidates.map((r) => r.id))}`)
    if (IDS_OUT) { writeFileSync(IDS_OUT, formatIdsFile(candidates.map((r) => r.id))); console.log(`  written to ${IDS_OUT}`) }
    console.log(`\nDRY RUN — nothing written.${candidates.length ? ` To hide exactly these: --apply --ids ${IDS_OUT ?? '<--ids-out file>'} --journal-dir <durable dir>` : ''}`)
    return
  }

  const reviewed = parseIdsFile(readFileSync(IDS!, 'utf8'))
  const { missing, extra } = compareIdSets(reviewed, candidates.map((r) => r.id))
  if (missing.length || extra.length) {
    console.error(`⛔ the selection changed since the dry run: ${missing.length} reviewed id(s) no longer selected, ${extra.length} new one(s) never reviewed.`)
    for (const id of extra.slice(0, 20)) console.error(`    + ${id}`)
    for (const id of missing.slice(0, 20)) console.error(`    - ${id}`)
    throw new Error('refusing — re-run the dry run, read it, and pass its new --ids-out file')
  }
  if (!candidates.length) { console.log('\nnothing to hide.'); return }

  const journal = join(journalDir!, `retire-new-retail-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  const out = await journaledHide(db, candidates.map((r) => ({ id: r.id, sellerId: r.sellerId, rule: 'retire-new-retail', matched: retireVerdict(r).why, title: short(r.titleVi || r.title, 140), expectUpdatedAt: r.updatedAt })),
    { path: journal, kind: 'retire-new-retail' })
  if (!out.journal) { console.log('\nnothing hidden — every row was written, or left active|sold, between the select and the snapshot.'); return }
  console.log(`\njournal written: ${journal} (${out.journaled} rows)`)
  console.log(`HIDDEN ${out.hidden.length} of ${candidates.length} (a row written since it was judged, or between the snapshot and the write, is skipped).`)
  console.log(`ROLLBACK: npx tsx scripts/retire-new-retail.ts --rollback ${journal} [--apply]`)
  if (out.hidden.length) purgeIsr()
}

// ── rollback ──────────────────────────────────────────────────────────────────────────────────────────

async function rollback(path: string) {
  const text = readFileSync(path, 'utf8')
  const format = journalFormat(text)
  const createdAt = CREATED_AT ? new Date(CREATED_AT) : journalCreatedAt(path, text)
  if (!createdAt || Number.isNaN(createdAt.getTime())) throw new Error(`cannot tell when ${path} was written — pass --journal-created-at <ISO, UTC>`)
  const ex = laterJournalExclusions(path, createdAt, EXCLUDE, [join(process.cwd(), 'scripts', 'journals'), ...all('--journals-dir')])
  console.log(`${APPLY ? 'ROLLBACK — WRITES TO THE DATABASE' : 'ROLLBACK DRY RUN (read-only session)'}: ${path}`)
  console.log(`  format ${format}, written ${createdAt.toISOString()}${SELLER ? `, seller ${SELLER} only` : ''}`)
  console.log(`  left alone because a LATER journal names them: ${ex.ids.size} id(s)${ex.byFile.map((f) => `\n    ${f.n} in ${f.path}`).join('')}`)
  console.log(`  later journals looked for in: ${ex.dirs.join(' · ')} (add more with --journals-dir <dir> or --exclude-journal <file>)`)
  if (!ex.byFile.length) console.log(`  ⚠️ no later journal found — a later hide whose journal lives anywhere else is NOT seen: name it with --exclude-journal <file>`)

  let changed = 0
  if (format === 'retire-json') {
    const journal = JSON.parse(text) as HideJournal
    const rows = retireJournalRows(journal, { sellerId: SELLER, exclude: ex.ids })
    const r = await journaledRestore(db, { createdAt: journal.createdAt, rows }, { apply: APPLY })
    console.log(`  ${journal.rows.length} journaled · ${rows.length} in scope · ${r.restorable.length} still exactly as the hide left them → restorable`)
    changed = r.restored.length
  } else if (format === 'id-prior-csv') {
    const rows = parseIdPriorCsv(text)
    const r = await legacyRestore(db, rows, { createdAt, sellerId: SELLER, exclude: ex.ids, apply: APPLY })
    const byPrior = new Map<string, number>()
    for (const x of r.restorable) byPrior.set(x.prior, (byPrior.get(x.prior) ?? 0) + 1)
    console.log(`  ${r.total} journaled · ${r.excluded} excluded by a later journal · ${r.restorable.length} restorable${[...byPrior].map(([p, n]) => ` · ${n} to '${p}'`).join('')}`)
    console.log(`  the rest are no longer hidden, were written since ${createdAt.toISOString()}, are labelled used, are under a compliance decision, or sit in another shop`)
    changed = r.restored.length
  } else if (format === 'condition-fix-csv') {
    const rows = parseConditionFixCsv(text)
    const r = await conditionFixRestore(db, rows, { createdAt, sellerId: SELLER, exclude: ex.ids, apply: APPLY })
    console.log(`  ${r.total} journaled · ${r.excluded} excluded by a later journal`)
    for (const [action, a] of Object.entries(r.byAction)) console.log(`    ${action.padEnd(13)} ${pad(a.rows, 5)} rows · ${pad(a.restorable.length, 5)} invertible${APPLY ? ` · ${a.restored.length} inverted` : ''}`)
    changed = Object.values(r.byAction).reduce((n, a) => n + a.restored.length, 0)
  } else {
    throw new Error(`${path} is not a retire-new-retail journal, an id,prior CSV or a condition-fix CSV (detected: ${format})`)
  }
  if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply to restore.'); return }
  console.log(`\nRESTORED ${changed} row(s).`)
  if (changed) purgeIsr()
}

;(ROLLBACK ? rollback(ROLLBACK) : run())
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
  .finally(() => db.$disconnect())
