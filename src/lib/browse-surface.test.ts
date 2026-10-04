import { describe, expect, it } from 'vitest'
import { isBrowseSurface } from './browse-surface'

/** NAV-5: the browse surfaces Explore lights on — whole segments, with or without the `/vi` pilot prefix. */
describe('isBrowseSurface', () => {
  it.each([
    '/', '/vi',
    '/c/rentals', '/c/furniture-appliances', '/c/rentals/d2', '/vi/c/furniture-appliances', '/vi/c/rentals',
    '/listings/cmtckzkx001wn01s79ub8yqu0',
    '/sellers/abc123',
    '/s/apple_store', '/s/apple_store/anything',
    '/brands',
  ])('%s is Explore', (p) => {
    expect(isBrowseSurface(p)).toBe(true)
  })

  it.each([
    null, undefined, '',
    '/saved', '/messages', '/messages/t1', '/dashboard/account', '/post', '/signin',
    '/sellersomething', '/brandsx', '/cx', '/listingsx',
    '/about', '/help', '/safety', '/motorbike-rental-ho-chi-minh-city', '/vietnam-evisa', '/vi/saved',
  ])('%s is not', (p) => {
    expect(isBrowseSurface(p)).toBe(false)
  })
})

describe('a listing page, not the seller\'s own forms under it (opus, gate 2026-10-05)', () => {
  it('lights on /listings/<id> and its /vi twin, never on /listings/<id>/edit', () => {
    expect(isBrowseSurface('/listings/abc123')).toBe(true)
    expect(isBrowseSurface('/vi/listings/abc123')).toBe(true)
    expect(isBrowseSurface('/listings/abc123/edit')).toBe(false)
    expect(isBrowseSurface('/vi/listings/abc123/edit')).toBe(false)
  })
})

describe('the clean storefront URL is NOT matched — a known, documented gap (codex, gate 2026-10-05)', () => {
  it('/<handle> stays unlit (it cannot be told from /about without the route-tree lookup this chunk cannot afford)', () => {
    expect(isBrowseSurface('/apple_store')).toBe(false)
    expect(isBrowseSurface('/s/apple_store')).toBe(true)
  })
})
