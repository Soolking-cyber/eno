import 'server-only'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { sendPushToProfile } from '@/lib/push'
import { rateLimit } from '@/lib/ratelimit'
import { isServicesDeskListing, scopedListingWhere } from '@/lib/edition-scope'
import { formatMoneyFull } from '@/lib/vnd'
import { logError } from '@/lib/log'
import {
  SALE_CONFIRM_NOTIFICATION,
  canRespondToSale,
  confirmPromptPrice,
  confirmWindowAnchor,
  isGoodsSale,
  parseBuyerHistory,
  saleState,
  type SaleFacts,
} from '@/lib/trade-loop'

export { SALE_CONFIRM_NOTIFICATION }

/**
 * ── THE TRADE LOOP'S I/O HALF ────────────────────────────────────────────────────────────────────
 *
 * src/lib/trade-loop.ts DECIDES (pure: who may be named, what a mark-sold writes, who may answer, what
 * an answer writes). This file READS and WRITES around those decisions for the three routes that run
 * the loop, so the rules they share are written once:
 *   · POST /api/listings/[id]/sold                — the seller names the buyer; the buyer is ASKED.
 *   · GET  /api/listings/[id]/buyers?scope=listing — who the seller may name (the same scope /sold checks).
 *   · GET  /api/conversations/[id]/sale-question   — what this buyer is being asked, in that thread.
 *   · POST /api/listings/[id]/sale-confirmation    — the buyer's one-tap answer.
 *
 * ⛔ WHICH LISTINGS ASK A BUYER AT ALL — `asksBuyerAbout`, the one predicate all four use: a SALE OF
 * GOODS (isGoodsSale — the same rule that decides where the web's "Who bought it?" sheet opens) that is
 * NOT a services-desk listing. The desk exclusion is a LICENSING line, not a taste: the bell is one
 * shared Notification table read by both editions, so a "did you buy <visa product>?" written on
 * eno.forum would surface on eno.vn (src/lib/notification-scope.ts). It is edition-INDEPENDENT on
 * purpose and FAILS CLOSED: a desk that cannot be resolved means "do not ask".
 */

/** Every Listing column SaleFacts reads — select it and hand the row to `saleFacts`. */
export const SALE_FACTS_SELECT = {
  status: true,
  complianceStatus: true,
  soldChannel: true,
  soldToProfileId: true,
  soldAt: true,
  salePrice: true,
  saleConfirmedAt: true,
  saleDeclinedAt: true,
  saleBuyerHistory: true,
  saleConfirmPromptedAt: true,
} as const

type SaleFactsRow = { [K in keyof typeof SALE_FACTS_SELECT]: SaleFacts[K] }

/** The row as the pure module's facts (a structural copy — the row may carry more columns). */
export function saleFacts(row: SaleFactsRow): SaleFacts {
  return {
    status: row.status,
    complianceStatus: row.complianceStatus,
    soldChannel: row.soldChannel,
    soldToProfileId: row.soldToProfileId,
    soldAt: row.soldAt,
    salePrice: row.salePrice,
    saleConfirmedAt: row.saleConfirmedAt,
    saleDeclinedAt: row.saleDeclinedAt,
    saleBuyerHistory: row.saleBuyerHistory,
    saleConfirmPromptedAt: row.saleConfirmPromptedAt,
  }
}

/**
 * The compare-and-swap a write decided on these facts carries (SoldMeta.expect in core/listings.ts, and
 * the answer route's own conditional write): every column the decision read, as it read them. `null`
 * compiles to IS NULL, so a column that was empty must still be empty.
 * ⚠️ complianceStatus IS PART OF IT (commit gate, 2026-10-05): both decisions refuse a taken-down listing
 * (canMarkSold, canRespondToSale), so a takedown landing between the read and the write must make the
 * write miss — the re-read then answers `listing_unavailable` — never mark sold, or confirm, goods the
 * platform was ordered to remove.
 */
export function factsUnchanged(f: SaleFacts) {
  return {
    status: f.status,
    // Non-null in the schema (default 'clear'), so a row read from the database always carries it; the pure
    // facts type it nullable only because they are structural.
    ...(f.complianceStatus !== null ? { complianceStatus: f.complianceStatus } : {}),
    soldChannel: f.soldChannel,
    soldToProfileId: f.soldToProfileId,
    salePrice: f.salePrice,
    saleConfirmedAt: f.saleConfirmedAt,
    saleDeclinedAt: f.saleDeclinedAt,
    saleBuyerHistory: f.saleBuyerHistory,
    saleConfirmPromptedAt: f.saleConfirmPromptedAt,
  }
}

/**
 * Does the trade loop ASK a buyer about this listing? See the header: a sale of goods, never the desk.
 * ⚠️ Fails CLOSED — `isServicesDeskListing` throws when the desk cannot be resolved, and "could not tell"
 * must mean "do not ask", never "not the desk".
 */
export async function asksBuyerAbout(listing: { sellerId: string; listingType: string | null; categorySlug: string | null }): Promise<boolean> {
  return isGoodsSale(listing) && !(await isDeskSeller(listing.sellerId))
}

/** Is this storefront the services desk? TRUE when that cannot be resolved — see `asksBuyerAbout`. */
async function isDeskSeller(sellerId: string): Promise<boolean> {
  try {
    return await isServicesDeskListing({ sellerId })
  } catch (e) {
    logError(e, { op: 'sale-loop.isDeskSeller' })
    return true
  }
}

// ── "Who messaged about THIS listing" — one scope for the picker and for the check ────────────────

/**
 * Threads that carried an OFFER about this listing before being retargeted to another one. insertMessage
 * and actOnOffer stamp the thread's listing of the moment on the SELLER's 'offer' notification, which is
 * the only record of what a thread was about before a retarget (Message has no listingId). Newest first,
 * so the cap keeps the threads most likely to be this sale ([recipientId, createdAt] index).
 */
export async function offerThreadIdsFor(sellerProfileId: string, listingId: string): Promise<string[]> {
  const rows = await db.notification.findMany({
    where: { recipientId: sellerProfileId, type: 'offer', listingId, conversationId: { not: null } },
    select: { conversationId: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return [...new Set(rows.map((n) => n.conversationId).filter((c): c is string => !!c))]
}

/**
 * THE conversation predicate for "the people who messaged about this listing": the threads anchored to it
 * now, plus the offer threads above. GET /buyers?scope=listing lists it and POST /sold refuses anyone
 * outside it, so the sheet can never offer a person the write then rejects — nor the write accept one the
 * sheet would not have offered.
 */
export function listingThreadsWhere(sellerId: string, listingId: string, offerThreadIds: readonly string[]) {
  return { sellerId, OR: [{ listingId }, ...(offerThreadIds.length ? [{ id: { in: [...offerThreadIds] } }] : [])] }
}

/**
 * The buyer's thread with this seller about this listing — the anti-spoof for a named buyer AND the
 * thread the "did you buy this?" notification opens. Null = they are not in the listing's scope (POST
 * /sold answers 400 buyer_not_in_conversations). The thread anchored to the listing wins; otherwise the
 * most recent offer thread about it.
 */
export async function buyerThreadFor(sellerId: string, sellerProfileId: string, listingId: string, buyerProfileId: string): Promise<string | null> {
  const offerIds = await offerThreadIdsFor(sellerProfileId, listingId)
  const threads = await db.conversation.findMany({
    where: { ...listingThreadsWhere(sellerId, listingId, offerIds), buyerProfileId },
    select: { id: true, listingId: true },
    orderBy: { lastMessageAt: 'desc' },
    take: 5,
  })
  return (threads.find((t) => t.listingId === listingId) ?? threads[0])?.id ?? null
}

/**
 * The buyers this listing may no longer be attributed to — everyone who said "No, I did not" about it
 * (the durable history, plus the scalar stamp on the current attribution, exactly as canNameBuyer reads
 * them). The picker leaves them out, so the sheet never offers a person POST /sold would refuse.
 */
export function declinedBuyerIds(f: Pick<SaleFacts, 'saleBuyerHistory' | 'saleDeclinedAt' | 'soldToProfileId'>): Set<string> {
  const out = new Set(parseBuyerHistory(f.saleBuyerHistory).filter((e) => e.declinedAt !== undefined).map((e) => e.id))
  if (f.saleDeclinedAt && f.soldToProfileId) out.add(f.soldToProfileId)
  return out
}

/**
 * Has NOBODY ever messaged about this listing — PROVABLY, not merely "nobody is listed"? Only then may the
 * web sheet pre-select "someone not on eno" (B6 review). The listing scope is lossy in exactly that
 * direction: a buyer who only CHATTED about this listing and then asked the same seller about another one
 * moved their thread away (retargetForListing) and left no trace here.
 *
 * What CAN be proved is the opposite: such a thread was anchored here at some point after the listing
 * existed, and anchoring (a new thread, or a retarget followed by the buyer's message) moves its
 * `lastMessageAt` to then. So a seller with NO thread active since this listing was created has had no
 * conversation about it, moved or not. Any such thread makes the answer "unsure", and the sheet then
 * pre-selects nothing — conservative on purpose: one extra tap for a busy seller, never a false off-eno
 * sale for a real eno buyer.
 */
export async function nobodyEverMessaged(sellerId: string, listingCreatedAt: Date): Promise<boolean> {
  const any = await db.conversation.findFirst({
    where: { sellerId, lastMessageAt: { gte: listingCreatedAt } },
    select: { id: true },
  })
  return !any
}

// ── Telling the buyer ──────────────────────────────────────────────────────────────────────────────

/**
 * How many "did you buy this?" notifications one buyer can get about one listing per day, whatever the
 * seller does. trade-loop.ts bounds the asks WITHIN one sale (MAX_MARK_SOLD_ASKS, the confirm window), but
 * a relist clears that memory by design (REACTIVATION_SALE_RESET) — so relist → mark sold → relist… would
 * otherwise push the same person once per loop. This is the bound on that loop; the question itself still
 * stands in the thread (sale-question) when a notification is skipped.
 */
export const SALE_ASK_NOTIFY = { limit: 3, window: '1 d' } as const

/**
 * Tell the buyer they are being asked: ONE bell row (the house pattern for a buyer-facing event — offers
 * and price drops do the same) and a push, both opening the thread with the seller.
 *
 * ONE row per buyer per listing, and it always describes the CURRENT question:
 *   1. the buyer's earlier row for this listing is withdrawn FIRST, unconditionally — a corrected price
 *      must never leave the old figure in the bell while the thread asks the new one, even when step 2
 *      then sends nothing;
 *   2. the daily bound (SALE_ASK_NOTIFY) applies only to creating a NEW row and push;
 *   3. the new row is VERIFIED after it is written: the listing must still be sold to this buyer, still
 *      unanswered and still asking this price. A relist, a re-attribution or a second correction that
 *      committed in the meantime (their own withdrawals may have run before this row existed) means the
 *      row describes nothing — it is removed again and no push goes out.
 * (A re-attribution AWAY from a buyer withdraws their row — `withdrawSaleQuestion`, which the mark-sold
 * route calls; a relist withdraws every row for the listing — core/sale-withdraw.ts withdrawSaleQuestions.)
 *
 * Persisted copy is a BILINGUAL composite, Vietnamese first (the offer and price-drop idiom): it is stored
 * server-side, where tr() cannot run. The bell renders this type with its own translated label.
 * Best-effort, like every notification: a failure is logged and never fails the sale. Resolves whether the
 * buyer was ACTUALLY notified — a row that stands and a push on its way — so the route's `asked` says what
 * happened rather than what was intended.
 */
export async function notifySaleQuestion(input: {
  buyerProfileId: string
  listingId: string
  conversationId: string
  sellerName: string
  listingTitle: string
  price: number | null
  currency: string
}): Promise<boolean> {
  const { buyerProfileId, listingId } = input
  try {
    // 1. Whatever happens next, the old question leaves the bell.
    await db.notification.deleteMany({ where: { recipientId: buyerProfileId, type: SALE_CONFIRM_NOTIFICATION, listingId } })
    // 2. The bound is on NEW notifications only.
    const rl = await rateLimit('sale-confirm-ask', `${buyerProfileId}:${listingId}`, SALE_ASK_NOTIFY.limit, SALE_ASK_NOTIFY.window)
    if (!rl.success) return false
    const title = 'Xác nhận đã mua · Confirm your purchase'
    const money = input.price && input.price > 0 ? formatMoneyFull(input.price, input.currency || '₫', 'vi') : null
    const body = `${input.sellerName}: ${input.listingTitle}${money ? ` · ${money}` : ''}`.slice(0, 140)
    const created = await db.notification.create({
      data: {
        recipientId: buyerProfileId,
        type: SALE_CONFIRM_NOTIFICATION,
        title,
        body,
        actorName: input.sellerName,
        conversationId: input.conversationId,
        listingId,
      },
      select: { id: true },
    })
    // 3. Is this still THE question? Read after the row exists, so a change committed before it was
    //    written is seen here, and one committed after it finds the row to withdraw.
    if (!(await stillAsking(listingId, buyerProfileId, input.price))) {
      await db.notification.deleteMany({ where: { id: created.id } })
      return false
    }
    // After the response, like every push: never delays the seller's sale. One tag per listing, so a
    // corrected price replaces the earlier push on the device rather than stacking.
    after(() => sendPushToProfile(buyerProfileId, { title, body, url: `/messages/${input.conversationId}`, tag: `sale-confirm-${listingId}` }))
    return true
  } catch (e) {
    logError(e, { op: 'sale-loop.notifySaleQuestion' })
    return false
  }
}

/** Does the listing still put THIS question to THIS buyer — sold to them, unanswered, at this price? */
async function stillAsking(listingId: string, buyerProfileId: string, price: number | null): Promise<boolean> {
  const row = await db.listing.findUnique({ where: { id: listingId }, select: SALE_FACTS_SELECT })
  if (!row) return false
  const facts = saleFacts(row)
  return saleState(facts) === 'awaiting_buyer' && facts.soldToProfileId === buyerProfileId && (confirmPromptPrice(facts) ?? null) === (price ?? null)
}

/** Remove a buyer's "did you buy this?" row for a listing — the question to them was withdrawn. */
export async function withdrawSaleQuestion(buyerProfileId: string, listingId: string): Promise<void> {
  try {
    await db.notification.deleteMany({ where: { recipientId: buyerProfileId, type: SALE_CONFIRM_NOTIFICATION, listingId } })
  } catch (e) {
    logError(e, { op: 'sale-loop.withdrawSaleQuestion' })
  }
}

// ── What a buyer is being asked ────────────────────────────────────────────────────────────────────

/** One open question, as the buyer's thread renders it (sale-confirm-prompt.tsx). */
export type SaleQuestion = {
  /** The SALE's identity: the listing plus the moment this buyer was first asked about it. A relist and a
   *  new sale to the same person is a new id — the prompt's answer lock is keyed on it. */
  saleId: string
  listingId: string
  title: string
  /** The number the buyer was ASKED about (confirmPromptPrice) — what their answer is an answer to. Null =
   *  the seller did not say. The answer echoes it back, and the server refuses an answer to a stale one. */
  price: number | null
  currency: string
}

/**
 * The questions this seller has put to this buyer that are still open: an eno sale naming them, unanswered,
 * inside its confirm window, not taken down, a sale of goods, inside this edition's scope (the indexed
 * query (1) in prisma/schema.prisma, ANDed with the edition scope). canRespondToSale decides each row, so
 * this lists exactly what the answer route would accept.
 */
export async function openSaleQuestions(buyerProfileId: string, seller: { id: string; ownerId: string | null }, now: Date): Promise<SaleQuestion[]> {
  if (!seller.ownerId) return [] // an ownerless storefront has no seller to confirm a sale with
  if (await isDeskSeller(seller.id)) return [] // never asked (asksBuyerAbout), so never answerable
  const rows = await db.listing.findMany({
    where: await scopedListingWhere({
      sellerId: seller.id,
      soldToProfileId: buyerProfileId,
      status: 'sold',
      soldChannel: 'eno',
      saleConfirmedAt: null,
      saleDeclinedAt: null,
      complianceStatus: { not: 'taken_down' },
    }),
    select: { id: true, title: true, currency: true, listingType: true, category: { select: { slug: true } }, ...SALE_FACTS_SELECT },
    orderBy: { soldAt: 'desc' },
    take: 10,
  })
  const out: SaleQuestion[] = []
  for (const r of rows) {
    if (!isGoodsSale({ listingType: r.listingType, categorySlug: r.category?.slug ?? null })) continue
    const facts = saleFacts(r)
    if (!canRespondToSale({ actorProfileId: buyerProfileId, sellerProfileId: seller.ownerId, facts, now }).ok) continue
    out.push({
      saleId: `${r.id}:${confirmWindowAnchor(facts)?.getTime() ?? 0}`,
      listingId: r.id,
      title: r.title,
      price: confirmPromptPrice(facts),
      currency: r.currency || '₫',
    })
  }
  return out
}
