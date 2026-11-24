/**
 * ── A RENTAL CARD'S PHOTO COLLAGE ON A PHONE (owner, 2026-11-24, hub round 17: "for mobile rentals … instead of 1 large image
 * show this way display available images in best possible position so all image surface will be shown without empty bars max
 * 4 at a time", Facebook's multi-photo posts as the reference; then "collage is not deployed" → build and ship) ──────────────
 *
 * Up to 4 of a listing's photos in a JUSTIFIED layout: every tile takes its photo's own aspect, so nothing is cropped and no
 * tile shows bars. The layouts (all exact-aspect): one photo per row stacked, one row side by side, a big photo on top with a
 * row under it, a big photo on the left with a column beside it, a 2×2 of two rows. The one whose frame is closest to a square
 * wins (the card keeps its size, the owner's 11-14 rule), a tile never narrower than 30% of the card. The frame is clamped to
 * 0.7–1.35 of the width; when the clamp bites, tiles scale on one axis and `object-cover` trims a sliver — never a bar.
 *
 * A photo's aspect comes from the `-<w>x<h>-` eno's uploader writes into every file name (96% of live rental photos, measured
 * 2026-11-24), so the layout is known at render: no load-time jump. A name without one counts as 4:3.
 */
export const COLLAGE_MAX = 4
/** The gap between tiles, as a fraction of the card's width (2px at a 390px phone). */
export const COLLAGE_GAP = 2 / 390
const FRAME_MIN = 0.7
const FRAME_MAX = 1.35
const MIN_SIDE = 0.3

export type CollageTile = { i: number; x: number; y: number; w: number; h: number }
export type Collage = { name: string; height: number; tiles: CollageTile[] }

/** A photo's width ÷ height from its file name, clamped to 1:2 … 2.2:1; 4:3 when the name has no size. */
export function photoAspect(url: string | null | undefined): number {
  const m = /-(\d{2,5})x(\d{2,5})-/.exec(url ?? '')
  if (!m) return 4 / 3
  const w = Number(m[1]), h = Number(m[2])
  if (!(w > 0 && h > 0)) return 4 / 3
  return Math.max(0.5, Math.min(2.2, w / h))
}

/** One justified row of `idx` across the full width at height H: widths ∝ aspect, gaps between. */
function row(idx: number[], ars: number[], y: number): { H: number; tiles: CollageTile[] } {
  const H = (1 - COLLAGE_GAP * (idx.length - 1)) / idx.reduce((s, i) => s + ars[i], 0)
  let x = 0
  const tiles = idx.map((i) => { const t = { i, x, y, w: H * ars[i], h: H }; x += t.w + COLLAGE_GAP; return t })
  return { H, tiles }
}

function candidates(ars: number[]): Collage[] {
  const n = ars.length
  const all = [...Array(n).keys()]
  const out: Collage[] = []
  if (n === 1) out.push({ name: 'one', height: 0, tiles: [{ i: 0, x: 0, y: 0, w: 1, h: 1 / ars[0] }] })
  if (n === 2) {
    let y = 0
    out.push({ name: 'stack', height: 0, tiles: all.map((i) => { const t = { i, x: 0, y, w: 1, h: 1 / ars[i] }; y += t.h + COLLAGE_GAP; return t }) })
  }
  if (n === 2 || n === 3) out.push({ name: 'row', height: 0, tiles: row(all, ars, 0).tiles })
  if (n >= 3) {
    const top = { i: 0, x: 0, y: 0, w: 1, h: 1 / ars[0] }
    out.push({ name: 'top+row', height: 0, tiles: [top, ...row(all.slice(1), ars, top.h + COLLAGE_GAP).tiles] })
    // A big photo on the left, the rest stacked on the right, both columns one height H:
    // left width = H·a0; right width wr gives a column height wr·Σ(1/ai) + gaps = H; and left + gap + right = 1.
    const rest = all.slice(1), s = rest.reduce((t, i) => t + 1 / ars[i], 0), gaps = COLLAGE_GAP * (rest.length - 1)
    const H = (1 - COLLAGE_GAP + gaps / s) / (ars[0] + 1 / s)
    const wl = H * ars[0], wr = 1 - wl - COLLAGE_GAP
    let y = 0
    const col = rest.map((i) => { const t = { i, x: wl + COLLAGE_GAP, y, w: wr, h: wr / ars[i] }; y += t.h + COLLAGE_GAP; return t })
    out.push({ name: 'left+col', height: 0, tiles: [{ i: 0, x: 0, y: 0, w: wl, h: H }, ...col] })
  }
  if (n === 4) {
    const r1 = row([0, 1], ars, 0)
    out.push({ name: '2x2', height: 0, tiles: [...r1.tiles, ...row([2, 3], ars, r1.H + COLLAGE_GAP).tiles] })
  }
  for (const c of out) c.height = Math.max(...c.tiles.map((t) => t.y + t.h))
  return out
}

const score = (c: Collage) =>
  Math.abs(Math.log(c.height)) + (c.tiles.some((t) => Math.min(t.w, t.h) < MIN_SIDE) ? 2 : 0) + (c.height > FRAME_MAX || c.height < FRAME_MIN ? 1 : 0)

/**
 * The collage for a listing's photos (the first COLLAGE_MAX), in fractions of the card's width: `height` is the frame's
 * height ÷ width, each tile's x / w are fractions of the width and y / h fractions of the WIDTH too (multiply by the width).
 * The frame is clamped to FRAME_MIN…FRAME_MAX; tiles are scaled vertically to fill it.
 */
export function collageLayout(urls: readonly string[]): Collage | null {
  const n = Math.min(COLLAGE_MAX, urls.length)
  if (n < 2) return null
  const ars = urls.slice(0, n).map(photoAspect)
  let best: Collage | null = null
  let bestScore = Infinity
  for (const c of candidates(ars)) {
    const s = score(c)
    if (s < bestScore) { best = c; bestScore = s }
  }
  if (!best) return null
  const height = Math.min(FRAME_MAX, Math.max(FRAME_MIN, best.height))
  const k = height / best.height
  return { name: best.name, height, tiles: best.tiles.map((t) => ({ ...t, y: t.y * k, h: t.h * k })) }
}
