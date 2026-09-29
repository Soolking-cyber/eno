import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import {
  COVER_CANDIDATES, MARK_POOL_MIN, MARK_VISIBLE, MARK_WINDOW_H, MARK_WINDOW_W, PHOTO_INPUT_PIXELS,
  coverByMark, fetchStoredImage, markScore, markSeedUrls, markTemplate, markWindowOf, type MarkWindow,
} from './import-photo-mark'
import { HOST_EDGE, measureImage } from './import-photo-check'

/**
 * The burned-mark score (import-photo-mark.ts). The real portal photos it was calibrated on are NOT
 * in the repo (third-party photos stay out); these cases stamp a SYNTHETIC mark — white strokes at
 * partial opacity, centred, at a fixed pixel size, which is what both portals do — over synthetic
 * scenes and over the real photographs the repo already tracks.
 */

/**
 * A deterministic photo-like greyscale scene — low-frequency light and shade under grain — evaluated
 * only where it is asked for (`x0,y0` → `w×h` of a `width×height` photo), so a 1024-px photo's centre
 * window costs 30k pixels, not a million.
 */
function scene(width: number, height: number, seed: number, base = 128, grain = 60, x0 = 0, y0 = 0, w = width, h = height): Uint8Array {
  /** mulberry32, not an LCG: consecutive LCG seeds give grain that differs by the SAME offset
   *  sequence at every pixel — a shared pattern the template would rightly learn as a "mark". */
  let a = Math.imul(seed, 2654435761) >>> 0
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const fx = 1 + rnd() * 3, fy = 1 + rnd() * 3, px = rnd() * 6.28
  const out = new Uint8Array(w * h)
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const gx = x0 + xx, gy = y0 + yy
    const light = base + 60 * Math.sin((gx / width) * fx * 3.14 + px) * Math.cos((gy / height) * fy * 3.14)
    out[yy * w + xx] = Math.max(0, Math.min(255, Math.round(light + (rnd() - 0.5) * grain)))
  }
  return out
}

/**
 * The stamp's strokes, relative to its own top-left: a 150x36 "wordmark" of 4-px strokes (seven
 * letter-like glyphs of verticals, bars and a diagonal). No font — a CI box may have none installed.
 */
const STAMP_W = 150, STAMP_H = 36
function onStamp(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= STAMP_W || y >= STAMP_H) return false
  const g = Math.floor(x / 22), gx = x % 22
  if (gx >= 18) return false
  const v = gx < 4 || (g % 2 === 0 && gx >= 14)
  const bar = (y < 4 || (g % 3 === 1 && y >= 16 && y < 20) || (g % 3 === 2 && y >= 32))
  const diag = g === 3 && Math.abs(gx - y / 2) < 2
  return v || bar || diag
}
/**
 * Stamp white strokes at `alpha` onto `px` (a `w×h` region whose top-left is `x0,y0` of a
 * `width×height` photo), centred on the PHOTO — what the portals do, at a fixed pixel size.
 */
function stamp(px: Uint8Array, width: number, height: number, alpha = 0.55, x0 = 0, y0 = 0, w = width, h = height): Uint8Array {
  const out = Uint8Array.from(px)
  const left = Math.floor(width / 2 - STAMP_W / 2), top = Math.floor(height / 2 - STAMP_H / 2)
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    if (onStamp(x0 + xx - left, y0 + yy - top)) out[yy * w + xx] = Math.round((1 - alpha) * out[yy * w + xx] + alpha * 255)
  }
  return out
}
/** The centre window markWindowOf cuts from a `width×height` photo, built directly (scene + stamp). */
function photoWindow(width: number, height: number, seed: number, opts: { base?: number; grain?: number; stamped?: boolean } = {}): MarkWindow {
  const w = Math.min(MARK_WINDOW_W, width), h = Math.min(MARK_WINDOW_H, height)
  const x0 = Math.floor((width - w) / 2), y0 = Math.floor((height - h) / 2)
  const bg = scene(width, height, seed, opts.base ?? 128, opts.grain ?? 60, x0, y0, w, h)
  const data = opts.stamped === false ? bg : stamp(bg, width, height, 0.55, x0, y0, w, h)
  return { width: w, height: h, imageWidth: width, imageHeight: height, data }
}
const SIZES: [number, number][] = [[768, 1024], [1024, 768], [672, 504], [460, 1024], [504, 378]]
/** One source's pool: `n` different ads, every photo stamped (or not), sizes varying like the portals'. */
function pool(n: number, stamped: boolean, seed0 = 100): MarkWindow[] {
  return Array.from({ length: n }, (_, k) => {
    const [w, h] = SIZES[k % SIZES.length]
    return photoWindow(w, h, seed0 + k, { base: 60 + ((k * 37) % 150), stamped })
  })
}

describe('markTemplate — the mark is what a source\'s photos share at the centre', () => {
  const t = markTemplate(pool(MARK_POOL_MIN + 4, true))

  it('learns a fixed-size centred stamp across photo sizes, and measures its width', () => {
    expect(t.why).toBeNull()
    expect(t.template!.snr).toBeGreaterThan(5)
    expect(Math.abs(t.template!.strokeWidth - STAMP_W)).toBeLessThanOrEqual(12)
  })

  it('⛔ finds NOTHING in photos with no stamp — null, never a guess', () => {
    const none = markTemplate(pool(MARK_POOL_MIN + 4, false))
    expect(none.template).toBeNull()
    expect(none.why).toBe('noCentredMark')
  })

  it('⛔ refuses a pool too small to average room content away', () => {
    expect(markTemplate(pool(MARK_POOL_MIN - 1, true))).toMatchObject({ template: null, why: 'poolTooSmall' })
  })
})

describe('markScore — how much the stamp SHOWS on one photo', () => {
  const t = markTemplate(pool(MARK_POOL_MIN + 4, true)).template!

  it('a stamp on a dark, plain floor shows; the same stamp on a white wall does not', () => {
    const onDark = markScore(photoWindow(768, 1024, 7, { base: 70, grain: 12 }), t)!
    const onWhite = markScore(photoWindow(768, 1024, 7, { base: 235, grain: 12 }), t)!
    expect(onDark).toBeGreaterThanOrEqual(MARK_VISIBLE)
    expect(onWhite).toBeLessThan(MARK_VISIBLE)
  })

  it('a busy surface hides the same stamp (the score falls with the clutter around it)', () => {
    const plain = markScore(photoWindow(768, 1024, 9, { base: 110, grain: 10 }), t)!
    const busy = markScore(photoWindow(768, 1024, 9, { base: 110, grain: 160 }), t)!
    expect(busy).toBeLessThan(plain)
  })

  it('the same stamp spans more of a narrow portrait\'s square card, so it scores higher there', () => {
    const narrow = markScore(photoWindow(460, 1024, 11, { base: 90, grain: 20 }), t)!
    const wide = markScore(photoWindow(1024, 768, 11, { base: 90, grain: 20 }), t)!
    expect(narrow).toBeGreaterThan(wide)
  })

  it('no window, or a photo too small to hold the mark, is unscored (null)', () => {
    expect(markScore(null, t)).toBeNull()
    expect(markScore(photoWindow(90, 300, 3), t)).toBeNull()
  })
})

/**
 * THE PACKAGE ACCEPTANCE, ON REAL PHOTOGRAPHS: the stamped twin of a real photo scores higher than
 * the clean one, for ≥ 8 of 10. Ten 640x480 crops of the three photographs the repo tracks, each
 * decoded and measured by the SAME measureImage the importers run (a real encode → decode → window).
 */
describe('measureImage → markScore on real photographs (stamped vs clean twins)', () => {
  it('scores the stamped twin higher in at least 8 of 10', async () => {
    const t = markTemplate(pool(MARK_POOL_MIN + 4, true, 500)).template!
    const sources = ['public/og/share-card.jpg', 'public/consent-team.webp', 'public/banners/gmbr-desktop.webp']
    const crops: { raw: Uint8Array; width: number; height: number }[] = []
    for (const [k, file] of sources.entries()) {
      const { width = 0, height = 0 } = await sharp(readFileSync(file)).metadata()
      const cw = Math.min(640, width), ch = Math.min(480, height)
      for (const f of k === 0 ? [0, 0.5, 1, 0.25] : [0, 0.5, 1]) {
        const left = Math.round((width - cw) * f), top = Math.round((height - ch) * (1 - f))
        const raw = await sharp(readFileSync(file)).extract({ left, top, width: cw, height: ch }).greyscale().raw().toBuffer()
        crops.push({ raw: new Uint8Array(raw), width: cw, height: ch })
      }
    }
    expect(crops).toHaveLength(10)
    let higher = 0
    for (const { raw, width, height } of crops) {
      const encode = (px: Uint8Array) => sharp(Buffer.from(px), { raw: { width, height, channels: 1 } }).jpeg({ quality: 88 }).toBuffer()
      const [a, b] = await Promise.all([measureImage(await encode(stamp(raw, width, height)), { markWindow: true }), measureImage(await encode(raw), { markWindow: true })])
      if ((markScore(a?.markWindow, t) ?? -Infinity) > (markScore(b?.markWindow, t) ?? Infinity)) higher++
    }
    expect(higher).toBeGreaterThanOrEqual(8)
  }, 60_000)
})

describe('markWindowOf — the centre as the host stores it', () => {
  it('cuts the centred window; a photo past the host edge is measured at the stored size', async () => {
    const big = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#406080' } }).jpeg().toBuffer()
    expect(await markWindowOf(big, HOST_EDGE)).toMatchObject({ width: MARK_WINDOW_W, height: MARK_WINDOW_H, imageWidth: 1600, imageHeight: 1200 })
    const small = await sharp({ create: { width: 200, height: 80, channels: 3, background: '#ffffff' } }).png().toBuffer()
    expect(await markWindowOf(small, HOST_EDGE)).toMatchObject({ width: 200, height: 80, imageWidth: 200, imageHeight: 80 })
  })

  it('an EXIF-rotated photo is measured upright; bytes that are not an image are null', async () => {
    const rotated = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#808080' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer()
    expect(await markWindowOf(rotated, HOST_EDGE)).toMatchObject({ imageWidth: 600, imageHeight: 900 })
    expect(await markWindowOf(Buffer.from('<html>Just a moment…</html>'), HOST_EDGE)).toBeNull()
  })

  it('measureImage carries the window it cut — only when asked (--cover-by-mark), so a run without it pays no extra decode', async () => {
    const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#ff8800' } }).png().toBuffer()
    const m = await measureImage(png, { markWindow: true })
    expect(m?.markWindow).toMatchObject({ width: MARK_WINDOW_W, height: MARK_WINDOW_H, imageWidth: 800, imageHeight: 600 })
    const plain = await measureImage(png)
    expect(plain).not.toBeNull()
    expect(plain?.markWindow).toBeUndefined()
  })

  it('⛔ one pixel bound for every decode: markWindowOf refuses what measureImage refuses', async () => {
    expect(PHOTO_INPUT_PIXELS).toBe(50_000_000)
    const src = readFileSync('src/lib/import-photo-mark.ts', 'utf8') + readFileSync('src/lib/import-photo-check.ts', 'utf8')
    expect(src).not.toMatch(/limitInputPixels: \d/)
    // Past the bound (sharp reads the size from the header, so a 8000×8000 PNG is cheap to make here).
    const huge = await sharp({ create: { width: 8000, height: 8000, channels: 3, background: '#000000' } }).png({ compressionLevel: 9 }).toBuffer()
    expect(await markWindowOf(huge, HOST_EDGE)).toBeNull()
    expect(await measureImage(huge, { markWindow: true })).toBeNull()
  }, 30_000)
})

describe('coverByMark — the lowest score among the first photos becomes the cover', () => {
  it('picks the lowest-scoring of the first three; the rest keep the source order', () => {
    expect(coverByMark([0, 1, 2, 3], [3, 2.1, 0.8, 0.1])).toMatchObject({ keep: [2, 0, 1, 3], moved: { from: 2, was: 3, now: 0.8 } })
    // Only the first COVER_CANDIDATES may lead — the fourth photo is often the bathroom.
    expect(COVER_CANDIDATES).toBe(3)
    // The indices are the KEPT photos (a refused text card is simply absent).
    expect(coverByMark([1, 3, 4], [null, 2.4, null, 2.6, 0.5]).keep).toEqual([4, 1, 3])
  })

  it('leaves the cover alone when its stamp does not show, or nothing is clearly cleaner', () => {
    expect(coverByMark([0, 1, 2], [MARK_VISIBLE - 0.1, 0, 0])).toMatchObject({ keep: [0, 1, 2], moved: null, why: 'mark not visible on the cover' })
    expect(coverByMark([0, 1, 2], [2, 1.5, 1.4]).moved).toBeNull()   // 30% less: under the 35% bar
    expect(coverByMark([0, 1, 2], [2, 1.3, 1.29]).moved).toMatchObject({ from: 2 })
  })

  it('⛔ an unscored photo never becomes the cover, and an unscored cover is never replaced', () => {
    expect(coverByMark([0, 1, 2], [3, null, undefined]).moved).toBeNull()
    expect(coverByMark([0, 1, 2], [null, 0, 0])).toMatchObject({ moved: null, why: 'cover not scored' })
    expect(coverByMark([0, 1], [3, NaN]).moved).toBeNull()
    expect(coverByMark([0], [3]).why).toBe('one photo')
  })

  it('ties go to the photo the poster put first', () => {
    expect(coverByMark([0, 1, 2], [3, 1, 1]).keep).toEqual([1, 0, 2])
  })
})

describe('markSeedUrls', () => {
  it('takes the first photos of each stored row that the caller accepts, and skips junk JSON', () => {
    const ok = (u: string) => u.startsWith('https://sb.eno.vn/')
    const rows = [
      JSON.stringify(['https://sb.eno.vn/a1', 'https://sb.eno.vn/a2', 'https://sb.eno.vn/a3', 'https://sb.eno.vn/a4']),
      JSON.stringify(['https://elsewhere.test/b1', 'https://sb.eno.vn/b2']),
      'not json', JSON.stringify({ not: 'an array' }), JSON.stringify([1, null]),
    ]
    expect(markSeedUrls(rows, ok)).toEqual(['https://sb.eno.vn/a1', 'https://sb.eno.vn/a2', 'https://sb.eno.vn/a3', 'https://sb.eno.vn/b2'])
    expect(markSeedUrls(rows, ok, 1)).toEqual(['https://sb.eno.vn/a1', 'https://sb.eno.vn/b2'])
  })
})

describe('fetchStoredImage — ⛔ the byte cap holds WHILE reading', () => {
  /** A fake fetch whose body is `chunks` pulled one at a time; `pulled` counts what was actually read. */
  const fakeFetch = (chunks: Uint8Array[], headers: Record<string, string>, status = 200) => {
    const state = { pulled: 0, cancelled: false }
    const f = (async () => {
      let i = 0
      const body = new ReadableStream<Uint8Array>({
        pull(c) { if (i < chunks.length) { state.pulled++; c.enqueue(chunks[i++]) } else c.close() },
        cancel() { state.cancelled = true },
      }, { highWaterMark: 0 })   // pull only on read, so `pulled` is what the reader asked for
      return new Response(body, { status, headers })
    }) as unknown as typeof fetch
    return { f, state }
  }
  const kb = (n: number) => new Uint8Array(n * 1024).fill(7)

  it('returns the whole body when it is an image within the cap', async () => {
    const { f } = fakeFetch([kb(1), kb(2)], { 'content-type': 'image/webp' })
    expect((await fetchStoredImage('https://x/a.webp', f, 10 * 1024))?.length).toBe(3 * 1024)
  })

  it('a declared content-length over the cap is refused before the body is read', async () => {
    const { f, state } = fakeFetch([kb(1)], { 'content-type': 'image/webp', 'content-length': String(50 * 1024) })
    expect(await fetchStoredImage('https://x/a.webp', f, 10 * 1024)).toBeNull()
    expect(state.pulled).toBe(0)
  })

  it('no (or a lying) content-length: counting stops the read at the cap, the rest is never pulled', async () => {
    const { f, state } = fakeFetch(Array.from({ length: 100 }, () => kb(4)), { 'content-type': 'image/webp' })
    expect(await fetchStoredImage('https://x/a.webp', f, 10 * 1024)).toBeNull()
    expect(state.pulled).toBeLessThanOrEqual(4)
    expect(state.cancelled).toBe(true)
    const lying = fakeFetch(Array.from({ length: 100 }, () => kb(4)), { 'content-type': 'image/webp', 'content-length': '1024' })
    expect(await fetchStoredImage('https://x/a.webp', lying.f, 10 * 1024)).toBeNull()
    expect(lying.state.pulled).toBeLessThanOrEqual(4)
  })

  it('not an image, not ok, or empty → null', async () => {
    expect(await fetchStoredImage('https://x/a', fakeFetch([kb(1)], { 'content-type': 'text/html' }).f)).toBeNull()
    expect(await fetchStoredImage('https://x/a', fakeFetch([kb(1)], { 'content-type': 'image/webp' }, 404).f)).toBeNull()
    expect(await fetchStoredImage('https://x/a', fakeFetch([], { 'content-type': 'image/webp' }).f)).toBeNull()
  })
})
