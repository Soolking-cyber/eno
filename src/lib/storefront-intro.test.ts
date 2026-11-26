import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/edition', async (o) => ({ ...(await o<typeof import('@/lib/edition')>()), SITE_NAME: 'eno.vn' }))
const { storefrontIntro } = await import('./storefront-intro')

/**
 * The shop's one-line intro (owner 2026-11-25, "resolve my decisions with recommended": an intro on card-grid pages). Seobility
 * crawl 9: shop pages had no paragraph and their name only in the H1. Only the grid's own facts.
 */
const cat = (name: string, nameVi: string) => ({ category: { name, nameVi } })

describe('storefrontIntro', () => {
  it('names the shop, its live count (grouped per language) and its two most common categories', () => {
    const rows = [cat('Rentals', 'Cho thuê'), cat('Rentals', 'Cho thuê'), cat('Services', 'Dịch vụ'), cat('Vehicles', 'Xe cộ'), cat('Services', 'Dịch vụ'), cat('Rentals', 'Cho thuê')]
    const i = storefrontIntro('Saigon Cribs', 1540, rows)!
    expect(i).toMatchObject({ one: false, withCats: true })
    // One placeholder set, each language's own values (a pair whose placeholders differ falls back to the English).
    expect(i.values).toEqual({ name: 'Saigon Cribs', site: 'eno.vn', n: '1,540', cats: 'Rentals and Services' })
    expect(i.valuesVi).toEqual({ name: 'Saigon Cribs', site: 'eno.vn', n: '1.540', cats: 'Cho thuê và Dịch vụ' })
  })
  it('one listing reads singular; no category rows, no category clause; nothing to say, nothing at all', () => {
    expect(storefrontIntro('Ana', 1, [cat('Furniture', 'Nội thất')])).toMatchObject({ one: true, withCats: true })
    expect(storefrontIntro('Ana', 3, [])).toMatchObject({ one: false, withCats: false })
    expect(storefrontIntro('Ana', 0, [cat('Furniture', 'Nội thất')])).toBeNull()
    expect(storefrontIntro('  ', 4, [])).toBeNull()
  })
})
