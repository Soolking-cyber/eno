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
    seller: { id: 's1', name: 'Shop', avatarUrl: '/avatars/s1.png' },
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

  it('list_listings and get_listing both return full photo URLs', async () => {
    const list = (await tool('list_listings').handler(AUTH as never, {} as never)) as { listings: { images: string[] }[] }
    expect(list.listings[0].images).toEqual(WANT)
    const one = (await tool('get_listing').handler(AUTH as never, { id: 'l1' } as never)) as { listing: { images: string[]; video: string; seller: { avatarUrl: string } } }
    expect(one.listing.images).toEqual(WANT)
    expect(one.listing.video).toBe('https://eno.vn/listings/v.mp4')
    expect(one.listing.seller.avatarUrl).toBe('https://eno.vn/avatars/s1.png')
  })
})
