import { describe, expect, it } from 'vitest'
import { answeredOnServer, choiceFor, offerActFailedCopy, overlayOfferChoices, type OfferChoice } from './offer-choices'

/**
 * The rules that keep an answer inside its undo window (or in flight) on screen while the thread keeps
 * refetching the server's `pending`. See offer-choices.ts for why each exists.
 */

const offer = (id: string, offerStatus: string | null) => ({ id, kind: 'offer', offerStatus, body: '' })
const text = (id: string) => ({ id, kind: 'text', offerStatus: null, body: 'hi' })

describe('overlayOfferChoices', () => {
  it('paints the chosen status over an offer the server still reports pending (the poll inside the 5s window)', () => {
    const msgs = [text('a'), offer('o1', 'pending'), offer('o2', 'pending')]
    const out = overlayOfferChoices(msgs, new Map<string, OfferChoice>([['o1', 'accepted']]))
    expect(out.map((m) => m.offerStatus)).toEqual([null, 'accepted', 'pending'])
    // Untouched rows keep their identity; the input is not mutated.
    expect(out[0]).toBe(msgs[0])
    expect(out[2]).toBe(msgs[2])
    expect(msgs[1].offerStatus).toBe('pending')
  })

  it('never paints over a status the server has already decided — the server wins', () => {
    for (const status of ['accepted', 'declined', 'countered', 'expired']) {
      const msgs = [offer('o1', status)]
      const out = overlayOfferChoices(msgs, new Map<string, OfferChoice>([['o1', 'declined']]))
      expect(out[0].offerStatus).toBe(status)
    }
  })

  it('ignores a matching id on a message that is not an offer', () => {
    const msgs = [{ id: 'x', kind: 'text', offerStatus: 'pending' }]
    expect(overlayOfferChoices(msgs, new Map<string, OfferChoice>([['x', 'accepted']]))[0].offerStatus).toBe('pending')
  })

  it('returns the SAME array when there is nothing to change, so React state sees no change', () => {
    const msgs = [offer('o1', 'pending')]
    expect(overlayOfferChoices(msgs, new Map())).toBe(msgs)
    expect(overlayOfferChoices(msgs, new Map<string, OfferChoice>([['other', 'accepted']]))).toBe(msgs)
  })
})

describe('answeredOnServer', () => {
  it('reports an id whose offer the server no longer holds as pending', () => {
    const msgs = [offer('o1', 'countered'), offer('o2', 'pending'), offer('o3', 'accepted')]
    expect(answeredOnServer(msgs, ['o1', 'o2', 'o3'])).toEqual(['o1', 'o3'])
  })

  it('does NOT report an id that is merely absent from the page of messages', () => {
    expect(answeredOnServer([offer('o2', 'pending')], ['o1'])).toEqual([])
  })
})

describe('offerActFailedCopy', () => {
  const tr = (en: string) => en
  it('names the action and the reason the route gave', () => {
    expect(offerActFailedCopy('accept', 'listing_unavailable', tr)).toMatch(/no longer available/)
    expect(offerActFailedCopy('accept', 'not_actionable', tr)).toMatch(/not accepted/)
    expect(offerActFailedCopy('decline', 'not_actionable', tr)).toMatch(/not declined/)
    // The route only refuses an ACCEPT for listing_unavailable; a decline must never read "not accepted".
    expect(offerActFailedCopy('decline', 'listing_unavailable', tr)).toBe('Could not decline the offer — please try again.')
    expect(offerActFailedCopy('accept', 'rate_limited', tr)).toBe('Could not accept the offer — please try again.')
    expect(offerActFailedCopy('decline', undefined, tr)).toBe('Could not decline the offer — please try again.')
  })

  it('a block (ugc-safety) says the conversation is closed — for an accept only, never naming a person', () => {
    expect(offerActFailedCopy('accept', 'blocked', tr)).toBe('This conversation is closed, so the offer was not accepted.')
    // The route never refuses a DECLINE for a block, so a decline never reads as "closed".
    expect(offerActFailedCopy('decline', 'blocked', tr)).toBe('Could not decline the offer — please try again.')
    expect(offerActFailedCopy('accept', 'blocked', (_en, vi) => vi)).toBe('Cuộc trò chuyện này đã đóng nên đề nghị chưa được chấp nhận.')
  })

  // The answer waited out its undo window while this browser changed account (src/lib/api/acting-account.ts):
  // it says what happened, never "try again" — trying again here would be acting as the other account.
  it('account_changed says the browser changed account, for both answers, with no "try again"', () => {
    expect(offerActFailedCopy('accept', 'account_changed', tr)).toBe('This browser is now signed in to a different account, so the offer was not accepted.')
    expect(offerActFailedCopy('decline', 'account_changed', tr)).toBe('This browser is now signed in to a different account, so the offer was not declined.')
  })

  it('ships Vietnamese for every line (no English fallback in a vi thread)', () => {
    const vi = (_en: string, v: string) => v
    for (const code of ['listing_unavailable', 'not_actionable', 'account_changed', undefined]) {
      for (const action of ['accept', 'decline'] as const) {
        expect(offerActFailedCopy(action, code, vi)).toMatch(/đề nghị|tin đăng/i)
      }
    }
  })

  it('maps actions to the status the card shows', () => {
    expect(choiceFor('accept')).toBe('accepted')
    expect(choiceFor('decline')).toBe('declined')
  })
})
