import 'server-only'
// ⚠️ NOT a top-level `import sharp` — see lib/sharp-lazy.ts. lib/image-provenance imports this and
// lib/core/listings imports that, so /api/listings inherits whatever happens at this module's scope.
import { getSharp } from '@/lib/sharp-lazy'
import { hashFromUrl, hammingHex } from '@/lib/image-hash-url'

// Re-export the isomorphic URL/hash helpers so existing server importers of this module keep
// working; the pure (no-sharp) versions live in image-hash-url.ts so client code (the publish
// guard, imported by the post wizard) can use them without pulling sharp / server-only.
export { hashFromUrl, hammingHex, hexToBits, countDistinctAngles, SAME_ANGLE_THRESHOLD } from '@/lib/image-hash-url'

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
    const sharp = await getSharp()
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

/** The repost rule: at least 2 shared photos AND a STRICT majority (> half) of the smaller
 *  photo set. A true repost reuses most/all shots (passes); a shared banner (1 of N), or a
 *  couple of common branded/size/warranty cards that land at exactly half (e.g. 2 of 4), do
 *  NOT — strict-majority avoids the even-N "exactly 50%" false positive. */
export function isImageRepost(urlsA: string[], urlsB: string[], threshold = 10): boolean {
  const { count, minHashed } = imageOverlap(urlsA, urlsB, threshold)
  return count >= 2 && count > minHashed / 2
}
