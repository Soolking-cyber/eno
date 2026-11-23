import 'server-only'
import crypto from 'crypto'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { buildFeedFilters } from '@/app/api/listings/feed-query'
import { logError, logWarn } from '@/lib/log'
import { AD_DAYS, adRequirements, type X402Config } from '@/lib/x402/config'
import { facilitatorSettle, facilitatorVerify } from '@/lib/x402/facilitator'
import { authorizationUsed, findAuthorizationPayment } from '@/lib/x402/chain'
import { checkPayload, paymentPayloadSchema, type PaymentPayload, type PaymentRequirements, type SettlementResponse } from '@/lib/x402/wire'

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
 */
export const AD_EXCLUDED_SUBCATEGORIES: readonly string[] = ['visa-legal', 'legal-permits']
const DAY_MS = 86_400_000

export type AdRow = Prisma.ListingAdGetPayload<object>

export type BookResult =
  | { kind: 'booked'; ad: AdRow; settlement: SettlementResponse; replay: boolean }
  | { kind: 'pending'; ad: AdRow }
  | { kind: 'payment_invalid'; reason: string }
  | { kind: 'payment_failed'; reason: string; settlement: SettlementResponse | null }
  | { kind: 'refused'; status: 400 | 403 | 404 | 409; code: string; message: string }
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

/** Settled → active: consecutive weeks per listing, under a transaction-scoped advisory lock. Guarded on the status, so a
 *  reconcile racing the original request activates once. */
async function activate(rowId: string, listingId: string, txHash: string, settlement: SettlementResponse): Promise<AdRow> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`listing-ad:${listingId}`}))`
    const now = new Date()
    const last = await tx.listingAd.findFirst({
      where: { listingId, status: 'active', endsAt: { gt: now } },
      orderBy: { endsAt: 'desc' },
      select: { endsAt: true },
    })
    const startsAt = last?.endsAt && last.endsAt > now ? last.endsAt : now
    const endsAt = new Date(startsAt.getTime() + AD_DAYS * DAY_MS)
    await tx.listingAd.updateMany({
      where: { id: rowId, status: { in: ['pending', 'unknown'] } },
      data: { status: 'active', startsAt, endsAt, txHash, settlementJson: settlement as unknown as Prisma.InputJsonValue, failReason: null },
    })
    return tx.listingAd.findUniqueOrThrow({ where: { id: rowId } })
  })
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

/**
 * A row whose outcome is not known (gate review 2026-11-23: "a crash before settlement strands the authorization"):
 *   1. on chain (AuthorizationUsed for its from+nonce, paying its payTo its amount) → active;
 *   2. past validBefore + grace AND the contract says the authorization was never used (authorizationState false — the
 *      contract's own storage, not a log search) → FAILED for good: it can no longer move money. Used but no matching
 *      transfer found → stays unknown and is logged for the owner: never "failed", never "nothing was charged";
 *   3. still valid and stale (the request that wrote it died before settling) → settle it again with the stored payload
 *      and the ROW's offer — only when `resettle` (the cron sweep and the buyer's own retry; never a read such as
 *      list_ads). A refusal here is NOT a failure (the first broadcast may still be mining): the row stays unknown.
 */
export async function reconcileAd(cfg: X402Config, ad: AdRow, fetchImpl: typeof fetch = fetch, now = new Date(), opts: { resettle?: boolean } = {}): Promise<AdRow> {
  const resettle = opts.resettle ?? true
  if (ad.status !== 'pending' && ad.status !== 'unknown') return ad
  const ours = rowRequirements(ad)
  const validBefore = Number(ad.authValidBefore)
  try {
    const hit = await findAuthorizationPayment(ours, { from: ad.authFrom, nonce: ad.authNonce, amount: ad.amount, since: ad.createdAt, validBefore }, fetchImpl)
    if (hit.found) return await activate(ad.id, ad.listingId, hit.txHash, { success: true, transaction: hit.txHash, network: ad.network, payer: ad.authFrom })
    const nowSec = now.getTime() / 1000
    if (nowSec > validBefore + EXPIRY_GRACE_S) {
      if (await authorizationUsed(ours, { from: ad.authFrom, nonce: ad.authNonce }, fetchImpl)) {
        logWarn('ads.reconcile used but no transfer found', { adId: ad.id })
        await db.listingAd.updateMany({ where: { id: ad.id, status: { in: ['pending', 'unknown'] } }, data: { status: 'unknown', failReason: 'used_no_transfer_found' } })
        return db.listingAd.findUniqueOrThrow({ where: { id: ad.id } })
      }
      await db.listingAd.updateMany({ where: { id: ad.id, status: { in: ['pending', 'unknown'] } }, data: { status: 'failed', failReason: 'authorization_expired_unpaid' } })
      return db.listingAd.findUniqueOrThrow({ where: { id: ad.id } })
    }
    if (!resettle || now.getTime() - ad.updatedAt.getTime() < STALE_PENDING_MS) return ad
    const parsed = paymentPayloadSchema.safeParse(ad.payloadJson)
    if (!parsed.success) return ad
    // Re-settling uses the facilitator named by the CURRENT config (the key lives there) with the row's own offer.
    const settled = await facilitatorSettle(cfg, parsed.data, ours, fetchImpl)
    if (settled.kind === 'settled') return await activate(ad.id, ad.listingId, settled.response.transaction, settled.response)
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

async function outcomeOf(cfg: X402Config, ad: AdRow, listingId: string, sellerId: string, fetchImpl: typeof fetch): Promise<BookResult> {
  if (ad.listingId !== listingId || ad.sellerId !== sellerId) {
    return { kind: 'refused', status: 409, code: 'payment_already_used', message: 'This payment was already used for another ad.' }
  }
  if (ad.status === 'active') return { kind: 'booked', ad, settlement: storedSettlement(ad), replay: true }
  if (ad.status === 'failed') return { kind: 'payment_failed', reason: ad.failReason || 'settle_refused', settlement: (ad.settlementJson as SettlementResponse | null) ?? null }
  const after = await reconcileAd(cfg, ad, fetchImpl)
  if (after.status === 'active') return { kind: 'booked', ad: after, settlement: storedSettlement(after), replay: true }
  return { kind: 'pending', ad: after }
}

export async function bookAd(p: {
  cfg: X402Config
  keyId: string
  sellerId: string
  listingId: string
  rawPayload: unknown
  via: 'http' | 'mcp'
  fetchImpl?: typeof fetch
}): Promise<BookResult> {
  const fetchImpl = p.fetchImpl ?? fetch
  // ⛔ THE SAME PAYMENT FINDS ITS ROW BEFORE IT IS CHECKED AGAINST TODAY'S OFFER (gate review 2026-11-23): a price, wallet or
  // network changed since must not stop an already-paid ad from being recovered. The id comes from the payload's own
  // network, asset, sender and nonce — what a new booking below must also match.
  const shape = paymentPayloadSchema.safeParse(p.rawPayload)
  if (!shape.success) return { kind: 'payment_invalid', reason: 'invalid_payload' }
  const a = shape.data.payload.authorization
  const paymentId = paymentIdOf(shape.data.accepted.network, shape.data.accepted.asset, a.from, a.nonce)
  const existing = await db.listingAd.findUnique({ where: { paymentId } })
  if (existing) return outcomeOf(p.cfg, existing, p.listingId, p.sellerId, fetchImpl)

  const ours = adRequirements(p.cfg)
  const checked = checkPayload(p.rawPayload, ours)
  if (!checked.ok) return { kind: 'payment_invalid', reason: checked.reason }
  const payload: PaymentPayload = checked.payload
  const auth = payload.payload.authorization

  const listing = await checkAdListing(p.listingId, p.sellerId)
  if (!listing.ok) return { kind: 'refused', status: listing.status, code: listing.code, message: listing.message }

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
        listingId: p.listingId,
        sellerId: p.sellerId,
        bookedByKeyId: p.keyId,
        via: p.via,
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
      if (raced) return outcomeOf(p.cfg, raced, p.listingId, p.sellerId, fetchImpl)
    }
    throw e
  }

  const settled = await facilitatorSettle(p.cfg, payload, ours, fetchImpl)
  if (settled.kind === 'refused') {
    await db.listingAd.updateMany({
      where: { id: row.id, status: 'pending' },
      data: { status: 'failed', failReason: settled.reason, ...(settled.response ? { settlementJson: settled.response as unknown as Prisma.InputJsonValue } : {}) },
    })
    return { kind: 'payment_failed', reason: settled.reason, settlement: settled.response }
  }
  if (settled.kind === 'unknown') {
    logWarn('ads.settle answer lost', { adId: row.id, detail: settled.detail })
    await db.listingAd.updateMany({ where: { id: row.id, status: 'pending' }, data: { status: 'unknown', failReason: settled.detail.slice(0, 200) } })
    const fresh = await db.listingAd.findUniqueOrThrow({ where: { id: row.id } })
    const after = await reconcileAd(p.cfg, fresh, fetchImpl)
    if (after.status === 'active') return { kind: 'booked', ad: after, settlement: storedSettlement(after), replay: false }
    return { kind: 'pending', ad: after }
  }

  // Settled: the money moved. The activation write is retried; if the database still refuses, the row stays pending
  // with the whole authorization, and a retry of the same payload (or reconcileAd) finds the transfer on chain.
  for (let attempt = 1; ; attempt++) {
    try {
      const ad = await activate(row.id, p.listingId, settled.response.transaction, settled.response)
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
  id: string; listing_id: string; status: string; starts_at: string | null; ends_at: string | null
  impressions: number; clicks: number; listing_views: number | null; listing_contacts: number | null
  amount_usdc_atomic: string; network: string; tx_hash: string | null
}

export async function shopAds(sellerId: string, limit = 50, cfg: X402Config | null = null): Promise<AdStats[]> {
  // A shop asking about its ads settles its own open rows first (bounded), so a lost confirmation shows up here too.
  // ⛔ LOOK-UP ONLY (resettle: false): this answers a read (list_ads is readOnlyHint), so it never asks for a settlement.
  if (cfg) await reconcileOpenAds(cfg, { sellerId, limit: 5, resettle: false }).catch((e) => logError(e, { op: 'ads.reconcile-shop' }))
  const ads = await db.listingAd.findMany({
    where: { sellerId, status: { in: ['active', 'pending', 'unknown'] } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
  })
  const now = new Date()
  const out: AdStats[] = []
  for (const ad of ads) {
    let views: number | null = null
    let contacts: number | null = null
    if (ad.status === 'active' && ad.startsAt && ad.startsAt <= now) {
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
      id: ad.id, listing_id: ad.listingId, status: ad.status,
      starts_at: ad.startsAt?.toISOString() ?? null, ends_at: ad.endsAt?.toISOString() ?? null,
      impressions: ad.impressions, clicks: ad.clicks, listing_views: views, listing_contacts: contacts,
      amount_usdc_atomic: ad.amount, network: ad.network, tx_hash: ad.txHash,
    })
  }
  return out
}
