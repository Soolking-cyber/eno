import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The search verdict where another page speaks for the profile (owner decisions 7 and 14, 2026-10-20): the sitemaps'
 * teacher rule (an allow-list of the live teacher listings whose profile passes — fails closed) and a teacher-only
 * storefront's robots tag. The verdict's own rules are search-floor.test.ts; this pins the reads and the plumbing.
 */
type Row = { id: string; video: string | null; teacherProfile: { fullName: string; bio: string; videoUrl: string | null; videoOnRequest: boolean; hideFromSearch: boolean } | null }
const h = vi.hoisted(() => ({ rows: [] as Row[], asked: [] as Record<string, unknown>[] }))
vi.mock('@/lib/db', () => ({
  db: { listing: { findMany: async (q: Record<string, unknown>) => { h.asked.push(q); return h.rows } } },
}))
// The edition scope, visible: it wraps the caller's where so the test can read it.
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: object, o?: object) => ({ scoped: w, opts: o }) }))

const { searchableTeacherListingIds, storefrontTeacherRobots, teacherSitemapScope } = await import('./search-index')

const thirty = Array.from({ length: 30 }, (_, i) => `w${i}`).join(' ')
const tp = (over: Partial<NonNullable<Row['teacherProfile']>> = {}) => ({ fullName: 'Jane Doe', bio: thirty, videoUrl: null, videoOnRequest: false, hideFromSearch: false, ...over })

beforeEach(() => { h.rows = []; h.asked = [] })

describe('searchableTeacherListingIds / teacherSitemapScope', () => {
  it('reads every live teacher listing — by listingType, in the edition scope, teachers opted in — with the verdict\'s fields only', async () => {
    await searchableTeacherListingIds()
    expect(h.asked[0].where).toEqual({ scoped: { listingType: 'teacher', verified: true, status: 'active' }, opts: { teachers: true } })
    expect(h.asked[0].select).toEqual({
      id: true, video: true,
      teacherProfile: { select: { fullName: true, bio: true, videoUrl: true, videoOnRequest: true, hideFromSearch: true } },
    })
  })
  it('keeps exactly the profiles the verdict lets in', async () => {
    h.rows = [
      { id: 'in-words', video: null, teacherProfile: tp() },
      { id: 'in-listing-video', video: 'https://x/l.mp4', teacherProfile: tp({ bio: '' }) },
      { id: 'out-thin', video: null, teacherProfile: tp({ bio: 'Hello.' }) },
      { id: 'out-private', video: null, teacherProfile: tp({ bio: '', videoUrl: 'https://x/v.mp4', videoOnRequest: true }) },
      { id: 'out-masked', video: 'https://x/l.mp4', teacherProfile: tp({ fullName: 'nn***' }) },
      { id: 'out-hidden', video: null, teacherProfile: tp({ hideFromSearch: true }) },
      { id: 'out-broken', video: 'https://x/l.mp4', teacherProfile: null },
    ]
    expect(await searchableTeacherListingIds()).toEqual(['in-words', 'in-listing-video'])
  })
  it('⛔ the scope is an ALLOW-LIST: any row that is not a teacher, or a teacher on the list — none passes with an empty list', async () => {
    h.rows = [{ id: 'in-words', video: null, teacherProfile: tp() }]
    expect(await teacherSitemapScope()).toEqual({ OR: [{ listingType: { not: 'teacher' } }, { id: { in: ['in-words'] } }] })
    h.rows = []
    expect(await teacherSitemapScope()).toEqual({ OR: [{ listingType: { not: 'teacher' } }, { id: { in: [] } }] })
  })
})

describe('storefrontTeacherRobots — a teacher-only storefront speaks for its profile', () => {
  it('⛔ a shop with stock keeps its tag whatever its teacher card says — and is not even read (review round 2, codex)', async () => {
    h.rows = [{ id: 'L1', video: null, teacherProfile: tp({ hideFromSearch: true }) }]
    expect(await storefrontTeacherRobots('s1', 3)).toBeUndefined()
    expect(h.asked).toEqual([])
  })
  it('no teacher profile either (an empty shop): unchanged', async () => {
    expect(await storefrontTeacherRobots('s1', 0)).toBeUndefined()
    expect(h.asked[0].where).toEqual({ scoped: { sellerId: 's1', listingType: 'teacher', verified: true, status: 'active' }, opts: { teachers: true } })
  })
  it('⛔ teacher-only: every profile it shows out of search (hidden, masked or thin) → noindex, follow', async () => {
    for (const p of [tp({ hideFromSearch: true }), tp({ fullName: 'nn***' }), tp({ bio: 'Hi' }), tp({ fullName: 'nn***', hideFromSearch: true })]) {
      h.rows = [{ id: 'L1', video: null, teacherProfile: p }]
      expect(await storefrontTeacherRobots('s1', 0), JSON.stringify(p)).toEqual({ index: false, follow: true })
    }
    h.rows = [{ id: 'L1', video: 'https://x/l.mp4', teacherProfile: null }]
    expect(await storefrontTeacherRobots('s1', 0)).toEqual({ index: false, follow: true })
  })
  it('teacher-only with a profile in search: unchanged', async () => {
    h.rows = [{ id: 'L1', video: null, teacherProfile: tp() }]
    expect(await storefrontTeacherRobots('s1', 0)).toBeUndefined()
    h.rows = [{ id: 'L1', video: null, teacherProfile: tp({ bio: 'Hi' }) }, { id: 'L2', video: null, teacherProfile: tp() }]
    expect(await storefrontTeacherRobots('s1', 0)).toBeUndefined()
  })
})
