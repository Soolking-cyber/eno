import Link from 'next/link'
import { Search } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { Header } from './header'
import { Footer } from './footer'
import { Mascot } from './mascot'
import { Bilingual } from './bilingual'
import { LocalizedTitle } from './listing-content'
import { RelatedListings } from './related-listings'
import { localizedHref } from '@/lib/lang-pinned'
import type { GoneListingView } from '@/lib/gone-listing'

/**
 * The page a listing URL shows once an import shop's row has left eno: a 200 with noindex,follow, not a
 * 404 — src/lib/gone-listing.ts says which rows get it and why. SoldListing's layout as its "gone" twin
 * (sold-listing.tsx): the heading, the item's NAME so the visitor knows they reached the right page, live
 * SECOND-HAND alternatives (RelatedListings 'gone'), then a search for the same thing.
 *
 * ⛔ NOTHING ELSE ABOUT THE ROW — no photo, price, seller, contact or description. Not by omission in the
 * markup: the props cannot carry them (GoneListingView is seven fields), so neither the HTML nor the RSC
 * payload can.
 * ⚠️ ONE ORDER AT EVERY WIDTH (heading → name → alternatives → search), so unlike the sold page there is
 * no second copy of the action row to keep DOM and visual order equal (WCAG 2.4.3).
 */
export function GoneListing({
  listing,
  searchQuery,
  lang = 'en',
  titleI18n = null,
}: {
  listing: GoneListingView
  /** goneSearchQuery: brand + model, or the title's key words in the page's language. */
  searchQuery: string
  /** The page variant ('vi' | 'en'): the search link keeps a Vietnamese reader in Vietnamese (localizedHref). */
  lang?: string
  /** The title's pre-warmed translations (cachedTranslations), as the sold page embeds them. */
  titleI18n?: Record<string, string> | null
}) {
  const searchHref = localizedHref(`/?q=${encodeURIComponent(searchQuery.trim())}`, lang)

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="relative flex-1 overflow-hidden">
        {/* Brand glow — pure CSS, no images (the sold page's and the 404's treatment). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: 'radial-gradient(55% 45% at 50% 26%, rgba(10,102,194,0.09), transparent 70%), radial-gradient(40% 40% at 85% 82%, rgba(10,102,194,0.06), transparent 70%)' }}
        />

        <section className="mx-auto w-full max-w-lg px-4 pt-4 pb-4 text-center sm:pt-14 sm:pb-0">
          <Mascot name="search" className="mx-auto h-20 w-20 sm:h-60 sm:w-60" />
          <h1 className="h-display mt-3 text-foreground sm:mt-6">
            <Bilingual en="This listing is no longer on eno" vi="Tin này không còn trên eno" />
          </h1>
          {/* What was here, by name only, in the reader's language (titleVi, then the embedded translations). */}
          <p data-gone-title="" className="mx-auto mt-4 line-clamp-2 max-w-sm rounded-2xl bg-tint p-3 text-sm font-semibold text-foreground sm:mt-6">
            <LocalizedTitle title={listing.title} titleVi={listing.titleVi} i18n={titleI18n} />
          </p>
        </section>

        {/* Live, verified, used listings: the same model first, then the same shelf, then the category —
            client-fetched from the edition-scoped feed, so the cached page never lists a stale card. */}
        <div className="mx-auto w-full max-w-7xl px-3 sm:px-6 lg:px-8">
          <RelatedListings
            listingId={listing.id}
            categorySlug={listing.categorySlug}
            subcategorySlug={listing.subcategorySlug}
            brandSlug={listing.brandSlug}
            model={listing.model}
            variant="gone"
          />
        </div>

        {/* A title of nothing but symbols leaves no query: no "Search for “”" link then. */}
        {searchQuery.trim() ? (
          <div className="mx-auto flex w-full max-w-lg justify-center px-4 pt-6 pb-10 sm:pt-8 sm:pb-12">
            <Button asChild variant="cta" size="none" className="max-w-full">
              <Link data-gone-search="" href={searchHref} className="px-4 py-2.5">
                <Search className="h-4 w-4" />
                <span className="min-w-0 truncate"><Bilingual en="Search for “{query}”" vi="Tìm “{query}”" values={{ query: searchQuery.trim() }} /></span>
              </Link>
            </Button>
          </div>
        ) : null}
      </main>
      <Footer />
    </div>
  )
}
