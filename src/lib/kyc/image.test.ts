import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { normalizeKycImage, probeExif, KYC_MIN_DIMENSIONS, KycImageError } from './image'

// Real JPEGs through the real pipeline. Mocking sharp here would test nothing: every branch that
// matters (decode, orientation, the resolution floor, the downscale) is sharp's behaviour.
//
// ⚠️ NOISE, NOT A FLAT FILL. A solid-colour JPEG compresses to a few hundred bytes whatever its
// dimensions, so a flat image never reaches the downscale branch and a "large image" test would
// quietly assert nothing. This repo has been caught by exactly that before.
async function photo(w: number, h: number): Promise<Buffer> {
  const px = Buffer.alloc(w * h * 3)
  for (let i = 0; i < px.length; i++) px[i] = (i * 2654435761) % 251
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer()
}

describe('normalizeKycImage', () => {
  it('accepts a normal phone photo of a document', async () => {
    const r = await normalizeKycImage(await photo(1600, 1200), 'document')
    expect(r.output.length).toBeGreaterThan(0)
    expect(r.report.normalized.format).toBe('jpeg')
  }, 30_000)

  it('⛔ REFUSES AN IMAGE TOO SMALL TO REVIEW', async () => {
    // A reviewer must read a passport number off this. 400x600 is decodable and useless.
    await expect(normalizeKycImage(await photo(600, 400), 'document'))
      .rejects.toThrow('image_too_small_to_review')
  }, 30_000)

  it('the selfie floor is HIGHER than the document floor, and both are enforced', async () => {
    // 700 short edge: fine for the document, too small for a selfie where six handwritten
    // characters have to be legible at arm's length.
    const img = await photo(1000, 700)
    await expect(normalizeKycImage(img, 'selfie')).rejects.toThrow('image_too_small_to_review')
    await expect(normalizeKycImage(img, 'document')).resolves.toBeTruthy()
    expect(KYC_MIN_DIMENSIONS.selfie.short).toBeGreaterThan(KYC_MIN_DIMENSIONS.document.short)
  }, 30_000)

  it('accepts exactly the floor — the boundary is inclusive', async () => {
    const { short, long } = KYC_MIN_DIMENSIONS.document
    await expect(normalizeKycImage(await photo(long, short), 'document')).resolves.toBeTruthy()
  }, 30_000)

  it('⛔ MEASURES THE ORIGINAL, NOT THE OUTPUT', async () => {
    // The locked pipeline downscales to fit 1.9 MB. Measuring afterwards would reject a good 12 MP
    // photo for being small after we shrank it ourselves — so this must pass, and the proof it
    // actually exercised the downscale is that the output is under the ceiling.
    const r = await normalizeKycImage(await photo(4000, 3000), 'document')
    expect(r.output.length).toBeLessThan(1_900_000)
    expect(r.report.corrections.length).toBeGreaterThan(0)
  }, 60_000)

  it('a sideways photo is judged on its ORIENTED dimensions', async () => {
    // EXIF orientation 6 means "rotate 90°": stored 700x1000, displayed 1000x700. Judging the
    // stored numbers would reject a portrait photo taken sideways.
    const px = Buffer.alloc(700 * 1000 * 3)
    for (let i = 0; i < px.length; i++) px[i] = (i * 40503) % 251
    const rotated = await sharp(px, { raw: { width: 700, height: 1000, channels: 3 } })
      .withMetadata({ orientation: 6 }).jpeg({ quality: 92 }).toBuffer()
    await expect(normalizeKycImage(rotated, 'document')).resolves.toBeTruthy()
  }, 30_000)

  it('rejects bytes that are not an image at all', async () => {
    await expect(normalizeKycImage(Buffer.from('definitely not a jpeg'), 'document'))
      .rejects.toThrow(KycImageError)
  })

  it('rejects an empty upload', async () => {
    await expect(normalizeKycImage(Buffer.alloc(0), 'document')).rejects.toThrow('image_size_invalid')
  })
})

describe('probeExif', () => {
  it('absent EXIF is normal and never an error', async () => {
    // Every messaging app strips EXIF and some Android cameras never write it. This must read as
    // unremarkable, because gating on it would reject honest sellers.
    const p = await probeExif(await photo(800, 600))
    expect(p.hasExif).toBe(false)
    expect(p.looksProcessed).toBe(true)
  }, 30_000)

  it('never throws on rubbish input', async () => {
    await expect(probeExif(Buffer.from('nope'))).resolves.toMatchObject({ hasExif: false })
  })
})
