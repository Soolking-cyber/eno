import { describe, expect, it } from 'vitest'
import { standingDeal, type DealMessage } from './thread-deal'

/**
 * THE DEAL A THREAD AGREED, ONLY WHILE IT STILL STANDS FOR THE LISTING SHOWN NOW (B6). It decides the
 * seller's "Deal! Mark as sold?" chip and the "Agreed price" the mark-sold sheet starts from — so a wrong
 * "yes" offers to sell a listing at another listing's price. Seller's frame unless stated: `mine` = seller.
 */

const t = (min: number) => new Date(Date.UTC(2026, 9, 1, 8, min)).toISOString()
const text = (id: string, mine: boolean, min: number, body = id): DealMessage => ({ id, mine, createdAt: t(min), kind: 'text', body })
/** The line actOnOffer persists for the ACCEPTOR (messages.ts). */
const acceptedLine = (mine: boolean, min: number) => text('✅', mine, min, '✅ Đã chấp nhận · Offer accepted — 9.500.000 ₫')
const offer = (id: string, mine: boolean, min: number, offerStatus: string, offerAmount = 11_000_000): DealMessage =>
  ({ id, mine, createdAt: t(min), kind: 'offer', offerStatus, offerAmount })
const live = { availabilityConfirmedAt: null }

describe('a deal that stands', () => {
  it('the buyer offered, I accepted (my "✅" line after it): the deal, at the agreed amount', () => {
    const msgs = [text('hi', false, 0), offer('o1', false, 1, 'accepted'), acceptedLine(true, 2)]
    expect(standingDeal(msgs, live, true)).toEqual({ offerId: 'o1', amount: 11_000_000 })
  })

  it('I countered, the BUYER accepted: their own "✅" line is the one buyer message allowed after it', () => {
    const msgs = [offer('o1', true, 1, 'accepted', 9_500_000), acceptedLine(false, 2)]
    expect(standingDeal(msgs, live, true)).toEqual({ offerId: 'o1', amount: 9_500_000 })
  })

  it('⛔ that allowance is the ✅ LINE, identified by its body — not "any one message" (a failed ✅ insert + a retarget line)', () => {
    const msgs = [offer('o1', true, 1, 'accepted', 9_500_000), text('Còn cái bàn không ạ?', false, 2)]
    expect(standingDeal(msgs, live, true)).toBeNull()
  })

  it('⛔ and it is never extended to a buyer whose OWN offer I accepted (the ✅ line is then mine)', () => {
    const msgs = [offer('o1', false, 1, 'accepted'), acceptedLine(true, 2), acceptedLine(false, 3)]
    expect(standingDeal(msgs, live, true)).toBeNull()
  })

  it('my own messages after the deal never end it', () => {
    const msgs = [offer('o1', false, 1, 'accepted'), text('mine-1', true, 2), text('mine-2', true, 3)]
    expect(standingDeal(msgs, live, true)?.offerId).toBe('o1')
  })

  it('the buyer\'s frame is the mirror image (viewer = buyer, `mine` = buyer)', () => {
    const msgs = [offer('o1', true, 1, 'accepted'), text('seller', false, 2)]
    expect(standingDeal(msgs, live, false)?.offerId).toBe('o1')
    expect(standingDeal([...msgs, text('me again', true, 3)], live, false)).toBeNull()
  })

  it('a listing confirmed BEFORE the deal does not undo it', () => {
    const msgs = [offer('o1', false, 5, 'accepted')]
    expect(standingDeal(msgs, { availabilityConfirmedAt: t(1) }, true)?.offerId).toBe('o1')
  })
})

describe('⛔ no deal', () => {
  it('nothing accepted — pending, declined and countered are not deals', () => {
    for (const s of ['pending', 'declined', 'countered']) expect(standingDeal([offer('o1', false, 1, s)], live, true)).toBeNull()
    expect(standingDeal([], live, true)).toBeNull()
  })

  it('⛔ THE BUYER WROTE SINCE — which is what a RETARGET leaves behind (the sofa deal, now in a thread about the table)', () => {
    const msgs = [offer('o1', false, 1, 'accepted'), text('ok', true, 2), text('Còn cái bàn không ạ?', false, 3)]
    expect(standingDeal(msgs, live, true)).toBeNull()
  })

  it('…and when the buyer accepted my counter, one more buyer line past their "✅" ends it', () => {
    const msgs = [offer('o1', true, 1, 'accepted'), acceptedLine(false, 2), text('see you', false, 3)]
    expect(standingDeal(msgs, live, true)).toBeNull()
  })

  it('a NEWER offer — a new negotiation, or a retarget that came with one', () => {
    const msgs = [offer('o1', false, 1, 'accepted'), offer('o2', false, 2, 'pending', 3_000_000)]
    expect(standingDeal(msgs, live, true)).toBeNull()
  })

  it('a relist or a "still available" AFTER the deal — the listing says this deal did not sell it', () => {
    const msgs = [offer('o1', false, 1, 'accepted')]
    expect(standingDeal(msgs, { availabilityConfirmedAt: t(9) }, true)).toBeNull()
  })

  it('an answer the server has not confirmed (the undo window) is not a deal yet', () => {
    const msgs = [offer('o1', false, 1, 'accepted')]
    expect(standingDeal(msgs, live, true, (id) => id === 'o1')).toBeNull()
  })

  it('the deal that stands is the LAST accepted one (legacy threads can hold two)', () => {
    const msgs = [offer('o0', false, 0, 'accepted', 1), offer('o1', false, 1, 'accepted', 2)]
    expect(standingDeal(msgs, live, true)).toEqual({ offerId: 'o1', amount: 2 })
  })

  it('an accepted offer with no amount is still a deal — just no price to pre-fill', () => {
    const msgs = [{ ...offer('o1', false, 1, 'accepted'), offerAmount: null }]
    expect(standingDeal(msgs, live, true)).toEqual({ offerId: 'o1', amount: null })
  })
})
