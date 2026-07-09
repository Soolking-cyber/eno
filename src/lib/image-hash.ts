import 'server-only'
import sharp from 'sharp'

// Perceptual image hashing for duplicate detection (the IMAGE signal that complements the
// text/title/price signal in duplicate-guard). dHash ("difference hash"): shrink to 9×8
// greyscale, then for each of the 8×8 cells emit 1 bit = "is this pixel brighter than the
// one to its right". The result is stable across resize / recompress / light edits (a
// re-upload of the same photo hashes to a near-identical value → small Hamming distance),
// but differs sharply between genuinely different images. Cheap (~1ms). NEVER throws.

/** 64-bit dHash of an image buffer, as 16 lowercase hex chars, or null on decode failure.
 *  (Built a nibble at a time rather than via BigInt, to stay under the ES target.) */
export async function dHash(buf: Buffer): Promise<string | null> {
  try {
    // One extra column (9 wide) so each of the 8 usable columns has a right-neighbour.
    const px = await sharp(buf, { limitInputPixels: 50_000_000 })
      .greyscale()
      .resize(9, 8, { fit: 'fill' })
      .raw()
      .toBuffer()
    if (px.length < 9 * 8) return null
    let hex = ''
    let nibble = 0
    let count = 0
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const i = row * 9 + col
        nibble = (nibble << 1) | (px[i] > px[i + 1] ? 1 : 0)
        if (++count === 4) { hex += nibble.toString(16); nibble = 0; count = 0 }
      }
    }
    return hex // 64 bits → 16 hex chars
  } catch {
    return null
  }
}

/** Hamming distance (0–64) between two 16-hex dHashes. 0 = identical image; a re-encode /
 *  resize is typically ≤ ~8; genuinely different photos are ~25+. Returns 64 on bad input. */
export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) return 64
  let d = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    if (Number.isNaN(x)) return 64
    while (x) { d += x & 1; x >>= 1 }
  }
  return d
}

// The dHash is embedded in the stored filename (`…-h<16hex>.webp`) by storeListingImage, so
// it travels inside the image URL already saved on the listing — no schema/DB column needed.
const HASH_IN_URL = /-h([0-9a-f]{16})\./i

/** Extract the embedded dHash from a stored image URL, or null (older images have none). */
export function hashFromUrl(url: string): string | null {
  const m = HASH_IN_URL.exec(url)
  return m ? m[1].toLowerCase() : null
}

/** How many of A's images are a near-duplicate of some image of B (Hamming ≤ threshold),
 *  plus min(#hashed A, #hashed B). Both take the listings' stored image-URL arrays; images
 *  without an embedded hash (older uploads) are skipped. Threshold 10 ≈ "same photo,
 *  re-encoded/cropped". Callers judge with a MAJORITY rule rather than a single match, so a
 *  shop reusing one brand banner/logo across listings never trips it — only a genuine repost
 *  (most/all photos shared) does. */
export function imageOverlap(urlsA: string[], urlsB: string[], threshold = 10): { count: number; minHashed: number } {
  const ha = urlsA.map(hashFromUrl).filter((h): h is string => !!h)
  const hb = urlsB.map(hashFromUrl).filter((h): h is string => !!h)
  let count = 0
  for (const a of ha) if (hb.some((b) => hammingHex(a, b) <= threshold)) count++
  return { count, minHashed: Math.min(ha.length, hb.length) }
}

/** The repost rule: at least 2 shared photos AND at least half of the smaller photo set. A
 *  true repost reuses most/all shots (passes); a shared banner (1 of N) or a couple of common
 *  branded cards (below half) do not. */
export function isImageRepost(urlsA: string[], urlsB: string[], threshold = 10): boolean {
  const { count, minHashed } = imageOverlap(urlsA, urlsB, threshold)
  return count >= 2 && count >= Math.ceil(0.5 * minHashed)
}
