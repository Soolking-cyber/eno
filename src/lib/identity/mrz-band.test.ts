import { describe, it, expect } from 'vitest'
import { findMrzBand } from './mrz-band'

// ── Synthetic passport imagery ───────────────────────────────────────────────────────────────────
// Real captures live in mrz-ocr.test.ts as OCR TEXT, which is all that module needs. This one needs
// PIXELS, and a photograph cannot be inlined — so the fixtures are drawn. Each one isolates one
// property the locator claims: where the MRZ is, what is NOT an MRZ, and the two lighting/framing
// failures the plan reviewers named (a dark desk, and a passport small inside a wide photo).

type Img = { width: number; height: number; data: Uint8ClampedArray }

function makeImage(width: number, height: number, bg = 255): Img {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) { data[i] = data[i + 1] = data[i + 2] = bg; data[i + 3] = 255 }
  return { width, height, data }
}

function fill(img: Img, x0: number, y0: number, x1: number, y1: number, v: number) {
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x++) {
      const i = (y * img.width + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    }
  }
}

/** Two rows of dashed glyphs — the MRZ's actual signature: dense, uniform, nearly the full width. */
function drawMrz(img: Img, x0: number, x1: number, yTop: number, lineH: number, gap: number, ink = 30) {
  for (const y of [yTop, yTop + lineH + gap]) {
    for (let x = x0; x < x1; x += 4) fill(img, x, y, x + 3, y + lineH, ink)
  }
}

/** The centre of a returned band, in fractions — the thing a crop actually has to get right. */
const midY = (b: { top: number; height: number }) => b.top + b.height / 2

describe('findMrzBand', () => {
  it('returns null without pixel data — the caller then uses its fixed bands', () => {
    expect(findMrzBand({ width: 800, height: 600 })).toBeNull()
    expect(findMrzBand({ width: 10, height: 10, data: new Uint8ClampedArray(400) })).toBeNull()
  })

  it('returns null on a blank page — nothing to lock onto', () => {
    expect(findMrzBand(makeImage(400, 282))).toBeNull()
  })

  it('finds the MRZ on a cropped data page, ignoring the portrait above it', () => {
    // The tight guide crop the live camera produces: a 1.42 data page, portrait top-left, MRZ at the
    // bottom. The portrait is a big block of ink and must NOT be mistaken for the band.
    const img = makeImage(400, 282)
    fill(img, 20, 40, 120, 200, 60)          // the holder's photo
    for (let y = 50; y < 190; y += 14) fill(img, 150, y, 360, y + 6, 70) // the printed VIZ fields
    drawMrz(img, 20, 380, 232, 12, 6)
    const band = findMrzBand(img)
    expect(band).not.toBeNull()
    // The MRZ spans y 232..262 of 282 → its centre is at ~0.876.
    expect(midY(band!)).toBeGreaterThan(0.78)
    expect(midY(band!)).toBeLessThan(0.98)
    expect(band!.height).toBeLessThan(0.35) // a BAND, not "the bottom third of the page"
  })

  it('⛔ finds it in a WHOLE PHOTO — the file-picker case the fixed band cannot serve', () => {
    // A phone photo: passport in the middle of a desk. The MRZ centre lands near y≈0.72, so the fixed
    // bottom-30% band (0.70–1.00) barely clips it and the read fails. This is the whole reason the
    // module exists.
    const img = makeImage(800, 600, 205)     // a light desk
    fill(img, 150, 120, 650, 470, 250)       // the passport page
    fill(img, 175, 150, 275, 320, 60)        // portrait
    for (let y = 160; y < 300; y += 16) fill(img, 300, y, 620, y + 6, 70)
    drawMrz(img, 175, 630, 408, 12, 7)
    const band = findMrzBand(img)
    expect(band).not.toBeNull()
    expect(midY(band!)).toBeGreaterThan(0.62)
    expect(midY(band!)).toBeLessThan(0.82)
    // Cropped to the DOCUMENT, not the desk beside it: the page spans x 150..650 of 800.
    expect(band!.left).toBeGreaterThan(0.10)
    expect(band!.left + band!.width).toBeLessThan(0.92)
  })

  it('⛔ a DARK DESK does not become the band (stroke count, not ink fraction)', () => {
    // fable's finding against the first draft, and the reason the row signature is STROKE COUNT. A
    // global Otsu split separates page from desk, so the desk reads as solid ink and the scan locks
    // onto the table; a local threshold fixes that but then marks the PAGE EDGE as ink on every row,
    // so the whole page height becomes one run and the shape gates reject it. Counting separate
    // strokes tells them apart — an MRZ row is a hundred-odd, a page edge is two.
    const img = makeImage(800, 600, 35)      // a near-black desk
    fill(img, 150, 100, 650, 450, 250)
    fill(img, 175, 130, 275, 300, 60)
    drawMrz(img, 175, 630, 392, 12, 7)
    const band = findMrzBand(img)
    expect(band).not.toBeNull()
    expect(midY(band!)).toBeGreaterThan(0.60)
    expect(midY(band!)).toBeLessThan(0.80)   // NOT ~0.95, which is where the desk would put it
  })

  it('⚠️ its band ALSO answers "is this already a cropped page?" — the pass order depends on it', () => {
    // readMrz asks one thing of this result — "would the fixed tight band (top 0.70) CONTAIN it?" — to
    // decide whether that band goes FIRST (a camera still, already a data page) or the located one
    // does (a picked file, where the tight band clips the MRZ). Both answers are pinned here, because
    // getting this backwards spends the whole budget on a band that cannot work.
    const page = makeImage(400, 282)
    fill(page, 20, 40, 120, 200, 60)
    drawMrz(page, 20, 380, 232, 12, 6)
    const cropped = findMrzBand(page)!
    // BOTH halves of readMrz's test: inside MRZ_BAND vertically, and already wide enough that leading
    // with the located crop would buy no extra MRZ pixels.
    expect(cropped.top).toBeGreaterThanOrEqual(0.68)
    expect(cropped.width).toBeGreaterThanOrEqual(0.75)

    const photo = makeImage(800, 600, 205)
    fill(photo, 150, 120, 650, 470, 250)
    fill(photo, 175, 150, 275, 320, 60)
    drawMrz(photo, 175, 630, 408, 12, 7)
    const inPhoto = findMrzBand(photo)!
    expect(inPhoto.top).toBeLessThan(0.68) // outside it → the located band leads instead
  })

  it('costs a fraction of one OCR call on a full-size capture', () => {
    // It runs on the main thread before the first Tesseract call, so a slow locator would delay every
    // read on every device. A 2400×1800 capture is the largest input the pipeline produces.
    const big = makeImage(2400, 1800)
    fill(big, 100, 200, 700, 1150, 60)
    drawMrz(big, 100, 2300, 1450, 40, 20)
    const t0 = performance.now()
    findMrzBand(big)
    expect(performance.now() - t0).toBeLessThan(400) // typically ~40ms; the bound is CI headroom
  })

  it('⛔ REAL TD3 GEOMETRY: the gap between the two lines is wider than the glyphs', () => {
    // fable, against the first draft: on an 88mm data page the two MRZ lines are ~2.8mm of glyph with
    // ~3.8mm of white between them — the GAP is WIDER THAN THE LINE. A tolerance expressed as a
    // fraction of the page (3%) is below that, so the walk-up stopped inside the gap, kept line 2
    // alone, and a single line then failed the run-height floor. The other fixtures here draw a
    // forgiving gap of half a line height, which no passport has; this one is to scale.
    const img = makeImage(400, 282)         // 400×282 ≈ a 125×88mm data page
    fill(img, 20, 40, 120, 180, 60)
    const lineH = 9                          // 2.8mm of 88mm ≈ 3.2% of the height
    const gap = 12                           // 3.8mm ≈ 4.3% — wider than the line itself
    drawMrz(img, 20, 380, 228, lineH, gap)
    const band = findMrzBand(img)
    expect(band).not.toBeNull()
    // BOTH lines: the band must span y 228..258 of 282, not just the bottom one at 249..258.
    expect(band!.top).toBeLessThan(228 / 282)
    expect(band!.top + band!.height).toBeGreaterThan(257 / 282)
  })

  it('⛔ does NOT swallow the printed fields above the MRZ', () => {
    // The mirror of the test above: the tolerance has to bridge the inter-line gap WITHOUT reaching
    // the visual inspection zone, or the band stops being a band.
    const img = makeImage(400, 282)
    for (let y = 120; y < 200; y += 16) fill(img, 150, y, 360, y + 6, 70) // printed fields
    drawMrz(img, 20, 380, 228, 9, 12)
    const band = findMrzBand(img)
    expect(band).not.toBeNull()
    expect(band!.top).toBeGreaterThan(200 / 282) // below the last printed line, not merged with it
  })

  it('⛔ looks PAST a false run below the MRZ instead of giving up on it', () => {
    // codex: examining only the bottom-most run means a caption, a table edge or desk texture BELOW
    // the passport swallows the whole answer — the run fails a shape gate and the locator returns
    // null on an image whose MRZ was sitting right above it, unexamined.
    const img = makeImage(400, 320)
    fill(img, 20, 40, 120, 180, 60)
    drawMrz(img, 20, 380, 196, 9, 12)          // the real MRZ
    // ⚠️ THE DECOY IS TEXTURED, NOT A SOLID BLOCK. fable: under a LOCAL threshold a solid fill is not
    // ink at all — only its two edges are — so a filled rectangle never becomes a candidate run and
    // the gate this test is named for never executes. Only patterned ink exercises it.
    for (let y = 280; y < 316; y += 3) for (let x = 160; x < 240; x += 4) fill(img, x, y, x + 2, y + 2, 60)
    const band = findMrzBand(img)
    expect(band).not.toBeNull()
    expect(midY(band!)).toBeGreaterThan(0.58)
    expect(midY(band!)).toBeLessThan(0.80)     // the MRZ at y≈200..230 of 320, not the blob at ≈300
  })

  it('rejects a tall block of text — the aspect gate', () => {
    // A paragraph, a shadow or a hand is ink at the bottom of the frame too. An MRZ is many times
    // wider than it is tall; nothing else in this flow is.
    // ⚠️ TEXTURED for the same reason as above — a solid block is invisible to a local threshold, so
    // it would pass this test without the aspect gate ever running.
    const img = makeImage(400, 282)
    for (let y = 150; y < 270; y += 3) for (let x = 150; x < 250; x += 4) fill(img, x, y, x + 2, y + 2, 60)
    expect(findMrzBand(img)).toBeNull()
  })

  it('rejects ink confined to the TOP of the frame', () => {
    // The MRZ is at the bottom of a passport page, always. Ink that is only high in the frame is
    // something else — a header, a caption, the top edge of a table.
    const img = makeImage(400, 282)
    drawMrz(img, 20, 380, 30, 12, 6)
    expect(findMrzBand(img)).toBeNull()
  })

  it('survives heavy downscaling of thin strokes (area averaging, not decimation)', () => {
    // codex/fable: at 5-7× reduction, nearest-neighbour sampling drops one-pixel MRZ strokes entirely
    // and the band fragments. This fixture is what forced BOTH the area averaging and the working
    // width: at 360 the strokes averaged into a uniform grey stripe with no local contrast left to
    // threshold, and the band measured as empty.
    const img = makeImage(2400, 1690)
    fill(img, 120, 240, 720, 1200, 60)
    for (let y = 1380; y < 1560; y += 100) {
      for (let x = 120; x < 2280; x += 7) fill(img, x, y, x + 1, y + 60, 30) // 1px strokes
    }
    const band = findMrzBand(img)
    expect(band).not.toBeNull()
    expect(midY(band!)).toBeGreaterThan(0.78)
    expect(midY(band!)).toBeLessThan(0.98)
  })
})
