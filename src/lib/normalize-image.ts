// Client-side image normalization. iPhone photos are often HEIC/HEIF, which most
// browsers can't render in <img> and which our (Vercel) sharp can't decode — so the
// preview was blank, the AI classify failed, and the upload route rejected it.
// Convert HEIC → JPEG in the browser so every downstream step gets a standard image.
// heic2any (libheif WASM, ~1.4MB) is dynamically imported only when needed.

const isHeic = (f: File) => /image\/hei[cf]/i.test(f.type) || /\.(heic|heif)$/i.test(f.name)

export async function normalizeImageFile(file: File): Promise<File> {
  if (!isHeic(file)) return file
  const heic2any = (await import('heic2any')).default
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
  const blob = Array.isArray(out) ? out[0] : out
  const name = file.name.replace(/\.(heic|heif)$/i, '.jpg') || 'photo.jpg'
  return new File([blob], name.endsWith('.jpg') ? name : `${name}.jpg`, { type: 'image/jpeg' })
}
