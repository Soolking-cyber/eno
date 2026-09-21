import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { NAV_CATEGORIES } from './taxonomy-nav'

/**
 * ⛔ THE FIRST FOUR CATEGORY TILES ARE AN OWNER DECISION AND NOTHING ELSE ENFORCES THEM.
 * Owner, 2026-09-21: "reorganize categories according to importance the top 4 rest old order.
 * 1 rentals 2 jobs 3 services 4 electronics".
 *
 * ⚠️ ONLY THE HOME RAIL IS PINNED. It is ranked from the DATABASE by live demand, so it WILL
 * reorder itself as listings accrue — the pin is the only thing holding the first four in place,
 * and nothing else in the codebase encodes this decision. The footer is a separate, static list
 * (`NAV_CATEGORIES`) locked to TAXONOMY by its own test; see the first case below for why it is
 * deliberately left alone.
 */
const EXPECTED = ['rentals', 'jobs', 'services', 'moving-sale'] as const

/**
 * ⚠️ RESOLVED FROM THIS FILE, NOT FROM `process.cwd()`. `readFileSync('src/lib/categories.ts')`
 * throws ENOENT the moment vitest runs from anywhere but the repo root — a workspace invocation,
 * `--dir`, a future `test.root`. A reviewer flagged it; it is the same cwd assumption that would
 * have let the image-loader guard pass vacuously.
 */
function readCategoriesSource(): string {
  return readFileSync(fileURLToPath(new URL('./categories.ts', import.meta.url)), 'utf8')
}

describe('category order', () => {
  /**
   * ⛔ THE FOOTER IS DELIBERATELY *NOT* REORDERED, AND THAT IS NOT AN OVERSIGHT.
   * `NAV_CATEGORIES` is asserted by src/lib/taxonomy-nav.test.ts to be an exact in-order projection
   * of `TAXONOMY`, whose own test says: "do NOT edit the expectation: regenerate the constant from
   * TAXONOMY, which is the source of truth." Reordering the footer therefore means reordering the
   * canonical taxonomy — which also feeds the AI classifier prompt and the post wizard — for the
   * sake of a link list. The footer and the rail already disagreed before this change (footer led
   * with `vehicles`, the rail with `electronics`), so leaving it is the status quo, not a new
   * inconsistency. If the owner wants the footer to match, TAXONOMY is the file to edit.
   */
  it('does not silently reorder the footer, which mirrors TAXONOMY', () => {
    expect(NAV_CATEGORIES[0].slug).toBe('vehicles')
    expect(NAV_CATEGORIES.map((c) => c.slug)).toContain('rentals')
  })

  /** The decision itself: the four slugs, in the owner's order, at the head of the rail. */
  it('the home rail pins the owner-chosen four, in order', () => {
    const src = readCategoriesSource()
    const m = src.match(/const PINNED_SLUGS = \[([^\]]*)\]/)
    expect(m, 'PINNED_SLUGS must exist in src/lib/categories.ts').not.toBeNull()
    const pinned = [...m![1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1])
    expect(pinned, 'the rail head is the whole instruction — 1 rentals 2 jobs 3 services 4 electronics').toEqual([...EXPECTED])
  })

  /**
   * ⚠️ THE PIN MUST SIT IN FRONT OF THE DEMAND SORT, NOT REPLACE IT. If someone "simplifies" this
   * to a plain static order, the rail stops responding to demand at all and the remaining thirteen
   * freeze — which is not what was asked for and would not be visible for months.
   */
  /**
   * ⛔ A TYPO'D SLUG FAILS SILENTLY AND EVERY OTHER TEST STILL PASSES. The sort skips a slug that
   * matches nothing, so `moving-sales` or `moving` instead of `moving-sale` would pin only three
   * tiles, let demand fill the fourth, and leave the whole suite green. The owner wrote "moving
   * sales"; the real slug is `moving-sale`. A reviewer caught that the constant was only ever
   * checked against itself, never against reality.
   * ⚠️ NAV_CATEGORIES is the projection of TAXONOMY, so it IS the list of real category slugs.
   */
  it('pins only slugs that are real categories', () => {
    const real = new Set(NAV_CATEGORIES.map((c) => c.slug))
    for (const slug of EXPECTED) {
      expect(real.has(slug), `"${slug}" is not a category slug — the pin would silently do nothing`).toBe(true)
    }
  })

  it('keeps the demand ranking for everything below the pin', () => {
    const src = readCategoriesSource()
    expect(src).toContain('b.demand - a.demand')
    expect(src).toContain('b.verifiedCount - a.verifiedCount')
  })
})
