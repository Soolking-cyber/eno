import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The save-time screen of the listing photo check (plan §2, A5/A6): the cache only, a refusal acted on only when two reads
 * confirmed it, this listing's "Photo is fine" overrides honoured, teachers and the protected stores exempt, any error a pass.
 */

type Verdict = { rule: 'ok' } | { rule: 'flyer' | 'contact'; confirmed: boolean } | 'unavailable'
const h = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.test'
  return {
    verdicts: {} as Record<string, Verdict>,
    calls: [] as Array<{ key: string; o: Record<string, unknown> }>,
    overridden: new Set<string>(),
    overrideThrows: false,
    handle: null as string | null,
    ownerId: 'p1' as string | null,
    officialPartner: false,
    ownerEmail: 'seller@x.vn' as string | null,
    sellerThrows: false,
    verdictThrows: false,
  }
})
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/db', () => ({
  db: {
    seller: {
      findUnique: async () => {
        if (h.sellerThrows) throw new Error('db')
        return { ownerId: h.ownerId, officialPartner: h.officialPartner, handle: h.handle ? { handle: h.handle } : null, owner: h.ownerId ? { email: h.ownerEmail } : null }
      },
      findFirst: async ({ where }: { where: { id: string; ownerId: string } }) => (where.id === 'mine' && where.ownerId === 'p1' ? { id: 'mine' } : null),
    },
  },
}))
vi.mock('@/lib/listing-photo-hooks', () => ({ photoRulesLive: () => process.env.PHOTO_RULES_WRITE === '1' }))
// eno's own e-Visa / trip desk (listing-photo-desk.test.ts resolves it): 'desk' here.
vi.mock('@/lib/listing-photo-desk', () => ({ isPhotoDeskSeller: async (id: string) => id === 'desk' }))
vi.mock('@/lib/listing-photo-verdict', () => ({
  listingPhotoVerdict: async ({ key }: { key: string }, o: Record<string, unknown>) => {
    if (h.verdictThrows) throw new Error('boom')
    h.calls.push({ key, o })
    return h.verdicts[key] ?? { rule: 'ok' }
  },
  photoOverridden: async (_listingId: string, key: string) => { if (h.overrideThrows) throw new Error('db'); return h.overridden.has(key) },
}))

const { assertNoRefusedPhotos, ownsStorefront, photoRefusalsFor } = await import('./listing-photo-refusal')
const { parsePhotoRefusalDetail } = await import('./upload-client')

const url = (k: string) => `https://sb.test/storage/v1/object/public/listings/${k}`
const RENTAL = { category: 'rentals', subcategory: 'apartment', sellerId: 's1' }

afterEach(() => vi.unstubAllEnvs())
beforeEach(() => {
  Object.assign(h, { verdicts: {}, calls: [], overridden: new Set(), overrideThrows: false, handle: null, ownerId: 'p1', officialPartner: false, ownerEmail: 'seller@x.vn', sellerThrows: false, verdictThrows: false })
})

describe('assertNoRefusedPhotos', () => {
  it('⛔ refuses only a CONFIRMED refusal, naming each as <rule>:<url> — the wizard reads the same detail back', async () => {
    h.verdicts = { 'a.webp': { rule: 'flyer', confirmed: true }, 'b.webp': { rule: 'contact', confirmed: false }, 'c.webp': 'unavailable', 'd.webp': { rule: 'contact', confirmed: true } }
    const images = ['a.webp', 'b.webp', 'c.webp', 'd.webp'].map(url)
    const err = await assertNoRefusedPhotos(images, RENTAL).catch((e) => e)
    expect(err).toMatchObject({ name: 'PublishBlockedError', code: 'photo_not_allowed', detail: `flyer:${url('a.webp')} contact:${url('d.webp')}` })
    expect([...parsePhotoRefusalDetail(err.detail)]).toEqual([[url('a.webp'), 'flyer'], [url('d.webp'), 'contact']])
  })

  it('reads the cache only, in the pass lane, with the category’s own flyer rule', async () => {
    await assertNoRefusedPhotos([url('a.webp')], RENTAL)
    await assertNoRefusedPhotos([url('a.webp')], { ...RENTAL, category: 'jobs' })
    expect(h.calls.map((c) => c.o)).toEqual([{ lane: 'pass', flyerRule: true, cacheOnly: true }, { lane: 'pass', flyerRule: false, cacheOnly: true }])
  })

  it('a lone refusal, an unavailable check, a photo not stored on eno: all pass', async () => {
    h.verdicts = { 'b.webp': { rule: 'flyer', confirmed: false }, 'c.webp': 'unavailable' }
    await expect(assertNoRefusedPhotos([url('b.webp'), url('c.webp'), 'https://elsewhere.test/x.jpg'], RENTAL)).resolves.toBeUndefined()
    expect(h.calls.map((c) => c.key)).toEqual(['b.webp', 'c.webp'])
  })

  it('this listing’s "Photo is fine" wins; an override that cannot be read passes too (fail-open)', async () => {
    h.verdicts = { 'a.webp': { rule: 'flyer', confirmed: true } }
    h.overridden.add('a.webp')
    await expect(assertNoRefusedPhotos([url('a.webp')], { ...RENTAL, listingId: 'L1' })).resolves.toBeUndefined()
    h.overridden.clear()
    h.overrideThrows = true
    await expect(assertNoRefusedPhotos([url('a.webp')], { ...RENTAL, listingId: 'L1' })).resolves.toBeUndefined()
    // No listing yet (a create): nothing to override.
    h.overrideThrows = false
    await expect(assertNoRefusedPhotos([url('a.webp')], RENTAL)).rejects.toMatchObject({ code: 'photo_not_allowed' })
  })

  it.each([
    ['a teacher listing', { category: 'teachers', subcategory: null, sellerId: 's1' }],
    ['VinWonders', { ...RENTAL, sellerId: 'cmt6v9x4o00004fq4v6qokman' }],
    ['SDC_store', { ...RENTAL, sellerId: 'cmtckzkuc01wm01s7ub6f0xsi' }],
    ['O2: eno\'s own e-Visa / trip desk (pending the owner\'s call)', { ...RENTAL, sellerId: 'desk' }],
  ])('⛔ exempt: %s', async (_who, l) => {
    h.verdicts = { 'a.webp': { rule: 'flyer', confirmed: true } }
    await expect(assertNoRefusedPhotos([url('a.webp')], l)).resolves.toBeUndefined()
    await expect(photoRefusalsFor([url('a.webp')], l)).resolves.toEqual([])
  })

  it('⛔ exempt: ENO Trading, by its handle (read only once a refusal is found)', async () => {
    h.verdicts = { 'a.webp': { rule: 'flyer', confirmed: true } }
    h.handle = 'eno-trading'
    await expect(assertNoRefusedPhotos([url('a.webp')], RENTAL)).resolves.toBeUndefined()
  })

  it('⛔ the eSIM carriers by their storefront (ownerless), never the aisle: a member\'s eSIM listing is screened', async () => {
    h.verdicts = { 'a.webp': { rule: 'flyer', confirmed: true } }
    const esim = { category: 'services', subcategory: 'esim', sellerId: 's1' }
    await expect(assertNoRefusedPhotos([url('a.webp')], esim)).rejects.toMatchObject({ code: 'photo_not_allowed' })
    h.ownerId = null
    await expect(assertNoRefusedPhotos([url('a.webp')], esim)).resolves.toBeUndefined()
  })

  it('⛔ exempt: an OFFICIAL PARTNER\'s storefront, by its flag (owner 16 Nov: "partners skipped") — owned or ownerless', async () => {
    h.verdicts = { 'a.webp': { rule: 'flyer', confirmed: true } }
    h.officialPartner = true
    await expect(assertNoRefusedPhotos([url('a.webp')], RENTAL)).resolves.toBeUndefined()
    h.ownerId = null
    await expect(photoRefusalsFor([url('a.webp')], RENTAL)).resolves.toEqual([])
    // The lawyer's seat owns a real partner storefront (Luật Hoàng Phi): a partner like any other.
    h.ownerId = 'p9'; h.ownerEmail = 'lawyer-review@eno.vn'
    await expect(photoRefusalsFor([url('a.webp')], RENTAL)).resolves.toEqual([])
  })

  it.each(['ai-review@eno.vn', 'App-Review@eno.vn', 'play-review@eno.forum', 'ai-review-2@eno.vn'])(
    '⛔ NOT exempt: a store-review seat\'s storefront, flag and all (the flag is its password key) — %s', async (email) => {
      h.verdicts = { 'a.webp': { rule: 'flyer', confirmed: true } }
      Object.assign(h, { officialPartner: true, ownerEmail: email })
      await expect(assertNoRefusedPhotos([url('a.webp')], RENTAL)).rejects.toMatchObject({ code: 'photo_not_allowed' })
    })

  it('⛔ a storefront that cannot be read exempts nothing: the screen runs', async () => {
    h.verdicts = { 'a.webp': { rule: 'flyer', confirmed: true } }
    Object.assign(h, { officialPartner: true, sellerThrows: true })
    await expect(assertNoRefusedPhotos([url('a.webp')], RENTAL)).rejects.toMatchObject({ code: 'photo_not_allowed' })
  })

  it('⛔ O1: writes off — a photo already on the listing is never refused or marked; a NEW one still is', async () => {
    h.verdicts = { 'a.webp': { rule: 'flyer', confirmed: true }, 'n.webp': { rule: 'contact', confirmed: true } }
    const existing = JSON.stringify([url('a.webp')])
    await expect(assertNoRefusedPhotos([url('a.webp')], { ...RENTAL, listingId: 'L1', existing })).resolves.toBeUndefined()
    await expect(photoRefusalsFor([url('a.webp')], { ...RENTAL, listingId: 'L1', existing })).resolves.toEqual([])
    await expect(assertNoRefusedPhotos([url('a.webp'), url('n.webp')], { ...RENTAL, listingId: 'L1', existing }))
      .rejects.toMatchObject({ code: 'photo_not_allowed', detail: `contact:${url('n.webp')}` })
    // Writes on: the photos already there are screened too, as before.
    vi.stubEnv('PHOTO_RULES_WRITE', '1')
    await expect(photoRefusalsFor([url('a.webp')], { ...RENTAL, listingId: 'L1', existing })).resolves.toEqual([{ url: url('a.webp'), rule: 'flyer' }])
  })

  it('⛔ O5: a storefront counts as the caller\'s only when they own it', async () => {
    expect(await ownsStorefront('p1', 'mine')).toBe(true)
    expect(await ownsStorefront('p2', 'mine')).toBe(false)
    expect(await ownsStorefront(null, 'mine')).toBe(false)
    expect(await ownsStorefront('p1', '')).toBe(false)
  })

  it('never throws anything but the refusal', async () => {
    h.verdictThrows = true
    await expect(assertNoRefusedPhotos([url('a.webp')], RENTAL)).resolves.toBeUndefined()
  })
})
