import type { SerializedListingCard } from '@/lib/types'

/**
 * ⛔ A SHOP'S GRID DOES NOT SHOW THE SAME LISTING TWICE IN A ROW WHEN IT CAN AVOID IT (UI climb r12, cook store-r12c S4 —
 * the storefront batch measured +0.90 / +0.50 over live, blind; PLAN §3 "no owner ruling"). An importer posts one flat
 * as many listings (GoPlus: "Duplex 1.5M", the same photo, the same price, a dozen times), and in the default order they
 * land side by side, so the first screen of a 5,000-listing shop showed one room four times.
 *
 * WHAT IT IS: a REORDER of the rows it is handed — nothing added, nothing removed, nothing renamed. Two rows are twins when
 * they share their title (case and spacing folded) with the same price, unit and currency, or their cover photo; twins of
 * twins are one group (a shared photo under two titles joins both titles' rows).
 * ⛔ HOW — TWINS WAIT, A REPEAT IS NEVER PULLED UP (store-r12c.js S4's rule, review 2026-11-16): each place takes the EARLIEST
 * row, in the order the rows came, that stands at least `k` places from its twin — and a REPEAT (a row whose twin came
 * before it) never takes a place above the one it came in. So twins only wait; single rows and first copies come up into
 * the gaps; a run with no twins, or with twins already apart, comes back as it was. `k` is the widest spacing, from
 * TWIN_WINDOW + 1 (the mock's: no twin among the last five) down to 2, at which every row finds a place; when even 2 cannot
 * hold (7 of 12 alike — GoPlus's first page; a pair that arrives last), a stuck place takes the row whose twin stands
 * farthest back, so twins touch only where the rows loaded leave nothing to wait behind — at the end, never up front.
 * (history, 2026-11-16) Three other rules came first — fixed 12-row blocks, a most-rows-left greedy, a wait-then-pull
 * look-ahead — and each review found a twin moved UP onto the first screen or a drawn card moved; the mock's fixed window
 * of five alone left three Duplexes side by side at the end of a 14-row page.
 * ⛔ A ROW ON SCREEN NEVER MOVES: the order is EXTENDED, never recomputed — `extendSpread` keeps every drawn row where it is
 * and lays only the appended rows after them (the drawn tail still counts as the last five, so a new row does not sit under
 * its twin across the seam when it can wait). Only a set that is not an extension of the drawn one (a new search, filter or
 * order) is laid out afresh.
 * ⛔ BACK PUTS BACK THE ORDER DRAWN: the explorer's back-nav snapshot saves the drawn ids and `resumeSpread` restores them.
 * The caller decides WHEN (the storefront's default order only — listings-explorer.tsx); any other order is the reader's.
 */
export type TwinRow = Pick<SerializedListingCard, 'id' | 'title' | 'price' | 'priceUnit' | 'currency' | 'images'>

/**
 * How far back a twin is looked for first: the mock's five, so a twin stands 6 places from its twin where the rows allow —
 * on a phone's two-column grid, three rows down. Spacing narrows (down to 2) only as far as the rows need.
 */
export const TWIN_WINDOW = 5

const fold = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()

/** The keys two twins share: the title with its price, and the cover photo (its query string dropped). */
export function twinKeys(row: TwinRow): string[] {
  const keys = [`t:${fold(row.title ?? '')}|${row.price}|${row.priceUnit ?? ''}|${row.currency ?? ''}`]
  const cover = row.images?.[0]
  if (cover) keys.push(`p:${cover.split('?')[0]}`)
  return keys
}

/** Each row's twin group: rows sharing any key, transitively (a small union-find over the keys). */
function twinGroups(rows: TwinRow[]): number[] {
  const parent = rows.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] }
    return i
  }
  const firstWithKey = new Map<string, number>()
  rows.forEach((row, i) => {
    for (const k of twinKeys(row)) {
      const j = firstWithKey.get(k)
      if (j === undefined) firstWithKey.set(k, i)
      else parent[find(i)] = find(j)
    }
  })
  return rows.map((_, i) => find(i))
}

/** `rows` reordered: the `fixed` leading rows where they are (drawn), the rest laid after them by the rule above. */
function lay<T extends TwinRow>(rows: T[], fixed: number): T[] {
  const groups = twinGroups(rows)
  const seen = new Set<number>()
  /** A repeat: a row whose twin came before it. It may wait; it never comes up the grid. */
  const repeat = groups.map((g) => { const r = seen.has(g); seen.add(g); return r })
  /** One pass, each twin at least `k` from its twin. Null when a row is left with nowhere to go (unless `stuckOk`). */
  const pass = (k: number, stuckOk: boolean): number[] | null => {
    const out: number[] = []
    const lastAt = new Map<number, number>()
    for (let i = 0; i < fixed; i++) { out.push(i); lastAt.set(groups[i], i) }
    const pool: number[] = []
    for (let i = fixed; i < rows.length; i++) pool.push(i)
    while (pool.length) {
      const at = out.length
      // A repeat's place is never above where it came (there is always one such row: `at` places hold `at` rows).
      const may = (i: number) => !repeat[i] || i <= at
      let j = pool.findIndex((i) => { const was = lastAt.get(groups[i]); return may(i) && (was === undefined || at - was >= k) })
      if (j < 0) {
        if (!stuckOk) return null
        // Every row that may go here stands within `k` of its twin: the one whose twin is farthest back (ties: the earliest).
        for (let m = 0; m < pool.length; m++) {
          if (!may(pool[m])) continue
          if (j < 0 || lastAt.get(groups[pool[m]])! < lastAt.get(groups[pool[j]])!) j = m
        }
      }
      const i = pool.splice(j, 1)[0]
      out.push(i)
      lastAt.set(groups[i], at)
    }
    return out
  }
  let out: number[] | null = null
  for (let k = TWIN_WINDOW + 1; k >= 2 && !out; k--) out = pass(k, false)
  out ??= pass(2, true)!
  return out.every((i, at) => i === at) ? rows : out.map((i) => rows[i])
}

/** A fresh layout of `rows`. A grid with no twins near each other comes back as the same array. */
export function spreadTwins<T extends TwinRow>(rows: T[]): T[] {
  if (rows.length < 2) return rows
  return lay(rows, 0)
}

/** What the grid drew last: the rows it was handed (`source`) and the order it drew them in (`drawn`). */
export type SpreadRun<T> = { source: T[]; drawn: T[] }

/**
 * The next layout after `prev`. When `source` EXTENDS `prev.source` (the same ids at the same places, more after them), the
 * drawn rows keep their places — each takes its fresh object from `source` — and only the appended rows are spread, after
 * them. Anything else is laid out afresh (`spreadTwins`).
 */
export function extendSpread<T extends TwinRow>(prev: SpreadRun<T> | null, source: T[]): T[] {
  if (!prev || prev.source.length > source.length || prev.source.some((r, i) => r.id !== source[i].id)) return spreadTwins(source)
  const n = prev.source.length
  if (n === source.length && prev.source === source) return prev.drawn
  const fresh = new Map(source.slice(0, n).map((r) => [r.id, r] as const))
  const kept = prev.drawn.map((r) => fresh.get(r.id) ?? r)
  const rows = [...kept, ...source.slice(n)]
  const out = n === source.length ? rows : lay(rows, n)
  return out.every((r, i) => r === source[i]) ? source : out
}

/**
 * ⛔ A SHORTER PREFIX OF THE ROWS DRAWN (review, 2026-11-16 — the grid can draw a deferred render a page behind for a frame,
 * e.g. after a Back restore): the drawn order, keeping only those rows, so no card on screen moves — never a fresh layout of
 * the shorter set. Null when `source` is not a strict prefix of `prev.source` (same ids at the same places). The caller draws
 * this and KEEPS `prev` as its state, so the rows coming back extend the drawn order exactly as before.
 */
export function shrinkSpread<T extends TwinRow>(prev: SpreadRun<T> | null, source: T[]): T[] | null {
  if (!prev || source.length >= prev.source.length || source.some((r, i) => r.id !== prev.source[i].id)) return null
  const keep = new Map(source.map((r) => [r.id, r] as const))
  return prev.drawn.flatMap((r) => { const k = keep.get(r.id); return k ? [k] : [] })
}

/**
 * ⛔ BACK PUTS THE GRID BACK AS IT WAS DRAWN (review, 2026-11-16): the order a back-nav restores is the one the grid DREW
 * (`drawnIds`, saved in the snapshot), never a fresh layout of the snapshot's rows — a fresh layout of rows that arrived page
 * by page (a deduped page of 3) can differ from the order drawn, so the cards round the one the reader came back to would
 * stand in another order. `rows` are the snapshot's, in the order they came; `drawnIds` must name exactly their first rows
 * (the grid draws a deferred render that can be a page behind the rows), and any rows after those are spread on as an append
 * (`extendSpread`). Anything else — no ids (a snapshot written before them), an id that is not one of those rows, a repeat —
 * is null, and the caller lays the rows out as before.
 */
export function resumeSpread<T extends TwinRow>(rows: T[], drawnIds: unknown): T[] | null {
  if (!Array.isArray(drawnIds) || drawnIds.length === 0 || drawnIds.length > rows.length) return null
  const head = rows.slice(0, drawnIds.length)
  const byId = new Map(head.map((r) => [r.id, r] as const))
  const drawn: T[] = []
  for (const id of drawnIds) {
    const r = typeof id === 'string' ? byId.get(id) : undefined
    if (!r) return null
    byId.delete(id as string) // each row once
    drawn.push(r)
  }
  return extendSpread({ source: head, drawn }, rows)
}
