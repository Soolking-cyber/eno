// THE SERVICE-DEAL LOOP — the PURE rules for a review after a confirmed rental, lesson or service (2026-11-11).
//
// Owner, 2026-11-11 ("1 and 2 do recommended"): "a renter, student or client can review once the seller confirms in chat
// that the rental or lesson happened — both sides confirming keeps fake reviews out". This SUPERSEDES, for rentals,
// services and lessons only, rule 1 of the owner's 2026-10-25 decision (reviews only after a goods sale to the named buyer
// or an accepted offer). Goods keep the named-buyer loop (trade-loop.ts) unchanged.
//
// BOTH SIDES SPEAK. The SELLER confirms in the thread (POST /api/conversations/[id]/deal); the BUYER first answers "did
// you…?" in the review card and then writes the review. The seller never writes one.
//
// ⛔ A CONFIRMATION ALONE MINTS NOTHING: no trust (Q or T), no rating, no probation lift, nothing public. It only opens the
// existing review card for that one buyer. A service deal is NOT a transaction (src/lib/trust.ts T and
// src/lib/enforcement.ts sellerTransactionCount are unchanged), and (spec v3 A4) its REVIEW is excluded from the trust
// score entirely — trust.ts Q, distinctBuyerReviews and the review velocity read only reviews with `basis` IS NULL. It
// counts in the displayed rating and review count only.
// ⛔ NO "VERIFIED" CLAIM (spec v3 A1): a seller's confirmation plus the buyer's "yes" is not proof of fulfilment, so its
// badge says "Confirmed rental / lesson / service", never "Verified …" (goods and accepted offers keep "Verified buyer").
// ⛔ UNDO AND REVIEW NEVER OVERLAP (spec v3 A2): the seller's undo is open while now < confirmedAt + 10 min; the buyer's
// card, their "No" and the review POST open only when now >= confirmedAt + 10 min (undoCutoff — one instant, two sides).
//
// PURITY CONTRACT (trade-loop.ts's): no Prisma, no `server-only`, no I/O, no `new Date()` without an argument. Every
// function takes its facts and its clock, so the machine is unit-testable (service-deal.test.ts) and importable from a
// client component. Callers do the reads and the writes; this file decides. Every rule checks IDENTITY BEFORE OUTCOME, so
// a stranger gets one reason whatever state the deal is in.

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

export const SERVICE_DEAL = {
  /** The buyer's non-recalled text/offer messages in THIS thread at confirm time — a two-way thread, not a cold inquiry. */
  MIN_BUYER_MESSAGES: 2,
  /** …and the seller's (their own deal lines and calls do not count — only 'text' and 'offer'). */
  MIN_SELLER_MESSAGES: 1,
  /**
   * A buyer account this young cannot be confirmed — unless it carries a VERIFIED phone: the 'phone_verified' trust event,
   * written only for a confirmation eno's own phone flow produced (auth-policy.ts phoneConfirmationTrusted). Never
   * Profile.phone: PATCH /api/profile writes that column without an OTP.
   */
  MIN_BUYER_ACCOUNT_DAYS: 7,
  /** Confirms per conversation, EVER — bounds the timeline lines and the confirm / withdraw / re-confirm game. */
  MAX_CONFIRMS_PER_THREAD: 2,
  /** Confirms per seller in a ROLLING 24 h — fail-closed DB count from DealConfirmationEvent, behind a fail-open limiter. */
  DAILY_CONFIRMS_PER_SELLER: 20,
  /** The review card closes this long after the latest confirm (day 30 still open, day 31 closed). */
  REVIEW_WINDOW_DAYS: 30,
  /**
   * THE UNDO, AND THE INSTANT THE REVIEW OPENS (spec v3 A2): a seller may withdraw only while now < confirmedAt + this;
   * the buyer may review (or say "No") only when now >= confirmedAt + this. The two never overlap, so a review can never
   * be pulled by an undo. After the undo the confirmation stands; only an admin removes it (through a Report on the
   * thread). v1's "withdraw any time until reviewed" was refuted: it let a seller see a complaint coming and pull the door;
   * v2's "…and before the buyer's next message" clause is dropped (the windows alone keep the two apart).
   */
  WITHDRAW_WINDOW_MINUTES: 10,
  /** A seller whose confirmations the buyers deny this often in DECLINE_FLAG_WINDOW_DAYS gets a SILENT admin annotation. */
  DECLINE_FLAG_THRESHOLD: 3,
  DECLINE_FLAG_WINDOW_DAYS: 90,
} as const

export const SERVICE_DEAL_KINDS = ['rental', 'lesson', 'service'] as const
export type ServiceDealKind = (typeof SERVICE_DEAL_KINDS)[number]
export const isServiceDealKind = (v: unknown): v is ServiceDealKind => typeof v === 'string' && (SERVICE_DEAL_KINDS as readonly string[]).includes(v)

/**
 * Is this listing a RENTAL, a LESSON or a SERVICE — the only listings the service-deal loop describes?
 *   · 'rental'  — the rentals category (a rental whatever the type says — listingLdKind's guard), or listingType 'rent';
 *   · 'lesson'  — a teacher profile (listingType 'teacher');
 *   · 'service' — listingType 'service'.
 * null for goods (sell / free / wholesale keep the named-buyer loop, trade-loop.ts isGoodsSale), a WANTED post (the roles
 * are reversed — rentals + wanted included), a job (owner 2026-10-01: a job is not a sale) and an event.
 * ⚠️ The non-goods COMPLEMENT of isGoodsSale: the two are never both true for one listing (service-deal.test.ts loops
 * every taxonomy category × type to keep it so). Scope beyond the listing — eno's desks, taken-down listings, non-'listing'
 * threads, sellers hidden on the edition — is the caller's (serviceDealInScope, and the routes).
 */
export function serviceDealKind(l: { listingType?: string | null; categorySlug?: string | null } | null | undefined): ServiceDealKind | null {
  if (!l) return null
  const t = l.listingType || 'sell'
  if (t === 'wanted' || t === 'job' || t === 'event') return null
  if (t === 'teacher') return 'lesson'
  if (t === 'service') return 'service'
  if (t === 'rent' || l.categorySlug === 'rentals') return 'rental'
  return null
}

/** The facts serviceDealInScope reads — all of them already on the thread, no extra query. */
export type ServiceDealScope = {
  /** The thread's anchor listing; null on a support / desk thread. */
  listing: { listingType?: string | null; categorySlug?: string | null; complianceStatus?: string | null; verified?: boolean | null; verificationNotes?: string | null } | null
  /** threadKind — only an ordinary 'listing' thread (never the visa or itinerary desk). */
  threadKind: string | null
  /** The thread's seller is one of eno's own desks (rental / jobs / support, or the visa / trip desk storefront). */
  enoDesk: boolean
}

/** The kind of service deal THIS THREAD can carry, or null when it is out of scope. */
export function serviceDealInScope(s: ServiceDealScope): ServiceDealKind | null {
  if (!s.listing || s.threadKind !== 'listing' || s.enoDesk) return null
  if (s.listing.complianceStatus === 'taken_down') return null
  // ⛔ NOT ON AN UNPUBLISHED OR LICENCE-HELD LISTING (review, 2026-11-11): a provider eno has not cleared (the e-Visa / legal
  // aisles' licence check, licence-stamp.ts 'licence:held') or a listing that is not public cannot collect a public review.
  // Only when the caller passed the fields (undefined = not asked).
  if (s.listing.verified === false || s.listing.verificationNotes === 'licence:held') return null
  return serviceDealKind(s.listing)
}

/** The stored row, as the rules read it (DealConfirmation, prisma/schema.prisma). */
export type DealRow = {
  listingId: string
  sellerId: string
  sellerProfileId: string
  buyerProfileId: string
  kind: string
  confirmedAt: Date | null
  revokedAt: Date | null
  declinedAt: Date | null
  confirmCount: number
  reviewId: string | null
}

/** The seller's view of the deal: 'reviewed' wins (any review of this thread — an offer-path one too), then 'declined'. */
export type DealState = 'none' | 'confirmed' | 'reviewed' | 'declined'

export function dealState(deal: DealRow | null | undefined, threadHasReview: boolean): DealState {
  if (threadHasReview || deal?.reviewId) return 'reviewed'
  if (!deal) return 'none'
  if (deal.declinedAt) return 'declined'
  if (deal.confirmedAt && !deal.revokedAt) return 'confirmed'
  return 'none'
}

/** Confirms this thread has left. ⛔ A DECLINED deal has none (spec v3 A3): it can never be confirmed again. */
export function confirmsLeft(deal: DealRow | null | undefined): number {
  if (deal?.declinedAt) return 0
  return Math.max(0, SERVICE_DEAL.MAX_CONFIRMS_PER_THREAD - (deal?.confirmCount ?? 0))
}

/**
 * THE ONE INSTANT BOTH SIDES OF A2 ARE MEASURED FROM: now − WITHDRAW_WINDOW_MINUTES. The undo is open while
 * confirmedAt > undoCutoff(now); the review (and the buyer's "No") only while confirmedAt <= undoCutoff(now). The routes'
 * conditional UPDATEs carry the same comparison in their WHERE, so the rule holds under a race too.
 */
export function undoCutoff(now: Date): Date {
  return new Date(now.getTime() - SERVICE_DEAL.WITHDRAW_WINDOW_MINUTES * MINUTE_MS)
}

export type ServiceDealDenyReason =
  | 'not_seller'
  | 'buyer_is_seller'
  | 'not_reviewable'
  | 'blocked'
  | 'already_reviewed'
  | 'deal_declined'
  | 'confirm_budget_spent'
  | 'too_few_messages'
  | 'not_yet_confirmable'
  | 'confirm_cap'
  | 'not_confirmed'
  | 'withdraw_window_closed'
  | 'not_the_buyer'
  | 'deal_withdrawn'
  | 'review_not_open'
  | 'review_window_closed'
  | 'listing_unavailable'

export type ServiceDealDecision = { ok: true } | { ok: false; reason: ServiceDealDenyReason }
const ALLOW = { ok: true } as const
const deny = (reason: ServiceDealDenyReason) => ({ ok: false as const, reason })

/**
 * WHO IS THE SELLER: the one person who is both the thread's seller profile and the storefront's owner. An unresolved side
 * REFUSES (canNameBuyer's rule, trade-loop.ts) — a guest or unclaimed storefront cannot confirm anything.
 */
function isTheSeller(actorProfileId: string | null | undefined, threadSellerProfileId: string | null | undefined, sellerOwnerId: string | null | undefined): boolean {
  return !!actorProfileId && !!threadSellerProfileId && !!sellerOwnerId && actorProfileId === threadSellerProfileId && actorProfileId === sellerOwnerId
}

export type ConfirmContext = {
  actorProfileId: string | null
  /** Conversation.sellerProfileId / buyerProfileId. */
  threadSellerProfileId: string | null
  buyerProfileId: string
  /** Seller.ownerId of the thread's storefront. */
  sellerOwnerId: string | null
  /** serviceDealInScope for this thread (null = out of scope). */
  kind: ServiceDealKind | null
  /** A block either way between the two (user-blocks.ts). */
  blocked: boolean
  deal: DealRow | null
  /** A Review already exists for this conversation (an offer-path one, say). */
  threadHasReview: boolean
  /** Non-recalled 'text' / 'offer' messages in THIS thread, per side. */
  messages: { buyer: number; seller: number }
  /**
   * The buyer's account: when it was made, whether it carries a VERIFIED phone (the 'phone_verified' trust event — never
   * Profile.phone), whether it is suspended. Never sent to anyone.
   */
  buyer: { createdAt: Date; phoneVerified: boolean; suspended: boolean }
  /** 'confirm' events by this seller in the last 24 h (DealConfirmationEvent). */
  confirmsLast24h: number
  now: Date
}

/**
 * May the seller confirm this deal now? `noop: true` = it already stands — an idempotent re-tap, no second line.
 * ⚠️ THE BUYER-ACCOUNT REFUSAL IS GENERIC ('not_yet_confirmable'): it reveals no creation date, no phone, no suspension
 * (spec v2 — the attack's fix: the old buyer_too_new / buyer_unavailable told the seller facts about the other person).
 */
export function canConfirmDeal(ctx: ConfirmContext): { ok: true; noop: boolean } | { ok: false; reason: ServiceDealDenyReason } {
  if (!isTheSeller(ctx.actorProfileId, ctx.threadSellerProfileId, ctx.sellerOwnerId)) return deny('not_seller')
  if (ctx.buyerProfileId === ctx.actorProfileId) return deny('buyer_is_seller')
  if (!ctx.kind) return deny('not_reviewable')
  if (ctx.blocked) return deny('blocked')
  const state = dealState(ctx.deal, ctx.threadHasReview)
  if (state === 'reviewed') return deny('already_reviewed')
  if (state === 'declined') return deny('deal_declined')
  if (state === 'confirmed') return { ok: true, noop: true }
  if (confirmsLeft(ctx.deal) <= 0) return deny('confirm_budget_spent')
  if (ctx.messages.buyer < SERVICE_DEAL.MIN_BUYER_MESSAGES || ctx.messages.seller < SERVICE_DEAL.MIN_SELLER_MESSAGES) return deny('too_few_messages')
  const ageMs = ctx.now.getTime() - ctx.buyer.createdAt.getTime()
  if (ctx.buyer.suspended || (!ctx.buyer.phoneVerified && ageMs < SERVICE_DEAL.MIN_BUYER_ACCOUNT_DAYS * DAY_MS)) return deny('not_yet_confirmable')
  if (ctx.confirmsLast24h >= SERVICE_DEAL.DAILY_CONFIRMS_PER_SELLER) return deny('confirm_cap')
  return { ok: true, noop: false }
}

/**
 * The instant the seller's undo closes, or null when there is none: the deal is confirmed (not reviewed, not declined) and
 * now < confirmedAt + WITHDRAW_WINDOW_MINUTES (spec v3 A2 — the buyer writing in the meantime no longer closes it; the
 * review cannot open before this instant anyway).
 */
export function withdrawUntil(deal: DealRow | null | undefined, threadHasReview: boolean, now: Date): Date | null {
  if (dealState(deal, threadHasReview) !== 'confirmed' || !deal?.confirmedAt) return null
  return deal.confirmedAt.getTime() > undoCutoff(now).getTime()
    ? new Date(deal.confirmedAt.getTime() + SERVICE_DEAL.WITHDRAW_WINDOW_MINUTES * MINUTE_MS)
    : null
}

export type WithdrawContext = {
  actorProfileId: string | null
  threadSellerProfileId: string | null
  sellerOwnerId: string | null
  blocked: boolean
  deal: DealRow | null
  threadHasReview: boolean
  now: Date
}

/** May the seller undo the confirmation now — their own mistap, within the window? */
export function canWithdrawDeal(ctx: WithdrawContext): ServiceDealDecision {
  if (!isTheSeller(ctx.actorProfileId, ctx.threadSellerProfileId, ctx.sellerOwnerId)) return deny('not_seller')
  if (ctx.blocked) return deny('blocked')
  const state = dealState(ctx.deal, ctx.threadHasReview)
  if (state === 'reviewed') return deny('already_reviewed')
  if (state === 'declined') return deny('deal_declined')
  if (state !== 'confirmed') return deny('not_confirmed')
  if (!withdrawUntil(ctx.deal, ctx.threadHasReview, ctx.now)) return deny('withdraw_window_closed')
  return ALLOW
}

/**
 * May THIS viewer review the seller from this thread on the strength of the service deal? The ONE rule behind the review
 * POST's third branch, the thread GET's `mayReviewService` and the buyer's "No, this didn't happen" (the decline answers
 * exactly the card this rule shows). Identity first: only the deal's buyer, about the deal's own storefront.
 * ⛔ NOT BEFORE the seller's undo has closed (spec v3 A2, 'review_not_open'): now >= confirmedAt + WITHDRAW_WINDOW_MINUTES.
 * ⛔ THE ROW DECIDES (2026-11-11): nothing here reads the listing's CURRENT type or category — the callers ask this on any
 * thread that holds a row, so a seller who switched the listing to 'wanted' / 'sell' after confirming changes nothing.
 * `listing.complianceStatus` is the DEAL's listing's (service-deal-server.ts dealListingCompliance): only a takedown closes it.
 */
export function mayReviewServiceDeal(
  deal: DealRow | null | undefined,
  viewerProfileId: string | null | undefined,
  listing: { sellerId: string; complianceStatus?: string | null },
  now: Date,
): ServiceDealDecision {
  if (!viewerProfileId || !deal || deal.buyerProfileId !== viewerProfileId || deal.sellerId !== listing.sellerId) return deny('not_the_buyer')
  if (listing.complianceStatus === 'taken_down') return deny('listing_unavailable')
  if (deal.reviewId) return deny('already_reviewed')
  if (deal.declinedAt) return deny('deal_declined')
  if (!deal.confirmedAt || deal.revokedAt) return deny(deal.revokedAt ? 'deal_withdrawn' : 'not_confirmed')
  if (deal.confirmedAt.getTime() > undoCutoff(now).getTime()) return deny('review_not_open')
  if (now.getTime() - deal.confirmedAt.getTime() > SERVICE_DEAL.REVIEW_WINDOW_DAYS * DAY_MS) return deny('review_window_closed')
  return ALLOW
}

/** Should this seller get the silent admin annotation, given how many of their deals buyers denied in the window? */
export function declinesWarrantFlag(declinesInWindow: number): boolean {
  return declinesInWindow >= SERVICE_DEAL.DECLINE_FLAG_THRESHOLD
}

// ── THE TIMELINE LINES ────────────────────────────────────────────────────────────────────────────────────────────────
// Server-authored only (message kinds 'deal_confirmed' / 'deal_withdrawn', src/lib/messages.ts), written once, in BOTH
// languages, into Message.body — the 'call' class: no metaJson, so an older build still shows a readable bubble. Only
// 'text' may be recalled, so these stay as the in-thread record for both people and for an admin reading a reported thread.
// Each viewer sees their own language's half (localizeDealLine) — the offer-lines.ts pattern. Client-safe.

export const DEAL_CONFIRMED_LINES: Record<ServiceDealKind, { vi: string; en: string }> = {
  rental: { vi: 'Đã xác nhận cho thuê', en: 'Rental confirmed' },
  lesson: { vi: 'Đã xác nhận buổi học', en: 'Lesson confirmed' },
  service: { vi: 'Đã xác nhận dịch vụ', en: 'Service confirmed' },
}
export const DEAL_WITHDRAWN_LINE_PARTS = { vi: 'Đã rút lại xác nhận', en: 'Confirmation withdrawn' } as const

const CONFIRMED_MARK = '✅'
const WITHDRAWN_MARK = '↩️'

/** The persisted bilingual body of a 'deal_confirmed' line. */
export function dealConfirmedLine(kind: ServiceDealKind): string {
  const l = DEAL_CONFIRMED_LINES[kind]
  return `${CONFIRMED_MARK} ${l.vi} · ${l.en}`
}
/** The persisted bilingual body of a 'deal_withdrawn' line. */
export const DEAL_WITHDRAWN_LINE = `${WITHDRAWN_MARK} ${DEAL_WITHDRAWN_LINE_PARTS.vi} · ${DEAL_WITHDRAWN_LINE_PARTS.en}`

const DEAL_LINE_KINDS = new Set<string>(['deal_confirmed', 'deal_withdrawn'])
export const isDealLineKind = (kind: string | null | undefined): boolean => !!kind && DEAL_LINE_KINDS.has(kind)

/**
 * A deal line in the viewer's language: '✅ Đã xác nhận cho thuê' for a Vietnamese reader, '✅ Rental confirmed' for every
 * other one (the nine MT languages get the English variant, as the server render does). Matched by the WHOLE stored
 * body, never by an emoji a person could type: any other text — a hand-typed lookalike in a 'text' message — is returned
 * as it is.
 */
export function localizeDealLine(text: string, lang: string): string {
  const vi = lang === 'vi'
  for (const k of SERVICE_DEAL_KINDS) {
    if (text === dealConfirmedLine(k)) return `${CONFIRMED_MARK} ${vi ? DEAL_CONFIRMED_LINES[k].vi : DEAL_CONFIRMED_LINES[k].en}`
  }
  if (text === DEAL_WITHDRAWN_LINE) return `${WITHDRAWN_MARK} ${vi ? DEAL_WITHDRAWN_LINE_PARTS.vi : DEAL_WITHDRAWN_LINE_PARTS.en}`
  return text
}

/** Review.basis as stored: one of the three kinds, or null (a goods sale / accepted offer). Anything else reads as null. */
export function reviewBasis(v: unknown): ServiceDealKind | null {
  return isServiceDealKind(v) ? v : null
}

/**
 * A review preview as the JSON API sends it (GET /api/listings/[id], GET /api/sellers/[id] — the native apps' PDP and
 * storefront). ⛔ NO "VERIFIED" CLAIM FOR A BASIS REVIEW (spec v3 A1): the shipped native builds print "Verified buyer" /
 * "Verified" for `verified: true` and know nothing of `basis`, so a review born of a seller's confirmation goes out with
 * `verified: false` (its `basis` stays, for a build that can word it). A goods / offer review is passed through untouched,
 * so its payload is byte-identical. The web PDP and storefront render server-side and never read these routes.
 */
export function apiReviewPreview<T extends { verified: boolean; basis?: string | null }>(r: T): T {
  return reviewBasis(r.basis) ? { ...r, verified: false } : r
}

/** apiReviewPreview over a whole topSellerReviews answer; anything without a `reviews` array is returned as it is. */
export function apiReviewsPayload<T>(payload: T): T {
  const rows = (payload as { reviews?: unknown } | null)?.reviews
  if (!Array.isArray(rows)) return payload
  return { ...payload, reviews: rows.map((r: { verified: boolean; basis?: string | null }) => apiReviewPreview(r)) }
}

/** A Prisma error that means "the DDL has not reached this database": a missing table (P2021) or column (P2022). Pure. */
export function isMissingRelation(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code
  if (code === 'P2021' || code === 'P2022') return true
  return /(relation|table|column) .* does not exist/i.test(String((e as Error | null)?.message ?? ''))
}
