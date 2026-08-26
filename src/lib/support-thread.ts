import 'server-only'
// Relative specifier for `edition`, matching thread-kind.ts's idiom: `@/…` does not resolve under
// vitest and the edition split is the part of this file most worth unit-testing.
import { IS_SERVICES } from './edition'

/**
 * THE SUPPORT THREAD — "message support" as a real conversation in /messages, not a form.
 *
 * ⛔ ONE SUPPORT SELLER PER EDITION, AND THEY MUST NEVER MERGE. eno.vn and eno.forum share ONE
 * database. Keyed on the buyer alone, a person would have a single support thread across both
 * sites, so a conversation begun on eno.forum — where visa, itinerary and PayPal are legitimate
 * subjects — would surface in the licensed marketplace's inbox. Two seller rows, chosen by the
 * edition flag, is what keeps them apart; the partial unique index in scripts/support-thread-ddl.mjs
 * is keyed `(buyerProfileId, sellerId)` for exactly the same reason. A reviewer caught the
 * buyer-only version.
 *
 * ⚠️ BOTH ROWS ARE UNOWNED (`Seller.ownerId` IS NULL) ON PURPOSE. It keeps them out of the footer's
 * seller count (which counts owned storefronts) and out of every browse surface (they have no
 * listings). It also means `Conversation.sellerProfileId` stays null, so no human is impersonated
 * as the counterpart — replies come from the admin surface, which is one-way by design.
 * ⛔ Do NOT "fix" the null ownerId by pointing these at support@eno.vn. That address IS in
 * ADMIN_EMAILS, and giving it a Seller row would put an admin account into ordinary marketplace
 * seller surfaces.
 */
export const SUPPORT_SELLER_ID = IS_SERVICES ? 'eno-support-desk-forum' : 'eno-support-desk'

/** What the thread page needs to open the conversation. */
export type SupportThread = { id: string; created: boolean }

/**
 * Find this person's support thread, or open it.
 *
 * ⚠️ `listingId: null` IS THE WHOLE IDENTITY OF A SUPPORT THREAD, and it is also what every
 * consumer keys off — the server route derives `kind: null` from it, and the thread page hides the
 * offer bar, the listing subtitle, the availability chips and the "reveal number" action on the
 * strength of it. It is not a placeholder for a listing we failed to find.
 *
 * ⚠️ THE db HANDLE IS INJECTED rather than imported, so this is unit-testable. Importing `./db`
 * here would pull `@/generated/prisma/client` into the module graph, which is the exact reason
 * thread-kind.ts had to be split out of messages.ts — a rule that cannot be tested gets tested by
 * its callers mocking it, which tests nothing.
 */
export async function getOrCreateSupportThread(
  db: SupportThreadDb,
  buyerProfileId: string,
): Promise<SupportThread> {
  const find = () =>
    db.conversation.findFirst({
      where: { buyerProfileId, sellerId: SUPPORT_SELLER_ID, listingId: null },
      select: { id: true },
    })

  const existing = await find()
  if (existing) return { id: existing.id, created: false }

  try {
    const created = await db.conversation.create({
      // ⚠️ NO OPENING MESSAGE IS AUTHORED HERE. The support seller is unowned, so there is no
      // profile that could honestly send one — a greeting written by the system would render as a
      // message FROM support that no human at support has seen. The thread opens empty with the
      // composer focused, which is also what "open a message with support" asked for.
      data: { buyerProfileId, sellerId: SUPPORT_SELLER_ID, listingId: null },
      select: { id: true },
    })
    return { id: created.id, created: true }
  } catch (e) {
    /**
     * ⚠️ THE LOSER OF A DOUBLE-TAP, AND IT IS A REAL RACE RATHER THAN A DEFENSIVE CATCH: the button
     * is a single tap that fires a POST, and a double-tap fires two before the first returns.
     * The partial unique index rejects the second create; the winner's thread is the answer.
     * ⛔ Prisma does NOT know about that index (it is hand-rolled DDL, not in schema.prisma), so
     * this cannot be narrowed to a named constraint — it is matched on the P2002 code alone.
     * ⚠️ Re-finding rather than rethrowing is what stops a double-tap 500ing; if the refetch also
     * misses, the original error is the honest thing to surface.
     */
    if ((e as { code?: string })?.code === 'P2002') {
      const winner = await find()
      if (winner) return { id: winner.id, created: false }
    }
    throw e
  }
}

/** The slice of the Prisma client this module uses — see the injection note above. */
export type SupportThreadDb = {
  conversation: {
    findFirst(args: {
      where: { buyerProfileId: string; sellerId: string; listingId: null }
      select: { id: true }
    }): Promise<{ id: string } | null>
    create(args: {
      data: { buyerProfileId: string; sellerId: string; listingId: null }
      select: { id: true }
    }): Promise<{ id: string }>
  }
}
