// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { readZipMedia, resolveRowMedia, uploadZipImages } from './bulk-media'
import { isUnsupportedPhoto } from './normalize-image'
import { capturePosts, headKind, installFakeImageCodec, noise, restoreFakeImageCodec } from '@/test/fake-image-codec'

/**
 * R37 on the bulk importer's ZIP: an entry's type is only its extension, and the raw entry used to go up as it was. Now
 * each photo takes the same step as a picked one (compressImageFile): JPEG, PNG or WebP bytes go up, anything else goes
 * up as the browser's re-encode, and a photo the browser cannot read fails the row before any of it is posted.
 */

afterEach(restoreFakeImageCodec)

const zipOf = (entries: Record<string, Buffer>) =>
  readZipMedia(zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, new Uint8Array(v)]))))

describe('uploadZipImages', () => {
  it('⛔ an AVIF named .jpg and a .avif go up as WebP bytes; a JPEG whose re-encode is larger goes up untouched', async () => {
    installFakeImageCodec()
    const avif = await noise(64, 48).avif({ quality: 30 }).toBuffer()
    const jpeg = await noise(64, 48).jpeg({ quality: 40 }).toBuffer()
    const zip = zipOf({ 'photos/a.jpg': avif, 'photos/b.avif': avif, 'photos/c.jpg': jpeg })
    const row = resolveRowMedia('a.jpg|b.avif|c.jpg', zip)
    expect(row.missing).toEqual([])
    const posted = capturePosts()
    const urls = await uploadZipImages(row.images)
    expect(urls).toHaveLength(3)
    expect(await Promise.all(posted.map(headKind))).toEqual(['webp', 'webp', 'jpeg'])
    expect(Buffer.from(await posted[2].arrayBuffer()).equals(jpeg)).toBe(true)
  })

  it('⛔ a photo the browser cannot read refuses the row before anything is posted', async () => {
    installFakeImageCodec() // Chrome: no TIFF decoder
    const jpeg = await noise(64, 48).jpeg({ quality: 40 }).toBuffer()
    const zip = zipOf({ 'a.jpg': jpeg, 'b.jpg': await noise(64, 48).tiff().toBuffer() })
    const posted = capturePosts()
    const err = await uploadZipImages(resolveRowMedia('a.jpg|b.jpg', zip).images).then(() => null, (e: unknown) => e)
    expect(isUnsupportedPhoto(err)).toBe(true)
    expect(posted).toHaveLength(0)
  })
})
