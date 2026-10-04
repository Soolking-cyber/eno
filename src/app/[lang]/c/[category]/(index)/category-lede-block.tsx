import { CategoryLede } from '@/components/marketplace/category-lede'
import { RentalCheckHint } from '@/components/marketplace/rental-check-toggle'
import { loadCategory } from '../load-category'
import { loadLinkedCount, loadRentalsFacts, loadTopSubcategories } from '../category-data'
import { linkedTier } from '../category-copy'
import { RentalsLede } from '../category-text'
import { ClampedLede } from '../clamped-lede'

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
export async function CategoryLedeBlock({ slug }: { slug: string }) {
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
  // `data-category-lede` is how H2's crawler spec finds the lede, wherever it renders (ClampedLede's <p>).
  return (
    <>
      <ClampedLede className="mt-3 max-w-prose text-base leading-relaxed text-body">
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
      {/* The availability check is invisible until something says it exists — one line, rentals only. */}
      {cat.slug === 'rentals' && <RentalCheckHint className="mt-2 max-w-prose" />}
    </>
  )
}
