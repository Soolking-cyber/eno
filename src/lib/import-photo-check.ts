/**
 * IS THIS SOURCE PHOTO A REAL PHOTO? — one rule for every property importer that re-hosts a rival
 * portal's gallery (scripts/import-muaban-net.ts, scripts/import-nhatot-com.ts).
 *
 * Extracted from scripts/muaban-net-map.ts (imageVerdict / flatnessOf / galleryPlan, measured there on
 * 2026-09-24) so a second importer applies the SAME text-card and logo test instead of a copy that
 * drifts. Everything but `measureImage` is pure; `measureImage` loads sharp lazily, inside the call,
 * so importing this file costs nothing and a unit test of the verdicts needs no native module.
 *
 * ⚠️ 'placeholder' IS A MEASURED HEURISTIC, STATED AS SUCH. Some ads upload a text card ("CHO THUÊ",
 * "CHO THUÊ NHÀ") or a logo instead of a photo, and one was the COVER of a row the first muaban cut
 * counted as importable (muaban:71117474). Two independent signals, either of which refuses the image:
 *  - `entropy` (sharp stats): cards measured 3.19 / 3.58 / 3.86, real photos 6.52–7.86 → floor 5.0;
 *  - `flat`: the share of the frame covered by its three most common colours after quantising a
 *    64x64 thumbnail to 4 bits a channel (flatnessOf). Measured 2026-09-24: the 71117474 card 0.74
 *    at thumb-detail (0.79–0.80 for cards at thumb-md); 136 real photos 0.05–0.57, the top being a
 *    bright white-tiled mini-apartment (muaban:71255957). 0.7 sits between them; a first cut at 0.6
 *    would have refused white rooms, which are common here. It catches a card drawn over a gradient
 *    or a logo on a plain ground, whose entropy can clear 5.0.
 * ⛔ FAILS CLOSED: an image that cannot be decoded, or whose measures are missing or out of range,
 * is 'undecodable' — never assumed fine.
 */
import { hammingHex, SAME_ANGLE_THRESHOLD } from './image-hash-url'

export type ImageVerdict = 'ok' | 'placeholder' | 'tooSmall' | 'undecodable'
/**
 * ⚠️ THE DEFAULT FLOOR IS THE LONG EDGE ONLY, because muaban serves `thumb-detail` fitted inside
 * ~672x504, so a real phone portrait arrives as 232x504; a short-edge floor of 240 refused exactly
 * that on muaban's first live dry run. A source that serves full-size photos passes a stricter
 * `ImageSizeFloor` (nhatot does).
 */
export const MIN_IMAGE_LONG_EDGE = 300
export const PLACEHOLDER_ENTROPY = 5.0
export const PLACEHOLDER_FLAT = 0.7
/** `hash`: the 16-hex dHash of the upright, white-flattened photo — the same algorithm the image
 *  host writes into the stored filename, so near-duplicates can be dropped BEFORE anything uploads. */
export type ImageMeasure = { width?: number; height?: number; entropy?: number; flat?: number; hash?: string | null }
export type ImageSizeFloor = { minLongEdge?: number; minShortEdge?: number }

const inRange = (n: unknown, lo: number, hi: number): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi

export function imageVerdict(m: ImageMeasure | null, floor: ImageSizeFloor = {}): ImageVerdict {
  if (!m || !inRange(m.width, 1, 100_000) || !inRange(m.height, 1, 100_000) || !inRange(m.entropy, 0, 64) || !inRange(m.flat, 0, 1)) return 'undecodable'
  const long = Math.max(m.width, m.height), short = Math.min(m.width, m.height)
  if (long < (floor.minLongEdge ?? MIN_IMAGE_LONG_EDGE) || short < (floor.minShortEdge ?? 0)) return 'tooSmall'
  if (m.entropy < PLACEHOLDER_ENTROPY || m.flat >= PLACEHOLDER_FLAT) return 'placeholder'
  return 'ok'
}

/**
 * The share of pixels covered by the three most common colours, each channel quantised to 4 bits.
 * `data` is raw interleaved pixels (sharp `.raw()`), `channels` 3 or 4 (alpha ignored).
 */
export function flatnessOf(data: Uint8Array, channels: number): number {
  const n = Math.floor(data.length / channels)
  if (!(n > 0) || channels < 3) return NaN
  const bins = new Map<number, number>()
  for (let i = 0; i + 2 < data.length; i += channels) {
    const k = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4)
    bins.set(k, (bins.get(k) ?? 0) + 1)
  }
  const top = [...bins.values()].sort((a, b) => b - a).slice(0, 3)
  return top.reduce((s, c) => s + c, 0) / n
}

/**
 * ⛔ ONE GALLERY RULE FOR THE DRY RUN AND --apply, so what the probe predicts is what is written.
 * In source order: 'ok' is kept; 'placeholder'/'tooSmall' is REFUSED and simply not in the gallery,
 * so a text-card cover hands the cover to the first real photo; a fetch or decode failure fails the
 * whole row (all-or-nothing — the next run retries it rather than publishing a short gallery).
 * ⚠️ A gallery where EVERY photo is refused is `keep: []` with `failed: false` — "nothing real", not
 * "could not tell". The minimum is the CALLER's: muaban skips a row with no kept photo, nhatot needs
 * three distinct ones (nhatotPhotoPlan).
 */
export type PhotoOutcome = ImageVerdict | 'fetchFailed'
export function galleryPlan(verdicts: PhotoOutcome[]): { keep: number[]; refused: Partial<Record<'placeholder' | 'tooSmall', number>>; failed: boolean } {
  const keep: number[] = []
  const refused: Partial<Record<'placeholder' | 'tooSmall', number>> = {}
  let failed = false
  verdicts.forEach((v, i) => {
    if (v === 'ok') keep.push(i)
    else if (v === 'placeholder' || v === 'tooSmall') refused[v] = (refused[v] ?? 0) + 1
    else failed = true
  })
  return { keep, refused, failed }
}

/**
 * The same shot uploaded twice is ONE photo — the publish gate counts DISTINCT angles
 * (countDistinctAngles, image-hash-url.ts) at the same threshold. Keeps the first of each
 * near-duplicate cluster, in order. A missing hash counts as distinct (fail-open, as the gate does).
 */
export function dropNearDuplicates(keep: number[], hashes: (string | null | undefined)[], threshold = SAME_ANGLE_THRESHOLD): { keep: number[]; duplicates: number } {
  const reps: string[] = []
  const out: number[] = []
  let duplicates = 0
  for (const i of keep) {
    const h = hashes[i]
    if (h && reps.some((r) => hammingHex(r, h) <= threshold)) { duplicates++; continue }
    if (h) reps.push(h)
    out.push(i)
  }
  return { keep: out, duplicates }
}

/** dHash from a 9x8 greyscale raw buffer, 16 hex — image-hash.ts / host-product-image.ts's algorithm. */
function dHashOf(px: Uint8Array): string | null {
  if (px.length < 72) return null
  let hex = '', nib = 0, c = 0
  for (let r = 0; r < 8; r++) for (let col = 0; col < 8; col++) {
    nib = (nib << 1) | (px[r * 9 + col] > px[r * 9 + col + 1] ? 1 : 0)
    if (++c === 4) { hex += nib.toString(16); nib = 0; c = 0 }
  }
  return hex
}

/** The longest edge both importers re-host at (makeImageHost({ edge: 1600 })). */
export const HOST_EDGE = 1600

/**
 * The dHash the image host will write into the stored filename, computed the way it computes it:
 * EXIF-upright, fitted inside `edge` without enlarging, flattened on white, encoded to PNG — and only
 * then greyscaled and shrunk to 9x8 (host-product-image.ts, hostBufferDetailed + dHashPng).
 *
 * ⛔ THE SAME STEPS, NOT A SHORTCUT. A first cut hashed straight from the source in one pipeline
 * (rotate → flatten → greyscale → 9x8); measured 2026-09-24 over 20 real photos it differed from the
 * host's hash by up to 10 bits — the whole SAME_ANGLE_THRESHOLD — because sharp shrinks a JPEG while
 * decoding it when the target is tiny. The importer would then predict a different set of distinct
 * photos than the publish gate counts after upload. import-photo-check.test.ts pins the two equal
 * against the real makeImageHost.
 */
async function hostDHash(sharp: typeof import('sharp').default, buf: Buffer, edge: number): Promise<string | null> {
  const img = sharp(buf, { limitInputPixels: 50_000_000 }).rotate()
  const meta = await img.metadata()
  const swapped = (meta.orientation ?? 1) >= 5
  const srcW = (swapped ? meta.height : meta.width) ?? edge
  const srcH = (swapped ? meta.width : meta.height) ?? edge
  const scale = Math.min(1, edge / Math.max(srcW, srcH))
  const png = await img
    .resize({ width: Math.max(1, Math.round(srcW * scale)), height: Math.max(1, Math.round(srcH * scale)), fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer()
  return dHashOf(await sharp(png).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer())
}

/**
 * Decode one photo and take the measures imageVerdict reads, or null when it cannot be decoded.
 * (One-channel and grey+alpha PNGs, greyscale and CMYK JPEGs all yield three channels here — sharp's
 * raw output is sRGB unless told otherwise, measured 2026-09-24 and pinned in the test — so
 * flatnessOf never sees fewer than three from a decodable image.)
 */
export async function measureImage(buf: Buffer, opts: { hostEdge?: number } = {}): Promise<ImageMeasure | null> {
  try {
    const sharp = (await import('sharp')).default
    const lim = { limitInputPixels: 50_000_000 }
    // ⚠️ A TRANSPARENT IMAGE IS CAUGHT BY `flat`, NOT BY `entropy` (measured 2026-09-24): sharp's
    // resize premultiplies alpha, so hidden pixels come out black in the 64x64 thumbnail whatever RGB
    // they hold, and a logo on a transparent ground reads ~0.98 flat. `stats()` ignores pipeline ops
    // (a `.flatten()` before it does not change the entropy), so flattening here would buy nothing.
    const [meta, stats, small, hash] = await Promise.all([
      sharp(buf, lim).metadata(),
      sharp(buf, lim).stats(),
      sharp(buf, lim).resize(64, 64, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
      hostDHash(sharp, buf, opts.hostEdge ?? HOST_EDGE),
    ])
    // Upright dimensions, as the host stores the photo (it `.rotate()`s first). The size floors read
    // only the long and short edge, so this changes no verdict; it keeps the printed sizes true.
    const swapped = (meta.orientation ?? 1) >= 5
    const width = swapped ? meta.height : meta.width, height = swapped ? meta.width : meta.height
    return { width, height, entropy: stats.entropy, flat: flatnessOf(small.data, small.info.channels), hash }
  } catch {
    return null
  }
}
