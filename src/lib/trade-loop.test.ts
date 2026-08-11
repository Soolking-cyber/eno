import { describe, expect, it } from 'vitest'
import {
  TRADE_LOOP,
  MAX_BUYER_HISTORY,
  buyerHistoryEntry,
  buyerResponsePatch,
  canMarkSold,
  confirmPromptPrice,
  confirmWindowAnchor,
  canNameBuyer,
  canPromptReview,
  canRespondToSale,
  countsAsSale,
  countsTowardTrust,
  nextConfirmPrompt,
  normalizeSalePrice,
  parseBuyerHistory,
  salePriceForGuidance,
  saleState,
  serializeBuyerHistory,
  validateMarkSold,
  withinConfirmWindow,
  type SaleFacts,
} from './trade-loop'

/**
 * THE TRADE LOOP — the rules that decide whether a sale is allowed to change somebody's
 * reputation and the market's idea of what things are worth.
 *
 * ⚠️ WHY THIS FILE IS LONGER THAN THE MODULE IT TESTS. Every guard in trade-loop.ts exists
 * because removing it creates a way to MINT TRUST WITHOUT A TRADE: name yourself as your
 * own buyer, name a stranger who never messaged you, confirm your own sale, or turn a
 * buyer's "No" back into a fresh prompt until they give up and tap Yes. Each of those is a
 * one-line "simplification" away, and none of them would fail a typecheck, a lint or a
 * smoke test — the flow would look like it worked. These tests are the only thing standing
 * between that and the trust ladder.
 *
 * The clock is always injected. No test here reads the wall clock, so none of them can
 * pass at 11:59 and fail at midnight.
 */

const SELLER = 'seller-profile-1'
const BUYER = 'buyer-profile-1'
const OTHER = 'buyer-profile-2'
const STRANGER = 'never-messaged-anyone'

const T0 = new Date('2026-08-01T09:00:00.000Z')
const at = (ms: number) => new Date(T0.getTime() + ms)
const days = (n: number) => n * 86_400_000
const hours = (n: number) => n * 3_600_000

function facts(over: Partial<SaleFacts> = {}): SaleFacts {
  return {
    status: 'active',
    complianceStatus: 'clear',
    soldChannel: null,
    soldToProfileId: null,
    soldAt: null,
    salePrice: null,
    saleConfirmedAt: null,
    saleDeclinedAt: null,
    saleBuyerHistory: null,
    saleConfirmPromptedAt: null,
    ...over,
  }
}

/** A sale marked to an eno buyer who has not answered yet. */
const awaiting = (over: Partial<SaleFacts> = {}) =>
  facts({ status: 'sold', soldChannel: 'eno', soldToProfileId: BUYER, soldAt: T0, salePrice: 11_200_000, saleConfirmPromptedAt: T0, ...over })

const markCtx = (over: Record<string, unknown> = {}) => ({
  actorProfileId: SELLER,
  sellerProfileId: SELLER,
  askingPrice: 12_000_000,
  conversationBuyerProfileIds: [BUYER, OTHER],
  facts: facts(),
  now: T0,
  ...over,
}) as Parameters<typeof validateMarkSold>[1]

// ──────────────────────────────────────────────────────────────────────────────────
describe('saleState — the six states, because three of them look identical if you only check status', () => {
  it('an unsold listing is unsold whatever else is stamped on it', () => {
    expect(saleState(facts())).toBe('unsold')
    // A reactivation clears the cluster, but even with stale values the status wins.
    expect(saleState(facts({ status: 'active', soldChannel: 'eno', soldToProfileId: BUYER, saleConfirmedAt: T0 }))).toBe('unsold')
    expect(saleState(facts({ status: 'hidden' }))).toBe('unsold')
  })

  it('sold with nobody named is "unattributed" — the shape the web/partner/MCP/availability paths send', () => {
    expect(saleState(facts({ status: 'sold', soldAt: T0 }))).toBe('unattributed')
  })

  it('"someone not on eno" is off_platform, not unattributed — they are different products', () => {
    expect(saleState(facts({ status: 'sold', soldChannel: 'external', soldAt: T0 }))).toBe('off_platform')
  })

  it('an eno channel with no buyer id degrades to unattributed rather than pretending someone was asked', () => {
    expect(saleState(facts({ status: 'sold', soldChannel: 'eno', soldToProfileId: null, soldAt: T0 }))).toBe('unattributed')
  })

  it('awaiting → confirmed → declined are read off the buyer answer, not the seller claim', () => {
    expect(saleState(awaiting())).toBe('awaiting_buyer')
    expect(saleState(awaiting({ saleConfirmedAt: at(hours(2)) }))).toBe('confirmed')
    expect(saleState(awaiting({ saleDeclinedAt: at(hours(2)) }))).toBe('declined')
  })

  it('⚠️ contradictory rows (both stamps) read as DECLINED — the reading that does not mint trust', () => {
    const corrupt = awaiting({ saleConfirmedAt: at(hours(1)), saleDeclinedAt: at(hours(2)) })
    expect(saleState(corrupt)).toBe('declined')
    expect(countsTowardTrust(corrupt)).toBe(false)
  })

  it('⚠️ a confirmation stamp on a row with NO named eno buyer does not create a confirmed sale', () => {
    // Unreachable through the transitions in this module — which is the point. A backfill
    // script or a hand-written UPDATE could land one, and the failure it would cause is an
    // off-platform sale silently counting toward trust.
    const externalStamped = facts({ status: 'sold', soldChannel: 'external', soldAt: T0, saleConfirmedAt: at(hours(1)) })
    expect(saleState(externalStamped)).toBe('off_platform')
    expect(countsTowardTrust(externalStamped)).toBe(false)

    const buyerlessStamped = facts({ status: 'sold', soldChannel: 'eno', soldToProfileId: null, soldAt: T0, saleConfirmedAt: at(hours(1)) })
    expect(saleState(buyerlessStamped)).toBe('unattributed')
    expect(countsTowardTrust(buyerlessStamped)).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────────────────────────
describe('who may mark sold', () => {
  it('the storefront owner may', () => {
    expect(canMarkSold({ actorProfileId: SELLER, sellerProfileId: SELLER })).toEqual({ ok: true })
  })

  it('a random signed-in user may not', () => {
    expect(canMarkSold({ actorProfileId: OTHER, sellerProfileId: SELLER })).toEqual({ ok: false, reason: 'not_seller' })
  })

  it('a guest may not', () => {
    expect(canMarkSold({ actorProfileId: null, sellerProfileId: SELLER })).toEqual({ ok: false, reason: 'not_seller' })
  })

  it('⚠️ a listing with no resolvable owner refuses rather than matching null===null', () => {
    expect(canMarkSold({ actorProfileId: null, sellerProfileId: null })).toEqual({ ok: false, reason: 'not_seller' })
  })

  it('a listing taken down by authority order is not a sale', () => {
    expect(canMarkSold({ actorProfileId: SELLER, sellerProfileId: SELLER, complianceStatus: 'taken_down' })).toEqual({
      ok: false,
      reason: 'listing_unavailable',
    })
    // under_review is not a takedown — the seller can still close their own trade.
    expect(canMarkSold({ actorProfileId: SELLER, sellerProfileId: SELLER, complianceStatus: 'under_review' })).toEqual({ ok: true })
  })
})

// ──────────────────────────────────────────────────────────────────────────────────
describe('who may be NAMED as the buyer', () => {
  it('someone who messaged this seller may be named', () => {
    expect(canNameBuyer(BUYER, { sellerProfileId: SELLER, conversationBuyerProfileIds: [BUYER, OTHER], facts: facts() })).toEqual({ ok: true })
  })

  it('⚠️ A BUYER WHO NEVER MESSAGED CANNOT BE NAMED — the anti-spoof rule', () => {
    expect(canNameBuyer(STRANGER, { sellerProfileId: SELLER, conversationBuyerProfileIds: [BUYER, OTHER], facts: facts() })).toEqual({
      ok: false,
      reason: 'buyer_not_in_conversations',
    })
  })

  it('an empty conversation list names nobody — a seller with no threads cannot attribute at all', () => {
    expect(canNameBuyer(BUYER, { sellerProfileId: SELLER, conversationBuyerProfileIds: [], facts: facts() })).toEqual({
      ok: false,
      reason: 'buyer_not_in_conversations',
    })
  })

  it('⚠️ the seller cannot name THEMSELVES, even if they somehow appear in their own thread list', () => {
    expect(canNameBuyer(SELLER, { sellerProfileId: SELLER, conversationBuyerProfileIds: [SELLER, BUYER], facts: facts() })).toEqual({
      ok: false,
      reason: 'buyer_is_seller',
    })
  })
})

// ──────────────────────────────────────────────────────────────────────────────────
describe('normalizeSalePrice — a fat-finger guard, not a fraud guard', () => {
  const ASK = 12_000_000

  it('absent means "the seller did not say", which is allowed', () => {
    expect(normalizeSalePrice(undefined, ASK)).toBeNull()
    expect(normalizeSalePrice(null, ASK)).toBeNull()
    expect(normalizeSalePrice('', ASK)).toBeNull()
  })

  it('a haggled price below the ask is the NORMAL case and passes', () => {
    expect(normalizeSalePrice(11_200_000, ASK)).toBe(11_200_000)
    expect(normalizeSalePrice(6_000_000, ASK)).toBe(6_000_000)
  })

  it('VND has no subunit, so the stored number is a whole đồng', () => {
    expect(normalizeSalePrice(11_200_000.4, ASK)).toBe(11_200_000)
    expect(normalizeSalePrice('11200000.6', ASK)).toBe(11_200_001)
  })

  it('zero, negative and non-numeric are refused (undefined ≠ null: "said something wrong")', () => {
    expect(normalizeSalePrice(0, ASK)).toBeUndefined()
    expect(normalizeSalePrice(-1, ASK)).toBeUndefined()
    expect(normalizeSalePrice('abc', ASK)).toBeUndefined()
    expect(normalizeSalePrice(Number.NaN, ASK)).toBeUndefined()
    expect(normalizeSalePrice(Number.POSITIVE_INFINITY, ASK)).toBeUndefined()
    expect(normalizeSalePrice({}, ASK)).toBeUndefined()
  })

  it('the thousand-times typo that would poison a price band is refused', () => {
    expect(normalizeSalePrice(11_200_000_000, ASK)).toBeUndefined()
  })

  it('the bounds are exactly the documented ratios, checked at both edges', () => {
    expect(normalizeSalePrice(ASK * TRADE_LOOP.SALE_PRICE_MAX_MULTIPLE, ASK)).toBe(ASK * TRADE_LOOP.SALE_PRICE_MAX_MULTIPLE)
    expect(normalizeSalePrice(ASK * TRADE_LOOP.SALE_PRICE_MAX_MULTIPLE + 1, ASK)).toBeUndefined()
    expect(normalizeSalePrice(ASK * TRADE_LOOP.SALE_PRICE_MIN_FRACTION, ASK)).toBe(ASK * TRADE_LOOP.SALE_PRICE_MIN_FRACTION)
    expect(normalizeSalePrice(ASK * TRADE_LOOP.SALE_PRICE_MIN_FRACTION - 1, ASK)).toBeUndefined()
  })

  it('with no usable ask (0, null, NaN) the ratio bounds are skipped instead of rejecting everything', () => {
    expect(normalizeSalePrice(11_200_000, null)).toBe(11_200_000)
    expect(normalizeSalePrice(11_200_000, 0)).toBe(11_200_000)
    expect(normalizeSalePrice(11_200_000, Number.NaN)).toBe(11_200_000)
  })

  it('⚠️ …but the ABSOLUTE ceiling still applies there — skipping the ratio must not mean no bound', () => {
    // Raised by external review: with the ratio bounds skipped, any finite positive number
    // reached the column, and after confirmation it would reach price guidance.
    expect(normalizeSalePrice(TRADE_LOOP.SALE_PRICE_ABS_MAX, null)).toBe(TRADE_LOOP.SALE_PRICE_ABS_MAX)
    expect(normalizeSalePrice(TRADE_LOOP.SALE_PRICE_ABS_MAX + 1, null)).toBeUndefined()
    expect(normalizeSalePrice(Number.MAX_SAFE_INTEGER, 0)).toBeUndefined()
    expect(normalizeSalePrice(1e18, Number.NaN)).toBeUndefined()
  })
})

// ──────────────────────────────────────────────────────────────────────────────────
describe('validateMarkSold — the whole transition in one call', () => {
  it('an eno sale writes the buyer, the price, and stamps the prompt clock', () => {
    const r = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 11_200_000 }, markCtx())
    expect(r).toEqual({
      ok: true,
      patch: {
        status: 'sold',
        soldChannel: 'eno',
        soldToProfileId: BUYER,
        soldPlatform: null,
        soldAt: T0,
        salePrice: 11_200_000,
        saleConfirmedAt: null,
        saleDeclinedAt: null,
        saleBuyerHistory: serializeBuyerHistory([{ id: BUYER, askedAt: T0.getTime(), askedPrice: 11_200_000, asks: 1 }]),
        saleConfirmPromptedAt: T0,
      },
    })
  })

  it('"someone not on eno" still sells the item — it just has nobody to ask', () => {
    const r = validateMarkSold({ channel: 'external', platform: '  Chợ Tốt  ', salePrice: 9_000_000 }, markCtx())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.patch.status).toBe('sold') // the listing leaves the market
    expect(r.patch.soldChannel).toBe('external')
    expect(r.patch.soldPlatform).toBe('Chợ Tốt') // trimmed
    expect(r.patch.soldToProfileId).toBeNull()
    expect(r.patch.saleConfirmPromptedAt).toBeNull() // nobody to prompt
    expect(countsAsSale({ ...facts(), ...r.patch })).toBe(true)
  })

  it('a free-text platform is capped at the documented length', () => {
    const r = validateMarkSold({ channel: 'external', platform: 'x'.repeat(500) }, markCtx())
    expect(r.ok && r.patch.soldPlatform?.length).toBe(TRADE_LOOP.MAX_PLATFORM_LEN)
  })

  it('a whitespace-only platform becomes null rather than an empty string', () => {
    const r = validateMarkSold({ channel: 'external', platform: '   ' }, markCtx())
    expect(r.ok && r.patch.soldPlatform).toBeNull()
  })

  it('no channel = a plain unattributed sold, which stays legal (paths 2–5 send exactly this)', () => {
    const r = validateMarkSold({ channel: null }, markCtx())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(saleState({ ...facts(), ...r.patch })).toBe('unattributed')
    expect(countsAsSale({ ...facts(), ...r.patch })).toBe(true)
    expect(countsTowardTrust({ ...facts(), ...r.patch })).toBe(false)
  })

  it('a garbage channel is refused instead of silently degrading to unattributed', () => {
    expect(validateMarkSold({ channel: 'ENO' }, markCtx())).toEqual({ ok: false, reason: 'invalid_channel' })
    expect(validateMarkSold({ channel: 'zalo' }, markCtx())).toEqual({ ok: false, reason: 'invalid_channel' })
  })

  it('channel eno with no buyer is refused — never a silent unattributed sale', () => {
    expect(validateMarkSold({ channel: 'eno' }, markCtx())).toEqual({ ok: false, reason: 'no_buyer_named' })
    expect(validateMarkSold({ channel: 'eno', buyerProfileId: '   ' }, markCtx())).toEqual({ ok: false, reason: 'no_buyer_named' })
  })

  it('⚠️ a stranger cannot be named through the full entry point either, not just through canNameBuyer', () => {
    expect(validateMarkSold({ channel: 'eno', buyerProfileId: STRANGER }, markCtx())).toEqual({
      ok: false,
      reason: 'buyer_not_in_conversations',
    })
  })

  it('a non-owner is refused before any buyer or price rule runs', () => {
    expect(validateMarkSold({ channel: 'eno', buyerProfileId: STRANGER, salePrice: -5 }, markCtx({ actorProfileId: OTHER }))).toEqual({
      ok: false,
      reason: 'not_seller',
    })
  })

  it('an implausible price is refused for every channel, so no path can slip one in', () => {
    for (const channel of ['eno', 'external', null] as const) {
      expect(validateMarkSold({ channel, buyerProfileId: BUYER, salePrice: 11_200_000_000 }, markCtx())).toEqual({
        ok: false,
        reason: 'invalid_price',
      })
    }
  })

  it('omitting the price is fine — the sale still counts, guidance just learns nothing', () => {
    const r = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER }, markCtx())
    expect(r.ok && r.patch.salePrice).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────────────────────────
describe('who may CONFIRM', () => {
  const ctx = (over: Record<string, unknown> = {}) => ({ actorProfileId: BUYER, sellerProfileId: SELLER, facts: awaiting(), now: at(hours(1)), ...over }) as Parameters<typeof canRespondToSale>[0]

  it('the named buyer may, inside the window', () => {
    expect(canRespondToSale(ctx())).toEqual({ ok: true })
  })

  it('⚠️ THE SELLER CANNOT CONFIRM THEIR OWN SALE', () => {
    expect(canRespondToSale(ctx({ actorProfileId: SELLER }))).toEqual({ ok: false, reason: 'seller_cannot_confirm' })
  })

  it('⚠️ …AND STILL CANNOT WHEN THEY ARE ALSO THE NAMED BUYER — the check order is the security property', () => {
    // If `actor !== soldToProfileId` ran first, this row would sail through and mint trust
    // from a one-person trade. The seller test must come first; this test fails if it moves.
    const selfDealing = awaiting({ soldToProfileId: SELLER })
    expect(canRespondToSale(ctx({ actorProfileId: SELLER, facts: selfDealing }))).toEqual({ ok: false, reason: 'seller_cannot_confirm' })
  })

  it('a third party cannot answer for the buyer', () => {
    expect(canRespondToSale(ctx({ actorProfileId: OTHER }))).toEqual({ ok: false, reason: 'not_the_buyer' })
  })

  it('a guest cannot answer', () => {
    expect(canRespondToSale(ctx({ actorProfileId: null }))).toEqual({ ok: false, reason: 'not_the_buyer' })
  })

  it('there is nothing to answer on an unsold listing', () => {
    expect(canRespondToSale(ctx({ facts: facts() }))).toEqual({ ok: false, reason: 'not_sold' })
  })

  it('an off-platform or unattributed sale has no question to answer, and says so without naming a state', () => {
    // ⚠️ 'not_the_buyer', NOT 'no_buyer_named': there is nobody named, so nobody passes the
    // identity check, and a stranger learns nothing about how this sale ended. See the leak
    // test below — that ordering is deliberate.
    expect(canRespondToSale(ctx({ facts: facts({ status: 'sold', soldChannel: 'external', soldAt: T0 }) }))).toEqual({
      ok: false,
      reason: 'not_the_buyer',
    })
    expect(canRespondToSale(ctx({ facts: facts({ status: 'sold', soldAt: T0 }) }))).toEqual({ ok: false, reason: 'not_the_buyer' })
  })

  it('⚠️ A BYSTANDER CANNOT PROBE THE OUTCOME — every state answers identically to a stranger', () => {
    // Raised by external review: already_confirmed / already_declined used to be returned
    // BEFORE the identity check, so any signed-in user could walk listing ids and learn which
    // sales were confirmed, declined, still open or off-platform. Trust totals are public;
    // "this named buyer refused this seller" is not.
    const states = [awaiting(), awaiting({ saleConfirmedAt: T0 }), awaiting({ saleDeclinedAt: T0 }), facts({ status: 'sold', soldChannel: 'external', soldAt: T0 })]
    const answers = new Set(states.map((f) => JSON.stringify(canRespondToSale(ctx({ actorProfileId: OTHER, facts: f })))))
    expect([...answers]).toEqual([JSON.stringify({ ok: false, reason: 'not_the_buyer' })])
  })

  it('⚠️ an unresolvable seller REFUSES rather than skipping the self-confirm check', () => {
    // Reviewer-found fail-open: guarding the seller test with `sellerProfileId &&` let a row
    // whose named buyer IS the seller be confirmed whenever the caller could not resolve the
    // storefront owner. We cannot prove the actor is not the seller, so nobody answers.
    expect(canRespondToSale(ctx({ sellerProfileId: null }))).toEqual({ ok: false, reason: 'not_the_buyer' })
  })

  it('answering twice is refused in both directions', () => {
    expect(canRespondToSale(ctx({ facts: awaiting({ saleConfirmedAt: T0 }) }))).toEqual({ ok: false, reason: 'already_confirmed' })
    expect(canRespondToSale(ctx({ facts: awaiting({ saleDeclinedAt: T0 }) }))).toEqual({ ok: false, reason: 'already_declined' })
  })

  it('the window closes, and the boundary is inclusive on the last day', () => {
    expect(canRespondToSale(ctx({ now: at(days(TRADE_LOOP.CONFIRM_WINDOW_DAYS)) }))).toEqual({ ok: true })
    expect(canRespondToSale(ctx({ now: at(days(TRADE_LOOP.CONFIRM_WINDOW_DAYS) + 1) }))).toEqual({ ok: false, reason: 'confirm_window_closed' })
  })

  it('a sold row with no soldAt has no measurable window and is closed, not open forever', () => {
    expect(canRespondToSale(ctx({ facts: awaiting({ soldAt: null }) }))).toEqual({ ok: false, reason: 'confirm_window_closed' })
  })

  it('a clock that runs backwards does not reopen the window', () => {
    expect(withinConfirmWindow(T0, at(-1))).toBe(false)
  })

  it('the Yes/No patches are mutually exclusive — one answer never leaves the other stamp behind', () => {
    const yes = buyerResponsePatch('yes', T0, awaiting())
    expect({ c: yes.saleConfirmedAt, d: yes.saleDeclinedAt }).toEqual({ c: T0, d: null })
    const no = buyerResponsePatch('no', T0, awaiting())
    expect({ c: no.saleConfirmedAt, d: no.saleDeclinedAt }).toEqual({ c: null, d: T0 })
    // A "no" is recorded AGAINST THAT BUYER, so it survives any later re-attribution.
    expect(buyerHistoryEntry(no.saleBuyerHistory, BUYER)?.declinedAt).toBe(T0.getTime())
    // A "yes" leaves the history alone rather than forgiving an earlier decliner.
    const priorDecline = serializeBuyerHistory([{ id: OTHER, askedAt: 1, declinedAt: 2 }])
    expect(buyerResponsePatch('yes', T0, awaiting({ saleBuyerHistory: priorDecline })).saleBuyerHistory).toBe(priorDecline)
  })
})

// ──────────────────────────────────────────────────────────────────────────────────
describe('re-prompting — bounded by arithmetic, not by a counter', () => {
  it('an unprompted awaiting sale gets its first ask', () => {
    expect(nextConfirmPrompt(awaiting({ saleConfirmPromptedAt: null }), T0)).toEqual({ send: true, reason: 'first_prompt' })
  })

  it('inside the cooldown it stays quiet; the moment it lapses it re-asks', () => {
    const cd = TRADE_LOOP.PROMPT_COOLDOWN_HOURS
    expect(nextConfirmPrompt(awaiting(), at(hours(cd) - 1))).toEqual({ send: false, reason: 'cooldown' })
    expect(nextConfirmPrompt(awaiting(), at(hours(cd)))).toEqual({ send: true, reason: 're_prompt' })
  })

  it('past the window it never asks again, however long ago the last ask was', () => {
    const old = awaiting({ saleConfirmPromptedAt: T0 })
    expect(nextConfirmPrompt(old, at(days(TRADE_LOOP.CONFIRM_WINDOW_DAYS) + 1))).toEqual({ send: false, reason: 'window_closed' })
    expect(nextConfirmPrompt(old, at(days(365)))).toEqual({ send: false, reason: 'window_closed' })
  })

  it('⚠️ A DECLINE IS TERMINAL-ISH: it silences the prompt permanently, at every later instant', () => {
    const declined = awaiting({ saleDeclinedAt: at(hours(1)) })
    for (const t of [hours(2), days(1), days(6), days(11), days(13), days(200)]) {
      expect(nextConfirmPrompt(declined, at(t))).toEqual({ send: false, reason: 'not_awaiting' })
    }
  })

  it('a confirmation also stops the prompt — nobody is nagged after answering yes', () => {
    expect(nextConfirmPrompt(awaiting({ saleConfirmedAt: at(hours(1)) }), at(days(6)))).toEqual({ send: false, reason: 'not_awaiting' })
  })

  it('off-platform and unattributed sales are never prompted', () => {
    expect(nextConfirmPrompt(facts({ status: 'sold', soldChannel: 'external', soldAt: T0 }), at(days(1)))).toEqual({ send: false, reason: 'not_awaiting' })
    expect(nextConfirmPrompt(facts({ status: 'sold', soldAt: T0 }), at(days(1)))).toEqual({ send: false, reason: 'not_awaiting' })
  })

  it('a sold row with no soldAt is reported as such rather than treated as brand new', () => {
    expect(nextConfirmPrompt(awaiting({ soldAt: null, saleConfirmPromptedAt: null }), T0)).toEqual({ send: false, reason: 'no_sale_time' })
  })

  it('⚠️ MEASURED, NOT ASSUMED: simulating the sweep hourly for a year yields exactly THREE asks', () => {
    // This is the "cannot nag forever" proof the schema comment claims, executed rather
    // than argued. A silent buyer is asked at t=0, t=5d and t=10d, and never again.
    let f = awaiting({ saleConfirmPromptedAt: null })
    const sentAt: number[] = []
    for (let h = 0; h <= 24 * 365; h++) {
      const now = at(hours(h))
      const d = nextConfirmPrompt(f, now)
      if (d.send) {
        sentAt.push(h)
        f = { ...f, saleConfirmPromptedAt: now }
      }
    }
    expect(sentAt).toEqual([0, 120, 240])
    expect(sentAt.length).toBe(3)
  })

  it('⚠️ A SELLER CANNOT RE-MARK IN A LOOP TO RE-NOTIFY A SILENT BUYER', () => {
    // Without the same-buyer clock preservation, each re-mark stamps saleConfirmPromptedAt =
    // now, which is a fresh notification and a complete bypass of the cooldown above. Here the
    // seller re-marks every hour for a fortnight; the buyer is still asked exactly 3 times.
    let f = awaiting({ saleConfirmPromptedAt: null })
    const sentAt: number[] = []
    for (let h = 0; h <= 24 * 20; h++) {
      const now = at(hours(h))
      const d = nextConfirmPrompt(f, now)
      if (d.send) {
        sentAt.push(h)
        f = { ...f, saleConfirmPromptedAt: now }
      }
      // the seller taps Mark-sold on the same buyer again
      const r = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 11_200_000 }, markCtx({ facts: f, now }))
      expect(r.ok).toBe(true)
      if (r.ok) f = { ...f, ...r.patch }
    }
    expect(sentAt).toEqual([0, 120, 240])
  })

  it('⚠️ NOR BY LEAVING THE eno CHANNEL AND COMING BACK — 300 days of toggling, ZERO extra asks', () => {
    // The strongest version of the harassment vector, and the one that survived the first fix:
    // `sameBuyer` required soldChannel === 'eno', so mark-external-then-mark-the-buyer-again
    // restamped BOTH clocks. Measured against that draft: 300 notifications over 300 days,
    // against a documented maximum of three. The per-buyer history is what closes it.
    let f: SaleFacts = awaiting({ saleBuyerHistory: serializeBuyerHistory([{ id: BUYER, askedAt: T0.getTime(), askedPrice: 11_200_000 }]) })
    const asked: number[] = []
    for (let d = 1; d <= 300; d++) {
      const now = at(days(d))
      const away = validateMarkSold({ channel: 'external' }, markCtx({ facts: f, now }))
      if (away.ok) f = { ...f, ...away.patch }
      const back = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 11_200_000 }, markCtx({ facts: f, now }))
      expect(back.ok).toBe(true)
      if (!back.ok) return
      if (back.patch.saleConfirmPromptedAt?.getTime() === now.getTime()) asked.push(d)
      f = { ...f, ...back.patch }
    }
    expect(asked).toEqual([])
    // ⚠️ Assert the ANCHOR, not soldAt. `soldAt` legitimately moves with each real mark-sold
    // (it answers "when did this sell" for the sold-date copy, recency and the sweep); the
    // confirm window is a separate, immovable fact and that separation is the fix.
    expect(confirmWindowAnchor(f)).toEqual(T0)
    expect(withinConfirmWindow(confirmWindowAnchor(f), at(days(300)))).toBe(false)
  })

  it('⚠️ …and a buyer who declines after the first ask is asked ONCE, not three times', () => {
    let f = awaiting({ saleConfirmPromptedAt: null })
    const sentAt: number[] = []
    for (let h = 0; h <= 24 * 365; h++) {
      const now = at(hours(h))
      const d = nextConfirmPrompt(f, now)
      if (d.send) {
        sentAt.push(h)
        f = { ...f, saleConfirmPromptedAt: now }
      }
      if (h === 1) f = { ...f, ...buyerResponsePatch('no', now, f) } // they tapped No
    }
    expect(sentAt).toEqual([0])
  })
})

// ──────────────────────────────────────────────────────────────────────────────────
describe('a decline is terminal-ISH — the seller may correct a mis-pick, but not launder a No', () => {
  const declined = awaiting({ saleDeclinedAt: at(hours(1)), saleBuyerHistory: serializeBuyerHistory([{ id: BUYER, askedAt: T0.getTime(), declinedAt: at(hours(1)).getTime() }]) })

  it('⚠️ RE-NAMING THE SAME BUYER IS REFUSED — otherwise "No" just restarts the notification', () => {
    expect(validateMarkSold({ channel: 'eno', buyerProfileId: BUYER }, markCtx({ facts: declined }))).toEqual({
      ok: false,
      reason: 'buyer_declined',
    })
  })

  it('⚠️ …AND CANNOT BE LAUNDERED IN TWO TAPS: external, then straight back to the same buyer', () => {
    // Found by external review of the first draft and MEASURED before fixing: the intermediate
    // write blanked saleDeclinedAt, the "you already said no" check then saw nothing, and the
    // buyer landed back in awaiting_buyer with a fresh 14-day window and three fresh
    // notifications — repeatable forever. The durable saleDeclinedByProfileId is what closes it.
    const step1 = validateMarkSold({ channel: 'external', platform: 'Facebook' }, markCtx({ facts: declined, now: at(hours(2)) }))
    expect(step1.ok).toBe(true)
    if (!step1.ok) return
    expect(step1.patch.saleDeclinedAt).toBeNull() // the stamp really is cleared…
    expect(buyerHistoryEntry(step1.patch.saleBuyerHistory, BUYER)?.declinedAt).toBeDefined() // …but the memory is not

    const step2 = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER }, markCtx({ facts: { ...declined, ...step1.patch }, now: at(hours(3)) }))
    expect(step2).toEqual({ ok: false, reason: 'buyer_declined' })
  })

  it('⚠️ …nor in three taps, nor via the unattributed channel, nor after any number of rounds', () => {
    let f: SaleFacts = declined
    for (const channel of ['external', null, 'external', null] as const) {
      const r = validateMarkSold({ channel }, markCtx({ facts: f, now: at(hours(2)) }))
      expect(r.ok).toBe(true)
      if (!r.ok) return
      f = { ...f, ...r.patch }
      expect(validateMarkSold({ channel: 'eno', buyerProfileId: BUYER }, markCtx({ facts: f, now: at(hours(3)) }))).toEqual({
        ok: false,
        reason: 'buyer_declined',
      })
    }
  })

  it('⚠️ A SECOND DECLINER DOES NOT ERASE THE FIRST — the memory is per buyer, not one slot', () => {
    // Reviewer-found: with a single "who declined" column, A declines → seller attributes to B
    // → B declines → B overwrites A → A is nameable again with a fresh window. One accomplice
    // tap defeated the whole rule. Measured against that draft before this test existed.
    let f: SaleFacts = awaiting()
    f = { ...f, ...buyerResponsePatch('no', at(hours(1)), f) } // BUYER says no
    const toOther = validateMarkSold({ channel: 'eno', buyerProfileId: OTHER }, markCtx({ facts: f, now: at(hours(2)) }))
    expect(toOther.ok).toBe(true)
    if (!toOther.ok) return
    f = { ...f, ...toOther.patch }
    f = { ...f, ...buyerResponsePatch('no', at(hours(3)), f) } // OTHER says no too

    expect(validateMarkSold({ channel: 'eno', buyerProfileId: BUYER }, markCtx({ facts: f, now: at(hours(4)) }))).toEqual({ ok: false, reason: 'buyer_declined' })
    expect(validateMarkSold({ channel: 'eno', buyerProfileId: OTHER }, markCtx({ facts: f, now: at(hours(4)) }))).toEqual({ ok: false, reason: 'buyer_declined' })
  })

  it('the memory is checked even when the CURRENT attribution is someone else entirely', () => {
    // A declined B, seller then sold to C. Naming A again is still refused.
      const soldToOther = { ...declined, soldToProfileId: OTHER, saleDeclinedAt: null }
    expect(validateMarkSold({ channel: 'eno', buyerProfileId: BUYER }, markCtx({ facts: soldToOther, now: at(hours(4)) }))).toEqual({
      ok: false,
      reason: 'buyer_declined',
    })
  })

  it('naming a DIFFERENT buyer is allowed — the seller picked the wrong person from the list', () => {
    const r = validateMarkSold({ channel: 'eno', buyerProfileId: OTHER }, markCtx({ facts: declined, now: at(hours(2)) }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.patch.soldToProfileId).toBe(OTHER)
    // ⚠️ The old answer must NOT ride along: it belonged to a different person.
    expect(r.patch.saleDeclinedAt).toBeNull()
    expect(r.patch.saleConfirmedAt).toBeNull()
    expect(saleState({ ...declined, ...r.patch })).toBe('awaiting_buyer')
  })

  it('re-attributing to external after a decline is allowed and asks nobody new', () => {
    const r = validateMarkSold({ channel: 'external', platform: 'Facebook' }, markCtx({ facts: declined, now: at(hours(2)) }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.patch.saleDeclinedAt).toBeNull()
    expect(saleState({ ...declined, ...r.patch })).toBe('off_platform') // nobody is being asked
    // ⚠️ The prompt clock is CARRIED, not cleared: nulling it here made a later return to the
    // buyer look like a first ask and defeated the cooldown entirely (336 asks in a year).
    expect(r.patch.saleConfirmPromptedAt).toEqual(declined.saleConfirmPromptedAt)
    expect(nextConfirmPrompt({ ...declined, ...r.patch }, at(days(1)))).toEqual({ send: false, reason: 'not_awaiting' })
  })

  it('a re-attribution restarts the confirm window from the new sale time', () => {
    const late = at(days(20)) // the original window had long closed
    const r = validateMarkSold({ channel: 'eno', buyerProfileId: OTHER }, markCtx({ facts: declined, now: late }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const next = { ...declined, ...r.patch }
    expect(canRespondToSale({ actorProfileId: OTHER, sellerProfileId: SELLER, facts: next, now: at(days(21)) })).toEqual({ ok: true })
  })

  it('⚠️ A CONFIRMED SALE CANNOT BE RE-MARKED — that would be a one-tap way to erase a review', () => {
    // Every patch clears saleConfirmedAt, so without this guard a seller could void the
    // buyer's confirmation (and with it the review prompt it unlocks) by tapping Mark-sold
    // again. Reviewers flagged the price edit, the buyer swap and the channel swap; all three
    // are refused.
    const confirmed = awaiting({ saleConfirmedAt: at(hours(2)) })
    const ctxc = (over = {}) => markCtx({ facts: confirmed, now: at(hours(3)), ...over })
    expect(validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 1_000_000 }, ctxc())).toEqual({ ok: false, reason: 'already_confirmed' })
    expect(validateMarkSold({ channel: 'eno', buyerProfileId: OTHER, salePrice: 11_200_000 }, ctxc())).toEqual({ ok: false, reason: 'already_confirmed' })
    expect(validateMarkSold({ channel: 'external', platform: 'Facebook' }, ctxc())).toEqual({ ok: false, reason: 'already_confirmed' })
    expect(validateMarkSold({ channel: null }, ctxc())).toEqual({ ok: false, reason: 'already_confirmed' })
    // …so the confirmation, the trust credit and the review prompt all survive the attempt.
    expect(countsTowardTrust(confirmed)).toBe(true)
    expect(canPromptReview(confirmed, BUYER, SELLER)).toEqual({ ok: true })
  })

  it('…but an EXACT no-op re-tap is idempotent, not punished', () => {
    // A seller double-tapping Mark-sold with the same buyer and the same price changed
    // nothing, and must not destroy a confirmation or fire a second notification.
    const confirmed = awaiting({ saleConfirmedAt: at(hours(2)) })
    const r = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 11_200_000 }, markCtx({ facts: confirmed, now: at(hours(9)) }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.patch.saleConfirmedAt).toEqual(at(hours(2)))
    expect(r.patch.saleConfirmPromptedAt).toEqual(T0) // no new ask
    expect(r.patch.soldAt).toEqual(T0) // no new window
    expect(countsTowardTrust({ ...confirmed, ...r.patch })).toBe(true)
  })

  it('⚠️ A PRICE CHANGE RE-ASKS AT ONCE, AND IS REFUSED ONCE THE BUDGET IS SPENT', () => {
    // The rule both external reviewers converged on. The seller's number and the buyer's
    // question must never diverge: gating the correction on the REMINDER cooldown updated
    // `salePrice` while the recorded question kept the old figure, leaving a prompt the buyer
    // could see and never successfully answer. So a correction asks immediately — and is
    // BUDGETED rather than throttled, which is what keeps the instant re-ask from being a lever.
    let f: SaleFacts = awaiting({ salePrice: 1_000_000, saleBuyerHistory: serializeBuyerHistory([{ id: BUYER, askedAt: T0.getTime(), askedPrice: 1_000_000, asks: 1 }]) })
    const first = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 2_000_000 }, markCtx({ facts: f, now: at(hours(1)) }))
    expect(first.ok).toBe(true)
    if (!first.ok) return
    f = { ...f, ...first.patch }
    expect(f.saleConfirmPromptedAt).toEqual(at(hours(1))) // asked at once…
    expect(confirmPromptPrice(f)).toBe(2_000_000) // …and the two numbers agree
    expect(f.salePrice).toBe(2_000_000)

    const second = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 3_000_000 }, markCtx({ facts: f, now: at(hours(2)) }))
    expect(second.ok).toBe(true)
    if (!second.ok) return
    f = { ...f, ...second.patch }

    // Budget spent → the edit is REFUSED rather than silently diverging.
    expect(validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 4_000_000 }, markCtx({ facts: f, now: at(hours(3)) }))).toEqual({
      ok: false,
      reason: 'ask_budget_exhausted',
    })
    // …and the refusal leaves a coherent, answerable question behind.
    expect(confirmPromptPrice(f)).toBe(3_000_000)
    expect(canRespondToSale({ actorProfileId: BUYER, sellerProfileId: SELLER, facts: f, now: at(hours(4)) })).toEqual({ ok: true })
  })

})

// ──────────────────────────────────────────────────────────────────────────────────
describe('what a sale may and may not count toward', () => {
  it('⚠️ AN OFF-PLATFORM SALE NEVER REACHES TRUST — but it IS a sale', () => {
    const ext = facts({ status: 'sold', soldChannel: 'external', soldAt: T0, salePrice: 9_000_000 })
    expect(countsAsSale(ext)).toBe(true) // the listing is gone from the market
    expect(countsTowardTrust(ext)).toBe(false) // there is no second party to ask
    expect(salePriceForGuidance(ext)).toBeNull() // …and no confirmed number to learn from
    // Not "not yet": no passage of time and no stamp short of a buyer's answer changes it.
    expect(countsTowardTrust({ ...ext, saleConfirmPromptedAt: T0 })).toBe(false)
  })

  it('an unattributed sale (partner sync, MCP, the daily review tick-off) also never reaches trust', () => {
    const plain = facts({ status: 'sold', soldAt: T0, salePrice: 9_000_000 })
    expect(countsAsSale(plain)).toBe(true)
    expect(countsTowardTrust(plain)).toBe(false)
    expect(salePriceForGuidance(plain)).toBeNull()
  })

  it("the seller's claim alone is not a trade — an unanswered prompt counts for nothing", () => {
    expect(countsTowardTrust(awaiting())).toBe(false)
    expect(salePriceForGuidance(awaiting())).toBeNull()
  })

  it('only a buyer-confirmed eno sale counts, and only then does its price reach guidance', () => {
    const done = awaiting({ saleConfirmedAt: at(hours(2)) })
    expect(countsTowardTrust(done)).toBe(true)
    expect(salePriceForGuidance(done)).toBe(11_200_000)
  })

  it('a confirmed sale with no price given counts for trust but teaches guidance nothing', () => {
    const done = awaiting({ saleConfirmedAt: at(hours(2)), salePrice: null })
    expect(countsTowardTrust(done)).toBe(true)
    expect(salePriceForGuidance(done)).toBeNull()
  })

  it('a nonsense price that reached the column anyway is ignored by guidance', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(salePriceForGuidance(awaiting({ saleConfirmedAt: at(hours(2)), salePrice: bad }))).toBeNull()
    }
  })

  it('a declined sale counts for nothing but is still a sale (the item is gone)', () => {
    const no = awaiting({ saleDeclinedAt: at(hours(2)) })
    expect(countsAsSale(no)).toBe(true)
    expect(countsTowardTrust(no)).toBe(false)
    expect(salePriceForGuidance(no)).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────────────────────────
describe('the review prompt appears only after BOTH sides have spoken', () => {
  const confirmed = awaiting({ saleConfirmedAt: at(hours(2)) })

  it('both counterparties see it once the sale is confirmed', () => {
    expect(canPromptReview(confirmed, BUYER, SELLER)).toEqual({ ok: true })
    expect(canPromptReview(confirmed, SELLER, SELLER)).toEqual({ ok: true })
  })

  it('⚠️ NOT while the buyer has only been asked — this is the rule the old flow got wrong', () => {
    // Today a review is allowed whenever listing.status === "sold" (one person's word).
    expect(canPromptReview(awaiting(), BUYER, SELLER)).toEqual({ ok: false, reason: 'not_confirmed' })
  })

  it('never for a declined, off-platform or unattributed sale', () => {
    // The named buyer of a declined sale is a counterparty, so they get the real reason…
    expect(canPromptReview(awaiting({ saleDeclinedAt: T0 }), BUYER, SELLER)).toEqual({ ok: false, reason: 'not_confirmed' })
    // …while off-platform / unattributed sales name nobody, so BUYER is just a bystander there
    // and learns nothing about the outcome (identity is checked before confirmation).
    expect(canPromptReview(facts({ status: 'sold', soldChannel: 'external', soldAt: T0 }), BUYER, SELLER)).toEqual({ ok: false, reason: 'not_the_buyer' })
    expect(canPromptReview(facts({ status: 'sold', soldAt: T0 }), BUYER, SELLER)).toEqual({ ok: false, reason: 'not_the_buyer' })
    // The SELLER is a counterparty on every one of them and still never gets a review prompt.
    expect(canPromptReview(facts({ status: 'sold', soldChannel: 'external', soldAt: T0 }), SELLER, SELLER)).toEqual({ ok: false, reason: 'not_confirmed' })
  })

  it('⚠️ A BYSTANDER CANNOT PROBE CONFIRMATION HERE EITHER — one answer for every state', () => {
    // Reviewer-found on the second pass: testing confirmation BEFORE identity made the reason
    // pair a probe — not_confirmed for an awaiting/declined sale, not_the_buyer for a confirmed
    // one — so anyone with a listing id could enumerate per-sale outcomes.
    const states = [awaiting(), awaiting({ saleConfirmedAt: T0 }), awaiting({ saleDeclinedAt: T0 }), facts({ status: 'sold', soldChannel: 'external', soldAt: T0 })]
    const answers = new Set(states.map((f) => JSON.stringify(canPromptReview(f, OTHER, SELLER))))
    expect([...answers]).toEqual([JSON.stringify({ ok: false, reason: 'not_the_buyer' })])
  })

  it('a bystander and a guest never see it, confirmed or not', () => {
    expect(canPromptReview(confirmed, OTHER, SELLER)).toEqual({ ok: false, reason: 'not_the_buyer' })
    expect(canPromptReview(confirmed, null, SELLER)).toEqual({ ok: false, reason: 'not_the_buyer' })
  })

  it('⚠️ an unresolvable seller does not turn every viewer into the seller', () => {
    expect(canPromptReview(confirmed, OTHER, null)).toEqual({ ok: false, reason: 'not_the_buyer' })
    expect(canPromptReview(confirmed, BUYER, null)).toEqual({ ok: true }) // the buyer is still the buyer
  })
})

// ──────────────────────────────────────────────────────────────────────────────────
describe('the buyer history blob — a malformed row must not invent consent or forget a No', () => {
  it('round-trips', () => {
    const entries = [
      { id: BUYER, askedAt: 1_700_000_000_000, askedPrice: 11_200_000 },
      { id: OTHER, askedAt: 1_700_000_001_000, askedPrice: null, declinedAt: 1_700_000_002_000 },
    ]
    expect(parseBuyerHistory(serializeBuyerHistory(entries))).toEqual(entries)
  })

  it('an empty history serializes to null rather than "[]" — a null column is the absent state', () => {
    expect(serializeBuyerHistory([])).toBeNull()
    expect(parseBuyerHistory(null)).toEqual([])
  })

  it('garbage parses to an empty history instead of throwing, in every shape', () => {
    for (const bad of ['', 'not json', '{}', '"a string"', '42', 'null', '[1,2,3]', '[{"a":1}]', '[{"i":"x"}]', '[null]']) {
      expect(parseBuyerHistory(bad)).toEqual([])
    }
  })

  it('⚠️ the fail-safe direction is FORGETFUL, not inventive — a corrupt blob never fakes an ask', () => {
    // A malformed row loses declines (annoys a seller who must re-ask) rather than materialising
    // entries (which would silently bar real buyers, or worse, look like consent).
    expect(parseBuyerHistory('[{"i":"someone","a":"not-a-number"}]')).toEqual([])
    expect(parseBuyerHistory('[{"i":"","a":1}]')).toEqual([])
    // …and a half-valid array keeps only the entries that are actually complete.
    expect(parseBuyerHistory('[{"i":"ok","a":5},{"a":9}]')).toEqual([{ id: 'ok', askedAt: 5 }])
  })

  it('is bounded, so one listing row cannot grow without limit', () => {
    const many = Array.from({ length: MAX_BUYER_HISTORY + 20 }, (_, i) => ({ id: `b${i}`, askedAt: i }))
    expect(parseBuyerHistory(serializeBuyerHistory(many))).toHaveLength(MAX_BUYER_HISTORY)
  })

  it('⚠️ the bound keeps the NEWEST entries — dropping recent declines would re-open the prompt', () => {
    const many = Array.from({ length: MAX_BUYER_HISTORY + 5 }, (_, i) => ({ id: `b${i}`, askedAt: i }))
    const kept = parseBuyerHistory(serializeBuyerHistory(many))
    expect(kept.at(-1)?.id).toBe(`b${MAX_BUYER_HISTORY + 4}`)
  })
})

// ──────────────────────────────────────────────────────────────────────────────────
describe('the bounds that three rounds of review kept breaking', () => {
  it('⚠️ THE FULL WORST CASE — hourly, price flipping AND channel round-tripping, for a year', () => {
    // The composite. Each ingredient defeated an earlier draft on its own; the last only showed
    // up combined (the external branch NULLED the prompt clock, so every return looked like a
    // first ask). Sample at the attacker's rate and vary every axis at once, or a bound like this
    // reads as proven when it is not.
    let f: SaleFacts = awaiting({ saleBuyerHistory: serializeBuyerHistory([{ id: BUYER, askedAt: T0.getTime(), askedPrice: 11_200_000, asks: 1 }]) })
    const asked: number[] = []
    for (let h = 1; h <= 24 * 365; h++) {
      const now = at(hours(h))
      const away = validateMarkSold({ channel: 'external' }, markCtx({ facts: f, now }))
      if (away.ok) f = { ...f, ...away.patch }
      const r = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 11_200_000 + (h % 3) }, markCtx({ facts: f, now }))
      if (r.ok) {
        if (r.patch.saleConfirmPromptedAt?.getTime() === now.getTime()) asked.push(h)
        f = { ...f, ...r.patch }
      }
      expect(r.ok || r.reason === 'ask_budget_exhausted').toBe(true)
    }
    // 8760 hostile mark-solds buy at most the documented budget, and this buyer's window anchor
    // never moved. (Assert the ANCHOR IN THE HISTORY, not confirmWindowAnchor(f): the loop ends
    // on an external mark, where there is no named buyer and the helper correctly falls back to
    // soldAt — which is the off-platform sale's own date, not anybody's confirm window.)
    expect(asked.length).toBeLessThanOrEqual(TRADE_LOOP.MAX_MARK_SOLD_ASKS)
    expect(buyerHistoryEntry(f.saleBuyerHistory, BUYER)?.askedAt).toBe(T0.getTime())
  })

  it('⚠️ HOURLY PRICE FLIPS FOR 14 DAYS — the seller-driven path has its own hard budget', () => {
    // Measured against the draft that restamped on every changed price: 336 notifications, all
    // bypassing the cooldown because only nextConfirmPrompt consulted it. The earlier "worst
    // case" test sampled once a DAY, which is why it reported 14 and read as a proof.
    let f: SaleFacts = awaiting({ saleBuyerHistory: serializeBuyerHistory([{ id: BUYER, askedAt: T0.getTime(), askedPrice: 11_200_000, asks: 1 }]) })
    const asked: number[] = []
    for (let h = 1; h <= 24 * 14; h++) {
      const now = at(hours(h))
      const r = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 11_200_000 + (h % 2) }, markCtx({ facts: f, now }))
      if (r.ok) {
        if (r.patch.saleConfirmPromptedAt?.getTime() === now.getTime()) asked.push(h)
        f = { ...f, ...r.patch }
      }
    }
    expect(asked.length).toBeLessThanOrEqual(TRADE_LOOP.MAX_MARK_SOLD_ASKS)
    expect(confirmWindowAnchor(f)).toEqual(T0)
  })

  it('⚠️ A DECLINE SURVIVES 60 LATER BUYERS — the cap must not evict the fact it exists to keep', () => {
    // Measured against the draft that did a plain slice(-50): naming fifty more buyers pushed
    // the decliner off the front and canNameBuyer returned ok — a fresh window and fresh prompts
    // for the person who had already said no.
    const declinedFirst = { id: BUYER, askedAt: 1, askedPrice: 1, declinedAt: 2 }
    const crowd = Array.from({ length: 60 }, (_, i) => ({ id: `filler-${i}`, askedAt: 10 + i, askedPrice: 1 }))
    const blob = serializeBuyerHistory([declinedFirst, ...crowd])
    expect(parseBuyerHistory(blob)).toHaveLength(MAX_BUYER_HISTORY)
    expect(buyerHistoryEntry(blob, BUYER)?.declinedAt).toBe(2)
    expect(canNameBuyer(BUYER, { sellerProfileId: SELLER, conversationBuyerProfileIds: [BUYER], facts: awaiting({ saleBuyerHistory: blob }) })).toEqual({
      ok: false,
      reason: 'buyer_declined',
    })
  })

  it('⚠️ A LEGACY ROW (sold before the history column) does not extend its own window', () => {
    // Reviewer-found: the new entry stamped askedAt = now instead of the original sale time, so
    // a re-mark on day 13 moved the anchor to day 13 and the buyer stayed promptable to day 27.
    const legacy = awaiting({ saleBuyerHistory: null }) // sold at T0, no history
    const r = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 9_000_000 }, markCtx({ facts: legacy, now: at(days(13)) }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const next = { ...legacy, ...r.patch }
    expect(confirmWindowAnchor(next)).toEqual(T0) // anchored to the ORIGINAL sale, not the re-mark
    expect(canRespondToSale({ actorProfileId: BUYER, sellerProfileId: SELLER, facts: next, now: at(days(20)) })).toEqual({
      ok: false,
      reason: 'confirm_window_closed',
    })
  })

  it('⚠️ A TAKEDOWN AFTER THE SALE STOPS THE LOOP — no trust, no price, no answer, no review', () => {
    // canMarkSold refuses to mark a pulled listing sold, but an item can be sold and taken down
    // LATER. Without this the buyer could still answer the pending prompt and mint trust and a
    // guidance price for goods the platform was ordered to remove.
    const pulled = awaiting({ complianceStatus: 'taken_down' })
    expect(canRespondToSale({ actorProfileId: BUYER, sellerProfileId: SELLER, facts: pulled, now: at(hours(1)) })).toEqual({
      ok: false,
      reason: 'listing_unavailable',
    })
    const confirmedThenPulled = awaiting({ complianceStatus: 'taken_down', saleConfirmedAt: at(hours(1)) })
    expect(countsTowardTrust(confirmedThenPulled)).toBe(false)
    expect(salePriceForGuidance(confirmedThenPulled)).toBeNull()
    expect(canPromptReview(confirmedThenPulled, BUYER, SELLER)).toEqual({ ok: false, reason: 'not_confirmed' })
    // …and an ordinary compliance state changes nothing.
    expect(countsTowardTrust(awaiting({ complianceStatus: 'under_review', saleConfirmedAt: at(hours(1)) }))).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────────────────────
describe('round four — the sequences the earlier tests never chained', () => {
  it('⚠️ THE COLUMN AND THE QUESTION CAN NEVER DIVERGE — no visible-but-unanswerable prompt', () => {
    // The trap both reviewers found, stated as an invariant and swept over every reachable
    // sequence: after ANY accepted mark-sold, the price the buyer is shown IS the price stored.
    // (An earlier draft recorded the ask without sending it, and the pair drifted apart.)
    let f: SaleFacts = awaiting({ salePrice: 1_000_000, saleBuyerHistory: serializeBuyerHistory([{ id: BUYER, askedAt: T0.getTime(), askedPrice: 1_000_000, asks: 1 }]) })
    for (let h = 1; h <= 200; h++) {
      const r = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 1_000_000 + (h % 4) }, markCtx({ facts: f, now: at(hours(h)) }))
      if (!r.ok) {
        expect(r.reason).toBe('ask_budget_exhausted')
        continue
      }
      f = { ...f, ...r.patch }
      expect(confirmPromptPrice(f)).toBe(f.salePrice)
    }
  })

  it('⚠️ …and until they are re-asked, the question is still the OLD number', () => {
    // What the notification says, what the conditional write must bind, and what guidance may
    // learn are all "the price the buyer was shown" — never the current column.
    const f = awaiting({ salePrice: 20_000_000, saleBuyerHistory: serializeBuyerHistory([{ id: BUYER, askedAt: T0.getTime(), askedPrice: 100_000 }]) })
    expect(confirmPromptPrice(f)).toBe(100_000)
    expect(salePriceForGuidance({ ...f, saleConfirmedAt: at(hours(1)) })).toBe(100_000)
  })

  it('⚠️ THE CAP SURVIVES 50 DECLINES — slice(-0) is the whole array, so the bound had a hole', () => {
    // Measured in node: [1,2,3].slice(-0) → [1,2,3]. With 50 declines the remaining-capacity
    // expression hit exactly -0, so every later buyer was appended forever — unbounded growth
    // of a TEXT column on a table every feed query reads.
    const declines = Array.from({ length: MAX_BUYER_HISTORY }, (_, i) => ({ id: `d${i}`, askedAt: i, askedPrice: 1, declinedAt: i + 1 }))
    const asked = Array.from({ length: 500 }, (_, i) => ({ id: `a${i}`, askedAt: 1000 + i, askedPrice: 1 }))
    const blob = serializeBuyerHistory([...declines, ...asked])
    expect(parseBuyerHistory(blob)).toHaveLength(MAX_BUYER_HISTORY)
    // …it is the DECLINES that survive, not the newcomers…
    expect(parseBuyerHistory(blob).filter((e) => e.declinedAt !== undefined)).toHaveLength(MAX_BUYER_HISTORY - 1)
    // …⚠️ …but ONE slot is reserved for the asked side, and it holds the buyer named LAST.
    // Without that reservation every asked entry was dropped, `prior` came back undefined for
    // the current buyer, the window anchor fell back to a restamped soldAt and `asks` reset to
    // zero — the 336-asks vector, re-opened by the very cap meant to be a safety bound.
    expect(buyerHistoryEntry(blob, 'a499')).toBeDefined()
  })

  it('⚠️ a taken-down listing is not distinguishable by a stranger either', () => {
    const states = [awaiting(), awaiting({ complianceStatus: 'taken_down' }), awaiting({ saleConfirmedAt: T0 }), awaiting({ saleDeclinedAt: T0 })]
    const answers = new Set(states.map((f) => JSON.stringify(canRespondToSale({ actorProfileId: OTHER, sellerProfileId: SELLER, facts: f, now: at(hours(1)) }))))
    expect([...answers]).toEqual([JSON.stringify({ ok: false, reason: 'not_the_buyer' })])
  })

  it('⚠️ validateMarkSold refuses a taken-down listing even when only `facts` carries the status', () => {
    // canMarkSold reads an OPTIONAL top-level complianceStatus; a caller that passes the listing
    // row as `facts` and does not duplicate the field used to sail straight past the check.
    const pulled = markCtx({ facts: facts({ complianceStatus: 'taken_down' }) })
    expect(validateMarkSold({ channel: 'eno', buyerProfileId: BUYER }, pulled)).toEqual({ ok: false, reason: 'listing_unavailable' })
    expect(validateMarkSold({ channel: 'external' }, pulled)).toEqual({ ok: false, reason: 'listing_unavailable' })
  })

  it('a whitespace-only price field means "the seller did not say", not a bad number', () => {
    expect(normalizeSalePrice('   ', 12_000_000)).toBeNull()
    expect(normalizeSalePrice(' 11200000 ', 12_000_000)).toBe(11_200_000)
  })
})

// ──────────────────────────────────────────────────────────────────────────────────
describe('round five — the rule must hold at EVERY entry point, not most of them', () => {
  it('⚠️ THE SWEEP HONOURS A TAKEDOWN TOO — otherwise it nudges toward a refusal', () => {
    // canRespondToSale refused these from round four, but nextConfirmPrompt did not, so the cron
    // would send up to three reminders and every tap would be met with listing_unavailable.
    const pulled = awaiting({ complianceStatus: 'taken_down', saleConfirmPromptedAt: T0 })
    expect(nextConfirmPrompt(pulled, at(hours(TRADE_LOOP.PROMPT_COOLDOWN_HOURS)))).toEqual({ send: false, reason: 'not_awaiting' })
    expect(nextConfirmPrompt(awaiting({ complianceStatus: 'taken_down', saleConfirmPromptedAt: null }), T0)).toEqual({ send: false, reason: 'not_awaiting' })
    // …and an ordinary compliance state is untouched.
    expect(nextConfirmPrompt(awaiting({ saleConfirmPromptedAt: null }), T0)).toEqual({ send: true, reason: 'first_prompt' })
  })

  it('⚠️ a stale decline stamp cannot label a sale that has no counterparty', () => {
    // saleDeclinedAt describes the CURRENT attribution; a row where that attribution is gone
    // must not read as "declined", or an unattributed sale inherits somebody else's refusal.
    const stale = facts({ status: 'sold', soldAt: T0, saleDeclinedAt: T0 })
    expect(saleState(stale)).toBe('unattributed')
    expect(saleState({ ...stale, soldChannel: 'external' })).toBe('off_platform')
    // A real decline still reads as one.
    expect(saleState(awaiting({ saleDeclinedAt: T0 }))).toBe('declined')
  })

  it('⚠️ a CORRUPT history still cannot re-prompt the person who just said no', () => {
    // parseBuyerHistory fails safe to empty, which forgets declines — deliberately, so a bad
    // row annoys a seller rather than re-prompting a buyer. The scalar stamp is the second
    // signal that keeps the CURRENT decliner protected even then.
    const corrupt = awaiting({ saleDeclinedAt: at(hours(1)), saleBuyerHistory: '{{{not json' })
    expect(parseBuyerHistory(corrupt.saleBuyerHistory)).toEqual([])
    expect(validateMarkSold({ channel: 'eno', buyerProfileId: BUYER }, markCtx({ facts: corrupt, now: at(hours(2)) }))).toEqual({
      ok: false,
      reason: 'buyer_declined',
    })
  })
})

// ──────────────────────────────────────────────────────────────────────────────────
describe('round six — the last two fail-opens', () => {
  it('⚠️ THE BUYER NAMED LAST SURVIVES THE CAP, so their window and ask count survive with them', () => {
    // End-to-end version of the reserved slot: fill the cap with declines, then run the real
    // transition and confirm the budget still applies on the next call.
    const declines = Array.from({ length: MAX_BUYER_HISTORY }, (_, i) => ({ id: `d${i}`, askedAt: i, askedPrice: 1, declinedAt: i + 1 }))
    let f: SaleFacts = awaiting({ saleBuyerHistory: serializeBuyerHistory(declines), soldToProfileId: null, soldChannel: null })
    const first = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 11_200_000 }, markCtx({ facts: f, now: T0 }))
    expect(first.ok).toBe(true)
    if (!first.ok) return
    f = { ...f, ...first.patch }
    expect(buyerHistoryEntry(f.saleBuyerHistory, BUYER)?.asks).toBe(1)
    expect(confirmWindowAnchor(f)).toEqual(T0)

    // …and the budget really does run out rather than resetting each round.
    let refusals = 0
    for (let h = 1; h <= 50; h++) {
      const r = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 11_200_000 + h }, markCtx({ facts: f, now: at(hours(h)) }))
      if (!r.ok) refusals++
      else f = { ...f, ...r.patch }
    }
    expect(refusals).toBeGreaterThan(0)
    expect(buyerHistoryEntry(f.saleBuyerHistory, BUYER)?.asks).toBe(TRADE_LOOP.MAX_MARK_SOLD_ASKS)
  })

  it('⚠️ canNameBuyer REFUSES when the seller cannot be resolved, instead of skipping the check', () => {
    // The picker calls this directly, so the fail-open would have listed the seller themselves
    // as an eligible buyer. Same pattern already deleted from canRespondToSale.
    expect(canNameBuyer(SELLER, { sellerProfileId: null, conversationBuyerProfileIds: [SELLER, BUYER], facts: facts() })).toEqual({
      ok: false,
      reason: 'buyer_is_seller',
    })
    expect(canNameBuyer(BUYER, { sellerProfileId: null, conversationBuyerProfileIds: [BUYER], facts: facts() })).toEqual({
      ok: false,
      reason: 'buyer_is_seller',
    })
  })

  it('the ask-budget dead end has a documented way out: re-submit the price the buyer was shown', () => {
    let f: SaleFacts = awaiting({ saleBuyerHistory: serializeBuyerHistory([{ id: BUYER, askedAt: T0.getTime(), askedPrice: 11_200_000, asks: TRADE_LOOP.MAX_MARK_SOLD_ASKS }]) })
    // A new number is refused…
    expect(validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 9_000_000 }, markCtx({ facts: f, now: at(hours(1)) }))).toEqual({
      ok: false,
      reason: 'ask_budget_exhausted',
    })
    // …even after an external detour has cleared the salePrice column…
    const away = validateMarkSold({ channel: 'external' }, markCtx({ facts: f, now: at(hours(2)) }))
    expect(away.ok).toBe(true)
    if (!away.ok) return
    f = { ...f, ...away.patch }
    expect(f.salePrice).toBeNull()
    // …and the way out is confirmPromptPrice: the number the buyer actually holds.
    const back = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 11_200_000 }, markCtx({ facts: f, now: at(hours(3)) }))
    expect(back.ok).toBe(true)
    expect(back.ok && back.patch.saleConfirmPromptedAt).toEqual(f.saleConfirmPromptedAt) // and asks nobody again
  })
})

// ──────────────────────────────────────────────────────────────────────────────────
describe('round seven — an ask is only ever recorded when one was actually sent', () => {
  it('⚠️ THE INVARIANT, SWEPT: history never claims an ask the buyer did not receive', () => {
    // The bug this closes only appeared with `salePrice: null` on a legacy row: nothing went out
    // (sameQuestion) yet the freshly-created entry hard-coded asks: 1, charging a budget the
    // buyer never spent. Measured: "notification sent? false | asks recorded: 1". Every price
    // test before this one used non-null numbers, which is exactly why it survived six rounds.
    for (const salePrice of [undefined, null, 11_200_000] as const) {
      for (const history of [null, serializeBuyerHistory([{ id: BUYER, askedAt: T0.getTime(), askedPrice: null, asks: 1 }])]) {
        for (const stored of [null, 11_200_000]) {
          const f = awaiting({ salePrice: stored, saleBuyerHistory: history, saleConfirmPromptedAt: T0 })
          const before = buyerHistoryEntry(f.saleBuyerHistory, BUYER)?.asks ?? 0
          const r = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice }, markCtx({ facts: f, now: at(hours(1)) }))
          if (!r.ok) continue
          const sent = r.patch.saleConfirmPromptedAt?.getTime() === at(hours(1)).getTime()
          const after = buyerHistoryEntry(r.patch.saleBuyerHistory, BUYER)?.asks ?? 0
          expect(after).toBe(before + (sent ? 1 : 0))
        }
      }
    }
  })

  it('a no-price sale is still a sale, and re-marking it identically asks nobody', () => {
    const f = awaiting({ salePrice: null, saleBuyerHistory: null })
    const r = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER }, markCtx({ facts: f, now: at(hours(1)) }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.patch.saleConfirmPromptedAt).toEqual(T0) // no new notification
    expect(buyerHistoryEntry(r.patch.saleBuyerHistory, BUYER)?.asks ?? 0).toBe(0) // …and no charge
    expect(countsAsSale({ ...f, ...r.patch })).toBe(true)
  })
})
