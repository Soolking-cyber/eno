import { describe, expect, it, vi } from 'vitest'

/**
 * Photos and logos in MCP output are URLs an app can open (2026-11-14): a seeded or older row can hold a site-relative
 * path ("/listings/x.png") that ChatGPT, Claude or Muse cannot resolve, so the output names it in full on this site.
 */
vi.mock('server-only', () => ({}))
vi.mock('@/lib/api/oauth', () => ({ OAUTH_ISSUER: 'https://eno.vn' }))
vi.mock('@/lib/api/auth', () => ({ listingOwnedBy: async () => true }))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findMany: async () => [{ id: 'l1' }],
      findUnique: async () => ({ id: 'l1' }),
    },
  },
}))
vi.mock('@/lib/serialize', () => ({
  serializeListing: () => ({
    id: 'l1', images: ['/listings/a.png', 'https://sb.eno.vn/storage/b.jpg', '//cdn.example/c.png'], video: '/listings/v.mp4',
    seller: { id: 's1', name: 'Shop', avatarUrl: '/avatars/s1.png' }, category: { slug: 'electronics', name: 'Electronics' },
  }),
}))

const { TOOLS, absoluteAssetUrl } = await import('./tools')
const AUTH = { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['listings:read']) }
const tool = (name: string) => TOOLS.find((t) => t.name === name)!
const WANT = ['https://eno.vn/listings/a.png', 'https://sb.eno.vn/storage/b.jpg', 'https://cdn.example/c.png']

describe('MCP output names photos in full', () => {
  it('a site-relative path gets this site, a protocol-relative one gets https, a full URL passes as it is', () => {
    expect(absoluteAssetUrl('/listings/a.png')).toBe('https://eno.vn/listings/a.png')
    expect(absoluteAssetUrl('https://sb.eno.vn/x.jpg')).toBe('https://sb.eno.vn/x.jpg')
    expect(absoluteAssetUrl('//cdn.example/c.png')).toBe('https://cdn.example/c.png')
    expect(absoluteAssetUrl(null)).toBeNull()
  })

  it('list_listings and get_listing return full photo URLs and the full page link', async () => {
    // list_listings answers a summary: the cover photo, in full, and how many photos there are.
    const list = (await tool('list_listings').handler(AUTH as never, {} as never)) as { listings: { cover: string; photos: number; url: string }[] }
    expect(list.listings[0].cover).toBe(WANT[0])
    expect(list.listings[0].photos).toBe(3)
    expect(list.listings[0].url).toBe('https://eno.vn/listings/l1')
    const one = (await tool('get_listing').handler(AUTH as never, { id: 'l1' } as never)) as { listing: { images: string[]; url: string } }
    expect(one.listing.images).toEqual(WANT)
    expect(one.listing.url).toBe('https://eno.vn/listings/l1')
    expect((one.listing as unknown as { video: string }).video).toBe('https://eno.vn/listings/v.mp4')
    // The listing is answered field by field (tools.ts listingOut, 2026-11-15): the web page's extras stay out.
    expect(one.listing).not.toHaveProperty('seller')
  })
})
