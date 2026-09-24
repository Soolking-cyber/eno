/**
 * ONE-OFF: make the English text of rows ALREADY imported by the five property importers English,
 * and their Vietnamese text Vietnamese — the same change src/lib/import-i18n.ts now makes inside
 * each importer's compose step, applied once to what is stored.
 *
 *   set -a; . ./.env; set +a
 *   npx tsx scripts/localize-import-listings.ts                                   # DRY RUN (read-only session)
 *   npx tsx scripts/localize-import-listings.ts --missing-out <file.json>         # …and write the untranslated list
 *   npx tsx scripts/localize-import-listings.ts --apply --journal-dir <durable dir> [--limit N]
 *   npx tsx scripts/localize-import-listings.ts --rollback <journal.jsonl> [--apply]
 *
 * ⛔ SCOPE IS FIVE SELLERS, PINNED BY ID: Chợ Tốt Nhà, Muaban.net, Honeycomb House, Batdongsan.com.vn
 * and Rever.vn (LOCALIZE_SELLERS, each one also in src/lib/import-sellers.ts). Every read and every
 * write carries `sellerId IN (…those five)` in its WHERE, so a row of any other seller — a real
 * person's post, a partner feed — is never read or written.
 * ⚠️ TWO TEMPLATES. Batdongsan and Rever compose their text differently (one fact block with English
 * labels in BOTH languages), so their rows go through localizeReferenceImportText — the function their
 * importers' compose() now calls — and the other three through localizeImportText (localizerFor).
 *
 * ⛔ ONLY FIVE COLUMNS ARE WRITTEN: title, titleVi, description, descriptionVi, searchText. searchText
 * is re-derived by rebaseSearchText (import-i18n.ts): the folded title head is swapped for the
 * localized one, exactly what the importer now composes, so the next refresh of the row finds it
 * unchanged (measured on the 2026-09-24 staged files: 6,201 of 6,201 mapped rows identical; and on
 * the 2026-09-21 source files, 22,443 of 22,443 importer-kept Batdongsan rows and 3,554 of 3,554
 * priced Rever rows).
 *
 * ⛔ A WRITE IS JOURNALLED BEFORE IT HAPPENS. --apply refuses to start without --journal-dir on a
 * durable disk (not /tmp, /private/tmp, /var/folders or os.tmpdir(), symlinks resolved). Each batch of
 * 200 rows is appended to the JSONL journal — old AND new text per row — and fsynced before the batch's
 * transaction runs; after the batch commits, an OUTCOME line records which rows it really wrote.
 * `--rollback <journal>` replays it: a row gets its old text back only if it still holds EXACTLY the
 * text this run wrote, and never if the outcome says this run lost the race on it — so an importer
 * refresh that changed it since is not undone. ⚠️ WHAT TEXT CANNOT PROVE: an importer on this code
 * composes the SAME localized text, so a row it refreshed after the run looks written by the run and
 * is rolled back with the rest — which is what a rollback of the localization asks for, and that
 * importer's next refresh localizes it again. Rows with no recorded outcome (the run stopped between
 * a batch's commit and its outcome line) are counted apart in the dry run.
 *
 * ⛔ A ROW CHANGED SINCE IT WAS READ IS SKIPPED, NOT OVERWRITTEN: every update's WHERE also pins the
 * five old values (optimistic concurrency), so an importer refreshing the row mid-run wins and the
 * row is counted as `raced`.
 *
 * ⚠️ RUN IT AFTER THE IMPORTERS STOP, OR ONCE THEY RUN THIS CODE. An importer still running the old
 * mapper composes the old mixed text and its refresh would put it straight back.
 *
 * ⚠️ WHAT ELSE MOVES: `updatedAt` (Prisma's @updatedAt) on every row written — the text did change,
 * and these rows were created on 2026-09-24 anyway. The importers' first refresh on this code would
 * rewrite (and re-date) the same rows; after this one-off that refresh finds them unchanged. Cached listing pages do NOT change until they
 * re-render (ISR, 30 d); scripts/purge-isr-listings.mjs is the purge, and it is the owner's call.
 *
 * Idempotent: a second run finds nothing to change.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { invokedDirectly } from '../src/lib/cli-entry'
import { IMPORT_SELLERS } from '../src/lib/import-sellers'
import { NHATOT_SELLER_ID } from '../src/lib/nhatot-listing'
import { HONEYCOMB_SELLER_ID, journalDirProblem } from '../src/lib/honeycomb-listing'
import { SELLER_ID as MUABAN_SELLER_ID } from './muaban-net-map'
import { SELLER_ID as BATDONGSAN_SELLER_ID } from './import-batdongsan-rentals'
import { SELLER_ID as REVER_SELLER_ID } from './import-rever-rentals'
import { localizeImportText, localizeReferenceImportText, rebaseSearchText, type MissingSegment } from '../src/lib/import-i18n'

/** The five importers whose composed text import-i18n.ts localizes. Nothing else is in scope. */
export const LOCALIZE_SELLERS = [NHATOT_SELLER_ID, MUABAN_SELLER_ID, HONEYCOMB_SELLER_ID, BATDONGSAN_SELLER_ID, REVER_SELLER_ID] as const
/** The two whose importers compose the reference template (one fact block, English labels in both languages). */
export const REFERENCE_SELLERS: readonly string[] = [BATDONGSAN_SELLER_ID, REVER_SELLER_ID]
/** The function the seller's own importer now runs inside its compose step. */
export const localizerFor = (sellerId: string) => (REFERENCE_SELLERS.includes(sellerId) ? localizeReferenceImportText : localizeImportText)
export const BATCH = 200

export const TEXT_FIELDS = ['title', 'titleVi', 'description', 'descriptionVi', 'searchText'] as const
export type TextField = (typeof TEXT_FIELDS)[number]
export type TextFields = { title: string; titleVi: string | null; description: string; descriptionVi: string | null; searchText: string }
export type StoredRow = TextFields & { id: string; sellerId: string; externalId: string | null }
export type Plan = { id: string; sellerId: string; externalId: string | null; old: TextFields; next: TextFields; changed: TextField[]; missing: MissingSegment[] }

export const inScope = (sellerId: string) => (LOCALIZE_SELLERS as readonly string[]).includes(sellerId)
/** The WHERE fragment every read carries. */
export const scopeWhere = () => ({ sellerId: { in: [...LOCALIZE_SELLERS] } })
/**
 * The WHERE fragment every WRITE carries: this row, of the seller and externalId it was read with —
 * a row that moved between the five sellers since is not this row any more (codex, 2026-09-24) —
 * and that seller still one of the five.
 */
export const rowWhere = (r: { id: string; sellerId: string; externalId: string | null }) =>
  ({ id: r.id, externalId: r.externalId, sellerId: { equals: r.sellerId, in: [...LOCALIZE_SELLERS] } })

const pick = (r: TextFields): TextFields => ({ title: r.title, titleVi: r.titleVi, description: r.description, descriptionVi: r.descriptionVi, searchText: r.searchText })

/**
 * What one stored row would become. ⛔ A row of any other seller gets NO plan — refused here as well
 * as by the WHERE, so a widened query can still never produce a write for it.
 */
export function planRow(row: StoredRow): Plan | null {
  if (!inScope(row.sellerId)) return null
  const old = pick(row)
  const loc = localizerFor(row.sellerId)({ title: old.title, titleVi: old.titleVi, description: old.description, descriptionVi: old.descriptionVi })
  const next: TextFields = {
    title: loc.title, titleVi: loc.titleVi, description: loc.description, descriptionVi: loc.descriptionVi,
    searchText: rebaseSearchText(old.searchText, old, loc),
  }
  const changed = TEXT_FIELDS.filter((k) => old[k] !== next[k])
  return { id: row.id, sellerId: row.sellerId, externalId: row.externalId, old, next, changed, missing: loc.missing }
}

/** Written BEFORE a batch: the intent, with the old text to restore. */
export type JournalLine = { v: 1; id: string; sellerId: string; externalId: string | null; old: TextFields; new: TextFields }
export const journalLine = (p: Plan): JournalLine => ({ v: 1, id: p.id, sellerId: p.sellerId, externalId: p.externalId, old: p.old, new: p.next })
/**
 * Written AFTER a batch commits: which of its rows this run actually wrote, and which lost a race.
 * ⚠️ WITHOUT IT, "the row now holds exactly the new text" was the only evidence — and an importer on
 * the new code writes exactly that text, so a rollback would have undone the importer's own write
 * for a row this run never touched (agy + codex, 2026-09-24).
 */
export type JournalOutcome = { v: 1; outcome: { applied: string[]; raced: string[] } }
export const journalOutcome = (applied: string[], raced: string[]): JournalOutcome => ({ v: 1, outcome: { applied, raced } })
export type ParsedJournal = { lines: JournalLine[]; applied: Set<string>; raced: Set<string>; torn?: boolean }

/** Read a journal back, refusing anything that is not a line this script wrote for an in-scope seller. */
export function parseJournal(text: string): ParsedJournal {
  const isText = (o: unknown): o is TextFields => {
    const t = o as Record<string, unknown>
    return !!t && typeof t === 'object' && typeof t.title === 'string' && typeof t.description === 'string' && typeof t.searchText === 'string'
      && (t.titleVi === null || typeof t.titleVi === 'string') && (t.descriptionVi === null || typeof t.descriptionVi === 'string')
  }
  const ids = new Set<string>()
  const out: ParsedJournal = { lines: [], applied: new Set(), raced: new Set() }
  const isIds = (a: unknown): a is string[] => Array.isArray(a) && a.every((x) => typeof x === 'string')
  const segments = text.split('\n')
  /**
   * Every append ends in a newline, so a crash mid-append leaves a TORN last segment with none. It is
   * dropped, not fatal (codex): a torn intent means its batch's transaction never started (it runs only
   * after the append returns); a torn outcome leaves that batch's rows 'unconfirmed', still decided by
   * their text. A torn line anywhere else is corruption and refuses the journal as before.
   */
  if (!text.endsWith('\n') && segments.length && segments[segments.length - 1].trim()) {
    try { JSON.parse(segments[segments.length - 1]) } catch { segments.pop(); out.torn = true }
  }
  segments.forEach((l, i) => {
    if (!l.trim()) return
    const j = JSON.parse(l) as JournalLine & Partial<JournalOutcome>
    if (j?.v === 1 && j.outcome !== undefined) {
      const { applied, raced } = j.outcome ?? {}
      if (!isIds(applied) || !isIds(raced)) throw new Error(`journal line ${i + 1} is not a localize-import-listings outcome`)
      const named = new Set<string>()
      for (const id of [...applied, ...raced]) {
        /** An outcome names only rows journalled BEFORE it, each once across all outcomes. */
        if (!ids.has(id) || named.has(id) || out.applied.has(id) || out.raced.has(id)) throw new Error(`journal line ${i + 1} reports row ${id}, which no earlier line journalled once — refusing the whole journal`)
        named.add(id)
      }
      applied.forEach((id) => out.applied.add(id))
      raced.forEach((id) => out.raced.add(id))
      return
    }
    if (j?.v !== 1 || typeof j.id !== 'string' || typeof j.sellerId !== 'string' || !(j.externalId === null || typeof j.externalId === 'string')
      || !isText(j.old) || !isText(j.new)) throw new Error(`journal line ${i + 1} is not a localize-import-listings line`)
    if (!inScope(j.sellerId)) throw new Error(`journal line ${i + 1} names seller ${j.sellerId}, which this script never writes — refusing the whole journal`)
    /** One run journals a row once; a repeated id means files were concatenated or edited — refuse. */
    if (ids.has(j.id)) throw new Error(`journal line ${i + 1} repeats row ${j.id} — refusing the whole journal`)
    ids.add(j.id)
    out.lines.push(j)
  })
  return out
}

/** Does the row still hold exactly what this run wrote? */
export const stillAsWritten = (current: TextFields, line: JournalLine) => TEXT_FIELDS.every((k) => current[k] === line.new[k])

/**
 * What the rollback does with one journalled row:
 *  - 'raced'        — the run's outcome says it never wrote this row: left alone, whatever it holds now;
 *  - 'gone'         — no such row of that seller and externalId any more;
 *  - 'changedSince' — it no longer holds the run's text (an importer refreshed it): left alone;
 *  - 'restore'      — the run wrote it and it still holds that text;
 *  - 'unconfirmed'  — it holds the run's text but no outcome was recorded (the run stopped between a
 *                     batch's commit and its outcome line — or before the commit, and an importer has
 *                     since written the same text): restored like 'restore', counted apart. See the
 *                     header: identical text is the one thing a rollback cannot tell apart.
 */
export function rollbackDecision(line: JournalLine, current: (TextFields & { sellerId: string; externalId: string | null }) | undefined, j: ParsedJournal):
  'raced' | 'gone' | 'changedSince' | 'restore' | 'unconfirmed' {
  if (j.raced.has(line.id)) return 'raced'
  if (!current || current.sellerId !== line.sellerId || current.externalId !== line.externalId) return 'gone'
  if (!stillAsWritten(current, line)) return 'changedSince'
  return j.applied.has(line.id) ? 'restore' : 'unconfirmed'
}

export type Args = { apply: boolean; journalDir: string | null; rollback: string | null; limit: number | null; missingOut: string | null; samples: number }
/** ⛔ Anything it cannot read exactly is refused — a typo must never turn into a different run. */
export function parseArgs(argv: readonly string[]): Args {
  const valued = new Set(['--journal-dir', '--rollback', '--limit', '--missing-out', '--samples'])
  const a: Args = { apply: false, journalDir: null, rollback: null, limit: null, missingOut: null, samples: 10 }
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i]
    if (f === '--apply') { a.apply = true; continue }
    if (!valued.has(f)) throw new Error(`unknown argument "${f}"`)
    const v = argv[++i]
    if (v === undefined || v.startsWith('--')) throw new Error(`${f} needs a value`)
    if (f === '--journal-dir') a.journalDir = v
    else if (f === '--rollback') a.rollback = v
    else if (f === '--missing-out') a.missingOut = v
    else {
      if (!/^[1-9]\d{0,6}$/.test(v)) throw new Error(`${f} must be a positive whole number, got "${v}"`)
      if (f === '--limit') a.limit = Number(v)
      else a.samples = Number(v)
    }
  }
  if (a.rollback && a.journalDir) throw new Error('--rollback replays an existing journal; --journal-dir is for --apply')
  if (a.rollback && a.limit) throw new Error('--rollback replays the whole journal; --limit is for --apply')
  if (a.apply && !a.rollback && !a.journalDir) throw new Error('--apply needs --journal-dir <durable dir>: the journal of the old text is written before every batch')
  return a
}

/** POSIX single-quoting, so a journal path with a space or a `$` is one argument when pasted (codex). */
export const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
export const rollbackCommand = (journal: string) =>
  `set -a; . ./.env; set +a; npx tsx scripts/localize-import-listings.ts --rollback ${shellQuote(journal)}           # dry run first\n` +
  `set -a; . ./.env; set +a; npx tsx scripts/localize-import-listings.ts --rollback ${shellQuote(journal)} --apply`

/** The folded count of each untranslated segment across all rows, most frequent first. */
export function missingReport(plans: readonly Plan[]): (MissingSegment & { n: number })[] {
  const m = new Map<string, MissingSegment & { n: number }>()
  for (const p of plans) for (const s of p.missing) {
    const k = `${s.target}\u0000${s.kind}\u0000${s.src}`
    const e = m.get(k)
    if (e) e.n++
    else m.set(k, { ...s, n: 1 })
  }
  return [...m.values()].sort((a, b) => b.n - a.n || a.kind.localeCompare(b.kind) || a.src.localeCompare(b.src))
}

/** Up to `n` changed rows, taken round-robin across the sellers so every importer is shown. */
export function pickSamples(plans: readonly Plan[], n: number): Plan[] {
  const by = LOCALIZE_SELLERS.map((s) => plans.filter((p) => p.sellerId === s && p.changed.length))
  const out: Plan[] = []
  for (let i = 0; out.length < n && by.some((b) => i < b.length); i++) for (const b of by) if (i < b.length && out.length < n) out.push(b[i])
  return out
}

// ─── I/O ───────────────────────────────────────────────────────────────────────────────────────

function durableJournalDir(dir: string): string {
  const abs = resolve(dir)
  const roots = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', tmpdir()]
  for (const r of [...roots]) { try { roots.push(realpathSync(r)) } catch { /* the plain path is still checked */ } }
  let problem = journalDirProblem(abs, roots)
  if (!problem) {
    mkdirSync(abs, { recursive: true })
    /** A symlink into /tmp is still /tmp. */
    problem = journalDirProblem(realpathSync(abs), roots)
  }
  if (problem) throw new Error(problem)
  const probe = join(abs, `.localize-journal-probe-${process.pid}`)
  appendDurably(probe, ['ok'])
  unlinkSync(probe)
  return abs
}

/**
 * Append lines and fsync the file — and, the first time THIS file is written, its directory entry, so
 * a power loss cannot keep the database writes and lose the file that undoes them (Linux; macOS
 * refuses fsync on a directory). ⚠️ PER FILE: a process-wide flag was set by the journal-dir PROBE,
 * so the real journal's directory entry was never synced (agy + codex + opus, 2026-09-24).
 */
const dirSynced = new Set<string>()
function appendDurably(file: string, lines: string[]) {
  const buf = Buffer.from(lines.map((l) => l + '\n').join(''), 'utf8')
  const fd = openSync(file, 'a')
  try {
    /** writeSync may write less than asked; loop until every byte is down (codex). */
    for (let off = 0; off < buf.length;) off += writeSync(fd, buf, off, buf.length - off)
    fsyncSync(fd)
  } finally { closeSync(fd) }
  if (!dirSynced.has(file)) {
    try { const d = openSync(resolve(file, '..'), 'r'); try { fsyncSync(d) } finally { closeSync(d) } } catch (e) { if (process.platform === 'linux') throw e }
    dirSynced.add(file)
  }
}

const clip = (s: string | null, n = 160) => (s === null ? '(null)' : s.length > n ? `${s.slice(0, n)}…` : s)

function printSample(p: Plan, i: number, of: number) {
  console.log(`\n── sample ${i}/${of} · ${p.sellerId} · ${p.id}${p.externalId ? ` (${p.externalId})` : ''} · changes ${p.changed.join(', ')}`)
  for (const k of ['title', 'titleVi'] as const) {
    if (p.old[k] !== p.next[k]) console.log(`  ${k.padEnd(13)} ${p.old[k]}\n  ${''.padEnd(13)} → ${p.next[k]}`)
  }
  for (const k of ['description', 'descriptionVi'] as const) {
    const a = (p.old[k] ?? '').split('\n'), b = (p.next[k] ?? '').split('\n')
    a.forEach((line, j) => { if (line !== b[j]) console.log(`  ${k.padEnd(13)} ${line}\n  ${''.padEnd(13)} → ${b[j]}`) })
  }
  if (p.old.searchText !== p.next.searchText) console.log(`  ${'searchText'.padEnd(13)} ${clip(p.old.searchText)}\n  ${''.padEnd(13)} → ${clip(p.next.searchText)}`)
}

async function openDb(write: boolean) {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('DIRECT_URL / DATABASE_URL unset — `set -a; . ./.env; set +a` first')
  const { PrismaClient } = await import('../src/generated/prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  /** ⛔ A DRY RUN IS READ-ONLY AT THE DATABASE, not only by intent: every transaction it opens is
   *  read-only, so a bug that reached a write would be refused by Postgres. Checked, not assumed. */
  const db = new PrismaClient({
    adapter: new PrismaPg(write ? { connectionString } : { connectionString, options: '-c default_transaction_read_only=on' }),
    log: ['warn', 'error'],
    // ⛔ A batch of BATCH updates is ONE transaction, and with a driver adapter even the array form of
    // $transaction runs as an interactive one — under Prisma's 5 s default. Through the SSH tunnel a
    // 200-row batch took 5.1 s (measured 2026-09-24, first production apply): every batch expired and
    // rolled back, nothing was written. The journal line is fsynced first, so a timeout is safe but
    // useless; give the batch room instead.
    transactionOptions: { timeout: 120_000, maxWait: 30_000 },
  })
  if (!write) {
    const ro = await db.$queryRawUnsafe<{ default_transaction_read_only: string }[]>('SHOW default_transaction_read_only')
    if (ro[0]?.default_transaction_read_only !== 'on') throw new Error(`dry run expected a read-only session, got default_transaction_read_only=${ro[0]?.default_transaction_read_only}`)
  }
  return db
}
type Db = Awaited<ReturnType<typeof openDb>>

const SELECT = { id: true, sellerId: true, externalId: true, title: true, titleVi: true, description: true, descriptionVi: true, searchText: true } as const

async function readAll(db: Db): Promise<{ plans: Plan[]; rows: Map<string, number> }> {
  const plans: Plan[] = []
  const rows = new Map<string, number>()
  let after: string | null = null
  for (;;) {
    const page: StoredRow[] = await db.listing.findMany({
      where: { ...scopeWhere(), ...(after ? { id: { gt: after } } : {}) },
      select: SELECT, orderBy: { id: 'asc' }, take: 1000,
    })
    if (!page.length) break
    for (const r of page) {
      rows.set(r.sellerId, (rows.get(r.sellerId) ?? 0) + 1)
      const p = planRow(r)
      if (p && (p.changed.length || p.missing.length)) plans.push(p)
    }
    after = page[page.length - 1].id
  }
  return { plans, rows }
}

async function localize(args: Args) {
  /** ⛔ FIRST, before the database is opened: a bad journal dir refuses the run with nothing done. */
  const journalDir = args.apply ? durableJournalDir(args.journalDir!) : null
  for (const s of LOCALIZE_SELLERS) if (!(IMPORT_SELLERS as readonly string[]).includes(s)) throw new Error(`${s} is not in src/lib/import-sellers.ts — refusing`)

  const db = await openDb(args.apply)
  try {
    const { plans, rows } = await readAll(db)
    const changing = plans.filter((p) => p.changed.length)
    console.log(`mode              ${args.apply ? 'APPLY — WRITES TO THE DATABASE' : 'DRY RUN (read-only session, verified)'}`)
    console.log(`sellers           ${LOCALIZE_SELLERS.join(', ')}`)
    for (const s of LOCALIZE_SELLERS) {
      const mine = changing.filter((p) => p.sellerId === s)
      const byField = Object.fromEntries(TEXT_FIELDS.map((k) => [k, mine.filter((p) => p.changed.includes(k)).length]))
      const withMissing = plans.filter((p) => p.sellerId === s && p.missing.length).length
      console.log(`  ${s.padEnd(32)} rows ${String(rows.get(s) ?? 0).padStart(6)} · would change ${String(mine.length).padStart(6)} · unchanged ${String((rows.get(s) ?? 0) - mine.length).padStart(6)} · with untranslated segments ${withMissing}`)
      console.log(`  ${''.padEnd(32)} by field ${JSON.stringify(byField)}`)
    }
    const total = [...rows.values()].reduce((a, b) => a + b, 0)
    console.log(`TOTAL             ${total} rows · ${changing.length} would change · ${total - changing.length} unchanged`)

    const samples = pickSamples(plans, args.samples)
    samples.forEach((p, i) => printSample(p, i + 1, samples.length))

    const missing = missingReport(plans)
    console.log(`\nuntranslated      ${missing.length} distinct segments with no reviewed translation (left exactly as they are)`)
    for (const m of missing.slice(0, 60)) console.log(`  ${String(m.n).padStart(5)}  ${m.target} ${m.kind.padEnd(20)} ${m.src}`)
    if (missing.length > 60) console.log(`  … ${missing.length - 60} more${args.missingOut ? '' : ' — pass --missing-out <file.json> for the full list'}`)
    if (args.missingOut) {
      writeFileSync(args.missingOut, JSON.stringify(missing.map(({ src, target, kind, n }) => ({ src, target, kind, n })), null, 1) + '\n')
      console.log(`  full list → ${resolve(args.missingOut)} (dictionary item shape: src, target, kind, n)`)
    }

    if (!args.apply) {
      console.log(`\nDRY RUN — nothing written. To apply (after the importers have stopped or run this code):`)
      console.log(`  set -a; . ./.env; set +a; npx tsx scripts/localize-import-listings.ts --apply --journal-dir <durable dir>`)
      return
    }

    const todo = args.limit ? changing.slice(0, args.limit) : changing
    if (!todo.length) { console.log('\nAPPLY            nothing to change — no journal written, nothing to roll back'); return }
    const journal = join(journalDir!, `localize-import-listings-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`)
    console.log(`\njournal           ${journal}`)
    console.log(`ROLLBACK (replays the journal; restores rows still holding this run's text, never one it lost the race on):\n${rollbackCommand(journal)}\n`)
    const stat = { updated: 0, raced: 0, batches: 0 }
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH)
      /** ⛔ The old text is on disk, fsynced, BEFORE the batch's first write. */
      appendDurably(journal, batch.map((p) => JSON.stringify(journalLine(p))))
      const res = await db.$transaction(batch.map((p) => db.listing.updateMany({
        /** This row, of its seller, in scope, AND still exactly what was read — an importer refresh since wins. */
        where: { ...rowWhere(p), ...p.old },
        data: p.next,
      })))
      const applied = batch.filter((_, k) => res[k].count === 1).map((p) => p.id)
      const raced = batch.filter((_, k) => res[k].count !== 1).map((p) => p.id)
      /** ⛔ Which rows this run really wrote, durably, before the next batch: the rollback trusts this. */
      appendDurably(journal, [JSON.stringify(journalOutcome(applied, raced))])
      stat.updated += applied.length
      stat.raced += raced.length
      stat.batches++
      if (stat.batches % 10 === 0) console.log(`  … ${Math.min(i + BATCH, todo.length)}/${todo.length}`)
    }
    console.log(`APPLIED           updated ${stat.updated} · raced (changed since read, left alone) ${stat.raced} · batches ${stat.batches} of ≤${BATCH}`)
    console.log(`ROLLBACK:\n${rollbackCommand(journal)}`)
    console.log(`\n⚠️ CACHED PAGES: a listing page already rendered keeps the old text for its ISR window (30 d) — the`)
    console.log(`  importers do not revalidate either. Purging is the owner's call: scripts/purge-isr-listings.mjs`)
    console.log(`  (read its header: it only works where ENO_ISR_PG=1).`)
  } finally {
    await db.$disconnect()
  }
}

async function rollback(args: Args) {
  const journal = parseJournal(readFileSync(args.rollback!, 'utf8'))
  const { lines } = journal
  const db = await openDb(args.apply)
  try {
    const stat = { restore: 0, unconfirmed: 0, raced: 0, changedSince: 0, gone: 0, restored: 0, racedNow: 0 }
    const todo: JournalLine[] = []
    for (let i = 0; i < lines.length; i += 1000) {
      const chunk = lines.slice(i, i + 1000)
      const current = new Map((await db.listing.findMany({ where: { id: { in: chunk.map((l) => l.id) }, ...scopeWhere() }, select: SELECT })).map((r) => [r.id, r]))
      for (const l of chunk) {
        const d = rollbackDecision(l, current.get(l.id), journal)
        stat[d]++
        if (d === 'restore' || d === 'unconfirmed') todo.push(l)
      }
    }
    console.log(`mode              ${args.apply ? 'APPLY — WRITES TO THE DATABASE' : 'DRY RUN (read-only session, verified)'}`)
    console.log(`journal           ${resolve(args.rollback!)} · ${lines.length} rows journalled · outcome recorded for ${journal.applied.size + journal.raced.size}${journal.torn ? ' · a torn last line (a crash mid-append) was dropped' : ''}`)
    console.log(`to restore        ${stat.restore}${stat.unconfirmed ? ` + ${stat.unconfirmed} with no recorded outcome (the run stopped mid-batch; they hold its text)` : ''}`)
    console.log(`left alone        never written by the run ${stat.raced} · changed since ${stat.changedSince} · gone ${stat.gone}`)
    if (!args.apply) { console.log('\nDRY RUN — nothing written. Re-run with --apply to restore.'); return }
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH)
      const res = await db.$transaction(batch.map((l) => db.listing.updateMany({ where: { ...rowWhere(l), ...l.new }, data: l.old })))
      for (const r of res) { if (r.count === 1) stat.restored++; else stat.racedNow++ }
    }
    console.log(`RESTORED          ${stat.restored} · changed during the rollback (left alone) ${stat.racedNow}`)
  } finally {
    await db.$disconnect()
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.rollback) await rollback(args)
  else await localize(args)
}

/** Run only when executed — the pure half above is imported by the unit test (real paths: src/lib/cli-entry.ts). */
if (invokedDirectly(import.meta.url)) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
}
