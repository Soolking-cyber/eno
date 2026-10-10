import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NAV_CATEGORIES } from './taxonomy-nav'
import { CATEGORY_LEAD } from './category-lead'

/**
 * ⛔ THE LEAD ORDER IS AN OWNER DECISION AND NOTHING ELSE ENFORCES IT.
 * Owner, 2026-09-21: "reorganize categories according to importance the top 4 rest old order. 1 rentals
 * 2 jobs 3 services 4 electronics", then "swap electronics to moving sales".
 * Owner, 2026-10-10: "put find a teacher to number 4 everywhere so rentals jobs services and then electronics".
 *
 * ⚠️ THE 09-21 PIN WAS THE HOME RAIL'S ALONE, and this file used to guard that the footer was NOT reordered.
 * "Everywhere" reverses that: the rail, the footer, the /c "Other categories" chips and the "Browse by
 * category" shelves all read src/lib/category-lead.ts now. The rail is ranked from the DATABASE by live
 * demand, so without the pin it reorders itself as listings accrue — on production 2026-10-10 it put
 * teachers tenth of eleven.
 */
const EXPECTED = ['rentals', 'jobs', 'services', 'teachers', 'electronics', 'moving-sale'] as const

/**
 * Production-shaped rows (2026-10-10): demand follows supply, so unpinned the rail would open on electronics,
 * furniture, rentals — and teachers, with two profiles, would sit near the end. moving-sale has nothing live.
 * ⚠️ DATA SAFETY — `./db` is stubbed; nothing here can reach Postgres.
 */
const ROWS: Array<[slug: string, name: string, live: number, demand: number]> = [
  ['electronics', 'Electronics', 63_932, 90_000],
  ['furniture-appliances', 'Home', 6_308, 20_000],
  ['rentals', 'Rentals', 25_502, 15_000],
  ['fashion-beauty', 'Fashion', 1_184, 3_000],
  ['sports', 'Sports', 5_591, 2_500],
  ['services', 'Services', 447, 2_000],
  ['tickets-travel', 'Travel', 300, 1_500],
  ['jobs', 'Jobs', 40, 500],
  ['teachers', 'Teachers', 2, 10],
  ['moving-sale', 'Moving Sale', 0, 0],
]

vi.mock('server-only', () => ({}))
vi.mock('@/lib/edition-scope', () => ({
  DeskResolutionError: class DeskResolutionError extends Error {},
  marketplaceListingScope: async () => ({}),
}))
vi.mock('./db', () => ({
  db: {
    category: {
      findMany: vi.fn(async () =>
        ROWS.map(([slug, name, live]) => ({ id: `id-${slug}`, name, nameVi: name, slug, icon: null, color: null, description: null, _count: { listings: live } })),
      ),
    },
    listing: {
      groupBy: vi.fn(async () =>
        ROWS.filter(([, , live]) => live > 0).map(([slug, , , demand]) => ({ categoryId: `id-${slug}`, _sum: { views: demand, contactCount: 0, savedCount: 0 } })),
      ),
    },
  },
}))

/**
 * ⚠️ RESOLVED FROM THIS FILE, NOT FROM `process.cwd()`. `readFileSync('src/lib/…')` throws ENOENT the moment
 * vitest runs from anywhere but the repo root — a workspace invocation, `--dir`, a future `test.root`.
 */
function source(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

beforeEach(() => vi.resetModules())

describe('category order', () => {
  /** The decision itself — the whole instruction, in one constant. */
  it('leads with rentals, jobs, services, teachers, electronics — and keeps moving-sale sixth', () => {
    expect([...CATEGORY_LEAD], 'owner 2026-10-10: Find a teacher fourth, then electronics').toEqual([...EXPECTED])
  })

  /**
   * ⛔ A TYPO'D SLUG FAILS SILENTLY AND EVERY OTHER TEST STILL PASSES. The sort skips a slug that matches
   * nothing, so `teacher` or `moving-sales` would pin one fewer tile and leave the suite green.
   * ⚠️ NAV_CATEGORIES is the projection of TAXONOMY, so it IS the list of real category slugs.
   */
  it('pins only slugs that are real categories', () => {
    const real = new Set(NAV_CATEGORIES.map((c) => c.slug))
    for (const slug of CATEGORY_LEAD) {
      expect(real.has(slug), `"${slug}" is not a category slug — the pin would silently do nothing`).toBe(true)
    }
  })

  it('the home rail opens rentals, jobs, services, Find a teacher, electronics — then live demand', async () => {
    const { getCategoriesByDemand } = await import('./categories')
    const rail = (await getCategoriesByDemand()).map((c) => c.slug)
    expect(rail).toEqual([...EXPECTED, 'furniture-appliances', 'fashion-beauty', 'sports', 'tickets-travel'])
  })

  /** What the rail DRAWS: the offer rule drops the empty moving-sale, so the visible fourth is still teachers. */
  it('the drawn rail keeps teachers fourth when moving-sale is empty', async () => {
    const { getCategoriesByDemand } = await import('./categories')
    const { offeredCategories } = await import('@/components/marketplace/count-chip')
    const drawn = offeredCategories(await getCategoriesByDemand(), undefined, 'all').map((c) => c.slug)
    expect(drawn.slice(0, 6)).toEqual(['rentals', 'jobs', 'services', 'teachers', 'electronics', 'furniture-appliances'])
  })

  /**
   * ⚠️ THE PIN MUST SIT IN FRONT OF THE DEMAND SORT, NOT REPLACE IT. If someone "simplifies" this to a plain
   * static order, the rail stops responding to demand at all and everything after the lead freezes — which
   * is not what was asked for and would not be visible for months.
   */
  it('keeps the demand ranking for everything below the pin', () => {
    const src = source('./categories.ts')
    expect(src).toMatch(/const PINNED_SLUGS[^=\n]*= CATEGORY_LEAD\b/)
    expect(src).toContain('b.demand - a.demand')
    expect(src).toContain('b.verifiedCount - a.verifiedCount')
  })

  /**
   * ⛔ "EVERYWHERE" IS EVERY LIST READING THE LEAD. Before 2026-10-10 each had its own order — the footer
   * TAXONOMY's, the /c chips the alphabet's, the shelves pure demand — so the rail's pin changed the rail and
   * nothing else. The footer and the shelves are also checked by render/route tests (footer.test.tsx,
   * api/category-rails/route.test.ts); the /c page is a server component with a database, so its line is
   * held here.
   */
  it('the footer, the /c "Other categories" chips, the shelves and the "Or browse" chips follow the lead', () => {
    expect(source('../components/marketplace/footer.tsx')).toContain('leadFirst(NAV_CATEGORIES')
    expect(source('../app/[lang]/c/[category]/(index)/page.tsx')).toContain('leadFirst(otherCatRows)')
    expect(source('../app/api/category-rails/route.ts')).toContain('categoryLeadRank(')
    // The zero-results "Or browse" chips are the rail's head, offered by the rail's rule (count-chip.test.tsx).
    expect(source('../components/marketplace/listings-explorer.tsx')).toContain('browseInsteadCategories(categories, activeCategory)')
  })

  /**
   * ⛔ TAXONOMY ITSELF IS NOT REORDERED (category-lead.ts says why: its order is the AI classifier's prompt
   * order, where vehicles sits ahead of rentals' motorbike and car hire). Lists sort at render instead, so
   * the projection still opens on vehicles.
   */
  it('does not reorder TAXONOMY — lists sort by the lead instead', () => {
    expect(NAV_CATEGORIES[0].slug).toBe('vehicles')
  })
})
