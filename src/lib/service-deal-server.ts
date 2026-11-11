import 'server-only'
import { db } from '@/lib/db'
import { LICENCE_HELD_NOTE } from '@/lib/licence-stamp'
import { RENTAL_DESK_SELLER_IDS } from '@/lib/rental-check/desk-ids'
import { JOBS_DESK_SELLER_ID } from '@/lib/teachers/job-dms/constants'
import { SUPPORT_SELLER_ID } from '@/lib/support-thread'
import type { DealRow } from '@/lib/service-deal'

/**
 * THE SERVICE-DEAL LOOP'S READS (src/lib/service-deal.ts holds the rules). Server-only.
 *
 * ⛔ MIGRATION TOLERANCE (spec v2 §7). DealConfirmation is created by scripts/deal-confirmation-ddl.mjs, which the owner
 * applies before the deploy — but a build that reads it must never take the review POST or the chat poll down with it if
 * that order slips. So the row is read with its OWN findUnique, never as a relation of a hot query, and only on a thread
 * the feature is about; a missing table or column (P2021 / P2022) reads as "no deal".
 */

/** The columns the rules read (service-deal.ts DealRow). */
export const DEAL_ROW_SELECT = {
  listingId: true, sellerId: true, sellerProfileId: true, buyerProfileId: true, kind: true,
  confirmedAt: true, revokedAt: true, declinedAt: true, confirmCount: true, reviewId: true,
} as const

// isMissingRelation lives in the pure module (service-deal.ts) so non-server readers (seller-metrics, the storefront, the Help
// center) can ask it too; re-exported here for the server paths that already import it from this file.
import { isMissingRelation } from '@/lib/service-deal'
export { isMissingRelation }

/**
 * This conversation's DealConfirmation, or null. A missing table/column is null.
 * `failSoft` (the polled thread GET): ANY failure is null and logged — a chat must never 500 over a review affordance
 * (the hasReviewed lookup's rule). Otherwise a real database error is thrown to the caller.
 */
export async function readDealConfirmation(conversationId: string, opts: { failSoft?: boolean } = {}): Promise<DealRow | null> {
  try {
    return await db.dealConfirmation.findUnique({ where: { conversationId }, select: DEAL_ROW_SELECT })
  } catch (e) {
    if (isMissingRelation(e)) return null
    if (opts.failSoft) {
      console.error('[service-deal] deal read failed', e)
      return null
    }
    throw e
  }
}

/**
 * The moderation status of the DEAL's OWN listing (deal.listingId) — the one the review is filed against — for the
 * taken-down refusal. ⛔ THE ROW DECIDES, NEVER THE LISTING'S CURRENT TYPE (2026-11-11): once a DealConfirmation exists,
 * the buyer's card, the review POST and the buyer's "No" read the kind, listing and storefront off the row, so a seller
 * cannot close the door by switching the listing to 'wanted' or 'sell' after confirming. Only a TAKEDOWN (moderation)
 * still closes it, and that is read here.
 * The thread's own listing answers when it IS the deal's (always, in practice: a thread holding a deal is never
 * retargeted — threadHoldsDeal below); otherwise one read by id. A listing that no longer exists answers 'taken_down':
 * there is nothing left to file a review against. A failed read is thrown — the caller decides how soft to be.
 */
export async function dealListingCompliance(
  deal: Pick<DealRow, 'listingId'>,
  threadListing: { id: string; complianceStatus?: string | null; verified?: boolean | null; verificationNotes?: string | null } | null | undefined,
): Promise<string | null> {
  // ⛔ A LICENCE HOLD CLOSES IT TOO (review, 2026-11-11): a visa-legal / legal-permits listing the licence check took down
  // (licence-stamp.ts LICENCE_HELD_NOTE) is not a provider eno has cleared, so no review lands on it — read like a takedown.
  // ⛔ AND AN UNPUBLISHED ONE (opus, round 2): an admin Unverify or a moderation Unpublish clears the licence mark and files
  // nothing, but the listing is not public any more — no review lands on it. Every caller selects verified and
  // verificationNotes with the thread's listing (deal route, thread GET, review POST).
  const closed = (l: { verified?: boolean | null; verificationNotes?: string | null }) => l.verified === false || l.verificationNotes === LICENCE_HELD_NOTE
  if (threadListing && threadListing.id === deal.listingId) {
    return closed(threadListing) ? 'taken_down' : (threadListing.complianceStatus ?? null)
  }
  const l = await db.listing.findUnique({ where: { id: deal.listingId }, select: { complianceStatus: true, verified: true, verificationNotes: true } })
  if (!l) return 'taken_down'
  return closed(l) ? 'taken_down' : (l.complianceStatus ?? null)
}

/**
 * THE DATABASE'S CLOCK, read inside the transaction that writes (codex, 2026-11-11). A request that read the row before the
 * undo deadline but writes after it must be judged at the write, and the four windows (confirm, withdraw, decline, review)
 * by one clock — Postgres now() is the transaction's start, after every read the route made.
 */
export async function dbNow(tx: { $queryRaw: <T>(q: TemplateStringsArray, ...v: unknown[]) => Promise<T> }): Promise<Date> {
  // clock_timestamp(), NOT now(): now() is the transaction's START, so a write that waited on a row lock would judge the
  // deadline by a clock from before the wait (codex, round 2). Callers take the deal row's lock FIRST (lockDealRow), then read
  // this — the deadline is judged after every wait, at the write.
  const rows = await tx.$queryRaw<{ now: Date | string }[]>`SELECT clock_timestamp() AS now`
  return new Date(rows[0].now)
}

/** The deal row's lock, taken before the clock is read and before its conditional update (dbNow's rule). */
export async function lockDealRow(tx: { $queryRaw: <T>(q: TemplateStringsArray, ...v: unknown[]) => Promise<T> }, conversationId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "DealConfirmation" WHERE "conversationId" = ${conversationId} FOR UPDATE`
}

/**
 * threadHoldsDeal INSIDE a transaction (the retarget's, under the thread's row lock). ⛔ NEVER LET THE MISSING TABLE ERROR
 * HAPPEN THERE (codex, round 2): Postgres aborts the whole transaction on any error, caught or not, so the move after it would
 * fail. Before the DDL the table's presence is asked first (to_regclass never errors), and nothing is bound without it.
 */
export async function threadHoldsDealTx(
  tx: { $queryRaw: <T>(q: TemplateStringsArray, ...v: unknown[]) => Promise<T> } & Pick<typeof db, 'dealConfirmation'>,
  conversationId: string,
): Promise<boolean> {
  const present = await tx.$queryRaw<{ present: boolean }[]>`SELECT to_regclass('public."DealConfirmation"') IS NOT NULL AS present`
  if (!present[0]?.present) return false
  return !!(await tx.dealConfirmation.findUnique({ where: { conversationId }, select: { id: true } }))
}

/**
 * Does this thread hold a DealConfirmation (any state)? retargetForListing's binding (spec v2 §9): such a thread is never
 * moved to another listing. A missing table is "no" (nothing can be bound before the DDL); any other failure is thrown,
 * so a database error never quietly re-points a confirmed deal.
 */
export async function threadHoldsDeal(conversationId: string, client: Pick<typeof db, 'dealConfirmation'> = db): Promise<boolean> {
  try {
    return !!(await client.dealConfirmation.findUnique({ where: { conversationId }, select: { id: true } }))
  } catch (e) {
    if (isMissingRelation(e)) return false
    throw e
  }
}

/**
 * THE LISTING-LESS "eno team" DESKS by seller id — the rental desks, the jobs desk and this edition's support desk. The
 * thread GET keeps its own DESK_BY_SELLER_ID map for its chrome; this is the deal route's copy of the same fact.
 */
export const ENO_TEAM_DESK_SELLER_IDS: ReadonlySet<string> = new Set<string>([...RENTAL_DESK_SELLER_IDS, JOBS_DESK_SELLER_ID, SUPPORT_SELLER_ID])

/**
 * Is this thread with one of eno's OWN desks — a listing-less team desk, the visa / trip desk storefront, or one of its
 * listings (the visa catalogue, the trip anchor)? The deal route asks this on every write.
 * ⚠️ BY SELLER AND BY LISTING (memory eno-desk-shared-seller: the visa and trip desks are ONE storefront, and the seller
 * check alone is never enough), and FAILS CLOSED: a lookup that throws answers "a desk" — refusing a confirmation costs a
 * retry; painting a deal onto a desk product would not.
 * Lazy imports: the visa / trip modules load only on this write path, never on a poll.
 */
export async function isEnoDeskThread(sellerId: string, listingId: string | null): Promise<boolean> {
  if (ENO_TEAM_DESK_SELLER_IDS.has(sellerId) || !listingId) return true
  try {
    const [{ getVisaShopListings }, { getTripAssistanceListingId }, { deskSellerIds }] = await Promise.all([
      import('@/lib/visa-shop'),
      import('@/lib/trips/dm-thread'),
      import('@/lib/edition-scope'),
    ])
    const [desks, visa, trip] = await Promise.all([deskSellerIds(), getVisaShopListings(), getTripAssistanceListingId()])
    return desks.includes(sellerId) || trip === listingId || visa.some((l) => l.id === listingId)
  } catch (e) {
    console.error('[service-deal] desk lookup failed — refusing (fail closed)', e)
    return true
  }
}
