import 'server-only'
import { db } from '@/lib/db'
import { logError } from '@/lib/log'
import { scopedListingWhere } from '@/lib/edition-scope'
import { RENTAL_DESK_SELLER_ID } from './desk-ids'
import { RENTAL_CHECK_CATEGORY_SLUG } from './shared'

/**
 * WHO ANSWERS AN AVAILABILITY CHECK, AND WHICH LISTINGS MAY BE CHECKED.
 *
 * The thread's counterpart is the unowned rental desk (desk-ids.ts); the PERSON behind it is the
 * operator — `Conversation.sellerProfileId` — which is what puts the request in their own /messages
 * inbox and lets them reply in-app. Owner: requests "should land in messages to support@eno.forum
 * account messages".
 */

/**
 * ⚠️ READ PER CALL, NOT AT MODULE SCOPE, so a test (or an env edit picked up on restart) cannot be
 * defeated by an import that happened first. Set it in BOTH env files (eno-root-env and
 * eno-services-env) if it ever changes — the two deployments are separate processes.
 */
export function rentalOperatorEmail(): string {
  return (process.env.RENTAL_CHECK_OPERATOR_EMAIL || 'support@eno.forum').trim().toLowerCase()
}

/**
 * The operator's Profile id, or null when the configured address resolves to nobody.
 *
 * ⚠️ NULL IS A REFUSAL, NOT A FALLBACK. The route answers 503 `desk_unavailable` rather than open a
 * thread nobody can read — a request that lands in no inbox is worse than one the person is told to
 * retry, because they would wait for an answer that is never coming.
 * ⚠️ A DATABASE ERROR PROPAGATES (the route turns it into a 500); only "no such profile" is null.
 */
export async function resolveRentalOperatorProfileId(): Promise<string | null> {
  const email = rentalOperatorEmail()
  if (!email) return null
  // ⚠️ AN EXACT MATCH ON THE LOWERCASED ADDRESS, the convention edition-scope.ts's owner lookups
  // use: auth mirrors emails into Profile lowercased, and a case-insensitive Prisma filter compiles
  // to ILIKE, where a `_` in the configured address would match any character.
  const profile = await db.profile.findUnique({ where: { email }, select: { id: true } })
  return profile?.id ?? null
}

/**
 * Create this edition's desk Seller row if it does not exist yet — `INSERT … ON CONFLICT DO NOTHING`.
 *
 * ⚠️ LAZY, SO THERE IS NO DDL SCRIPT AND NO DEPLOY ORDERING. Only `id` and `name` are NOT NULL
 * without a default on "Seller" (scripts/support-thread-ddl.mjs records the check against
 * information_schema, and the same two-column insert created both support desks in production), so
 * this cannot rot as the model grows. `ownerId` stays NULL: an unowned desk never counts as a
 * storefront and never enters browse.
 * ⚠️ Once per process after the first success — the row, once there, never goes away on its own.
 */
let deskEnsured = false
export async function ensureRentalDeskSeller(): Promise<void> {
  if (deskEnsured) return
  await db.seller.createMany({ data: [{ id: RENTAL_DESK_SELLER_ID, name: 'eno team' }], skipDuplicates: true })
  deskEnsured = true
}

/**
 * Re-point every existing rental-desk thread of THIS edition at the current operator — once per
 * process, on the first request after a start.
 *
 * ⚠️ WHY IT EXISTS: `getOrCreateListinglessThread` re-points a thread when its requester sends again,
 * but a requester who never sends again would keep a thread answering to the PREVIOUS operator after
 * RENTAL_CHECK_OPERATOR_EMAIL moved — their earlier request stranded in an inbox nobody reads.
 * ⚠️ THIS EDITION'S DESK ONLY, NOT BOTH. The operator address is read per DEPLOYMENT; if the two
 * editions were ever configured with different operators, sweeping both desks would have each
 * process re-point the other's threads on every restart — a ping-pong with a real inbox on each end.
 * ⚠️ BEST-EFFORT: a failure is logged and retried on the next request; it never fails a send.
 */
let sweptFor: string | null = null
export async function repointRentalDeskThreads(operatorId: string): Promise<void> {
  if (sweptFor === operatorId) return
  try {
    await db.conversation.updateMany({
      where: {
        sellerId: RENTAL_DESK_SELLER_ID,
        listingId: null,
        // Spelled as an OR so a NULL sellerProfileId is matched too — `{ not: x }` alone would
        // compile to `<> x`, which is NULL (not true) for a NULL column.
        OR: [{ sellerProfileId: null }, { sellerProfileId: { not: operatorId } }],
      },
      data: { sellerProfileId: operatorId },
    })
    sweptFor = operatorId
  } catch (e) {
    logError(e, { op: 'rental-check.repoint' })
  }
}

/** The columns the card snapshot is built from — nothing else is read. */
export const CHECKABLE_RENTAL_SELECT = {
  id: true, title: true, titleVi: true, images: true, price: true, currency: true, priceUnit: true,
} as const

export type CheckableRental = {
  id: string; title: string; titleVi: string | null; images: string
  price: number; currency: string; priceUnit: string
}

/**
 * The subset of `ids` that may be checked on THIS edition: live (`active` + `verified` — the
 * publication gate), in the rentals category, and visible here.
 *
 * ⛔ THROUGH `scopedListingWhere`, NEVER A BARE `where`. That is the licensing predicate every
 * marketplace listing read goes through (desk exclusion + the allow-list), so a request can only ever
 * snapshot a listing this edition would itself show. It THROWS on eno.vn when the desk cannot be
 * resolved, which the route surfaces as a 500 rather than an unfiltered read.
 */
export async function resolveCheckableRentals(ids: readonly string[]): Promise<CheckableRental[]> {
  if (!ids.length) return []
  return db.listing.findMany({
    where: await scopedListingWhere({
      id: { in: [...ids] },
      status: 'active',
      verified: true,
      category: { slug: RENTAL_CHECK_CATEGORY_SLUG },
    }),
    select: CHECKABLE_RENTAL_SELECT,
  })
}

/** Test seam: forget the once-per-process state. */
export function __resetRentalDeskStateForTests(): void {
  deskEnsured = false
  sweptFor = null
}
