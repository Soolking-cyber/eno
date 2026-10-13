/**
 * The Mioto TRIPS HISTORY: one snapshot (car id → totalTrips) per scrape. The reliability rule's 14-day trip test
 * compares each car with the newest snapshot at least 12 days old that holds it (src/lib/vehicle-reliability.ts).
 * Owner, 2026-10-13: keep only Mioto cars with "at least one completed trip in the last 14 days".
 *
 *   npx tsx scripts/vehicle-trips-history.ts --mioto ~/mioto_rentals_vn --out ~/eno-import-journals/vehicles/trips [--apply]
 *
 * Run by scripts/vehicle-rentals-weekly.sh right after the Mioto scrape. It reads this run's state/details.jsonl AND
 * every state/prev-<run>/details.jsonl the scraper moved aside — so the first run SEEDS the history from the
 * snapshots already on disk (2026-09-28, 10-05, 10-12), and every later run adds its own. A date that already holds a
 * snapshot of the same scrape is skipped (snapshotReplaces), so a re-run is a no-op.
 *
 * DRY BY DEFAULT: prints the files it would write. --apply writes each one write-then-rename, fsynced (file and
 * directory): a crash leaves the old file or the new one, never half of one. No network, no database.
 * ⛔ The time is read from the RECORDS (`_fetched_at`), never a file mtime — a copy or a `mv` resets an mtime, and
 * the prev-<run> directories are named after the run that MOVED them, not the scrape they hold.
 */
import { closeSync, createReadStream, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { invokedDirectly } from '../src/lib/cli-entry'
import {
  buildTripsSnapshot, parseTripsSnapshot, snapshotReplaces, sourceKeyOf, tripsSnapshotFile, tripsSnapshotFileName,
  type TripsSnapshot,
} from '../src/lib/vehicle-reliability'

/** Every snapshot file in `dir` (`YYYY-MM-DD.json`); a file that does not parse is reported, never half-read. */
export function loadTripsSnapshots(dir: string): { snapshots: TripsSnapshot[]; problems: string[] } {
  const snapshots: TripsSnapshot[] = [], problems: string[] = []
  if (!existsSync(dir)) return { snapshots, problems: [`${dir} does not exist — no trips history yet`] }
  for (const name of readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort()) {
    try {
      const s = parseTripsSnapshot(JSON.parse(readFileSync(join(dir, name), 'utf8')))
      if (typeof s === 'string') problems.push(`${name}: ${s}`)
      else snapshots.push(s)
    } catch (e) {
      problems.push(`${name}: ${(e as Error).message.slice(0, 120)}`)
    }
  }
  return { snapshots, problems }
}

/**
 * One details.jsonl → its snapshot (only the three fields it needs are kept while streaming a 130 MB file).
 * ⛔ SPLIT ON "\n" ONLY, NEVER node:readline. readline also ends a line at U+2028 / U+2029, which the scraper's
 * JSON carries RAW inside owners' descriptions (Python's json.dumps(ensure_ascii=False) leaves them unescaped):
 * measured 2026-10-13, two 10-12 records split into 14 unparseable fragments and those two cars silently fell
 * out of the history — and a car the history lacks can never pass the trip test.
 */
async function snapshotOf(file: string) {
  const records: Record<string, unknown>[] = []
  let bad = 0, rest = ''
  const take = (line: string) => {
    if (!line.trim()) return
    try {
      const r = JSON.parse(line) as Record<string, unknown>
      records.push({ id: r.id, totalTrips: r.totalTrips, _fetched_at: r._fetched_at })
    } catch { bad++ } // a torn last line from a killed scrape
  }
  for await (const chunk of createReadStream(file, { encoding: 'utf8' })) {
    const lines = (rest + (chunk as string)).split('\n')
    rest = lines.pop() ?? ''
    for (const line of lines) take(line)
  }
  take(rest)
  const s = buildTripsSnapshot(records)
  return s ? { ...s, skipped: s.skipped + bad } : null
}

function writeDurably(dir: string, name: string, body: string) {
  const target = join(dir, name), tmp = `${target}.tmp-${process.pid}`
  const fd = openSync(tmp, 'w')
  try { writeSync(fd, body); fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(tmp, target)
  const dfd = openSync(dir, 'r')
  try { fsyncSync(dfd) } finally { closeSync(dfd) }
}

async function main() {
  const argv = process.argv.slice(2)
  const val = (f: string) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null }
  const expand = (p: string | null) => (p ? resolve(p.replace(/^~(?=\/|$)/, homedir())) : null)
  const APPLY = argv.includes('--apply')
  const MIOTO = expand(val('--mioto')), OUT = expand(val('--out'))
  if (!MIOTO || !OUT) throw new Error('usage: --mioto <dataset dir> --out <trips history dir> [--apply]')
  const state = join(MIOTO, 'state')
  const files = [join(state, 'details.jsonl'), ...(existsSync(state) ? readdirSync(state).filter((n) => n.startsWith('prev-')).sort().map((n) => join(state, n, 'details.jsonl')) : [])]
    .filter((f) => existsSync(f))
  if (!existsSync(join(state, 'details.jsonl'))) console.warn(`  ! ${join(state, 'details.jsonl')} is missing — this run adds no snapshot of its own`)
  console.log(`${APPLY ? 'APPLY — writes snapshots' : 'DRY RUN'} · ${files.length} details file(s) · history ${OUT}`)

  // What is on disk, then what this run plans — two scrapes landing on one date keep the fuller one.
  const filed = new Map<string, { takenAt: number; count: number }>()
  /** size:mtime of every details file a filed snapshot was built from — those are not read again. */
  const filedSources = new Set<string>()
  for (const name of existsSync(OUT) ? readdirSync(OUT).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)) : []) {
    try {
      const raw = JSON.parse(readFileSync(join(OUT, name), 'utf8'))
      const s = parseTripsSnapshot(raw)
      if (typeof s === 'string') { console.warn(`  ! ${name} on disk does not parse (${s}) — it will be replaced`); continue }
      filed.set(name, { takenAt: s.takenAt, count: s.trips.size })
      const key = sourceKeyOf(raw)
      if (key) filedSources.add(key)
    } catch (e) { console.warn(`  ! ${name} on disk is unreadable (${(e as Error).message.slice(0, 80)}) — it will be replaced`) }
  }
  const planned = new Map<string, { body: string; takenAt: number; count: number; source: string }>()
  for (const f of files) {
    const st = statSync(f)
    if (filedSources.has(`${st.size}:${st.mtimeMs}`)) { console.log(`  ${f}: unchanged since it was filed — not re-read`); continue }
    const s = await snapshotOf(f)
    if (!s) { console.warn(`  ! ${f}: no record with an id, a trip count and a fetch time — skipped`); continue }
    const name = tripsSnapshotFileName(s.takenAt)
    const next = { takenAt: s.takenAt, count: s.trips.size }
    const current = planned.get(name) ?? filed.get(name) ?? null
    const verdict = snapshotReplaces(current, next)
    console.log(`  ${name}  ${String(s.trips.size).padStart(6)} cars  taken ${new Date(s.takenAt).toISOString()}${s.skipped ? `  (${s.skipped} record(s) skipped)` : ''}  ← ${f}  ${verdict ? (current ? 'REPLACES a smaller snapshot' : 'new') : 'already filed'}`)
    if (verdict) planned.set(name, { body: JSON.stringify(tripsSnapshotFile(s, f, { bytes: st.size, mtimeMs: st.mtimeMs })) + '\n', ...next, source: f })
  }
  if (!planned.size) { console.log('nothing to write — the history already holds every snapshot on disk'); return }
  if (!APPLY) { console.log(`DRY RUN — would write ${planned.size} snapshot file(s). Re-run with --apply.`); return }
  mkdirSync(OUT, { recursive: true })
  for (const [name, p] of planned) writeDurably(OUT, name, p.body)
  console.log(`wrote ${planned.size} snapshot file(s) → ${OUT}`)
}

if (invokedDirectly(import.meta.url)) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
}
