import Link from 'next/link'
import Image from 'next/image'
import { Store, ArrowRight, Home } from '@/components/ui/icons'
import { Header } from './header'
import { Footer } from './footer'
import { categoryBrowsePath } from '@/lib/retired-categories'
import { Mascot } from './mascot'
import { SameSellerShelf } from './same-seller-shelf'
import { RelatedListings } from './related-listings'
import { isListingImageUrl, isMockImageUrl } from '@/lib/listing-image'
import { Tr } from '@/context/language-context'
import { LocalizedTitle } from './listing-content'
import { localizedHref } from '@/lib/lang-pinned'
import type { SerializedListing, SerializedListingCard } from '@/lib/types'
import { Button } from '@/components/ui/button'

/**
 * Dedicated "this item has been sold" page — shown at a sold listing's own URL
 * instead of a bare 404. A sale is a good outcome (the success mascot celebrates
 * it), and the page keeps the shopper moving: it names what sold, then offers the
 * seller's other stock + the category. Noindexed by the caller's metadata (a sold
 * URL shouldn't stay in search), but a real, on-brand page for anyone who lands here.
 */
export function SoldListing({
  listing,
  moreFromSeller,
  sellerName,
  sellerHref,
  lang = 'en',
  titleI18n = null,
}: {
  listing: SerializedListing
  moreFromSeller: SerializedListingCard[]
  sellerName: string
  sellerHref: string
  /** The page variant ('vi' | 'en'): the Home and category links keep a Vietnamese reader in Vietnamese. */
  lang?: string
  /** The title's pre-warmed translations (cachedTranslations), as the PDP embeds them: the name renders in
   *  the reader's language in the server HTML, with no client translate request and no English flash. */
  titleI18n?: Record<string, string> | null
}) {
  const cover = listing.images[0] ?? null
  // A retired shelf (vehicles redirects to a rental hub) browses in the explorer instead — retired-categories.ts.
  // Through localizedHref, like the PDP's breadcrumb: a bare '/' or '/?category=' pins the reader to English.
  const categoryHref = localizedHref(categoryBrowsePath(listing.category.slug), lang)
  const homeHref = localizedHref('/', lang)

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      {/* ⛔ BELOW sm THE ALTERNATIVES COME BEFORE THE BUTTONS (pdp-06 / auth-07). The 208px mascot, the
          H1 and three CTAs filled the first screen, and the first similar card started under the tab bar
          (y=791 of 844): someone who arrived too late saw nothing they could buy. Below sm the mascot is
          h-20, the top padding pt-4, and the button row follows the rails; from sm it sits under the
          heading, exactly as before.
          ⚠️ TWO RENDERS OF ONE ROW, NOT `order-*` (review, 2026-10-04). A reordered flex child leaves the
          DOM — tab and reading — order different from what is seen (WCAG 2.4.3). Each copy is display:none
          at the other's breakpoints (`hidden sm:flex` / `flex sm:hidden`), so exactly one is in the tab
          order and the accessibility tree at any width. */}
      <main id="main" tabIndex={-1} className="relative flex-1 overflow-hidden">
        {/* Brand glow — pure CSS, no images (mirrors the 404 treatment). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: 'radial-gradient(55% 45% at 50% 26%, rgba(10,102,194,0.09), transparent 70%), radial-gradient(40% 40% at 85% 82%, rgba(10,102,194,0.06), transparent 70%)' }}
        />

        <section className="mx-auto w-full max-w-lg px-4 pt-4 pb-4 text-center sm:pt-14 sm:pb-0">
          <Mascot name="success" className="mx-auto h-20 w-20 sm:h-60 sm:w-60" />
          {/* No 'Sold' kicker above the heading: pure-label eyebrows are retired (owner, 2026-08-05),
              and the H1 and the SOLD ribbon on the thumbnail below already say it twice. */}
          <h1 className="h-display mt-3 text-foreground sm:mt-6"><Tr text="This item has been sold" /></h1>

          {/* What sold — grayscale thumbnail + SOLD ribbon + title, so the visitor
              sees they reached the right item, just too late. */}
          <div className="mx-auto mt-4 flex max-w-sm items-center gap-3 rounded-2xl bg-tint p-3 text-left sm:mt-6">
            {cover ? (
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-muted">
                {/* Through the image optimizer, not the stored original: a 64px box was downloading the
                    full-size listing photo. A fixed box, so width/height (a 64/128 1x-2x srcset), not
                    `fill`, which lists every width up to 1080. `unoptimized` only for what it would refuse
                    (anything outside our listings bucket 400s there) and for mock/seed CDN images. */}
                <Image src={cover} alt="" width={64} height={64} quality={60} unoptimized={!isListingImageUrl(cover) || isMockImageUrl(cover)} className="h-full w-full object-cover opacity-55 grayscale" />
                <span className="absolute inset-x-0 bottom-0 bg-foreground/75 py-0.5 text-center text-3xs font-bold uppercase tracking-wide text-background">
                  <Tr text="Sold" />
                </span>
              </div>
            ) : null}
            {/* The item's name in the reader's language — the raw title left a Vietnamese page saying
                'VIETMAP H1AS Head-Up Display…' under a Vietnamese <title> (pdp-06). */}
            <p className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold text-foreground"><LocalizedTitle title={listing.title} titleVi={listing.titleVi} i18n={titleI18n} /></p>
          </div>

          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-body sm:mt-4">
            <Tr text="This one found a new home. Here's more you might like." />
          </p>
        </section>

        {/* From sm: seller · category · Home, under the heading (the phone's copy follows the rails). */}
        <SoldActions sellerHref={sellerHref} categoryHref={categoryHref} homeHref={homeHref} className="hidden sm:flex sm:mt-6 sm:pb-6" />

        {/* Keep shopping. FIRST the same kind of thing from anyone (the visitor came for THIS item, and
            it is gone), THEN the seller's other live stock (renders nothing under 2). The similar rail
            leaves the seller's rows out whenever their rail is showing, so no card appears twice.
            Each rail carries its own top margin and renders nothing when empty, so the bottom padding
            is keyed on a rail being there (`has-[section]`) — an empty wrapper adds no band above the
            footer. */}
        <div className="mx-auto w-full max-w-7xl px-3 sm:px-6 lg:px-8 has-[section]:pb-8 sm:has-[section]:pb-12">
          <RelatedListings
            listingId={listing.id}
            categorySlug={listing.category.slug}
            subcategorySlug={listing.subcategorySlug}
            brandSlug={listing.brandSlug}
            excludeSellerId={moreFromSeller.length >= 2 ? listing.sellerId : undefined}
            variant="sold"
          />
          {moreFromSeller.length >= 2 && (
            <SameSellerShelf listings={moreFromSeller} sellerHref={sellerHref} sellerName={sellerName} />
          )}
        </div>

        {/* Below sm: the same row, after the rails (see <main>). */}
        <SoldActions sellerHref={sellerHref} categoryHref={categoryHref} homeHref={homeHref} className="flex pb-10 sm:hidden" />
      </main>
      <Footer />
    </div>
  )
}

/**
 * Seller · category · Home. Rendered twice by SoldListing — under the heading from sm, after the rails below
 * it — and `className` decides which copy shows at which width (it carries the display class: never both).
 */
function SoldActions({ sellerHref, categoryHref, homeHref, className }: { sellerHref: string; categoryHref: string; homeHref: string; className: string }) {
  return (
    <div className={`mx-auto w-full max-w-lg flex-wrap items-center justify-center gap-2 px-4 ${className}`}>
      <Button asChild variant="cta" size="none">
        <Link
          href={sellerHref}
          className="px-4 py-2.5"
        >
          <Store className="h-4 w-4" /> <Tr text="More from this seller" />
        </Link>
      </Button>
      {/* font-bold / gap-1.5 ride on the BUTTON, not the child: asChild goes through
          Base UI's render prop, which CONCATENATES classNames — only the Button's own
          className passes through cn()/twMerge, so a child override loses to the base
          (font-medium, gap-2) on stylesheet order alone. */}
      <Button asChild variant="outline" size="none" className="font-bold">
        <Link
          href={categoryHref}
          className="inline-flex items-center rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Tr text="Browse this category" /> <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
      <Button asChild variant="ghost" size="none" className="gap-1.5 font-semibold">
        <Link
          href={homeHref}
          className="inline-flex items-center rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground"
        >
          <Home className="h-4 w-4" /> <Tr text="Home" ctx="page" />
        </Link>
      </Button>
    </div>
  )
}
