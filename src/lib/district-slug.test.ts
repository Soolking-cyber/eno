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

import { allDistrictNames, districtNamesForSlug, resetDistrictNameCache } from './district-slug'

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
