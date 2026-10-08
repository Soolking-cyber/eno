import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The apartment-rentals feed route: its gate, its body, its failure — and, read from source, the
 * selector that decides which flats Meta may advertise.
 */
vi.mock('@/lib/db', () => ({ db: { listing: { findMany: vi.fn() } } }))
vi.mock('@/lib/edition-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/edition-scope')>()),
  scopedListingWhere: vi.fn(async (where: object) => where),
}))

vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.eno.vn')
const { GET } = await import('./route')
const { db } = await import('@/lib/db')
const { scopedListingWhere, DeskResolutionError } = await import('@/lib/edition-scope')
const { RENTAL_FEED_HEADERS } = await import('@/lib/rentals-feed')
const { FEED_CATEGORIES, feedListingTypes } = await import('@/lib/product-feed')

const findMany = vi.mocked(db.listing.findMany)
const photo = (n: number) => `https://sb.eno.vn/storage/v1/object/public/listings/affiliate/m/flat-${n}-a-idl-1200x900.webp`
const row = (id: string, images: string[]) => ({
  id, title: '2 bed for rent', titleVi: null, description: 'Bright.', price: 15_000_000, priceUnit: 'VND/month',
  currency: '₫', images: JSON.stringify(images), sellerId: 'muaban-net-import-seller-0001', status: 'active',
  subcategorySlug: 'apartment-rental', attributes: '{"bedrooms":"2"}', city: 'Hồ Chí Minh', district: 'Quận 1', areaM2: 50,
})

const PASS = 'feed-secret-for-tests'
beforeEach(() => {
  vi.stubEnv('FEED_USER', 'meta')
  vi.stubEnv('FEED_PASSWORD', PASS)
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  findMany.mockReset()
})
afterEach(() => {
  vi.mocked(scopedListingWhere).mockImplementation(async (where: object) => where)
  vi.restoreAllMocks()
})

describe('GET /api/feeds/facebook-rentals', () => {
  it('⛔ answers 401 with a Basic challenge and reads nothing when the feed is protected and no key is sent', async () => {
    const res = await GET(new Request('https://eno.vn/api/feeds/facebook-rentals'))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toMatch(/^Basic /)
    expect(findMany).not.toHaveBeenCalled()
  })

  it('serves the CSV with ?key=, uncacheable, and counts the withheld rows', async () => {
    findMany.mockResolvedValue([row('a', [photo(1)]), row('b', ['https://photo.rever.vn/x.jpg'])] as never)
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const res = await GET(new Request(`https://eno.vn/api/feeds/facebook-rentals?key=${PASS}`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toContain('facebook_rentals.csv')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(JSON.parse(res.headers.get('x-feed-excluded')!)).toEqual({ no_image: 1 })
    const lines = (await res.text()).trimEnd().split('\n')
    expect(lines[0]).toBe(RENTAL_FEED_HEADERS.join(','))
    expect(lines).toHaveLength(2)
    expect(lines[1]).toMatch(/^a,/)
    expect(lines[1]).toContain('https://eno.vn/listings/a?utm_source=facebook&utm_medium=catalog&utm_campaign=rentals')
    expect(info).toHaveBeenCalledWith('facebook-rentals: withheld %o of %d eligible rows', { no_image: 1 }, 2)
  })

  it('reads the apartment selector, the narrow projection, newest first, with NO row cap', async () => {
    findMany.mockResolvedValue([] as never)
    await GET(new Request(`https://eno.vn/api/feeds/facebook-rentals?key=${PASS}`))
    const args = findMany.mock.calls[0][0] as Record<string, unknown>
    expect(args.where).toEqual({
      verified: true, status: 'active', listingType: 'rent', category: { slug: 'rentals' }, subcategorySlug: 'apartment-rental',
    })
    expect(Object.keys(args.select as object)).not.toContain('seller')
    expect(args.orderBy).toEqual({ postedAt: 'desc' })
    expect(args).not.toHaveProperty('take')
  })

  it('⛔ a desk that cannot be resolved is a 500, never an unscoped feed', async () => {
    vi.mocked(scopedListingWhere).mockRejectedValue(new DeskResolutionError('no desk seller'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(new Request(`https://eno.vn/api/feeds/facebook-rentals?key=${PASS}`))
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('id,title')
    expect(findMany).not.toHaveBeenCalled()
  })
})

/** Comments stripped first — affiliate-exclusion.test.ts says why (a commented-out clause must not pass). */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('the selector, as written', () => {
  const src = stripComments(readFileSync('src/app/api/feeds/facebook-rentals/route.ts', 'utf8'))

  it('goes through scopedListingWhere with every clause of the listing page\'s 200', () => {
    const at = src.indexOf('await scopedListingWhere({')
    expect(at).toBeGreaterThanOrEqual(0)
    const end = src.indexOf('}),', at)
    expect(end, 'end of the scopedListingWhere object — has it been refactored?').toBeGreaterThan(at)
    const where = src.slice(at, end)
    for (const clause of ['verified: true', "status: 'active'", "listingType: 'rent'", "slug: 'rentals'", "subcategorySlug: 'apartment-rental'"]) {
      expect(where, `${clause} must remain`).toContain(clause)
    }
  })

  it('⛔ never borrows the goods feeds\' guards', () => {
    expect(src).not.toContain('feedCategories(')
    expect(src).not.toContain('feedListingTypes(')
  })
})

describe('the goods feeds stay goods', () => {
  it('⛔ neither goods guard admits rentals, so flats never reach Google Shopping or the goods catalogue', () => {
    expect(FEED_CATEGORIES).not.toContain('rentals')
    expect(feedListingTypes()).not.toContain('rent')
  })
})
