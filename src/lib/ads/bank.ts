import 'server-only'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { buildFeedFilters } from '@/app/api/listings/feed-query'
import { rateLimit } from '@/lib/ratelimit'
import { pickLocale } from '@/lib/admin-macros'
import { sendPushToProfile } from '@/lib/push'
import { SITE_NAME } from '@/lib/edition'
import { logError, logInfo } from '@/lib/log'
import { AD_EXCLUDED_SUBCATEGORIES, activateRow, checkAdCreative, checkAdListing, type AdRow } from './book'
import { creativeAdsAllowed } from './creative-gate'
import { invalidateAdServeCache } from './serve'
import { BANK_AWAITING, BANK_CANCELLED, BANK_ORDER_DAYS, BANK_PERIOD, bankPeriodSec, isBankPeriod, type BankPeriod } from './bank-periods'
import { bankConfig, bankQr, newAdReference, type BankConfig } from './bank-config'

export { bankConfig, bankQr, newAdReference, AD_REFERENCE_RE, type BankConfig } from './bank-config'

/**
 * ── AN AD BOUGHT BY VietQR BANK TRANSFER (owner 2026-11-25: "yes our acb bank account deposit via qr minimal weekly monthly
 * quarterly ad options"; ADMIN CONFIRMS — no SePay). A signed-in shop picks one of its live listings, or its own reviewed
 * ad (a creative), and a period (bank-periods.ts: a week 99.000 đ, a month 349.000 đ, a quarter 899.000 đ); it gets a VietQR
 * code for eno's bank account carrying the amount and a short reference. When the money lands, an admin presses Mark paid
 * (Admin › Catalogue › Ads) and the ad starts through the SAME activation as an x402 payment (book.ts activateRow): now, or
 * stacked after the target's running ads.
 *
 * ⛔ NO NEW TABLE: AN ORDER IS A ListingAd ROW. Its x402 payment columns are NOT NULL, so a bank order fills them as:
 *   via 'bank' · status 'awaiting_transfer' · asset 'VND' · network 'vietqr' · amount the whole đồng as a string · payTo the
 *   BANK's short name ('ACB' — never the account number) · paymentId 'bank:<reference>' (unique, so a reference is never
 *   reused, even by a lapsed order) · authNonce the reference · authFrom the shop · authValidBefore the order's expiry (ISO)
 *   · signature '' · payloadJson { period, priceVnd, createdBy } (+ confirmedBy / confirmedAt once paid) · durationSec the
 *   period's length · bookedByKeyId `dashboard:<profile>` (there is no API key: the session made it).
 * ⛔ AN ORDER IS NOT AN AD. Every reader of paid ads names the statuses it reads, and 'awaiting_transfer' / 'cancelled' are
 *   in none: serve.ts reads 'active'; reconcile (book.ts) 'pending' / 'unknown'; shopAds and the dashboard's figures
 *   'active' / 'pending' / 'unknown' / 'review'; stats.ts shopAdFigures answers null for an order (bank.readers.test.ts).
 *   Once paid, a row's money is đồng, and every figure built on it says so (currency.ts).
 * ⛔ EXPIRY IS LAZY: an order unpaid after BANK_ORDER_DAYS reads as expired (no QR, gone from the shop's list), and the next
 *   write — the shop's next order sweeps its lapsed ones — stores status 'cancelled' with failReason 'expired'.
 * ⛔ A TRANSFER IS NEVER LOST UNDER AN UNSEEN REFERENCE: an expired order, and one the shop cancelled (it may have paid
 *   first), stay on the admin's list for 30 days and can still be marked paid — the admin, who sees the money, decides.
 *   Only eno's own Cancel closes an order for good. A listing is checked again at Mark paid: gone since the order →
 *   `review`, refunded by hand.
 * ⛔ THE ACCOUNT IS SERVER ENV, NEVER NEXT_PUBLIC (bank-config.ts bankConfig): ADS_BANK_BIN (default 970416, ACB),
 *   ADS_BANK_ACCOUNT, ADS_BANK_ACCOUNT_NAME. Unset or malformed → nothing is sold: the form says so and no order is created.
 *   It reaches a browser only on the shop's own order, as the QR and the copyable details a payer needs.
 */
export const BANK_ORDERS_PER_HOUR = 10
/** Paid by bank transfer for a listing that was no longer live when the money landed (markBankOrderPaid): `review`, for a
 *  refund by hand, as the advertising policy says. */
export const LISTING_GONE_PAID = 'listing_not_live_after_payment'
export const BANK_VIA = 'bank'
export const BANK_ORDER_TTL_MS = BANK_ORDER_DAYS * 86_400_000
/** Expired and shop-cancelled orders an admin is still shown, to find a transfer that landed on one anyway. */
const ADMIN_EXPIRED_WINDOW_MS = 30 * 86_400_000

// ── What the shop and the admin read ───────────────────────────────────────────────────────────────────────────────

type OrderPayload = { period?: unknown; priceVnd?: unknown; createdBy?: unknown; confirmedBy?: unknown; confirmedAt?: unknown }
const payloadOf = (ad: Pick<AdRow, 'payloadJson'>): OrderPayload => (ad.payloadJson && typeof ad.payloadJson === 'object' && !Array.isArray(ad.payloadJson) ? (ad.payloadJson as OrderPayload) : {})
const periodOf = (ad: Pick<AdRow, 'payloadJson'>): BankPeriod => { const p = payloadOf(ad).period; return isBankPeriod(p) ? p : 'week' }
const expiresAt = (ad: Pick<AdRow, 'createdAt'>) => new Date(ad.createdAt.getTime() + BANK_ORDER_TTL_MS)
const lapsed = (ad: Pick<AdRow, 'status' | 'createdAt'>, now: Date) => ad.status === BANK_AWAITING && expiresAt(ad).getTime() <= now.getTime()
/**
 * May an admin still start it when its money lands: awaiting (lapsed or not), closed by its expiry, or cancelled by the
 * shop — ⛔ a shop that paid and then pressed Cancel (commit gate, opus: "scan, transfer, see it still awaiting, tap
 * Cancel") must not leave a transfer under a reference nobody can see. The admin, who sees the money, decides: Mark paid,
 * or refund by hand. Never one eno itself closed, or one whose creative eno removed.
 */
const PAYABLE_CANCELLED = ['expired', 'cancelled_by_shop']
const payable = (ad: Pick<AdRow, 'status' | 'failReason'>) => ad.status === BANK_AWAITING || (ad.status === BANK_CANCELLED && PAYABLE_CANCELLED.includes(ad.failReason ?? ''))
const PAYABLE_WHERE: Prisma.ListingAdWhereInput = { via: BANK_VIA, OR: [{ status: BANK_AWAITING }, { status: BANK_CANCELLED, failReason: { in: PAYABLE_CANCELLED } }] }

export type BankOrderStatus = 'awaiting_transfer' | 'expired' | 'cancelled' | 'active' | 'review'
export type BankOrderView = {
  id: string
  reference: string
  status: BankOrderStatus
  kind: 'listing' | 'creative'
  period: BankPeriod
  amount_vnd: number
  created_at: string
  expires_at: string
  /** How to pay: only while it awaits its transfer and the account is configured. */
  pay: { bank: string; account_name: string; account_number: string; qr_svg: string } | null
}

export function orderStatus(ad: Pick<AdRow, 'status' | 'createdAt' | 'failReason'>, now: Date): BankOrderStatus {
  if (lapsed(ad, now)) return 'expired'
  if (ad.status === BANK_AWAITING) return 'awaiting_transfer'
  if (ad.status === BANK_CANCELLED) return ad.failReason === 'expired' ? 'expired' : 'cancelled'
  return ad.status === 'review' ? 'review' : 'active'
}

export function orderView(ad: AdRow, now: Date, cfg: BankConfig | null = bankConfig()): BankOrderView {
  const status = orderStatus(ad, now)
  const amount = Number(ad.amount)
  const qr = status === 'awaiting_transfer' && cfg ? bankQr(cfg, amount, ad.authNonce) : null
  return {
    id: ad.id,
    reference: ad.authNonce,
    status,
    kind: ad.creativeId ? 'creative' : 'listing',
    period: periodOf(ad),
    amount_vnd: amount,
    created_at: ad.createdAt.toISOString(),
    expires_at: expiresAt(ad).toISOString(),
    pay: qr && cfg ? { bank: cfg.bankName, account_name: cfg.accountName, account_number: cfg.account, qr_svg: qr.svg } : null,
  }
}

/** The shop's order (its QR while it awaits the transfer), or null when it is not this shop's bank order. */
export async function getBankOrder(id: string, sellerId: string, now = new Date()): Promise<BankOrderView | null> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null
  const ad = await db.listingAd.findUnique({ where: { id } })
  if (!ad || ad.sellerId !== sellerId || ad.via !== BANK_VIA) return null
  return orderView(ad, now)
}

/** The shop's orders still awaiting their transfer (not lapsed), newest first, with what each advertises. */
export type ShopOrder = Omit<BankOrderView, 'pay'> & { target: string | null }
export async function shopBankOrders(sellerId: string, now = new Date()): Promise<ShopOrder[]> {
  const rows = await db.listingAd.findMany({
    where: { sellerId, via: BANK_VIA, status: BANK_AWAITING, createdAt: { gt: new Date(now.getTime() - BANK_ORDER_TTL_MS) } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  const names = await targetNames(rows, sellerId)
  return rows.map((ad) => {
    const { pay: _pay, ...view } = orderView(ad, now, null)
    return { ...view, target: names.get(ad.id) ?? null }
  })
}

/** What each order advertises, in words: the listing's title or the creative's headline (the shop's own when scoped). */
async function targetNames(rows: AdRow[], sellerId?: string): Promise<Map<string, string>> {
  const listingIds = [...new Set(rows.flatMap((r) => (r.listingId ? [r.listingId] : [])))]
  const creativeIds = [...new Set(rows.flatMap((r) => (r.creativeId ? [r.creativeId] : [])))]
  const [listings, creatives] = await Promise.all([
    // edition-lint-allow: titles of the listings these orders name (each order's listing was checked as the shop's own
    // and live in the public feed when it was made — checkAdListing); nothing public is served from here.
    listingIds.length ? db.listing.findMany({ where: { id: { in: listingIds }, ...(sellerId ? { sellerId } : {}) }, select: { id: true, title: true } }) : Promise.resolve([] as { id: string; title: string }[]),
    creativeIds.length ? db.adCreative.findMany({ where: { id: { in: creativeIds }, ...(sellerId ? { sellerId } : {}) }, select: { id: true, headline: true } }) : Promise.resolve([] as { id: string; headline: string }[]),
  ])
  const title = new Map(listings.map((l) => [l.id, l.title] as const))
  const headline = new Map(creatives.map((c) => [c.id, c.headline] as const))
  const out = new Map<string, string>()
  for (const r of rows) {
    const name = r.listingId ? title.get(r.listingId) : r.creativeId ? headline.get(r.creativeId) : undefined
    if (name) out.set(r.id, name)
  }
  return out
}

/**
 * The shop's listings an ad may run on, for the form's picker: its own, live in the public feed of their own category
 * (the very `where` checkAdListing counts against — book.ts), outside the aisles ads exclude. One feed query per category
 * the shop sells in, never one per listing. The order is checked again, one listing, by checkAdListing.
 */
export async function adEligibleListings(sellerId: string): Promise<{ id: string; title: string }[]> {
  // edition-lint-allow: the caller's own listings (sellerId), narrowed below by buildFeedFilters' own `where`, which ANDs
  // marketplaceListingScope() (feed-query.ts) — exactly checkAdListing's test.
  const mine = await db.listing.findMany({
    where: { sellerId, status: 'active', verified: true },
    select: { id: true, title: true, subcategorySlug: true, category: { select: { slug: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })
  const candidates = mine.filter((l) => !(l.subcategorySlug && AD_EXCLUDED_SUBCATEGORIES.includes(l.subcategorySlug)))
  const byCategory = new Map<string, string[]>()
  for (const l of candidates) byCategory.set(l.category.slug, [...(byCategory.get(l.category.slug) ?? []), l.id])
  const live = new Set<string>()
  for (const [category, ids] of byCategory) {
    const { where } = await buildFeedFilters(new URLSearchParams({ category }))
    // edition-lint-allow: `where` is buildFeedFilters' own, which already ANDs marketplaceListingScope() (feed-query.ts).
    const rows = await db.listing.findMany({ where: { AND: [where, { id: { in: ids } }] }, select: { id: true } })
    for (const r of rows) live.add(r.id)
  }
  return candidates.filter((l) => live.has(l.id)).map((l) => ({ id: l.id, title: l.title }))
}

// ── The shop makes an order, and may cancel it ─────────────────────────────────────────────────────────────────────

export type OrderRefusal = 'bank_unavailable' | 'no_shop' | 'bad_request' | 'creative_ads_not_open' | 'target_refused' | 'rate_limited'
export type OrderResult =
  | { ok: true; order: BankOrderView }
  | { ok: false; status: number; code: OrderRefusal; reason?: string }

/**
 * A new order. In order: the account is configured; the shop; the kind, the target id and the period; for a creative the
 * private test (creative-gate.ts — the same gate as the API) and then an approval that counts here (book.ts
 * checkAdCreative: approved, not removed, reviewed here within a week); for a listing book.ts checkAdListing (the shop's
 * own, live, not in an excluded aisle); the shop's hourly budget (BANK_ORDERS_PER_HOUR, failing closed); then the row.
 */
export async function createBankOrder(p: { sellerId: string | null; profileId: string; kind: unknown; listingId?: unknown; creativeId?: unknown; period: unknown; now?: Date }): Promise<OrderResult> {
  const now = p.now ?? new Date()
  const cfg = bankConfig()
  if (!cfg) return { ok: false, status: 503, code: 'bank_unavailable' }
  if (!p.sellerId) return { ok: false, status: 403, code: 'no_shop' }
  const sellerId = p.sellerId
  if (!isBankPeriod(p.period) || (p.kind !== 'listing' && p.kind !== 'creative')) return { ok: false, status: 400, code: 'bad_request' }
  const targetId = p.kind === 'listing' ? p.listingId : p.creativeId
  if (typeof targetId !== 'string' || !targetId) return { ok: false, status: 400, code: 'bad_request' }
  const period = p.period

  if (p.kind === 'creative') {
    if (!(await creativeAdsAllowed(p.profileId))) return { ok: false, status: 403, code: 'creative_ads_not_open' }
    const c = await checkAdCreative(targetId, sellerId)
    if (!c.ok) return { ok: false, status: c.status, code: 'target_refused', reason: c.code }
  } else {
    const l = await checkAdListing(targetId, sellerId)
    if (!l.ok) return { ok: false, status: l.status, code: 'target_refused', reason: l.code }
  }

  const limit = await rateLimit('ad-bank-order', sellerId, BANK_ORDERS_PER_HOUR, '1 h', { strict: true })
  if (!limit.success) return { ok: false, status: 429, code: 'rate_limited' }

  // The lazy expiry's write: this shop's lapsed orders are closed now (bank.ts header).
  await db.listingAd.updateMany({
    where: { sellerId, via: BANK_VIA, status: BANK_AWAITING, createdAt: { lte: new Date(now.getTime() - BANK_ORDER_TTL_MS) } },
    data: { status: BANK_CANCELLED, failReason: 'expired' },
  })

  const priceVnd = BANK_PERIOD[period].priceVnd
  for (let attempt = 1; ; attempt++) {
    const reference = newAdReference()
    try {
      const ad = await db.listingAd.create({
        data: {
          listingId: p.kind === 'listing' ? targetId : null,
          creativeId: p.kind === 'creative' ? targetId : null,
          sellerId,
          bookedByKeyId: `dashboard:${p.profileId}`,
          via: BANK_VIA,
          durationSec: bankPeriodSec(period),
          status: BANK_AWAITING,
          amount: String(priceVnd),
          asset: 'VND',
          network: 'vietqr',
          payTo: cfg.bankName,
          paymentId: `bank:${reference}`,
          authFrom: sellerId,
          authNonce: reference,
          authValidBefore: new Date(now.getTime() + BANK_ORDER_TTL_MS).toISOString(),
          signature: '',
          payloadJson: { period, priceVnd, createdBy: p.profileId } as Prisma.InputJsonValue,
          createdAt: now,
        },
      })
      logInfo('ads_bank_order', { adId: ad.id, sellerId, period, kind: p.kind })
      return { ok: true, order: orderView(ad, now, cfg) }
    } catch (e) {
      // A reference already used (paymentId is unique): draw another. Five collisions in a row is no accident.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && attempt < 5) continue
      throw e
    }
  }
}

export type CancelResult = { ok: true; order: BankOrderView } | { ok: false; status: 404 | 409; code: 'not_found' | 'order_closed' }

/** The shop cancels its own order, only while it awaits the transfer: its QR is gone and it leaves the shop's list. Should
 *  its transfer land anyway, the admin still finds it by reference and decides (Mark paid, or a refund by hand). */
export async function cancelBankOrder(id: string, sellerId: string, now = new Date()): Promise<CancelResult> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { ok: false, status: 404, code: 'not_found' }
  const ad = await db.listingAd.findUnique({ where: { id } })
  if (!ad || ad.sellerId !== sellerId || ad.via !== BANK_VIA) return { ok: false, status: 404, code: 'not_found' }
  if (ad.status !== BANK_AWAITING) return { ok: false, status: 409, code: 'order_closed' }
  const r = await db.listingAd.updateMany({
    where: { id, sellerId, status: BANK_AWAITING },
    data: { status: BANK_CANCELLED, failReason: 'cancelled_by_shop' },
  })
  // Lost a race (an admin's Mark paid or Cancel landed first): say so, never "cancelled".
  if (!r.count) return { ok: false, status: 409, code: 'order_closed' }
  return { ok: true, order: orderView(await db.listingAd.findUniqueOrThrow({ where: { id } }), now) }
}

// ── The admin: the list, Mark paid, Cancel ─────────────────────────────────────────────────────────────────────────

export type AdminBankOrder = {
  id: string; reference: string; status: BankOrderStatus; kind: 'listing' | 'creative'; target: string | null; targetId: string
  sellerId: string; shop: string | null; period: BankPeriod; amountVnd: number; createdAt: Date; expiresAt: Date
}

/** Every order awaiting its transfer, and those that lapsed or that the shop cancelled, for 30 days past their week: a
 *  transfer that lands on one anyway is still found by its reference here (and honoured, or refunded by hand). */
export async function adminBankOrders(now = new Date()): Promise<AdminBankOrder[]> {
  // One window for all: an order made within its own week plus 30 days. ⛔ THE ORDERS STILL AWAITING COME FIRST, read on
  // their own (commit gate, opus): a shop making and cancelling orders must never push a live one off the list.
  const since = new Date(now.getTime() - BANK_ORDER_TTL_MS - ADMIN_EXPIRED_WINDOW_MS)
  const [open, closed] = await Promise.all([
    db.listingAd.findMany({ where: { via: BANK_VIA, status: BANK_AWAITING, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 200 }),
    db.listingAd.findMany({ where: { via: BANK_VIA, status: BANK_CANCELLED, failReason: { in: PAYABLE_CANCELLED }, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ])
  const rows = [...open, ...closed]
  const [names, shops] = await Promise.all([
    targetNames(rows),
    // edition-lint-allow: admin chrome — the names of the shops these orders belong to (ids from the orders); nothing public.
    rows.length ? db.seller.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.sellerId))] } }, select: { id: true, name: true } }) : Promise.resolve([] as { id: string; name: string }[]),
  ])
  const shopName = new Map(shops.map((s) => [s.id, s.name] as const))
  return rows.map((ad) => ({
    id: ad.id,
    reference: ad.authNonce,
    status: orderStatus(ad, now),
    kind: ad.creativeId ? 'creative' : 'listing',
    target: names.get(ad.id) ?? null,
    targetId: (ad.listingId ?? ad.creativeId)!,
    sellerId: ad.sellerId,
    shop: shopName.get(ad.sellerId) ?? null,
    period: periodOf(ad),
    amountVnd: Number(ad.amount),
    createdAt: ad.createdAt,
    expiresAt: expiresAt(ad),
  }))
}

export type MarkPaidResult =
  | { ok: true; already: boolean; status: string; startsAt: string | null; endsAt: string | null }
  | { ok: false; status: 404 | 409; code: 'not_found' | 'order_closed' }

/**
 * Mark paid — the money is in eno's account (an admin matched the reference on the statement). The order starts through
 * book.ts activateRow, the x402 path's own activation: under the target's lock, now or stacked after its running ads; a
 * creative eno removed in the meantime goes to `review` instead (refunded by hand). Who confirmed and when go into the
 * row's payloadJson. IDEMPOTENT: a second press (or a second admin) finds the row started and changes nothing — the
 * advertiser's notification is sent only by the press that started it.
 */
export async function markBankOrderPaid(id: string, admin: string, now = new Date()): Promise<MarkPaidResult> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { ok: false, status: 404, code: 'not_found' }
  const ad = await db.listingAd.findUnique({ where: { id } })
  if (!ad || ad.via !== BANK_VIA) return { ok: false, status: 404, code: 'not_found' }
  const done = (row: AdRow, already: boolean): MarkPaidResult => ({ ok: true, already, status: row.status, startsAt: row.startsAt?.toISOString() ?? null, endsAt: row.endsAt?.toISOString() ?? null })
  if (ad.status === 'active' || ad.status === 'review') return done(ad, true)
  if (!payable(ad)) return { ok: false, status: 409, code: 'order_closed' }
  const from = PAYABLE_WHERE
  const confirmed = (row: Pick<AdRow, 'payloadJson'>) => ({ payloadJson: { ...(payloadOf(row) as Record<string, unknown>), confirmedBy: admin, confirmedAt: now.toISOString() } as Prisma.InputJsonValue })
  // ⛔ A LISTING IS CHECKED AGAIN AT PAYMENT (commit gate, opus): days can pass between the order and the money (the week,
  // and a late transfer honoured after it), and the listing may have sold, been hidden or moved aisle since. Paid for an
  // ad that cannot show → `review`, refunded by hand — never `active` (counting spend for a card nobody sees) and never
  // the "live" bell. (A creative gets the same treatment inside activateRow.)
  if (ad.listingId && !(await checkAdListing(ad.listingId, ad.sellerId)).ok) {
    const r = await db.listingAd.updateMany({ where: { id, ...from }, data: { status: 'review', failReason: LISTING_GONE_PAID, ...confirmed(ad) } })
    const row = await db.listingAd.findUniqueOrThrow({ where: { id } })
    // Loud: money landed for an ad that will not run — the owner refunds it by hand.
    if (r.count) {
      logError(new Error('ads: paid by bank for a listing that can no longer run'), { op: 'ads.bank.listing-gone-paid', adId: id, listingId: ad.listingId })
      return done(row, false)
    }
    // Another press got there first: whatever it did stands.
    return row.status === 'review' || row.status === 'active' ? done(row, true) : { ok: false, status: 409, code: 'order_closed' }
  }
  const { ad: after, won } = await activateRow(id, from, confirmed, now)
  // Another press won between the read and the lock: whatever it did stands.
  if (!won) return after.status === 'active' || after.status === 'review' ? done(after, true) : { ok: false, status: 409, code: 'order_closed' }
  logInfo('ads_bank_paid', { adId: id, admin, status: after.status })
  if (after.status === 'active') {
    invalidateAdServeCache()
    notifyAdLive(after, now)
  }
  return done(after, false)
}

export type AdminCancelResult = { ok: true; already: boolean } | { ok: false; status: 404 | 409; code: 'not_found' | 'order_closed' }

/** Cancel — eno closes an order for good (no transfer will be honoured on it; one that lands anyway is refunded by hand),
 *  and it leaves the admin's list. Idempotent: an order eno already closed stays as it is. */
export async function adminCancelBankOrder(id: string, admin: string): Promise<AdminCancelResult> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { ok: false, status: 404, code: 'not_found' }
  const ad = await db.listingAd.findUnique({ where: { id } })
  if (!ad || ad.via !== BANK_VIA) return { ok: false, status: 404, code: 'not_found' }
  if (ad.status === BANK_CANCELLED && !payable(ad)) return { ok: true, already: true }
  if (!payable(ad)) return { ok: false, status: 409, code: 'order_closed' }
  // Who closed it and what it was before (a shop's own cancel, an expiry) stay on the row.
  const trail = { ...(payloadOf(ad) as Record<string, unknown>), cancelledBy: admin, cancelledAt: new Date().toISOString(), ...(ad.failReason ? { before: ad.failReason } : {}) }
  const r = await db.listingAd.updateMany({ where: { id, ...PAYABLE_WHERE }, data: { status: BANK_CANCELLED, failReason: 'cancelled_by_eno', payloadJson: trail as Prisma.InputJsonValue } })
  if (r.count) logInfo('ads_bank_cancelled', { adId: id, admin })
  // Lost a race to a Mark paid: the order started — say so rather than "cancelled".
  if (!r.count) {
    const fresh = await db.listingAd.findUnique({ where: { id }, select: { status: true } })
    if (fresh?.status !== BANK_CANCELLED) return { ok: false, status: 409, code: 'order_closed' }
  }
  return { ok: true, already: !r.count }
}

// ── The advertiser's bell ──────────────────────────────────────────────────────────────────────────────────────────

/** eno's own copy, in the shop owner's language (en / vi — admin-macros.ts pickLocale), as every `system` bell is written. */
export const AD_LIVE_NOTICE = {
  title: { en: 'Your ad is live', vi: 'Quảng cáo của bạn đã chạy' },
  body: { en: 'We received your transfer. See how it does in Ads.', vi: 'Chúng tôi đã nhận chuyển khoản của bạn. Xem kết quả trong mục Quảng cáo.' },
  /** Stacked after the target's running ad: it is paid, and starts when that one ends. */
  queued: { en: 'We received your transfer. It starts when your current ad ends.', vi: 'Chúng tôi đã nhận chuyển khoản của bạn. Quảng cáo bắt đầu khi quảng cáo hiện tại kết thúc.' },
} as const

/** The in-app bell (and a push) to the shop's owner — best effort, after the answer: a bell that fails never undoes a
 *  confirmed payment. */
function notifyAdLive(ad: AdRow, now: Date): void {
  const send = async () => {
    try {
      // edition-lint-allow: the paid ad's own shop (its id from the row), read for its owner's id and language; nothing public.
      const seller = await db.seller.findUnique({ where: { id: ad.sellerId }, select: { ownerId: true, owner: { select: { locale: true } } } })
      if (!seller?.ownerId) return
      const l = pickLocale(seller.owner?.locale)
      const title = AD_LIVE_NOTICE.title[l]
      const body = (ad.startsAt && ad.startsAt.getTime() > now.getTime() ? AD_LIVE_NOTICE.queued : AD_LIVE_NOTICE.body)[l]
      await db.notification.create({ data: { recipientId: seller.ownerId, type: 'system', title, body, actorName: SITE_NAME, url: '/dashboard/ads' } })
      await sendPushToProfile(seller.ownerId, { title, body, url: '/dashboard/ads', tag: `ad-live-${ad.id}` }).catch((e: unknown) => logError(e, { op: 'ads.bank.push' }))
    } catch (e) {
      logError(e, { op: 'ads.bank.notify', adId: ad.id })
    }
  }
  // after() when a request scope exists (the admin route); straight away otherwise (tests, scripts).
  try { after(send) } catch { void send() }
}
