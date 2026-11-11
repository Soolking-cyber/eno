import { describe, expect, it } from 'vitest'
import {
  DEAL_WITHDRAWN_LINE, SERVICE_DEAL, SERVICE_DEAL_KINDS, apiReviewPreview, apiReviewsPayload, canConfirmDeal, canWithdrawDeal, confirmsLeft, dealConfirmedLine, dealState,
  declinesWarrantFlag, isDealLineKind, localizeDealLine, mayReviewServiceDeal, reviewBasis, serviceDealInScope, serviceDealKind,
  undoCutoff, withdrawUntil, type ConfirmContext, type DealRow, type WithdrawContext,
} from './service-deal'
import { isGoodsSale } from './trade-loop'
import { LISTING_TYPES, TAXONOMY } from './taxonomy'

/**
 * THE SERVICE-DEAL LOOP'S PURE RULES (owner 2026-11-11; spec v2). Every branch, both clocks, identity before outcome.
 */

const DAY = 86_400_000
const MIN = 60_000
const NOW = new Date('2026-11-11T08:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

const SELLER = 'seller-p'
const BUYER = 'buyer-p'

const row = (over: Partial<DealRow> = {}): DealRow => ({
  listingId: 'L1', sellerId: 'shop-1', sellerProfileId: SELLER, buyerProfileId: BUYER, kind: 'rental',
  confirmedAt: ago(5 * MIN), revokedAt: null, declinedAt: null, confirmCount: 1, reviewId: null, ...over,
})

const confirmCtx = (over: Partial<ConfirmContext> = {}): ConfirmContext => ({
  actorProfileId: SELLER, threadSellerProfileId: SELLER, buyerProfileId: BUYER, sellerOwnerId: SELLER, kind: 'rental',
  blocked: false, deal: null, threadHasReview: false, messages: { buyer: 2, seller: 1 },
  buyer: { createdAt: ago(30 * DAY), phoneVerified: false, suspended: false }, confirmsLast24h: 0, now: NOW, ...over,
})

const withdrawCtx = (over: Partial<WithdrawContext> = {}): WithdrawContext => ({
  actorProfileId: SELLER, threadSellerProfileId: SELLER, sellerOwnerId: SELLER, blocked: false, deal: row(),
  threadHasReview: false, now: NOW, ...over,
})

describe('serviceDealKind — what the loop is about', () => {
  it.each([
    [{ listingType: 'rent', categorySlug: 'vehicles' }, 'rental'],
    [{ listingType: 'rent', categorySlug: 'rentals' }, 'rental'],
    [{ listingType: 'sell', categorySlug: 'rentals' }, 'rental'],
    [{ listingType: 'service', categorySlug: 'services' }, 'service'],
    [{ listingType: 'teacher', categorySlug: 'teachers' }, 'lesson'],
  ] as const)('%j → %s', (l, kind) => {
    expect(serviceDealKind(l)).toBe(kind)
  })

  it.each([
    { listingType: 'sell', categorySlug: 'electronics' },
    { listingType: 'free', categorySlug: 'home-garden' },
    { listingType: 'wholesale', categorySlug: 'electronics' },
    { listingType: 'wanted', categorySlug: 'electronics' },
    { listingType: 'wanted', categorySlug: 'rentals' },
    { listingType: 'job', categorySlug: 'jobs' },
    { listingType: 'event', categorySlug: 'community-events' },
    { listingType: null, categorySlug: 'electronics' },
    {},
  ])('⛔ %j → null (goods keep the named-buyer loop; wanted, job and event are no deal)', (l) => {
    expect(serviceDealKind(l)).toBeNull()
  })

  it('null for no listing at all', () => {
    expect(serviceDealKind(null)).toBeNull()
    expect(serviceDealKind(undefined)).toBeNull()
  })

  it('⛔ never both a goods sale and a service deal, for every taxonomy category × type — and a job is neither', () => {
    const types = LISTING_TYPES.map((t) => t.value)
    for (const c of TAXONOMY) {
      for (const t of new Set([...c.types, ...types])) {
        const l = { listingType: t, categorySlug: c.slug }
        expect(isGoodsSale(l) && serviceDealKind(l) !== null, `${c.slug} × ${t}`).toBe(false)
        if (t === 'job') {
          expect(isGoodsSale(l)).toBe(false)
          expect(serviceDealKind(l)).toBeNull()
        }
      }
    }
  })
})

describe('serviceDealInScope — the thread can carry a deal', () => {
  const live = { listingType: 'rent', categorySlug: 'rentals', complianceStatus: null }
  it('an ordinary listing thread about a rental', () => {
    expect(serviceDealInScope({ listing: live, threadKind: 'listing', enoDesk: false })).toBe('rental')
  })
  it('⛔ no listing, a desk thread, an eno desk seller, a taken-down listing, a goods listing', () => {
    expect(serviceDealInScope({ listing: null, threadKind: 'listing', enoDesk: false })).toBeNull()
    expect(serviceDealInScope({ listing: live, threadKind: 'visa', enoDesk: false })).toBeNull()
    expect(serviceDealInScope({ listing: live, threadKind: 'itinerary', enoDesk: false })).toBeNull()
    expect(serviceDealInScope({ listing: live, threadKind: null, enoDesk: false })).toBeNull()
    expect(serviceDealInScope({ listing: live, threadKind: 'listing', enoDesk: true })).toBeNull()
    expect(serviceDealInScope({ listing: { ...live, complianceStatus: 'taken_down' }, threadKind: 'listing', enoDesk: false })).toBeNull()
    expect(serviceDealInScope({ listing: { listingType: 'sell', categorySlug: 'electronics' }, threadKind: 'listing', enoDesk: false })).toBeNull()
  })
})

describe('dealState / confirmsLeft', () => {
  it('reviewed wins (the row\'s own review, or any review of the thread), then declined, then confirmed', () => {
    expect(dealState(null, false)).toBe('none')
    expect(dealState(null, true)).toBe('reviewed')
    expect(dealState(row({ reviewId: 'r1' }), false)).toBe('reviewed')
    expect(dealState(row({ declinedAt: NOW }), false)).toBe('declined')
    expect(dealState(row({ declinedAt: NOW }), true)).toBe('reviewed')
    expect(dealState(row(), false)).toBe('confirmed')
    expect(dealState(row({ confirmedAt: null, revokedAt: NOW }), false)).toBe('none')
  })
  it('two confirms per thread, ever', () => {
    expect(SERVICE_DEAL.MAX_CONFIRMS_PER_THREAD).toBe(2)
    expect(confirmsLeft(null)).toBe(2)
    expect(confirmsLeft(row({ confirmCount: 1 }))).toBe(1)
    expect(confirmsLeft(row({ confirmCount: 2 }))).toBe(0)
    expect(confirmsLeft(row({ confirmCount: 5 }))).toBe(0)
  })
  it('⛔ A3: a DECLINED deal has no confirm left, whatever its count — it can never be confirmed again', () => {
    expect(confirmsLeft(row({ confirmCount: 1, declinedAt: NOW }))).toBe(0)
    expect(confirmsLeft(row({ confirmCount: 0, confirmedAt: null, declinedAt: NOW }))).toBe(0)
  })
})

describe('canConfirmDeal — identity first', () => {
  it('the seller who owns the storefront, on a two-way thread, a settled buyer: allowed (not a no-op)', () => {
    expect(canConfirmDeal(confirmCtx())).toEqual({ ok: true, noop: false })
  })

  it('⛔ not_seller: the buyer, a stranger, a seller profile that is not the owner, an unresolved owner or thread seller', () => {
    expect(canConfirmDeal(confirmCtx({ actorProfileId: BUYER }))).toEqual({ ok: false, reason: 'not_seller' })
    expect(canConfirmDeal(confirmCtx({ actorProfileId: 'stranger' }))).toEqual({ ok: false, reason: 'not_seller' })
    expect(canConfirmDeal(confirmCtx({ actorProfileId: null }))).toEqual({ ok: false, reason: 'not_seller' })
    expect(canConfirmDeal(confirmCtx({ sellerOwnerId: 'someone-else' }))).toEqual({ ok: false, reason: 'not_seller' })
    expect(canConfirmDeal(confirmCtx({ sellerOwnerId: null }))).toEqual({ ok: false, reason: 'not_seller' })
    expect(canConfirmDeal(confirmCtx({ threadSellerProfileId: null }))).toEqual({ ok: false, reason: 'not_seller' })
  })

  it('⛔ a stranger gets the SAME single reason whatever the deal\'s state (identity before outcome)', () => {
    const states: Partial<ConfirmContext>[] = [
      {}, { deal: row() }, { deal: row({ reviewId: 'r1' }) }, { deal: row({ declinedAt: NOW }) }, { threadHasReview: true },
      { kind: null }, { blocked: true }, { messages: { buyer: 0, seller: 0 } }, { confirmsLast24h: 99 },
    ]
    for (const s of states) expect(canConfirmDeal(confirmCtx({ ...s, actorProfileId: 'stranger' }))).toEqual({ ok: false, reason: 'not_seller' })
  })

  it('⛔ buyer_is_seller (a self-thread)', () => {
    expect(canConfirmDeal(confirmCtx({ buyerProfileId: SELLER }))).toEqual({ ok: false, reason: 'buyer_is_seller' })
  })

  it('⛔ out of scope (taken down, goods, a desk…) → not_reviewable', () => {
    expect(canConfirmDeal(confirmCtx({ kind: null }))).toEqual({ ok: false, reason: 'not_reviewable' })
  })

  it('⛔ a block refuses a confirm', () => {
    expect(canConfirmDeal(confirmCtx({ blocked: true }))).toEqual({ ok: false, reason: 'blocked' })
  })

  it('a confirmation that stands: an idempotent no-op', () => {
    expect(canConfirmDeal(confirmCtx({ deal: row() }))).toEqual({ ok: true, noop: true })
  })

  it('⛔ already_reviewed when the row is reviewed or the thread holds an offer-path review; deal_declined once the buyer said No', () => {
    expect(canConfirmDeal(confirmCtx({ deal: row({ reviewId: 'r1' }) }))).toEqual({ ok: false, reason: 'already_reviewed' })
    expect(canConfirmDeal(confirmCtx({ threadHasReview: true }))).toEqual({ ok: false, reason: 'already_reviewed' })
    expect(canConfirmDeal(confirmCtx({ deal: row({ declinedAt: NOW }) }))).toEqual({ ok: false, reason: 'deal_declined' })
  })

  it('⛔ confirm_budget_spent once the thread used both confirms (a withdrawn second one)', () => {
    expect(canConfirmDeal(confirmCtx({ deal: row({ confirmedAt: null, revokedAt: NOW, confirmCount: 1 }) }))).toEqual({ ok: true, noop: false })
    expect(canConfirmDeal(confirmCtx({ deal: row({ confirmedAt: null, revokedAt: NOW, confirmCount: 2 }) }))).toEqual({ ok: false, reason: 'confirm_budget_spent' })
  })

  it('⛔ too_few_messages: buyer 2 / seller 1 at least', () => {
    expect(canConfirmDeal(confirmCtx({ messages: { buyer: 1, seller: 1 } }))).toEqual({ ok: false, reason: 'too_few_messages' })
    expect(canConfirmDeal(confirmCtx({ messages: { buyer: 2, seller: 0 } }))).toEqual({ ok: false, reason: 'too_few_messages' })
    expect(canConfirmDeal(confirmCtx({ messages: { buyer: 2, seller: 1 } })).ok).toBe(true)
  })

  it('⛔ a buyer account under 7 days with no VERIFIED phone, or a suspended one: one GENERIC reason', () => {
    const young = { createdAt: ago(6.9 * DAY), phoneVerified: false, suspended: false }
    expect(canConfirmDeal(confirmCtx({ buyer: young }))).toEqual({ ok: false, reason: 'not_yet_confirmable' })
    expect(canConfirmDeal(confirmCtx({ buyer: { ...young, phoneVerified: true } })).ok).toBe(true)
    expect(canConfirmDeal(confirmCtx({ buyer: { createdAt: ago(7 * DAY), phoneVerified: false, suspended: false } })).ok).toBe(true)
    expect(canConfirmDeal(confirmCtx({ buyer: { createdAt: ago(400 * DAY), phoneVerified: true, suspended: true } }))).toEqual({ ok: false, reason: 'not_yet_confirmable' })
  })

  it('⛔ confirm_cap: the 21st confirm in a rolling 24 h', () => {
    expect(canConfirmDeal(confirmCtx({ confirmsLast24h: 19 })).ok).toBe(true)
    expect(canConfirmDeal(confirmCtx({ confirmsLast24h: 20 }))).toEqual({ ok: false, reason: 'confirm_cap' })
  })
})

describe('withdrawUntil / canWithdrawDeal — the 10-minute undo (spec v3 A2: the window alone)', () => {
  it('open while now < confirmedAt + 10 min — the buyer writing in between no longer closes it', () => {
    expect(withdrawUntil(row({ confirmedAt: ago(5 * MIN) }), false, NOW)?.toISOString()).toBe(new Date(NOW.getTime() + 5 * MIN).toISOString())
    expect(withdrawUntil(row({ confirmedAt: ago(10 * MIN - 1) }), false, NOW)?.getTime()).toBe(NOW.getTime() + 1)
    expect(withdrawUntil(row({ confirmedAt: ago(10 * MIN) }), false, NOW)).toBeNull()
    expect(withdrawUntil(row({ reviewId: 'r1' }), false, NOW)).toBeNull()
    expect(withdrawUntil(row(), true, NOW)).toBeNull()
    expect(withdrawUntil(null, false, NOW)).toBeNull()
  })

  it('⛔ A2: the undo and the review NEVER overlap, and one of them is always open — at every instant around the 10 minutes', () => {
    const listing = { sellerId: 'shop-1', complianceStatus: null }
    for (const ms of [0, 1, 5 * MIN, 10 * MIN - 1, 10 * MIN, 10 * MIN + 1, 11 * MIN, DAY]) {
      const deal = row({ confirmedAt: ago(ms) })
      const undo = withdrawUntil(deal, false, NOW) !== null
      const review = mayReviewServiceDeal(deal, BUYER, listing, NOW).ok
      expect([ms, undo && review]).toEqual([ms, false])
      expect([ms, undo || review]).toEqual([ms, true])
    }
    // the instant both sides measure from
    expect(undoCutoff(NOW).getTime()).toBe(NOW.getTime() - SERVICE_DEAL.WITHDRAW_WINDOW_MINUTES * MIN)
  })

  it('the seller, inside the window: allowed', () => {
    expect(canWithdrawDeal(withdrawCtx())).toEqual({ ok: true })
  })

  it('⛔ only the seller — a stranger gets one reason whatever the state', () => {
    for (const deal of [row(), row({ reviewId: 'r1' }), null]) {
      expect(canWithdrawDeal(withdrawCtx({ actorProfileId: BUYER, deal }))).toEqual({ ok: false, reason: 'not_seller' })
    }
  })

  it('⛔ reviewed, declined, nothing standing, past 10 minutes, or across a block — but NOT the buyer\'s next message (A2)', () => {
    expect(canWithdrawDeal(withdrawCtx({ deal: row({ reviewId: 'r1' }) }))).toEqual({ ok: false, reason: 'already_reviewed' })
    expect(canWithdrawDeal(withdrawCtx({ threadHasReview: true }))).toEqual({ ok: false, reason: 'already_reviewed' })
    expect(canWithdrawDeal(withdrawCtx({ deal: row({ declinedAt: NOW }) }))).toEqual({ ok: false, reason: 'deal_declined' })
    expect(canWithdrawDeal(withdrawCtx({ deal: null }))).toEqual({ ok: false, reason: 'not_confirmed' })
    expect(canWithdrawDeal(withdrawCtx({ deal: row({ confirmedAt: null, revokedAt: NOW }) }))).toEqual({ ok: false, reason: 'not_confirmed' })
    expect(canWithdrawDeal(withdrawCtx({ deal: row({ confirmedAt: ago(11 * MIN) }) }))).toEqual({ ok: false, reason: 'withdraw_window_closed' })
    expect(canWithdrawDeal(withdrawCtx({ blocked: true }))).toEqual({ ok: false, reason: 'blocked' })
  })
})

describe('mayReviewServiceDeal — the buyer\'s card, the review POST\'s third branch, and the decline', () => {
  const listing = { sellerId: 'shop-1', complianceStatus: null }
  it('⛔ A2: not before the undo closed — review_not_open until confirmedAt + 10 min, open from that instant', () => {
    expect(mayReviewServiceDeal(row({ confirmedAt: ago(5 * MIN) }), BUYER, listing, NOW)).toEqual({ ok: false, reason: 'review_not_open' })
    expect(mayReviewServiceDeal(row({ confirmedAt: ago(10 * MIN - 1) }), BUYER, listing, NOW)).toEqual({ ok: false, reason: 'review_not_open' })
    expect(mayReviewServiceDeal(row({ confirmedAt: ago(10 * MIN) }), BUYER, listing, NOW)).toEqual({ ok: true })
    // identity still first: a stranger hears the one reason, not the clock
    expect(mayReviewServiceDeal(row({ confirmedAt: ago(MIN) }), 'stranger', listing, NOW)).toEqual({ ok: false, reason: 'not_the_buyer' })
  })

  it('the deal\'s buyer, confirmed, inside 30 days: allowed (day 30 open, day 31 closed)', () => {
    expect(mayReviewServiceDeal(row({ confirmedAt: ago(11 * MIN) }), BUYER, listing, NOW)).toEqual({ ok: true })
    expect(mayReviewServiceDeal(row({ confirmedAt: ago(30 * DAY) }), BUYER, listing, NOW)).toEqual({ ok: true })
    expect(mayReviewServiceDeal(row({ confirmedAt: ago(31 * DAY) }), BUYER, listing, NOW)).toEqual({ ok: false, reason: 'review_window_closed' })
  })

  it('⛔ only the thread\'s buyer, about the deal\'s own storefront — one reason for everyone else', () => {
    expect(mayReviewServiceDeal(row(), SELLER, listing, NOW)).toEqual({ ok: false, reason: 'not_the_buyer' })
    expect(mayReviewServiceDeal(row(), 'stranger', listing, NOW)).toEqual({ ok: false, reason: 'not_the_buyer' })
    expect(mayReviewServiceDeal(row(), null, listing, NOW)).toEqual({ ok: false, reason: 'not_the_buyer' })
    expect(mayReviewServiceDeal(null, BUYER, listing, NOW)).toEqual({ ok: false, reason: 'not_the_buyer' })
    expect(mayReviewServiceDeal(row(), BUYER, { ...listing, sellerId: 'shop-2' }, NOW)).toEqual({ ok: false, reason: 'not_the_buyer' })
    expect(mayReviewServiceDeal(row({ reviewId: 'r1' }), 'stranger', listing, NOW)).toEqual({ ok: false, reason: 'not_the_buyer' })
  })

  it('⛔ withdrawn, never confirmed, declined, already reviewed, taken down', () => {
    expect(mayReviewServiceDeal(row({ confirmedAt: null, revokedAt: NOW }), BUYER, listing, NOW)).toEqual({ ok: false, reason: 'deal_withdrawn' })
    expect(mayReviewServiceDeal(row({ confirmedAt: null }), BUYER, listing, NOW)).toEqual({ ok: false, reason: 'not_confirmed' })
    expect(mayReviewServiceDeal(row({ declinedAt: NOW }), BUYER, listing, NOW)).toEqual({ ok: false, reason: 'deal_declined' })
    expect(mayReviewServiceDeal(row({ reviewId: 'r1' }), BUYER, listing, NOW)).toEqual({ ok: false, reason: 'already_reviewed' })
    expect(mayReviewServiceDeal(row(), BUYER, { ...listing, complianceStatus: 'taken_down' }, NOW)).toEqual({ ok: false, reason: 'listing_unavailable' })
  })
})

describe('the decline flag', () => {
  it('3 declines in the window raise it, 2 do not', () => {
    expect(declinesWarrantFlag(2)).toBe(false)
    expect(declinesWarrantFlag(3)).toBe(true)
    expect(SERVICE_DEAL.DECLINE_FLAG_WINDOW_DAYS).toBe(90)
  })
})

describe('the timeline lines — persisted bilingual, shown in the viewer\'s language', () => {
  it('the stored bodies', () => {
    expect(dealConfirmedLine('rental')).toBe('✅ Đã xác nhận cho thuê · Rental confirmed')
    expect(dealConfirmedLine('lesson')).toBe('✅ Đã xác nhận buổi học · Lesson confirmed')
    expect(dealConfirmedLine('service')).toBe('✅ Đã xác nhận dịch vụ · Service confirmed')
    expect(DEAL_WITHDRAWN_LINE).toBe('↩️ Đã rút lại xác nhận · Confirmation withdrawn')
  })

  it('each viewer sees their half; the MT languages read English', () => {
    for (const k of SERVICE_DEAL_KINDS) {
      expect(localizeDealLine(dealConfirmedLine(k), 'vi')).not.toContain('confirmed')
      expect(localizeDealLine(dealConfirmedLine(k), 'en')).not.toContain('Đã')
    }
    expect(localizeDealLine(dealConfirmedLine('rental'), 'vi')).toBe('✅ Đã xác nhận cho thuê')
    expect(localizeDealLine(dealConfirmedLine('rental'), 'en')).toBe('✅ Rental confirmed')
    expect(localizeDealLine(dealConfirmedLine('lesson'), 'ko')).toBe('✅ Lesson confirmed')
    expect(localizeDealLine(DEAL_WITHDRAWN_LINE, 'vi')).toBe('↩️ Đã rút lại xác nhận')
    expect(localizeDealLine(DEAL_WITHDRAWN_LINE, 'en')).toBe('↩️ Confirmation withdrawn')
  })

  it('⛔ anything else — a typed lookalike — is returned as it is', () => {
    expect(localizeDealLine('✅ Đã xác nhận cho thuê · Rental confirmed!', 'vi')).toBe('✅ Đã xác nhận cho thuê · Rental confirmed!')
    expect(localizeDealLine('hello', 'en')).toBe('hello')
  })

  it('only the two server kinds are deal lines', () => {
    expect(isDealLineKind('deal_confirmed')).toBe(true)
    expect(isDealLineKind('deal_withdrawn')).toBe(true)
    expect(isDealLineKind('text')).toBe(false)
    expect(isDealLineKind(undefined)).toBe(false)
  })
})

describe('reviewBasis', () => {
  it('the three kinds, else null', () => {
    expect(reviewBasis('rental')).toBe('rental')
    expect(reviewBasis('lesson')).toBe('lesson')
    expect(reviewBasis('service')).toBe('service')
    expect(reviewBasis(null)).toBeNull()
    expect(reviewBasis('goods')).toBeNull()
  })
})

describe('apiReviewPreview / apiReviewsPayload — the native apps\' "Verified" flag (spec v3 A1)', () => {
  const goods = { author: 'Minh', verified: true, createdAt: 'x' }
  it('⛔ a basis review goes out verified: false, its basis kept; a goods review is the SAME object', () => {
    expect(apiReviewPreview({ author: 'Lan', verified: true, basis: 'rental', createdAt: 'x' })).toEqual({ author: 'Lan', verified: false, basis: 'rental', createdAt: 'x' })
    expect(apiReviewPreview(goods)).toBe(goods)
    expect(apiReviewPreview({ ...goods, basis: 'goods' })).toEqual({ ...goods, basis: 'goods' })
  })
  it('maps a whole topSellerReviews answer; anything without a reviews array passes through', () => {
    expect(apiReviewsPayload({ reviews: [{ ...goods, basis: 'lesson' }, goods], total: 2, avg: 4 }))
      .toEqual({ reviews: [{ ...goods, basis: 'lesson', verified: false }, goods], total: 2, avg: 4 })
    expect(apiReviewsPayload([])).toEqual([])
    expect(apiReviewsPayload(null)).toBeNull()
  })
})
