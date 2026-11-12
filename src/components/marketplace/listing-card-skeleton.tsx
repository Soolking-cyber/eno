import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** How many card placeholders /saved reserves before the favourites set is known.
 *  ONE literal shared by the route-transition skeleton (saved/loading.tsx) and the
 *  page's own pre-hydration skeleton (saved/page.tsx) — they drew 8 and 2 from two
 *  hand-typed numbers, so a hard load flashed eight cards, collapsed to two, then
 *  grew to the real count. */
export const SAVED_SKELETON_COUNT = 8

/** The one loading placeholder for a listing card — photo + price/title/meta bars (+ the proof bar for a
 *  teacher cell, `teacher`), exactly the real card's shape so nothing shifts when data lands (CLS invariant).
 *  Wrappers own width/snap classes; this owns the inner stack.
 *  Was hand-rolled in 6 places with drifting bar counts.
 *
 *  ⚠️ THE BODY IS THE REAL CARD'S BOX MODEL, CLASS FOR CLASS — `flex flex-col
 *  gap-0.5 px-2 pt-2 sm:px-0.5` (listing-card.tsx, the body div). It used to be `space-y-3` with
 *  mt-2/space-y-1.5 bars, which put every bar at a different offset from the text it
 *  stood in for and made the card the wrong TOTAL height at every breakpoint.
 *  Re-derived from the classes for the owner's Facebook-spaced grid (2026-10-18) — the card body is
 *  pt-2 (8) + price + gap-0.5 (2) + title + 2 + the info row's pt-1 (4) + its line:
 *      phone (<640)    8 + 20 + 2 + 19.25 + 2 + 4 + 16  = 71.25px   (under a 189px photo at 390)
 *      sm and up       8 + 22.5 + 2 + 19.25 + 2 + 4 + 16 = 73.75px  (under 192–298px photos)
 *  A TEACHER card leads with the name since 2026-11-12 (owner, "go all"; listing-card.tsx TEACHER_TITLE_LINE): name
 *  then rate, at sizes chosen to keep the same line-box total — 16·1.375 + 14·1.25 = 39.5 against the price-first
 *  card's 16·1.25 + 14·1.375 = 39.25 on a phone, and 18·1.375 + 16·1.25 = 44.75 against 18·1.25 + 16·1.375 = 44.5
 *  from sm. MEASURED on a local production build (2026-11-12), the teacher card's text column against a price-first
 *  card's on the same page: 72 vs 71.3px on an iPhone 14, 80.8 vs 80.5px at 1280 — so those two bars serve both (they
 *  keep the price-first order).
 *  ⚠️ BUT A TEACHER BODY IS 18px TALLER SINCE BATCH 80 (owner, 2026-11-12, "build 2"): the proof line, one 12px
 *  `text-xs` line (16px) + its gap-0.5 (2), reserved on every teacher card (listing-card.tsx `data-teacher-proof`).
 *  `teacher` adds its bar between the title and META bars: 8 + 20 + 2 + 19.25 + 2 + 16 + 2 + 4 + 16 = 89.25px on a phone
 *  against the card's 89.5. Callers that KNOW their cells are teachers pass it (/c/teachers' sort placeholders —
 *  seller-listings.tsx; /?category=teachers' first page and Show-more cells — listings-explorer.tsx); a mixed surface
 *  (saved, for-you, rails, related) keeps the plain skeleton, and a teacher card landing there grows its row by 18px.
 *  ⚠️ The sm row of the table above counts the title at 19.25px; the title is
 *  `sm:text-base` (22px line) there, so that row under-counts by ~2.75px for EVERY card — older than this note.
 *  The bar heights below are those line boxes, so keep them tied to the type they stand in for
 *  rather than rounding them to spacing steps. (The 2026-08-07 table that sat here — 117 / 94 / 75px —
 *  measured the old two-title-line card.)
 *
 *  ⚠️ The photo box is aspect-SQUARE and must stay identical to ListingCard's
 *  (owner 2026-07-21: cards are square, no odd ratios), and it wears the same corner, `rounded-media`
 *  (owner 2026-10-18: "minimal squircle corners") — it was 12px under an 18px card photo, so the corner
 *  visibly changed shape as a card landed. Five places share the ratio and the corner and must move
 *  together: listing-card, this skeleton, the SEO tile (seo-listing-rail.tsx), the wizard Preview, and
 *  capacitor/www/index.html's .ph. */
export function ListingCardSkeleton({ className, teacher = false }: { className?: string; teacher?: boolean }) {
  return (
    <div className={cn('flex flex-col', className)}>
      <div className="aspect-square w-full rounded-media shimmer skeleton-photo" />
      {/* Mirrors the Facebook-Marketplace-shaped card body (2026-09-13): one price line, ONE title
          line, one info line, inset like the card's text on a phone (a teacher card swaps the first two
          since 2026-11-12 at the same height, and adds its proof line — `teacher`, the note above). Heights
          are the real line boxes — re-derive them if any of the card's type sizes change. */}
      <div className="flex flex-col gap-0.5 px-2 pt-2 sm:px-0.5">
        {/* PRICE — text-base/leading-tight below sm (20px), text-lg/leading-tight above (22.5px): ONE line.
            ⚠️ THE "≈ $…" IS NOT GONE, whatever this note used to say — the owner asked for it back
            after the đồng price the day it was dropped (2026-09-13), and a goods price still fits one
            line with it (48 of 48 on /c/electronics at 390px, 2026-09-29).
            ⚠️ A PER-UNIT PRICE USED NOT TO: "9,000,000 đ / month ≈ $351" wrapped to two lines (40px) on
            every rental card at 390px (48 of 48 on /c/rentals). Since 2026-10-18 the card prints it in
            millions ("9M đ / month ≈ $351", vnd.ts RATE_COMPACT_VND) — one line in English at 390 for a rent
            like that one (a two-digit rent with a decimal, "10.2M đ / month ≈ $398", still wraps); in
            Vietnamese with no "đ" after "triệu" (the owner's exception, same day — with the mark only a
            whole single-digit rent fit): "8,5 triệu / tháng" and "15 triệu / tháng" fit at 390 (173 and
            165px of 173), "12,5 triệu / tháng" (180px) wraps there and fits at 412. What still wraps —
            at 390 a two-digit rent with a decimal or a four-figure "≈ $", at 412 a rent with both and any
            of 100 triệu or more, at either a second decimal or an odd figure's "≈ " (vnd.ts has the sweep)
            — takes 40px. This bar reserves one line regardless — a two-line reserve would
            collide with the owner's "price 1 line" card spec (2026-09-13). */}
        <Skeleton className="h-5 w-1/2 sm:h-[22.5px]" />
        {/* TITLE — `truncate` text-sm/leading-snug: one 19.25px line. */}
        <Skeleton className="h-[19.25px] w-4/5 sm:h-[22px]" />
        {/* PROOF — a teacher cell only: the card's reserved text-xs line (16px at every width). */}
        {teacher && <Skeleton data-skeleton-proof="" className="h-4 w-2/5" />}
        {/* META — the unchanged info line under the real row's pt-1 (4px): text-xs on a phone (a 16px line —
            this bar was 15px, a pixel short, since D-TYPE raised the phone row to 12px), and text-xs from sm too since 2026-11-05. */}
        <Skeleton className="mt-1 h-4 w-1/2 lg:h-5" />
      </div>
    </div>
  )
}
