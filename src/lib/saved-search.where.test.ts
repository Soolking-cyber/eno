import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ SAVED-SEARCH ALERTS MUST FIRE FOR THE LISTINGS THE SEARCH SHOWED. The alert cron kept its own
 * copy of the district filter, which knew only the curated keys: a search saved from a
 * /c/<category>/<district> page (`district=quan-7`) resolved to NO filter and alerted on the whole
 * category, and a query "căn hộ quận 7" was matched as the literal phrase while the feed now reads
 * the district out of it.
 */

const h = vi.hoisted(() => ({
  rows: [] as { district: string | null }[],
  /** The existence probe behind the plain-words safety net. Default: the district reading has rows. */
  firstRow: (_where: unknown): { id: string } | null => ({ id: 'x' }),
}))
vi.mock('@/lib/db', () => ({
  db: { listing: { groupBy: vi.fn(async () => h.rows), findFirst: vi.fn(async (a: { where: unknown }) => h.firstRow(a.where)) } },
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: any) => w }))

import { describeParams } from './saved-search'
import { buildListingWhere } from './saved-search-where'
import { districtScopeForSlug, resetDistrictNameCache } from './district-slug'

beforeEach(() => {
  resetDistrictNameCache()
  h.rows = [{ district: 'Quận 7' }, { district: 'Quận 1' }]
  h.firstRow = () => ({ id: 'x' })
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

  it('under an explicit district a product title keeps its words, as on the feed', async () => {
    const w: any = await buildListingWhere({ district: 'd1', q: 'Hồi ức Phú Nhuận' })
    expect(w.AND).toContainEqual(await districtScopeForSlug('d1'))
    expect(w.AND).toContainEqual({ searchText: { contains: 'hoi uc phu nhuan' } })
  })

  it('an explicit district wins, and the typed district is not left behind as text (as on the feed)', async () => {
    const w: any = await buildListingWhere({ district: 'd1', q: 'căn hộ quận 7' })
    expect(w.AND).toContainEqual(await districtScopeForSlug('d1'))
    expect(w.AND).not.toContainEqual(await districtScopeForSlug('d7'))
    expect(w.AND).toContainEqual({ searchText: { contains: 'can ho' } })
    expect(JSON.stringify(w)).not.toContain('quan 7')
  })

  /**
   * ⛔ THE FEED'S SAFETY NET, FOR THE ALERT TOO. A saved "Hồi ức Phú Nhuận" (a book) showed the plain
   * words on the feed, because the Phú Nhuận reading found nothing; an alert watching Phú Nhuận would
   * never fire for the book the search showed.
   */
  it('watches the plain words when the district reading matches no live listing and they match some', async () => {
    h.firstRow = (w) => (JSON.stringify(w).includes('Phu Nhuan') ? null : { id: 'book' })
    const w: any = await buildListingWhere({ q: 'Hồi ức Phú Nhuận' })
    expect(w.AND).toContainEqual({ searchText: { contains: 'hoi uc phu nhuan' } })
    expect(w.AND).not.toContainEqual(await districtScopeForSlug('phu-nhuan'))
  })

  it('decides without the price band, as the feed does', async () => {
    const probes: string[] = []
    h.firstRow = (w) => { probes.push(JSON.stringify(w)); return { id: 'x' } }
    const w: any = await buildListingWhere({ q: 'Hồi ức Phú Nhuận', priceMin: 1000, priceMax: 2000 })
    expect(probes).toHaveLength(1)
    expect(probes[0]).not.toContain('"price"')
    expect(JSON.stringify(w)).toContain('"price"') // the alert itself keeps the band
  })

  it('keeps the district reading when the plain words match nothing live either', async () => {
    h.firstRow = () => null
    const w: any = await buildListingWhere({ q: 'Hồi ức Phú Nhuận' })
    expect(w.AND).toContainEqual(await districtScopeForSlug('phu-nhuan'))
  })

  it('a failed probe keeps the district reading — an alert must not error over its safety net', async () => {
    h.firstRow = () => { throw new Error('timeout') }
    const w: any = await buildListingWhere({ q: 'Hồi ức Phú Nhuận' })
    expect(w.AND).toContainEqual(await districtScopeForSlug('phu-nhuan'))
  })

  it('keeps the district reading when it has live matches', async () => {
    const w: any = await buildListingWhere({ q: 'Hồi ức Phú Nhuận' })
    expect(w.AND).toContainEqual(await districtScopeForSlug('phu-nhuan'))
  })

  it('keeps a housing search on its district even with no live match — the zero is honest', async () => {
    h.firstRow = (w) => (JSON.stringify(w).includes('Phu Nhuan') ? null : { id: 'elsewhere' })
    const w: any = await buildListingWhere({ category: 'rentals', q: 'phòng trọ Phú Nhuận' })
    expect(w.AND).toContainEqual(await districtScopeForSlug('phu-nhuan'))
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
