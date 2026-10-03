import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { HideDb, HideJournal } from './journaled-hide'
import { isUsedTitle } from './used-signal'

/**
 * ── RETIRING NEW-GOODS CATALOGUES (second-hand focus, owner 2026-10-03) ──────────────────────────────
 *
 * Owner: "remove tiki and cellphones products from the app, we will have tight focus on second hand
 * stores and rentals plus job postings" → "yes correct all that are second hand we need the listings".
 * The rule below is the one that ran on 2026-10-03 (journal new-goods-hide-20261003T040816Z.csv, 68,250
 * rows, raw SQL) made into code: scripts/retire-new-retail.ts runs it — dry by default — to catch rows
 * that leak back in, and rolls back any of the three journals that day wrote. Pure where it can be; the
 * database half takes the same minimal `$queryRawUnsafe` surface journaled-hide.ts does.
 *
 * ⛔ WHAT IS NEVER A CANDIDATE, AND WHY EACH IS A SEPARATE CHECK (in the SQL AND re-checked in `retireVerdict`):
 *   · an OWNED storefront — a person's shop; and `hidden` on their post would be an unannounced takedown
 *     they could undo in one click (journaled-hide.ts says the same, and its SQL refuses them too);
 *   · a row that is not an IMPORT (no externalId, no affiliateUrl);
 *   · any listingType but `sell` — rentals, jobs, services (the carrier eSIMs are `service`), wholesale;
 *   · a protected category — rentals, jobs, teachers, tickets-travel (VinWonders' 17 tickets are
 *     `sell` with no condition: a naive "ownerless, sell, not used" rule hides them);
 *   · condition `used`;
 *   · a KEEP shop — second-hand shops whose rows carry no condition (pinned by id, never by name:
 *     Seller.name is user-settable);
 *   · in a MIXED shop (new and used stock), a row whose own words say used (src/lib/used-signal.ts).
 */

/** Never retired, whatever the row says. */
export const RETIRE_PROTECTED_CATEGORIES: readonly string[] = ['rentals', 'jobs', 'teachers', 'tickets-travel']

/** Ownerless shops kept whole — measured 2026-10-03, every one second-hand stock or tickets. Pinned by id. */
export const RETIRE_KEEP_SELLERS: ReadonlyMap<string, string> = new Map([
  ['cmtseuzyf00069zq4ssl2nnvk', 'VN Laptop — used workstations ("xách tay Nhật"), many with no condition recorded'],
  ['cmtseuzt100049zq4qj6dgpo1', 'Laptop Giá Rẻ — older generation laptops, many with no condition recorded'],
  ['cmtr9qva90000glq44fkjs18b', 'Điện Thoại Vui — a used-phone shop (137 of 152 titled "Cũ"); the AccessTrade import wrote \'new\' on all'],
  ['cmt6v9x4o00004fq4v6qokman', 'VinWonders — attraction tickets (belt-and-braces with the tickets-travel category)'],
])

/** Ownerless shops selling new AND used: only rows whose own title or URL says used are kept. Pinned by id. */
export const RETIRE_MIXED_SHOPS: ReadonlyMap<string, string> = new Map([
  ['cmt78nvif0000gpq48kvzmxjw', 'CellphoneS — its "cũ" shelf (used, ex-display, warranty-exchange units) is kept'],
  ['cmtw4s5h000000iqlqtxmk3j0', 'Bạch Long Store — used iPhones ("cũ", "Pin 100", "CPO") kept'],
  ['cmtvfh3jm00000imkn1r515do', 'Điện Thoại Giá Kho — "Cũ 99%", "Likenew", "Máy Đẹp" kept'],
])

export type RetireRow = {
  id: string
  status: string
  updatedAt: string
  sellerId: string
  seller: string
  ownerId: string | null
  category: string
  listingType: string
  condition: string | null
  title: string
  titleVi: string | null
  affiliateUrl: string | null
  externalId: string | null
}

/**
 * The STRUCTURAL selection — every filter except "a mixed shop's row says used", which is decided in JS
 * (used-signal.ts has the only implementation of that test; see its header for why there is no SQL twin).
 * $1 = protected category slugs, $2 = KEEP seller ids. No `verified` filter, as on 2026-10-03: an
 * unverified import is not public, and hiding it too costs nothing.
 */
export const RETIRE_SELECT_SQL =
  `SELECT l.id, l.status, l."updatedAt"::text AS "updatedAt", l."sellerId", s.name AS seller, s."ownerId", ` +
  `c.slug AS category, l."listingType", l.condition, l.title, l."titleVi", l."affiliateUrl", l."externalId" ` +
  `FROM "Listing" l JOIN "Seller" s ON s.id = l."sellerId" JOIN "Category" c ON c.id = l."categoryId" ` +
  `WHERE l.status IN ('active','sold') ` +
  `AND s."ownerId" IS NULL ` +
  `AND (l."externalId" IS NOT NULL OR l."affiliateUrl" IS NOT NULL) ` +
  `AND l."listingType" = 'sell' ` +
  `AND c.slug <> ALL($1::text[]) ` +
  `AND l.condition IS DISTINCT FROM 'used' ` +
  `AND l."sellerId" <> ALL($2::text[]) ` +
  `ORDER BY l.id`

export const retireSelectArgs = (): [string[], string[]] => [[...RETIRE_PROTECTED_CATEGORIES], [...RETIRE_KEEP_SELLERS.keys()]]

/** The rule, row by row — the SQL's every clause restated, plus the mixed-shop used test. */
export function retireVerdict(row: Pick<RetireRow, 'status' | 'ownerId' | 'externalId' | 'affiliateUrl' | 'listingType' | 'category' | 'condition' | 'sellerId' | 'title' | 'titleVi'>): { retire: boolean; why: string } {
  if (row.status !== 'active' && row.status !== 'sold') return { retire: false, why: `not live (${row.status})` }
  if (row.ownerId) return { retire: false, why: 'owned storefront' }
  if (!row.externalId && !row.affiliateUrl) return { retire: false, why: 'not an imported row' }
  if (row.listingType !== 'sell') return { retire: false, why: `listingType ${row.listingType}` }
  if (RETIRE_PROTECTED_CATEGORIES.includes(row.category)) return { retire: false, why: `protected category ${row.category}` }
  if (row.condition === 'used') return { retire: false, why: 'condition used' }
  if (RETIRE_KEEP_SELLERS.has(row.sellerId)) return { retire: false, why: 'kept shop' }
  if (RETIRE_MIXED_SHOPS.has(row.sellerId) && isUsedTitle(row.title, row.titleVi, row.affiliateUrl)) {
    return { retire: false, why: 'mixed shop — the listing says used' }
  }
  return { retire: true, why: row.condition ? `condition ${row.condition}` : 'no condition recorded' }
}

export const isRetireCandidate = (row: Parameters<typeof retireVerdict>[0]): boolean => retireVerdict(row).retire

// ── the reviewed id list: the dry run writes it, --apply hides exactly it ─────────────────────────────

/** Sorted, de-duplicated, one id per line. The digest is over exactly these bytes. */
export function formatIdsFile(ids: Iterable<string>): string {
  const sorted = [...new Set(ids)].sort()
  return sorted.length ? `${sorted.join('\n')}\n` : ''
}

export function parseIdsFile(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')))].sort()
}

export const idsDigest = (ids: Iterable<string>): string => createHash('sha256').update(formatIdsFile(ids)).digest('hex')

/**
 * ⛔ --apply HIDES THE REVIEWED SET OR NOTHING. A tolerance ("within 1% of the dry run") lets a run hide
 * rows nobody looked at — an import landing between the dry run and the apply (review, 2026-10-03). Any
 * difference refuses; re-run the dry run, read it, and pass its new list.
 */
export function compareIdSets(reviewed: Iterable<string>, fresh: Iterable<string>): { missing: string[]; extra: string[] } {
  const a = new Set(reviewed)
  const b = new Set(fresh)
  return { missing: [...a].filter((x) => !b.has(x)).sort(), extra: [...b].filter((x) => !a.has(x)).sort() }
}

// ── journals: the three written on 2026-10-02/03 by psql, and this script's own JSON ──────────────────

const PRIOR = new Set(['active', 'sold'])

/**
 * When a journal was written, from its file name: `…-20261003T040816Z.csv` (the psql journals) or
 * `…-2026-10-01T10-26-35-364Z.json` (the scripts'). Null when the name carries neither.
 */
export function createdAtFromFilename(path: string): Date | null {
  const name = basename(path)
  const compact = name.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/)
  if (compact) {
    const [, y, mo, d, h, mi, s] = compact
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
  }
  const dashed = name.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/)
  if (dashed) {
    const [, y, mo, d, h, mi, s, ms] = dashed
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, +ms))
  }
  return null
}

/** One CSV line → fields, honouring double quotes (psql's `\copy … csv` quotes an empty string as ""). */
function csvFields(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

export type IdPriorRow = { id: string; prior: string }

/**
 * `id,prior` — new-goods-hide-…csv and supersports-hide-…csv. ⛔ REFUSED WHOLE on any prior other than
 * active|sold: the hide only ever took live rows, so anything else means the file is not what it claims.
 */
export function parseIdPriorCsv(text: string): IdPriorRow[] {
  const rows: IdPriorRow[] = []
  for (const [n, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    const f = csvFields(line)
    if (f.length !== 2 || !f[0]) throw new Error(`line ${n + 1}: expected "id,prior", got ${JSON.stringify(line.slice(0, 80))}`)
    if (!PRIOR.has(f[1])) throw new Error(`line ${n + 1}: prior status ${JSON.stringify(f[1])} is not active|sold — refusing the whole journal`)
    rows.push({ id: f[0], prior: f[1] })
  }
  return rows
}

export type ConditionFixAction = 'restore_used' | 'label_used' | 'hide_new'
export type ConditionFixRow = { id: string; status: string; cond: string; prior: string; action: ConditionFixAction }

/**
 * `id,status,cond,prior,action` — used-condition-fix-…csv, as written by the 04:21 psql run: `status` and
 * `cond` are the row's values BEFORE the fix ('' = NULL condition), `prior` the 04:08 journal's status
 * for a `restore_used` row.
 */
export function parseConditionFixCsv(text: string): ConditionFixRow[] {
  const rows: ConditionFixRow[] = []
  for (const [n, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    const f = csvFields(line)
    if (f.length !== 5 || !f[0]) throw new Error(`line ${n + 1}: expected "id,status,cond,prior,action"`)
    const [id, status, cond, prior, action] = f
    if (action !== 'restore_used' && action !== 'label_used' && action !== 'hide_new') throw new Error(`line ${n + 1}: unknown action ${JSON.stringify(action)}`)
    if (action === 'restore_used' && (status !== 'hidden' || !PRIOR.has(prior))) throw new Error(`line ${n + 1}: restore_used row must be hidden with an active|sold prior`)
    if (action === 'hide_new' && !PRIOR.has(status)) throw new Error(`line ${n + 1}: hide_new row must have been active|sold`)
    rows.push({ id, status, cond, prior, action })
  }
  return rows
}

export type JournalFormat = 'retire-json' | 'id-prior-csv' | 'condition-fix-csv' | 'other-json' | 'unknown'

/** What a journal file is, from its contents — never from its name alone. */
export function journalFormat(text: string): JournalFormat {
  const t = text.trimStart()
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t) as { kind?: unknown; rows?: unknown }
      if (j.kind === 'retire-new-retail' && Array.isArray(j.rows)) return 'retire-json'
      return Array.isArray(j.rows) ? 'other-json' : 'unknown'
    } catch { return 'unknown' }
  }
  const first = t.split(/\r?\n/, 1)[0] ?? ''
  const n = csvFields(first).length
  return n === 2 ? 'id-prior-csv' : n === 5 ? 'condition-fix-csv' : 'unknown'
}

/** Every listing id a journal file names, whatever its format; null for a file that is not a journal. */
export function journalIds(text: string): string[] | null {
  switch (journalFormat(text)) {
    case 'retire-json':
    case 'other-json':
      return ((JSON.parse(text) as { rows: { id?: unknown }[] }).rows ?? []).map((r) => r.id).filter((x): x is string => typeof x === 'string')
    case 'id-prior-csv':
      return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => csvFields(l)[0]).filter(Boolean)
    case 'condition-fix-csv':
      return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => csvFields(l)[0]).filter(Boolean)
    default:
      return null
  }
}

/** When a journal was written: a JSON journal's own `createdAt`, else its file name. */
export function journalCreatedAt(path: string, text: string): Date | null {
  if (text.trimStart().startsWith('{')) {
    try {
      const at = (JSON.parse(text) as { createdAt?: unknown }).createdAt
      if (typeof at === 'string' && !Number.isNaN(Date.parse(at))) return new Date(at)
    } catch { /* fall through to the name */ }
  }
  return createdAtFromFilename(path)
}

/**
 * ⛔ A ROLLBACK NEVER UNDOES A LATER DECISION (review, 2026-10-03). journaledHide (hide-ad-banned, the
 * import screen, this script) hides with raw SQL: no `updatedAt` bump, no audit row. So a row this journal
 * hid, that was restored and then hidden AGAIN by a later journaled hide, passes every guard the rollback
 * has — hidden, untouched since, no audit — and would be republished over that later decision. Every id
 * named by a journal written AFTER this one (in the same directory, plus any passed explicitly) is
 * therefore left alone. Returns the ids and, per file, how many it contributed.
 */
export function laterJournalExclusions(self: string, createdAt: Date, extra: readonly string[] = [], alsoDirs: readonly string[] = []): { ids: Set<string>; byFile: { path: string; n: number }[]; dirs: string[] } {
  const ids = new Set<string>()
  const byFile: { path: string; n: number }[] = []
  const me = resolve(self)
  // The journal's own directory, plus any the caller names — the default journal directory of the other
  // journaled hides (scripts/journals: hide-ad-banned, the import screen) is one (commit-gate review: a
  // later hide whose journal lives elsewhere was invisible unless named with --exclude-journal).
  const dirs = [...new Set([dirname(me), ...alsoDirs.map((d) => resolve(d))])]
  const listed: string[] = []
  for (const dir of dirs) {
    try { listed.push(...readdirSync(dir).map((n) => join(dir, n))) } catch { /* a missing directory names nothing */ }
  }
  const explicit = new Set(extra.map((p) => resolve(p)))
  const seen = new Set<string>()
  for (const path of [...listed, ...explicit]) {
    if (path === me || seen.has(path)) continue
    seen.add(path)
    if (!/\.(json|csv)$/i.test(path)) continue
    let text: string
    try { text = readFileSync(path, 'utf8') } catch { continue }
    const at = journalCreatedAt(path, text)
    // A file in the directory counts only when it is LATER; one named with --exclude-journal always counts.
    if (!explicit.has(path) && (!at || at <= createdAt)) continue
    const list = journalIds(text)
    if (!list) continue
    for (const id of list) ids.add(id)
    byFile.push({ path, n: list.length })
  }
  return { ids, byFile, dirs }
}

// ── rollback of the psql journals (no per-row updatedAt) ──────────────────────────────────────────────

/**
 * ⛔ THE GUARD FOR A JOURNAL WITHOUT A PER-ROW `updatedAt`: the row has not been written since the hide.
 * Sound for the 2026-10-03 journals because the hide itself was raw SQL (it left `updatedAt` alone —
 * measured: max of the 68,250 is 2026-10-02 20:04:36, before 04:08:16) and every app write goes through
 * Prisma, which bumps it; the stock crons' raw writes set `"updatedAt" = now()` explicitly. Plus the
 * guards journaled-hide.ts restores under: still hidden, no compliance decision since, still ownerless —
 * and NOT labelled used (the 255 CellphoneS rows the 04:21 fix put back are `used` and live; were one ever
 * hidden again for another reason, this journal must not be the thing that republishes it).
 * $3 = the journal's createdAt (UTC, `timestamp`), $4 = a seller id or NULL for all.
 */
const LEGACY_GUARD =
  `l.status = 'hidden' AND j.prior IN ('active','sold') AND l."updatedAt" < $3::timestamp ` +
  `AND l.condition IS DISTINCT FROM 'used' ` +
  `AND NOT EXISTS (SELECT 1 FROM compliance_audit a WHERE a."subjectType" = 'listing' AND a."subjectId" = l.id AND a."occurredAt" >= $3::timestamp) ` +
  `AND EXISTS (SELECT 1 FROM "Seller" s WHERE s.id = l."sellerId" AND s."ownerId" IS NULL) ` +
  `AND ($4::text IS NULL OR l."sellerId" = $4::text)`

export const LEGACY_RESTORABLE_SQL =
  `SELECT l.id, j.prior, l."sellerId" FROM "Listing" l JOIN unnest($1::text[], $2::text[]) AS j(id, prior) ON l.id = j.id WHERE ${LEGACY_GUARD}`

export const LEGACY_RESTORE_SQL =
  `UPDATE "Listing" l SET status = j.prior FROM unnest($1::text[], $2::text[]) AS j(id, prior) WHERE l.id = j.id AND ${LEGACY_GUARD} RETURNING l.id`

/** `timestamp` literal (UTC, no zone) for a Date — what "updatedAt" and compliance_audit store. */
export const pgTimestamp = (d: Date): string => d.toISOString().replace('T', ' ').replace('Z', '')

const CHUNK = 500
const chunks = <T>(xs: T[]): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK))
  return out
}

export async function legacyRestore(
  db: HideDb,
  rows: IdPriorRow[],
  opts: { createdAt: Date; sellerId: string | null; exclude: Set<string>; apply: boolean },
): Promise<{ total: number; excluded: number; restorable: { id: string; prior: string; sellerId: string }[]; restored: string[] }> {
  const kept = rows.filter((r) => !opts.exclude.has(r.id))
  const restorable: { id: string; prior: string; sellerId: string }[] = []
  const restored: string[] = []
  const at = pgTimestamp(opts.createdAt)
  for (const part of chunks(kept)) {
    const args = [part.map((r) => r.id), part.map((r) => r.prior), at, opts.sellerId]
    restorable.push(...(await db.$queryRawUnsafe<{ id: string; prior: string; sellerId: string }[]>(LEGACY_RESTORABLE_SQL, ...args)))
    if (opts.apply) restored.push(...(await db.$queryRawUnsafe<{ id: string }[]>(LEGACY_RESTORE_SQL, ...args)).map((r) => r.id))
  }
  return { total: rows.length, excluded: rows.length - kept.length, restorable, restored }
}

// ── rollback of the 04:21 condition fix, one inverse per action ───────────────────────────────────────

/** Untouched since the fix, still ownerless, no compliance decision since. $4 = createdAt, $5 = seller or NULL. */
const FIX_COMMON =
  `l."updatedAt" < $4::timestamp ` +
  `AND NOT EXISTS (SELECT 1 FROM compliance_audit a WHERE a."subjectType" = 'listing' AND a."subjectId" = l.id AND a."occurredAt" >= $4::timestamp) ` +
  `AND EXISTS (SELECT 1 FROM "Seller" s WHERE s.id = l."sellerId" AND s."ownerId" IS NULL) ` +
  `AND ($5::text IS NULL OR l."sellerId" = $5::text)`

/**
 * $1 ids, $2 the journaled condition ('' = NULL), $3 the journaled status/prior — per action:
 *   · restore_used (hidden 'new' → back to prior status, 'used'): re-hide and relabel, only while it is
 *     still `used` and in exactly the status the fix gave it;
 *   · label_used ('new'/NULL → 'used' on a live row): put the condition back, only while it is still `used`;
 *   · hide_new (live → hidden): put the status back, only while it is still hidden and not labelled used.
 */
const FIX_FROM = `unnest($1::text[], $2::text[], $3::text[]) AS j(id, cond, st)`
const FIX_PARTS: Record<ConditionFixAction, { set: string; where: string }> = {
  restore_used: { set: `status = 'hidden', condition = NULLIF(j.cond, '')`, where: `l.condition = 'used' AND l.status = j.st AND j.st IN ('active','sold')` },
  label_used: { set: `condition = NULLIF(j.cond, '')`, where: `l.condition = 'used'` },
  hide_new: { set: `status = j.st`, where: `l.status = 'hidden' AND j.st IN ('active','sold') AND l.condition IS DISTINCT FROM 'used'` },
}

export const FIX_INVERSE_SQL = Object.fromEntries(Object.entries(FIX_PARTS).map(([k, p]) => [k,
  `UPDATE "Listing" l SET ${p.set} FROM ${FIX_FROM} WHERE l.id = j.id AND ${p.where} AND ${FIX_COMMON} RETURNING l.id`])) as Record<ConditionFixAction, string>

/** The same predicates as a SELECT, for the dry run — built from the same parts, so the two cannot drift. */
export const FIX_INVERSE_DRY_SQL = Object.fromEntries(Object.entries(FIX_PARTS).map(([k, p]) => [k,
  `SELECT l.id FROM "Listing" l JOIN ${FIX_FROM} ON l.id = j.id WHERE ${p.where} AND ${FIX_COMMON}`])) as Record<ConditionFixAction, string>

/** For restore_used the status to match is the journaled prior; for the others, the pre-fix status. */
const fixStatus = (r: ConditionFixRow) => (r.action === 'restore_used' ? r.prior : r.status)

export async function conditionFixRestore(
  db: HideDb,
  rows: ConditionFixRow[],
  opts: { createdAt: Date; sellerId: string | null; exclude: Set<string>; apply: boolean },
): Promise<{ total: number; excluded: number; byAction: Record<ConditionFixAction, { rows: number; restorable: string[]; restored: string[] }> }> {
  const at = pgTimestamp(opts.createdAt)
  const byAction = {} as Record<ConditionFixAction, { rows: number; restorable: string[]; restored: string[] }>
  let excluded = 0
  for (const action of ['restore_used', 'label_used', 'hide_new'] as const) {
    const all = rows.filter((r) => r.action === action)
    const kept = all.filter((r) => !opts.exclude.has(r.id))
    excluded += all.length - kept.length
    const out = { rows: all.length, restorable: [] as string[], restored: [] as string[] }
    for (const part of chunks(kept)) {
      const args = [part.map((r) => r.id), part.map((r) => r.cond), part.map(fixStatus), at, opts.sellerId]
      out.restorable.push(...(await db.$queryRawUnsafe<{ id: string }[]>(FIX_INVERSE_DRY_SQL[action], ...args)).map((r) => r.id))
      if (opts.apply) out.restored.push(...(await db.$queryRawUnsafe<{ id: string }[]>(FIX_INVERSE_SQL[action], ...args)).map((r) => r.id))
    }
    byAction[action] = out
  }
  return { total: rows.length, excluded, byAction }
}

// ── this script's own JSON journal ────────────────────────────────────────────────────────────────────

/** The rows of a retire-new-retail journal a rollback may consider: one seller's, minus later decisions. */
export function retireJournalRows(journal: Pick<HideJournal, 'rows'>, opts: { sellerId: string | null; exclude: Set<string> }) {
  return journal.rows.filter((r) => !opts.exclude.has(r.id) && (!opts.sellerId || r.sellerId === opts.sellerId))
}
