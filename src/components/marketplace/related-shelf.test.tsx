import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/**
 * "More in <category>" under a sparse search (UI climb 2026-11-09, hunt #9): the title names the category in the reader's
 * language — and a machine translation that lost the `{category}` slot falls back to the English template, never a title
 * with no name (same-seller-shelf.tsx's rule) — one card per listing, and nothing under the rails' floor of three.
 */
let LANG = 'en'
const MT: Record<string, Record<string, string>> = { ko: { 'More in {category}': '다른 항목' } } // lost the slot
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: LANG, tr: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : MT[LANG]?.[en] ?? en) }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('./listing-card', () => ({ ListingCard: ({ listing, look }: { listing: { id: string }; look?: string }) => <i data-card={listing.id} data-look={look} /> }))
vi.mock('./for-you-rail', () => ({ locateFromRail: () => {} }))
vi.mock('./shelf', () => ({
  RAIL_CARD_W: '',
  MIN_RAIL_ITEMS: 3,
  Shelf: ({ title, children, phoneGrid }: { title: string; children: React.ReactNode; phoneGrid?: string }) => <section data-phone-grid={phoneGrid}><h2>{title}</h2>{children}</section>,
}))

import { RelatedShelf } from './related-shelf'

const rail = (n: number, name = 'Rentals') =>
  ({ slug: 'rentals', name, nameVi: 'Cho thuê', subcategory: 'motorbike-rental', subName: 'Motorbike', subNameVi: 'Xe máy', listings: Array.from({ length: n }, (_, i) => ({ id: `r${i}`, sellerId: 's' })) }) as never
const html = (r: unknown, lang = 'en') => {
  LANG = lang
  const out = renderToString(<RelatedShelf related={r as never} />)
  LANG = 'en'
  return out
}
const title = (r: unknown, lang?: string) => html(r, lang).match(/<h2>(.*?)<\/h2>/)?.[1]?.replace(/<!-- -->/g, '') ?? null

describe('RelatedShelf', () => {
  it('names the category and the subcategory beside it, in the reader\'s language', () => {
    expect(title(rail(3))).toBe('More in Rentals · Motorbike')
    expect(title(rail(3), 'vi')).toBe('Tin khác trong mục Cho thuê · Xe máy')
  })
  it('a rail of the whole category (no subcategory, 2026-11-12) names the category alone', () => {
    const whole = { ...(rail(3, 'Electronics') as object), nameVi: 'Điện tử', subcategory: null, subName: null, subNameVi: null }
    expect(title(whole)).toBe('More in Electronics')
    expect(title(whole, 'vi')).toBe('Tin khác trong mục Điện tử')
  })
  it('a translation that lost the slot keeps the English template, with the names', () => {
    expect(title(rail(3), 'ko')).toBe('More in Rentals · Motorbike')
  })
  it('a "$" in a name prints as typed', () => {
    expect(title(rail(3, 'A $& B'))).toBe('More in A $&amp; B · Motorbike')
  })
  it('one card per listing; under three, nothing', () => {
    expect(html(rail(4)).match(/data-card=/g)).toHaveLength(4)
    expect(html(rail(2))).toBe('')
  })
})

/**
 * ⛔ UNDER THE GOODS SEARCH ON A PHONE (owner-approved 2026-11-14, cook r06 goods; listings-explorer.tsx `goodsLook`): "More in …"
 * continues the results as the same two-column grid (Shelf `phoneGrid="goods"`) of goods cards (ListingCard `look`).
 */
describe('RelatedShelf look="goods"', () => {
  it('asks the shelf for the goods phone grid and every card for the goods look; without it, neither', () => {
    const goods = renderToString(<RelatedShelf related={rail(4) as never} look="goods" />)
    expect(goods).toContain('data-phone-grid="goods"')
    expect(goods.match(/data-look="goods"/g)).toHaveLength(4)
    const plain = renderToString(<RelatedShelf related={rail(4) as never} />)
    expect(plain).not.toContain('data-phone-grid')
    expect(plain).not.toContain('data-look')
  })
})
