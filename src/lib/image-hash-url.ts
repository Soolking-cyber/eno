// Isomorphic perceptual-hash helpers — NO sharp, safe in client + server bundles. The heavy
// dHash *computation* stays in the server-only image-hash.ts; these operate on the hash already
// embedded in a stored image URL (`…-h<16hex>.webp`, baked by storeListingImage), so a listing's
// saved image URLs carry their own fingerprints with no DB column and no re-decode.

const HASH_IN_URL = /-h([0-9a-f]{16})\./i

/** Extract the embedded dHash from a stored image URL, or null (older images have none). */
export function hashFromUrl(url: string): string | null {
  const m = HASH_IN_URL.exec(url)
  return m ? m[1].toLowerCase() : null
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

/** 16-hex dHash → the 64-char "0/1" string Postgres casts to bit(64) (`$1::bit(64)`), used to
 *  store/query the pgvector Hamming index for cross-app image dedup. */
export function hexToBits(hex: string): string {
  let bits = ''
  for (const c of hex) bits += (parseInt(c, 16) || 0).toString(2).padStart(4, '0')
  return bits.slice(0, 64).padEnd(64, '0')
}

// Two shots within this Hamming distance are the SAME angle (one photo re-encoded/cropped/
// lightly edited). Deliberately tight — genuinely different angles sit ~25+, so only a literal
// duplicate merges; three distinct angles of the same item always count as three.
export const SAME_ANGLE_THRESHOLD = 10

/** Count DISTINCT camera angles among a listing's stored image URLs: greedily cluster shots
 *  whose dHashes are within `threshold`, so uploading the same photo 3× counts as 1. Images
 *  without an embedded hash (older/mock uploads, or a decode that failed) are counted as
 *  distinct — fail-open, since we can't prove they're duplicates. */
export function countDistinctAngles(urls: string[], threshold = SAME_ANGLE_THRESHOLD): number {
  const reps: string[] = []
  let unhashed = 0
  for (const url of urls) {
    const h = hashFromUrl(url)
    if (!h) { unhashed++; continue }
    if (!reps.some((r) => hammingHex(r, h) <= threshold)) reps.push(h)
  }
  return reps.length + unhashed
}
