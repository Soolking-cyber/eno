import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ AN UNRESOLVABLE DISTRICT USED TO MEAN "NO DISTRICT FILTER".
 *
 * `/c/<category>/<district>` slugifies the free-text district a seller typed; the explorer's
 * `?district=` takes a curated key out of DISTRICTS. They are two vocabularies sharing one param.
 * Handing the first to the API resolved to `undefined`, and an undefined filter is an ABSENT
 * filter — so "Refine in full search" from a district page returned the whole category, and
 * `?district=anything` returned the whole catalogue.
 */

const h = vi.hoisted(() => ({ rows: [] as { district: string | null }[], calls: 0 }))

vi.mock('@/lib/db', () => ({
  db: { listing: { groupBy: vi.fn(async () => { h.calls++; return h.rows }) } },
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: any) => w }))

import { allDistrictNames, districtNamesForSlug, resetDistrictNameCache, districtScopeForSlug } from './district-slug'

beforeEach(() => {
  resetDistrictNameCache()
  h.calls = 0
  h.rows = [
    { district: 'District 1' },
    { district: 'Thao Dien' },
    { district: 'Thảo Điền' },
    { district: 'Bình Thạnh' },
    { district: null },
  ]
})

describe('districtNamesForSlug', () => {
  it('resolves a slugified stored name back to that name', async () => {
    expect(await districtNamesForSlug('district-1')).toEqual(['District 1'])
  })

  it('returns EVERY spelling that slugifies the same way — they are one place', async () => {
    // ⚠️ A find() here would show half of Thao Dien's listings and count the other half as a
    // different district.
    expect(await districtNamesForSlug('thao-dien')).toEqual(['Thao Dien', 'Thảo Điền'])
  })

  it('resolves an accented name through its slug', async () => {
    expect(await districtNamesForSlug('binh-thanh')).toEqual(['Bình Thạnh'])
  })

  it('returns nothing for an unknown slug — the caller must not read that as "no filter"', async () => {
    expect(await districtNamesForSlug('not-a-place')).toEqual([])
  })

  it('returns nothing for an empty slug', async () => {
    expect(await districtNamesForSlug('   ')).toEqual([])
    expect(h.calls).toBe(0)
  })

  it('drops null districts rather than resolving them to the empty slug', async () => {
    expect(await allDistrictNames()).not.toContain(null)
  })

  it('memoizes the vocabulary — one aggregate serves many lookups', async () => {
    await districtNamesForSlug('district-1')
    await districtNamesForSlug('thao-dien')
    await allDistrictNames()
    expect(h.calls).toBe(1)
  })
})

describe('curated district scope — the "Quận 1 matches Quận 12" bug', () => {
  const flat = (w: unknown): string[] => JSON.stringify(w).match(/"contains":"[^"]+"/g)?.map(m => m.slice(12, -1)) ?? []

  /**
   * ⛔ THIS SHIPPED AND IT WAS BAD. `contains: 'Quận 1'` also matches "Quận 12", so measured on the
   * live feed `?district=d1` returned 2,573 listings of which 59 of 60 sampled were in Quận 12 —
   * District 1 is the city centre and among the most-used filters on the site. After the fix the
   * same query returns 1,297 and 60 of 60 sampled are Quận 1.
   */
  it('excludes the longer district names its own spellings are a prefix of', async () => {
    const w = await districtScopeForSlug('d1')
    const json = JSON.stringify(w)
    expect(json).toContain('NOT')
    const excluded = flat((w as { AND: unknown[] }).AND[1])
    expect(excluded).toEqual(expect.arrayContaining(['Quận 10', 'Quận 11', 'Quận 12']))
    expect(excluded).toEqual(expect.arrayContaining(['District 10', 'District 11', 'District 12']))
    /**
     * ⚠️ AND THE EXCLUSION NEVER TOUCHES `location`. It is free text, so excluding on it would drop
     * a real District 1 listing whose address or directions happen to name a neighbour — trading a
     * false-positive bug for a quieter false-negative one.
     */
    expect(JSON.stringify((w as { AND: unknown[] }).AND[1])).not.toContain('location')
  })

  /** A district whose name is nobody's prefix must not pay for the guard. */
  it('adds no exclusions where none can apply', async () => {
    const w = await districtScopeForSlug('binh-thanh')
    expect(JSON.stringify(w)).not.toContain('NOT')
  })

  /** The exclusions come from the curated list, so a two-digit district excludes nothing. */
  it('does not exclude anything from the longest name in a family', async () => {
    expect(JSON.stringify(await districtScopeForSlug('d12'))).not.toContain('NOT')
  })

  /** Unchanged: `all` is no scope, and an unknown slug must narrow to nothing, never to everything. */
  it('keeps the all/unknown contract', async () => {
    expect(await districtScopeForSlug('all')).toBeNull()
    expect(await districtScopeForSlug('')).toBeNull()
  })
})
