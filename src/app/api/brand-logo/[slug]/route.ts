import { db } from '@/lib/db'
import { brandLogoUrl, sanitizeBrandSvg } from '@/lib/brand-logo-url'

/**
 * Serves an admin-curated brand logo as a real, cacheable SVG file.
 *
 * ⛔ THE ALTERNATIVE WAS 648 KB OF INLINE DATA URIs ON `/brands` — see src/lib/brand-logo-url.ts for
 * the measurement. The URL carries a content hash (`?v=`), so the response is immutable: an admin
 * editing a logo changes the hash and therefore the URL.
 *
 * ⚠️ NOT MIGRATED TO `route()`, for the same reason as the product feeds: the success body is
 * `image/svg+xml` with its own cache headers, and the wrapper only speaks JSON. There is no auth,
 * no rate limit and no body to validate — a curated brand mark is public by definition.
 */
/**
 * ⛔ NO ISR ON THIS ROUTE, AND THAT IS THE FIX FOR A REAL POISONING HOLE. It was
 * `export const revalidate = 86400`, and the handler never read `?v=` — so Next cached the body
 * per `[slug]` alone. An admin editing a logo makes `/brands` emit a NEW hash URL, Next serves the
 * 24-hour-old body for it, and because the response is `max-age=31536000, immutable` the edge and
 * every browser then pin the OLD artwork under the NEW hash for a year, with no purge short of
 * renaming the brand. A reviewer caught it. The DB read is a single indexed lookup and Cloudflare
 * caches the result anyway, so there is nothing to buy back here.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const brand = await db.brand.findUnique({ where: { slug }, select: { logoPath: true } })
  const svg = brand?.logoPath ? sanitizeBrandSvg(brand.logoPath) : null
  // ⛔ 404 COVERS "no such brand", "not an SVG" AND "the SVG carried active content". The last is a
  // refusal, not an error: see sanitizeBrandSvg(). `brandLogoUrl()` applies the same check, so a
  // refused logo is never linked in the first place and the card falls back to its monogram.
  if (!svg) return new Response('Not found', { status: 404 })

  /**
   * ⚠️ `immutable` IS ONLY HONEST WHEN THE URL MATCHES THE BYTES. The `?v=` stamp is a hash of the
   * stored SVG (src/lib/brand-logo-url.ts); if a caller asks with a stale or invented one, the
   * CURRENT artwork is still correct to return, but pinning it for a year under the wrong key is
   * how a logo gets stuck. So a mismatch is served `no-store` instead.
   */
  const want = new URL(req.url).searchParams.get('v')
  const fresh = brandLogoUrl({ slug, logoPath: brand!.logoPath })
  const stamped = want !== null && fresh !== null && fresh.endsWith(`v=${want}`)

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      // Safe to pin for a year precisely because the caller's URL carries a hash of these bytes.
      'Cache-Control': stamped ? 'public, max-age=31536000, immutable' : 'no-store',
      // ⚠️ `nosniff` still earns its place — it stops a malformed logo being re-interpreted as
      // text/html. The scripting guard itself is in sanitize() above, NOT a CSP header here:
      // the app-wide CSP overrides anything this route sets. Read the note on sanitize().
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
