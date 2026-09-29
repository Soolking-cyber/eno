/**
 * HOW MUCH DOES THE SOURCE PORTAL'S BURNED-IN MARK SHOW ON THIS PHOTO? — and so which photo of an
 * imported rental should be its cover. Shared by scripts/import-nhatot-com.ts,
 * scripts/import-muaban-net.ts (new rows) and scripts/reorder-import-covers.ts (existing rows).
 *
 * The owner ACCEPTED burned-in source marks on 2026-09-24 (import-nhatot-com.ts ⛔ 4), so nothing
 * here removes or hides one. It only stops the card from LEADING with the photo where the stamp is
 * most conspicuous, when another of the poster's first photos shows it clearly less.
 *
 * ⚠️ EVERY PHOTO CARRIES THE MARK, SO THIS PICKS THE PHOTO WHERE IT SHOWS LEAST — IT CANNOT FIND A
 * CLEAN ONE. Measured 2026-09-29 on 191 photos of 48 imported rental rows (GET from eno.vn's own
 * storage): Chợ Tốt stamps a white "choTOT" (~147x44 px) and muaban.net a white "muabán.net"
 * (~178x35 px) at the exact CENTRE of every photo of every ad, at a FIXED pixel size — the centred
 * mean of 75 nhatot photos reproduces the wordmark stroke for stroke. What varies is how much it
 * shows: invisible on a white wall, loud on a dark floor, lost in a busy shopfront.
 *
 * ⛔ SO IT IS OFF UNLESS ASKED FOR (`--cover-by-mark` on both importers; the reorder script is a dry
 * run unless --apply, and --apply is scratch-only). The score ranks photos the way people do (below),
 * but the COVER it then picks is rarely a clearly better card: on the same 36 rows the rule moved 4
 * covers, none was a clearly better card by eye, and one put a toilet first. And it cannot get far:
 * the first 48 cards of /c/rentals on 2026-09-29 were all nhatot or muaban rows, 18 of their covers
 * scored as a visible stamp, and the rule would leave 15 — muaban's first three photos rarely include
 * one where its stamp does not show.
 *
 * HOW, IN THREE STEPS — no model, no template file, nothing of the portal's in the repo:
 *  1. `markTemplate`: the MARK'S OWN SHAPE, learnt from ≥ MARK_POOL_MIN photos of one source. Each
 *     photo's centre window is reduced to its thin bright strokes (a white top-hat: the image minus
 *     its morphological opening), and the pixel-wise MEAN over the pool is taken. Room content lands
 *     somewhere different in every photo and averages away; the stamp lands on the same pixels every
 *     time and stays. Pixels far above the pool's own median (robust z ≥ MARK_Z) are the mask.
 *     A pool whose mask is not far above its background (MARK_SNR_MIN) has NO centred mark, and
 *     the answer is null — never a guess. Measured: the two portals' pools score 8.1–9.9, windows
 *     cut off-centre from the same photos (no mark) 3.3–3.7.
 *  2. `markScore`: on ONE photo, how much brighter the mask's pixels are than the ring just around
 *     them (the stamp is white ink at partial opacity, so that difference IS what the eye sees),
 *     divided by how busy the ring is (a pattern hides a stamp: contrast masking), times how much of
 *     the card's square crop the mark spans (a 459-px-wide portrait blows the same stamp up to a third
 *     of the card; a 1024-px landscape keeps it small).
 *  3. `coverByMark`: the lowest score among the first COVER_CANDIDATES kept photos becomes the cover,
 *     only when the source's own cover shows the mark (≥ MARK_VISIBLE) and the pick shows it at least
 *     MARK_MIN_GAIN less. The rest keep the source's order.
 *
 * CALIBRATION (2026-09-29, scratch only — the photos were never committed): on the 20 rows where a
 * person looking at the card crops could say which photo shows the mark MOST and which LEAST (9
 * nhatot, 11 muaban), the score ranked that pair the same way 20/20 times with each row's own photos
 * left out of the template; 18/20 with the pool cut to 45 photos. import-photo-mark.test.ts pins
 * the behaviour on synthetic stamps over real photographs tracked in the repo.
 *
 * ⚠️ WHY ONLY THE FIRST THREE PHOTOS. The poster's first shots are the room; the fifth is often the
 * toilet. A cleaner stamp is not worth a worse picture, and nothing here can see what a photo shows.
 * ⚠️ WHY A POOL, NOT THE ROW'S OWN PHOTOS. Tried first: a median over one row's 3–6 photos keeps
 * too much room content (tiles, rails, curtains) in the mask, and ranked a row's most- and
 * least-marked photo right only 17 of 33 times. A pool of the source's photos is what makes the
 * mask the mark.
 * ⚠️ THE MEAN OVER THE WHOLE STAMP, NOT ITS LOUDEST PART. A stamp half over a black appliance and half
 * over a white wall reads to the eye by its loud half; scoring the loudest quarter of the stamp
 * instead was tried and ranked the labelled pairs worse (17/20), so the mean stands.
 * ⚠️ A NEW MARK FAILS SAFE. If a portal changes its stamp, a pool of older photos learns the old
 * shape; new photos then score ~0 on it and no cover moves.
 */

/** The centre window kept per photo, in the pixels the image host STORES (fitted inside HOST_EDGE). */
export const MARK_WINDOW_W = 320
export const MARK_WINDOW_H = 96
/** Strokes up to 2r+1 = 11 px wide survive the top-hat; at r = 3 "muabán"'s bold letters came out hollow. */
export const MARK_STROKE_RADIUS = 5
/** Photos a template needs. At 20 the muaban pool scored only 4.3–5.0; at 45, 6.4–7.5. */
export const MARK_POOL_MIN = 40
/** Mask = consensus ≥ median + MARK_Z robust σ, and never below MARK_FLOOR grey levels of stroke. */
export const MARK_Z = 3
export const MARK_FLOOR = 6
/** Fewer mask pixels than this is noise, not a wordmark (the two portals' masks hold ~1,700–2,100). */
export const MARK_MIN_STROKES = 200
/** Mean mask strength over the background, in robust σ. Portals 8.1–9.9; no mark 3.3–3.7 (≤ 3.9 at 20 photos). */
export const MARK_SNR_MIN = 5
/** Stored rows an importer reads its seed photos from (their first COVER_CANDIDATES each): 24 × 3 =
 *  72 photos, so a few failed fetches or short galleries still leave ≥ MARK_POOL_MIN. */
export const MARK_SEED_ROWS = 24
/** The ring the mark is compared against: mask dilated by this many px, minus the mask. */
export const MARK_RING = 3
/** Grey levels added to the ring's spread before dividing, so a flat wall does not divide by ~0. */
export const MARK_CLUTTER = 10
/** Only the poster's first photos may become the cover (see the header). */
export const COVER_CANDIDATES = 3
/** Below this the cover's mark is not worth acting on (a white wall scores ~0.3–1.0; loud ones 2–5). */
export const MARK_VISIBLE = 1.5
/** The pick must show the mark at least this much less than the cover it replaces (35%). */
export const MARK_MIN_GAIN = 0.35
/** sharp's `limitInputPixels` for every decode of an imported photo — measureImage (import-photo-check.ts)
 *  and markWindowOf read the SAME bytes, so one bound, not two that can drift apart. */
export const PHOTO_INPUT_PIXELS = 50_000_000
/** The most bytes fetchStoredImage will hold for one stored photo. */
export const STORED_IMAGE_MAX_BYTES = 20 * 1024 * 1024

/**
 * One photo's centre, greyscale, as the host will store it (upright, flattened on white, fitted
 * inside the host edge). `imageWidth`/`imageHeight` are that stored size — the card's square crop is
 * min(imageWidth, imageHeight) of THESE pixels, which is what makes the size factor right.
 */
export type MarkWindow = { width: number; height: number; imageWidth: number; imageHeight: number; data: Uint8Array }

export type MarkTemplate = {
  /** MARK_WINDOW_W × MARK_WINDOW_H, 1 = a stroke of the mark / a pixel of the ring around it. */
  mask: Uint8Array
  ring: Uint8Array
  strokes: number
  /** The mark's width in px (5th–95th percentile of the mask's columns, so a stray pixel cannot stretch it). */
  strokeWidth: number
  snr: number
  pool: number
}
export type MarkTemplateResult =
  | { template: MarkTemplate; why: null; pool: number; snr: number }
  | { template: null; why: 'poolTooSmall' | 'noCentredMark'; pool: number; snr: number | null }

const W = MARK_WINDOW_W, H = MARK_WINDOW_H

/** A window this module cut (markWindowOf): no larger than the canvas, and its data matches its size. */
const fits = (win: Pick<MarkWindow, 'width' | 'height' | 'data'>) =>
  win.width > 0 && win.height > 0 && win.width <= W && win.height <= H && win.data.length === win.width * win.height
/** Where a window sits on the W×H canvas: centred, like the photo it was cut from. */
const offsetOf = (win: Pick<MarkWindow, 'width' | 'height'>) => ({ ox: Math.floor((W - win.width) / 2), oy: Math.floor((H - win.height) / 2) })

/** Separable square min (erode) or max (dilate) filter, edges clamped. */
function rankFilter(src: Float32Array, w: number, h: number, r: number, max: boolean): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h)
  const sign = max ? 1 : -1
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let v = src[row + x]
      for (let k = Math.max(0, x - r), end = Math.min(w - 1, x + r); k <= end; k++) if (sign * (src[row + k] - v) > 0) v = src[row + k]
      tmp[row + x] = v
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x]
      for (let k = Math.max(0, y - r), end = Math.min(h - 1, y + r); k <= end; k++) if (sign * (tmp[k * w + x] - v) > 0) v = tmp[k * w + x]
      out[y * w + x] = v
    }
  }
  return out
}

/** Thin bright strokes only: the window minus its opening (erode, then dilate). ≥ 0 by construction. */
export function whiteTopHat(win: Pick<MarkWindow, 'width' | 'height' | 'data'>, r = MARK_STROKE_RADIUS): Float32Array {
  const src = Float32Array.from(win.data)
  const opened = rankFilter(rankFilter(src, win.width, win.height, r, false), win.width, win.height, r, true)
  for (let i = 0; i < src.length; i++) src[i] = src[i] - opened[i]
  return src
}

function median(sorted: Float64Array | number[]): number {
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN
}

/**
 * The mark's shape, learnt from one source's photos (see the header, step 1). `windows` should be the
 * centres of DIFFERENT ads — the same room five times teaches the room, not the mark.
 */
export function markTemplate(windows: readonly MarkWindow[]): MarkTemplateResult {
  const usable = windows.filter(fits)
  const pool = usable.length
  if (pool < MARK_POOL_MIN) return { template: null, why: 'poolTooSmall', pool, snr: null }
  const sum = new Float64Array(W * H), cnt = new Uint32Array(W * H)
  for (const win of usable) {
    const th = whiteTopHat(win)
    const { ox, oy } = offsetOf(win)
    for (let y = 0; y < win.height; y++) for (let x = 0; x < win.width; x++) {
      const i = (y + oy) * W + x + ox
      sum[i] += th[y * win.width + x]; cnt[i]++
    }
  }
  /** A pixel only half the pool reaches (small photos) is left out rather than averaged thin. */
  const need = Math.ceil(pool / 2)
  const mean = new Float64Array(W * H).fill(NaN)
  const defined: number[] = []
  for (let i = 0; i < mean.length; i++) if (cnt[i] >= need) { mean[i] = sum[i] / cnt[i]; defined.push(mean[i]) }
  if (!defined.length) return { template: null, why: 'noCentredMark', pool, snr: null }
  const sorted = Float64Array.from(defined).sort()
  const med = median(sorted)
  const dev = Float64Array.from(defined, (v) => Math.abs(v - med)).sort()
  /** Floored so a perfectly flat background (synthetic, or a blank pool) cannot divide by zero. */
  const sigma = Math.max(1.4826 * median(dev), 0.25)
  const thr = Math.max(MARK_FLOOR, med + MARK_Z * sigma)
  const mask = new Uint8Array(W * H)
  const cols: number[] = []
  let strokes = 0, strength = 0
  for (let i = 0; i < mean.length; i++) {
    if (mean[i] >= thr) { mask[i] = 1; strokes++; strength += mean[i]; cols.push(i % W) }
  }
  const snr = strokes ? (strength / strokes - med) / sigma : 0
  if (strokes < MARK_MIN_STROKES || snr < MARK_SNR_MIN) return { template: null, why: 'noCentredMark', pool, snr }
  cols.sort((a, b) => a - b)
  const strokeWidth = cols[Math.floor(cols.length * 0.95)] - cols[Math.floor(cols.length * 0.05)] + 1
  const grown = rankFilter(Float32Array.from(mask), W, H, MARK_RING, true)
  const ring = new Uint8Array(W * H)
  for (let i = 0; i < ring.length; i++) ring[i] = grown[i] && !mask[i] ? 1 : 0
  return { template: { mask, ring, strokes, strokeWidth, snr, pool }, why: null, pool, snr }
}

/**
 * How conspicuous the learnt mark is on ONE photo (header, step 2) — higher shows more; ≤ 0 means
 * its pixels are no brighter than their surroundings. null when it cannot be measured (no window, or
 * a photo too small to hold most of the mark), which `coverByMark` treats as "never the new cover".
 */
export function markScore(win: MarkWindow | null | undefined, t: MarkTemplate): number | null {
  if (!win || !fits(win) || !(win.imageWidth > 0) || !(win.imageHeight > 0)) return null
  const { ox, oy } = offsetOf(win)
  let a = 0, na = 0, b = 0, bb = 0, nb = 0
  for (let y = 0; y < win.height; y++) for (let x = 0; x < win.width; x++) {
    const i = (y + oy) * W + x + ox
    const v = win.data[y * win.width + x]
    if (t.mask[i]) { a += v; na++ } else if (t.ring[i]) { b += v; bb += v * v; nb++ }
  }
  if (na < t.strokes * 0.6 || nb < 50) return null
  const lift = a / na - b / nb
  const clutter = Math.sqrt(Math.max(0, bb / nb - (b / nb) ** 2))
  const span = t.strokeWidth / Math.min(win.imageWidth, win.imageHeight)
  return Math.round(((10 * lift) / (clutter + MARK_CLUTTER)) * span * 1000) / 1000
}

export type CoverMove = { from: number; was: number; now: number }
/**
 * The cover rule (header, step 3). `keep` is the kept photos' indices in the source's order (its first
 * is today's cover); `scores[i]` is photo i's markScore. Returns `keep` with the pick moved to the
 * front — every other photo in its source order — or unchanged, with the reason.
 */
export function coverByMark(keep: readonly number[], scores: readonly (number | null | undefined)[]): { keep: number[]; moved: CoverMove | null; why: string } {
  const same = (why: string) => ({ keep: [...keep], moved: null, why })
  if (keep.length < 2) return same('one photo')
  const cover = keep[0], was = scores[cover]
  if (typeof was !== 'number' || !Number.isFinite(was)) return same('cover not scored')
  if (was < MARK_VISIBLE) return same('mark not visible on the cover')
  let best = cover, now = was
  for (const i of keep.slice(1, COVER_CANDIDATES)) {
    const s = scores[i]
    if (typeof s === 'number' && Number.isFinite(s) && s < now) { best = i; now = s }
  }
  if (best === cover || now > was * (1 - MARK_MIN_GAIN)) return same(`no clearly cleaner photo among the first ${COVER_CANDIDATES}`)
  return { keep: [best, ...keep.filter((i) => i !== best)], moved: { from: best, was, now }, why: 'moved' }
}

/** Decode one photo's centre window, or null. sharp is loaded lazily so importing this file is free. */
export async function markWindowOf(buf: Buffer, hostEdge: number): Promise<MarkWindow | null> {
  try {
    const sharp = (await import('sharp')).default
    const lim = { limitInputPixels: PHOTO_INPUT_PIXELS }
    const meta = await sharp(buf, lim).metadata()
    const swapped = (meta.orientation ?? 1) >= 5
    const srcW = (swapped ? meta.height : meta.width) ?? 0, srcH = (swapped ? meta.width : meta.height) ?? 0
    if (!(srcW > 0 && srcH > 0)) return null
    /** The host's own fit (host-product-image.ts): inside `hostEdge`, never enlarged — so a stored
     *  copy and the source it came from yield the same window, and a pool of stored copies can
     *  score a new import. */
    const scale = Math.min(1, hostEdge / Math.max(srcW, srcH))
    const imageWidth = Math.max(1, Math.round(srcW * scale)), imageHeight = Math.max(1, Math.round(srcH * scale))
    const width = Math.min(W, imageWidth), height = Math.min(H, imageHeight)
    const { data, info } = await sharp(buf, lim)
      .rotate()
      .resize({ width: imageWidth, height: imageHeight, fit: 'fill' })
      .flatten({ background: '#ffffff' })
      .extract({ left: Math.floor((imageWidth - width) / 2), top: Math.floor((imageHeight - height) / 2), width, height })
      .toColourspace('b-w')
      .raw()
      .toBuffer({ resolveWithObject: true })
    if (info.width !== width || info.height !== height) return null
    /** 'b-w' is one channel; anything else is read as its first channel rather than misindexed. */
    const ch = info.channels
    const grey = ch === 1 ? new Uint8Array(data) : Uint8Array.from({ length: width * height }, (_, i) => data[i * ch])
    return { width, height, imageWidth, imageHeight, data: grey }
  } catch {
    return null
  }
}

/**
 * The template for a source, learnt from eno's OWN stored copies of rows its importer already made
 * (`urls` — the caller passes only first-party overlay URLs). A photo that fails to fetch or decode is
 * skipped; too few left is `poolTooSmall`, and the caller keeps the source's order.
 */
export async function markTemplateFromUrls(
  urls: readonly string[],
  fetchBytes: (url: string) => Promise<Buffer | null>,
  hostEdge: number,
): Promise<MarkTemplateResult & { fetched: number; failed: number }> {
  const windows: MarkWindow[] = []
  let failed = 0
  for (const u of urls) {
    const buf = await fetchBytes(u).catch(() => null)
    const win = buf ? await markWindowOf(buf, hostEdge) : null
    if (win) windows.push(win); else failed++
  }
  return { ...markTemplate(windows), fetched: windows.length, failed }
}

/**
 * A GET of one of eno's own stored images: 20 s, an image content-type, ≤ STORED_IMAGE_MAX_BYTES — or null.
 * ⛔ THE CAP IS ENFORCED WHILE READING, not after: a declared content-length over it is refused before
 * the body is read, and the body is counted chunk by chunk and cancelled the moment it passes the cap
 * (a missing or lying content-length cannot make it buffer an unbounded object). `fetchImpl` is for tests.
 */
/** Waits for a stream's cancel; a cancel that fails means the stream is already closed — the answer is null either way. */
async function settle(p: Promise<void> | undefined): Promise<void> {
  try { await p } catch { /* already closed */ }
}
export async function fetchStoredImage(url: string, fetchImpl: typeof fetch = fetch, maxBytes = STORED_IMAGE_MAX_BYTES): Promise<Buffer | null> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000), headers: { accept: 'image/*' } })
    const declared = Number(res.headers.get('content-length') ?? NaN)
    if (!res.ok || !/^image\//.test(res.headers.get('content-type') ?? '') || !res.body || (Number.isFinite(declared) && declared > maxBytes)) {
      await settle(res.body?.cancel())
      return null
    }
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) { await settle(reader.cancel()); return null }
      chunks.push(value)
    }
    return total ? Buffer.concat(chunks, total) : null
  } catch {
    return null
  }
}

/** The first `perRow` URLs of each stored `images` JSON that `accept` passes — a template's seed. */
export function markSeedUrls(imagesJson: readonly string[], accept: (url: string) => boolean, perRow = COVER_CANDIDATES): string[] {
  const out: string[] = []
  for (const raw of imagesJson) {
    let imgs: unknown
    try { imgs = JSON.parse(raw) } catch { continue }
    if (!Array.isArray(imgs)) continue
    out.push(...imgs.filter((u): u is string => typeof u === 'string' && accept(u)).slice(0, perRow))
  }
  return out
}
