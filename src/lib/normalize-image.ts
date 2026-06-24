// Client-side image normalization. iPhone photos are often HEIC/HEIF, which most
// browsers can't render in <img>, our (Vercel) sharp can't decode, and the upload
// route rejects — so they were unusable. Convert HEIC → JPEG in the browser.
//
// Two tiers: (1) the browser's NATIVE decoder via createImageBitmap → canvas — free
// and instant, and it works on real iOS Safari (the main HEIC source); (2) fall
// back to heic-to (current libheif WASM) for browsers without a HEIC codec (e.g.
// desktop Chrome). heic-to replaces heic2any, whose stale libheif failed to parse
// modern iPhone HEIF ("Could not parse HEIF file").

const isHeicName = (f: File) => /image\/hei[cf]/i.test(f.type) || /\.(heic|heif)$/i.test(f.name)
const toJpgName = (f: File) => {
  const n = f.name.replace(/\.(heic|heif)$/i, '.jpg')
  return n.toLowerCase().endsWith('.jpg') ? n : `${n || 'photo'}.jpg`
}

async function viaCanvas(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file) // throws if the browser lacks a HEIC codec
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no-2d')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close?.()
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', 0.9),
  )
  return new File([blob], toJpgName(file), { type: 'image/jpeg' })
}

export async function normalizeImageFile(file: File): Promise<File> {
  if (!isHeicName(file)) return file
  // 1) Native decode (iOS Safari + any browser with a HEIC codec).
  try { return await viaCanvas(file) } catch { /* fall through to WASM */ }
  // 2) WASM decode (desktop Chrome/Firefox, which can't decode HEIC natively).
  const { heicTo } = await import('heic-to')
  const blob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 })
  return new File([blob], toJpgName(file), { type: 'image/jpeg' })
}

// ── Downscale + recompress (client) ───────────────────────────────────────────
// Modern phone photos are 3–12MB each; a few of them blow past the serverless
// request-body cap (Vercel ~4.5MB) and the upload 413s BEFORE our server-side
// sharp pass can shrink them. So we downscale + re-encode in the browser first.
// We match the server's own output (1600px longest edge, WebP q82) → the final
// stored image is identical, so there's no extra visible loss from doing it twice.
const MAX_EDGE = 1600
const WEBP_QUALITY = 0.82

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, q: number) =>
  new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), type, q))

/** HEIC→JPEG (if needed), then downscale to fit MAX_EDGE and re-encode to WebP
 *  (JPEG fallback for browsers whose canvas can't encode WebP). EXIF orientation
 *  is baked in via `imageOrientation`; all other metadata (incl. GPS) is dropped.
 *  Falls back to the (normalized) original if canvas decoding fails. */
export async function compressImageFile(file: File): Promise<File> {
  const base = isHeicName(file) ? await normalizeImageFile(file) : file
  try {
    let bitmap: ImageBitmap
    try { bitmap = await createImageBitmap(base, { imageOrientation: 'from-image' }) }
    catch { bitmap = await createImageBitmap(base) } // older browsers reject the options arg
    const ow = bitmap.width, oh = bitmap.height
    const scale = Math.min(1, MAX_EDGE / Math.max(ow, oh))
    const w = Math.max(1, Math.round(ow * scale))
    const h = Math.max(1, Math.round(oh * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) { bitmap.close?.(); return base }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    let blob = await canvasToBlob(canvas, 'image/webp', WEBP_QUALITY)
    let ext = 'webp', type = 'image/webp'
    if (!blob || blob.type !== 'image/webp') {
      blob = await canvasToBlob(canvas, 'image/jpeg', WEBP_QUALITY)
      ext = 'jpg'; type = 'image/jpeg'
    }
    if (!blob) return base
    // If recompression somehow grew the file (tiny/already-optimized source), keep the original.
    if (blob.size >= base.size && Math.max(ow, oh) <= MAX_EDGE) return base
    const stem = base.name.replace(/\.[^.]+$/, '') || 'photo'
    return new File([blob], `${stem}.${ext}`, { type })
  } catch {
    return base
  }
}
