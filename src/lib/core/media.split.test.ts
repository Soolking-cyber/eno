/**
 * storeListingImage = prepareListingImage + putListingImage (listing photo check, 2026-11-15): an upload can be checked
 * between the two, and every caller keeps the one-call form. Real sharp, a storage stub that keeps the bytes.
 */
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharpLib from 'sharp'

const h = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sb.test'
  return { uploads: [] as Array<{ path: string; body: Buffer }>, fail: false, pointed: [] as Array<[string, string]> }
})

vi.mock('@/lib/supabase-admin', () => ({
  LISTINGS_BUCKET: 'listings',
  EVIDENCE_BUCKET: 'evidence',
  LISTING_VIDEOS_BUCKET: 'listing-videos',
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        upload: async (path: string, body: Buffer) => { if (h.fail) return { error: { message: 'down' } }; h.uploads.push({ path, body }); return { error: null } },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://sb.test/storage/v1/object/public/listings/${path}` } }),
      }),
    },
  }),
}))

vi.mock('@/lib/listing-photo-verdict', () => ({ rememberPhotoKey: async (key: string, sha: string) => { h.pointed.push([key, sha]) } }))

import { prepareListingImage, putListingImage, storeListingImage } from './media'

const photo = (grey: number) => sharpLib({ create: { width: 900, height: 600, channels: 3, background: { r: grey, g: grey, b: grey } } }).png().toBuffer()
const hex = (b: Buffer) => createHash('sha256').update(b).digest('hex')

beforeEach(() => { h.uploads.length = 0; h.fail = false; h.pointed = [] })

describe('prepareListingImage', () => {
  it('encodes without storing, and hashes the exact bytes that will be stored', async () => {
    const img = (await prepareListingImage(await photo(120)))!
    expect(h.uploads).toHaveLength(0)
    expect(img.sha256).toBe(hex(img.out))
    expect(img.nameFacts).toMatch(/^-i[dl][dl]-900x600-h[0-9a-f]{16}$/)
  })
  it('the same file prepared twice hashes alike (a re-upload or a re-host hits the cache); another file does not', async () => {
    const a = (await prepareListingImage(await photo(120)))!
    const b = (await prepareListingImage(await photo(120)))!
    const c = (await prepareListingImage(await photo(30)))!
    expect(a.sha256).toBe(b.sha256)
    expect(c.sha256).not.toBe(a.sha256)
  })
  it('an avatar or a logo gets no mark facts; bytes that are not an image are null', async () => {
    expect((await prepareListingImage(await photo(120), { watermark: false }))!.nameFacts).toMatch(/^-h[0-9a-f]{16}$/)
    expect(await prepareListingImage(Buffer.from('not an image'))).toBeNull()
  })
})

describe('putListingImage', () => {
  it('stores the prepared bytes under a fresh name and answers the url and the object key', async () => {
    const img = (await prepareListingImage(await photo(120)))!
    const r = (await putListingImage(img, { pathPrefix: 'api/' }))!
    expect(r.key).toMatch(/^api\/\d{13}-[a-z0-9]{1,6}-i[dl][dl]-900x600-h[0-9a-f]{16}\.webp$/)
    expect(r.url).toBe(`https://sb.test/storage/v1/object/public/listings/${r.key}`)
    expect(hex(h.uploads[0].body)).toBe(img.sha256)
  })
  it('beforeUpload that throws stores nothing; a storage error is null', async () => {
    const img = (await prepareListingImage(await photo(120)))!
    expect(await putListingImage(img, { beforeUpload: async () => { throw new Error('tombstone') } })).toBeNull()
    expect(h.uploads).toHaveLength(0)
    h.fail = true
    expect(await putListingImage(img)).toBeNull()
  })
})

describe('storeListingImage keeps its one-call form for every caller', () => {
  it('prepares, runs beforeUpload with the path, stores, answers the url', async () => {
    const seen: string[] = []
    const url = await storeListingImage(await photo(120), { pathPrefix: 'bulk/', beforeUpload: async (p) => { seen.push(p) } })
    expect(url).toBe(`https://sb.test/storage/v1/object/public/listings/${h.uploads[0].path}`)
    expect(seen).toEqual([h.uploads[0].path])
    expect(h.uploads[0].path.startsWith('bulk/')).toBe(true)
  })
  it('⛔ points the stored key at the bytes\' sha, for every caller (the photo check\'s key → sha cache)', async () => {
    await storeListingImage(await photo(120), { pathPrefix: 'api/' })
    expect(h.pointed).toEqual([[h.uploads[0].path, hex(h.uploads[0].body)]])
  })
  it('null for bad bytes and for a storage error, as before', async () => {
    expect(await storeListingImage(Buffer.from('nope'))).toBeNull()
    h.fail = true
    expect(await storeListingImage(await photo(120))).toBeNull()
    expect(h.pointed).toEqual([])
  })
})
