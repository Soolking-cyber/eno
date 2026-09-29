import { BannerImage } from '@/components/marketplace/banner-image'

/**
 * A storefront's optional cover image — the wide banner across the top of its shop page.
 *
 * ⚠️ OPTIONAL IS THE POINT, AND THE ABSENT CASE IS THE COMMON ONE. Almost no storefront has a
 * banner; this renders nothing at all for them, so the page keeps exactly the layout it has today
 * and nothing below it may assume the banner is there.
 *
 * ⚠️ SIZING, ART DIRECTION AND THE RESERVED BOX ALL LIVE IN <BannerImage> — read that file before
 * changing any of it. The banner sits ABOVE the seller card, which is the single worst place on the
 * page to take a layout shift.
 *
 * ⚠️ NOT WATERMARKED, deliberately — it is the seller's own artwork, like the avatar. The eno mark
 * goes on listing photos, which get scraped and re-shared. See src/lib/core/media.ts.
 */
export function StorefrontBanner({
  url,
  mobileUrl,
}: {
  url: string | null | undefined
  mobileUrl?: string | null
}) {
  if (!url) return null
  return (
    <BannerImage
      url={url}
      mobileUrl={mobileUrl}
      /* ⚠️ EMPTY ALT. The shop's name is the <h1> immediately below this — SellerCard's, on BOTH
         storefronts since 2026-09-29 (the subdomain one used to have only the explorer's sr-only
         site name, so this note was false there) — and naming the cover too makes a screen reader
         say it twice. A cover with words baked into the art (VietKite's "VIEW E-VISA OPTIONS") is
         still decorative: that text is a picture of a button that does nothing, and the fix is a
         clean creative (scripts/set-storefront-banner), not alt text reading it out. */
      alt=""
      /* Above the fold and the likely LCP element on a storefront that has one. */
      priority
      className="mb-4"
    />
  )
}
