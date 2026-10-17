/**
 * The second-hand showcase check, by hand (owner, 2026-10-17: "check out 2nd hand deals some of them are no longer
 * available replace with available options have a 2nd hand run weekly to check"). The weekly run is the box timer's
 * /api/cron/secondhand-showcase; this is the same run (src/lib/secondhand-showcase-run.ts) from a Mac, over the tunnel.
 *
 *   npx tsx scripts/secondhand-showcase.ts                                   # DRY RUN — a read-only DB session
 *   npx tsx scripts/secondhand-showcase.ts --store minhtuanmobile.com        # one shop (repeatable)
 *   npx tsx scripts/secondhand-showcase.ts --retire <listingId>=<reason>     # a stated retirement (e.g. the owner's report)
 *   npx tsx scripts/secondhand-showcase.ts --keep <listingId>                # keep this row on its shelf first (while on sale)
 *   npx tsx scripts/secondhand-showcase.ts --apply                           # writes; journal under --journal-dir
 *   npx tsx scripts/secondhand-showcase.ts --rollback <journal> [--apply]    # undo a run: this CLI's journal or its
 *       -writes.jsonl, the box's kept answer (/var/lib/eno/cron-journals), or — when that answer was cut short — the
 *       container's log lines: docker logs eno-vn-app 2>&1 | grep '\[secondhand-showcase\] journal ' > writes.log
 *       (a log holding several runs needs --stamp '<the run's stamp>': only that run is undone)
 *
 * ⛔ DRY BY DEFAULT, AND PROVABLY: without --apply the database session itself is read-only (PGOPTIONS
 * default_transaction_read_only=on, set before the client loads), so a missed guard errors instead of writing.
 * Every apply writes its journal (every write with its prior status, price and updatedAt) before it exits; --rollback
 * replays it backwards, each row only while it still carries that run's stamp — a row anyone touched since is left alone
 * and reported.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { JournalEntry, RawDb, RunResult } from '../src/lib/secondhand-showcase-run'

const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(`--${n}`)
const values = (n: string) => argv.flatMap((a, i) => (a === `--${n}` && argv[i + 1] ? [argv[i + 1]] : []))
const APPLY = flag('apply')
const ROLLBACK = values('rollback')[0]
const STORES = values('store')
const JOURNAL_DIR = values('journal-dir')[0] ?? join(homedir(), 'eno-import-journals', 'secondhand')
const RETIRE = values('retire').map((v) => {
  const i = v.indexOf('=')
  if (i < 1 || !v.slice(i + 1).trim()) { console.error(`--retire needs <listingId>=<reason>, got "${v}"`); process.exit(2) }
  return { id: v.slice(0, i).trim(), reason: v.slice(i + 1).trim() }
})
const KEEP = values('keep')
const STAMP = values('stamp')[0]
const known = new Set(['--apply', '--allow-mass', '--json', '--rollback', '--stamp', '--store', '--retire', '--keep', '--journal-dir', '--skip-shelf-caps'])
for (const [i, a] of argv.entries()) {
  if (a.startsWith('--') && !known.has(a)) { console.error(`unknown argument ${a}`); process.exit(2) }
  if (!a.startsWith('--') && !['--rollback', '--stamp', '--store', '--retire', '--keep', '--journal-dir'].includes(argv[i - 1] ?? '')) { console.error(`stray argument ${a}`); process.exit(2) }
}

// ⛔ BEFORE the database client loads: node-postgres (and Prisma's adapter) read PGOPTIONS when they connect.
if (!APPLY) process.env.PGOPTIONS = [process.env.PGOPTIONS, '-c default_transaction_read_only=on'].filter(Boolean).join(' ')

// Loaded in main(), after PGOPTIONS is set (the scripts here run as CommonJS: no top-level await).
let db: typeof import('../src/lib/db')['db']
let tombstonePdps: typeof import('../src/lib/pdp-tombstone')['tombstonePdps']
let licenceClearedSql: typeof import('../src/lib/licence-stamp')['licenceClearedSql']
let run: typeof import('../src/lib/secondhand-showcase-run')
let raw: RawDb
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const stampNow = () => new Date().toISOString().replace('T', ' ').replace('Z', '')

async function check() {
  mkdirSync(JOURNAL_DIR, { recursive: true })
  // Each write just before it is made (write-ahead) — appended at once, so a run that dies midway still leaves what a
  // rollback replays; an entry whose write did not land replays as a no-op.
  const live = join(JOURNAL_DIR, `secondhand-showcase-${new Date().toISOString().replace(/[:.]/g, '-')}-writes.jsonl`)
  const r: RunResult = await run.runShowcase({
    db: raw,
    fetchPage: (url, shop) => run.fetchPageHonest(url, shop, sleep),
    fetchFeed: (cfg, ids) => run.fetchFeedFacts(cfg, ids, sleep),
    fetchApi: (cfg, row) => run.fetchApiHonest(cfg, row, sleep),
    now: () => new Date(),
    sleep,
    log: (m) => console.log(m),
    onTouched: async (ids) => { console.log(`PDP tombstones: ${await tombstonePdps(db, ids)}`) },
    onJournal: (e) => appendFileSync(live, JSON.stringify(e) + '\n'),
  }, { apply: APPLY, stores: STORES.length ? STORES : undefined, retire: RETIRE, keep: KEEP, allowMass: flag('allow-mass'), skipShelfCaps: flag('skip-shelf-caps') })
  const file = join(JOURNAL_DIR, `secondhand-showcase-${r.stamp.replace(/[: .]/g, '-')}-${r.apply ? 'apply' : 'dry'}.json`)
  writeFileSync(file, JSON.stringify(r, null, 1))
  if (flag('json')) { console.log(JSON.stringify(r, null, 1)); return r }
  const t = r.totals
  console.log(`\n${r.apply ? 'APPLIED' : 'DRY RUN'} ${r.stamp} UTC — ${t.live} live second-hand rows on ${t.shelves} shelves: retire ${t.retire} · hide ${t.trim} · restore ${t.restore} · reprice ${t.reprice} · unknown ${t.unknown} · short ${t.short} · capped-shelf trims ${t.capTrim}`)
  if (r.refused) console.log(`⛔ REFUSED: ${r.refused}`)
  for (const e of r.writeErrors) console.log(`⛔ WRITE FAILED: ${e}`)
  if (r.notReached.length) console.log(`not reached (budget): ${r.notReached.join(', ')}`)
  if (r.unmatchedRetire.length) console.log(`⚠️ --retire ids that are not live rows (nothing done): ${r.unmatchedRetire.join(', ')}`)
  const title = (id: string) => r.journal.find((j) => j.listingId === id)?.title ?? ''
  const store = (id: string) => r.journal.find((j) => j.listingId === id)?.store ?? ''
  for (const sh of r.shelves) {
    console.log(`\n${sh.shelf}  target ${sh.target} · live ${sh.live} → ${sh.liveAfter}${sh.short ? `  (short ${sh.short})` : ''}`)
    for (const id of sh.keep) console.log(`  = keep     ${id}  ${title(id) || '(unchanged)'}`)
    for (const x of sh.retire) console.log(`  − sold     ${x.id}  ${x.reason.padEnd(20)} ${store(x.id).padEnd(20)} ${title(x.id).slice(0, 60)}`)
    for (const x of sh.restore) console.log(`  + restore  ${x.id}  ${String(x.price).padStart(10)} ${x.store.padEnd(20)} ${title(x.id).slice(0, 60)}`)
    for (const x of sh.reprice) console.log(`  ~ price    ${x.id}  ${x.from} → ${x.to}`)
    if (sh.trim.length) console.log(`  ⤓ hide     ${sh.trim.length} row(s)`)
    if (Object.keys(sh.candidateSkips).length) console.log(`  pool: tried ${sh.candidatesTried}, skipped ${JSON.stringify(sh.candidateSkips)}`)
    for (const n of sh.notes) console.log(`  · ${n}`)
  }
  console.log('\nshops:')
  for (const s of r.shops) {
    const unknown = s.unknown.length ? ` · unknown ${s.unknown.length} (${[...new Set(s.unknown.map((u) => u.reason.split(':')[0]))].join(', ')})` : ''
    console.log(`  ${s.store.padEnd(22)}${s.skipped ? ` skipped: ${s.skipped}` : ` live ${s.live} · available ${s.available}${unknown}`}${s.held ? `\n    ⚠️ ${s.held}` : ''}`)
    for (const x of s.priceRefused) console.log(`    ! price ${x.id} ${x.why}`)
    for (const n of s.notes) console.log(`    · ${n}`)
  }
  for (const c of r.caps) {
    console.log(`\n${c.shelf} cap — live ${c.live}${c.trim.length ? `, hide ${c.trim.length}` : ', within its cap'}`)
    for (const x of c.trim.slice(0, 20)) console.log(`  ⤓ ${x.id}  ${x.seller.padEnd(14)} ${x.title.slice(0, 70)}`)
    for (const n of c.notes) console.log(`  · ${n}`)
  }
  console.log(`\njournal → ${file}`)
  return r
}

/**
 * A journal (`{ apply, journal }` — this CLI's, or the box's kept answer), else a write log: one LANDED write per line,
 * each read from its first `{` (this CLI's -writes.jsonl; the container's `[secondhand-showcase] journal {…}` lines).
 */
function readJournal(path: string): { entries: JournalEntry[]; apply: boolean } {
  const text = readFileSync(path, 'utf8')
  let doc: unknown
  try { doc = JSON.parse(text) } catch { doc = undefined }
  if (doc && typeof doc === 'object' && Array.isArray((doc as { journal?: unknown }).journal)) {
    const d = doc as { journal: JournalEntry[]; apply?: boolean }
    return { entries: d.journal, apply: !!d.apply }
  }
  let all: JournalEntry[]
  try { all = text.split('\n').filter((l) => l.includes('{')).map((l) => JSON.parse(l.slice(l.indexOf('{'))) as JournalEntry) } catch {
    console.error(`${path}: not a journal or a write log (a cut-off answer? use the container's journal lines — see the header)`); process.exit(2)
  }
  const bad = all.filter((e) => typeof e?.listingId !== 'string' || typeof e.stamp !== 'string' || !['retire', 'trim', 'reprice', 'restore'].includes(e.action))
  if (bad.length || !all.length) { console.error(`${path}: not a journal or a write log (${bad.length} unreadable line(s))`); process.exit(2) }
  // ⛔ ONE RUN AT A TIME: a container log holds every run since the container started, and each entry would undo its row
  // while that row still carries its own run's stamp — weeks-old writes included (review, 2026-10-17).
  const stamps = [...new Set(all.map((e) => e.stamp))]
  if (!STAMP && stamps.length > 1) { console.error(`${path} holds ${stamps.length} runs — pass --stamp with one of: ${stamps.join(' | ')}`); process.exit(2) }
  const entries = STAMP ? all.filter((e) => e.stamp === STAMP) : all
  if (!entries.length) { console.error(`no write of the run stamped ${STAMP} in ${path}`); process.exit(2) }
  return { entries, apply: true }
}

/** Undo a run, newest write first; each row only while it still carries that run's stamp. */
async function rollback(path: string) {
  const doc = readJournal(path)
  const entries = [...doc.entries].reverse()
  if (!doc.apply) { console.error('that journal is a DRY RUN — it wrote nothing, there is nothing to undo'); process.exit(2) }
  // ⛔ ONLY THE PARTNER STOREFRONTS' ROWS: every statement re-checks that the row's seller is an ownerless storefront this
  // job runs on, so a mistaken or edited journal can never publish or reprice a person's listing (review, 2026-10-17).
  // A row put back ON SHOW must also still be fit to show and have no compliance decision since the run — a report filed
  // since leaves updatedAt alone (run.STILL_PUBLISHABLE_SQL, the run's own restore rule).
  const { PARTNER_STORES } = await import('../src/lib/partner-stores')
  const { SHELF_CAPS, CAP_POOL_TABLE } = await import('../src/lib/secondhand-showcase')
  const names = [...new Set([...PARTNER_STORES.map((s) => s.name), ...SHELF_CAPS.flatMap((c) => c.sellers)])]
  const ours = (n: number) => `"sellerId" IN (SELECT s.id FROM "Seller" s WHERE s."ownerId" IS NULL AND s.name = ANY($${n}::text[]))`
  console.log(`${APPLY ? 'ROLLING BACK' : 'DRY RUN of the rollback'} — ${entries.length} write(s) from ${path}`)
  const undone: string[] = []
  const skipped: string[] = []
  for (const e of entries) {
    if (!APPLY) { console.log(`  would undo ${e.action} ${e.listingId} → ${e.fromStatus}, ${e.fromPrice}`); continue }
    let n = 0
    if (e.action === 'retire') {
      // Back on sale exactly as it was read — a publish, so the licence guard rides along (no goods row is in an aisle).
      n = await raw.$executeRawUnsafe(
        `UPDATE "Listing" SET status = 'active', "updatedAt" = $2::timestamp
          WHERE id = $1 AND status = 'sold' AND "updatedAt" = $3::timestamp AND ${licenceClearedSql()} AND ${ours(4)}
            AND ${run.STILL_PUBLISHABLE_SQL} AND ${run.noDecisionSinceSql('$3::timestamp')}`,
        e.listingId, e.fromUpdatedAt, e.stamp, names)
    } else if (e.action === 'trim') {
      // Back on its shelf exactly as it was read — and OUT of the cap's pool, in the same transaction: a live row carrying
      // its old updatedAt must not stay a member, or a later hide that leaves updatedAt alone (journaled-hide) would make
      // it restorable again (review, 2026-10-17). A capped-shelf trim was never in the pool: the DELETE finds nothing.
      n = await raw.$transaction(async (tx) => {
        const back = await tx.$executeRawUnsafe(
          `UPDATE "Listing" SET status = 'active', "updatedAt" = $2::timestamp
            WHERE id = $1 AND status = 'hidden' AND "updatedAt" = $3::timestamp AND ${licenceClearedSql()} AND ${ours(4)}
              AND ${run.STILL_PUBLISHABLE_SQL} AND ${run.noDecisionSinceSql('$3::timestamp')}`,
          e.listingId, e.fromUpdatedAt, e.stamp, names)
        if (back) await tx.$executeRawUnsafe(`DELETE FROM "${CAP_POOL_TABLE}" WHERE id = $1`, e.listingId)
        return back
      })
    } else if (e.action === 'restore') {
      // Hidden again with the cap's own updatedAt, so the row is back in the pool exactly as the cap left it.
      n = await raw.$executeRawUnsafe(
        `UPDATE "Listing" SET status = 'hidden', price = $2, "updatedAt" = $3::timestamp WHERE id = $1 AND status = 'active' AND "updatedAt" = $4::timestamp AND ${ours(5)}`,
        e.listingId, e.fromPrice, e.fromUpdatedAt, e.stamp, names)
    } else {
      n = await raw.$executeRawUnsafe(
        `UPDATE "Listing" SET price = $2, "updatedAt" = $3::timestamp WHERE id = $1 AND status = 'active' AND "updatedAt" = $4::timestamp AND ${ours(5)}`,
        e.listingId, e.fromPrice, e.fromUpdatedAt, e.stamp, names)
    }
    ;(n ? undone : skipped).push(e.listingId)
  }
  if (!APPLY) return
  if (undone.length) console.log(`PDP tombstones: ${await tombstonePdps(db, undone)}`)
  console.log(`undone ${undone.length}; left alone ${skipped.length} (changed since the run): ${skipped.join(', ') || '—'}`)
  writeFileSync(`${path}.rollback-${stampNow().replace(/[: .]/g, '-')}.json`, JSON.stringify({ undone, skipped }, null, 1))
}

async function main() {
  ;({ db } = await import('../src/lib/db'))
  ;({ tombstonePdps } = await import('../src/lib/pdp-tombstone'))
  ;({ licenceClearedSql } = await import('../src/lib/licence-stamp'))
  run = await import('../src/lib/secondhand-showcase-run')
  raw = db as unknown as RawDb
  try {
    if (ROLLBACK) await rollback(ROLLBACK)
    else {
      const r = await check()
      if (!r.ok) process.exitCode = 1
    }
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
