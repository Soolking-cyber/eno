// Square (1:1) cropping for the post wizard — the platform format is square (cards + PDP hero
// are aspect-square). Owner, 2026-07-24: new photos should be square BY DEFAULT with a keep-full
// escape, and the seller can reframe which square part is kept. Video is deliberately NOT squared
// (the TikTok-style video feed needs its native portrait aspect).
//
// Everything here is browser-only (Canvas / createImageBitmap) and runs on the client during
// posting. Two memory disciplines the reviewers insisted on (codex + Gemini): decode ORIENTATION-
// CORRECT (EXIF is otherwise applied to display but not to the pixels we crop), and never keep a
// full-resolution bitmap around — we downscale to OUT_EDGE at the source and close() bitmaps
// promptly. Callers process photos SEQUENTIALLY so only one large bitmap is live at a time.

/** Longest edge of the stored output — matches MAX_EDGE in normalize-image.ts / native-photos.ts. */
const OUT_EDGE = 1600
const WEBP_QUALITY = 0.82

/** A crop rectangle in the SOURCE image's own pixel space — the shape react-easy-crop returns as
 *  `croppedAreaPixels`. */
export type CropArea = { x: number; y: number; width: number; height: number }

async function canvasToFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  const toBlob = (type: string, q: number) =>
    new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), type, q))
  // WebP first (matches the rest of the pipeline); JPEG for the odd canvas that can't encode WebP.
  let blob = await toBlob('image/webp', WEBP_QUALITY)
  let type = 'image/webp'
  if (!blob || blob.type !== 'image/webp') {
    blob = await toBlob('image/jpeg', WEBP_QUALITY)
    type = 'image/jpeg'
  }
  if (!blob) throw new Error('square-crop: canvas encode failed')
  const ext = type === 'image/webp' ? 'webp' : 'jpg'
  return new File([blob], name.replace(/\.[^.]+$/, '') + `-sq.${ext}`, { type })
}

/** Decode a file with its EXIF orientation baked into the pixels (so a phone-rotated photo crops
 *  the region the seller actually sees). The caller closes the returned bitmap. */
function decodeOriented(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file, { imageOrientation: 'from-image' })
}

/** The largest centered square that fits WxH — the default framing before the seller reframes. */
export function centerSquare(w: number, h: number): CropArea {
  const side = Math.min(w, h)
  return { x: Math.round((w - side) / 2), y: Math.round((h - side) / 2), width: side, height: side }
}

/** Draw a square region of `bitmap` into a fresh OUT_EDGE-bounded square canvas. The output side is
 *  min(source side, OUT_EDGE) so we never UPSCALE a small source. */
function squareCanvas(bitmap: ImageBitmap, area: CropArea): HTMLCanvasElement {
  // Clamp the source ORIGIN inside the bitmap, then take the largest square that still fits from
  // there. Using ONE `srcSide` for both source dimensions guarantees sw === sh — clamping width and
  // height independently could turn a rounded/edge-overrunning area into a slightly non-square rect
  // that then gets stretched into the square canvas (codex).
  const sx = Math.max(0, Math.min(Math.round(area.x), bitmap.width - 1))
  const sy = Math.max(0, Math.min(Math.round(area.y), bitmap.height - 1))
  const srcSide = Math.max(1, Math.min(Math.round(area.width), Math.round(area.height), bitmap.width - sx, bitmap.height - sy))
  const outSide = Math.min(srcSide, OUT_EDGE)
  const canvas = document.createElement('canvas')
  canvas.width = outSide
  canvas.height = outSide
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('square-crop: no 2d context')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, sx, sy, srcSide, srcSide, 0, 0, outSide, outSide)
  return canvas
}

/**
 * Center-crop `file` to 1:1 — the DEFAULT square (owner: "square by default"). `file` must already
 * be a canvas-decodable image (the wizard passes compressImageFile's output, so HEIC is already
 * JPEG/WebP — createImageBitmap can't decode HEIC on Android). Returns the input on any failure, so
 * a photo is never lost; it just stays its natural aspect (shown blur-filled), exactly like today.
 */
export async function centerCropSquare(file: File): Promise<File> {
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await decodeOriented(file)
    return await canvasToFile(squareCanvas(bitmap, centerSquare(bitmap.width, bitmap.height)), file.name)
  } catch {
    return file
  } finally {
    bitmap?.close()
  }
}

/**
 * Re-crop an already-downscaled `original` to the square `area` the seller framed (react-easy-crop's
 * croppedAreaPixels, in `original`'s pixel space). Returns the input on failure.
 */
export async function cropToSquare(original: File, area: CropArea): Promise<File> {
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await decodeOriented(original)
    return await canvasToFile(squareCanvas(bitmap, area), original.name)
  } catch {
    return original
  } finally {
    bitmap?.close()
  }
}
