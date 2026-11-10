/**
 * ⛔ NOTHING IS BAKED INTO AN UPLOAD ANY MORE (owner, 2026-11-10: no eno.vn mark on photos on screen).
 *
 * Until that day `storeListingImage` composited the wordmark into every member photo. A baked mark can never be taken out of a
 * file, so the pipeline now stores the photo CLEAN and writes what a drawn mark would need into the name, the way an imported
 * photo has carried it since 2026-09-13 (image-mark-url.ts):
 *
 *   <ts>-<rand>-i<cover><contain>-<W>x<H>[-h<16hex>].webp
 *
 * These run the real pipeline (real sharp, a storage stub that keeps the bytes) and pin:
 *   · the stored pixels are the photo's own, where the mark used to be composited;
 *   · the name carries the two inks and the stored size, and the duplicate hash still parses after them;
 *   · an avatar or a logo (`watermark: false`) gets a plain name, so no mark can ever be drawn or baked over it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharpLib from 'sharp'
import { hashFromUrl } from '@/lib/image-hash-url'
import { watermarkPlacement } from '@/lib/core/watermark-mark'

// The storage origin, set BEFORE any module loads: listing-image.ts and image-mark-url.ts read it for their prefix rule, and
// media.ts imports the first of them statically (a stub inside a test would come too late to mean anything).
const h = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.test'
  return { uploads: [] as Array<{ path: string; body: Buffer; opts: Record<string, unknown> }> }
})

vi.mock('@/lib/supabase-admin', () => ({
  LISTINGS_BUCKET: 'listings',
  EVIDENCE_BUCKET: 'evidence',
  LISTING_VIDEOS_BUCKET: 'listing-videos',
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        upload: async (path: string, body: Buffer, opts: Record<string, unknown>) => { h.uploads.push({ path, body, opts }); return { error: null } },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://sb.test/storage/v1/object/public/listings/${path}` } }),
      }),
    },
  }),
}))

import { storeListingImage } from './media'

const NAME = /^((?:api\/)?)\d{13}-[a-z0-9]{1,6}-i([dl])([dl])-(\d{1,5})x(\d{1,5})(?:-h[0-9a-f]{16})?\.webp$/
/** The stored name's facts (numbered groups: this target has no named ones), or null when the name is not a clean listing photo's. */
const facts = (path: string) => { const m = NAME.exec(path); return m ? { prefix: m[1], cover: m[2], contain: m[3], w: m[4], h: m[5] } : null }

/** A flat photo of one grey: any composited mark would change pixels in the mark's corner. */
const flat = (width: number, height: number, grey: number) =>
  sharpLib({ create: { width, height, channels: 3, background: { r: grey, g: grey, b: grey } } }).png().toBuffer()

/** The darkest and brightest value in a region of the stored file. */
async function range(webp: Buffer, region: { left: number; top: number; width: number; height: number }) {
  const { channels } = await sharpLib(webp).extract(region).greyscale().stats()
  return { min: channels[0].min, max: channels[0].max }
}

beforeEach(() => { h.uploads.length = 0 })

describe('storeListingImage — a listing photo is stored clean', () => {
  it('bakes nothing where the mark used to go, on a dark photo and on a bright one', async () => {
    for (const grey of [40, 235]) {
      h.uploads.length = 0
      const url = await storeListingImage(await flat(1200, 900, grey))
      expect(url).toMatch(/^https:\/\/sb\.test\/storage\/v1\/object\/public\/listings\//)
      const { body } = h.uploads[0]
      const { region } = watermarkPlacement(1200, 900)
      const { min, max } = await range(body, region)
      // White ink at 85% on grey 40, or near-black at 42% on grey 235, would move pixels by tens of levels; WebP's own
      // rounding on a flat field stays within a couple.
      expect(max - min).toBeLessThanOrEqual(4)
      expect(Math.abs(min - grey)).toBeLessThanOrEqual(4)
    }
  })

  it('writes the two inks and the stored size into the name, and the hash still parses after them', async () => {
    const url = (await storeListingImage(await flat(1200, 900, 235)))!
    // A bright photo: a drawn mark would use dark ink in both frames.
    expect(facts(h.uploads[0].path)).toMatchObject({ cover: 'd', contain: 'd', w: '1200', h: '900' })
    expect(hashFromUrl(url)).toMatch(/^[0-9a-f]{16}$/)

    h.uploads.length = 0
    await storeListingImage(await flat(900, 1200, 30))
    expect(facts(h.uploads[0].path)).toMatchObject({ cover: 'l', contain: 'l', w: '900', h: '1200' })
  })

  it('records the size it STORED, after the downscale to the longest edge', async () => {
    await storeListingImage(await flat(3200, 1600, 128))
    expect(facts(h.uploads[0].path)).toMatchObject({ w: '1600', h: '800' })
  })

  it('keeps the caller prefix in front (the public media API)', async () => {
    await storeListingImage(await flat(800, 800, 128), { pathPrefix: 'api/' })
    expect(facts(h.uploads[0].path)!.prefix).toBe('api/')
  })

  it('stays immutable and long-cached, as before', async () => {
    await storeListingImage(await flat(800, 600, 128))
    expect(h.uploads[0].opts).toMatchObject({ contentType: 'image/webp', upsert: false, cacheControl: '31536000' })
  })
})

describe('the new name passes every shared reader of a stored listing photo', () => {
  // Commit review, twice: "another consumer expecting the old name could reject new uploads". These are the readers there
  // are (grep `webp` regexes: the rest are GoPlus's and the import overlay's own names), run on what the pipeline really wrote.
  it('listing save accepts it, the duplicate hash reads it, the feeds keep it, and no overlay is drawn on it yet', async () => {
    const { isListingImageUrl } = await import('@/lib/listing-image')
    const { overlayMarkFromUrl, isOverlayImageUrl } = await import('@/lib/image-mark-url')
    const { feedImages } = await import('@/lib/rentals-feed')
    const url = (await storeListingImage(await flat(1200, 900, 128)))!
    const viaApi = (await storeListingImage(await flat(800, 600, 128), { pathPrefix: 'api/' }))!
    // The prefix rule is live in this file: an import's own name under the same origin IS read.
    expect(isOverlayImageUrl('https://sb.test/storage/v1/object/public/listings/affiliate/m/x-abc-def-idl-1200x900.webp')).toBe(true)
    for (const u of [url, viaApi]) {
      expect(isListingImageUrl(u)).toBe(true)
      expect(hashFromUrl(u)).toMatch(/^[0-9a-f]{16}$/)
      // `affiliate/m/` names only, until the mark is turned back on (image-mark.tsx has the two steps).
      expect(overlayMarkFromUrl(u)).toBeNull()
    }
    expect(feedImages([url, viaApi])).toEqual([url, viaApi])
  })

  // ⛔ THE SECOND STEP, AS A GATE (commit review). Turning ON_SCREEN_MARK back on draws the mark on imports only until
  // `overlayMarkFromUrl` also reads a member's clean name. Whoever flips the switch meets this test instead of a note.
  it('the mark cannot be switched back on while a member\'s clean photo would stay unmarked', async () => {
    const { ON_SCREEN_MARK } = await import('@/components/marketplace/image-mark')
    const { overlayMarkFromUrl } = await import('@/lib/image-mark-url')
    const member = (await storeListingImage(await flat(1200, 900, 128)))!
    expect(ON_SCREEN_MARK && overlayMarkFromUrl(member) === null).toBe(false)
  })
})

describe('storeListingImage — a photo too small to hold a mark', () => {
  // The mark's facts are for a mark that may never be drawn: measuring them must never cost a member the upload (commit review).
  it.each([[1, 1], [3, 2], [2, 40], [40, 2]])('stores a %i×%i photo, clean, with its size in the name', async (w, hgt) => {
    const url = await storeListingImage(await flat(w, hgt, 200))
    expect(url).not.toBeNull()
    expect(facts(h.uploads[0].path)).toMatchObject({ w: String(w), h: String(hgt) })
  })
})

describe('storeListingImage — an avatar or a logo', () => {
  it('gets a plain name with no mark facts, and is stored clean too', async () => {
    await storeListingImage(await flat(600, 600, 235), { watermark: false })
    const { path, body } = h.uploads[0]
    expect(path).toMatch(/^\d{13}-[a-z0-9]{1,6}(?:-h[0-9a-f]{16})?\.webp$/)
    expect(path).not.toMatch(/-i[dl][dl]-/)
    const { min, max } = await range(body, watermarkPlacement(600, 600).region)
    expect(max - min).toBeLessThanOrEqual(4)
  })
})

describe('storeListingImage — refuses what it refused before', () => {
  it('returns null for bytes that are not an image, and stores nothing', async () => {
    expect(await storeListingImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>not an image'))).toBeNull()
    expect(h.uploads).toHaveLength(0)
  })
})
