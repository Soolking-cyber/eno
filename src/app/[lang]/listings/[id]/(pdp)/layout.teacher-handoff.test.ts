import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRedirectStatusCodeFromError, getURLFromRedirectError } from 'next/dist/client/components/redirect'
import { isRedirectError } from 'next/dist/client/components/redirect-error'
import { isHTTPAccessFallbackError } from 'next/dist/client/components/http-access-fallback/http-access-fallback'

/**
 * ⛔ ON eno.forum A TEACHER'S PROFILE IS eno.vn's PAGE — the PDP's layout answers a 308 to the same path there, before the
 * page renders (owner decision 6, 2026-10-20; ./layout.tsx, src/lib/teachers/surface.ts). Pinned here, through the real
 * layout with Next's real `permanentRedirect` / `notFound`:
 *   · the forum: a live (or sold) teacher row → 308 https://eno.vn/listings/<id>; a teacher row that is not public → the
 *     404 it is on eno.vn too; any other listing → the page, as before;
 *   · eno.vn: never a redirect, and the one three-column probe it always made — nothing else.
 */
const h = vi.hoisted(() => ({ services: true, rows: new Map<string, Record<string, unknown>>() }))
const findFirst = vi.hoisted(() => vi.fn())
vi.mock('@/lib/edition', async (orig) => ({ ...(await orig<typeof import('@/lib/edition')>()), get IS_SERVICES() { return h.services } }))
vi.mock('@/lib/gone-listing-ids', () => ({ isJournaledGone: () => false }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))
vi.mock('@/lib/db', () => ({ db: { listing: { findFirst } } }))

const { default: ListingLayout } = await import('./layout')

/** The probe (a `select`) gets its columns; the page's full read (an `include`) gets the row. */
function serve() {
  findFirst.mockImplementation(async (a: { where: { id: string }; select?: Record<string, boolean> }) => {
    const row = h.rows.get(a.where.id)
    if (!row) return null
    return a.select ? Object.fromEntries(Object.keys(a.select).map((k) => [k, row[k]])) : { ...row, category: { slug: row.categorySlug }, seller: { id: 's1', owner: null } }
  })
}
const row = (id: string, over: Record<string, unknown> = {}) =>
  h.rows.set(id, { id, verified: true, status: 'active', listingType: 'sell', categorySlug: 'fashion-beauty', ...over })

/** What the layout answers: the page (its children), or the error Next turns into a response. */
async function answer(id: string): Promise<{ children: unknown } | { redirect: string; status: number } | { notFound: true }> {
  try {
    return { children: await ListingLayout({ children: 'PAGE', params: Promise.resolve({ id }) }) }
  } catch (e) {
    if (isRedirectError(e)) return { redirect: getURLFromRedirectError(e), status: getRedirectStatusCodeFromError(e) }
    if (isHTTPAccessFallbackError(e)) return { notFound: true }
    throw e
  }
}
const selects = () => findFirst.mock.calls.map(([a]) => (a.select ? JSON.stringify(a.select) : 'full row'))

beforeEach(() => {
  h.services = true
  h.rows.clear()
  findFirst.mockReset()
  serve()
  row('teacher-live', { listingType: 'teacher', categorySlug: 'teachers' })
  row('teacher-sold', { listingType: 'teacher', categorySlug: 'teachers', status: 'sold' })
  row('teacher-hidden', { listingType: 'teacher', categorySlug: 'teachers', status: 'hidden' })
  row('teacher-unverified', { listingType: 'teacher', categorySlug: 'teachers', verified: false })
  row('dress', {})
  row('job', { listingType: 'job', categorySlug: 'jobs' })
})

describe('eno.forum', () => {
  it('⛔ a live teacher profile: 308 to the same path on eno.vn — decided by the layout, before the page renders', async () => {
    expect(await answer('teacher-live')).toEqual({ redirect: 'https://eno.vn/listings/teacher-live', status: 308 })
  })

  it('a sold one too: eno.vn decides what a viewable teacher row shows', async () => {
    expect(await answer('teacher-sold')).toEqual({ redirect: 'https://eno.vn/listings/teacher-sold', status: 308 })
  })

  it('a teacher row that is not public: the 404 it is on eno.vn — and generateMetadata\'s own 404 can never race a redirect', async () => {
    expect(await answer('teacher-hidden')).toEqual({ notFound: true })
    expect(await answer('teacher-unverified')).toEqual({ notFound: true })
    expect(await answer('no-such-id')).toEqual({ notFound: true })
  })

  it('⛔ every other listing: the page, unchanged — the question reads the row the page reads next (the full row)', async () => {
    for (const id of ['dress', 'job']) {
      findFirst.mockClear()
      expect(await answer(id), id).toEqual({ children: 'PAGE' })
      expect(selects(), id).toEqual(['{"verified":true,"status":true}', 'full row'])
    }
  })

  it('the id is one path segment of the destination, encoded', async () => {
    row('t/1?x#y', { listingType: 'teacher', categorySlug: 'teachers' })
    expect(await answer('t/1?x#y')).toEqual({ redirect: 'https://eno.vn/listings/t%2F1%3Fx%23y', status: 308 })
  })
})

describe('⛔ eno.vn', () => {
  it('never redirects a teacher profile — its own page — and makes only the one probe it always made', async () => {
    h.services = false
    for (const id of ['teacher-live', 'teacher-sold', 'dress']) {
      findFirst.mockClear()
      expect(await answer(id), id).toEqual({ children: 'PAGE' })
      expect(selects(), id).toEqual(['{"verified":true,"status":true}'])
    }
    expect(await answer('teacher-hidden')).toEqual({ notFound: true })
  })
})
