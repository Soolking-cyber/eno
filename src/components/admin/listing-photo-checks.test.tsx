// @vitest-environment jsdom
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ADMIN › CATALOGUE › LISTING PHOTOS (owner, 2026-11-15) — src/components/admin/listing-photo-checks.tsx against a mocked
 * database. Pinned: one card per (listing, photo) from the held and stripped audits — its thumbnail, what happened and
 * why; "Photo is fine" only where it is not approved yet and the listing still exists; a removed photo put back says so.
 */
const h = vi.hoisted(() => ({ audits: [] as Array<Record<string, unknown>>, overrides: [] as Array<Record<string, unknown>>, listings: [] as Array<Record<string, unknown>> }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({
  db: {
    complianceAudit: { findMany: async ({ where }: { where: { action: unknown } }) => (where.action === 'listing.photo.override' ? h.overrides : h.audits) },
    listing: { findMany: async () => h.listings },
  },
}))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/components/admin/listing-photo-ok-button', () => ({
  ListingPhotoOkButton: ({ listingId, objectKey }: { listingId: string; objectKey: string }) => <button data-ok={`${listingId}:${objectKey}`} />,
}))

const { ListingPhotoChecks } = await import('./listing-photo-checks')
const render = async () => new DOMParser().parseFromString(renderToStaticMarkup(await ListingPhotoChecks()), 'text/html')
const BASE = 'https://sb.eno.vn/storage/v1/object/public/listings/'
const at = new Date('2026-11-15T03:00:00Z')

beforeEach(() => {
  h.audits = [
    { action: 'listing.photo.stripped', occurredAt: at, subjectId: 'L2', detail: { before: [`${BASE}x.webp`, `${BASE}c.webp`], removed: [{ i: 1, url: `${BASE}c.webp`, key: 'c.webp', rule: 'contact' }] } },
    { action: 'listing.photo.held', occurredAt: at, subjectId: 'L1', detail: { wasPublic: true, parked: false, photos: [{ i: 0, key: 'f.webp', rule: 'flyer' }, { i: 1, key: 'g.webp', rule: 'flyer' }] } },
    // An older record of the same photo: one card only.
    { action: 'listing.photo.held', occurredAt: new Date('2026-11-01T00:00:00Z'), subjectId: 'L1', detail: { photos: [{ i: 0, key: 'f.webp', rule: 'flyer' }] } },
  ]
  h.overrides = [{ subjectId: 'L1', detail: { key: 'g.webp' } }]
  h.listings = [
    { id: 'L1', title: 'Flyer flat', images: JSON.stringify([`${BASE}f.webp`, `${BASE}g.webp`]), verificationNotes: 'photo:held' },
    { id: 'L2', title: 'Phone case', images: JSON.stringify([`${BASE}x.webp`, `${BASE}c.webp`]), verificationNotes: null },
  ]
})

describe('Admin › Catalogue › Listing photos', () => {
  it('one card per listing photo: thumbnail, what happened and why, and the override where it is still needed', async () => {
    const doc = await render()
    const cards = [...doc.querySelectorAll('li')]
    expect(cards).toHaveLength(3)
    const [removed, held, approved] = cards
    expect(removed.querySelector('img')?.getAttribute('src')).toMatch(/\/storage\/v1\/object\/public\/listings\/c\.webp$/)
    expect(removed.textContent).toContain('Phone case')
    expect(removed.textContent).toContain('Removed from the listing')
    expect(removed.textContent).toContain('Contact details')
    expect(removed.textContent).toContain('Back on the listing')
    expect(held.textContent).toContain('Listing held')
    expect(held.textContent).toContain('Flyer or ad')
    expect(held.textContent).toContain('Still held')
    expect(held.querySelector('a')?.getAttribute('href')).toBe('/listings/L1')
    expect([...doc.querySelectorAll('[data-ok]')].map((b) => b.getAttribute('data-ok'))).toEqual(['L2:c.webp', 'L1:f.webp'])
    expect(approved.textContent).toContain('Approved')
  })

  it('nothing to show says so; a failed read is an alert, never a crashed console', async () => {
    h.audits = []
    expect((await render()).body.textContent).toContain('Nothing held or removed in the last 180 days.')
    h.audits = null as never
    expect((await render()).body.textContent).toContain('The listing photo checks could not be read')
  })
})
