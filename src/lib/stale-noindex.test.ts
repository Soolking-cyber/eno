import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ A PAGE UNDER ITS FLOOR SAYS `noindex` ONLY AFTER 14 DAYS THERE (SEO wave B, I1b; owner decision
 * I-g). /c/vehicles, /c/baby-kids, /c/hobbies-sports, /c/pets and /c/food-drink were crawled while
 * empty and kept the tag for weeks after they filled (URL Inspection, 2026-09-28).
 *
 * The fake database evaluates the real `where` the helper builds against rows in memory, so the
 * boundary is tested on the predicate, not on a mock's reading of it.
 */

type Row = {
  id: string
  categoryId: string
  district: string | null
  sellerId: string
  verified: boolean
  status: string
  updatedAt: Date
  soldAt: Date | null
  takenDownAt: Date | null
}
type Where = Record<string, unknown>

function fieldMatches(value: unknown, cond: unknown): boolean {
  if (cond === null || typeof cond !== 'object' || cond instanceof Date) return value === cond
  return Object.entries(cond as Where).every(([op, arg]) => {
    switch (op) {
      case 'not': return value !== arg
      case 'gt': return value instanceof Date && value.getTime() > (arg as Date).getTime()
      case 'gte': return value instanceof Date && value.getTime() >= (arg as Date).getTime()
      case 'notIn': return value !== null && !(arg as unknown[]).includes(value)
      case 'in': return (arg as unknown[]).includes(value)
      default: throw new Error(`fake db: operator ${op} not implemented`)
    }
  })
}

function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'AND') return (cond as Where[]).every((w) => matches(row, w))
    if (key === 'OR') return (cond as Where[]).some((w) => matches(row, w))
    if (key === 'NOT') return !matches(row, cond as Where)
    return fieldMatches(row[key as keyof Row], cond)
  })
}

const h = vi.hoisted(() => ({ rows: [] as unknown[], calls: [] as { where: unknown; take?: number }[] }))

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      count: async ({ where, take }: { where: Where; take?: number }) => {
        h.calls.push({ where, take })
        const n = (h.rows as Row[]).filter((r) => matches(r, where)).length
        return take === undefined ? n : Math.min(n, take)
      },
    },
  },
}))
// The marketplace scope: the desk's rows never count toward a marketplace page, departures included.
vi.mock('@/lib/edition-scope', () => ({
  scopedListingWhere: async (w: object) => ({ AND: [w, { sellerId: { notIn: ['desk'] } }] }),
}))

import { staleBelowFloor } from './stale-noindex'
import { MIN_CATEGORY_LISTINGS, MIN_INDEXABLE_LISTINGS, STALE_NOINDEX_MS } from './index-floor'

const NOW = Date.UTC(2026, 8, 29, 8, 0, 0)
const EDGE = NOW - STALE_NOINDEX_MS // the window's first instant: 2026-09-15T08:00Z
const OLD = new Date(EDGE - 30 * 86_400_000)

let seq = 0
const row = (over: Partial<Row>): Row => ({
  id: `r${++seq}`,
  categoryId: 'pets',
  district: null,
  sellerId: 'seller',
  verified: true,
  status: 'sold',
  updatedAt: OLD,
  soldAt: null,
  takenDownAt: null,
  ...over,
})
const category = (live: number) => staleBelowFloor({ where: { categoryId: 'pets' }, live, floor: MIN_CATEGORY_LISTINGS, now: NOW })
const district = (live: number) =>
  staleBelowFloor({ where: { AND: [{ categoryId: 'pets' }, { district: 'Quận 1' }] }, live, floor: MIN_INDEXABLE_LISTINGS, now: NOW })

beforeEach(() => {
  h.rows = []
  h.calls = []
})

describe('an empty category page', () => {
  it('is noindex when nothing ever lived in it', async () => {
    expect(await category(0)).toBe(true)
  })

  it('stays indexable while its last listing left less than 14 days ago', async () => {
    h.rows = [row({ status: 'sold', updatedAt: new Date(EDGE + 1) })]
    expect(await category(0)).toBe(false)
  })

  it('turns noindex at exactly 14 days empty, and after', async () => {
    h.rows = [row({ status: 'sold', updatedAt: new Date(EDGE) })]
    expect(await category(0)).toBe(true)
    h.rows = [row({ status: 'hidden', updatedAt: OLD })]
    expect(await category(0)).toBe(true)
  })

  it('counts every way of leaving: sold, hidden, unverified, taken down', async () => {
    const recent = new Date(NOW - 86_400_000)
    for (const left of [
      row({ status: 'sold', updatedAt: recent }),
      row({ status: 'hidden', updatedAt: recent }),
      row({ status: 'active', verified: false, updatedAt: recent }),
      row({ status: 'active', verified: false, updatedAt: OLD, takenDownAt: recent }),
      row({ status: 'sold', updatedAt: OLD, soldAt: recent }),
    ]) {
      h.rows = [left]
      expect(await category(0), JSON.stringify(left)).toBe(false)
    }
  })

  it('ignores another category\'s departures and the desk\'s (edition scope)', async () => {
    const recent = new Date(NOW - 86_400_000)
    h.rows = [row({ categoryId: 'vehicles', updatedAt: recent }), row({ sellerId: 'desk', updatedAt: recent })]
    expect(await category(0)).toBe(true)
  })

  it('never queries while the category holds a live listing', async () => {
    expect(await category(1)).toBe(false)
    expect(await category(25_502)).toBe(false)
    expect(h.calls).toHaveLength(0)
  })

  it('asks for at most the one row that settles it', async () => {
    await category(0)
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].take).toBe(1)
  })
})

describe('a district page under the floor of 10', () => {
  const inQ1 = (over: Partial<Row>) => row({ district: 'Quận 1', ...over })
  const recent = new Date(NOW - 3 * 86_400_000)

  it('turns noindex when it has been under 10 all window', async () => {
    h.rows = [inQ1({ status: 'sold', updatedAt: OLD })]
    expect(await district(MIN_INDEXABLE_LISTINGS - 1)).toBe(true)
    expect(await district(1)).toBe(true)
  })

  it('stays indexable when enough left inside the window that it may have held 10', async () => {
    h.rows = [inQ1({ status: 'sold', updatedAt: recent })]
    expect(await district(MIN_INDEXABLE_LISTINGS - 1)).toBe(false) // 9 + 1
    h.rows = Array.from({ length: 5 }, () => inQ1({ status: 'hidden', updatedAt: recent }))
    expect(await district(5)).toBe(false) // 5 + 5
    h.rows = h.rows.slice(1)
    expect(await district(5)).toBe(true) // 5 + 4
  })

  it('reads the boundary the same way: a departure at exactly 14 days no longer counts', async () => {
    h.rows = [inQ1({ status: 'sold', updatedAt: new Date(EDGE) })]
    expect(await district(MIN_INDEXABLE_LISTINGS - 1)).toBe(true)
    h.rows = [inQ1({ status: 'sold', updatedAt: new Date(EDGE + 1) })]
    expect(await district(MIN_INDEXABLE_LISTINGS - 1)).toBe(false)
  })

  it('is not lifted by activity on LIVE rows — a view, an edit, a new listing', async () => {
    // Nine live rows touched today (the counters bump updatedAt until I3a) are the page's 9, not departures.
    h.rows = Array.from({ length: 9 }, () => inQ1({ status: 'active', verified: true, updatedAt: new Date(NOW - 1000) }))
    expect(await district(9)).toBe(true)
  })

  it('ignores departures from another place in the same category', async () => {
    h.rows = [row({ district: 'Quận 3', status: 'sold', updatedAt: recent })]
    expect(await district(MIN_INDEXABLE_LISTINGS - 1)).toBe(true)
  })

  it('never queries at or over the floor, and caps the count at what is missing', async () => {
    expect(await district(MIN_INDEXABLE_LISTINGS)).toBe(false)
    expect(h.calls).toHaveLength(0)
    await district(4)
    expect(h.calls[0].take).toBe(MIN_INDEXABLE_LISTINGS - 4)
  })
})

/**
 * THE WIRING — each page decides its robots tag through this helper, on its own count and floor, and
 * nothing else sets `noindex` on them.
 */
describe('the category and district pages read it', () => {
  const APP = join(process.cwd(), 'src/app/[lang]/c/[category]')
  const metadataOf = (src: string) => src.slice(src.indexOf('export async function generateMetadata('), src.indexOf('export default async function'))

  it('/c/<slug>: its live count against one listing, over the whole category', () => {
    const meta = metadataOf(readFileSync(join(APP, '(index)/page.tsx'), 'utf8'))
    expect(meta).toMatch(/const emptyForTheWindow = await staleBelowFloor\(\{ where: \{ categoryId: cat\.id \}, live, floor: MIN_CATEGORY_LISTINGS \}\)/)
    // …or a retired shelf whatever its count (second-hand focus, 2026-10-03 — src/lib/retired-categories.ts).
    expect(meta).toMatch(/\.\.\.\(emptyForTheWindow \|\| isRetiredNavCategory\(cat\.slug\) \? \{ robots: \{ index: false, follow: true \} \} : \{\}\)/)
    expect(meta.match(/robots:/g)).toHaveLength(1)
    expect(meta).not.toMatch(/live === 0 \?/)
  })

  it('/c/<slug>/<district>: its full count against the floor of 10, over its own scope without liveness', () => {
    const src = readFileSync(join(APP, '[district]/page.tsx'), 'utf8')
    expect(src).toMatch(/staleBelowFloor\(\{\s*where: \{ AND: \[placesOnly \? \{ AND: \[\{ categoryId: cat\.id \}, RENTAL_PLACES\] \} : \{ categoryId: cat\.id \}, scope\] \},\s*live: total,\s*floor: MIN_INDEXABLE_LISTINGS,\s*\}\)/)
    const meta = metadataOf(src)
    expect(meta).toMatch(/\.\.\.\(data\.noindex \|\| isRetiredNavCategory\(data\.cat\.slug\) \? \{ robots: \{ index: false, follow: true \} \} : \{\}\)/)
    expect(meta.match(/robots:/g)).toHaveLength(1)
  })
})
