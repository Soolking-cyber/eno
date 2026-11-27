/**
 * ⛔ THE FIRST LIVE ANSWER OVER THE HOME SEED KEEPS EVERY CARD ON SCREEN IN ITS CELL (CLS, owner 2026-11-27: "eno.vn should be
 * stable smooth reliable"). The home page's twelve cards are an ISR snapshot (up to 6 h old, no ads); ~3 s after load the
 * explorer's background revalidation answers with the live page 1 — paid rows first (src/lib/ads/serve.ts `withAd`), listings
 * posted since the snapshot, a creative ad as an extra first cell — and taking that order as it came slid every card on screen
 * one to four cells. RUM, desktop home 2026-11-25..27: p75 0.15, half the visits ≥ 0.1, the part moved most "main" at landing;
 * the probe (cold, signed out, 1366–1920 wide) saw cards jump y433 → y850, 0.06–0.09 a load; with this, 0.000–0.002.
 *
 * So the answer is laid over the cards already drawn, not in place of them:
 * - a card still in the answer, unpaid, stays in its index with the answer's data (price, photos);
 * - a PAID row takes the index the answer gives it — also when its listing was already on screen (it leaves its old cell, and
 *   carries the answer's `isSponsored`, so its label is never lost) — and the unpaid card it covers moves down;
 * - a cell whose card the answer DROPPED (sold, taken down, held by the licence check, a banned seller — the answer cannot
 *   say which, so never kept: commit gate 2026-11-27) takes a row new since the snapshot, else a covered card; only with
 *   nothing left to fill it does the gap close (the cards after it move up — rare: the answer is a page longer than the seed);
 * - `leadingSlot` (a creative ad arriving as an extra first cell): rows are drawn one cell later, so the row in cell 0 is the
 *   one that moves down and every other card keeps its cell; paid rows keep their index in the rows.
 * Leftovers (covered cards, rows past the drawn ones) follow at the end. A swap inside one cell is not a layout shift; a cell
 * that changes index is. Used once per mount (listings-explorer.tsx).
 */
export function keepCardsInPlace<T extends { id: string; isSponsored?: boolean }>(
  shown: readonly T[],
  fresh: readonly T[],
  opts: { leadingSlot?: boolean } = {},
): T[] {
  // The FIRST copy of an id in the answer (a paid row comes first — `withAd`), so a paid copy is never replaced by an unpaid one.
  const freshById = new Map<string, T>()
  for (const l of fresh) if (!freshById.has(l.id)) freshById.set(l.id, l)
  // The PAID row itself, wherever the answer puts it — never looked up by id, so an unpaid copy listed earlier can never
  // stand in for it and drop its label (commit gate 2026-11-27).
  const paidAt = new Map<string, number>()
  const paidRow = new Map<string, T>()
  fresh.forEach((l, i) => { if (l.isSponsored && !paidAt.has(l.id)) { paidAt.set(l.id, i); paidRow.set(l.id, l) } })

  const displaced: T[] = []
  let cells = shown
  if (opts.leadingSlot && shown.length > 0) {
    const first = freshById.get(shown[0].id)
    if (first && !paidAt.has(first.id)) displaced.push(first)
    cells = shown.slice(1)
  }
  const cellIds = new Set(cells.map((l) => l.id))
  // null = this cell is free: its card was dropped by the answer, or it is a paid row that moves to its paid index
  const slots: (T | null)[] = cells.map((l) => (paidAt.has(l.id) ? null : (freshById.get(l.id) ?? null)))

  // Paid rows to their index (in the rows — drawn one cell later under a leading creative). A covered unpaid card moves down.
  const paidOverflow: T[] = []
  for (const [id, at] of [...paidAt].sort((a, b) => a[1] - b[1])) {
    const row = paidRow.get(id)!
    if (at < slots.length) {
      const covered = slots[at]
      if (covered) displaced.push(covered)
      slots[at] = row
    } else paidOverflow.push(row)
  }

  // Free cells take, in order: rows new since the snapshot, then covered cards.
  const newRows = fresh.filter((l, i) => !cellIds.has(l.id) && !paidAt.has(l.id) && fresh.findIndex((x) => x.id === l.id) === i && !displaced.some((d) => d.id === l.id))
  const fillers = [...newRows, ...displaced]
  const out: T[] = []
  for (const s of slots) {
    if (s) out.push(s)
    else if (fillers.length > 0) out.push(fillers.shift()!)
    // else: nothing left to fill it — the gap closes
  }
  const seen = new Set<string>()
  return [...out, ...paidOverflow, ...fillers].filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)))
}
