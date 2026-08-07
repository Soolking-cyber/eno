import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * PDP route skeleton — mirrors `listings/[id]/page.tsx` block for block.
 *
 * ⚠️ IT IS ONE TREE, NOT TWO, exactly like the page: a single
 * `flex flex-col gap-6 lg:grid lg:grid-cols-12 lg:gap-x-10 lg:gap-y-8` whose column wrappers are
 * `display:contents` on mobile, so every block's `order-*` sequences ONE shared flow
 * (breadcrumb → shop strip → gallery → price/title/meta → contact → protections → description →
 * safety → map → note) and snaps into col-7 media / col-5 sticky buy box at lg. The previous
 * version used two containers (a flex-col, then a separate `mt-8 grid`) plus a title header and a
 * share/save row that the page has not rendered since the price-first buy box landed.
 *
 * Every height below was MEASURED against the live page (2026-08-07) — at 390px and 1440px, and
 * for the listing-dependent blocks across the 18 listings the seed serves, so the reservation is
 * the MEDIAN listing rather than whichever one happened to be open:
 *   breadcrumb 20 · shop strip 58 mobile / 48 md+ (14 of 18) · gallery 390²/693² + 8 + 84 rail ·
 *   header block 144.8 · contact 128 · protections 55 · safety strip 89 · reviews 186 (12 of 18) ·
 *   map 28+8+260 = 296 · safety note 39 mobile / 19.5 md+.
 *
 * ⚠️ THE GALLERY IS SQUARE ON BOTH BREAKPOINTS. The old 2-col `h-[440px]` Airbnb mosaic was
 * replaced in listing-gallery.tsx on 2026-07-14 by one large viewport + a synced thumbnail rail,
 * and the mobile mount is edge-to-edge (`-mx-3 sm:-mx-6`), square and `rounded-none` (owner
 * 2026-07-23/24). Standing a 4:3 rounded card in for it collapsed several hundred pixels on swap.
 *
 * ⚠️ TWO BLOCKS ARE UNBOUNDED AND ARE DELIBERATELY *NOT* TUNED TO ANY ONE LISTING: the
 * description (order-8) and the details table. Measured across the same 18 listings the real
 * order-8 runs 62 → 634px at 390 (median 291) and 62 → 530 at 1440 (median 262) — the copy is
 * seller-written, so no fixed reservation can be right. 3 prose lines + a 4-row spec table
 * (336px) sits between the two medians; re-tuning it to the median moved the mean absolute error
 * by 2px on mobile. Leave it. It is below the fold on both breakpoints, so what it costs is a
 * document-height step, not a visible shove of anything the reader is looking at.
 */

/** The Shopee-style shop-on-top strip (<PdpShopLink>) — rendered TWICE by the page (mobile above
 *  the gallery, desktop above the media column), so it is one shape here too. Avatar size="lg"
 *  (h-12) sets the floor at 48px.
 *
 *  ⚠️ IT IS NOT 48 TALL ON MOBILE. The honest-metrics strip (response · last seen · joined ·
 *  rating) is one line in the 557px desktop column but WRAPS TO TWO in the 230px mobile one —
 *  measured 58px on 14 of the 18 seeded listings — and this strip sits ABOVE the gallery, so
 *  under-reserving it shoves the whole page down 10px on swap, above the fold. Hence the second
 *  metrics line, `md:hidden`: 20 name + 4 + (16+2+16) = 58 mobile, 20 + 4 + 16 = 40 → 48 at md+. */
function ShopStripSkeleton() {
  return (
    <div className="flex items-center gap-3">
      <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1">
        {/* name + business badge + trust chip */}
        <Skeleton className="h-5 w-44 max-w-full" />
        {/* metrics strip (text-xs) — two lines below md, one from md up */}
        <div className="mt-1 space-y-0.5">
          <Skeleton className="h-4 w-56 max-w-full" />
          <Skeleton className="h-4 w-32 max-w-full md:hidden" />
        </div>
      </div>
      {/* "Shop ›" */}
      <Skeleton className="h-7 w-16 shrink-0 rounded-xl" />
    </div>
  )
}

export default function ListingLoading() {
  return (
    <div className="flex min-h-screen flex-col blob-bg">
      <Header />
      {/* Padding matches the live page's <main> EXACTLY (pt-4 pb-8 lg:pb-12). */}
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-4 pb-8 lg:pb-12">
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-12 lg:gap-x-10 lg:gap-y-8">

          {/* 1 — Breadcrumb (text-sm → 20px line, full width) */}
          <Skeleton className="order-1 h-5 w-64 max-w-full lg:col-span-12" />

          {/* Shop-on-top, MOBILE mount (md:hidden — the desktop twin is in the left column) */}
          <div className="order-2 md:hidden"><ShopStripSkeleton /></div>

          {/* 2 — Gallery, MOBILE mount: edge-to-edge, square, no radius. */}
          <div className="order-2 -mx-3 sm:-mx-6 md:hidden">
            <div className="aspect-square w-full rounded-none shimmer skeleton-photo" />
          </div>

          {/* RIGHT COLUMN (lg col-5) — the sticky buy box. `contents` on mobile. */}
          <div className="contents lg:order-3 lg:col-span-5 lg:block">
            <div className="contents lg:sticky lg:top-24 lg:flex lg:flex-col lg:gap-4 lg:border-l lg:border-border/70 lg:pl-10">

              {/* 3 — HEADER BLOCK: price (text-3xl → 36) → seal line (16) → title
                  (text-lg leading-snug → 24.8) → metadata row (badges 24 + text-sm 20). */}
              <div className="order-3 flex flex-col gap-2">
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-9 w-52 max-w-full" />
                  <Skeleton className="h-4 w-44 max-w-full" />
                </div>
                <Skeleton className="h-[25px] w-full" />
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-6 w-28 rounded-full" />
                    <Skeleton className="h-6 w-14 rounded-full" />
                  </div>
                  <Skeleton className="h-5 w-64 max-w-full" />
                </div>
              </div>

              {/* 6 — ContactComposer, signed-out shape (the cold-load case): Chat now →
                  offer CTA → 2-line footnote, in a space-y-2 stack = 128px. */}
              <div className="order-6 space-y-2">
                <Skeleton className="h-10 w-full rounded-xl" />
                <Skeleton className="h-10 w-full rounded-xl" />
                <div className="space-y-1">
                  <Skeleton className="mx-auto h-3.5 w-11/12" />
                  <Skeleton className="mx-auto h-3.5 w-2/3" />
                </div>
              </div>

              {/* 7 — <ProtectionsRow/>: a bordered tint box (rounded-xl px-3.5 py-2.5,
                  h-5 seal + 2 lines of text-xs) — it lives HERE in the buy box, not at the
                  top of the left column. */}
              <Skeleton className="order-7 h-[55px] w-full rounded-xl" />

              {/* 9 — <SafetyStrip/> + Report (rounded-xl warning box) */}
              <Skeleton className="order-9 h-[89px] w-full rounded-xl" />

              {/* 10 — <ReviewsPreview/>. The page renders it only when the seller HAS reviews,
                  which is 12 of the 18 seeded listings — so reserving it is right two times out
                  of three and leaving it out was wrong two times out of three. Measured 186px
                  (border-t + pt-4 + h2 28 + mb-3 + two 42px review rows in a space-y-3 + the
                  mt-3 "See all" link), the tightest cluster of any variable block on this page
                  (132–186 across the sample). It costs nothing at lg — the buy box is ~670px
                  against a ~1600px media column, so the grid row is sized by the other side. */}
              <div className="order-10 border-t border-border pt-4">
                <Skeleton className="h-7 w-40 max-w-full" />
                <div className="mt-3 space-y-3">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="flex gap-3">
                      <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                      <div className="min-w-0 flex-1 space-y-2.5">
                        <Skeleton className="h-4 w-32 max-w-full" />
                        <Skeleton className="h-4 w-full" />
                      </div>
                    </div>
                  ))}
                </div>
                <Skeleton className="mt-3 h-5 w-24" />
              </div>
            </div>
          </div>

          {/* LEFT COLUMN (lg col-7) — media + copy. `contents` on mobile. */}
          <div className="contents lg:order-2 lg:col-span-7 lg:flex lg:flex-col lg:gap-8">

            {/* Shop-on-top, DESKTOP mount */}
            <div className="order-1 hidden md:block"><ShopStripSkeleton /></div>

            {/* 2 — Gallery, DESKTOP mount: one square viewport + the synced h-20 thumb rail */}
            <div className="order-2 hidden md:block">
              <div className="aspect-square w-full rounded-2xl shimmer skeleton-photo" />
              {/* The rail is 84 tall, not 80: the embla viewport that wraps the h-20 thumbs
                  measures 84 (matching `Carousel`'s own `relative mt-2 px-0.5` mount), so a bare
                  80px row left the media column 4px short on every multi-photo listing. */}
              <div className="mt-2 flex h-[84px] items-start gap-2 px-0.5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-20 shrink-0 rounded-lg" />
                ))}
              </div>
            </div>

            {/* 8 — Description + Details (gap-8 between the two sections; h2 is the
                text-lg SECTION title → a 28px line box, not 24).
                ⚠️ SELLER-WRITTEN, SO THIS IS A MEDIAN, NOT A MATCH. Across the 18 seeded
                listings the real block runs 62 → 634px at 390 (median 291) and 62 → 530 at
                1440 (median 262) — the copy and the spec count are the seller's, and no fixed
                reservation can be right for all of them. 4 prose lines (the 4th `md:hidden`,
                because the same paragraph wraps ~1.8× more often in the 366px mobile column
                than in the 656px `max-w-prose` desktop one) + a 2-row spec table gives
                285 / 257 — within 6px of both medians. It used to be a flat 336 on both,
                which was 45 over the mobile median and 74 over the desktop one; that surplus
                was quietly standing in for the reviews block that order-10 below now reserves
                properly, and two compensating errors are not a match. */}
            <div className="order-8 flex flex-col gap-8">
              <div className="space-y-2">
                <Skeleton className="h-7 w-32" />
                <div className="max-w-prose space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full md:w-3/4" />
                  <Skeleton className="h-4 w-2/3 md:hidden" />
                </div>
              </div>
              {/* Spec table: 2 rows is the median (0–5 across the sample). `divide-y` is the
                  real <dl>'s own hairline — with it the pair measures 81, matching the page. */}
              <div className="space-y-2">
                <Skeleton className="h-7 w-24" />
                <div className="divide-y divide-border">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between gap-4 py-2.5">
                      <Skeleton className="h-5 w-28" />
                      <Skeleton className="h-5 w-20" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 11 — Location map (h2 28 + space-y-2 + the h-[260px] rounded-2xl canvas) */}
            <div className="order-11 space-y-2">
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-[260px] w-full rounded-2xl" />
            </div>

            {/* 12 — Safety note (icon + 1–2 lines of text-xs). The real block is a <p> whose
                `text-xs leading-relaxed` line box is 19.5px, so each bar sits in its OWN 19.5px
                line box rather than being a 16px bar in a space-y-1 stack (the old 36/16 pair
                ran 3px short at both ends).
                ⚠️ THE WRAP IS NOT MONOTONIC IN VIEWPORT WIDTH, so neither `md:hidden` nor the
                original `lg:hidden` can express it. The copy is measured at 2 lines / 1 line /
                2 lines / 1 line across 390 · 768 · 1024 · 1440, because at md the note spans the
                full 720px column, at lg it drops into the ~530px col-7, and only by xl is that
                column (693px) wide enough again. Hence the three-step pair. */}
            <div className="order-12 flex items-start gap-2">
              <Skeleton className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex h-[19.5px] items-center"><Skeleton className="h-4 w-full" /></div>
                <div className="flex h-[19.5px] items-center md:hidden lg:flex xl:hidden"><Skeleton className="h-4 w-2/3" /></div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
