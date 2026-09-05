import { describe, it, expect, vi, beforeAll } from 'vitest'

// The guard reads the env at module load; pin it BEFORE the import.
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')
const mod = await import('./listing-image')
const { isListingImageUrl, isListingVideoUrl, listingObjectKey, VIDEO_EXTENSIONS, RASTER_EXTENSIONS } = mod

const P = 'https://proj.supabase.co/storage/v1/object/public/listings/'
const V = 'https://proj.supabase.co/storage/v1/object/public/listing-videos/'

describe('isListingImageUrl — canonical spellings only (review S01)', () => {
  beforeAll(() => { expect(isListingImageUrl(`${P}1725000000000-ab12cd-hdeadbeef.webp`)).toBe(true) })

  it('accepts the shapes media.ts actually writes', () => {
    expect(isListingImageUrl(`${P}1725000000000-ab12cd-hdeadbeef.webp`)).toBe(true)
    expect(isListingImageUrl(`${P}api/1725000000000-ab12cd.webp`)).toBe(true)
    expect(isListingImageUrl(`${P}bulk/1725000000000-ab12cd.webp`)).toBe(true)
    expect(isListingImageUrl(`${P}legacy/avatar.JPG`)).toBe(true)
  })

  it('refuses every alias of a real object', () => {
    const victim = `${P}victim.webp`
    expect(isListingImageUrl(victim)).toBe(true)
    for (const alias of [
      `${victim}?x=1`, `${victim}#frag`, `${victim}?`, `${victim}#`,
      `${P}../listings/victim.webp`, `${P}./victim.webp`, `${P}a/../victim.webp`,
      `${P}%76ictim.webp`, `${P}victim%2Ewebp`, `${P}victim.webp%00`,
      `${P}/victim.webp`, `${P}a//victim.webp`, `${P}victim.webp/`,
      `${P}vic tim.webp`, `${P}victim.webp\n`, `${P}a\\victim.webp`,
      `${P}victim.exe`, `${P}victim`, `${P}.hidden.webp`, `${P}-dash.webp`,
      `https://other.supabase.co/storage/v1/object/public/listings/victim.webp`,
      `https://proj.supabase.co/storage/v1/object/public/other/victim.webp`,
      'https://picsum.photos/200', '', null, undefined, 42,
    ]) {
      expect(isListingImageUrl(alias), String(alias)).toBe(false)
    }
  })

  it('listingObjectKey names the bucket and key for canonical urls only', () => {
    expect(listingObjectKey(`${P}api/x.webp`)).toEqual({ bucket: 'listings', key: 'api/x.webp', url: `${P}api/x.webp` })
    expect(listingObjectKey(`${V}clip.mp4`)).toEqual({ bucket: 'listing-videos', key: 'clip.mp4', url: `${V}clip.mp4` })
    expect(listingObjectKey(`${P}x.webp?v=1`)).toBeNull()
    expect(listingObjectKey(`${P}x.webp#`)).toBeNull()
    expect(listingObjectKey(`${V}clip.webp`)).toBeNull()
    expect(isListingVideoUrl(`${V}clip.webm`)).toBe(true)
    expect(isListingVideoUrl(`${V}clip.webm?t=1`)).toBe(false)
  })

  it('accepts exactly the key shapes the real writers produce (so the tightening cannot refuse a real upload)', () => {
    // core/media.ts storeListingImage: `${pathPrefix}${Date.now()}-${rand6}[-h${dHash}].webp`, pathPrefix '' | 'api/' | 'bulk/'
    const ts = Date.now(); const rand = Math.random().toString(36).slice(2, 8); const hash = 'a'.repeat(16)
    for (const prefix of ['', 'api/', 'bulk/']) {
      expect(isListingImageUrl(`${P}${prefix}${ts}-${rand}-h${hash}.webp`)).toBe(true)
      expect(isListingImageUrl(`${P}${prefix}${ts}-${rand}.webp`)).toBe(true)
    }
    // upload/video/sign: `${Date.now()}-${rand6}.${ext}` for every VIDEO_ALLOWED value (core/media.ts asserts
    // that list against VIDEO_EXTENSIONS at load); transcode: `${Date.now()}-${rand6}.mp4`
    for (const ext of VIDEO_EXTENSIONS) expect(isListingVideoUrl(`${V}${ts}-${rand}.${ext}`)).toBe(true)
    for (const ext of RASTER_EXTENSIONS) expect(isListingImageUrl(`${P}${ts}-${rand}.${ext}`)).toBe(true)
    expect(VIDEO_EXTENSIONS).toContain('mp4')
  })
})
