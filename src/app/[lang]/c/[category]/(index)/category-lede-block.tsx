import { CategoryLede } from '@/components/marketplace/category-lede'
import { RentalCheckHint } from '@/components/marketplace/rental-check-toggle'
import { Tr } from '@/context/language-context'
import { loadCategory } from '../load-category'
import { loadLinkedCount, loadRentalsFacts } from '../category-data'
import { linkedTier } from '../category-copy'
import { RentIndexLink, RentalsLede } from '../category-text'

/**
 * The category page's lede: one measured paragraph, plus, on /c/rentals, the availability-check hint
 * and the rent-index link.
 *
 * ⛔ THE COUNTS LIVE HERE, NEVER IN THE LAYOUT'S OWN CODE. `loadCategory` runs a COUNT over the whole
 * category (and the rentals facts three more); the layout may not await them (contract test), so this
 * block does, rendered by the page or by the layout as `LEDE_PLACEMENT` (lede-placement.ts, decision
 * H-c) says. Every read is the `cache()`-shared call that `generateMetadata` and the page body make,
 * so the lede, the description and the robots decision read one number per render.
 *
 * Measured lede — max-w-prose (65ch) keeps the reading measure inside the craft floor's 65–75ch band;
 * max-w-2xl ran ~80ch at text-base.
 * ⚠️ Rentals replaces CategoryLede, whose "every listing comes from a seller with a public trust score"
 * is not true of stock linked from other portals; every other category passes its linked tier, and
 * CategoryLede keeps that sentence only where the tier is 'none'.
 */
export async function CategoryLedeBlock({ slug }: { slug: string }) {
  const loaded = await loadCategory(slug)
  // The layouts above have already answered 404 for an unknown slug; nothing to say here either way.
  if (!loaded) return null
  const { cat, live: total } = loaded
  const rentals = cat.slug === 'rentals' && total > 0 ? await loadRentalsFacts(cat.id, total) : null
  // Also for rentals with no place live (facts null): the generic lede then speaks, and its trust
  // claim must know the vehicle hire is all linked.
  const linkedCount = !rentals && total > 0 ? await loadLinkedCount(cat.id) : 0
  // `data-category-lede` is how H2's crawler spec finds the lede, wherever it renders.
  return (
    <>
      <p data-category-lede="" className="mt-3 max-w-prose text-base leading-relaxed text-body">
        {rentals ? (
          <RentalsLede total={rentals.total} allHcmc={rentals.allHcmc} kinds={rentals.kinds} linked={rentals.linked} vehicles={rentals.vehicles} />
        ) : (
          <>
            <CategoryLede name={cat.name} nameVi={cat.nameVi} slug={cat.slug} linked={linkedTier(linkedCount, total)} />
            {/* "0 listings available." read broken on empty categories — only count when there ARE listings. */}
            {total > 0 && <> {total} {total === 1 ? <Tr text="listing" /> : <Tr text="listings" />} <Tr text="available." /></>}
          </>
        )}
      </p>
      {/* The availability check is invisible until something says it exists — one line, rentals only. */}
      {cat.slug === 'rentals' && <RentalCheckHint className="mt-2 max-w-prose" />}
      {cat.slug === 'rentals' && <RentIndexLink />}
    </>
  )
}
