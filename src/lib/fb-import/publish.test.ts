import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  class PublishBlockedError extends Error { constructor(public code: string, public detail?: string) { super(code) } }
  return {
    PublishBlockedError,
    items: { updateMany: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    listing: { findFirst: vi.fn(), update: vi.fn() },
    category: { findUnique: vi.fn() },
    resolve: vi.fn(), gate: vi.fn(), rehost: vi.fn(), claim: vi.fn(), discard: vi.fn(async () => {}), create: vi.fn(),
  }
})
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: { facebookImportItem: h.items, listing: h.listing, category: h.category } }))
vi.mock('@/lib/handle', () => ({ consolidateSellerHandle: vi.fn() }))
vi.mock('@/lib/enforcement', () => ({ postingGate: h.gate }))
vi.mock('@/lib/core/bulk', () => ({ claimRehostedImages: h.claim, discardRehostedImages: h.discard, rehostListingImage: h.rehost }))
vi.mock('@/lib/core/listings', () => ({ createListingCore: h.create }))
vi.mock('@/lib/publish-guard', () => ({ PublishBlockedError: h.PublishBlockedError, containsContactInfo: () => false, findBannedWord: () => null }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/app/api/listings/resolve-seller', () => ({ resolveSellerForPost: h.resolve }))
vi.mock('./sort', () => ({ textProblem: (t: string) => (t.length < 3 ? 'title_short' : null) }))

const { publishImportItem } = await import('./publish')
const call = () => publishImportItem('p1', 'i1', '0901234567', '', new Headers())
const photos = Array.from({ length: 10 }, (_, i) => `https://scontent.fbcdn.net/${i}.jpg`)
const ITEM = { id: 'i1', fbItemId: '12345678', title: 'A good chair', description: 'Solid', price: 500000, district: 'Quận 12', city: 'Hồ Chí Minh', categorySlug: 'furniture', subcategorySlug: null, listingType: 'sell', condition: 'used', brand: null, model: null, attributes: { color: 'red' }, specs: { year: 2020 }, raw: { photos, location: 'Thu Duc' } }

beforeEach(() => {
  vi.clearAllMocks()
  h.items.updateMany.mockResolvedValue({ count: 1 })
  h.items.update.mockResolvedValue({})
  h.listing.update.mockReset().mockResolvedValue({})
  h.items.findUniqueOrThrow.mockResolvedValue(ITEM)
  h.resolve.mockResolvedValue({ id: 's1', name: 'S', ownerId: 'p1' })
  h.gate.mockResolvedValue(null)
  h.listing.findFirst.mockResolvedValue(null)
  h.category.findUnique.mockResolvedValue({ id: 'c1', slug: 'furniture' })
  h.rehost.mockImplementation(async (u: string) => `https://sb.eno.vn/${u.split('/').pop()}`)
  h.create.mockResolvedValue({ id: 'L1', verified: true })
})

describe('publishImportItem', () => {
  it('⛔ the listing is made and the bookkeeping fails: its photos stay and the draft does not come back', async () => {
    h.listing.update.mockRejectedValueOnce(new Error('db down'))
    expect(await call()).toEqual({ ok: true, listingId: 'L1' })
    expect(h.discard).not.toHaveBeenCalled()
    expect(h.items.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'published', listingId: 'L1' }) }))
    // The stamp is tried once more: unstamped, it could count as the original of a photo.
    expect(h.listing.update).toHaveBeenLastCalledWith({ where: { id: 'L1' }, data: { externalId: 'fb:12345678' } })
  })
  it('a listing a killed publish left behind keeps its photos', async () => {
    h.listing.findFirst.mockResolvedValue({ id: 'L9', images: ['https://sb.eno.vn/a.webp'] })
    expect(await call()).toEqual({ ok: true, listingId: 'L9' })
    expect(h.claim).toHaveBeenCalledWith(['https://sb.eno.vn/a.webp'])
    expect(h.create).not.toHaveBeenCalled()
  })
  it('no area: says so before any photo is fetched', async () => {
    h.items.findUniqueOrThrow.mockResolvedValue({ ...ITEM, district: ' ' })
    expect(await call()).toEqual({ ok: false, code: 'location_required' })
    expect(h.rehost).not.toHaveBeenCalled()
  })
  it('the area goes to the listing as the post form sends it', async () => {
    await call()
    expect(h.create.mock.calls[0][0].body).toMatchObject({ district: 'Quận 12', city: 'Hồ Chí Minh' })
  })
  it('claims a draft of THIS seller first, by a conditional update', async () => {
    await call()
    expect(h.items.updateMany.mock.calls[0][0].where).toEqual({ id: 'i1', status: 'draft', job: { profileId: 'p1' } })
  })
  it('a double click or someone else’s item touches nothing', async () => {
    h.items.updateMany.mockResolvedValue({ count: 0 })
    expect(await call()).toEqual({ ok: false, code: 'not_available' })
    expect(h.rehost).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })
  it('publishes through the normal core, at most 8 photos, chips and specs carried, and stamps the source', async () => {
    expect(await call()).toEqual({ ok: true, listingId: 'L1' })
    expect(h.rehost).toHaveBeenCalledTimes(8)
    const a = h.create.mock.calls[0][0]
    expect(a.guestCreate).toBe(false)
    expect(a.body).toMatchObject({ images: expect.any(Array), attributes: { color: 'red' }, year: 2020, listingType: 'sell', condition: 'used' })
    expect(a.body.images).toHaveLength(8)
    expect(h.claim).toHaveBeenCalled()
    expect(h.listing.update).toHaveBeenCalledWith({ where: { id: 'L1' }, data: { externalId: 'fb:12345678' } })
    expect(h.items.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'published', listingId: 'L1' }) }))
  })
  it('a listing this seller already made from it is that listing, never a second', async () => {
    h.listing.findFirst.mockResolvedValue({ id: 'L0' })
    expect(await call()).toEqual({ ok: true, listingId: 'L0' })
    expect(h.create).not.toHaveBeenCalled()
    expect(h.rehost).not.toHaveBeenCalled()
  })
  it('the posting gate stops it, and the draft stays', async () => {
    h.gate.mockResolvedValue({ error: 'account_held' })
    expect(await call()).toEqual({ ok: false, code: 'account_held' })
    expect(h.create).not.toHaveBeenCalled()
    expect(h.items.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'draft' }) }))
  })
  it('a refused publish discards the photos it stored and says why', async () => {
    h.create.mockRejectedValue(new h.PublishBlockedError('duplicate_listing', 'L9'))
    expect(await call()).toEqual({ ok: false, code: 'duplicate_listing', detail: 'L9' })
    expect(h.discard).toHaveBeenCalledWith(expect.arrayContaining(['https://sb.eno.vn/0.jpg']))
    expect(h.claim).not.toHaveBeenCalled()
  })
  it('links that no longer load say so, and make nothing', async () => {
    h.rehost.mockResolvedValue(null)
    expect(await call()).toEqual({ ok: false, code: 'photos_expired' })
    expect(h.create).not.toHaveBeenCalled()
  })
  it.each([[{ categorySlug: null }, 'no_category'], [{ price: null }, 'price_required'], [{ title: 'ab' }, 'title_short']])('%j can’t publish', async (patch, code) => {
    h.items.findUniqueOrThrow.mockResolvedValue({ ...ITEM, ...patch })
    expect(await call()).toEqual({ ok: false, code })
    expect(h.rehost).not.toHaveBeenCalled()
  })
})
