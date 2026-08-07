import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'
import { ListingCardSkeleton } from '@/components/marketplace/listing-card-skeleton'

/**
 * Mirrors /c/[category]: breadcrumb → h-display title → lede → "By area" chip row →
 * masthead hairline → sort tab strip + <SellerListings> grid → "Refine in full search"
 * → hairlined "Other categories" chip cloud. Same containers and margins as page.tsx.
 *
 * ⚠️ `h-display` IS FLUID (`clamp(1.75rem, 1.4rem + 1.5vw, 2.5rem)` × 1.12 → 31.4px at
 * 390 and 44.8px at 1280), so a fixed `h-9` bar is 5px too tall on a phone and 9px too
 * short on a desktop. The bar tracks the token instead. Same for the `h-section` heading
 * (18px × 1.3 = 23.4) further down.
 *
 * ⚠️ The lede is `text-base leading-relaxed` — a 26px line box, not 16px. Measured on
 * /c/electronics it runs FOUR lines on a phone and two at max-w-prose, which is what the
 * bars below reserve; two `h-4` bars ran the block ~66px short on mobile. Reserve LINE BOXES,
 * never bars-plus-gaps — see the note on the block itself.
 *
 * The sort strip is the full-bleed <Tabs> row from seller-listings.tsx
 * (`-mx-3 border-b px-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8`, 42px incl. its hairline), not
 * a floating 40px pill.
 *
 * ⚠️ THREE BLOCKS HERE ARE CONDITIONAL ON THE REAL PAGE and are drawn unconditionally
 * because a route skeleton cannot know the data: the "By area" row is hidden when
 * `districts.length === 0`, the sort strip only renders when `listings.length > 1`, and an
 * EMPTY category drops the refine CTA + "Other categories" for a supply-side zero-state.
 * The happy path is the overwhelming majority; recorded so the residual shift is a known
 * cost rather than a surprise.
 */
export default function CategoryLoading() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-6 pb-12">
        {/* Breadcrumb (text-sm → 20px line) */}
        <Skeleton className="mb-4 h-5 w-40" />

        {/* h1 — h-display, fluid */}
        <Skeleton className="h-[calc(var(--text-display)*1.12)] w-72 max-w-full" />

        {/* Lede — text-base leading-relaxed (26px lines), max-w-prose.
            ⚠️ EACH ROW IS THE 26px LINE BOX, not the bar. `space-y-1` between four `h-[22px]`
            bars reserved 4×22 + 3×4 = 100px against a measured 104px paragraph (and 48 against 52
            at lg) — 4px short at BOTH viewports, because a gap-based stack is always ONE gap
            short of n line boxes. Reserving the line box and centring a 22px bar inside it keeps
            the same 4px rhythm AND lands on 4×26 = 104 / 2×26 = 52 exactly. */}
        <div className="mt-3 max-w-prose">
          <div className="flex h-[26px] items-center"><Skeleton className="h-[22px] w-full" /></div>
          <div className="flex h-[26px] items-center"><Skeleton className="h-[22px] w-full" /></div>
          <div className="flex h-[26px] items-center lg:hidden"><Skeleton className="h-[22px] w-11/12" /></div>
          <div className="flex h-[26px] items-center lg:hidden"><Skeleton className="h-[22px] w-2/3" /></div>
        </div>

        {/* "By area:" label + district chips (rounded-full px-3.5 py-1.5 text-xs → 28px) */}
        <div className="mt-6 flex flex-wrap gap-2">
          <Skeleton className="h-4 w-12 self-center" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-20 rounded-full" />
          ))}
        </div>

        {/* Masthead hairline — same full-bleed coupling as the page */}
        <div aria-hidden className="mt-8 -mx-3 border-t border-border sm:-mx-6 lg:-mx-8" />

        <div className="mt-6">
          <div className="space-y-4">
            {/* Sort tab strip — full-bleed, hairline-bottomed (42px) */}
            <div className="-mx-3 border-b border-border px-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
              <div className="flex items-center gap-1">
                {['w-16', 'w-14', 'w-28', 'w-10'].map((w, i) => (
                  <div key={i} className="px-3 py-2.5">
                    <Skeleton className={`h-5 ${w}`} />
                  </div>
                ))}
              </div>
            </div>

            {/* Listings grid — mirrors SellerListings exactly */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <ListingCardSkeleton key={i} />
              ))}
            </div>
          </div>
        </div>

        {/* "Refine in full search" button (px-5 py-2.5 text-sm → 40px) */}
        <div className="mt-8">
          <Skeleton className="h-10 w-48 rounded-xl" />
        </div>

        {/* Other categories */}
        <div className="mt-12 border-t border-border pt-8">
          <Skeleton className="h-[calc(var(--text-section)*1.3)] w-40" />
          <div className="mt-4 flex flex-wrap gap-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-24 rounded-full" />
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
