import { describe, expect, it } from 'vitest'

import {
  LEGAL_OFFER_TRANSITIONS,
  OFFER,
  OFFER_ACTIONS,
  OFFER_STATUSES,
  OFFER_TRANSITIONS,
  applyOfferAction,
  canActOnOffer,
  effectiveOfferStatus,
  formatOfferTimeLeft,
  isOfferExpired,
  isOfferExpiringSoon,
  isOfferReason,
  isTerminalOfferStatus,
  normalizeOfferStatus,
  offerActions,
  offerDeadline,
  offerRole,
  offerTimeLeftMs,
  type OfferAction,
  type OfferFacts,
  type OfferStatus,
} from './offers'

/**
 * THE OFFER STATE MACHINE — the five things that are invisible in a screenshot and expensive
 * in production: what a NULL status is allowed to do, when the 24h window actually closes,
 * which refusal wins when two gates are both wrong (because that decides which 409 the buyer
 * sees), the decline asymmetry, and whether the countdown ever overstates or understates.
 *
 * The clock is a FROZEN ARGUMENT throughout — no vi.useFakeTimers, no Date.now(). That is the
 * whole reason the machine takes `now`.
 */

const SENT = Date.parse('2026-08-11T09:00:00.000Z')
const HOUR = 60 * 60 * 1000

/** A live, ordinary offer: sent now, negotiable listing, active, nothing agreed yet. */
function facts(over: Partial<OfferFacts> = {}): OfferFacts {
  return {
    status: 'pending',
    createdAt: new Date(SENT).toISOString(),
    listingActive: true,
    negotiable: true,
    threadHasAcceptedOffer: false,
    ...over,
  }
}

describe('the transition graph is data, not prose', () => {
  it('only pending has outgoing edges — a resolved offer is forever', () => {
    for (const s of OFFER_STATUSES) {
      if (s === 'pending') continue
      expect(LEGAL_OFFER_TRANSITIONS[s]).toEqual([])
      expect(isTerminalOfferStatus(s)).toBe(true)
    }
    expect(isTerminalOfferStatus('pending')).toBe(false)
    expect(isTerminalOfferStatus(null)).toBe(true)
  })

  it('every action lands on a state pending is allowed to reach', () => {
    for (const a of OFFER_ACTIONS) {
      expect(LEGAL_OFFER_TRANSITIONS.pending).toContain(OFFER_TRANSITIONS[a])
    }
  })

  it('expired is reachable but has no action — only the clock produces it', () => {
    expect(LEGAL_OFFER_TRANSITIONS.pending).toContain('expired')
    expect(Object.values(OFFER_TRANSITIONS)).not.toContain('expired')
  })

  it('applyOfferAction can never emit an illegal edge, for any state × action × role', () => {
    // ⚠️ THE ACTION AXIS CARRIES GARBAGE TOO, AND UNTIL IT DID THIS TEST WAS BLIND. Looping only
    // over OFFER_ACTIONS could not see that an unknown action fell through the accept and counter
    // branches into the trailing decline return — measured: `applyOfferAction('bogus', …)`
    // answered `{ ok: true, status: undefined }`, which a route would have written straight into
    // Message.offerStatus. A fuzzed axis is worth more than an exhaustive one over valid values.
    const now = SENT + HOUR
    const actions = [...OFFER_ACTIONS, 'bogus', '', 'ACCEPT', null] as unknown as OfferAction[]
    for (const status of [...OFFER_STATUSES, null, 'nonsense'] as (OfferStatus | null | string)[]) {
      for (const action of actions) {
        for (const role of ['sender', 'recipient'] as const) {
          const out = applyOfferAction(action, facts({ status }), role, now)
          if (!out.ok) continue
          expect(effectiveOfferStatus(facts({ status }), now)).toBe('pending')
          expect(OFFER_ACTIONS).toContain(action)
          expect(LEGAL_OFFER_TRANSITIONS.pending).toContain(out.status)
          expect(out.status).toBeDefined()
        }
      }
    }
  })

  it('refuses an action it does not know instead of falling through to a silent yes', () => {
    const now = SENT + HOUR
    for (const bogus of ['bogus', '', 'ACCEPT', 'withdraw', null, undefined]) {
      expect(canActOnOffer(bogus as unknown as OfferAction, facts(), 'recipient', now)).toEqual({
        ok: false,
        refusal: 'unknown_action',
      })
    }
  })

  it('offerActions never proposes anything outside the three real actions', () => {
    expect(offerActions(facts(), 'recipient', SENT + HOUR).every((a) => OFFER_ACTIONS.includes(a))).toBe(true)
  })
})

describe('a status the machine does not recognise is INERT, never pending', () => {
  // ⚠️ THE REGRESSION THIS EXISTS FOR: folding null to 'pending' would render Accept on a
  // legacy row, and actOnOffer's `where offerStatus:'pending'` does not match NULL — so the
  // first tap 409s not_actionable. A control the server refuses is the one thing the machine
  // is built to prevent.
  it.each([null, undefined, '', 'PENDING', 'accepted ', 'nonsense'])('%p normalises to null', (raw) => {
    expect(normalizeOfferStatus(raw as string | null | undefined)).toBeNull()
  })

  it.each(['pending', 'accepted', 'declined', 'countered', 'expired'])('%s survives normalisation', (raw) => {
    expect(normalizeOfferStatus(raw)).toBe(raw)
  })

  it('offers the recipient no actions at all', () => {
    expect(offerActions(facts({ status: null }), 'recipient', SENT + HOUR)).toEqual([])
    expect(canActOnOffer('accept', facts({ status: null }), 'recipient', SENT + HOUR)).toEqual({
      ok: false,
      refusal: 'not_pending',
    })
  })
})

describe('the 24h window', () => {
  it('is anchored on createdAt when no explicit deadline exists — no schema column needed', () => {
    expect(offerDeadline(facts())).toBe(SENT + OFFER.TTL_MS)
    expect(OFFER.TTL_MS).toBe(24 * HOUR)
  })

  it('an explicit expiresAt wins, so a real column can land later without touching callers', () => {
    const f = facts({ expiresAt: new Date(SENT + 2 * HOUR).toISOString() })
    expect(offerDeadline(f)).toBe(SENT + 2 * HOUR)
    expect(isOfferExpired(f, SENT + 3 * HOUR)).toBe(true)
  })

  it('is still live one minute before the deadline and closed ON it', () => {
    expect(effectiveOfferStatus(facts(), SENT + OFFER.TTL_MS - 60_000)).toBe('pending')
    expect(effectiveOfferStatus(facts(), SENT + OFFER.TTL_MS)).toBe('expired')
    expect(effectiveOfferStatus(facts(), SENT + OFFER.TTL_MS + 1)).toBe('expired')
  })

  it('accepts Date, epoch ms and ISO alike', () => {
    expect(offerDeadline({ createdAt: new Date(SENT) })).toBe(SENT + OFFER.TTL_MS)
    expect(offerDeadline({ createdAt: SENT })).toBe(SENT + OFFER.TTL_MS)
    expect(offerDeadline({ createdAt: new Date(SENT).toISOString() })).toBe(SENT + OFFER.TTL_MS)
  })

  it('FAILS OPEN on a date it cannot parse — a live offer never loses Accept to our own bug', () => {
    const broken = facts({ createdAt: 'not-a-date' })
    expect(offerDeadline(broken)).toBeNull()
    expect(offerTimeLeftMs(broken, SENT)).toBe(Infinity)
    expect(isOfferExpired(broken, SENT + 10 * 365 * 24 * HOUR)).toBe(false)
    expect(offerActions(broken, 'recipient', SENT)).toContain('accept')
  })

  it('clamps the remaining time at zero rather than going negative', () => {
    expect(offerTimeLeftMs(facts(), SENT + 48 * HOUR)).toBe(0)
  })

  it('flags the last three hours, and neither the hour before that nor a lapsed window', () => {
    expect(isOfferExpiringSoon(facts(), SENT + 20 * HOUR)).toBe(false) // 4h left
    expect(isOfferExpiringSoon(facts(), SENT + 21 * HOUR)).toBe(true) // exactly 3h left
    expect(isOfferExpiringSoon(facts(), SENT + 23 * HOUR)).toBe(true)
    expect(isOfferExpiringSoon(facts(), SENT + 24 * HOUR)).toBe(false) // lapsed, not "soon"
    expect(OFFER.EXPIRING_SOON_MS).toBe(3 * HOUR)
  })

  it('does NOT re-open a resolved offer — an accepted deal does not expire', () => {
    const long = SENT + 90 * HOUR
    expect(effectiveOfferStatus(facts({ status: 'accepted' }), long)).toBe('accepted')
    expect(effectiveOfferStatus(facts({ status: 'declined' }), long)).toBe('declined')
    expect(effectiveOfferStatus(facts({ status: 'countered' }), long)).toBe('countered')
  })
})

describe('who may perform what', () => {
  const now = SENT + HOUR

  it('maps ids to a role in one line', () => {
    expect(offerRole('a', 'a')).toBe('sender')
    expect(offerRole('a', 'b')).toBe('recipient')
  })

  it('the sender can do nothing to their own offer', () => {
    expect(offerActions(facts(), 'sender', now)).toEqual([])
    for (const a of OFFER_ACTIONS) {
      expect(canActOnOffer(a, facts(), 'sender', now)).toEqual({ ok: false, refusal: 'own_offer' })
    }
  })

  it('the recipient of a live offer on a negotiable, active listing gets all three, affirmative first', () => {
    expect(offerActions(facts(), 'recipient', now)).toEqual(['accept', 'decline', 'counter'])
  })

  it('resolves each action to its persisted status', () => {
    expect(applyOfferAction('accept', facts(), 'recipient', now)).toEqual({ ok: true, status: 'accepted' })
    expect(applyOfferAction('decline', facts(), 'recipient', now)).toEqual({ ok: true, status: 'declined' })
    expect(applyOfferAction('counter', facts(), 'recipient', now)).toEqual({ ok: true, status: 'countered' })
  })
})

describe('the refusals predict the exact 409 the server would send', () => {
  const now = SENT + HOUR

  it('counter on a fixed-price listing is not_negotiable — the one that docks buyer trust', () => {
    const f = facts({ negotiable: false })
    expect(canActOnOffer('counter', f, 'recipient', now)).toEqual({ ok: false, refusal: 'not_negotiable' })
    expect(offerActions(f, 'recipient', now)).toEqual(['accept', 'decline'])
  })

  it('not_negotiable beats listing_unavailable on counter, because the send route tests it first', () => {
    const f = facts({ negotiable: false, listingActive: false })
    expect(canActOnOffer('counter', f, 'recipient', now)).toEqual({ ok: false, refusal: 'not_negotiable' })
  })

  it('accept on a non-active listing is listing_unavailable, and it beats thread_closed', () => {
    const f = facts({ listingActive: false, threadHasAcceptedOffer: true })
    expect(canActOnOffer('accept', f, 'recipient', now)).toEqual({ ok: false, refusal: 'listing_unavailable' })
  })

  it('a thread that already closed at a price refuses a second accept', () => {
    const f = facts({ threadHasAcceptedOffer: true })
    expect(canActOnOffer('accept', f, 'recipient', now)).toEqual({ ok: false, refusal: 'thread_closed' })
    // …and a counter into a closed thread, which is stricter than the send route and
    // deliberately so: hiding a control costs a tap, showing a refused one costs trust.
    expect(canActOnOffer('counter', f, 'recipient', now)).toEqual({ ok: false, refusal: 'thread_closed' })
  })

  it('DECLINE SURVIVES EVERYTHING a live offer can be surrounded by', () => {
    // The asymmetry is copied from the accept route's own comment: gating decline would strand a
    // pending card forever on every sold listing, with no way for either side to clear it.
    const hostile = facts({ listingActive: false, negotiable: false, threadHasAcceptedOffer: true })
    expect(canActOnOffer('decline', hostile, 'recipient', now)).toEqual({ ok: true })
    expect(offerActions(hostile, 'recipient', now)).toEqual(['decline'])
  })

  it('expiry outranks every other refusal — a lapsed offer is answered by nobody', () => {
    const lapsed = SENT + 25 * HOUR
    expect(canActOnOffer('accept', facts(), 'recipient', lapsed)).toEqual({ ok: false, refusal: 'expired' })
    expect(canActOnOffer('counter', facts({ negotiable: false }), 'recipient', lapsed)).toEqual({
      ok: false,
      refusal: 'expired',
    })
    expect(canActOnOffer('decline', facts(), 'sender', lapsed)).toEqual({ ok: false, refusal: 'expired' })
    expect(offerActions(facts(), 'recipient', lapsed)).toEqual([])
  })

  it('EXPIRY OUTRANKS DECLINE TOO, and that is a different question from the listing asymmetry', () => {
    // A reviewer read this as contradicting "decline must always work". It does not: "clearable"
    // is about a card that still DEMANDS an answer (a live offer on a listing that went away),
    // and an expired card demands nothing — the window closing IS its resolution. Pinned here so
    // the decision is a test rather than an opinion. The cost is recorded in offers.ts: the raw
    // column stays 'pending', so any surface reading it unmediated still says Pending.
    const lapsed = SENT + 25 * HOUR
    expect(canActOnOffer('decline', facts({ listingActive: false }), 'recipient', SENT + HOUR)).toEqual({ ok: true })
    expect(canActOnOffer('decline', facts(), 'recipient', lapsed)).toEqual({ ok: false, refusal: 'expired' })
  })

  it('a resolved offer refuses with not_pending, not with expired', () => {
    expect(canActOnOffer('accept', facts({ status: 'declined' }), 'recipient', SENT + 25 * HOUR)).toEqual({
      ok: false,
      refusal: 'not_pending',
    })
  })
})

describe('the countdown states the truth, in both languages', () => {
  it('shows BOTH units so it never understates the time left', () => {
    // 1h59m must not read as "1h" — that is an hour of manufactured urgency.
    expect(formatOfferTimeLeft(HOUR + 59 * 60_000, 'en')).toBe('1h 59m')
    expect(formatOfferTimeLeft(HOUR + 59 * 60_000, 'vi')).toBe('1 giờ 59 phút')
  })

  it('drops the minutes only when there are none', () => {
    expect(formatOfferTimeLeft(2 * HOUR, 'en')).toBe('2h')
    expect(formatOfferTimeLeft(2 * HOUR, 'vi')).toBe('2 giờ')
  })

  it('falls back to minutes inside the last hour', () => {
    expect(formatOfferTimeLeft(45 * 60_000, 'en')).toBe('45m')
    expect(formatOfferTimeLeft(45 * 60_000, 'vi')).toBe('45 phút')
  })

  it('says the last minute in words, never "0m" beside live controls', () => {
    // ⚠️ THE REGRESSION THIS EXISTS FOR: flooring a still-live window to zero renders
    // "Expires in 0m" next to three enabled buttons — a card contradicting itself for up to 59
    // seconds. Expiry needs `<= 0`, so those 59 seconds are genuinely still actionable.
    expect(formatOfferTimeLeft(59_000, 'en')).toBe('under a minute')
    expect(formatOfferTimeLeft(1, 'vi')).toBe('chưa đầy một phút')
  })

  it('reserves the zero for a window that really has closed', () => {
    expect(formatOfferTimeLeft(0, 'vi')).toBe('0 phút')
    expect(formatOfferTimeLeft(-5_000, 'en')).toBe('0m')
  })

  it('floors rather than rounds up — 119 seconds is one minute, not two', () => {
    expect(formatOfferTimeLeft(119_000, 'en')).toBe('1m')
  })

  it('returns null for a window it cannot measure, rather than claiming zero', () => {
    expect(formatOfferTimeLeft(Infinity, 'en')).toBeNull()
    expect(formatOfferTimeLeft(NaN, 'vi')).toBeNull()
  })

  it('renders a full window as 24h at the instant it is sent', () => {
    expect(formatOfferTimeLeft(offerTimeLeftMs(facts(), SENT), 'en')).toBe('24h')
  })
})

describe('offer reasons', () => {
  it('accepts only the known codes — a free-text reason is not a code', () => {
    expect(isOfferReason('cash')).toBe(true)
    expect(isOfferReason('timing')).toBe(true)
    expect(isOfferReason('Cash')).toBe(false)
    expect(isOfferReason('')).toBe(false)
    expect(isOfferReason(null)).toBe(false)
  })
})
