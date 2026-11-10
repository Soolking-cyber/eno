/**
 * Which of JPEG, PNG or WebP a file's first bytes are, read in the browser: the client twin of `sniffImageType` in
 * src/lib/core/media.ts. That one cannot be imported here (core/media.ts is `server-only` and reads a Node Buffer).
 * ⛔ KEEP THE TWO IN LOCKSTEP. image-sniff.test.ts runs both over the same buffers and fails on any disagreement.
 * The upload routes refuse every other format before sharp sees it (R37), so a photo's own bytes may be sent only when
 * this names them; anything else goes up as the browser's re-encode (compressImageFile in normalize-image.ts).
 */
export type SniffedImage = 'image/jpeg' | 'image/png' | 'image/webp'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const latin1 = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to))

/** JPEG `ff d8 ff`, PNG's full 8-byte signature, WebP `RIFF....WEBP`; null for anything else. */
export function sniffImageBytes(head: Uint8Array): SniffedImage | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head.length >= 8 && PNG_SIGNATURE.every((b, i) => head[i] === b)) return 'image/png'
  if (head.length >= 12 && latin1(head, 0, 4) === 'RIFF' && latin1(head, 8, 12) === 'WEBP') return 'image/webp'
  return null
}

/** The first 12 bytes of `blob`, sniffed; null when they cannot be read. `Blob.arrayBuffer()` only arrived in Safari 14,
 *  so the Response form is the fallback (as in post-draft-photos.ts). */
export async function sniffImageFile(blob: Blob): Promise<SniffedImage | null> {
  try {
    const head = blob.slice(0, 12)
    const buf = typeof head.arrayBuffer === 'function' ? await head.arrayBuffer() : await new Response(head).arrayBuffer()
    return sniffImageBytes(new Uint8Array(buf))
  } catch {
    return null
  }
}
