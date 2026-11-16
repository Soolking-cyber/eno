import { describe, expect, it } from 'vitest'
import { extendSpread, resumeSpread, shrinkSpread, spreadTwins, twinKeys, TWIN_WINDOW, type TwinRow } from './spread-twins'

/**
 * A shop's default order spreads its identical twins (UI climb r12, cook store-r12c S4) — a REORDER, never a filter: twins
 * WAIT and the rows after them come forward (the approved mock's rule, store-r12c.js); a twin is never pulled up the grid. A drawn row never moves when more rows are appended, and Back restores the drawn order exactly.
 * listings-explorer.storefront-r12.test.tsx pins where it runs (a storefront's default order only).
 */
let n = 0
const row = (title: string, price = 1_500_000, extra: Partial<TwinRow> = {}): TwinRow => ({
  id: `r${n++}`, title, price, priceUnit: 'month', currency: 'VND', images: [`https://img.eno.vn/${n}.webp`], ...extra,
})
const ids = (rows: TwinRow[]) => rows.map((r) => r.id)
const sameSet = (a: TwinRow[], b: TwinRow[]) => expect([...ids(a)].sort()).toEqual([...ids(b)].sort())
const isTwin = (a: TwinRow, b: TwinRow) => twinKeys(a).some((k) => twinKeys(b).includes(k))
/** The smallest distance between two twins in `rows`. */
function nearestTwins(rows: TwinRow[]) {
  let best = Infinity
  rows.forEach((r, i) => rows.forEach((q, j) => { if (j > i && isTwin(r, q)) best = Math.min(best, j - i) }))
  return best
}
/** How many neighbours are twins. */
const adjacentTwins = (rows: TwinRow[]) => rows.filter((r, i) => i > 0 && isTwin(rows[i - 1], r)).length
/** "x" = a distinct row, "D" = one listing posted again and again. */
const pattern = (p: string) => [...p].map((c, i) => (c === 'D' ? row('Duplex 1.5M', 1_500_000, { images: ['https://img.eno.vn/duplex.webp'] }) : row(`Flat ${i}`, 2_000_000 + i)))
const shape = (rows: TwinRow[]) => rows.map((r) => (r.title === 'Duplex 1.5M' ? 'D' : 'x')).join('')

describe('spreadTwins — the mock\'s rule: twins wait, never pulled up', () => {
  it('a grid with no twins comes back as the same array', () => {
    const rows = ['Studio 20 m²', 'Commercial space', 'Duplex', '2-bed', 'Room'].map((t) => row(t))
    expect(spreadTwins(rows)).toBe(rows)
  })

  it('twins by title + price (case and spacing folded) or by the cover photo (its query string dropped); a price alone is not', () => {
    const cover = 'https://img.eno.vn/goplus/abc.webp'
    expect(isTwin(row('Duplex 1.5M'), row('  duplex   1.5m '))).toBe(true)
    expect(isTwin(row('Room A', 1, { images: [`${cover}?w=640`] }), row('Room B', 2, { images: [`${cover}?w=360`] }))).toBe(true)
    expect(isTwin(row('Room A', 1), row('Room A', 3))).toBe(false)
  })

  it('a pair already more than TWIN_WINDOW apart stays as it came', () => {
    const rows = pattern('xxxxDxxxxxxD')
    expect(spreadTwins(rows)).toBe(rows)
  })

  it('⛔ a twin is never pulled UP the grid: every repeat lands at or after where it came (review, 2026-11-16)', () => {
    for (const p of ['xxxxxxxDxxxD', 'xxxxxxxxDDDD', 'xxxxxxxxxxDD', 'DDDxxxxxxxxx', 'DxDxDxDxDxDD', 'xDxDxxDDxxxD']) {
      const rows = pattern(p)
      const out = spreadTwins(rows)
      sameSet(out, rows)
      // The first D keeps its place or waits; every later D lands no earlier than it came.
      const firstIn = rows.findIndex((r) => r.title === 'Duplex 1.5M')
      const firstOut = out.findIndex((r) => r.title === 'Duplex 1.5M')
      expect(firstOut, p).toBe(firstIn)
      rows.forEach((r, i) => { if (r.title === 'Duplex 1.5M') expect(out.indexOf(r), p).toBeGreaterThanOrEqual(i) })
    }
  })

  it('⛔ BxDDDxBxxxxx: the spaced pair B stays 6 apart — no repeat comes up onto the first screen (review, 2026-11-16)', () => {
    const b = (id: string) => row('Room B', 3_000_000, { id, images: ['https://img.eno.vn/b.webp'] })
    const rows = [b('b0'), ...pattern('xDDDx'), b('b6'), ...pattern('xxxxx')]
    const out = spreadTwins(rows)
    expect(out.findIndex((r) => r.id === 'b6')).toBeGreaterThanOrEqual(6)
    expect(nearestTwins(out.filter((r) => r.title === 'Room B'))).toBe(1) // the two B rows only
    expect(out.findIndex((r) => r.id === 'b6') - out.findIndex((r) => r.id === 'b0')).toBeGreaterThan(TWIN_WINDOW)
  })

  it('DDxxxxxxxxxx: the first D stays on top, the second waits until it stands more than TWIN_WINDOW away', () => {
    const out = spreadTwins(pattern('DDxxxxxxxxxx'))
    expect(shape(out)).toBe('DxxxxxDxxxxx')
    expect(nearestTwins(out)).toBe(TWIN_WINDOW + 1)
  })

  it('twins that arrive last have nothing to wait behind: the first copy comes up, the repeats stay where they came', () => {
    expect(shape(spreadTwins(pattern('xxxxxxxxxxDD')))).toBe('xxxxxxxxxxDD')
    expect(shape(spreadTwins(pattern('xxxxxxxxDDDD')))).toBe('xxxxxxxxDDDD')
    expect(shape(spreadTwins(pattern('xxxxxxDxDxxx')))).toBe('xxxxxxDxxxxD') // the repeat waits as far as the rows allow
  })

  it('the spacing narrows only as far as the rows need: a pair 4 apart is kept, a pair 1 apart with room behind waits', () => {
    const rows = pattern('xxxxxxxDxxxD')
    expect(spreadTwins(rows)).toBe(rows)
    expect(shape(spreadTwins(pattern('xxDDxxxxxxxx')))).toBe('xxDxxxxxDxxx')
  })

  it('7 alike in 12 (GoPlus\'s first page): every other place, and the one unavoidable pair falls at the end', () => {
    const rows = pattern('DDDDDDDxxxxx')
    const out = spreadTwins(rows)
    sameSet(out, rows)
    expect(shape(out)).toBe('DxDxDxDxDxDD') // one pair, at the end: the fewest neighbours 7 of 12 allow
  })

  it('stuck, the group whose twin stands farthest back comes first (two groups take turns)', () => {
    const s = (i: number) => row('Studio 20 m²', 5_100_000, { id: `s${i}`, images: ['https://img.eno.vn/studio.webp'] })
    const d = (i: number) => row('Duplex 1.5M', 1_500_000, { id: `d${i}`, images: ['https://img.eno.vn/duplex.webp'] })
    const out = spreadTwins([d(0), d(1), s(0), s(1)])
    expect(out.map((r) => r.id)).toEqual(['d0', 's0', 'd1', 's1'])
  })

  it('is a pure function of its input: the same rows, the same order', () => {
    const rows = ['A', 'A', 'B', 'A', 'C', 'B'].map((t) => row(t))
    expect(ids(spreadTwins(rows))).toEqual(ids(spreadTwins([...rows])))
  })
})

describe('extendSpread — ⛔ a drawn row never moves', () => {
  it('the reviewer\'s repro: 24 drawn, a deduped page of 3, then 9 more — the 3 keep their places, nothing crosses the seam', () => {
    const r = (id: string, t: string): TwinRow => ({ id, title: t, price: 1, priceUnit: 'VND', currency: 'VND', images: [] })
    const seed = Array.from({ length: 24 }, (_, i) => r(`s${i}`, `T${i}`))
    const p2 = [r('a', 'Dup'), r('b', 'X1'), r('c', 'Dup')]
    const p3 = Array.from({ length: 9 }, (_, i) => r(`y${i}`, `Y${i}`))
    const first = extendSpread(null, seed)
    const second = extendSpread({ source: seed, drawn: first }, [...seed, ...p2])
    const third = extendSpread({ source: [...seed, ...p2], drawn: second }, [...seed, ...p2, ...p3])
    expect(ids(second.slice(0, 24))).toEqual(ids(first))
    expect(ids(third.slice(0, 27))).toEqual(ids(second))
    // The 3 appended rows are spread among themselves only…
    expect(ids(second.slice(24)).sort()).toEqual(['a', 'b', 'c'])
    expect(ids(second.slice(24))).toEqual(['a', 'b', 'c']) // Dup · X1 · Dup: already apart, kept as they came
    // …and the 9 after them never reach back past the seam.
    expect(ids(third.slice(27)).sort()).toEqual(ids(p3).sort())
  })

  it('appended twins are spread among themselves, and away from a twin just above the seam', () => {
    const page1 = pattern('xxxxxxxxxxxD')
    const drawn = extendSpread(null, page1)
    expect(drawn).toBe(page1)
    const page2 = pattern('Dxxx').map((r, i) => (i ? { ...r, title: `New flat ${i}` } : r)) // new flats, not page 1's again
    const next = extendSpread({ source: page1, drawn }, [...page1, ...page2])
    expect(ids(next.slice(0, 12))).toEqual(ids(page1))
    // The new Duplex does not sit right under the drawn one: it goes as far down the 4 new rows as it can.
    expect(shape(next.slice(12))).toBe('xxxD')
  })

  it('fresh objects for the same ids keep the drawn order; a set that is not an extension is laid out afresh', () => {
    const page1 = pattern('DDxxxx')
    const drawn = extendSpread(null, page1)
    expect(shape(drawn)).toBe('DxxxxD')
    const refreshed = page1.map((r) => ({ ...r }))
    const again = extendSpread({ source: page1, drawn }, refreshed)
    expect(ids(again)).toEqual(ids(drawn))
    expect(again.every((r) => refreshed.includes(r))).toBe(true)
    const other = pattern('xDxD')
    expect(ids(extendSpread({ source: page1, drawn }, other))).toEqual(ids(spreadTwins(other)))
  })

})

describe('shrinkSpread — a frame a page behind never re-lays the cards drawn (review, 2026-11-16)', () => {
  it('a strict prefix keeps the drawn order of the rows it holds; the full set then extends exactly as before', () => {
    const rows = pattern('DDxxxxxxDxxx' + 'xxDxxx')
    const page1 = rows.slice(0, 12)
    const drawn = extendSpread({ source: page1, drawn: spreadTwins(page1) }, rows)
    const prev = { source: rows, drawn }
    const behind = shrinkSpread(prev, page1)!
    expect(ids(behind)).toEqual(ids(drawn).filter((id) => ids(page1).includes(id)))
    // The rows come back: the caller kept `prev`, so the order is the one drawn.
    expect(ids(extendSpread(prev, rows.map((r) => ({ ...r }))))).toEqual(ids(drawn))
  })

  it('not a strict prefix (longer, equal, or other ids): null — the caller extends or lays out as usual', () => {
    const rows = pattern('DDxxxx')
    const prev = { source: rows, drawn: spreadTwins(rows) }
    expect(shrinkSpread(prev, rows)).toBeNull()
    expect(shrinkSpread(prev, [...rows, ...pattern('x')])).toBeNull()
    expect(shrinkSpread(prev, pattern('Dx'))).toBeNull()
    expect(shrinkSpread(null, rows.slice(0, 2))).toBeNull()
  })
})

describe('resumeSpread — ⛔ Back puts back the order the grid DREW (review, 2026-11-16)', () => {
  // A shop whose importer posted the same flat across its pages; the third page is deduped to 3 new rows.
  const shop = (p: string, tag: string) => [...p].map((c, i) => (c === 'D'
    ? row('Duplex 1.5M', 1_500_000, { id: `${tag}${i}`, images: ['https://img.eno.vn/duplex.webp'] })
    : c === 'S' ? row('Studio 20 m²', 5_100_000, { id: `${tag}${i}`, images: ['https://img.eno.vn/studio.webp'] })
    : row(`Flat ${tag}${i}`, 2_000_000 + i, { id: `${tag}${i}` })))
  const PAGES = [shop('DDxSxxDxxSxx', 'a'), shop('xDxxSDxxxDSx', 'b'), shop('DDS', 'c'), shop('xxxSxxxxx', 'd')]
  /** The grid as the explorer draws it, one append at a time: 12 → 24 → 27 → 36. */
  const draws = () => {
    let source: TwinRow[] = []
    let drawn: TwinRow[] = []
    const out = new Map<number, { source: TwinRow[]; drawn: TwinRow[] }>()
    for (const page of PAGES) {
      const next = [...source, ...page]
      drawn = extendSpread(source.length ? { source, drawn } : null, next)
      source = next
      out.set(source.length, { source, drawn })
    }
    return out
  }

  it.each([12, 24, 27, 36])('after %i rows: the saved ids give back exactly the drawn order', (n) => {
    const { source, drawn } = draws().get(n)!
    // The snapshot's rows are a COPY (JSON on the card tap): fresh objects, the same ids.
    const restored = resumeSpread(source.map((r) => ({ ...r })), ids(drawn))!
    expect(ids(restored)).toEqual(ids(drawn))
  })

  it('a fresh layout of the restored rows is not that order once rows arrived page by page — what the ids fix', () => {
    const { source, drawn } = draws().get(36)!
    expect(ids(spreadTwins(source))).not.toEqual(ids(drawn))
  })

  it('ids a page behind the rows (a deferred render): the drawn ones keep their places, the rest are spread on after them', () => {
    const { drawn: at24 } = draws().get(24)!
    const { source } = draws().get(27)!
    const restored = resumeSpread(source, ids(at24))!
    expect(ids(restored.slice(0, 24))).toEqual(ids(at24))
    expect(ids(restored)).toEqual(ids(extendSpread({ source: source.slice(0, 24), drawn: at24 }, source)))
  })

  it('no ids, an id that is not one of the first rows, a repeat, or more ids than rows: null (the caller lays out as before)', () => {
    const { source, drawn } = draws().get(24)!
    expect(resumeSpread(source, undefined)).toBeNull()
    expect(resumeSpread(source, [])).toBeNull()
    expect(resumeSpread(source, [...ids(drawn).slice(0, 23), 'nope'])).toBeNull()
    expect(resumeSpread(source, [...ids(drawn).slice(0, 23), ids(drawn)[0]])).toBeNull()
    expect(resumeSpread(source.slice(0, 12), ids(drawn))).toBeNull()
  })
})
