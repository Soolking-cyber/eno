import { Skeleton } from '@/components/ui/skeleton'
import { ListingCardSkeleton } from '@/components/marketplace/listing-card-skeleton'
import { LISTING_GRID } from '@/components/marketplace/listing-grid'
import { LEDE_PLACEMENT } from './lede-placement'

/**
 * The skeleton for what /c/[category] renders UNDER ITS H1: lede → "By area" chip row → masthead
 * hairline → sort tab strip + <SellerListings> grid → "Refine in full search" → hairlined "Other
 * categories" chip cloud. Same margins as page.tsx, inside the same `<main>`.
 *
 * ⛔ NO HEADER, `<main>`, BREADCRUMB, H1 OR FOOTER HERE. They render in place in `(index)/layout.tsx`,
 * above this boundary, so crawlers read them (SEO wave B, H1b); a copy here would print a second
 * header and `<main>` for as long as this shows, and a second `#app-header` / `#main` in every cached
 * page's HTML, which is what the skeleton did before. The contract test fails if one comes back.
 * ⚠️ THE LEDE BARS FOLLOW `LEDE_PLACEMENT` (lede-placement.ts, decision H-c): while the lede renders
 * in the page ('page'), it is under this boundary and these bars stand in for it; under 'layout' it is
 * already on screen above this skeleton, so they are not drawn.
 *
 * ⚠️ The lede is `text-base leading-relaxed` — a 26px line box, not 16px. On a phone it is clamped
 * to TWO lines with a "Show more" button under it (clamped-lede.tsx, C1-FOLD); from sm it is whole,
 * four lines at sm/md and two at max-w-prose from lg. Reserve LINE BOXES, never bars-plus-gaps — see
 * the note on the block itself.
 *
 * The sort strip is the <Tabs> row from seller-listings.tsx (`border-b`, 42px incl. its hairline, on
 * the content box since C1-HAIRLINE), with the "Filters" link at its end — not a floating 40px pill.
 * ⚠️ THE GEOMETRY ABOVE THE GRID IS THE PAGE'S, CLASS FOR CLASS (C1-FOLD, 2026-09-29): one chip row
 * that scrolls on a phone, the hairline at mt-4/sm:mt-8, the grid at mt-4/sm:mt-6. Change one, change
 * both, or the swap from this skeleton to the page moves the grid.
 *
 * ⚠️ THE "Other categories" HEADING BAR TRACKS THE `h-section` TOKEN (× 1.3 line height), not a fixed
 * height: the heading type is fluid, so a fixed bar is wrong at one viewport or the other.
 *
 * ⚠️ THREE BLOCKS HERE ARE CONDITIONAL ON THE REAL PAGE and are drawn unconditionally
 * because a route skeleton cannot know the data: the "By area" row is hidden unless three places
 * hold five or more listings each (C1-LEDE — on 2026-09-29 that is /c/rentals and few others; the
 * row is drawn for rentals, the page this family's traffic lands on), the sort strip only renders
 * when `listings.length > 1`, and an
 * EMPTY category drops the refine CTA + "Other categories" for a supply-side zero-state.
 * The happy path is the overwhelming majority; recorded so the residual shift is a known
 * cost rather than a surprise.
 */
export default function CategoryLoading() {
  return (
    <>
      {/* Lede — text-base leading-relaxed (26px lines), max-w-prose.
          ⚠️ EACH ROW IS THE 26px LINE BOX, not the bar. `space-y-1` between four `h-[22px]`
          bars reserved 4×22 + 3×4 = 100px against a measured 104px paragraph (and 48 against 52
          at lg) — 4px short at BOTH viewports, because a gap-based stack is always ONE gap
          short of n line boxes. Reserving the line box and centring a 22px bar inside it keeps
          the same 4px rhythm AND lands on 4×26 = 104 / 2×26 = 52 exactly. */}
      {LEDE_PLACEMENT === 'page' && (
        <div className="mt-3 max-w-prose">
          <div className="flex h-[26px] items-center"><Skeleton className="h-[22px] w-full" /></div>
          <div className="flex h-[26px] items-center"><Skeleton className="h-[22px] w-full" /></div>
          <div className="hidden h-[26px] items-center sm:flex lg:hidden"><Skeleton className="h-[22px] w-11/12" /></div>
          <div className="hidden h-[26px] items-center sm:flex lg:hidden"><Skeleton className="h-[22px] w-2/3" /></div>
          {/* The phone's "Show more" (mt-1 + a 20px line) — clamped-lede.tsx. */}
          <div className="h-6 sm:hidden" />
        </div>
      )}

      {/* "By area:" label + district chips (rounded-full px-3.5 py-1.5 text-xs → 28px), in the
          page's own box: one 36px row on a phone (py-1 around 28px chips), wrapping from sm. */}
      <div className="mt-3 flex flex-nowrap items-center gap-2 overflow-hidden py-1 sm:mt-6 sm:flex-wrap sm:py-0">
        <Skeleton className="h-4 w-12 shrink-0" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-20 shrink-0 rounded-full" />
        ))}
      </div>

      {/* Masthead hairline — on the content box, like the page's */}
      <div aria-hidden className="mt-4 border-t border-border sm:mt-8" />

      <div className="mt-4 sm:mt-6">
        <div className="space-y-4">
          {/* Sort tab strip — hairline-bottomed (42px), the Filters link at its end */}
          <div className="flex items-center border-b border-border">
            <div className="flex min-w-0 items-center gap-1 overflow-hidden">
              {['w-16', 'w-14', 'w-28', 'w-10'].map((w, i) => (
                <div key={i} className="shrink-0 px-3 py-2.5">
                  <Skeleton className={`h-5 ${w}`} />
                </div>
              ))}
            </div>
            <Skeleton className="ml-auto h-5 w-20 shrink-0" />
          </div>

          {/* Listings grid — mirrors SellerListings exactly */}
          <div className={LISTING_GRID}>
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
    </>
  )
}
