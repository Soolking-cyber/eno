/**
 * FILL `material` ON THE LIVE IMPORTED FURNITURE ROWS THAT HAVE NONE, FROM THEIR OWN TITLES (owner,
 * 2026-10-05: "read the material from furniture titles").
 *
 *   set -a; . ./.env; set +a          # DIRECT_URL; every dry run opens a READ-ONLY session
 *   npx tsx scripts/backfill-furniture-material.ts                                   # DRY RUN: per shelf × material + 20 samples
 *   npx tsx scripts/backfill-furniture-material.ts --apply                           # journal, then write
 *   npx tsx scripts/backfill-furniture-material.ts --restore=<journal.csv>           # restore DRY RUN
 *   npx tsx scripts/backfill-furniture-material.ts --restore=<journal.csv> --apply   # restore
 *
 * WHY. The `material` facet keys the furniture chips in the Filter panel and the furniture fallback price
 * band (src/lib/price-fallback.ts FALLBACK_FACET). Measured 2026-10-05: 3,236 of the 3,237 live verified
 * rows on its four shelves are ONE import shop's (Bàn Ghế Thanh Lý, scripts/import-partners.ts), which
 * wrote no attributes — `material` was set on 1 row. The importer now reads it from the title
 * (src/lib/furniture-material.ts); this fills the rows it created before that, with the SAME decision.
 *
 * WHAT IT SELECTS: `verified`, status active|sold (the importer's "live" — a sold row still renders its
 * page), category furniture-appliances, a subcategory whose FALLBACK_FACET is `material`, attributes with no
 * material, and an OWNERLESS storefront — an import. ⛔ Never a person's own post: the wizard requires a
 * material, so a human row without one is the person's to set (measured 2026-10-05: there are none).
 *
 * WHAT IT WRITES: the stored attributes plus `"material":"<value>"` — decideTitleMaterial() on the
 * merchant's own title (ownWordsTitle: `titleVi`; `title` is the English translation and is never read).
 * Nothing on a row whose title names no material, two materials, one outside the taxonomy or only a part's.
 *
 * ⛔ ONLY ROWS WHOSE MATERIAL IS EMPTY, AND ONLY WHILE THEY STILL ARE. Each UPDATE is a compare-and-set on
 * the attributes this run read (`IS NOT DISTINCT FROM`) and re-checks verified + active|sold + ownerless,
 * so a seller's or a moderator's edit between the read and the write wins and the row is skipped.
 * ⛔ RAW SQL: Prisma would stamp `updatedAt`, which orders the sitemaps and which the journaled hides'
 * rollbacks compare — a filled-in facet is not an edit.
 * ⛔ THE JOURNAL IS ON DISK BEFORE THE FIRST UPDATE: scripts/journals/backfill-furniture-material-<ts>.csv
 * (gitignored), one row per change — `id,old_attributes,new_attributes`, every string quoted, a NULL spelt
 * `\N` (Postgres COPY's spelling) so NULL and "" stay distinct. `--restore=<journal>` puts the old
 * attributes back on every row that STILL holds exactly what this wrote; a later edit wins there too.
 *
 * AFTER --apply: the chips count the new values at once (the feed reads `attributes` live). A baked PDP
 * shows its material in Details on its next render; `node scripts/purge-isr-listings.mjs` makes that now.
 * The furniture BANDS come from the nightly /api/cron/price-stats — and stay EMPTY while one shop holds
 * every comparable row, because a band needs FALLBACK_MIN_SELLERS (3) different sellers (owner, 2026-10-05:
 * keep that rule).
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { invokedDirectly } from '../src/lib/cli-entry'
import { FALLBACK_FACET } from '../src/lib/price-fallback'
import { MATERIAL_CATEGORY, MATERIAL_FACET, decideTitleMaterial, ownWordsTitle, type TitleMaterialDecision } from '../src/lib/furniture-material'

/** The furniture shelves whose fallback band is keyed on material — FALLBACK_FACET's own list, so the
 *  backfill and the band can never disagree about which shelves matter. */
export const MATERIAL_SHELVES: readonly string[] = Object.entries(FALLBACK_FACET)
  .filter(([shelf, facet]) => facet === MATERIAL_FACET && shelf.startsWith(`${MATERIAL_CATEGORY}/`))
  .map(([shelf]) => shelf.slice(MATERIAL_CATEGORY.length + 1))

/** $1 = the category slug, $2 = the shelves. `NOT LIKE '%"material"%'` is a pre-filter only: the decision
 *  (decideTitleMaterial, which parses the JSON) is what refuses a row that has a material. */
export const SELECT_SQL = `
  SELECT l.id, l."subcategorySlug", l.status, l.title, l."titleVi", l.attributes
  FROM "Listing" l
  JOIN "Category" c ON c.id = l."categoryId"
  JOIN "Seller" s ON s.id = l."sellerId"
  WHERE c.slug = $1 AND l."subcategorySlug" = ANY($2::text[])
    AND l.verified = true AND l.status IN ('active', 'sold')
    AND s."ownerId" IS NULL
    AND (l.attributes IS NULL OR l.attributes NOT LIKE '%"material"%')
  ORDER BY l.id`

/** The write: a compare-and-set on the attributes read, re-checking every selection rule — the shelf the
 *  material was decided for included. $1 id, $2 new, $3 old, $4 shelf, $5 category. */
export const UPDATE_SQL = `
  UPDATE "Listing" AS l SET attributes = $2
  WHERE l.id = $1 AND l.attributes IS NOT DISTINCT FROM $3
    AND l."subcategorySlug" = $4
    AND EXISTS (SELECT 1 FROM "Category" c WHERE c.id = l."categoryId" AND c.slug = $5)
    AND l.verified = true AND l.status IN ('active', 'sold')
    AND EXISTS (SELECT 1 FROM "Seller" s WHERE s.id = l."sellerId" AND s."ownerId" IS NULL)`

/** The restore: the old attributes back, only while the row holds exactly what the backfill wrote. $1 id, $2 old, $3 new. */
export const RESTORE_SQL = `UPDATE "Listing" SET attributes = $2 WHERE id = $1 AND attributes IS NOT DISTINCT FROM $3`

export type Row = { id: string; subcategorySlug: string; status: string; title: string; titleVi: string | null; attributes: string | null }
export type Change = { id: string; subcategorySlug: string; status: string; material: string; old: string | null; next: string; title: string }
type SkipWhy = Extract<TitleMaterialDecision, { write: false }>['why']

/** What the backfill would write — one decision per row, the importer's own (decideTitleMaterial). */
export function planChanges(rows: readonly Row[]): { changes: Change[]; skipped: Partial<Record<SkipWhy, number>> } {
  const changes: Change[] = []
  const skipped: Partial<Record<SkipWhy, number>> = {}
  for (const r of rows) {
    const title = ownWordsTitle(r)
    const d = decideTitleMaterial({ categorySlug: MATERIAL_CATEGORY, subcategorySlug: r.subcategorySlug, attributes: r.attributes, title })
    if (!d.write) { skipped[d.why] = (skipped[d.why] ?? 0) + 1; continue }
    changes.push({ id: r.id, subcategorySlug: r.subcategorySlug, status: r.status, material: d.material, old: r.attributes, next: d.attributes, title })
  }
  return { changes, skipped }
}

/** `n` changes spread evenly over the list ordered by shelf, material and id — every group shows up. */
export function sampleChanges(changes: readonly Change[], n = 20): Change[] {
  const sorted = [...changes].sort((a, b) => a.subcategorySlug.localeCompare(b.subcategorySlug) || a.material.localeCompare(b.material) || a.id.localeCompare(b.id))
  if (sorted.length <= n) return sorted
  return Array.from({ length: n }, (_, k) => sorted[Math.floor((k * sorted.length) / n)])
}

// ── THE JOURNAL ───────────────────────────────────────────────────────────────────────────────────

export const JOURNAL_HEADER = 'id,old_attributes,new_attributes'
/** NULL in the journal — Postgres COPY's spelling. A JSON attributes text can never be it. */
const NULL_CELL = '\\N'

const quote = (v: string) => `"${v.replace(/"/g, '""')}"`

/** The journal text: a header, then one line per change. */
export function journalCsv(changes: readonly Pick<Change, 'id' | 'old' | 'next'>[]): string {
  return [JOURNAL_HEADER, ...changes.map((c) => [quote(c.id), c.old === null ? NULL_CELL : quote(c.old), quote(c.next)].join(','))].join('\n') + '\n'
}

type Cell = { value: string; quoted: boolean }

/** RFC 4180 records, keeping whether each cell was quoted (that is how \N is told from a string "\N"). */
function csvRecords(text: string): Cell[][] {
  const records: Cell[][] = []
  let record: Cell[] = []
  let cell = ''
  let quoted = false
  let inQuotes = false
  let started = false
  const endCell = () => { record.push({ value: cell, quoted }); cell = ''; quoted = false; started = false }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') inQuotes = false
      else cell += ch
    } else if (ch === '"' && !started) { inQuotes = true; quoted = true; started = true }
    else if (ch === ',') endCell()
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      endCell()
      records.push(record)
      record = []
    } else { cell += ch; started = true }
  }
  if (inQuotes) throw new Error('the journal ends inside a quoted cell — it is truncated')
  if (started || record.length) { endCell(); records.push(record) }
  return records.filter((r) => !(r.length === 1 && !r[0].quoted && r[0].value === ''))
}

export type JournalRow = { id: string; old: string | null; next: string }

/**
 * The journal's rows. ⛔ REFUSED WHOLE on anything that is not what this script writes: a wrong header,
 * a row without exactly three cells, an empty id, an old value that is neither `\N` nor quoted, or a new
 * value that is not a JSON object holding a string `material` — a restore driven by a file it does not
 * understand could write anything anywhere.
 */
export function parseJournal(text: string): JournalRow[] {
  const [head, ...records] = csvRecords(text)
  if (!head || head.map((c) => c.value).join(',') !== JOURNAL_HEADER) throw new Error(`not a backfill-furniture-material journal: the header is not "${JOURNAL_HEADER}"`)
  // ⛔ A DAMAGED OR HAND-EDITED JOURNAL IS REFUSED WHOLE (gate, 2026-10-05): a duplicate id would restore two
  // different states onto one row, and old attributes that are not a JSON object would be written back as-is.
  const seen = new Set<string>()
  return records.map((cells, k) => {
    const line = k + 2
    if (cells.length !== 3) throw new Error(`line ${line}: expected 3 cells, got ${cells.length}`)
    const [id, old, next] = cells
    if (!id.value) throw new Error(`line ${line}: empty id`)
    if (seen.has(id.value)) throw new Error(`line ${line}: duplicate id ${id.value}`)
    seen.add(id.value)
    if (!old.quoted && old.value !== NULL_CELL) throw new Error(`line ${line}: the old attributes are neither quoted nor \\N`)
    if (!next.quoted) throw new Error(`line ${line}: the new attributes are not quoted`)
    if (old.quoted && old.value !== '') {
      let o: unknown
      try { o = JSON.parse(old.value) } catch { throw new Error(`line ${line}: the old attributes are not JSON`) }
      if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error(`line ${line}: the old attributes are not a JSON object`)
    }
    let parsed: unknown
    try { parsed = JSON.parse(next.value) } catch { throw new Error(`line ${line}: the new attributes are not JSON`) }
    const material = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>)[MATERIAL_FACET] : undefined
    if (typeof material !== 'string') throw new Error(`line ${line}: the new attributes carry no ${MATERIAL_FACET}`)
    return { id: id.value, old: old.quoted ? old.value : null, next: next.value }
  })
}

/** Writes the journal and forces it to disk — `wx`, so an existing file is never overwritten. */
export function writeJournal(path: string, changes: readonly Pick<Change, 'id' | 'old' | 'next'>[]): void {
  mkdirSync(dirname(path), { recursive: true })
  const fd = openSync(path, 'wx')
  try {
    writeSync(fd, journalCsv(changes))
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

// ── THE DATABASE HALF (a pg.Client; the tests hand in a mock) ──────────────────────────────────────

export type Queryable = { query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }> }

export async function selectRows(c: Queryable): Promise<Row[]> {
  const { rows } = await c.query(SELECT_SQL, [MATERIAL_CATEGORY, [...MATERIAL_SHELVES]])
  return rows as Row[]
}

/** The writes, 500 to a transaction. Returns how many rows changed; the rest changed under us and were skipped. */
export async function applyChanges(c: Queryable, changes: readonly Change[], batchSize = 500): Promise<number> {
  let written = 0
  for (let i = 0; i < changes.length; i += batchSize) {
    await c.query('BEGIN')
    try {
      for (const ch of changes.slice(i, i + batchSize)) {
        const r = await c.query(UPDATE_SQL, [ch.id, ch.next, ch.old, ch.subcategorySlug, MATERIAL_CATEGORY])
        written += r.rowCount ?? 0
      }
      await c.query('COMMIT')
    } catch (e) {
      await c.query('ROLLBACK')
      throw e
    }
  }
  return written
}

/** The whole --apply: the journal is written and synced, THEN the rows are. `onJournal` hears of the journal
 *  before the first write, so a run that dies mid-way has already said where its restore file is. */
export async function journalThenApply(c: Queryable, changes: readonly Change[], journalPath: string, onJournal?: (path: string) => void): Promise<{ journal: string; written: number }> {
  writeJournal(journalPath, changes)
  onJournal?.(journalPath)
  return { journal: journalPath, written: await applyChanges(c, changes) }
}

/**
 * The restore. A row is restorable only while its attributes are EXACTLY the journal's new value; the
 * write re-checks that in its own WHERE. Without `apply` it only counts (the caller's session is read-only).
 */
export async function restoreJournal(c: Queryable, rows: readonly JournalRow[], opts: { apply: boolean }): Promise<{ total: number; restorable: number; restored: number }> {
  const current = new Map<string, string | null>()
  for (let i = 0; i < rows.length; i += 1000) {
    const { rows: found } = await c.query(`SELECT id, attributes FROM "Listing" WHERE id = ANY($1::text[])`, [rows.slice(i, i + 1000).map((r) => r.id)])
    for (const f of found as { id: string; attributes: string | null }[]) current.set(f.id, f.attributes)
  }
  const restorable = rows.filter((r) => current.has(r.id) && current.get(r.id) === r.next)
  if (!opts.apply) return { total: rows.length, restorable: restorable.length, restored: 0 }
  let restored = 0
  for (let i = 0; i < restorable.length; i += 500) {
    await c.query('BEGIN')
    try {
      for (const r of restorable.slice(i, i + 500)) restored += (await c.query(RESTORE_SQL, [r.id, r.old, r.next])).rowCount ?? 0
      await c.query('COMMIT')
    } catch (e) {
      await c.query('ROLLBACK')
      throw e
    }
  }
  return { total: rows.length, restorable: restorable.length, restored }
}

// ── THE RUN ───────────────────────────────────────────────────────────────────────────────────────

const JOURNAL_DIR = join(dirname(fileURLToPath(import.meta.url)), 'journals')

/** `--restore=<path>` or `--restore <path>`; an error for a bare `--restore`. */
export function restoreArg(argv: readonly string[]): { path: string | null; error: string | null } {
  const i = argv.findIndex((a) => a === '--restore' || a.startsWith('--restore='))
  if (i < 0) return { path: null, error: null }
  const path = argv[i].startsWith('--restore=') ? argv[i].slice('--restore='.length) : argv[i + 1]
  return path && !path.startsWith('--') ? { path, error: null } : { path: null, error: '--restore needs the journal: --restore=scripts/journals/backfill-furniture-material-<ts>.csv' }
}

function report(rows: readonly Row[], changes: readonly Change[], skipped: Partial<Record<SkipWhy, number>>) {
  console.log(`${rows.length} row(s) read — verified, active|sold, ownerless storefronts, ${MATERIAL_CATEGORY}/{${MATERIAL_SHELVES.join(',')}}, no material yet`)
  console.log(`\n${changes.length} row(s) to write, per shelf × material:`)
  const tally = new Map<string, { active: number; sold: number }>()
  for (const c of changes) {
    const k = `${c.subcategorySlug}\t${c.material}`
    const t = tally.get(k) ?? { active: 0, sold: 0 }
    if (c.status === 'sold') t.sold++
    else t.active++
    tally.set(k, t)
  }
  console.log(`  ${'shelf'.padEnd(17)}${'material'.padEnd(15)}${'active'.padStart(7)}${'sold'.padStart(7)}${'total'.padStart(7)}`)
  for (const [k, t] of [...tally].sort(([a], [b]) => a.localeCompare(b))) {
    const [shelf, material] = k.split('\t')
    console.log(`  ${shelf.padEnd(17)}${material.padEnd(15)}${String(t.active).padStart(7)}${String(t.sold).padStart(7)}${String(t.active + t.sold).padStart(7)}`)
  }
  console.log(`\nleft without a material: ${Object.entries(skipped).map(([why, n]) => `${why} ${n}`).join(' · ') || 'none'}`)
  console.log(`\n${Math.min(20, changes.length)} samples (id · shelf · material · the title it was read from):`)
  for (const c of sampleChanges(changes)) console.log(`  ${c.id}  ${c.subcategorySlug.padEnd(16)} ${c.material.padEnd(14)} ${c.title.replace(/\s+/g, ' ').slice(0, 90)}`)
}

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!url) throw new Error('Set DIRECT_URL (or DATABASE_URL) — `set -a; . ./.env; set +a` first')
  const apply = process.argv.includes('--apply')
  const { path: restorePath, error } = restoreArg(process.argv)
  if (error) throw new Error(error)
  // A dry run cannot write: without --apply the session itself is read-only.
  const c = new pg.Client({ connectionString: url, ...(apply ? {} : { options: '-c default_transaction_read_only=on' }) })
  await c.connect()
  try {
    if (restorePath) {
      const rows = parseJournal(readFileSync(restorePath, 'utf8'))
      const r = await restoreJournal(c, rows, { apply })
      console.log(`${apply ? 'RESTORE — WRITES TO THE DATABASE' : 'RESTORE DRY RUN (read-only session)'}: ${restorePath}`)
      console.log(`  ${r.total} journaled · ${r.restorable} still hold exactly what the backfill wrote → restorable · ${r.total - r.restorable} changed since → left alone`)
      console.log(apply ? `RESTORED ${r.restored} row(s).` : '\nDRY RUN — nothing written. Re-run with --apply to restore.')
      return
    }
    const rows = await selectRows(c)
    const { changes, skipped } = planChanges(rows)
    console.log(`${apply ? 'APPLY — WRITES TO THE DATABASE' : 'DRY RUN (read-only session)'}\n`)
    report(rows, changes, skipped)
    if (!apply) {
      console.log(`\nDRY RUN — nothing written. To write: npx tsx scripts/backfill-furniture-material.ts --apply`)
      return
    }
    if (!changes.length) { console.log('\nnothing to write.'); return }
    const journal = join(JOURNAL_DIR, `backfill-furniture-material-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`)
    const out = await journalThenApply(c, changes, journal, (path) => {
      console.log(`\njournal: ${path} (${changes.length} rows, on disk before the first UPDATE)`)
      console.log(`RESTORE: npx tsx scripts/backfill-furniture-material.ts --restore=${path} [--apply]`)
    })
    console.log(`WROTE ${out.written} row(s); ${changes.length - out.written} skipped because they changed between the read and the write.`)
    console.log('NEXT (optional): node scripts/purge-isr-listings.mjs — baked listing pages show the material on their next render otherwise.')
  } finally {
    await c.end()
  }
}

// Imported by the unit test (src/lib/furniture-material-backfill.test.ts); only a direct run touches the database.
if (invokedDirectly(import.meta.url)) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
}
