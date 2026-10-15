import { describe, it, expect, vi, beforeEach } from 'vitest'

// The weekly digest (owner, 2026-10-15) is the 2 newest apartments + the 2 newest teachers ADDED in
// the last 7 days + a sell prompt. These pin: the 7-day recency window (so "this week" is true and
// nothing repeats), the right two of each newest-first, the photo + plausibility filters, the
// teacherProfile → fallback resolution, the teachers-category opt-in, and the two kept pure helpers.

type R = Record<string, unknown>
const h = vi.hoisted(() => ({ apartments: [] as R[], teachers: [] as R[], calls: [] as R[], scopeOpts: [] as unknown[] }))

const DAY = 24 * 60 * 60 * 1000

vi.mock('@/lib/edition-scope', () => ({
  scopedListingWhere: async (w: object, opts?: unknown) => { h.scopeOpts.push(opts); return { ...w } },
}))
vi.mock('@/lib/teachers/constants', () => ({ TEACHER_LISTING_TYPE: 'teacher' }))
vi.mock('@/lib/district-canonical', () => ({
  districtLabel: (_slug: string, name: string | null) => ({ en: name ? `${name} District` : '', vi: '' }),
  districtLinkSlug: (name: string) => name.toLowerCase().replace(/\s+/g, '-'),
}))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findMany: (args: R) => {
        h.calls.push(args)
        const where = args.where as R
        const take = args.take as number
        const gte = (where.createdAt as { gte?: Date } | undefined)?.gte
        const byNewest = (a: R, b: R) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime()
        const windowed = (rows: R[]) => (gte ? rows.filter((r) => (r.createdAt as Date) >= gte) : rows)
        if (where.listingType === 'teacher') return Promise.resolve(windowed(h.teachers).sort(byNewest).slice(0, take))
        // Apartment query: honour the DB-level price band + 7-day window.
        const price = where.price as { gte: number; lte: number } | undefined
        let rows = windowed(h.apartments)
        if (price) rows = rows.filter((r) => (r.price as number) >= price.gte && (r.price as number) <= price.lte)
        return Promise.resolve(rows.sort(byNewest).slice(0, take))
      },
    },
  },
}))

import { getDigestContent, homeHeading, plausibleHome } from './digest'

// createdAt defaults to "recently, within the window"; tests pass an age (ms ago) to order/exclude.
const apt = (id: string, o: R = {}) => ({
  id, title: `Apartment · 1 bed · 1 bath · 30 m² for rent — ${id}`, price: 9_000_000, currency: '₫',
  images: '["https://x/i.jpg"]', district: 'Quan 1', city: 'HCMC', areaM2: 30, attributes: '{"bedrooms":1}',
  createdAt: new Date(Date.now() - 60_000), ...o,
})
const tch = (id: string, o: R = {}) => ({
  id, title: `Teacher ${id}`, images: '["https://x/t.jpg"]',
  teacherProfile: { fullName: `Teacher ${id}`, headline: 'IELTS 8.0 · 5 yrs', photoUrl: 'https://x/photo.jpg' },
  createdAt: new Date(Date.now() - 60_000), ...o,
})
const ago = (ms: number) => new Date(Date.now() - ms)

beforeEach(() => { h.apartments = []; h.teachers = []; h.calls = []; h.scopeOpts = [] })

describe('getDigestContent — apartments', () => {
  it('returns the 2 newest (within the week), newest first, mapped to card fields', async () => {
    h.apartments = [apt('a', { createdAt: ago(1 * DAY) }), apt('b', { createdAt: ago(2 * DAY) }), apt('c', { createdAt: ago(3 * DAY) })]
    const c = await getDigestContent()
    expect(c.apartments.map((x) => x.id)).toEqual(['a', 'b'])
    expect(c.apartments[0]).toMatchObject({ heading: 'Apartment · 1 bed · 1 bath · 30 m²', price: 9_000_000, currency: '₫', image: 'https://x/i.jpg', area: 'Quan 1 District' })
  })

  it('excludes apartments older than the 7-day window', async () => {
    h.apartments = [apt('old', { createdAt: ago(8 * DAY) }), apt('fresh', { createdAt: ago(1 * DAY) })]
    expect((await getDigestContent()).apartments.map((x) => x.id)).toEqual(['fresh'])
  })

  it('drops an apartment with no usable photo (images "[\\"\\"]")', async () => {
    h.apartments = [apt('bad', { images: '[""]', createdAt: ago(1000) }), apt('ok1', { createdAt: ago(2000) }), apt('ok2', { createdAt: ago(3000) })]
    expect((await getDigestContent()).apartments.map((x) => x.id)).toEqual(['ok1', 'ok2'])
  })

  it('drops a portal typo (3 beds in 16.5 m²)', async () => {
    h.apartments = [apt('typo', { areaM2: 16.5, attributes: '{"bedrooms":3}', createdAt: ago(1000) }), apt('ok1', { createdAt: ago(2000) }), apt('ok2', { createdAt: ago(3000) })]
    expect((await getDigestContent()).apartments.map((x) => x.id)).toEqual(['ok1', 'ok2'])
  })

  it('keeps a ₫1,200 price typo out via the DB price band', async () => {
    h.apartments = [apt('cheap', { price: 1_200, createdAt: ago(1000) }), apt('ok1', { createdAt: ago(2000) }), apt('ok2', { createdAt: ago(3000) })]
    expect((await getDigestContent()).apartments.map((x) => x.id)).toEqual(['ok1', 'ok2'])
  })

  it('area is null when the row has no district', async () => {
    h.apartments = [apt('a', { district: null, city: null })]
    expect((await getDigestContent()).apartments[0].area).toBeNull()
  })
})

describe('getDigestContent — teachers', () => {
  it('returns the 2 newest live teachers (within the week) with name/headline/photo', async () => {
    h.teachers = [tch('t1', { createdAt: ago(1 * DAY) }), tch('t2', { createdAt: ago(2 * DAY) }), tch('t3', { createdAt: ago(3 * DAY) })]
    const c = await getDigestContent()
    expect(c.teachers.map((x) => x.id)).toEqual(['t1', 't2'])
    expect(c.teachers[0]).toMatchObject({ name: 'Teacher t1', headline: 'IELTS 8.0 · 5 yrs', image: 'https://x/photo.jpg' })
  })

  it('excludes teachers older than the 7-day window', async () => {
    h.teachers = [tch('old', { createdAt: ago(10 * DAY) }), tch('fresh', { createdAt: ago(1 * DAY) })]
    expect((await getDigestContent()).teachers.map((x) => x.id)).toEqual(['fresh'])
  })

  it('falls back to the listing title + first image when teacherProfile fields are empty', async () => {
    h.teachers = [tch('t1', { title: 'Fallback Name', images: '["https://x/img.jpg"]', teacherProfile: { fullName: null, headline: null, photoUrl: null } })]
    expect((await getDigestContent()).teachers[0]).toMatchObject({ name: 'Fallback Name', headline: null, image: 'https://x/img.jpg' })
  })

  it('drops a teacher with no photo at all', async () => {
    h.teachers = [tch('nop', { images: '[]', teacherProfile: { fullName: 'X', headline: null, photoUrl: null }, createdAt: ago(1000) }), tch('ok', { createdAt: ago(2000) })]
    expect((await getDigestContent()).teachers.map((x) => x.id)).toEqual(['ok'])
  })

  it('trims whitespace-only teacherProfile fields before the fallback', async () => {
    h.teachers = [tch('t1', { title: 'Listing Title', images: '["https://x/img.jpg"]', teacherProfile: { fullName: '   ', headline: '  ', photoUrl: '   ' } })]
    expect((await getDigestContent()).teachers[0]).toMatchObject({ name: 'Listing Title', headline: null, image: 'https://x/img.jpg' })
  })

  it('opts the teachers category back in (2nd scopedListingWhere arg)', async () => {
    h.teachers = [tch('t1')]
    await getDigestContent()
    expect(h.scopeOpts).toContainEqual({ teachers: true })
    // and the apartments query opts OUT (no teachers flag)
    expect(h.scopeOpts.filter((o) => o === undefined).length).toBe(1)
  })
})

describe('homeHeading', () => {
  it('cuts at " for rent"', () => {
    expect(homeHeading('Apartment · 2 bed · 64 m² for rent — Tân Bình')).toBe('Apartment · 2 bed · 64 m²')
  })
  it('keeps a title with no " for rent" and truncates past 70 code points', () => {
    expect(homeHeading('Studio flat')).toBe('Studio flat')
    expect(homeHeading('x'.repeat(80)).endsWith('…')).toBe(true)
  })
})

describe('plausibleHome', () => {
  it('passes when area is unknown', () => { expect(plausibleHome({ areaM2: null, attributes: null })).toBe(true) })
  it('fails under 12 m²', () => { expect(plausibleHome({ areaM2: 8, attributes: null })).toBe(false) })
  it('fails under 15 m² per bedroom', () => { expect(plausibleHome({ areaM2: 16.5, attributes: '{"bedrooms":3}' })).toBe(false) })
  it('passes a normal flat', () => { expect(plausibleHome({ areaM2: 45, attributes: '{"bedrooms":2}' })).toBe(true) })
})
