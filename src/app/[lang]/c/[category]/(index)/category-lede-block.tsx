import { CategoryLede, TeacherCoverLink } from '@/components/marketplace/category-lede'
import { loadCategory } from '../load-category'
import { loadLinkedCount, loadRentalsFacts, loadTopSubcategories } from '../category-data'
import { linkedTier } from '../category-copy'
import { RentalsLede } from '../category-text'
import { ClampedLede } from '../clamped-lede'
import { GridDealsNote, GridLedeTail } from '@/components/marketplace/grid-about'

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
  // ⛔ The lede's closing sentence and the deals note under it (owner, 2026-11-26: "Add below the cards" — grid-about.tsx): each long
  // enough to count as a paragraph for Seobility. Not on /c/teachers (profiles, not listings) and not on an empty category.
  const about = cat.slug !== 'teachers' && total > 0
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
          {about && <>{' '}<GridLedeTail /></>}
        </p>
        {about && <GridDealsNote className="mt-3 max-w-prose text-sm leading-relaxed text-body max-sm:text-muted-foreground" />}
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
        {about && <>{' '}<GridLedeTail /></>}
      </ClampedLede>
      {about && <GridDealsNote className="mt-3 max-w-prose text-sm leading-relaxed text-body" />}
      </div>
    </>
  )
}

/**
 * The line that must stay above the grid: the schools' cover-lesson door. The lede's paragraph itself renders after the grid (see
 * the layout), and this used to follow it. (The rentals' free availability-check line lived here too until the feature was
 * removed, owner 2026-11-25.)
 */
export function CategoryLedeLinks({ slug }: { slug: string }) {
  // Cover lessons: the schools' door, outside the clamped lede so a phone shows it (category-lede.tsx). One line, 8px under the
  // H1, the question muted (owner-approved 2026-11-14, cook r04 teachers: the teaching lines' shape).
  return slug === 'teachers' ? <TeacherCoverLink className="mt-2 text-sm text-muted-foreground" /> : null
}
