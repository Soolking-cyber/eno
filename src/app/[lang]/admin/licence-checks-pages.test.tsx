// @vitest-environment jsdom
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * WHERE THE LICENCE CHECK SHOWS UP IN THE ADMIN CONSOLE (owner, 2026-10-14). Pinned:
 *   · Catalogue gains a "Licence checks" tab (?tab=licences) that renders <LicenceChecks />, and the listings tab is
 *     handed the grandfather's end date for its badge (the client console cannot import licence-stamp.ts);
 *   · Overview gains a "Licence checks waiting" tile into that tab, whose hint says the most urgent thing first — a row
 *     live without a checked licence, then the grandfather's deadline, then the job — and "Listings awaiting review"
 *     points the licence aisles there.
 * The tab and the counts themselves are tested in components/admin/licence-checks.test.tsx.
 */

const { counts } = vi.hoisted(() => ({
  counts: vi.fn(async () => ({ waiting: 16, pending: 1, missing: 1, grandfathered: 14, breach: 0, deskUnresolved: false })),
}))
vi.mock('@/lib/admin', () => ({ getAdmin: async () => 'admin@eno.vn' }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))
vi.mock('@/lib/trips/status', () => ({ openStatuses: () => ['open'] }))
vi.mock('@/lib/support-thread', () => ({ SUPPORT_SELLER_ID: 'support-seller' }))
vi.mock('@/lib/db', () => {
  const count = async () => 0
  return {
    db: {
      identityVerification: { count }, sellerVerification: { count }, report: { count }, profile: { count }, listing: { count },
      tripAssistanceRequest: { count },
      conversation: { aggregate: async () => ({ _sum: { sellerUnread: 0 } }) },
    },
  }
})
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/components/admin/licence-checks', () => ({
  LicenceChecks: () => <div data-licence-checks="" />,
  licenceQueueCounts: counts,
  licenceGrandfatherUntilLabel: () => '21 Oct 2026, 00:00 ICT',
}))
vi.mock('@/components/admin/admin-listings-client', () => ({
  AdminListingsClient: ({ licenceGrandfatherUntil }: { licenceGrandfatherUntil?: string }) => <div data-listings-console={licenceGrandfatherUntil} />,
}))
vi.mock('@/components/admin/admin-brands-client', () => ({ AdminBrandsClient: () => <div data-brands-console="" /> }))

import AdminCataloguePage from './catalogue/page'
import AdminOverviewPage from './page'

const parse = (el: React.ReactElement) => new DOMParser().parseFromString(renderToStaticMarkup(el), 'text/html')
const catalogue = async (tab?: string) => parse(await AdminCataloguePage({ searchParams: Promise.resolve(tab ? { tab } : {}) }))
/** The overview tile that links to `href`: its count, label and hint, in order. */
// By the attribute's value, not an `a[href="…"]` selector: jsdom's selector engine misses an href carrying `&`.
const tile = (doc: Document, href: string) => [...([...doc.querySelectorAll('a')].find((a) => a.getAttribute('href') === href)?.querySelectorAll('p') ?? [])].map((p) => p.textContent)

beforeEach(() => counts.mockClear())

describe('Admin › Catalogue — the Licence checks tab', () => {
  it('sits between Listings and Brands and renders the licence checks', async () => {
    const doc = await catalogue('licences')
    const tabs = [...doc.querySelectorAll('nav a')].map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('aria-current')])
    expect(tabs).toEqual([
      ['Listings', '/admin/catalogue?tab=listings', null],
      ['Licence checks', '/admin/catalogue?tab=licences', 'page'],
      // Teacher photos (2026-10-16): the profile-photo check's refusals and asks, with the "Photo is fine" override.
      ['Teacher photos', '/admin/catalogue?tab=teacher-photos', null],
      ['Brands', '/admin/catalogue?tab=brands', null],
    ])
    expect(doc.querySelector('[data-licence-checks]')).not.toBeNull()
    expect(doc.querySelector('[data-listings-console]')).toBeNull()
  })

  it('the listings tab (and the default) hands the console the grandfather’s end date', async () => {
    for (const doc of [await catalogue('listings'), await catalogue(), await catalogue('nonsense')]) {
      expect(doc.querySelector('[data-listings-console]')?.getAttribute('data-listings-console')).toBe('21 Oct 2026, 00:00 ICT')
      expect(doc.querySelector('[data-licence-checks]')).toBeNull()
    }
  })
})

describe('Admin › Overview — the Licence checks tile', () => {
  it('counts what waits and links into the tab; while VietKite is grandfathered the hint gives the date', async () => {
    const doc = parse(await AdminOverviewPage())
    expect(counts).toHaveBeenCalledTimes(1)
    expect(tile(doc, '/admin/catalogue?tab=licences')).toEqual([
      '16', 'Licence checks waiting', 'e-Visa and Legal & permits — 14 live without a licence until 21 Oct 2026, 00:00 ICT',
    ])
    // A queue with something in it sorts among the first tiles.
    const hrefs = [...doc.querySelectorAll('ul')[0].querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs[0]).toBe('/admin/catalogue?tab=licences')
    // The tile opens the console on its own count's filter (Active + Held — sweep 2026-10-22).
    expect(tile(doc, '/admin/catalogue?tab=listings&status=active&verified=false')[2]).toBe('Not yet published — Publish makes them live (licence aisles: see Licence checks)')
  })

  it('a row live without a checked licence outranks the deadline in the hint', async () => {
    counts.mockResolvedValueOnce({ waiting: 3, pending: 1, missing: 2, grandfathered: 0, breach: 2, deskUnresolved: false })
    const doc = parse(await AdminOverviewPage())
    expect(tile(doc, '/admin/catalogue?tab=licences')).toEqual(['3', 'Licence checks waiting', 'e-Visa and Legal & permits — 2 live without a checked licence'])
  })

  it('with nothing grandfathered or breached, the hint is the job', async () => {
    counts.mockResolvedValueOnce({ waiting: 0, pending: 0, missing: 0, grandfathered: 0, breach: 0, deskUnresolved: false })
    const doc = parse(await AdminOverviewPage())
    expect(tile(doc, '/admin/catalogue?tab=licences')).toEqual(['0', 'Licence checks waiting', 'e-Visa and Legal & permits — match the emailed licence, then Approve'])
  })

  // Commit gate, 2026-10-14: the count is one more query on the overview — its failure must not take the page down.
  it('a failed count leaves the overview up: the tile shows "—", says it could not count, and sorts first', async () => {
    counts.mockRejectedValueOnce(new Error('db down'))
    const doc = parse(await AdminOverviewPage())
    expect(tile(doc, '/admin/catalogue?tab=licences')).toEqual(['—', 'Licence checks waiting', 'e-Visa and Legal & permits — could not be counted: open the tab'])
    const hrefs = [...doc.querySelectorAll('ul')[0].querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs.indexOf('/admin/catalogue?tab=licences')).toBeLessThan(hrefs.indexOf('/admin/support'))
  })

  it('an unresolved desk outranks every other hint — its own listings are in the counts', async () => {
    counts.mockResolvedValueOnce({ waiting: 15, pending: 0, missing: 15, grandfathered: 0, breach: 15, deskUnresolved: true })
    const doc = parse(await AdminOverviewPage())
    expect(tile(doc, '/admin/catalogue?tab=licences')[2]).toBe("e-Visa and Legal & permits — eno's desk did not resolve: its own listings are counted here too")
  })
})
