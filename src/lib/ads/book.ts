import 'server-only'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { buildFeedFilters } from '@/app/api/listings/feed-query'
import { logError, logWarn } from '@/lib/log'
import { AD_WEEK_HOURS, adRequirements, type X402Config } from '@/lib/x402/config'
import { facilitatorSettle, facilitatorVerify } from '@/lib/x402/facilitator'
import { authorizationUsed, findAuthorizationPayment } from '@/lib/x402/chain'
import { CREATIVE_REMOVED_PAID, UNPAID_CANCELLED, UNPAID_EXPIRED } from './reasons'
import { reviewCountsHere } from './review-jev'
import { CREATIVE_ADS_NOT_OPEN, creativeAdsAllowed } from './creative-gate'
import { checkPayload, paymentPayloadSchema, type PaymentPayload, type PaymentRequirements, type SettlementResponse } from '@/lib/x402/wire'
import { adCurrency } from './currency'

/**
 * ── Booking a paid ad (owner 2026-11-23). The ONE path both the HTTP route (POST /api/v1/ads) and the MCP tool
 * (promote_listing) take. Order, and why (codex plan review 2026-11-23):
 *   1. the payload must be OUR offer, field for field (wire.ts checkPayload) — nothing else is ever sent on;
 *   2. the same signed authorization again (a retry, a replay, a parallel call) finds its row by paymentId and gets THAT
 *      row's outcome — never a second ad, never another listing;
 *   3. the listing must be the caller's, public, and not in a held aisle — refused BEFORE any money is touched;
 *   4. the facilitator verifies; 5. the row is written `pending` WITH the whole authorization (so a lost answer can be
 *      found on chain later); 6. the facilitator settles; 7. a settled payment is activated under a per-listing lock, so
 *      two different payments for one listing get consecutive weeks, never overlapping ones.
 * ⛔ A SETTLEMENT WHOSE ANSWER IS LOST IS NEVER SHOWN AND NEVER FORGOTTEN: the row stays `unknown`, the chain is asked
 * (x402/chain.ts), and a retry of the same payload, or `reconcileAd`, activates it once the transfer is found.
 *
 * ── TWO KINDS OF TARGET (owner 2026-11-25: "enable any type of ads except the restricted ones by vietnamese law"). A row
 * advertises EITHER one of the shop's listings (`listingId`) OR one approved AdCreative of the shop (`creativeId`) — never
 * both, never neither (the CHECK ListingAd_one_target). Everything keyed on "the ad's target" reads `targetOf(row)`:
 * the lock and the back-to-back stacking are per listing or per creative, and a replayed payment must name the same one.
 * ⛔ A CREATIVE IS RE-CHECKED AT EVERY STEP THAT COULD START IT: before verify (approved, not removed, this shop's), and
 * again inside activate's lock — a creative eno removed while the payment was settling (or found on chain later by
 * reconcileAd) never goes live: the paid row goes to `review` for a manual pro-rata refund (CREATIVE_REMOVED_PAID).
 * Creative ads bought over x402 run at most AD_CREATIVE_MAX_HOURS (a week); bought by bank transfer from the dashboard
 * (bank.ts) they run a week, a month or a quarter. While they are in their private test (creative-gate.ts), a new
 * creative booking is an admin's only, checked with the target before verify.
 */
export const AD_EXCLUDED_SUBCATEGORIES: readonly string[] = ['visa-legal', 'legal-permits']
/** The longest creative ad bought over x402 (owner 2026-11-25, the brief's one standard placement: up to 168 hours). A
 *  bank-transfer order (bank.ts) runs a week, a month or a quarter: that cap is the period's, not this one. */
export const AD_CREATIVE_MAX_HOURS = AD_WEEK_HOURS
/** How long an approval can be booked on (checkAdCreative): a week, then the creative is reviewed again. */
export const AD_APPROVAL_VALID_MS = 7 * 86_400_000

/** What a booking advertises: exactly one of the two. */
export type AdTarget = { listingId: string; creativeId?: undefined } | { creativeId: string; listingId?: undefined }
type TargetCols = { listingId: string | null; creativeId: string | null }
/** The row's own target as a `where` on its own column — never `{ listingId: null }`, which would match every creative ad. */
function targetWhere(t: TargetCols): Prisma.ListingAdWhereInput {
  if (t.listingId) return { listingId: t.listingId }
  if (t.creativeId) return { creativeId: t.creativeId }
  throw new Error('ads: a row with no target')
}
/** The advisory lock a target's activations take: a listing's and a creative's can never collide. */
export function adLockKey(t: TargetCols): string {
  if (t.listingId) return `listing-ad:${t.listingId}`
  if (t.creativeId) return `creative-ad:${t.creativeId}`
  throw new Error('ads: a row with no target')
}

/**
 * A settle refusal the BUYER is told about as a refusal (402): the facilitator's own verification codes (x402 v2 §9 —
 * funds, signature, window, recipient, value, network, scheme, payload) or an HTTP refusal of the call itself (auth, rate
 * limit). Anything else — unexpected_settle_error, invalid_transaction_state, a 400 without a body — is answered as
 * "outcome not known" (202). In BOTH cases the row stays `unknown` and only the chain makes it final (reconcileAd).
 */
export function settledBeforeBroadcast(reason: string): boolean {
  return /^(insufficient_funds|invalid_exact_evm_\w+|invalid_network|invalid_payload|invalid_payment_requirements|invalid_scheme|unsupported_scheme|invalid_x402_version)$/.test(reason) ||
    /^settle answered (401|403|429)$/.test(reason)
}

export type AdRow = Prisma.ListingAdGetPayload<object>

export type BookResult =
  | { kind: 'booked'; ad: AdRow; settlement: SettlementResponse; replay: boolean }
  | { kind: 'pending'; ad: AdRow }
  | { kind: 'payment_invalid'; reason: string }
  | { kind: 'payment_failed'; reason: string; settlement: SettlementResponse | null }
  | { kind: 'refused'; status: 400 | 403 | 404 | 409 | 422; code: string; message: string }
  | { kind: 'unavailable'; message: string }

export function paymentIdOf(network: string, asset: string, from: string, nonce: string): string {
  return crypto.createHash('sha256').update([network, asset, from, nonce].map((s) => s.toLowerCase()).join('|')).digest('hex')
}

export type AdListingCheck =
  | { ok: true; listing: { id: string; title: string; categorySlug: string; subcategorySlug: string | null } }
  | { ok: false; status: 400 | 403 | 404; code: string; message: string }

/** The caller's own listing, live in the public feed of its own category (the feed's own filters: verified, active, the
 *  edition scope, hidden shops…), and not in an aisle held for a licence check. */
export async function checkAdListing(listingId: string, sellerId: string): Promise<AdListingCheck> {
  if (!sellerId) return { ok: false, status: 403, code: 'shop_required', message: 'Ads are bought by a shop: connect with a shop account.' }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(listingId)) return { ok: false, status: 400, code: 'invalid_input', message: 'listingId is not a listing id.' }
  // edition-lint-allow: owner-scoped (refused unless row.sellerId is the caller's shop), and live-ness is then decided by the
  // feed's own `where` below, which ANDs marketplaceListingScope() (feed-query.ts buildFeedFilters).
  const row = await db.listing.findUnique({ where: { id: listingId }, select: { id: true, title: true, sellerId: true, subcategorySlug: true, category: { select: { slug: true } } } })
  if (!row || row.sellerId !== sellerId) return { ok: false, status: 404, code: 'not_found', message: 'Listing not found in this shop.' }
  if (row.subcategorySlug && AD_EXCLUDED_SUBCATEGORIES.includes(row.subcategorySlug)) {
    return { ok: false, status: 403, code: 'ads_not_allowed', message: 'Listings in this aisle cannot be advertised.' }
  }
  const { where } = await buildFeedFilters(new URLSearchParams({ category: row.category.slug }))
  // edition-lint-allow: `where` is buildFeedFilters' own, which already ANDs marketplaceListingScope() (feed-query.ts).
  const live = await db.listing.count({ where: { AND: [where, { id: row.id }] } })
  if (!live) return { ok: false, status: 403, code: 'not_public', message: 'Only a live, public listing can be advertised. Publish it first.' }
  return { ok: true, listing: { id: row.id, title: row.title, categorySlug: row.category.slug, subcategorySlug: row.subcategorySlug } }
}

export type AdCreativeCheck =
  | { ok: true; creative: { id: string; contentHash: string } }
  | { ok: false; status: 403 | 404 | 409; code: string; message: string }

/** The caller's own creative, approved by the review and not removed by eno — by a review that counts here (a preview's
 *  provisional approval never does where AD_REVIEW_ALLOW_PROVISIONAL is off: review-jev.ts reviewCountsHere). */
export async function checkAdCreative(creativeId: string, sellerId: string): Promise<AdCreativeCheck> {
  if (!sellerId) return { ok: false, status: 403, code: 'shop_required', message: 'Ads are bought by a shop: connect with a shop account.' }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(creativeId)) return { ok: false, status: 404, code: 'not_found', message: 'Ad creative not found in this shop.' }
  const c = await db.adCreative.findUnique({ where: { id: creativeId }, select: { id: true, sellerId: true, status: true, contentHash: true, reviewModel: true, reviewedAt: true } })
  if (!c || c.sellerId !== sellerId) return { ok: false, status: 404, code: 'not_found', message: 'Ad creative not found in this shop.' }
  if (c.status === 'removed') return { ok: false, status: 409, code: 'creative_removed', message: 'eno removed this ad creative; it can no longer run.' }
  if (c.status !== 'approved') return { ok: false, status: 409, code: 'creative_refused', message: 'This ad creative did not pass the review; change it and submit it again.' }
  // ⛔ An approval is good for a week of bookings (commit gate, opus): the landing page is only read at the review, so a
  // creative bought again and again must be looked at again — submitting the same fields reviews it afresh.
  if (!reviewCountsHere(c.reviewModel) || Date.now() - c.reviewedAt.getTime() > AD_APPROVAL_VALID_MS) {
    return { ok: false, status: 409, code: 'creative_review_stale', message: 'This ad creative\'s review is too old or does not count here; submit it again for a new review.' }
  }
  return { ok: true, creative: { id: c.id, contentHash: c.contentHash } }
}

/**
 * Paid → active: consecutive runs per target (a listing or a creative), under a transaction-scoped advisory lock. ONE path
 * for both rails: an x402 settlement (`activate`, from pending/unknown) and a bank transfer an admin confirmed (bank.ts
 * markBankOrderPaid, from awaiting_transfer). Guarded on `from`, so two activations racing (a reconcile and the original
 * request; two admins pressing Mark paid) start the row once — `won` says whether THIS call did. A creative eno removed
 * in the meantime is NEVER activated: the paid row goes to `review` (a manual refund), with what `paid` records kept.
 */
export async function activateRow(
  rowId: string,
  from: Prisma.ListingAdWhereInput,
  paid: (row: { payloadJson: Prisma.JsonValue }) => Prisma.ListingAdUpdateManyMutationInput,
  at?: Date,
): Promise<{ ad: AdRow; won: boolean }> {
  return db.$transaction(async (tx) => {
    // The target is immutable on the row, so reading it before the lock is safe; so is the payload (nothing rewrites it
    // while the row is still open).
    const row = await tx.listingAd.findUniqueOrThrow({ where: { id: rowId }, select: { durationSec: true, listingId: true, creativeId: true, sellerId: true, payloadJson: true } })
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${adLockKey(row)}))`
    if (row.creativeId) {
      const c = await tx.adCreative.findUnique({ where: { id: row.creativeId }, select: { status: true, sellerId: true, reviewModel: true } })
      if (!c || c.status !== 'approved' || c.sellerId !== row.sellerId || !reviewCountsHere(c.reviewModel)) {
        // Loud: money moved for an ad that will not run — the owner refunds it by hand (the advertising policy says so).
        logError(new Error('ads: paid for a creative that can no longer run'), { op: 'ads.creative-removed-paid', adId: rowId, creativeId: row.creativeId })
        const r = await tx.listingAd.updateMany({
          where: { id: rowId, ...from },
          data: { status: 'review', ...paid(row), failReason: CREATIVE_REMOVED_PAID },
        })
        return { ad: await tx.listingAd.findUniqueOrThrow({ where: { id: rowId } }), won: r.count > 0 }
      }
    }
    const now = at ?? new Date()
    const last = await tx.listingAd.findFirst({
      where: { ...targetWhere(row), status: 'active', endsAt: { gt: now } },
      orderBy: { endsAt: 'desc' },
      select: { endsAt: true },
    })
    const startsAt = last?.endsAt && last.endsAt > now ? last.endsAt : now
    // The row's own length (whole hours, as bought), stored when it was booked.
    const endsAt = new Date(startsAt.getTime() + row.durationSec * 1000)
    const r = await tx.listingAd.updateMany({
      where: { id: rowId, ...from },
      data: { status: 'active', startsAt, endsAt, ...paid(row), failReason: null },
    })
    return { ad: await tx.listingAd.findUniqueOrThrow({ where: { id: rowId } }), won: r.count > 0 }
  })
}

/** An x402 settlement: pending/unknown → active (activateRow), the transaction and the settlement kept on the row. */
async function activate(rowId: string, txHash: string, settlement: SettlementResponse): Promise<AdRow> {
  const settled = { txHash, settlementJson: settlement as unknown as Prisma.InputJsonValue }
  return (await activateRow(rowId, { status: { in: ['pending', 'unknown'] } }, () => settled)).ad
}

function storedSettlement(ad: AdRow): SettlementResponse {
  const s = ad.settlementJson as SettlementResponse | null
  return s ?? { success: true, transaction: ad.txHash ?? '', network: ad.network, payer: ad.authFrom }
}

/** The offer a row was bought at, from the ROW — never the current config, which may have changed since (gate review). */
function rowRequirements(ad: AdRow): PaymentRequirements {
  const accepted = (ad.payloadJson as { accepted?: { extra?: { name?: unknown; version?: unknown } } } | null)?.accepted
  const extra = { name: String(accepted?.extra?.name ?? ''), version: String(accepted?.extra?.version ?? '') }
  return { scheme: 'exact', network: ad.network, amount: ad.amount, asset: ad.asset, payTo: ad.payTo, maxTimeoutSeconds: 300, extra }
}

/** Grace past validBefore before an authorization never seen on chain is called unpaid (the last block can lag). */
const EXPIRY_GRACE_S = 600
/** A pending row untouched this long belongs to a request that died between the row and the settlement. */
const STALE_PENDING_MS = 60_000
/** How long a used-but-unmatched authorization is retried before the owner looks at it by hand. */
const REVIEW_AFTER_MS = 7 * 86_400_000

/**
 * A row whose outcome is not known (gate review 2026-11-23: "a crash before settlement strands the authorization"):
 *   1. on chain (AuthorizationUsed for its from+nonce, paying its payTo its amount) → active;
 *   2. past validBefore + grace AND the contract says the authorization was never used (authorizationState false — the
 *      contract's own storage, not a log search) → FAILED for good: it can no longer move money. Used but no matching
 *      transfer found → stays unknown and is logged for the owner: never "failed", never "nothing was charged";
 *   3. still `pending`, still valid and stale (the request that wrote it died before the facilitator answered) → settle it
 *      again with the stored payload and the ROW's offer — only when `resettle` (the cron sweep and the buyer's own retry;
 *      never a read such as list_ads). An `unknown` row (refused or lost) is never re-sent. A refusal here is NOT a
 *      failure (the first broadcast may still be mining): the row becomes unknown.
 */
export async function reconcileAd(cfg: X402Config, ad: AdRow, fetchImpl: typeof fetch = fetch, now = new Date(), opts: { resettle?: boolean } = {}): Promise<AdRow> {
  const resettle = opts.resettle ?? true
  if (ad.status !== 'pending' && ad.status !== 'unknown') return ad
  const ours = rowRequirements(ad)
  const validBefore = Number(ad.authValidBefore)
  try {
    const hit = await findAuthorizationPayment(ours, { from: ad.authFrom, nonce: ad.authNonce, amount: ad.amount, since: ad.createdAt, validBefore }, fetchImpl)
    if (hit.found) return await activate(ad.id, hit.txHash, { success: true, transaction: hit.txHash, network: ad.network, payer: ad.authFrom })
    const nowSec = now.getTime() / 1000
    if (nowSec > validBefore + EXPIRY_GRACE_S) {
      if (await authorizationUsed(ours, { from: ad.authFrom, nonce: ad.authNonce }, fetchImpl)) {
        // Used or cancelled. A cancellation (its own event, searched with the payment) moved nothing: unpaid for good.
        if (hit.cancelled) {
          await db.listingAd.updateMany({ where: { id: ad.id, status: { in: ['pending', 'unknown'] } }, data: { status: 'failed', failReason: UNPAID_CANCELLED } })
          return db.listingAd.findUniqueOrThrow({ where: { id: ad.id } })
        }
        // Used (or cancelled after its window) with no transfer of its own found: never "failed", never shown. After a week
        // of sweeps it is handed to the owner (`review`: no more automatic retries) — the row holds the whole authorization.
        logWarn('ads.reconcile used but no transfer found', { adId: ad.id })
        const review = now.getTime() - ad.createdAt.getTime() > REVIEW_AFTER_MS
        // Loud: nothing else tells the owner a row needs a person (the row holds the whole authorization to look it up).
        if (review) logError(new Error('ads: payment needs review'), { op: 'ads.review', adId: ad.id, from: ad.authFrom, nonce: ad.authNonce })
        await db.listingAd.updateMany({ where: { id: ad.id, status: { in: ['pending', 'unknown'] } }, data: { status: review ? 'review' : 'unknown', failReason: 'used_no_transfer_found' } })
        return db.listingAd.findUniqueOrThrow({ where: { id: ad.id } })
      }
      await db.listingAd.updateMany({ where: { id: ad.id, status: { in: ['pending', 'unknown'] } }, data: { status: 'failed', failReason: UNPAID_EXPIRED } })
      return db.listingAd.findUniqueOrThrow({ where: { id: ad.id } })
    }
    // ⛔ ONLY A `pending` ROW IS EVER SETTLED AGAIN — one whose request died before the facilitator answered. An `unknown` row
    // was refused or lost, and its buyer was told so (and may have signed a new payment since): re-submitting it could charge
    // twice for one ad they think failed. Those are only LOOKED UP on chain (above), never re-sent (gate review 2026-11-23).
    if (!resettle || ad.status !== 'pending' || now.getTime() - ad.updatedAt.getTime() < STALE_PENDING_MS) return ad
    const parsed = paymentPayloadSchema.safeParse(ad.payloadJson)
    if (!parsed.success) return ad
    // Re-settling uses the facilitator named by the CURRENT config (the key lives there) with the row's own offer.
    const settled = await facilitatorSettle(cfg, parsed.data, ours, fetchImpl)
    if (settled.kind === 'settled') return await activate(ad.id, settled.response.transaction, settled.response)
    await db.listingAd.updateMany({ where: { id: ad.id, status: { in: ['pending', 'unknown'] } }, data: { status: 'unknown', failReason: (settled.kind === 'refused' ? settled.reason : settled.detail).slice(0, 200) } })
    return db.listingAd.findUniqueOrThrow({ where: { id: ad.id } })
  } catch (e) {
    logError(e, { op: 'ads.reconcile', adId: ad.id })
    // Touch the row (updatedAt) so the sweep, which takes the least recently tried first, moves on to the others.
    await db.listingAd.updateMany({ where: { id: ad.id, status: { in: ['pending', 'unknown'] } }, data: { failReason: 'reconcile_error' } }).catch((e2) => logError(e2, { op: 'ads.reconcile-touch' }))
    return ad
  }
}

/** The backstop for rows nobody came back for (/api/cron/ads-reconcile, and a shop's own list_ads for its rows). */
export async function reconcileOpenAds(cfg: X402Config, opts: { sellerId?: string; limit?: number; resettle?: boolean } = {}, fetchImpl: typeof fetch = fetch): Promise<{ checked: number; activated: number; failed: number }> {
  const rows = await db.listingAd.findMany({
    where: { status: { in: ['pending', 'unknown'] }, ...(opts.sellerId ? { sellerId: opts.sellerId } : {}), updatedAt: { lt: new Date(Date.now() - STALE_PENDING_MS) } },
    // Least recently tried first: a row that keeps erroring is touched each time (reconcileAd), so it cannot starve the rest.
    orderBy: { updatedAt: 'asc' },
    take: opts.limit ?? 50,
  })
  let activated = 0
  let failed = 0
  for (const row of rows) {
    const after = await reconcileAd(cfg, row, fetchImpl, new Date(), { resettle: opts.resettle ?? true })
    if (after.status === 'active') activated++
    else if (after.status === 'failed') failed++
  }
  return { checked: rows.length, activated, failed }
}

function reviewAnswer(ad: AdRow): BookResult {
  return { kind: 'refused', status: 409, code: 'payment_under_review', message: `This payment is being checked by hand. Write to support@eno.vn with the ad id ${ad.id}.` }
}

/** Whether a payment's row advertises what this request names. A creative reviewed again (after its 24 h reuse window) is
 *  a new row with the SAME content from the SAME shop: that is still the same ad, so an honest late retry finds it. */
async function sameTarget(ad: AdRow, target: AdTarget): Promise<boolean> {
  if (target.creativeId === undefined) return ad.listingId === target.listingId
  if (!ad.creativeId) return false
  if (ad.creativeId === target.creativeId) return true
  const [a, b] = await Promise.all([ad.creativeId, target.creativeId].map((id) => db.adCreative.findUnique({ where: { id }, select: { sellerId: true, contentHash: true } })))
  return !!a && !!b && a.sellerId === b.sellerId && a.contentHash === b.contentHash
}

async function outcomeOf(cfg: X402Config, ad: AdRow, target: AdTarget, sellerId: string, fetchImpl: typeof fetch): Promise<BookResult> {
  if (ad.sellerId !== sellerId || !(await sameTarget(ad, target))) {
    return { kind: 'refused', status: 409, code: 'payment_already_used', message: 'This payment was already used for another ad.' }
  }
  if (ad.status === 'active') return { kind: 'booked', ad, settlement: storedSettlement(ad), replay: true }
  if (ad.status === 'failed') return { kind: 'payment_failed', reason: ad.failReason || 'settle_refused', settlement: (ad.settlementJson as SettlementResponse | null) ?? null }
  if (ad.status === 'review') return reviewAnswer(ad)
  const after = await reconcileAd(cfg, ad, fetchImpl)
  if (after.status === 'active') return { kind: 'booked', ad: after, settlement: storedSettlement(after), replay: true }
  if (after.status === 'failed') return { kind: 'payment_failed', reason: after.failReason || 'unpaid', settlement: null }
  if (after.status === 'review') return reviewAnswer(after)
  return { kind: 'pending', ad: after }
}

export async function bookAd(p: {
  cfg: X402Config
  keyId: string
  sellerId: string
  /** The credential's person (ApiAuth.profileId): while creative ads are in their private test (creative-gate.ts) a
   *  creative is booked only for an admin — absent, it is refused. A listing ad does not read it. */
  profileId?: string
  /** Exactly one of the two: a listing of this shop, or an approved creative of this shop. */
  listingId?: string
  creativeId?: string
  rawPayload: unknown
  via: 'http' | 'mcp'
  /** Whole hours, 1..AD_MAX_HOURS (default a week; callers validate with adHours): the price the payment must match, and
   *  how long the ad runs. */
  hours?: number
  fetchImpl?: typeof fetch
}): Promise<BookResult> {
  const hours = p.hours ?? AD_WEEK_HOURS
  const fetchImpl = p.fetchImpl ?? fetch
  if (!!p.listingId === !!p.creativeId) return { kind: 'refused', status: 400, code: 'invalid_input', message: 'Name either a listingId or a creative, not both.' }
  const target: AdTarget = p.listingId ? { listingId: p.listingId } : { creativeId: p.creativeId! }
  if (target.creativeId !== undefined && hours > AD_CREATIVE_MAX_HOURS) return { kind: 'refused', status: 400, code: 'invalid_input', message: `A creative ad runs 1 to ${AD_CREATIVE_MAX_HOURS} hours.` }
  // ⛔ THE SAME PAYMENT FINDS ITS ROW BEFORE IT IS CHECKED AGAINST TODAY'S OFFER (gate review 2026-11-23): a price, wallet or
  // network changed since must not stop an already-paid ad from being recovered. The id comes from the payload's own
  // network, asset, sender and nonce — what a new booking below must also match.
  const shape = paymentPayloadSchema.safeParse(p.rawPayload)
  if (!shape.success) return { kind: 'payment_invalid', reason: 'invalid_payload' }
  const a = shape.data.payload.authorization
  const paymentId = paymentIdOf(shape.data.accepted.network, shape.data.accepted.asset, a.from, a.nonce)
  const existing = await db.listingAd.findUnique({ where: { paymentId } })
  if (existing) return outcomeOf(p.cfg, existing, target, p.sellerId, fetchImpl)

  const ours = adRequirements(p.cfg, hours)
  const checked = checkPayload(p.rawPayload, ours)
  if (!checked.ok) return { kind: 'payment_invalid', reason: checked.reason }
  const payload: PaymentPayload = checked.payload
  const auth = payload.payload.authorization

  // The target, BEFORE the facilitator is asked anything: a refused one never touches money. A creative while the private
  // test runs: an admin's only (creative-gate.ts) — the route and create_ad refuse first, this is so a payment cannot.
  // (After the replay lookup above: a payment already recorded keeps its own outcome.)
  if (target.creativeId !== undefined && !(await creativeAdsAllowed(p.profileId))) {
    return { kind: 'refused', status: CREATIVE_ADS_NOT_OPEN.status, code: CREATIVE_ADS_NOT_OPEN.code, message: CREATIVE_ADS_NOT_OPEN.message }
  }
  const targetCheck = target.creativeId !== undefined ? await checkAdCreative(target.creativeId, p.sellerId) : await checkAdListing(target.listingId, p.sellerId)
  if (!targetCheck.ok) return { kind: 'refused', status: targetCheck.status, code: targetCheck.code, message: targetCheck.message }

  const verified = await facilitatorVerify(p.cfg, payload, ours, fetchImpl)
  if (verified.kind === 'invalid') return { kind: 'payment_invalid', reason: verified.reason }
  if (verified.kind === 'error') {
    logWarn('ads.verify unavailable', { detail: verified.detail })
    return { kind: 'unavailable', message: 'The payment service did not answer; nothing was charged. Try again in a minute.' }
  }

  let row: AdRow
  try {
    row = await db.listingAd.create({
      data: {
        listingId: target.listingId ?? null,
        creativeId: target.creativeId ?? null,
        sellerId: p.sellerId,
        bookedByKeyId: p.keyId,
        via: p.via,
        durationSec: hours * 3600,
        status: 'pending',
        amount: ours.amount,
        asset: ours.asset,
        network: ours.network,
        payTo: ours.payTo,
        paymentId,
        authFrom: auth.from.toLowerCase(),
        authNonce: auth.nonce.toLowerCase(),
        authValidBefore: auth.validBefore,
        signature: payload.payload.signature,
        payloadJson: payload as unknown as Prisma.InputJsonValue,
      },
    })
  } catch (e) {
    // A parallel request with the same authorization got there first: answer with its outcome.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const raced = await db.listingAd.findUnique({ where: { paymentId } })
      if (raced) return outcomeOf(p.cfg, raced, target, p.sellerId, fetchImpl)
    }
    throw e
  }

  const settled = await facilitatorSettle(p.cfg, payload, ours, fetchImpl)
  if (settled.kind === 'refused' && settledBeforeBroadcast(settled.reason)) {
    // ⛔ THE BUYER HEARS "REFUSED", THE ROW STAYS OPEN (gate review 2026-11-23): even a verification code can come back
    // after the money moved (the signed payload is public once sent — anyone may submit it first, and the USDC still lands
    // in payTo). So the row is `unknown`, and reconcileAd lets the contract decide once the authorization expires: used and
    // paid to us → the ad starts after all; never used → failed.
    await db.listingAd.updateMany({
      where: { id: row.id, status: 'pending' },
      data: { status: 'unknown', failReason: settled.reason, ...(settled.response ? { settlementJson: settled.response as unknown as Prisma.InputJsonValue } : {}) },
    })
    return { kind: 'payment_failed', reason: settled.reason, settlement: settled.response }
  }
  if (settled.kind !== 'settled') {
    // Lost, or refused for a reason that does not prove nothing was broadcast: never "failed" here — the chain decides
    // (reconcileAd: paid → active; past validBefore and never used → failed).
    const detail = settled.kind === 'unknown' ? settled.detail : settled.reason
    logWarn('ads.settle outcome not final', { adId: row.id, detail })
    if (settled.kind === 'refused' && settled.response) await db.listingAd.updateMany({ where: { id: row.id, status: 'pending' }, data: { settlementJson: settled.response as unknown as Prisma.InputJsonValue } })
    await db.listingAd.updateMany({ where: { id: row.id, status: 'pending' }, data: { status: 'unknown', failReason: detail.slice(0, 200) } })
    const fresh = await db.listingAd.findUniqueOrThrow({ where: { id: row.id } })
    const after = await reconcileAd(p.cfg, fresh, fetchImpl)
    if (after.status === 'active') return { kind: 'booked', ad: after, settlement: storedSettlement(after), replay: false }
    if (after.status === 'review') return reviewAnswer(after)
    return { kind: 'pending', ad: after }
  }

  // Settled: the money moved. The activation write is retried; if the database still refuses, the row stays pending
  // with the whole authorization, and a retry of the same payload (or reconcileAd) finds the transfer on chain.
  for (let attempt = 1; ; attempt++) {
    try {
      const ad = await activate(row.id, settled.response.transaction, settled.response)
      // A creative removed while this payment settled: paid, not running — the buyer is told to write to support.
      if (ad.status === 'review') return reviewAnswer(ad)
      return { kind: 'booked', ad, settlement: settled.response, replay: false }
    } catch (e) {
      if (attempt >= 3) {
        logError(e, { op: 'ads.activate', adId: row.id, tx: settled.response.transaction })
        throw e
      }
      await new Promise((r) => setTimeout(r, 250 * attempt))
    }
  }
}

/** What an ad has done: exact impressions and taps (counted only inside its window — /api/ads/[id]/event), and the
 *  listing's own views and contacts over the ad's days, from the daily snapshots (src/lib/listing-analytics.ts). */
export type AdStats = {
  id: string; listing_id: string | null; creative_id: string | null; status: string; hours: number; starts_at: string | null; ends_at: string | null
  impressions: number; clicks: number; listing_views: number | null; listing_contacts: number | null
  /** ⛔ IN THE ROW'S OWN CURRENCY (stats.ts adCurrency): an x402 row's price in USDC atomic units, a bank-transfer row's in
   *  whole đồng — never one read as the other (99000 đồng is not 0.099 USDC). */
  currency: 'USDC' | 'VND'; amount_usdc_atomic: string | null; amount_vnd: number | null
  network: string; tx_hash: string | null
}

export async function shopAds(sellerId: string, limit = 50, cfg: X402Config | null = null): Promise<AdStats[]> {
  // A shop asking about its ads settles its own open rows first (bounded), so a lost confirmation shows up here too.
  // ⛔ LOOK-UP ONLY (resettle: false): this answers a read (list_ads is readOnlyHint), so it never asks for a settlement.
  if (cfg) await reconcileOpenAds(cfg, { sellerId, limit: 5, resettle: false }).catch((e) => logError(e, { op: 'ads.reconcile-shop' }))
  // ⛔ A paid ad's statuses only: a bank order still awaiting its transfer, or cancelled, is no ad (bank.ts).
  const ads = await db.listingAd.findMany({
    where: { sellerId, status: { in: ['active', 'pending', 'unknown', 'review'] } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
  })
  const now = new Date()
  const out: AdStats[] = []
  for (const ad of ads) {
    let views: number | null = null
    let contacts: number | null = null
    // Daily snapshots cannot resolve an ad shorter than a day: its listing figures stay null (impressions/taps are exact).
    // A listing ad only: a creative ad has no listing of its own (its own figures are impressions and clicks, stats.ts).
    if (ad.listingId && ad.status === 'active' && ad.startsAt && ad.startsAt <= now && ad.durationSec >= 86_400) {
      const startDay = new Date(ad.startsAt); startDay.setUTCHours(0, 0, 0, 0)
      const base = await db.listingDailyStat.findFirst({ where: { listingId: ad.listingId, day: { lt: startDay } }, orderBy: { day: 'desc' }, select: { views: true, leads: true } })
      let end: { views: number; leads: number } | null = null
      if (ad.endsAt && ad.endsAt <= now) {
        end = await db.listingDailyStat.findFirst({ where: { listingId: ad.listingId, day: { lte: ad.endsAt } }, orderBy: { day: 'desc' }, select: { views: true, leads: true } })
      } else {
        // edition-lint-allow: two counters of the caller's own advertised listing (the ad row is sellerId-scoped above).
        const l = await db.listing.findUnique({ where: { id: ad.listingId }, select: { views: true, contactCount: true } })
        end = l ? { views: l.views, leads: l.contactCount } : null
      }
      if (base && end) {
        views = Math.max(0, end.views - base.views)
        contacts = Math.max(0, end.leads - base.leads)
      }
    }
    out.push({
      id: ad.id, listing_id: ad.listingId, creative_id: ad.creativeId, status: ad.status, hours: Math.round(ad.durationSec / 3600),
      starts_at: ad.startsAt?.toISOString() ?? null, ends_at: ad.endsAt?.toISOString() ?? null,
      impressions: ad.impressions, clicks: ad.clicks, listing_views: views, listing_contacts: contacts,
      ...(adCurrency(ad) === 'VND'
        ? { currency: 'VND' as const, amount_usdc_atomic: null, amount_vnd: Number(ad.amount) }
        : { currency: 'USDC' as const, amount_usdc_atomic: ad.amount, amount_vnd: null }),
      network: ad.network, tx_hash: ad.txHash,
    })
  }
  return out
}
