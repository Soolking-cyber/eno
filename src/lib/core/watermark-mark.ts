/**
 * THE eno.vn WATERMARK — the mark itself, its geometry, and the ink decision.
 *
 * ⛔ THIS MODULE EXISTS BECAUSE THE MARK HAS DRIFTED THREE WAYS BEFORE. media.ts stamped "eno.vn"
 * at 1353 wide, scripts/watermark-existing.mjs carried a 753-wide path that stopped at the `o` and
 * stamped "eno", and public/watermark.svg set it as <text> in system-ui — three consumers, three
 * different wordmarks, one missing the domain that is the entire point. Each file claimed to
 * mirror the others.
 *
 * ⚠️ NO `server-only`, NO sharp import, AND THAT IS THE WHOLE DESIGN. Everything sharp-shaped in
 * this repo sits behind `server-only` (sharp-lazy.ts), which a maintenance script cannot cross —
 * which is precisely why the script grew its own copy of the mark and then drifted. What is
 * genuinely shared is not the image work: it is the PATH DATA, the box, and the rule for choosing
 * ink. Those are pure, so they can live somewhere every caller can reach. The sharp calls stay
 * with each caller, where they were anyway.
 *
 * Callers pass a measured mean luminance to `inkForLuminance` rather than a buffer, so the
 * decision is shared even though the measurement cannot be. Follows the same split as
 * image-hash-url.ts (pure) beside image-hash.ts (server-only).
 */

// The "eno.vn" wordmark, INLINED as raw path data: pure vectors, so rendering never
// depends on system fonts (serverless has none we control — SVG <text> would silently
// fall back to an ugly default or nothing).
//
// ⛔ THESE ARE THE OPEN RUNDE OUTLINES, THE SAME ONES public/logo-dotvn.svg USES — replaced
// 2026-08-16 (owner: "all watermarks on images and backdrops use new typography eno.vn svg").
// What was here before was the hand-drawn bezier wordmark from before the app adopted Open
// Runde: "eno" lifted from public/logo.svg with ".vn" appended as a baseline dot, a
// parallel-stroke pointed `v` and a translated `n`. It was a different typeface from the one
// the dashboard, the header and the account panel had already moved to — so every uploaded
// photo was stamped with a wordmark the rest of the app no longer used.
//
// Provenance — regenerate from the SAME source if the font ever moves:
//   face  src/fonts/open-runde-bold.woff2 (Open Runde Bold 700, OFL-1.1, unitsPerEm 2816)
//   text  "eno.vn", outlines via fontTools SVGPathPen, y flipped for SVG, GPOS kerning applied
// The simplest correct move is to copy the `d` out of public/logo-dotvn.svg verbatim, which is
// what this is — one generation, three consumers, no drift.
//
// ⚠️ NONZERO WINDING. The previous path was drawn to need `fill-rule="evenodd"`; these are FONT
// outlines whose counters are wound opposite to their outer contours and drop out on their own.
// Leaving evenodd on filled the bowls of `e`, `o` and `n` solid. The attribute is gone from
// watermarkSvg() below — do not reinstate it.
//
// ⚠️ KEEP IN SYNC WITH scripts/watermark-existing.mjs, which re-stamps already-uploaded photos
// and carries its own copy of this path and these bounds.
const WORDMARK_D =
  'M870.0 30.0C1201.0 30.0 1438.0 -111.0 1533.0 -335.0C1560.0 -399.0 1513.0 -443.0 1428.0 -449.0L1270.0 -460.0C1203.0 -464.0 1167.0 -435.0 1122.0 -383.0C1066.0 -320.0 980.0 -288.0 877.0 -288.0C664.0 -288.0 529.0 -429.0 529.0 -658.0V-659.0H1455.0C1533.0 -659.0 1575.0 -700.0 1575.0 -776.0C1575.0 -1298.0 1259.0 -1556.0 853.0 -1556.0C401.0 -1556.0 108.0 -1235.0 108.0 -761.0C108.0 -274.0 397.0 30.0 870.0 30.0ZM529.0 -923.0C538.0 -1098.0 671.0 -1238.0 860.0 -1238.0C1045.0 -1238.0 1173.0 -1106.0 1174.0 -923.0Z M2279.0 -120.0V-888.0C2280.0 -1086.0 2398.0 -1202.0 2570.0 -1202.0C2741.0 -1202.0 2844.0 -1090.0 2843.0 -902.0V-120.0C2843.0 -42.0 2885.0 0.0 2963.0 0.0H3149.0C3227.0 0.0 3269.0 -42.0 3269.0 -120.0V-978.0C3269.0 -1336.0 3059.0 -1556.0 2739.0 -1556.0C2511.0 -1556.0 2346.0 -1444.0 2277.0 -1265.0H2259.0V-1416.0C2259.0 -1494.0 2217.0 -1536.0 2139.0 -1536.0H1973.0C1895.0 -1536.0 1853.0 -1494.0 1853.0 -1416.0V-120.0C1853.0 -42.0 1895.0 0.0 1973.0 0.0H2159.0C2237.0 0.0 2279.0 -42.0 2279.0 -120.0Z M4298.0 30.0C4764.0 30.0 5054.0 -289.0 5054.0 -762.0C5054.0 -1238.0 4764.0 -1556.0 4298.0 -1556.0C3832.0 -1556.0 3542.0 -1238.0 3542.0 -762.0C3542.0 -289.0 3832.0 30.0 4298.0 30.0ZM3975.0 -765.0C3975.0 -1033.0 4085.0 -1231.0 4300.0 -1231.0C4511.0 -1231.0 4621.0 -1033.0 4621.0 -765.0C4621.0 -497.0 4511.0 -300.0 4300.0 -300.0C4085.0 -300.0 3975.0 -497.0 3975.0 -765.0Z M5581.0 26.0C5709.0 26.0 5820.0 -81.0 5821.0 -214.0C5820.0 -345.0 5709.0 -452.0 5581.0 -452.0C5449.0 -452.0 5340.0 -345.0 5341.0 -214.0C5340.0 -81.0 5449.0 26.0 5581.0 26.0Z M7099.0 -97.0 7554.0 -1399.0C7583.0 -1482.0 7544.0 -1536.0 7456.0 -1536.0H7256.0C7185.0 -1536.0 7142.0 -1504.0 7122.0 -1435.0L6833.0 -437.0H6817.0L6527.0 -1435.0C6507.0 -1504.0 6464.0 -1536.0 6393.0 -1536.0H6194.0C6106.0 -1536.0 6067.0 -1482.0 6096.0 -1399.0L6551.0 -97.0C6574.0 -31.0 6618.0 0.0 6688.0 0.0H6962.0C7032.0 0.0 7076.0 -31.0 7099.0 -97.0Z M8246.0 -120.0V-888.0C8247.0 -1086.0 8365.0 -1202.0 8537.0 -1202.0C8708.0 -1202.0 8811.0 -1090.0 8810.0 -902.0V-120.0C8810.0 -42.0 8852.0 0.0 8930.0 0.0H9116.0C9194.0 0.0 9236.0 -42.0 9236.0 -120.0V-978.0C9236.0 -1336.0 9026.0 -1556.0 8706.0 -1556.0C8478.0 -1556.0 8313.0 -1444.0 8244.0 -1265.0H8226.0V-1416.0C8226.0 -1494.0 8184.0 -1536.0 8106.0 -1536.0H7940.0C7862.0 -1536.0 7820.0 -1494.0 7820.0 -1416.0V-120.0C7820.0 -42.0 7862.0 0.0 7940.0 0.0H8126.0C8204.0 0.0 8246.0 -42.0 8246.0 -120.0Z'
// TIGHT INK BOUNDS — measured by rendering the path and trimming, NOT copied from
// public/logo-dotvn.svg's viewBox.
//
// ⛔ THE viewBox IS THE EM/ADVANCE BOX AND USING IT PUT 22.6% TRANSPARENT PADDING AROUND THE MARK.
// I shipped that in the first cut of this change and an external reviewer caught it. The effect is
// not cosmetic: every caller sizes the mark by WIDTH and derives height from these numbers, then
// anchors it with a margin off the short edge — so 11% of dead space below the baseline silently
// became extra bottom margin, floating the mark away from the corner it is supposed to sit in.
// A font's em box is the right frame for setting type inline; it is the wrong frame for
// positioning a graphic.
//
// ⚠️ AND THE ASPECT BARELY MOVED, which the em box also hid: 5.88:1 hand-drawn → 5.75:1 Open Runde
// on the real ink. The first version of this comment claimed 4.52:1 and "the mark is TALLER" —
// that was the padding talking. The watermark keeps essentially the proportions it always had.
const MARK_W = 9132.3, MARK_H = 1588.3, MARK_X = 105.9, MARK_Y = -1556.4

/** The "eno.vn" wordmark as ONE flat, crisp pass — no shadow, no outline, no second
 *  copy (user-picked 2026-07-14).
 *
 *  The old mark drew a 30%-black copy offset behind a 55%-white one. At web sizes the
 *  two never resolved into a single shape: every glyph carried a grey ghost, so the mark
 *  read as a smudge rather than a signature. The obvious repair — white fill plus a
 *  hairline dark contour — fails the case that actually matters here, a product shot on
 *  a white studio background: the fill disappears into the paper and you're left with a
 *  hollow outline.
 *
 *  So the ink is chosen from the photo instead (see pickInk): white on a dark backdrop,
 *  near-black on a bright one. One solid colour either way, which is what makes it read
 *  as cleanly engraved.
 *
 *  `w` = target glyph-box width. */
export function watermarkSvg(w: number, ink: { fill: string; opacity: number }): { svg: Buffer; width: number; height: number } {
  const scale = w / MARK_W
  const width = w
  const height = Math.max(1, Math.round(MARK_H * scale))
  return {
    svg: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
        `<g transform="scale(${scale}) translate(${-MARK_X},${-MARK_Y})">` +
        `<path d="${WORDMARK_D}" fill="${ink.fill}" fill-opacity="${ink.opacity}"/>` +
        `</g></svg>`,
    ),
    width,
    height,
  }
}

/**
 * Pick an ink that stays legible on the patch of photo the mark will sit on, WITHOUT a shadow.
 * Bright backdrop (white studio cyc, sky, pale wall) → near-black; anything mid or dark → white.
 *
 * @param mean average luminance of that patch, 0..1. Callers that cannot measure it should pass
 *   `null` and get white — the historical behaviour, and the safe answer for an average photo.
 *
 * ⛔ THE SHARED PIECE IS THIS THRESHOLD, NOT THE PROBE. scripts/watermark-existing.mjs stamped a
 * FIXED WHITE mark and its own comment flagged that as a real, deliberate difference to fix
 * "before any large backfill". A bright photo — a water park, a pale sky — then got a mark you
 * cannot see. Anyone measuring a mean can now get the same answer the app gives.
 */
export function inkForLuminance(mean: number | null): { fill: string; opacity: number } {
  const WHITE = { fill: '#ffffff', opacity: 0.85 }
  if (mean === null || !Number.isFinite(mean)) return WHITE
  return mean > 0.62 ? { fill: '#0a0a0a', opacity: 0.42 } : WHITE
}

/**
 * Where the mark goes on an image of the given size: ~28% of the width (prominent, for
 * web-address memorability — owner ask 2026-07-07), clamped, anchored bottom-right.
 *
 * ⚠️ PADDING IS MEASURED OFF THE SHORT EDGE (owner-picked 2026-07-14: the mark must never touch a
 * border). Off the width, a tall portrait shot got a hairline gap at the bottom while a panorama
 * got a canyon; the short edge keeps the inset even.
 */
export function watermarkPlacement(width: number, height: number) {
  const mw = Math.min(580, Math.max(190, Math.round(width * 0.28)))
  const mh = Math.round((mw / MARK_W) * MARK_H)
  const pad = Math.round(Math.min(width, height) * 0.03)
  const left = Math.max(0, width - mw - pad)
  const top = Math.max(0, height - mh - pad)
  return { markWidth: mw, left, top, region: { left, top, width: Math.min(mw, width - left), height: Math.min(mh, height - top) } }
}
