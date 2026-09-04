import type { ImageLike } from './mrz-ocr'

// ── LOCATING THE MRZ BAND IN AN ARBITRARY PHOTO ──────────────────────────────────────────────────
//
// ⛔ THE PROBLEM THIS EXISTS FOR. `MRZ_BAND` in mrz-ocr.ts is a FIXED bottom-30% crop, and it is
// correct for exactly one input: a still already cropped to the passport data page — which is what
// the live camera produces, because `capture()` crops to the on-screen guide frame. Every other way
// a document reaches us hands over a WHOLE PHOTO with the passport somewhere inside it:
//   · an iOS/Android in-app webview (Zalo, Facebook, Instagram — a large share of Vietnamese mobile
//     traffic) never grants getUserMedia, so those sellers land on the file picker;
//   · a remembered permission denial, a desktop with no camera, and the always-present
//     "Camera not working? Upload instead" button all end in the same picker.
// For all of them the MRZ sits wherever the photographer put it, and a fixed bottom-30% band reads
// the desk. The read then fails with `no_mrz_found` every single time, and the only way forward is
// hand-typing 88 characters of OCR-B on a phone.
//
// ⚠️ IT IS A CANDIDATE, NEVER AN AUTHORITY. readMrz keeps the known-good fixed band in the sweep
// whatever this returns — a wrong answer here costs OCR calls, never a correct read. Its ONE other
// job is to answer "does this image already look like a cropped data page?", which is what readMrz
// uses to decide whether the tight fixed band or the located one goes first. That framing is what
// makes a heuristic acceptable at all in an identity flow.
//
// ⚠️ PURE — NO CANVAS, NO DOM. Area-averaged subsampling straight off the RGBA buffer, so the whole
// thing is unit-testable in node against synthetic images. Everything downstream of OCR is still
// check-digit-graded, so this module cannot make a wrong read look right.

/** A crop rectangle in image fractions — the exact shape `OcrOptions['crop']` takes. */
export type MrzBand = { top: number; left: number; width: number; height: number }

/**
 * The working grid's width.
 *
 * ⚠️ NOT SMALLER, AND THE REASON IS RESOLUTION, NOT SPEED. An MRZ stroke is ~5px wide in a 2400px
 * capture; reduce that to a 360px grid and every stroke averages away into a uniformly grey stripe
 * with NO local contrast left to threshold — the band the module exists to find measures as empty
 * (caught by the heavy-downscale test). At 900 the same stroke survives as ~2px, which is what the
 * adaptive threshold needs. The cost is dominated by the area-average pass over the SOURCE pixels,
 * which is the same at any working width.
 */
const WORK_WIDTH = 900

// ── WHY THE ROW SIGNATURE IS STROKE COUNT, AND THE THRESHOLD LOCAL ───────────────────────────────────────────────────────────────────
//
// ⛔ NOT A GLOBAL THRESHOLD (Otsu or otherwise), AND THAT WAS THE FIRST DRAFT'S BUG. On a photo of a
// passport lying on a dark desk, one global split separates PAGE FROM DESK, not ink from paper — so
// every desk pixel reads as "ink", the whole page height becomes one run, and the shape gates throw
// it away (fable).
//
// ⛔ AND NOT A PER-ROW MEDIAN EITHER, WHICH WAS THE SECOND DRAFT'S BUG. That assumes ink is a
// MINORITY of its row — and an MRZ row is the one row in the image where it need not be. On a dense
// row the median lands inside the ink, the threshold drops below it, and the band the module exists
// to find measures as EMPTY. Measured against the synthetic data page in the tests: every MRZ row
// came back at 0.000 ink.
//
// So: BRADLEY-style adaptive thresholding along each row — a pixel is ink when it is meaningfully
// darker than the mean of a window around it. Uniform desk → nothing is ink, whatever its
// brightness. Paper with glyphs → the glyphs are ink, however many of them there are. Computed from
// a per-row prefix sum, so it is one pass over a 360-wide grid.
const WINDOW_DIVISOR = 16 // window radius = working width / 16 ≈ 22px ≈ two MRZ glyphs
const INK_RATIO = 0.88    // "meaningfully darker" — 12% below the local mean

/** How many contiguous texty runs to try, bottom-up, before giving up — see the loop in findMrzBand. */
const MAX_CANDIDATE_RUNS = 4

/** How much white, in multiples of the bottom line's own height, may separate the two MRZ lines. On a
 *  TD3 page that gap is ~1.4 line-heights; the gap up from the MRZ to the printed fields is over 2. */
const LINE_GAP_RATIO = 1.8

/** The value at `q` (0..1) of a sorted copy — used for the ADAPTIVE ink thresholds below. */
function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]
}

/**
 * Find the machine-readable zone in an arbitrary photo of a passport, or null when nothing in the
 * image looks like one.
 *
 * The MRZ has a signature no other part of a passport photo shares: two lines of dense, uniform,
 * full-width monospaced ink at the BOTTOM of the page. So:
 *   1. AREA-AVERAGE down to `WORK_WIDTH` and take Rec. 601 luma;
 *   2. threshold LOCALLY (a pixel against the mean of a window around it), then measure each row's
 *      INK FRACTION;
 *   3. score each row by how many separate STROKES it contains, not by how much ink — ⚠️ the ink
 *      FRACTION is the wrong signature: on a page photographed against a dark desk the adaptive
 *      threshold marks the page edge as ink on every single row, so the whole page height reads as
 *      one run and the shape gates below throw it away (the dark-desk test). Stroke COUNT separates
 *      them cleanly: an MRZ row is a hundred-odd strokes and a page edge is two. It is measured
 *      against an ADAPTIVE floor, a share of the 95th-percentile row rather than a fixed constant;
 *   4. walk UP from the bottom, taking each candidate in turn: the bottom line of text, plus ONE more
 *      above it when the white between them is in proportion to the line's own height;
 *   5. return the FIRST run that is short, wide, low in the frame, and far wider than it is tall —
 *      the four properties that separate an MRZ from a paragraph, a shadow or a dark border.
 */
export function findMrzBand(image: ImageLike): MrzBand | null {
  const { width: iw, height: ih, data } = image
  // No pixels (the unit tests' fake engine passes a bare {width,height}) or an image too small for
  // the row profile to mean anything → let the caller fall back to the fixed bands.
  if (!data || iw < 60 || ih < 60 || data.length < iw * ih * 4) return null

  // 1. Subsample to a working grid — by AREA AVERAGE, not by picking one pixel. ⚠️ Nearest-neighbour
  //    decimation at 5-7× drops MRZ strokes that are a pixel or two wide in a far-away phone photo,
  //    so whole MRZ rows fall under the ink floor and the band fragments (fable). Averaging the
  //    source block keeps a thin stroke as a proportionally darker destination pixel.
  const w = Math.min(WORK_WIDTH, iw)
  const h = Math.max(1, Math.round((ih * w) / iw))
  if (h < 40) return null
  const gray = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor((y * ih) / h)
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * ih) / h))
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor((x * iw) / w)
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * iw) / w))
      let sum = 0, n = 0
      for (let sy = sy0; sy < sy1 && sy < ih; sy++) {
        for (let sx = sx0; sx < sx1 && sx < iw; sx++) {
          const i = (sy * iw + sx) * 4
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
          n++
        }
      }
      gray[y * w + x] = n ? (sum / n) | 0 : 255
    }
  }

  // 2. LOCAL adaptive threshold → an ink MASK, then each row's ink fraction. See the note above for
  //    the two thresholds this replaced and why each of them was wrong.
  const radius = Math.max(4, Math.round(w / WINDOW_DIVISOR))
  const mask = new Uint8Array(w * h)
  const rowTexture = new Array<number>(h)
  const prefix = new Float64Array(w + 1)
  for (let y = 0; y < h; y++) {
    const base = y * w
    for (let x = 0; x < w; x++) prefix[x + 1] = prefix[x] + gray[base + x]
    let runs = 0, prev = 0
    for (let x = 0; x < w; x++) {
      const a = Math.max(0, x - radius), b = Math.min(w - 1, x + radius)
      const mean = (prefix[b + 1] - prefix[a]) / (b - a + 1)
      const ink = gray[base + x] < mean * INK_RATIO ? 1 : 0
      mask[base + x] = ink
      if (ink && !prev) runs++ // a fresh stroke starts here
      prev = ink
    }
    rowTexture[y] = runs / w
  }
  // 3-row box smooth: a single scan line of a downscaled MRZ can fall between glyph rows.
  const sm = rowTexture.map((_, y) => (rowTexture[Math.max(0, y - 1)] + rowTexture[y] + rowTexture[Math.min(h - 1, y + 1)]) / 3)

  // 3. ADAPTIVE floor. ⚠️ Never a bare constant — a passport occupying a third of a phone photo
  //    produces rows whose texture never reaches a fixed one (codex). A share of the 95th-percentile
  //    row scales with whatever is actually in the frame.
  const lo = Math.max(0.015, quantile(sm, 0.95) * 0.35)
  const texty = (y: number) => sm[y] >= lo

  // 4 + 5. Walk up from the bottom, taking each contiguous texty run in turn and returning the FIRST
  // that passes every shape gate.
  //
  // ⛔ NOT JUST THE BOTTOM-MOST RUN. An earlier draft examined one candidate and gave up if it failed
  // a gate — so a caption, a table edge, or desk texture BELOW the passport swallowed the whole
  // answer and the locator returned null on an image whose MRZ it would otherwise have found (codex).
  // The runs above it are still there; it just never looked. Bounded, because on a busy image the
  // real MRZ is not the tenth thing up from the bottom.
  // ⛔ THE GAP TOLERANCE IS MEASURED IN LINE HEIGHTS, NOT IN PAGE HEIGHTS, and getting that wrong
  // silently halves the band. A fixed "3% of the image" tolerance is BELOW a real TD3 inter-line gap:
  // on an 88 mm data page the two MRZ lines are ~2.8 mm of glyph separated by ~3.8 mm of white, which
  // is ~4.3% of the page — so the walk-up stopped inside the gap, kept line 2 alone, and a single line
  // (~3.2%) then sat on the run-height floor and was thrown away (fable). The fix is to stop guessing:
  // find the bottom line, MEASURE it, and let the second line join only if the white between them is
  // in proportion to it. The MRZ's own geometry separates the two cases cleanly — the gap between the
  // lines is ~1.4 line-heights, the gap up to the printed fields above is more than twice that.
  const seedGap = Math.max(1, Math.round(h * 0.012))
  let cursor = h - 1
  for (let candidate = 0; candidate < MAX_CANDIDATE_RUNS && cursor >= 0; candidate++) {
    let y1 = -1
    for (let y = cursor; y >= 0; y--) { if (texty(y)) { y1 = y; break } }
    if (y1 < 0) return null
    // The bottom line, found with a tolerance small enough that it cannot swallow the inter-line gap.
    let y0 = y1
    let gap = 0
    for (let y = y1 - 1; y >= 0; y--) {
      if (texty(y)) { y0 = y; gap = 0; continue }
      if (++gap > seedGap) break
    }
    // Then ONE more line above it, if the white between them is proportionate. TD3 is exactly two.
    const lineH = y1 - y0 + 1
    const bridge = Math.max(2, Math.round(lineH * LINE_GAP_RATIO))
    let probe = y0 - 1, skipped = 0
    while (probe >= 0 && !texty(probe) && skipped < bridge) { probe--; skipped++ }
    if (probe >= 0 && texty(probe)) {
      let gap2 = 0
      for (let y = probe; y >= 0; y--) {
        if (texty(y)) { y0 = y; gap2 = 0; continue }
        if (++gap2 > seedGap) break
      }
    }
    cursor = y0 - 1 // next candidate starts above this run, whether or not this one qualifies

    // Shape gates. An MRZ band is SHORT, LOW and VERY WIDE; anything else is a false positive.
    // ⚠️ The floor is 2%, not 3%: a two-line MRZ is ~10% of a cropped data page but a far smaller
    // fraction of a whole photo, which is exactly the input this module exists to serve.
    const runH = y1 - y0 + 1
    if (runH < h * 0.02 || runH > h * 0.45) continue
    if (y1 < h * 0.40) return null // above the halfway line there is no MRZ, and nothing higher can be

    // Horizontal extent of the ink inside those rows, so a passport occupying part of a wide photo is
    // cropped to the document rather than to the desk beside it.
    const colInk = new Array<number>(w).fill(0)
    for (let y = y0; y <= y1; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) colInk[x] += 1 / runH
    const cLo = Math.max(0.02, quantile(colInk, 0.95) * 0.20)
    let x0 = 0, x1 = w - 1
    while (x0 < w && colInk[x0] < cLo) x0++
    while (x1 > x0 && colInk[x1] < cLo) x1--
    // ⛔ A NARROW COLUMN EXTENT REJECTS THE CANDIDATE — it does NOT widen it. An earlier draft fell
    // back to the full width here "rather than cropping to a speck", and that fallback MANUFACTURED A
    // PASS: it replaced the measured width with 100%, which then sailed through the aspect gate below
    // on the strength of a number the image never supplied. A textured block 25% of the frame wide and
    // 40% tall came back as a valid MRZ band. Narrowness is EVIDENCE, not noise: an MRZ spans most of
    // its document's width, always, so a run that does not is not one.
    if (x1 - x0 + 1 < w * 0.25) continue
    const runW = x1 - x0 + 1
    // ⚠️ THE ASPECT GATE IS THE STRONGEST FILTER. Two lines of MRZ across a data page are ~6–9× wider
    // than they are tall; a paragraph of address text, a shadow, or a hand in frame is not.
    if (runW / runH < 2.5) continue

    // Pad generously in Y (the smooth + the threshold both trim the glyph extremes) and lightly in X.
    const padY = Math.max(2, Math.round(runH * 0.30))
    const padX = Math.max(2, Math.round(runW * 0.06))
    // ⚠️ EXCLUSIVE upper bounds. y1/x1 are inclusive INDICES, so dividing them straight by h/w leaves
    // a band one grid cell short of the edge and clips the last glyph row of a full-bleed MRZ (codex).
    const top = Math.max(0, y0 - padY) / h
    const bottom = Math.min(h, y1 + padY + 1) / h
    const left = Math.max(0, x0 - padX) / w
    const right = Math.min(w, x1 + padX + 1) / w
    return { top, left, width: Math.min(1 - left, right - left), height: Math.min(1 - top, bottom - top) }
  }
  return null
}
