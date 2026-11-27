import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PriceRow } from './lowest-prices'

/**
 * <PriceTable condition> — the copy, the heading and the browse link follow the table's condition (2026-11-26): a NEW table
 * names the shops its rows come from (only those), says the shop sells and how Buy now works, and carries its own commission
 * line; a USED table reads exactly as it did. Rendered in both languages through the real Bilingual.
 */
let LANG = 'en'
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: LANG, tr: (en: string, viText?: string) => (LANG === 'vi' && viText != null ? viText : en) }),
  useTr: (s: string) => s,
  Tr: ({ text }: { text: string }) => text,
}))
// The price cell's own formatting is price.tsx's business (and its tests'); here it only has to print the amount.
vi.mock('@/components/marketplace/price', () => ({ Price: ({ price }: { price: number }) => <span>{price}</span> }))

import { AffiliateNote, PriceTable, shopsOf } from './price-table'

afterEach(() => { LANG = 'en' })

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))

const row = (over: Partial<PriceRow>): PriceRow => ({
  model: 'iPhone 18 Pro', storage: '256GB', storageGb: 256, price: 37_990_000, currency: '₫', listingId: 'n1',
  seller: 'ShopDunk', offers: 3, ceiling: 38_999_000, condition: 'new', tracked: true, image: null, ...over,
})
const NEW_ROWS = [
  row({}),
  row({ storage: '512GB', storageGb: 512, price: 44_490_000, listingId: 'n2', seller: 'Hoàng Hà Mobile', offers: 1 }),
]
const USED_ROWS = [row({ price: 30_000_000, listingId: 'u1', seller: 'Minh Tuấn Mobile', condition: 'used', tracked: false, offers: 2 })]

const render = (el: React.ReactElement) => renderToString(el)

describe('PriceTable condition="new"', () => {
  it('heads the table with the shops that ACTUALLY appear in the rows, in the tie-break order', () => {
    const html = render(<PriceTable condition="new" rows={NEW_ROWS} known updated="26 November 2026" id="new-prices" />)
    expect(text(html)).toContain('New, from ShopDunk and Hoàng Hà Mobile')
    expect(text(html)).not.toContain('CellphoneS')
    expect(text(render(<PriceTable condition="new" rows={[NEW_ROWS[0]]} known updated="x" id="n" />))).toContain('New, from ShopDunk ')
    LANG = 'vi'
    expect(text(render(<PriceTable condition="new" rows={NEW_ROWS} known updated="x" id="n" />))).toContain('Máy mới, từ ShopDunk và Hoàng Hà Mobile')
  })

  it('says who sells and how to buy, links every price to its listing, names each row’s shop, and discloses the commission', () => {
    const html = render(<PriceTable condition="new" rows={NEW_ROWS} known updated="26 November 2026" id="new-prices" />)
    const t = text(html)
    expect(t).toContain("The shop sells the phone: message it here and you get a Buy now button that opens the shop's own page to order.")
    expect(t).not.toMatch(/second-hand/i)
    expect(hrefs(html)).toEqual(expect.arrayContaining(['/listings/n1', '/listings/n2']))
    expect(t).toContain('ShopDunk +2')
    expect(t).toContain('4 listings · 26 November 2026')
    expect(t).toContain("We may earn a commission when you buy through the shop's Buy now button, at no extra cost to you.")
    // ⛔ Not the used note: its tie-break sentence is false for a table whose ties go by the shop's rank.
    expect(t).not.toContain('the one with the tracked link is shown')
  })

  it('links no site-wide browse by default — `condition=new` would list strangers\' units under the three shops\' table', () => {
    const html = render(<PriceTable condition="new" rows={NEW_ROWS} known updated="x" id="n" />)
    expect(hrefs(html).some((h) => h.includes('condition='))).toBe(false)
  })

  it('browses NEW listings, not used ones, when asked to', () => {
    const html = render(<PriceTable condition="new" rows={NEW_ROWS} known updated="x" id="n" seeAll />)
    expect(hrefs(html)).toContain('/?category=electronics&subcategory=phones-tablets&brand=apple&condition=new&model=iPhone%2018%20Pro')
    expect(text(html)).toContain('See every new and like-new listing')
    expect(hrefs(html).some((h) => h.includes('condition=used'))).toBe(false)
  })

  it('zero rows → nothing at all; a failed read → its own could-not-read line, naming the new prices', () => {
    expect(render(<PriceTable condition="new" rows={[]} known updated="x" id="n" />)).toBe('')
    expect(text(render(<PriceTable condition="new" rows={[]} known={false} updated="x" id="n" />))).toBe('New prices from the shops could not be read just now — they are back on the next refresh.')
  })
})

describe('PriceTable condition="used" — as it was', () => {
  it('the caller’s heading, the second-hand copy and browse link, no commission line of its own', () => {
    const html = render(<PriceTable condition="used" rows={USED_ROWS} known updated="x" id="u" heading="Second-hand prices on this marketplace today" />)
    const t = text(html)
    expect(t).toContain('Second-hand prices on this marketplace today')
    expect(t).toContain("The lowest price among the second-hand phone shops' live listings here, for each storage tier.")
    expect(t).not.toContain('Buy now')
    expect(t).not.toContain('commission')
    expect(hrefs(html)).toContain('/?category=electronics&subcategory=phones-tablets&brand=apple&condition=used&model=iPhone%2018%20Pro')
    expect(text(render(<PriceTable condition="used" rows={[]} known={false} updated="x" id="u" heading="h" />))).toBe('Live prices could not be read just now — they are back on the next refresh.')
  })
})

describe('AffiliateNote', () => {
  it('the used note is unchanged; the new one is one line, both languages', () => {
    expect(text(render(<AffiliateNote />))).toContain('when two listings ask exactly the same, the one with the tracked link is shown.')
    LANG = 'vi'
    expect(text(render(<AffiliateNote condition="new" />))).toBe('Chúng tôi có thể nhận hoa hồng khi bạn mua qua nút Mua ngay của cửa hàng, bạn không phải trả thêm chi phí nào. Mức giá bạn thanh toán là giá của cửa hàng.')
  })
})

describe('shopsOf', () => {
  it('each shop once, the three in their rank, any other after them', () => {
    expect(shopsOf([row({ seller: 'Hoàng Hà Mobile' }), row({ seller: 'Zeta' }), row({ seller: 'CellphoneS' }), row({ seller: 'ShopDunk' }), row({ seller: 'CellphoneS' })]))
      .toEqual(['ShopDunk', 'CellphoneS', 'Hoàng Hà Mobile', 'Zeta'])
  })
})
