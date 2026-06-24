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
