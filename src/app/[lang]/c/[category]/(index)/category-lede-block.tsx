import Link from 'next/link'
import { CategoryLede, TeacherCoverLink } from '@/components/marketplace/category-lede'
import { Bilingual } from '@/components/marketplace/bilingual'
import { RentalCheckHint } from '@/components/marketplace/rental-check-toggle'
import { RENTAL_CHECK_PATH } from '@/lib/rental-check/shared'
import { loadCategory } from '../load-category'
import { loadLinkedCount, loadRentalsFacts, loadTopSubcategories } from '../category-data'
import { linkedTier } from '../category-copy'
import { RentalsLede } from '../category-text'
import { ClampedLede } from '../clamped-lede'
import { cn } from '@/lib/utils'

/**
 * The category page's lede: one measured paragraph (two lines and "Show more" on a phone —
 * clamped-lede.tsx), plus, on /c/rentals, the availability-check hint. The Rent Index link moved
 * under the grid, into RentalsDistricts (C1-FOLD: the phone's fold is the budget).
 *
 * ⛔ THE COUNTS LIVE HERE, NEVER IN THE LAYOUT'S OWN CODE. `loadCategory` runs a COUNT over the whole
 * category (and the rentals facts three more); the layout may not await them (contract test), so this
 * block does, rendered by the page or by the layout as `LEDE_PLACEMENT` (lede-placement.ts, decision
 * H-c) says. Every read is the `cache()`-shared call that `generateMetadata` and the page body make,
 * so the lede, the description and the robots decision read one number per render.
 *
 * Measured lede — max-w-prose (65ch) keeps the reading measure inside the craft floor's 65–75ch band;
 * max-w-2xl ran ~80ch at text-base.
 * ⚠️ Rentals replaces CategoryLede with its own D-f wording; every other category passes its linked
 * tier, and CategoryLede closes on the report sentence only where the tier is 'none' (a linked tier
 * says where the listings open instead).
 */
export async function CategoryLedeBlock({ slug, placement }: {
  slug: string
  /**
   * ⛔ 'after-grid' — A GOODS CATEGORY'S LEDE, RIGHT UNDER ITS GRID (owner-approved 2026-11-14, cook r06 goods; lede-placement.ts
   * `ledePlacementFor`): the paragraph WHOLE — a plain server <p>, the same words and the same nesting ClampedLede draws, no
   * clamp and no "Show more" (it reverses there clamped-lede.tsx's "ONE LINE SINCE 2026-10-18": the clamp was the fold's budget,
   * and below the grid there is none). 24px under the grid on a phone in the small role, muted (14/20 — it closes the listings,
   * it does not lead them); from sm the lede's own look, 40px under the grid's end.
   */
  placement?: 'after-grid'
}) {
  const loaded = await loadCategory(slug)
  // The layouts above have already answered 404 for an unknown slug; nothing to say here either way.
  if (!loaded) return null
  // Started before the reads below so the one extra GROUP BY (C1-LEDE) runs beside them instead of
  // after them: this block sits above the loading boundary, so it holds the shell (lede-placement.ts).
  // `[]` for rentals and jobs, whose ledes say something else (rentals with no place live gets the
  // generic lede's count sentence alone), and for an empty category.
  const topSubcategories = loadTopSubcategories(loaded.cat.id, loaded.cat.slug, loaded.live)
  // A failure still throws where it is awaited below (the render fails and ISR keeps the last good
  // page, as for every read here); this only stops it being reported as unhandled if a read below
  // throws first and the await is never reached.
  topSubcategories.catch(() => {})
  const { cat, live: total } = loaded
  const rentals = cat.slug === 'rentals' && total > 0 ? await loadRentalsFacts(cat.id, total) : null
  // Also for rentals with no place live (facts null): the generic lede then speaks, and its trust
  // claim must know the vehicle hire is all linked.
  const linkedCount = !rentals && total > 0 ? await loadLinkedCount(cat.id) : 0
  // `data-category-lede` is how H2's crawler spec finds the lede, wherever it renders (ClampedLede's <p>, or the goods one below).
  if (placement === 'after-grid') {
    return (
      <div className="mt-6 sm:mt-10">
        <p data-category-lede="" className="max-w-prose text-base leading-relaxed text-body max-sm:text-sm max-sm:leading-5 max-sm:text-muted-foreground">
          {rentals ? (
            <RentalsLede total={rentals.total} allHcmc={rentals.allHcmc} kinds={rentals.kinds} linked={rentals.linked} vehicles={rentals.vehicles} homes={rentals.homes} homesLinked={rentals.homesLinked} />
          ) : (
            <CategoryLede name={cat.name} nameVi={cat.nameVi} slug={cat.slug} linked={linkedTier(linkedCount, total)} total={total} top={await topSubcategories} />
          )}
        </p>
      </div>
    )
  }
  return (
    <>
      <div className="mt-8 sm:mt-10">
      <ClampedLede className="max-w-prose text-base leading-relaxed text-body">
        {rentals ? (
          <RentalsLede total={rentals.total} allHcmc={rentals.allHcmc} kinds={rentals.kinds} linked={rentals.linked} vehicles={rentals.vehicles} homes={rentals.homes} homesLinked={rentals.homesLinked} />
        ) : (
          <>
            {/* ⚠️ THE COUNT OPENS THE LEDE NOW, GROUPED (C1-LEDE, L-NUMBERS): it trailed the provenance
                sentence as a raw "63730 listings available." — no separator, and the first thing a
                reader met was where the stock came from rather than what it is. */}
            <CategoryLede name={cat.name} nameVi={cat.nameVi} slug={cat.slug} linked={linkedTier(linkedCount, total)} total={total} top={await topSubcategories} />
          </>
        )}
      </ClampedLede>
      </div>
    </>
  )
}

/**
 * The lines that must stay above the grid: the rental availability check and the schools' cover-lesson door. The lede's paragraph
 * itself renders after the grid (see the layout), and these used to follow it.
 */
export function CategoryLedeLinks({ slug, className }: {
  slug: string
  /** The rentals line's own box, merged last — /c/rentals' phone copy under the control row passes `min-h-6` (build 7). */
  className?: string
}) {
  const cat = { slug }
  return (
    <>
      {/* The availability check is invisible until something says it exists — rentals only.
          ⛔ ONE LINE ON A PHONE, WITH ITS LINK (owner, 2026-10-18: products first on a phone's first screen). The
          promise wrapped to four lines at 390px; below sm it now truncates to one, and "Check availability" beside it
          opens /rentals/check, whose empty list says the rest (how to pick, up to 5, free). The whole sentence stays
          in the HTML, and from sm it reads in full with the same link at its end (RentalCheckHint, 2026-11-07 audit).
          ⛔ ON /c/rentals' PHONE IT SITS UNDER THE CONTROL ROW, NOT UNDER THE HEADING (owner-approved 2026-11-15 (build 7), cook
          r07 rentals — it reverses, there, the batch 93 placement "under the heading line"): the page's name stands alone at
          the display size and this line is the list's own header, 12px under the row's hairline, 24px tall (`min-h-6`), 16px
          over the first card ((index)/page.tsx hands it to SellerListings `phoneOneRow.listHead`). Still one line with its
          link, the same words. With no row (0–1 results) it stays under the heading; from sm, and on a district page, as before. */}
      {cat.slug === 'rentals' && (
        <div className={cn('mt-2 flex max-w-prose items-center gap-2 max-sm:mt-1', className)}>
          <RentalCheckHint className="min-w-0 flex-1 max-sm:items-center max-sm:[&>span]:min-w-0 max-sm:[&>span]:truncate" />
          {/* ⛔ `relative tap-44`, A 44px TARGET (owner-approved 2026-11-14, cook r06 rentals-a — it reverses "`-my-1 py-1`, not
              `tap-44`: 'Show more' sits 10px above"): the lede and its "Show more" left the space above this line with H1b (it
              renders after the grid now), so on a phone the line sits under the page's heading line, which holds nothing to tap,
              and the strip's chips start 24px below it. The label role (14/20 bold) in the one accent. A flex sibling of the
              hint, not a link inside its sentence, so it carries no underline at rest.
              Under the control row (build 7, above) the hit area still clears the chips': their 44px ends 4px under each 36px chip,
              inside the row's 8px padding, and this one starts 2px under the row's hairline (the 12px gap, less the extender's
              10px above the 24px line). */}
          <Link href={RENTAL_CHECK_PATH} prefetch={false} className="relative tap-44 shrink-0 text-sm font-bold text-accent-foreground hover:underline sm:hidden">
            <Bilingual en="Check availability" vi="Kiểm tra phòng trống" />
          </Link>
        </div>
      )}
      {/* Cover lessons: the schools' door, outside the clamped lede so a phone shows it (category-lede.tsx). One line, 8px under
          the H1, the question muted (owner-approved 2026-11-14, cook r04 teachers: the teaching lines' shape). */}
      {cat.slug === 'teachers' && <TeacherCoverLink className="mt-2 text-sm text-muted-foreground" />}
    </>
  )
}
