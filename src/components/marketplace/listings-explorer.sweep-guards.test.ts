import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { INTENT_SHORTCUTS, typesFor } from '@/lib/taxonomy'

/**
 * Three explorer fixes from the 2026-10-22 sweep, pinned at the source (listings-explorer.tsx is a landmine file and its
 * feed harness does not reach the home shelves or a storefront's discovery band):
 * - a category picked from a shelf BELOW the grid scrolls the results into view (desktop showed only the footer);
 * - the marketplace-wide discovery band never renders on a storefront (other sellers' listings read as the shop's);
 * - an intent tile the active category cannot hold browses that intent everywhere instead of answering 0.
 */
const src = readFileSync('src/components/marketplace/listings-explorer.tsx', 'utf8')

describe('listings-explorer sweep guards', () => {
  it('a shelf pick scrolls to #listings after the shelves unmount', () => {
    expect(src).toContain('<DeferredCategoryRails categories={categories} onCategory={handleRailCategorySelect}')
    expect(src).toMatch(/const handleRailCategorySelect = \(slug: string\) => \{\s*handleCategorySelect\(slug\)\s*requestAnimationFrame\(\(\) => document\.getElementById\('listings'\)\?\.scrollIntoView/)
  })

  it('the discovery band is gated off storefronts', () => {
    expect(src).toContain('{showDiscovery && !sellerId && (')
  })

  it('both intent rails tap through handleIntent, which leaves a category that cannot hold the intent', () => {
    expect(src.match(/onIntent=\{handleIntent\}/g)).toHaveLength(2)
    expect(src).toMatch(/if \(activeCategory !== 'all' && !\(typesFor\(activeCategory\) as string\[\]\)\.includes\(type\)\) applyCategory\('all'\)/)
  })

  it('the premise: Teachers holds none of the intent types (so every intent tap there leaves the category)', () => {
    const teacherTypes = typesFor('teachers') as string[]
    expect(INTENT_SHORTCUTS.filter((i) => teacherTypes.includes(i.type))).toEqual([])
  })
})
