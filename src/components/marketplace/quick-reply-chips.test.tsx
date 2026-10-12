import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

/**
 * QUICK REPLIES THAT KNOW WHERE THE CONVERSATION IS (inbox-13). Each chip is a reply to something; once
 * that something has been answered — or contradicts the listing — the chip goes:
 *   · "Giá cố định ạ" never on a listing that takes offers, nor while the buyer's offer is pending;
 *   · the buyer's "Còn hàng không?" once the buyer has written anything;
 *   · the seller's "Vẫn còn hàng nhé" once the seller has replied after the buyer's opener;
 *   · a fresh buyer thread gets the category openers — never the structured offer opener.
 */

let LANG = 'vi'
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: LANG, tr: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : en) }),
}))

import { QuickReplyChips, chipContext, teacherThreadChips } from './quick-reply-chips'
import type { OpenerListing } from '@/lib/openers'

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
type P = Partial<React.ComponentProps<typeof QuickReplyChips>>
const chips = (p: P) => text(renderToString(<QuickReplyChips isSeller={false} hasPendingBuyerOffer={false} onInsert={() => {}} {...p} />))

describe('chipContext — who has said what, in the viewer\'s frame', () => {
  it('nobody has written', () => {
    expect(chipContext([], false)).toEqual({ buyerHasSent: false, sellerRepliedAfterBuyer: false })
  })
  it('buyer viewer: my message is the buyer\'s', () => {
    expect(chipContext([{ mine: true }], false)).toEqual({ buyerHasSent: true, sellerRepliedAfterBuyer: false })
    expect(chipContext([{ mine: true }, { mine: false }], false)).toEqual({ buyerHasSent: true, sellerRepliedAfterBuyer: true })
  })
  it('seller viewer: THEIR message is the buyer\'s', () => {
    expect(chipContext([{ mine: false }], true)).toEqual({ buyerHasSent: true, sellerRepliedAfterBuyer: false })
    expect(chipContext([{ mine: false }, { mine: true }], true)).toEqual({ buyerHasSent: true, sellerRepliedAfterBuyer: true })
  })
  it('a seller message BEFORE the buyer\'s first does not count as a reply to it', () => {
    expect(chipContext([{ mine: true }, { mine: false }], true)).toEqual({ buyerHasSent: true, sellerRepliedAfterBuyer: false })
  })
})

describe('seller chips', () => {
  it('a fixed-price listing keeps "Giá cố định ạ"', () => {
    LANG = 'vi'
    expect(chips({ isSeller: true, negotiable: false })).toContain('Giá cố định ạ')
  })
  it('a listing that takes offers drops it', () => {
    expect(chips({ isSeller: true, negotiable: true })).not.toContain('Giá cố định')
  })
  it('a pending buyer offer drops it too (and offers "Để mình cân nhắc nhé")', () => {
    const out = chips({ isSeller: true, negotiable: false, hasPendingBuyerOffer: true })
    expect(out).not.toContain('Giá cố định')
    expect(out).toContain('Để mình cân nhắc nhé')
  })
  it('"Vẫn còn hàng nhé" goes once the seller has replied after the opener', () => {
    expect(chips({ isSeller: true })).toContain('Vẫn còn hàng nhé')
    expect(chips({ isSeller: true, sellerRepliedAfterBuyer: true })).not.toContain('Vẫn còn hàng')
    // The meet chip is never "answered" — it is how the seller proposes a place.
    expect(chips({ isSeller: true, sellerRepliedAfterBuyer: true })).toContain('Có thể gặp ở')
  })
})

/**
 * B6 — "Deal! Mark as sold?" is a reply to where the conversation IS: an agreed deal (the parent decides,
 * src/lib/thread-deal.ts). It opens the mark-sold sheet; it never marks anything itself. Seller only, never
 * on a job, never without a deal or without the sheet to open.
 */
describe('the seller\'s "Deal! Mark as sold?" chip (B6)', () => {
  it('first in the seller\'s row once the thread agreed a deal', () => {
    LANG = 'en'
    const out = chips({ isSeller: true, dealAgreed: true, onMarkSold: () => {} })
    expect(out.startsWith('Deal! Mark as sold?')).toBe(true)
    LANG = 'vi'
    expect(chips({ isSeller: true, dealAgreed: true, onMarkSold: () => {} })).toContain('Chốt đơn! Đánh dấu đã bán?')
  })
  it('no deal → no chip; no sheet to open → no chip', () => {
    LANG = 'en'
    expect(chips({ isSeller: true, dealAgreed: false, onMarkSold: () => {} })).not.toContain('Deal!')
    expect(chips({ isSeller: true, dealAgreed: true })).not.toContain('Deal!')
  })
  it('⛔ never to the buyer, never on a job', () => {
    LANG = 'en'
    expect(chips({ isSeller: false, dealAgreed: true, onMarkSold: () => {} })).not.toContain('Deal!')
    expect(chips({ isSeller: true, job: true, dealAgreed: true, onMarkSold: () => {} })).not.toContain('Deal!')
  })
})

describe('buyer chips', () => {
  const listing: OpenerListing = { categorySlug: 'electronics', subcategorySlug: null, listingType: 'sell', price: 5_000_000, currency: '₫', priceUnit: 'VND', negotiable: true }

  it('a buyer who has written gets nothing — not even an empty row', () => {
    expect(renderToString(<QuickReplyChips isSeller={false} hasPendingBuyerOffer={false} onInsert={() => {}} buyerHasSent />)).toBe('')
  })

  it('a fresh buyer thread: the availability chip plus the category openers', () => {
    LANG = 'vi'
    const out = chips({ openerListing: listing })
    expect(out).toContain('Còn hàng không?')
    // More than the single availability chip: the commitment + question openers rendered beside it.
    const count = (renderToString(<QuickReplyChips isSeller={false} hasPendingBuyerOffer={false} onInsert={() => {}} openerListing={listing} />).match(/<button/g) ?? []).length
    expect(count).toBe(3)
  })

  it('⛔ never the offer opener — a structured offer belongs to the strip\'s "Trả giá", not a chip', () => {
    LANG = 'en'
    const html = renderToString(<QuickReplyChips isSeller={false} hasPendingBuyerOffer={false} onInsert={() => {}} openerListing={listing} />)
    // The offer opener names a price; no chip may carry one.
    expect(text(html)).not.toMatch(/\d[.,]\d{3}/)
  })

  it('no openers without the listing facts (an older cached thread)', () => {
    const count = (renderToString(<QuickReplyChips isSeller={false} hasPendingBuyerOffer={false} onInsert={() => {}} />).match(/<button/g) ?? []).length
    expect(count).toBe(1)
  })
})

describe('a TEACHER thread — a school hiring a teacher (owner, 2026-10-12: "is it still available … is not fit to reach out to a teacher")', () => {
  const teacherListing: OpenerListing = { categorySlug: 'teachers', listingType: 'teacher', price: 0, currency: '₫', priceUnit: 'VND', negotiable: false }

  it('⛔ the school never gets "Is it still available?" — it gets the hiring openers', () => {
    LANG = 'en'
    const out = chips({ teacher: true, openerListing: teacherListing })
    expect(out).not.toMatch(/still available/i)
    expect(out).toContain('We are hiring')
    expect(out).toContain('Ask: start date and schedule')
  })

  it('once the school has written: the CV and call follow-ups — the CV ask gone once the teacher shared it', () => {
    LANG = 'en'
    expect(chips({ teacher: true, buyerHasSent: true })).toContain('Ask for their CV')
    expect(chips({ teacher: true, buyerHasSent: true })).toContain('Suggest a call')
    expect(chips({ teacher: true, buyerHasSent: true, teacherShared: true })).not.toContain('Ask for their CV')
  })

  it('⛔ the teacher answers a school — never "Yes, still available", "Price is firm" or "Deal! Mark as sold?"', () => {
    LANG = 'en'
    const out = chips({ isSeller: true, teacher: true, negotiable: false, dealAgreed: true, onMarkSold: () => {} })
    expect(out).toContain('Interested — tell me more')
    expect(out).toContain('Not available right now')
    expect(out).toContain('Ask: hours, place and pay')
    expect(out).not.toMatch(/still available|Price is firm|Mark as sold/i)
  })

  it('the teacher’s first answers go once they have replied; the asks stay', () => {
    LANG = 'en'
    const out = chips({ isSeller: true, teacher: true, sellerRepliedAfterBuyer: true })
    expect(out).not.toContain('Interested')
    expect(out).not.toContain('Not available')
    expect(out).toContain('Ask: hours, place and pay')
    expect(out).toContain('Can meet in')
  })

  it('in Vietnamese too', () => {
    LANG = 'vi'
    expect(chips({ teacher: true })).toContain('Chúng tôi đang tuyển')
    expect(chips({ isSeller: true, teacher: true })).toContain('Quan tâm — cho mình biết thêm')
  })
})

describe('teacherThreadChips — ⛔ only a chip that goes away once used sends on tap (Opus, gate review)', () => {
  const en = (e: string) => e
  const base = { isSeller: false, buyerHasSent: false, sellerRepliedAfterBuyer: false, teacherShared: false }
  const sends = (o: Partial<typeof base>) => teacherThreadChips({ ...base, ...o }, en).filter((c) => c.complete).map((c) => c.label)
  const fills = (o: Partial<typeof base>) => teacherThreadChips({ ...base, ...o }, en).filter((c) => !c.complete).map((c) => c.label)

  it('the school’s openers send (gone once it has written); its follow-ups fill the composer — a second tap never posts twice', () => {
    expect(sends({})).toEqual(['We are hiring', 'Ask: start date and schedule'])
    expect(sends({ buyerHasSent: true })).toEqual([])
    expect(fills({ buyerHasSent: true })).toEqual(['Ask for their CV', 'Suggest a call'])
  })

  it('the teacher’s first answers send (gone once they have replied); the asks that stay fill the composer', () => {
    expect(sends({ isSeller: true })).toEqual(['Interested — tell me more', 'Not available right now'])
    expect(fills({ isSeller: true })).toEqual(['Ask: hours, place and pay', 'Can meet in …'])
    expect(sends({ isSeller: true, sellerRepliedAfterBuyer: true })).toEqual([])
  })

  it('the hiring opener is the one the profile and the cards send', () => {
    expect(teacherThreadChips(base, en)[0].text).toMatch(/^Hello, we are hiring a teacher/)
  })
})
