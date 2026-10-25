import { describe, expect, it } from 'vitest'
import { mayReviewDeal, type SaleFacts } from './trade-loop'

/** mayReviewDeal — the one review rule behind the review POST and the thread's review card (sweep, 2026-10-22). */
const facts = (patch: Partial<SaleFacts> = {}): SaleFacts => ({
  status: 'sold', complianceStatus: null, soldChannel: 'eno', soldToProfileId: 'me', soldAt: new Date('2026-10-01'),
  salePrice: null, saleConfirmedAt: new Date('2026-10-02'), saleDeclinedAt: null, saleBuyerHistory: null, saleConfirmPromptedAt: null,
  ...patch,
})

describe('mayReviewDeal', () => {
  it('the named buyer — confirmed, or not answered yet (a seller who blocks them cannot veto the review, R3)', () => {
    expect(mayReviewDeal(facts(), 'me', false)).toBe(true)
    expect(mayReviewDeal(facts(), 'me', true)).toBe(true)
    expect(mayReviewDeal(facts({ saleConfirmedAt: null }), 'me', false)).toBe(true)
  })
  it('"the listing is sold" alone is not enough: another buyer, off eno, unnamed', () => {
    for (const f of [facts({ soldToProfileId: 'other' }), facts({ soldChannel: 'external', soldToProfileId: null }),
      facts({ soldChannel: null, soldToProfileId: null }), facts({ status: 'active', soldChannel: null, soldToProfileId: null, saleConfirmedAt: null })]) {
      expect(mayReviewDeal(f, 'me', false)).toBe(false)
    }
  })
  it('an accepted offer counts while the sale record does not contradict it: unsold, or sold with nobody named', () => {
    expect(mayReviewDeal(facts({ status: 'active', soldChannel: null, soldToProfileId: null, saleConfirmedAt: null }), 'me', true)).toBe(true)
    expect(mayReviewDeal(facts({ soldChannel: null, soldToProfileId: null, saleConfirmedAt: null }), 'me', true)).toBe(true)
  })
  it('⛔ an accepted offer never outvotes a sale to someone else or to "someone not on eno" (refute review, 2026-10-23)', () => {
    expect(mayReviewDeal(facts({ soldToProfileId: 'other' }), 'me', true)).toBe(false)
    expect(mayReviewDeal(facts({ soldChannel: 'external', soldToProfileId: null, saleConfirmedAt: null }), 'me', true)).toBe(false)
  })
  it('⛔ never for a listing taken down by authority order, by either path', () => {
    expect(mayReviewDeal(facts({ complianceStatus: 'taken_down' }), 'me', false)).toBe(false)
    expect(mayReviewDeal(facts({ complianceStatus: 'taken_down' }), 'me', true)).toBe(false)
  })
  it('⛔ never for the named buyer who said "No" — their word stands over an accepted offer', () => {
    expect(mayReviewDeal(facts({ saleConfirmedAt: null, saleDeclinedAt: new Date('2026-10-02') }), 'me', false)).toBe(false)
    expect(mayReviewDeal(facts({ saleConfirmedAt: null, saleDeclinedAt: new Date('2026-10-02') }), 'me', true)).toBe(false)
    // …nor after the seller named someone else: the buyer history keeps their "No".
    const history = JSON.stringify([{ i: 'me', a: Date.parse('2026-10-01'), d: Date.parse('2026-10-02') }])
    expect(mayReviewDeal(facts({ soldToProfileId: 'other', saleConfirmedAt: null, saleBuyerHistory: history }), 'me', true)).toBe(false)
    // …but another buyer's "No", on a sale since un-marked, does not touch this buyer's accepted offer.
    const theirs = JSON.stringify([{ i: 'other', a: Date.parse('2026-10-01'), d: Date.parse('2026-10-02') }])
    expect(mayReviewDeal(facts({ status: 'active', soldChannel: null, soldToProfileId: null, saleConfirmedAt: null, saleBuyerHistory: theirs }), 'me', true)).toBe(true)
  })
  it('no viewer → no', () => {
    expect(mayReviewDeal(facts(), null, true)).toBe(false)
  })
})
