import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import {
  HOST_EDGE, MIN_IMAGE_LONG_EDGE, dropNearDuplicates, flatnessOf, galleryPlan, imageVerdict, measureImage,
} from './import-photo-check'
import { makeImageHost } from './host-product-image'
import { hashFromUrl } from './image-hash-url'

/**
 * The shared real-photo test the property importers run before re-hosting a rival portal's photo.
 * The verdict thresholds are muaban's measured ones (scripts/muaban-net-map.ts, 2026-09-24); the
 * `measureImage` cases decode REAL encoded images built here, so a change to the decode pipeline
 * (channels, colourspace, the hash) is caught, not just a change to the arithmetic.
 */

/**
 * A deterministic stand-in for a real photo: a low-frequency scene (which is what a dHash sees, so a
 * re-encode keeps its hash) under grain (which is what gives a photo its entropy and no dominant colour).
 */
function noise(width: number, height: number, channels: 1 | 3, seed: number): Buffer {
  const out = Buffer.alloc(width * height * channels)
  let x = seed >>> 0
  const rnd = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296 }
  const fx = 2 + rnd() * 4, fy = 2 + rnd() * 4, px = rnd() * 6.28, py = rnd() * 6.28
  for (let yy = 0; yy < height; yy++) for (let xx = 0; xx < width; xx++) {
    const scene = 128 + 70 * Math.sin((xx / width) * fx * 3.14 + px) * Math.cos((yy / height) * fy * 3.14 + py)
    for (let c = 0; c < channels; c++) {
      out[(yy * width + xx) * channels + c] = Math.max(0, Math.min(255, Math.round(scene + (rnd() - 0.5) * 90 + c * 9)))
    }
  }
  return out
}
const jpeg = (raw: Buffer, width: number, height: number, channels: 1 | 3) =>
  sharp(raw, { raw: { width, height, channels } }).jpeg({ quality: 85 }).toBuffer()

/** A "CHO THUÊ" text card: white ground, a few black bars where the letters would be. */
async function textCard(width = 800, height = 600): Promise<Buffer> {
  const bars = [0.3, 0.45, 0.6].map((y) => ({
    input: { create: { width: Math.round(width * 0.6), height: Math.round(height * 0.08), channels: 3 as const, background: '#111111' } },
    left: Math.round(width * 0.2), top: Math.round(height * y),
  }))
  return sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).composite(bars).jpeg({ quality: 85 }).toBuffer()
}
/** A portal logo uploaded as a "photo": one orange mark on a plain ground. */
async function logo(width = 900, height = 600): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .composite([{ input: { create: { width: 420, height: 160, channels: 3, background: '#ff8800' } }, left: 240, top: 220 }])
    .png().toBuffer()
}

describe('imageVerdict — muaban’s measured thresholds', () => {
  it('real photos pass; text cards fail on entropy OR flatness; tiny and unmeasured images fail closed', () => {
    expect(imageVerdict({ width: 378, height: 504, entropy: 7.6, flat: 0.24 })).toBe('ok')
    expect(imageVerdict({ width: 232, height: 504, entropy: 7.16, flat: 0.2 })).toBe('ok')           // muaban's real portrait
    expect(imageVerdict({ width: 672, height: 504, entropy: 3.86, flat: 0.74 })).toBe('placeholder') // muaban:71117474's card
    expect(imageVerdict({ width: 672, height: 504, entropy: 3.86, flat: 0.5 })).toBe('placeholder')  // entropy alone
    expect(imageVerdict({ width: 672, height: 504, entropy: 6.2, flat: 0.82 })).toBe('placeholder')  // flatness alone
    expect(imageVerdict({ width: 672, height: 504, entropy: 5.81, flat: 0.57 })).toBe('ok')          // a white-tiled room
    expect(imageVerdict({ width: 200, height: 200, entropy: 7, flat: 0.2 })).toBe('tooSmall')
    expect(imageVerdict({ width: 800, height: 600, entropy: NaN, flat: 0.2 })).toBe('undecodable')
    expect(imageVerdict({ width: 800, height: 600, entropy: 7 })).toBe('undecodable')
    expect(imageVerdict(null)).toBe('undecodable')
  })

  it('the default floor is the long edge only; a caller can add a short-edge floor', () => {
    const portrait = { width: 232, height: 504, entropy: 7.2, flat: 0.2 }
    expect(imageVerdict({ ...portrait, height: MIN_IMAGE_LONG_EDGE - 1 })).toBe('tooSmall')
    expect(imageVerdict(portrait)).toBe('ok')
    expect(imageVerdict(portrait, { minShortEdge: 300 })).toBe('tooSmall')
    expect(imageVerdict(portrait, { minLongEdge: 600 })).toBe('tooSmall')
    expect(imageVerdict({ ...portrait, width: 400 }, { minShortEdge: 300, minLongEdge: 500 })).toBe('ok')
  })
})

describe('flatnessOf / galleryPlan / dropNearDuplicates', () => {
  it('one flat colour is 1.0, noise is near 0, too few channels is NaN', () => {
    expect(flatnessOf(new Uint8Array(64 * 64 * 3).fill(250), 3)).toBe(1)
    expect(flatnessOf(noise(64, 64, 3, 7), 3)).toBeLessThan(0.05)
    expect(Number.isNaN(flatnessOf(new Uint8Array(64 * 64), 1))).toBe(true)
  })

  it('a text-card cover hands the cover to the first real photo; a failed fetch fails the row', () => {
    expect(galleryPlan(['placeholder', 'ok', 'ok'])).toEqual({ keep: [1, 2], refused: { placeholder: 1 }, failed: false })
    expect(galleryPlan(['ok', 'tooSmall', 'placeholder'])).toEqual({ keep: [0], refused: { tooSmall: 1, placeholder: 1 }, failed: false })
    expect(galleryPlan(['ok', 'fetchFailed']).failed).toBe(true)
    expect(galleryPlan(['ok', 'undecodable']).failed).toBe(true)
  })

  it('the same shot twice is one photo (the publish gate’s distinct-angle threshold); no hash = distinct', () => {
    const a = '0123456789abcdef', aNear = '0123456789abcdee', b = 'fedcba9876543210'
    expect(dropNearDuplicates([0, 1, 2], [a, aNear, b])).toEqual({ keep: [0, 2], duplicates: 1 })
    expect(dropNearDuplicates([0, 2], [a, a, b])).toEqual({ keep: [0, 2], duplicates: 0 })   // only kept indices count
    expect(dropNearDuplicates([0, 1], [null, null])).toEqual({ keep: [0, 1], duplicates: 0 })
  })
})

describe('measureImage — real decodes', () => {
  it('a photo-like image is ok; a text card and a logo are placeholders; a thumbnail is too small', async () => {
    const photo = await measureImage(await jpeg(noise(800, 600, 3, 1), 800, 600, 3))
    expect(photo).toMatchObject({ width: 800, height: 600 })
    expect(imageVerdict(photo)).toBe('ok')
    expect(imageVerdict(await measureImage(await textCard()))).toBe('placeholder')
    expect(imageVerdict(await measureImage(await logo()))).toBe('placeholder')
    expect(imageVerdict(await measureImage(await jpeg(noise(160, 120, 3, 2), 160, 120, 3)))).toBe('tooSmall')
  })

  it('a one-channel greyscale JPEG is measured, not failed as undecodable', async () => {
    const bw = await sharp(noise(800, 600, 1, 3), { raw: { width: 800, height: 600, channels: 1 } }).toColourspace('b-w').jpeg().toBuffer()
    expect((await sharp(bw).metadata()).channels).toBe(1)
    const grey = await measureImage(bw)
    expect(Number.isFinite(grey?.flat)).toBe(true)
    expect(imageVerdict(grey)).toBe('ok')
  })

  it('one-channel and grey+alpha PNGs and a CMYK JPEG are measured with three channels, never undecodable', async () => {
    const raw = noise(800, 600, 1, 5)
    const ga = Buffer.alloc(800 * 600 * 2)
    for (let i = 0; i < 800 * 600; i++) { ga[2 * i] = raw[i]; ga[2 * i + 1] = 255 }
    const cases = [
      await sharp(raw, { raw: { width: 800, height: 600, channels: 1 } }).toColourspace('b-w').png().toBuffer(),
      await sharp(ga, { raw: { width: 800, height: 600, channels: 2 } }).toColourspace('b-w').png().toBuffer(),
      await sharp(await jpeg(noise(800, 600, 3, 6), 800, 600, 3)).toColourspace('cmyk').jpeg().toBuffer(),
    ]
    expect((await sharp(cases[0]).metadata()).channels).toBe(1)
    expect((await sharp(cases[1]).metadata()).channels).toBe(2)
    expect((await sharp(cases[2]).metadata()).space).toBe('cmyk')
    for (const buf of cases) {
      const m = await measureImage(buf)
      expect(Number.isFinite(m?.flat)).toBe(true)
      expect(imageVerdict(m)).not.toBe('undecodable')
    }
  })

  // Both reviewers expected a transparent logo whose hidden pixels hold noise to pass as a busy photo.
  // Measured: it does not — the thumbnail's resize premultiplies alpha, so `flat` reads ~0.98.
  it('⛔ a transparent logo is a placeholder, whatever noise its hidden pixels hold', async () => {
    const w = 800, h = 600
    const rgba = Buffer.alloc(w * h * 4)
    const rgb = noise(w, h, 3, 31)
    for (let i = 0; i < w * h; i++) {
      rgba.set(rgb.subarray(i * 3, i * 3 + 3), i * 4)
      const x = i % w, y = Math.floor(i / w)
      const inLogo = x >= 240 && x < 560 && y >= 240 && y < 360
      if (inLogo) rgba.set([255, 136, 0], i * 4)
      rgba[i * 4 + 3] = inLogo ? 255 : 0
    }
    const png = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
    expect(imageVerdict(await measureImage(png))).toBe('placeholder')
  })

  it('⛔ bytes that are not an image are null → undecodable (fails closed)', async () => {
    const m = await measureImage(Buffer.from('<html>Just a moment…</html>'))
    expect(m).toBeNull()
    expect(imageVerdict(m)).toBe('undecodable')
  })

  it('the hash sees a re-encode as the same photo and a different photo as different', async () => {
    const raw = noise(640, 480, 3, 11)
    const [one, again, other] = await Promise.all([
      measureImage(await jpeg(raw, 640, 480, 3)),
      measureImage(await sharp(raw, { raw: { width: 640, height: 480, channels: 3 } }).resize(512).png().toBuffer()),
      measureImage(await jpeg(noise(640, 480, 3, 12), 640, 480, 3)),
    ])
    expect(one?.hash).toMatch(/^[0-9a-f]{16}$/)
    expect(dropNearDuplicates([0, 1, 2], [one?.hash, again?.hash, other?.hash])).toEqual({ keep: [0, 2], duplicates: 1 })
  })
})

/**
 * ⛔ THE PREDICTED HASH IS THE HASH THE HOST WRITES. The importer drops near-duplicates BEFORE upload
 * and the publish gate counts distinct angles AFTER it, from the hash in each stored filename; if the
 * two hashes differ the prediction is wrong. A one-pipeline shortcut differed by up to 10 bits (the
 * whole threshold) on real photos, so this compares against the real makeImageHost, with a fake
 * bucket, on the shapes that take different paths (small, larger than the 1600 edge, EXIF-rotated,
 * transparent) and on real photographs.
 */
describe('measureImage — hash parity with the image host', () => {
  it('equals the dHash makeImageHost writes into the stored filename', async () => {
    const host = makeImageHost({
      storage: { upload: async () => ({ error: null }) },
      storageUrl: 'https://storage.test', bucket: 'listings', edge: HOST_EDGE, quality: 82, mark: 'overlay',
    })
    const rgba = Buffer.alloc(700 * 500 * 4)
    const rgb = noise(700, 500, 3, 9)
    for (let i = 0; i < 700 * 500; i++) { rgba.set(rgb.subarray(i * 3, i * 3 + 3), i * 4); rgba[i * 4 + 3] = i % 7 ? 255 : 90 }
    const shapes: [string, Buffer][] = [
      ['small jpeg', await jpeg(noise(672, 504, 3, 21), 672, 504, 3)],
      ['over the edge', await jpeg(noise(2400, 1800, 3, 22), 2400, 1800, 3)],
      ['EXIF-rotated', await sharp(await jpeg(noise(900, 600, 3, 23), 900, 600, 3)).withMetadata({ orientation: 6 }).jpeg().toBuffer()],
      ['transparent png', await sharp(rgba, { raw: { width: 700, height: 500, channels: 4 } }).png().toBuffer()],
      // REAL photographs, tracked in the repo: the synthetic scenes above hash the same either way,
      // and these three are where the one-pipeline shortcut measured 5, 5 and 9 bits off.
      ['share-card.jpg', readFileSync('public/og/share-card.jpg')],
      ['consent-team.webp', readFileSync('public/consent-team.webp')],
      ['gmbr-desktop.webp', readFileSync('public/banners/gmbr-desktop.webp')],
    ]
    // The EXIF-rotated 900x600 is reported upright, as the host stores it.
    expect(await measureImage(shapes[2][1])).toMatchObject({ width: 600, height: 900 })
    for (const [name, buf] of shapes) {
      const url = await host.fromBuffer(buf, 'parity')
      expect(url, name).toBeTruthy()
      expect((await measureImage(buf))?.hash, name).toBe(hashFromUrl(url!))
    }
  }, 60_000)
})

describe('galleryPlan — an all-refused gallery', () => {
  it('is "nothing real" (keep: [], failed: false), not a failure; the caller applies its minimum', () => {
    expect(galleryPlan(['placeholder', 'tooSmall'])).toEqual({ keep: [], refused: { placeholder: 1, tooSmall: 1 }, failed: false })
    expect(galleryPlan([])).toEqual({ keep: [], refused: {}, failed: false })
  })
})
