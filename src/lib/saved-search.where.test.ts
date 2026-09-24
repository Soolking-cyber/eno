import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ SAVED-SEARCH ALERTS MUST FIRE FOR THE LISTINGS THE SEARCH SHOWED. The alert cron kept its own
 * copy of the district filter, which knew only the curated keys: a search saved from a
 * /c/<category>/<district> page (`district=quan-7`) resolved to NO filter and alerted on the whole
 * category, and a query "căn hộ quận 7" was matched as the literal phrase while the feed now reads
 * the district out of it.
 */

const h = vi.hoisted(() => ({ rows: [] as { district: string | null }[] }))
vi.mock('@/lib/db', () => ({ db: { listing: { groupBy: vi.fn(async () => h.rows) } } }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: any) => w }))

import { describeParams } from './saved-search'
import { buildListingWhere } from './saved-search-where'
import { districtScopeForSlug, resetDistrictNameCache } from './district-slug'

beforeEach(() => {
  resetDistrictNameCache()
  h.rows = [{ district: 'Quận 7' }, { district: 'Quận 1' }]
})

describe('buildListingWhere — the feed’s district scope', () => {
  it('a landing-page slug scopes to that district instead of the whole category', async () => {
    const w: any = await buildListingWhere({ category: 'rentals', district: 'quan-7' })
    expect(w.AND).toContainEqual({ district: { in: ['Quận 7'] } })
  })

  it('a curated key uses the same (number-bounded) scope as the feed', async () => {
    const w: any = await buildListingWhere({ district: 'd1' })
    expect(w.AND).toContainEqual(await districtScopeForSlug('d1'))
  })

  it('a district typed into the saved query is read the way the feed reads it', async () => {
    const w: any = await buildListingWhere({ category: 'rentals', q: 'căn hộ quận 7' })
    expect(w.AND).toContainEqual(await districtScopeForSlug('d7'))
    expect(w.AND).toContainEqual({ searchText: { contains: 'can ho' } })
    expect(w.AND).not.toContainEqual({ searchText: { contains: 'can ho quan 7' } })
  })

  it('an explicit district wins and the query stays text', async () => {
    const w: any = await buildListingWhere({ district: 'd1', q: 'quận 7' })
    expect(w.AND).toContainEqual(await districtScopeForSlug('d1'))
    expect(w.AND).toContainEqual({ searchText: { contains: 'quan 7' } })
  })

  it('a stored district of "all" is no district — the query still infers, as it does on the feed', async () => {
    const w: any = await buildListingWhere({ district: 'all', q: 'căn hộ quận 7' })
    expect(w.AND).toContainEqual(await districtScopeForSlug('d7'))
    expect(w.AND).toContainEqual({ searchText: { contains: 'can ho' } })
  })

  it('a saved shorthand is read as the feed reads it — text alone, district beside a place word', async () => {
    const bare: any = await buildListingWhere({ category: 'rentals', q: 'Q7' })
    expect(bare.AND).toContainEqual({ searchText: { contains: 'q7' } })
    const placed: any = await buildListingWhere({ q: 'căn hộ Q7' })
    expect(placed.AND).toContainEqual(await districtScopeForSlug('d7'))
  })

  it('names a landing-slug district in the saved search’s label, localized when its words name a curated district', () => {
    expect(describeParams({ category: 'rentals', district: 'quan-7' }, 'vi')).toContain('Quận 7 (Phú Mỹ Hưng)')
    expect(describeParams({ category: 'rentals', district: 'quan-binh-thanh' }, 'en')).toContain('Binh Thanh District')
    expect(describeParams({ category: 'electronics', district: 'cau-giay' })).toContain('Cau Giay')
  })
})
