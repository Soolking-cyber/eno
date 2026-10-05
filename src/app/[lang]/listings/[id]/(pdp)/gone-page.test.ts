import { isValidElement, type ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

/**
 * B8-GONE-LANDERS — the PDP route's own decision, through `generateMetadata` and the page itself: a hidden
 * row from an ownerless import shop renders the gone page (no notFound, noindex,follow metadata, the
 * seven-field projection), and a person's hidden post — like every other non-live row — is a 404.
 * The rule is src/lib/gone-listing.ts; the layout's half (isListingViewable) is in get-listing.gone.test.ts.
 */
const row = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
// Every fixture id is journaled, so the 404 tests reach the guard they name (owner, listing type…).
vi.mock('@/lib/gone-listing-ids', () => ({ isJournaledGone: () => true }))
vi.mock('./get-listing', () => ({
  getListing: async () => row.current,
  isListingViewable: async () => true,
  listingIsViewable: () => true,
}))
const brandLookup = vi.hoisted(() => vi.fn(async () => ({ name: 'OPPO' })))
vi.mock('@/lib/db', () => ({ db: { brand: { findUnique: brandLookup } } }))
vi.mock('@/lib/translate', async (orig) => ({ ...(await orig<typeof import('@/lib/translate')>()), cachedTranslations: async () => ({ 'OPPO A6c 4GB 128GB': { ko: '오포 A6c' } }) }))

const { generateMetadata, default: ListingPage } = await import('./page')
const { GoneListing } = await import('@/components/marketplace/gone-listing')

const IMPORT_ROW = {
  id: 'L1', title: 'OPPO A6c 4GB 128GB', titleVi: 'OPPO A6c 4GB 128GB', verified: true, status: 'hidden', listingType: 'sell',
  complianceStatus: 'clear', affiliateUrl: 'https://go.isclix.com/deep_link/x', subcategorySlug: 'phones-tablets', brandSlug: 'oppo', model: 'A6c', updatedAt: new Date('2026-10-02T20:04:00+07:00'),
  price: 3_990_000, currency: '₫', priceUnit: null, images: '["https://cdn.example.test/a.jpg"]', video: null, description: 'Hàng chính hãng, bảo hành 12 tháng',
  location: 'Quận 1', attributes: '{}', condition: 'new',
  category: { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' },
  seller: { id: 'cmt78nvif0000gpq48kvzmxjw', ownerId: null, officialPartner: false, name: 'CellphoneS', phone: '0901234567', owner: null },
}
const PERSON_ROW = {
  ...IMPORT_ROW, id: 'L2', affiliateUrl: null,
  seller: { id: 'seller-minh', ownerId: '6f1c2c1e-0000-4000-8000-000000000001', officialPartner: false, name: 'Minh', phone: '0907654321', owner: { accountType: 'person', lastSeenAt: null } },
}
const args = (lang: string) => ({ params: Promise.resolve({ id: 'L1', lang }) }) as never
const NOT_FOUND = { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' }

describe('the PDP for a hidden import-shop row → the gone page', () => {
  it('metadata: noindex,follow and the item’s name — no description, share image or price', async () => {
    row.current = IMPORT_ROW
    const en = await generateMetadata(args('en'))
    expect(en.robots).toEqual({ index: false, follow: true })
    expect(en.title).toBe('OPPO A6c 4GB 128GB — No longer on eno | eno.forum') // the suite runs as the services edition
    expect(Object.keys(en).sort()).toEqual(['robots', 'title'])
    expect((await generateMetadata(args('vi'))).title).toBe('OPPO A6c 4GB 128GB — Không còn trên eno | eno.forum')
  })

  it('the page renders (no notFound → 200) the gone page, handed the projection and nothing else', async () => {
    row.current = IMPORT_ROW
    const el = (await ListingPage(args('vi'))) as ReactElement<{ listing: Record<string, unknown>; searchQuery: string; lang: string; titleI18n: unknown }>
    expect(isValidElement(el)).toBe(true)
    expect(el.type).toBe(GoneListing)
    expect(el.props.listing).toEqual({
      id: 'L1', title: 'OPPO A6c 4GB 128GB', titleVi: 'OPPO A6c 4GB 128GB',
      categorySlug: 'electronics', subcategorySlug: 'phones-tablets', brandSlug: 'oppo', model: 'A6c',
    })
    expect(el.props.searchQuery).toBe('OPPO A6c')
    expect(el.props.lang).toBe('vi')
    expect(el.props.titleI18n).toEqual({ ko: '오포 A6c' })
    expect(brandLookup).toHaveBeenCalledWith({ where: { slug: 'oppo' }, select: { name: true } })
    const json = JSON.stringify(el.props)
    for (const leak of ['3990000', 'cdn.example.test', 'bảo hành', 'isclix', 'Quận 1', 'CellphoneS', '0901234567']) expect(json, leak).not.toContain(leak)
  })
})

describe('everything else that is not live stays a plain 404', () => {
  const rejects404 = async (r: Record<string, unknown>) => {
    row.current = r
    await expect(generateMetadata(args('en'))).rejects.toMatchObject(NOT_FOUND)
    await expect(ListingPage(args('en'))).rejects.toMatchObject(NOT_FOUND)
  }

  it('⛔ a person’s own post hidden by moderation', async () => {
    await rejects404(PERSON_ROW)
  })

  it('⛔ an import shop’s hidden rental or job, an unverified row, a stale or expired rental, an authority hold', async () => {
    await rejects404({ ...IMPORT_ROW, listingType: 'rent', category: { slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê' } })
    await rejects404({ ...IMPORT_ROW, listingType: 'job' })
    await rejects404({ ...IMPORT_ROW, verified: false })
    await rejects404({ ...IMPORT_ROW, status: 'stale' })
    await rejects404({ ...IMPORT_ROW, status: 'expired' })
    await rejects404({ ...IMPORT_ROW, complianceStatus: 'taken_down' })
  })

  it('⛔ an import row hidden for what its title advertises (the 2026-10-01 ad-banned set)', async () => {
    const t = 'Thùng 48 Hộp Sữa Nước Abbott Similac 110ml cho trẻ từ 1 tuổi'
    await rejects404({ ...IMPORT_ROW, title: t, titleVi: t, brandSlug: null, model: null, category: { slug: 'baby-kids', name: 'Baby', nameVi: 'Mẹ và bé' }, seller: { ...IMPORT_ROW.seller, name: 'Tiki' } })
  })

  it('a missing row', async () => {
    row.current = null
    await expect(ListingPage(args('en'))).rejects.toMatchObject(NOT_FOUND)
  })
})
