import 'server-only'
import { db } from '@/lib/db'
import { appendAudit } from '@/lib/compliance/audit'
import { logError } from '@/lib/log'
import { LICENCE_HELD_NOTE } from '@/lib/licence-stamp'
import { RENTAL_DESK_SELLER_IDS } from '@/lib/rental-check/desk-ids'
import { JOBS_DESK_SELLER_ID } from '@/lib/teachers/job-dms/constants'
import { SUPPORT_SELLER_ID } from '@/lib/support-thread'
import { SERVICE_DEAL, isMissingRelation, isServiceDealKind, type DealRow, type ServiceDealKind } from '@/lib/service-deal'

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

// ── THE MODERATOR'S UNDO (Admin › Moderation, owner 2026-11-12) ─────────────────────────────────────────────────────────
// After the seller's 10 minutes "the confirmation stands; only an admin removes it, through a Report on the thread"
// (SERVICE_DEAL.WITHDRAW_WINDOW_MINUTES). This is that removal: the ⋯ menu of an OPEN chat report's case card, while the
// thread holds a live confirmation and no review. It writes what the seller's undo writes (confirmedAt → null, revokedAt
// → the database's clock), so every buyer-side reader already treats the deal as closed: the thread GET's
// mayReviewService, the review POST (403 deal_withdrawn) and the buyer's "No" (not_confirmed).

/**
 * The DealConfirmationEvent actor when eno's MODERATION acts. Never a Profile id (real ids are random v4 UUIDs; this one
 * is not v4-shaped) and NOT NIL_UUID, which account erasure reserves for "an erased person". The admin's email goes on
 * the compliance_audit row written in the same transaction.
 */
export const MODERATION_ACTOR_ID = '00000000-0000-0000-0000-00000000a0d1'

export type AdminWithdrawResult = { ok: true } | { ok: false; reason: 'not_confirmed' | 'already_reviewed' | 'deal_declined' | 'already_resolved' }

/** The conditional write matched nothing: the seller undid (and maybe re-confirmed), the buyer declined, a review landed. */
class AdminWithdrawLost extends Error {}
/** A review of the thread exists under the row lock — an offer-path one too. */
class AdminWithdrawReviewed extends Error {}
/** The report is no longer open under its row lock — another moderator decided the case first. */
class AdminWithdrawResolved extends Error {}

/**
 * Withdraw the seller's confirmation on `conversationId`, as eno's moderation. `seenConfirmedAt` is the confirmation the
 * admin SAW on the case card: a stale card (the seller undid and re-confirmed since the page loaded) loses with
 * 'not_confirmed' instead of undoing a confirmation nobody looked at. One transaction:
 *   · ⛔ LOCK ORDER — the compliance_audit advisory lock FIRST, then the deal row. Account erasure takes the audit lock
 *     (appendAudit) and THEN deletes the person's DealConfirmation rows in one transaction; locking the row first and
 *     auditing after would take the two in the opposite order and could deadlock against it. Advisory xact locks are
 *     re-entrant, so appendAudit taking it again below is free.
 *   · ⛔ …AND THE ROW LOCK NEVER WAITS (NOWAIT): a SELLER's own erasure locks their deal rows BEFORE its audit lock —
 *     its listing.deleteMany / seller.delete cascade Conversation → DealConfirmation (account-erasure.ts, before its
 *     appendAudit) — so no single order is safe against both paths. Holding the global audit lock, this transaction
 *     never queues on a row: a row someone else holds (an erasure, a review or a seller's write in flight — rare and
 *     brief) fails at once (55P03), nothing is written and the admin is told it failed. No wait, no cycle.
 *   · ⛔ A BOUNDED WAIT for the audit lock itself — a transaction-local lock_timeout: every KYC decision, erasure and
 *     consent beacon queues on that one lock. A timeout is an ordinary error, like the NOWAIT refusal.
 *   · Row lock, then the clock (dbNow's rule); a review under the lock refuses; the conditional UPDATE re-asserts
 *     reviewId / revokedAt / declinedAt null and the SEEN confirmedAt, with NO window — the admin is not windowed.
 *   · ⛔ THE THREAD'S CONFIRM BUDGET IS SPENT (confirmCount → MAX_CONFIRMS_PER_THREAD): the seller cannot re-open the card
 *     on this thread right after a moderator closed it (confirmsLeft() → 0, the state after two confirm-and-undo
 *     cycles, which the seller's strip already handles). The seller's own undo leaves the budget alone; this does not.
 *   · An 'admin_withdraw' event (actor MODERATION_ACTOR_ID — the confirm cap counts 'confirm' and the decline flag counts
 *     'declined', so neither moves) and the hash-chained audit row with the admin's email.
 * ⛔ NOT DONE, ON PURPOSE: no chat timeline line (insertMessage refuses a deal line not authored by the thread's seller,
 * and writing it in the seller's name would put an admin's act in their mouth — the buyer's card closes on the next poll);
 * no trust event, recompute, syncEnforcement or flag, and no revalidatePublicPath — a confirmation minted nothing public,
 * so withdrawing it un-mints nothing. The report's status is not touched either: the admin still decides the case —
 * it is only READ, under its row lock, and must still be 'open' (else 'already_resolved').
 * A missing table is thrown to the caller (the route answers 503 migration_pending), as is any other database error.
 */
export async function adminWithdrawDeal(
  conversationId: string,
  o: { admin: string; reportId: string; seenConfirmedAt: Date },
): Promise<AdminWithdrawResult> {
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('lock_timeout', '5000ms', true)`
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('compliance_audit'))`
      // ⛔ THE CASE MUST STILL BE OPEN, UNDER ITS ROW LOCK (gate review, codex): the route's status read is outside this
      // transaction, so another moderator could Confirm / Dismiss the case between it and this write. Locked here (NOWAIT,
      // the same rule as the deal row — never queue while holding the audit lock), a resolution that committed first is
      // seen, and one that comes after waits for this transaction.
      const rep = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "Report" WHERE "id" = ${o.reportId} FOR UPDATE NOWAIT`
      if (rep[0]?.status !== 'open') throw new AdminWithdrawResolved()
      // lockDealRow's statement with NOWAIT (see above): never queue on the row while holding the audit lock.
      await tx.$queryRaw`SELECT 1 FROM "DealConfirmation" WHERE "conversationId" = ${conversationId} FOR UPDATE NOWAIT`
      const t = await dbNow(tx)
      if (await tx.review.findUnique({ where: { conversationId }, select: { id: true } })) throw new AdminWithdrawReviewed()
      const deal = await tx.dealConfirmation.findUnique({ where: { conversationId }, select: DEAL_ROW_SELECT })
      const r = await tx.dealConfirmation.updateMany({
        where: { conversationId, reviewId: null, revokedAt: null, declinedAt: null, confirmedAt: { equals: o.seenConfirmedAt } },
        data: { confirmedAt: null, revokedAt: t, confirmCount: SERVICE_DEAL.MAX_CONFIRMS_PER_THREAD },
      })
      if (r.count !== 1 || !deal) throw new AdminWithdrawLost()
      await tx.dealConfirmationEvent.create({
        data: { conversationId, listingId: deal.listingId, sellerId: deal.sellerId, actorProfileId: MODERATION_ACTOR_ID, buyerProfileId: deal.buyerProfileId, action: 'admin_withdraw' },
      })
      await appendAudit(tx, {
        actorType: 'admin',
        actorId: o.admin,
        action: 'deal.confirmation.withdrawn',
        subjectType: 'seller',
        subjectId: deal.sellerId,
        detail: { conversationId, reportId: o.reportId, listingId: deal.listingId, kind: deal.kind, confirmedAt: deal.confirmedAt?.toISOString() ?? null },
      })
    }, { timeout: 15_000 }) // above the bounded audit-lock wait, so the database's lock_timeout is what answers a stuck wait
    return { ok: true }
  } catch (e) {
    if (e instanceof AdminWithdrawReviewed) return { ok: false, reason: 'already_reviewed' }
    if (e instanceof AdminWithdrawResolved) return { ok: false, reason: 'already_resolved' }
    if (e instanceof AdminWithdrawLost) {
      const again = await readDealConfirmation(conversationId)
      return { ok: false, reason: again?.reviewId ? 'already_reviewed' : again?.declinedAt ? 'deal_declined' : 'not_confirmed' }
    }
    throw e
  }
}

/** A live confirmation as the moderation queue shows it. */
export type LiveDeal = { kind: ServiceDealKind; confirmedAt: Date }

/**
 * The LIVE confirmations among these conversations — confirmed, not withdrawn, not declined, not reviewed — for the
 * moderation queue's "Undo the seller's confirmation" item. One DealConfirmation read for the page, then one Review read
 * that drops any thread holding a review (an offer-path one that was never linked to the deal too; Review.conversationId
 * is unique). Only the three service kinds. FAIL-SOFT: the moderation page must never 500 over it — a missing table reads
 * as no deals, silently; any other failure is logged and reads as no deals.
 */
export async function liveDealsFor(conversationIds: string[]): Promise<Map<string, LiveDeal>> {
  const out = new Map<string, LiveDeal>()
  const ids = [...new Set(conversationIds.filter(Boolean))]
  if (!ids.length) return out
  try {
    const rows = await db.dealConfirmation.findMany({
      where: { conversationId: { in: ids }, confirmedAt: { not: null }, revokedAt: null, declinedAt: null, reviewId: null },
      select: { conversationId: true, kind: true, confirmedAt: true },
    })
    const hits: Array<{ conversationId: string } & LiveDeal> = []
    for (const r of rows) if (r.confirmedAt && isServiceDealKind(r.kind)) hits.push({ conversationId: r.conversationId, kind: r.kind, confirmedAt: r.confirmedAt })
    if (!hits.length) return out
    const reviewed = await db.review.findMany({ where: { conversationId: { in: hits.map((h) => h.conversationId) } }, select: { conversationId: true } })
    const gone = new Set(reviewed.map((r) => r.conversationId))
    for (const h of hits) if (!gone.has(h.conversationId)) out.set(h.conversationId, { kind: h.kind, confirmedAt: h.confirmedAt })
    return out
  } catch (e) {
    if (!isMissingRelation(e)) logError(e, { op: 'service-deal.liveDealsFor' })
    return new Map()
  }
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
