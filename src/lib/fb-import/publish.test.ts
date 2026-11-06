import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  class PublishBlockedError extends Error { constructor(public code: string, public detail?: string) { super(code) } }
  return {
    PublishBlockedError,
    items: { updateMany: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    listing: { findFirst: vi.fn(), update: vi.fn() },
    category: { findUnique: vi.fn() },
    resolve: vi.fn(), gate: vi.fn(), rehost: vi.fn(), claim: vi.fn(), discard: vi.fn(async () => {}), create: vi.fn(),
    translate: vi.fn(async (_t: string, _k: string, _to: string): Promise<string | null> => null),
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
vi.mock('./sort', () => ({ textProblem: (t: string) => (t.length < 3 ? 'title_short' : null), translateText: h.translate }))

const { publishImportItem } = await import('./publish')
const call = () => publishImportItem('p1', 'i1', '0901234567', '', new Headers())
const photos = Array.from({ length: 10 }, (_, i) => `https://scontent.fbcdn.net/${i}.jpg`)
const ITEM = { id: 'i1', fbItemId: '12345678', title: 'A good chair', description: 'Solid', titleVi: 'Ghế tốt', descriptionVi: 'Chắc chắn', price: 500000, district: 'Quận 12', city: 'Hồ Chí Minh', categorySlug: 'furniture', subcategorySlug: null, listingType: 'sell', condition: 'used', brand: null, model: null, attributes: { color: 'red' }, specs: { year: 2020 }, raw: { photos, location: 'Thu Duc' } }

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
  h.translate.mockReset().mockResolvedValue(null)
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

  describe('two languages (owner, 2026-11-06)', () => {
    const tr = (map: Record<string, string>) => h.translate.mockImplementation(async (t: string, _k: string, to: string) => map[`${to}:${t}`] ?? null)
    it('both whole: they go to the listing as they are, English in title and Vietnamese beside it, marked as an import', async () => {
      await call()
      expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'A good chair', imported: { titleVi: 'Ghế tốt', descriptionVi: 'Chắc chắn' } }))
      expect(h.translate).not.toHaveBeenCalled()
    })
    it('a gap an edit left is filled from its own field: English title from the Vietnamese title', async () => {
      h.items.findUniqueOrThrow.mockResolvedValue({ ...ITEM, title: null, titleVi: 'Ghế gỗ đẹp' })
      tr({ 'en:Ghế gỗ đẹp': 'Nice wooden chair' })
      await call()
      expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Nice wooden chair', imported: { titleVi: 'Ghế gỗ đẹp', descriptionVi: 'Chắc chắn' } }))
    })
    it('⛔ a title edited in English and a description in Vietnamese: each translated from its own source, nothing dropped', async () => {
      h.items.findUniqueOrThrow.mockResolvedValue({ ...ITEM, title: 'Oak chair', titleVi: null, description: null, descriptionVi: 'Gỗ sồi' })
      tr({ 'vi:Oak chair': 'Ghế gỗ sồi', 'en:Gỗ sồi': 'Solid oak' })
      await call()
      expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Oak chair', body: expect.objectContaining({ description: 'Solid oak' }), imported: { titleVi: 'Ghế gỗ sồi', descriptionVi: 'Gỗ sồi' } }))
    })
    it('no AI and English whole: English alone, never half a Vietnamese side', async () => {
      h.items.findUniqueOrThrow.mockResolvedValue({ ...ITEM, descriptionVi: null })
      await call()
      expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'A good chair', imported: { titleVi: null, descriptionVi: null } }))
    })
    it('no AI and Vietnamese whole: Vietnamese alone, in the main fields', async () => {
      h.items.findUniqueOrThrow.mockResolvedValue({ ...ITEM, description: null })
      await call()
      expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Ghế tốt', body: expect.objectContaining({ description: 'Chắc chắn' }), imported: { titleVi: null, descriptionVi: null } }))
    })



    it('⛔ a cleared title is "too short", never "try again"', async () => {
      h.items.findUniqueOrThrow.mockResolvedValue({ ...ITEM, title: 'ab', titleVi: null })
      expect(await call()).toEqual({ ok: false, code: 'title_short' })
      expect(h.translate).not.toHaveBeenCalled()
    })
    it('⛔ no AI and neither whole: nothing published, the draft back with a reason, the seller\'s words kept', async () => {
      h.items.findUniqueOrThrow.mockResolvedValue({ ...ITEM, title: 'Oak chair', titleVi: null, description: null, descriptionVi: 'Gỗ sồi' })
      expect(await call()).toEqual({ ok: false, code: 'translation_failed' })
      expect(h.create).not.toHaveBeenCalled()
      expect(h.items.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'draft', reason: 'translation_failed' }) }))
    })
  })
})
