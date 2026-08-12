import Link from 'next/link'
import { Store, ArrowRight, Home } from '@/components/ui/icons'
import { Header } from './header'
import { Footer } from './footer'
import { Mascot } from './mascot'
import { SameSellerShelf } from './same-seller-shelf'
import { Tr } from '@/context/language-context'
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
}: {
  listing: SerializedListing
  moreFromSeller: SerializedListingCard[]
  sellerName: string
  sellerHref: string
}) {
  const cover = listing.images[0] ?? null
  const categoryHref = `/c/${listing.category.slug}`

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="relative flex-1 overflow-hidden">
        {/* Brand glow — pure CSS, no images (mirrors the 404 treatment). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{ background: 'radial-gradient(55% 45% at 50% 26%, rgba(10,102,194,0.09), transparent 70%), radial-gradient(40% 40% at 85% 82%, rgba(10,102,194,0.06), transparent 70%)' }}
        />

        <section className="mx-auto w-full max-w-lg px-4 pt-14 pb-6 text-center">
          <Mascot name="success" className="mx-auto h-52 w-52 sm:h-60 sm:w-60" />
          <p className="eyebrow mt-6 text-accent-foreground"><Tr text="Sold" /></p>
          <h1 className="h-display mt-2 text-foreground"><Tr text="This item has been sold" /></h1>

          {/* What sold — grayscale thumbnail + SOLD ribbon + title, so the visitor
              sees they reached the right item, just too late. */}
          <div className="mx-auto mt-6 flex max-w-sm items-center gap-3 rounded-2xl bg-tint p-3 text-left">
            {cover ? (
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-muted">
                <img src={cover} alt="" className="h-full w-full object-cover opacity-55 grayscale" />
                <span className="absolute inset-x-0 bottom-0 bg-foreground/75 py-0.5 text-center text-3xs font-bold uppercase tracking-wide text-background">
                  <Tr text="Sold" />
                </span>
              </div>
            ) : null}
            <p className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold text-foreground">{listing.title}</p>
          </div>

          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-body">
            <Tr text="This one found a new home. Here's more you might like." />
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
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
                href="/"
                className="inline-flex items-center rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground"
              >
                <Home className="h-4 w-4" /> <Tr text="Home" />
              </Link>
            </Button>
          </div>
        </section>

        {/* Keep shopping — the seller's other live stock (renders nothing under 2). */}
        {moreFromSeller.length >= 2 && (
          <div className="mx-auto w-full max-w-7xl px-3 pb-12 sm:px-6 lg:px-8">
            <SameSellerShelf listings={moreFromSeller} sellerHref={sellerHref} sellerName={sellerName} />
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
