import crypto from 'crypto'
import { kv } from '@/lib/ratelimit'
import { logError } from '@/lib/log'
import { db } from '@/lib/db'
import { OAUTH_ISSUER } from '@/lib/api/oauth'
import { BANK_AWAITING, BANK_PERIOD, BANK_ORDER_DAYS, isBankPeriod, type BankPeriod } from '@/lib/ads/bank-periods'
import { BANK_VIA, createBankOrder, getBankOrder, orderStatus, payable, type BankOrderView, type OrderRefusal } from '@/lib/ads/bank'
import { adTarget, adTitle, adVariantId, parseAdId, periodTitle } from './ad-item'
import { CHECKOUT_VERSION, UCP_CHECKOUT } from './agent'

/**
 * ── UNIVERSAL COMMERCE PROTOCOL: eno.vn's CHECKOUT, FOR eno.vn's OWN ADS (owner 2026-11-27/28: "ads checkout", "go") ──
 *
 * dev.ucp.shopping.checkout 2026-08-25 over REST (POST /checkout-sessions, GET|PUT /checkout-sessions/{id}, POST …/complete,
 * POST …/cancel at https://eno.vn/api/ucp). What it sells: an ad on a listing (ad-item.ts), exactly one line, quantity 1,
 * item `ad:<listingId>:week|month|quarter`. Goods are not sold here — buyers pay sellers directly on eno.vn.
 *
 * HOW IT IS PAID: never through the API. The session answers `requires_escalation` with a `continue_url` on eno.vn
 * (/dashboard/ads/pay/<id>): the shop signs in there, presses Pay, and gets the ads' own VietQR bank order (src/lib/ads/
 * bank.ts createBankOrder — the listing must be its own; QR, "I've paid", an admin's Mark paid). `complete` takes no
 * payment instrument and answers like GET (the spec allows `requires_escalation` from complete); `payment_handlers` is {}.
 *
 * ⛔ THE API IS UNPRIVILEGED (plan review 2026-11-28). A session is a quote in kv, nothing more: creating one writes no
 * order, alerts no admin and needs no sign-in. Every privileged step is on eno.vn, signed in, through createBankOrder's
 * own checks. A session id is 128 random bits and bound to the platform that made it (its UCP-Agent profile): a call naming
 * another profile gets not_found. The header is not authenticated, so this is containment, not access control — what a
 * holder of the id could do through the API is read or cancel a quote, never pay or move money.
 * ⛔ STATUS IS THE BANK ORDER'S, READ EVERY TIME — `completed` ONLY WHEN PAID: no order or one awaiting its transfer →
 *   requires_escalation; paid ('active', bank.ts orderStatus) → completed + order; paid but the listing gone ('review') →
 *   requires_escalation with the refund said (the ad will not run); lapsed or cancelled by the shop → requires_escalation
 *   (an admin may still match money already sent: bank.ts `payable`), never `canceled`, which UCP treats as final; closed
 *   by eno → canceled. A session cancelled before any order → canceled.
 * ⛔ ONCE AN ORDER IS LINKED THE SESSION IS FROZEN: no update (its line and price are the order's), no cancel through the
 *   API (cancelling an order is the shop's, signed in on eno.vn), and its kv life is stretched past the order's admin
 *   window, so a session never vanishes while its money can still be matched.
 */
export const CHECKOUT_ENDPOINT_PATH = '/api/ucp/checkout-sessions'
const UNLINKED_TTL_SEC = 24 * 3600
/** An order lapses after BANK_ORDER_DAYS, an admin may still mark it paid for 30 days past that (bank.ts), and the longest
 *  ad then runs 90 days: a linked checkout answers for all of it, plus a week. */
const LINKED_TTL_SEC = (BANK_ORDER_DAYS + 30 + BANK_PERIOD.quarter.days + 7) * 86_400
const ID_RE = /^chk_[A-Za-z0-9_-]{22}$/
const CLAIM_TTL_SEC = 300
/** How long after an order is made an admin may still mark it paid: its BANK_ORDER_DAYS, then 30 days (bank.ts). */
const MATCH_WINDOW_MS = (BANK_ORDER_DAYS + 30) * 86_400_000

type Lang = 'en' | 'vi'
type Json = Record<string, unknown>
export type Session = {
  v: 1
  id: string
  profile: string
  listingId: string
  period: BankPeriod
  title: string
  image: string | null
  lang: Lang
  createdAt: string
  expiresAt: string
}
/**
 * ONE SLOT DECIDES A SESSION'S FATE, TAKEN ONCE (kv NX): Pay's claim (`pending` while it makes the order, then the order —
 * bank.ts ListingAd id — with a copy of the session, so the link is the durable record once an order exists), or Cancel's
 * mark. Cancel and Pay can therefore never both win (commit gate 2026-11-28: a cancel answered `canceled` while a racing
 * Pay made an order would undo a status UCP treats as final).
 */
type Link =
  | { pending: true; sellerId: string; at: string; token: string }
  | { orderId: string; sellerId: string; listingId: string; period: BankPeriod; title: string; session: Session }
  | { canceled: true; at: string }
const ownerOf = (l: Link | null) => (l && 'sellerId' in l ? l.sellerId : null)

const sessionKey = (id: string) => `ucp:chk:${id}`
const linkKey = (id: string) => `ucp:chk:${id}:order`
const newId = () => `chk_${crypto.randomBytes(16).toString('base64url')}`
export const continueUrl = (id: string) => `${OAUTH_ISSUER}/dashboard/ads/pay/${id}`

export class CheckoutError extends Error {
  constructor(readonly code: string, message: string, readonly path?: string) { super(message) }
}

const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
function langOf(body: Json): Lang {
  const c = isRecord(body.context) ? body.context : {}
  return typeof c.language === 'string' && c.language.toLowerCase().startsWith('vi') ? 'vi' : 'en'
}

/** The one line a request may carry: `ad:<listingId>:<period>`, quantity 1. */
function parseLine(body: Json): { listingId: string; period: BankPeriod } {
  const lines = Array.isArray(body.line_items) ? body.line_items : []
  if (lines.length !== 1) throw new CheckoutError('invalid_line_items', 'A checkout here holds exactly one line: an eno.vn ad (item id ad:<listingId>:week|month|quarter).', '$.line_items')
  const line = isRecord(lines[0]) ? lines[0] : {}
  const item = isRecord(line.item) ? line.item : {}
  const q = line.quantity ?? 1
  if (q !== 1) throw new CheckoutError('invalid_quantity', 'An ad is bought one at a time: quantity 1.', '$.line_items[0].quantity')
  const parsed = typeof item.id === 'string' ? parseAdId(item.id) : null
  if (!parsed) throw new CheckoutError('item_unavailable', 'Only eno.vn ads are sold through checkout (item id ad:<listingId>:week|month|quarter). Goods are bought from their seller on eno.vn, who is paid directly.', '$.line_items[0].item.id')
  if (!parsed.period || !isBankPeriod(parsed.period)) throw new CheckoutError('item_unavailable', 'Name the period in the item id: ad:<listingId>:week, :month or :quarter.', '$.line_items[0].item.id')
  return { listingId: parsed.listingId, period: parsed.period }
}

const loadLink = (id: string) => kv.get<Link>(linkKey(id))
/** The session; once an order exists, the link's copy if the session record is gone (its life is the link's). */
async function loadAny(id: string): Promise<Session | null> {
  if (!ID_RE.test(id)) return null
  const s = await kv.get<Session>(sessionKey(id))
  if (s && s.v === 1) return s
  const link = await loadLink(id)
  return link && 'orderId' in link && link.session?.v === 1 ? link.session : null
}
async function load(id: string, profile: string): Promise<Session | null> {
  const s = await loadAny(id)
  return s && s.profile === profile ? s : null
}

type OrderRow = NonNullable<Awaited<ReturnType<typeof db.listingAd.findUnique>>>
const madeBy = (r: Pick<OrderRow, 'payloadJson'>, id: string) => (r.payloadJson as { ucpCheckout?: unknown } | null)?.ucpCheckout === id

/** The bank orders a checkout made (createBankOrder's `ucpCheckout` tag), newest first. */
async function ordersMadeBy(s: Session, where: { sellerId?: string; status?: string } = {}): Promise<OrderRow[]> {
  // By the tag in the database (a JSON path), never "the newest N then filter": however many orders the listing has, this
  // checkout's own is found (commit gate 2026-11-28).
  const rows = await db.listingAd.findMany({
    where: { listingId: s.listingId, via: BANK_VIA, createdAt: { gte: new Date(s.createdAt) }, payloadJson: { path: ['ucpCheckout'], equals: s.id }, ...where },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })
  return rows.filter((r) => madeBy(r, s.id))
}

/**
 * ⛔ A LOST LINK IS FOUND AGAIN (commit gate 2026-11-28): if a press made its order and died before linking it, the slot
 * lapses — and a Cancel, or a GET, must not then see "no order". Whenever the slot holds no order, the order this
 * checkout made (by its tag) is looked for and, if there is one, linked; Cancel is then refused like any linked checkout.
 */
async function currentLink(s: Session, now = new Date()): Promise<Link | null> {
  const link = await loadLink(s.id)
  if (link && !('pending' in link)) return link
  const [row] = await ordersMadeBy(s)
  if (!row) return link
  const period = (row.payloadJson as { period?: unknown } | null)?.period
  const healed: Link = {
    orderId: row.id, sellerId: row.sellerId, listingId: s.listingId, period: isBankPeriod(period) ? period : s.period, title: s.title,
    session: { ...s, expiresAt: new Date(now.getTime() + LINKED_TTL_SEC * 1000).toISOString() },
  }
  await kv.set(linkKey(s.id), healed, { ex: LINKED_TTL_SEC })
  return healed
}

async function orderOf(link: Link | null): Promise<OrderRow | null> {
  if (!link || !('orderId' in link)) return null
  return db.listingAd.findUnique({ where: { id: link.orderId } })
}

const LINKS = [
  { type: 'terms_of_service', url: `${OAUTH_ISSUER}/terms` },
  { type: 'privacy_policy', url: `${OAUTH_ISSUER}/privacy` },
  { type: 'refund_policy', url: `${OAUTH_ISSUER}/advertising-policy`, title: 'Advertising policy (refunds)' },
]

const t = (lang: Lang, en: string, vi: string) => (lang === 'vi' ? vi : en)

/**
 * The checkout object (shopping/checkout.json) for a session and its order, as of `now`. With an order, the line is the
 * ORDER's — its listing, period, title and amount as the pay step recorded them — so nothing written to the session in a
 * race with Pay can make the line differ from the money due.
 */
export function checkoutView(s: Session, link: Link | null, order: OrderRow | null, now: Date): Json {
  const lang = s.lang
  const line = link && 'orderId' in link && order ? { listingId: link.listingId, period: link.period, title: link.title } : { listingId: s.listingId, period: s.period, title: s.title }
  const amount = order ? Number(order.amount) : BANK_PERIOD[line.period].priceVnd
  const totals = [{ type: 'subtotal', amount }, { type: 'total', amount }]
  let status: string
  let message: Json | null = null
  let done: Json | null = null
  const escalate = (content: string, severity: 'requires_buyer_input' | 'requires_buyer_review' = 'requires_buyer_input') => {
    status = 'requires_escalation'
    message = { type: 'error', code: 'buyer_handoff', severity, content }
  }
  const st = order ? orderStatus(order, now) : null
  if (link && 'canceled' in link) {
    status = 'canceled'
  } else if (!order) {
    escalate(t(lang,
      'Open continue_url: the listing\'s shop signs in on eno.vn and pays by VietQR bank transfer. The ad starts when eno.vn confirms the transfer.',
      'Mở continue_url: cửa hàng sở hữu tin đăng nhập trên eno.vn và thanh toán bằng chuyển khoản VietQR. Quảng cáo chạy khi eno.vn xác nhận tiền đã đến.'))
  } else if (st === 'awaiting_transfer') {
    escalate(t(lang,
      'Awaiting the bank transfer: the QR is on continue_url. The ad starts when eno.vn confirms the money.',
      'Đang chờ chuyển khoản: mã QR ở continue_url. Quảng cáo chạy khi eno.vn xác nhận tiền đã đến.'))
  } else if (st === 'active') {
    status = 'completed'
    done = { id: order.id, permalink_url: `${OAUTH_ISSUER}/dashboard/ads` }
  } else if (st === 'review') {
    escalate(t(lang,
      'Paid, but the listing is no longer live, so the ad cannot run: eno.vn refunds the transfer by hand.',
      'Đã thanh toán nhưng tin không còn hiển thị nên quảng cáo không chạy được: eno.vn hoàn tiền thủ công.'), 'requires_buyer_review')
  } else if (payable(order) && now.getTime() < order.createdAt.getTime() + MATCH_WINDOW_MS) {
    // Lapsed or cancelled by the shop, but money already sent can still be matched by an admin (bank.ts payable) — until
    // that window ends; after it the checkout is canceled, not "buyer action needed" for ever (commit gate 2026-11-28).
    escalate(t(lang,
      'This order lapsed or was cancelled without a confirmed transfer. Money already sent is still matched by eno.vn by hand; otherwise start a new checkout.',
      'Đơn đã hết hạn hoặc bị hủy mà chưa xác nhận chuyển khoản. Tiền đã chuyển vẫn được eno.vn đối soát thủ công; nếu chưa chuyển, hãy tạo thanh toán mới.'))
  } else {
    status = 'canceled'
  }
  const out: Json = {
    ucp: { version: CHECKOUT_VERSION, capabilities: { [UCP_CHECKOUT]: [{ version: CHECKOUT_VERSION }] }, payment_handlers: {} },
    id: s.id,
    status: status!,
    currency: 'VND',
    line_items: [{
      id: 'li_1',
      item: { id: adVariantId(line.listingId, line.period), title: `${adTitle(line.title, lang)} (${periodTitle(line.period, lang)})`, price: amount, ...(s.image ? { image_url: s.image } : {}) },
      quantity: 1,
      totals,
    }],
    totals,
    links: LINKS,
    // With an order, the link's life (and its copy of the session) is the checkout's.
    expires_at: (link && 'orderId' in link && link.session?.expiresAt) || s.expiresAt,
  }
  if (message) { out.messages = [message]; out.continue_url = continueUrl(s.id) }
  if (done) out.order = done
  return out
}

async function present(s: Session, now: Date) {
  const link = await currentLink(s, now)
  return checkoutView(s, link, await orderOf(link), now)
}

// ── The UCP operations ────────────────────────────────────────────────────────────────────────────────────────────

export async function createCheckout(body: unknown, profile: string, now = new Date()): Promise<Json> {
  const req = isRecord(body) ? body : {}
  const line = parseLine(req)
  const target = await adTarget(line.listingId)
  if (!target) throw new CheckoutError('item_unavailable', 'No live listing on eno.vn can carry this ad.', '$.line_items[0].item.id')
  const s: Session = {
    v: 1, id: newId(), profile, listingId: target.listingId, period: line.period, title: target.title, image: target.image,
    lang: langOf(req), createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + UNLINKED_TTL_SEC * 1000).toISOString(),
  }
  await kv.set(sessionKey(s.id), s, { ex: UNLINKED_TTL_SEC })
  return checkoutView(s, null, null, now)
}

export async function getCheckout(id: string, profile: string, now = new Date()): Promise<Json | null> {
  const s = await load(id, profile)
  return s ? present(s, now) : null
}

/** PUT: the line (another period, another listing) while no order exists. Frozen once one does, or once canceled. */
export async function updateCheckout(id: string, body: unknown, profile: string, now = new Date()): Promise<Json | null> {
  const s = await load(id, profile)
  if (!s) return null
  const link = await currentLink(s, now)
  if (link && 'pending' in link) {
    // A press in progress (perhaps another shop's, about to be refused): "retry", not "never" (commit gate 2026-11-28).
    const view = checkoutView(s, link, null, now)
    return { ...view, messages: [...((view.messages as Json[]) ?? []), { type: 'error', code: 'checkout_busy', severity: 'recoverable', content: 'A payment is starting for this checkout; retry shortly.' }] }
  }
  if (link) {
    const view = checkoutView(s, link, await orderOf(link), now)
    return { ...view, messages: [...((view.messages as Json[]) ?? []), { type: 'error', code: 'checkout_locked', severity: 'unrecoverable', content: 'This checkout can no longer change: its order exists or it was canceled.' }] }
  }
  const req = isRecord(body) ? body : {}
  const line = parseLine(req)
  const target = line.listingId === s.listingId ? { listingId: s.listingId, title: s.title, image: s.image } : await adTarget(line.listingId)
  if (!target) throw new CheckoutError('item_unavailable', 'No live listing on eno.vn can carry this ad.', '$.line_items[0].item.id')
  const next: Session = { ...s, listingId: target.listingId, title: target.title, image: target.image, period: line.period, lang: isRecord(req.context) ? langOf(req) : s.lang }
  const ttl = Math.max(1, Math.floor((Date.parse(s.expiresAt) - now.getTime()) / 1000))
  // Pay may have claimed the session while this ran: then the update is refused, not written over its order.
  if (await loadLink(id)) return updateCheckout(id, body, profile, now)
  await kv.set(sessionKey(id), next, { ex: ttl })
  // ⛔ AND READ AGAIN AFTER THE WRITE (commit gate 2026-11-28): a claim that landed between the check and the write made its
  // order for the old line, so this reply must not name the new one — it answers the checkout as it now stands.
  if (await loadLink(id)) return updateCheckout(id, body, profile, now)
  return checkoutView(next, null, null, now)
}

export const completeCheckout = getCheckout

/** Cancel: only before an order exists (after that, the order is the shop's to cancel on eno.vn) and never twice. */
export async function cancelCheckout(id: string, profile: string, now = new Date(), retried = false): Promise<Json | null> {
  const s = await load(id, profile)
  if (!s) return null
  const link = await currentLink(s, now)
  const view = checkoutView(s, link, await orderOf(link), now)
  const refuse = (content: string) => ({ ...view, messages: [...((view.messages as Json[]) ?? []), { type: 'error', code: 'cancel_not_allowed', severity: 'unrecoverable', content }] })
  if (view.status === 'canceled' || view.status === 'completed') return refuse('This checkout is already final.')
  if (link && 'pending' in link) {
    // A press in progress (perhaps another shop's, about to be refused): not final either way — say "retry", not "never".
    return { ...view, messages: [...((view.messages as Json[]) ?? []), { type: 'error', code: 'cancel_not_allowed', severity: 'recoverable', content: 'A payment is starting for this checkout; retry shortly.' }] }
  }
  if (link) return refuse('An order exists for this checkout: its shop cancels it, signed in on eno.vn.')
  const mark: Link = { canceled: true, at: now.toISOString() }
  const ttl = Math.max(1, Math.floor((Date.parse(s.expiresAt) - now.getTime()) / 1000))
  // The same slot Pay claims: if Pay took it first, this cancel is refused (read again, it finds the claim).
  if ((await kv.set(linkKey(id), mark, { nx: true, ex: ttl })) === null) {
    if (!retried) return cancelCheckout(id, profile, now, true)
    return refuse('This checkout is changing; retry shortly.')
  }
  return checkoutView(s, mark, null, now)
}

// ── The pay page (eno.vn, signed in) ──────────────────────────────────────────────────────────────────────────────

export type PaySummary = { id: string; listingId: string; title: string; period: BankPeriod; amountVnd: number; image: string | null; canceled: boolean; order: BankOrderView | null; ownOrder: boolean; claimed: boolean }

/** No profile check: the person on the page holds the link and is signed in; what they may do is decided per step. */
const loadForPage = loadAny

/** What /dashboard/ads/pay/<id> shows a signed-in shop: the line, and its order when this shop made it. */
export async function paySummary(id: string, sellerId: string | null, now = new Date()): Promise<PaySummary | null> {
  const s = await loadForPage(id)
  if (!s) return null
  const link = await currentLink(s, now)
  const mine = !!sellerId && ownerOf(link) === sellerId
  const linked = link && 'orderId' in link ? link : null
  const order = mine && linked ? await getBankOrder(linked.orderId, sellerId!, now) : null
  const line = linked ?? s
  const canceled = !!link && 'canceled' in link
  return {
    id: s.id, listingId: line.listingId, title: line.title, period: line.period, image: s.image, canceled,
    // "Claimed" only by ANOTHER shop: this shop's own claim (in progress, or an order the page cannot read) keeps its Pay
    // button — pressing it shows the order, or adopts it (createUnderClaim).
    amountVnd: order?.amount_vnd ?? BANK_PERIOD[line.period].priceVnd, order, ownOrder: mine, claimed: !!link && !mine && !canceled,
  }
}

export type PayResult = { ok: true; order: BankOrderView } | { ok: false; status: number; code: OrderRefusal | 'not_found' | 'canceled' | 'taken' | 'busy' | 'changed' | 'order_unavailable'; reason?: string }

/**
 * The shop presses Pay: ONE bank order per session. ⛔ CLAIM FIRST, THEN CREATE (plan review 2026-11-28): a double press or a
 * second tab must never make a second order with its own QR — the first press takes the session (NX), the order is made
 * under the claim, then the claim becomes the order. A failed create releases the claim. createBankOrder decides the rest
 * (the account set up, the listing this shop's own and live, the shop's hourly budget).
 */
export async function payCheckout(
  id: string,
  seller: { sellerId: string | null; profileId: string },
  /** What the page showed when Pay was pressed: the order is made only for that line (commit gate 2026-11-28 — an update
   *  landing between the page's read and the press must not turn a 99.000 đ button into an 899.000 đ order). */
  shown: { listingId?: unknown; period?: unknown },
  now = new Date(),
): Promise<PayResult> {
  const s = await loadForPage(id)
  if (!s) return { ok: false, status: 404, code: 'not_found' }
  if (!seller.sellerId) return { ok: false, status: 403, code: 'no_shop' }
  const sellerId = seller.sellerId
  const claim = { pending: true as const, sellerId, at: now.toISOString(), token: crypto.randomBytes(9).toString('base64url') }
  // The claim lapses on its own (a crash between claim and create never leaves Pay "busy" for good); the next press then
  // re-finds any order the crashed one made (adoptable), so it still cannot make a second.
  const won = await kv.set(linkKey(id), claim, { nx: true, ex: CLAIM_TTL_SEC })
  if (won !== null) {
    // Read again under the claim: an update that landed before it is the line this order is made for.
    const fresh = await loadForPage(id)
    if (!fresh) { await releaseClaim(id, claim.token); return { ok: false, status: 404, code: 'not_found' } }
    if (shown.listingId !== fresh.listingId || shown.period !== fresh.period) { await releaseClaim(id, claim.token); return { ok: false, status: 409, code: 'changed' } }
    return createUnderClaim(id, fresh, sellerId, seller.profileId, claim.token, now)
  }
  // Already decided: canceled; this shop's own order shown again; its claim still in progress "busy"; anyone else's "taken".
  const link = await loadLink(id)
  if (link && 'canceled' in link) return { ok: false, status: 409, code: 'canceled' }
  if (link && 'orderId' in link && link.sellerId === sellerId) {
    const order = await getBankOrder(link.orderId, sellerId, now)
    // An order this shop can no longer read (gone, or the shop changed hands) is not "busy" for the link's whole life.
    return order ? { ok: true, order } : { ok: false, status: 409, code: 'order_unavailable' }
  }
  return ownerOf(link) === sellerId ? { ok: false, status: 409, code: 'busy' } : { ok: false, status: 409, code: 'taken' }
}

/**
 * ⛔ NEVER A SECOND ORDER FOR ONE CHECKOUT, EVEN AFTER A CRASH (commit gate 2026-11-28): if a press made its order and then
 * died before linking it, its claim lapses and the next press would make another — so under the claim the awaiting order
 * THIS checkout made (createBankOrder stores `payloadJson.ucpCheckout`) is ADOPTED instead. Only its own: never another
 * checkout's order, nor one the shop made itself on the dashboard (both carry no, or another, checkout id).
 */
async function adoptable(s: Session, sellerId: string, now: Date): Promise<string | null> {
  const rows = await ordersMadeBy(s, { sellerId, status: BANK_AWAITING })
  return rows.find((r) => orderStatus(r, now) === 'awaiting_transfer')?.id ?? null
}

/** The session as it was before a press stretched it: its own expiry, its own remaining life. */
async function restore(id: string, s: Session, now: Date): Promise<void> {
  const ttl = Math.max(1, Math.floor((Date.parse(s.expiresAt) - now.getTime()) / 1000))
  await kv.set(sessionKey(id), s, { ex: ttl })
}

/** Free the slot only if it still holds THIS press's claim — never a Cancel mark or another press that took a lapsed slot. */
async function releaseClaim(id: string, token: string): Promise<void> {
  const cur = await loadLink(id)
  if (cur && 'pending' in cur && cur.token === token) await kv.del(linkKey(id))
}

async function createUnderClaim(id: string, s: Session, sellerId: string, profileId: string, token: string, now: Date): Promise<PayResult> {
  const adopted = await adoptable(s, sellerId, now)
  if (adopted) {
    const order = await getBankOrder(adopted, sellerId, now)
    if (order) return linkOrder(id, s, sellerId, order, now)
  }
  // Stretched BEFORE the order is made: should this press die between the create and the link, the session (and so the
  // tag re-find) is still there for as long as the order can be paid (commit gate 2026-11-28).
  await kv.set(sessionKey(id), { ...s, expiresAt: new Date(now.getTime() + LINKED_TTL_SEC * 1000).toISOString() } satisfies Session, { ex: LINKED_TTL_SEC })
  let out: Awaited<ReturnType<typeof createBankOrder>>
  try {
    out = await createBankOrder({ sellerId, profileId, kind: 'listing', listingId: s.listingId, period: s.period, ucpCheckout: s.id, now })
  } catch (e) {
    await restore(id, s, now).catch((err) => logError(err, { op: 'ucp.checkout.restore' }))
    await releaseClaim(id, token).catch((err) => logError(err, { op: 'ucp.checkout.release' }))
    throw e
  }
  if (!out.ok) {
    // Refused (another shop's listing, no bank account set up, the hourly budget…): the quote keeps its own life, not the
    // stretched one (commit gate 2026-11-28).
    await restore(id, s, now)
    await releaseClaim(id, token)
    return { ok: false, status: out.status, code: out.code, reason: out.reason }
  }
  return linkOrder(id, s, sellerId, out.order, now)
}

/** The link first — the durable record, carrying the session — then the session's own record stretched to match. A failed
 *  link write throws (the order stays adoptable by the next press); a failed session write is logged (the link covers it). */
async function linkOrder(id: string, s: Session, sellerId: string, order: BankOrderView, now: Date): Promise<PayResult> {
  const session: Session = { ...s, expiresAt: new Date(now.getTime() + LINKED_TTL_SEC * 1000).toISOString() }
  await kv.set(linkKey(id), { orderId: order.id, sellerId, listingId: s.listingId, period: s.period, title: s.title, session } satisfies Link, { ex: LINKED_TTL_SEC })
  await kv.set(sessionKey(id), session, { ex: LINKED_TTL_SEC }).catch((e) => logError(e, { op: 'ucp.checkout.stretch' }))
  return { ok: true, order }
}
