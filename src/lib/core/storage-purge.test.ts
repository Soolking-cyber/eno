import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')
vi.stubEnv('SUPABASE_SECRET_KEY', 'service-key')

const h = vi.hoisted(() => ({
  s: {
    // the VICTIM's listing still references the canonical object
    listingImages: [] as string[],
    listingVideos: [] as string[],
    /** Pictures of live (not removed) ad creatives. */
    adImages: [] as string[],
    /** Pictures of creatives eno removed. */
    adRemoved: [] as string[],
    deletes: [] as string[],
  },
}))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      count: async ({ where }: { where: { images?: { contains: string }; video?: { contains: string } } }) => {
        if (where.images) return h.s.listingImages.filter((u) => u.includes(where.images!.contains)).length
        if (where.video) return h.s.listingVideos.filter((u) => u.includes(where.video!.contains)).length
        return 0
      },
    },
    seller: { count: async () => 0 },
    profile: { count: async () => 0 },
    // Only a LIVE creative may count: the query must say `status: { not: 'removed' }` (removed ones are in adRemoved).
    adCreative: {
      count: async ({ where }: { where: { imageUrl: { contains: string }; status?: { not?: string } } }) =>
        [...h.s.adImages, ...(where.status?.not === 'removed' ? [] : h.s.adRemoved)].filter((u) => u.includes(where.imageUrl.contains)).length,
    },
  },
}))
vi.mock('@/lib/listing-image', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')
  return await vi.importActual('@/lib/listing-image')
})

const { purgeStorageObjects } = await import('./storage-purge')
const P = 'https://proj.supabase.co/storage/v1/object/public/listings/'
const V = 'https://proj.supabase.co/storage/v1/object/public/listing-videos/'

beforeEach(() => {
  // every test starts from the same world: the VICTIM's listing still references the canonical object
  h.s.listingImages = [`${P}victim.webp`]
  h.s.listingVideos = [`${V}victim.mp4`]
  h.s.adImages = []
  h.s.adRemoved = []
  h.s.deletes = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') h.s.deletes.push(url)
    return { status: 200 } as Response
  }))
})

describe('⛔ an ad\'s picture (listings/ads/) is kept while its creative is live, whatever the listing columns say (2026-11-25)', () => {
  it('kept while a live creative holds it; once the creative is removed (or never held it) it is an ordinary object', async () => {
    h.s.listingImages = []
    const { isStillReferenced } = await import('./storage-purge')
    h.s.adImages = [`${P}ads/1764-abc.webp`]
    expect(await isStillReferenced(`${P}ads/1764-abc.webp`)).toBe(true)
    // An aliased spelling (a query, a doubled slash) still finds the creative that holds the object.
    expect(await isStillReferenced(`${P}ads/1764-abc.webp?v=2`)).toBe(true)
    expect(await isStillReferenced(`https://proj.supabase.co/storage/v1/object/public/listings//ads/1764-abc.webp`)).toBe(true)
    const r = await purgeStorageObjects([`${P}ads/1764-abc.webp`])
    expect(h.s.deletes).toEqual([])
    expect(r.kept).toBe(1)
    h.s.adImages = []
    h.s.adRemoved = [`${P}ads/1764-abc.webp`]
    expect(await isStillReferenced(`${P}ads/1764-abc.webp`)).toBe(false)
    // A listing photo is never asked about ads.
    expect(await isStillReferenced(`${P}bulk/1764-abc.webp`)).toBe(false)
  })
})

describe('account deletion cannot reach another user’s object through a URL alias (review S01)', () => {
  it('a video another listing still uses is kept; an unreferenced one is deleted from its own bucket', async () => {
    let r = await purgeStorageObjects([`${V}victim.mp4`])
    expect(h.s.deletes).toEqual([]); expect(r.kept).toBe(1)
    h.s.listingVideos = []
    r = await purgeStorageObjects([`${V}victim.mp4`])
    expect(h.s.deletes).toEqual(['https://proj.supabase.co/storage/v1/object/listing-videos/victim.mp4'])
    expect(r.deleted).toBe(1)
  })

  it('the offline proof, inverted: the query alias produces NO delete, and is booked as unfinished', async () => {
    const r = await purgeStorageObjects([`${P}victim.webp?x=1`])
    expect(h.s.deletes).toEqual([])
    expect(r).toMatchObject({ deleted: 0, kept: 0, failed: 1, residue: ['unparsed:listings/victim.webp'] })
  })

  it('fragment, dot-segment and percent aliases are never deleted — and are reported as UNFINISHED, not as success', async () => {
    const r = await purgeStorageObjects([`${P}victim.webp#f`, `${P}a/../victim.webp`, `${P}victim%2Ewebp`])
    expect(h.s.deletes).toEqual([])
    expect(r).toMatchObject({ deleted: 0, kept: 0, failed: 3 })
    expect(r.residue).toEqual([
      'unparsed:listings/victim.webp', // the fragment is dropped from the tail
      'unparsed:listings/a/../victim.webp',
      'unparsed:listings/victim%2Ewebp',
    ])
  })

  it('a URL that is not our storage at all is `foreign` — nothing to erase, and not a failure', async () => {
    const r = await purgeStorageObjects(['https://lh3.googleusercontent.com/a/photo=s96-c', 'https://cdn.merchant.vn/p/1.jpg'])
    expect(h.s.deletes).toEqual([])
    expect(r).toMatchObject({ deleted: 0, kept: 0, foreign: 2, failed: 0, residue: [] })
  })

  it('the canonical url is kept while any row still references it, deleted once none does', async () => {
    let r = await purgeStorageObjects([`${P}victim.webp`])
    expect(h.s.deletes).toEqual([])
    expect(r.kept).toBe(1)
    h.s.listingImages = []
    r = await purgeStorageObjects([`${P}victim.webp`])
    expect(h.s.deletes).toEqual(['https://proj.supabase.co/storage/v1/object/listings/victim.webp'])
    expect(r.deleted).toBe(1)
  })

  it('a legacy row holding an ALIAS of an object still counts as a reference to it', async () => {
    h.s.listingImages = [`${P}victim.webp?legacy=1`]
    const r = await purgeStorageObjects([`${P}victim.webp`])
    expect(h.s.deletes).toEqual([])
    expect(r.kept).toBe(1)
  })

  it('a first-party RENDER or SIGNED spelling of our object is ours-but-unparsed, never foreign', async () => {
    const r = await purgeStorageObjects([
      'https://proj.supabase.co/storage/v1/render/image/public/listings/victim.webp?width=400',
      'https://proj.supabase.co/storage/v1/object/sign/listings/victim.webp?token=abc',
    ])
    expect(h.s.deletes).toEqual([])
    expect(r).toMatchObject({ foreign: 0, failed: 2, residue: ['unparsed:render/image/public/listings/victim.webp', 'unparsed:object/sign/listings/victim.webp'] })
  })

  it('misconfigured (no secret): erases nothing, keeps the log contract — parsed objects are `unreached`, aliases `unparsed`, foreign is foreign', async () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', '')
    try {
      const r = await purgeStorageObjects([`${P}mine.webp`, `${P}victim.webp?x=1`, 'https://lh3.googleusercontent.com/a/photo=s96-c'])
      expect(h.s.deletes).toEqual([])
      expect(r).toMatchObject({ deleted: 0, kept: 0, foreign: 1, failed: 2, residue: ['unreached:listings/mine.webp', 'unparsed:listings/victim.webp'] })
    } finally {
      vi.stubEnv('SUPABASE_SECRET_KEY', 'service-key')
    }
  })
})
