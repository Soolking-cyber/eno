import Image from 'next/image'

/**
 * A storefront's optional cover image — the wide banner across the top of its shop page.
 *
 * ⚠️ OPTIONAL IS THE POINT, AND THE ABSENT CASE IS THE COMMON ONE. Almost no storefront has a
 * banner; this renders nothing at all for them, so the page keeps exactly the layout it has today
 * and nothing below it may assume the banner is there.
 *
 * ⚠️ EXPLICIT ASPECT RATIO, NOT AN INTRINSIC ONE. The banner sits ABOVE the seller card, so an
 * image that arrives without reserved space pushes the whole storefront down as it loads — the
 * single worst place on the page to take a layout shift, and this app measured its homepage CLS
 * down to 0.002 by removing exactly that class of jump. The box is sized from the ratio before the
 * image exists; `object-cover` absorbs whatever the seller actually uploaded.
 *
 * ⚠️ NOT WATERMARKED, deliberately — it is the seller's own artwork, like the avatar. The eno mark
 * goes on listing photos, which get scraped and re-shared. See src/lib/core/media.ts.
 */
export function StorefrontBanner({ url, name }: { url: string | null | undefined; name: string }) {
  if (!url) return null
  return (
    <div className="relative mb-4 w-full overflow-hidden rounded-2xl bg-tint aspect-[3/1] sm:aspect-[4/1]">
      <Image
        src={url}
        /* ⚠️ EMPTY ALT, NOT THE SHOP NAME. The name is already the <h1> immediately below this, so
           announcing it again makes a screen reader say it twice; a decorative cover adds nothing
           a caption has not said. */
        alt=""
        aria-hidden
        fill
        className="object-cover"
        /* Full-bleed within the page container at every breakpoint, so the browser fetches one
           appropriately sized candidate rather than the largest. */
        sizes="(min-width: 1280px) 1280px, 100vw"
        /* ⚠️ PRIORITY: this is above the fold and is very likely the LCP element on a storefront
           that has one. Without it Next lazy-loads the banner and the LCP waits on the viewport
           observer. */
        priority
      />
    </div>
  )
}
