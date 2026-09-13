/**
 * WHICH STORED IMAGES GET THE APP-DRAWN eno.vn MARK, AND HOW — read from the URL alone.
 *
 * Isomorphic (no sharp, no server-only): cards, the PDP gallery and the map popup all decide from the
 * URL they already hold, so there is no DB column and no probe at render time. Same idea as
 * image-hash-url.ts's `-h<16hex>` fingerprint, which this convention sits BEFORE so both parse.
 *
 * Owner, 2026-09-13: "consistent sizing and placement of eno.vn watermark on all images". Imported
 * product photos are now stored CLEAN under `listings/affiliate/m/` and the mark is drawn over them by
 * the app. What the renderer needs was measured at import and written into the NAME:
 *
 *   …/listings/affiliate/m/<slug>-<ts36>-<rand>-i<cover><contain>-<W>x<H>[-h<16hex>].webp
 *
 *   cover   ink for the mark on a SQUARE, object-cover frame (cards, map popup): measured on the
 *           bottom-right of the photo's centred square, which is what that frame shows.
 *   contain ink for the mark on an object-contain frame (PDP gallery, lightbox): measured on the
 *           photo's OWN bottom-right corner, which is where the mark lands there.
 *   W x H   the stored pixel size, so a contain frame can put the mark on the photo rather than on the
 *           letterbox around it — without waiting for the image to load.
 *
 * ⛔ NO OVERLAY ON ANY OTHER URL, AND THAT IS THE SAFETY PROPERTY. Every image stored before this
 * change carries a BURNED mark; a second one over it would print "eno.vn" twice. Only a URL that
 * STARTS WITH our own storage origin + bucket + folder, and whose object name matches this shape
 * exactly, gets the overlay. The first cut matched the path anywhere in the string, so a look-alike
 * path on a foreign host passed — three reviewers caught it. Same prefix rule as listing-image.ts's
 * isListingImageUrl (read from NEXT_PUBLIC_SUPABASE_URL, which the stored URLs are built from).
 */

export type MarkInk = 'dark' | 'light'
export type OverlayMark = { cover: MarkInk; contain: MarkInk; width: number; height: number }

/** The object NAME inside `affiliate/m/`: one segment, the first-party key alphabet, this shape. */
const OVERLAY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*-i([dl])([dl])-(\d{1,5})x(\d{1,5})(?:-h[0-9a-f]{16})?\.webp$/i
/** Read at call time, so tests can stub it; Next inlines NEXT_PUBLIC_* wherever it is referenced. */
function overlayPrefix(): string | null {
  const host = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
  return host ? `${host}/storage/v1/object/public/listings/affiliate/m/` : null
}
const ink = (c: string): MarkInk => (c.toLowerCase() === 'd' ? 'dark' : 'light')
const letter = (i: MarkInk) => (i === 'dark' ? 'd' : 'l')

/** What the overlay needs for this image, or null when it must NOT get one (not a clean import). */
export function overlayMarkFromUrl(url: string | null | undefined): OverlayMark | null {
  const prefix = overlayPrefix()
  if (!url || !prefix || !url.startsWith(prefix)) return null
  const m = OVERLAY_NAME.exec(url.slice(prefix.length))
  if (!m) return null
  const width = Number(m[3]), height = Number(m[4])
  if (!(width > 0 && height > 0)) return null
  return { cover: ink(m[1]), contain: ink(m[2]), width, height }
}

/** True when a stored image is a clean import the app marks — the ONE test scripts and renderers share. */
export function isOverlayImageUrl(url: string | null | undefined): boolean {
  return overlayMarkFromUrl(url) !== null
}

/** The storage path (inside the `listings` bucket) for a clean imported image. `stamp`/`rand` are
 *  passed in so tests are exact. */
export function overlayImagePath(
  slug: string, inks: { cover: MarkInk; contain: MarkInk }, width: number, height: number,
  hash: string | null, stamp: string, rand: string,
): string {
  const safe = slug.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'img'
  const h = hash && /^[0-9a-f]{16}$/i.test(hash) ? `-h${hash.toLowerCase()}` : ''
  return `affiliate/m/${safe}-${stamp}-${rand}-i${letter(inks.cover)}${letter(inks.contain)}-${Math.round(width)}x${Math.round(height)}${h}.webp`
}
