// @vitest-environment jsdom
/**
 * R37, the client half. /api/upload and /api/v1/media now refuse any bytes that are not JPEG, PNG or WebP before sharp.
 * compressImageFile used to hand back the user's ORIGINAL file in two fallbacks (the re-encode was not smaller, or the
 * browser could not decode it), whatever its bytes were, so an AVIF saved as photo.jpg, which sharp used to take, would
 * now be refused. The rule: the original goes up only when its bytes are one of the three; otherwise the browser's own
 * re-encode goes up, even when it is larger; and a file the browser cannot decode at all is refused here, before upload.
 * The codec is a stand-in (src/test/fake-image-codec.ts) working on real bytes; what is asserted is the first bytes POSTED.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { compressImageFile, isUnsupportedPhoto } from './normalize-image'
import { uploadInBatches } from './upload-client'
import { capturePosts, fileOf, headKind, installFakeImageCodec, noise, restoreFakeImageCodec } from '@/test/fake-image-codec'

afterEach(restoreFakeImageCodec)

describe('compressImageFile: only JPEG, PNG or WebP bytes are ever forwarded as the original', () => {
  it('⛔ an AVIF named photo.jpg goes up as WebP bytes even though the WebP is larger (and as JPEG where the canvas has no WebP)', async () => {
    const avif = fileOf(await noise(64, 48).avif({ quality: 30 }).toBuffer(), 'photo.jpg', 'image/jpeg')
    expect(await headKind(avif)).toBe('avif/heic')

    installFakeImageCodec()
    const out = await compressImageFile(avif)
    const posted = capturePosts()
    await uploadInBatches([out])
    expect(posted).toHaveLength(1)
    expect(await headKind(posted[0])).toBe('webp')
    expect(posted[0].type).toBe('image/webp')
    expect(out.size).toBeGreaterThan(avif.size) // the re-encode is larger: the branch that used to keep the original
    restoreFakeImageCodec()

    installFakeImageCodec({ webp: false }) // iOS Safari: no WebP from a canvas
    const ios = capturePosts()
    await uploadInBatches([await compressImageFile(avif)])
    expect(await headKind(ios[0])).toBe('jpeg')
    expect(ios[0].type).toBe('image/jpeg')
  })

  it('a real JPEG whose re-encode is larger is still forwarded untouched, and so is one this browser cannot decode', async () => {
    const jpegBytes = await noise(64, 48).jpeg({ quality: 40 }).toBuffer()
    const jpeg = fileOf(jpegBytes, 'photo.jpg', 'image/jpeg')

    installFakeImageCodec()
    expect(await compressImageFile(jpeg)).toBe(jpeg)
    const posted = capturePosts()
    await uploadInBatches([await compressImageFile(jpeg)])
    expect(Buffer.from(await posted[0].arrayBuffer()).equals(jpegBytes)).toBe(true)
    restoreFakeImageCodec()

    installFakeImageCodec({ undecodable: ['jpeg'] }) // the old canvas-failure fallback, kept for the three formats
    expect(await compressImageFile(jpeg)).toBe(jpeg)
  })

  it('a JPEG stored under another name and type goes up as what its bytes are: image/jpeg, .jpg (commit-gate review)', async () => {
    // The server checks the bytes and the declared type. The same bytes forwarded as "image/avif" pass one and fail the other.
    const jpegBytes = await noise(64, 48).jpeg({ quality: 40 }).toBuffer()
    for (const [name, type] of [['holiday.avif', 'image/avif'], ['scan.bin', '']] as const) {
      installFakeImageCodec()
      const sent = await compressImageFile(fileOf(jpegBytes, name, type))
      expect(sent.type).toBe('image/jpeg')
      expect(sent.name).toBe(name.replace(/\.[^.]+$/, '.jpg'))
      expect(Buffer.from(await sent.arrayBuffer()).equals(jpegBytes)).toBe(true)
      restoreFakeImageCodec()
    }
  })

  it('⛔ a file the browser cannot decode whose bytes are not JPEG, PNG or WebP is refused before anything is posted', async () => {
    const tiff = fileOf(await noise(64, 48).tiff().toBuffer(), 'scan.jpg', 'image/jpeg')
    installFakeImageCodec() // Chrome: no TIFF decoder
    const posted = capturePosts()
    const err = await compressImageFile(tiff).then(() => null, (e: unknown) => e)
    expect(isUnsupportedPhoto(err)).toBe(true)
    expect((err as Error).message).toBe('upload_type') // the code the upload path already maps to its copy
    expect(posted).toHaveLength(0)
  })
})
