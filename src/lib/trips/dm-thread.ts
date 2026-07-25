import 'server-only'
import { cache } from 'react'
// Relative specifiers, matching the visa modules' idiom: `@/…` does not resolve under vitest
// and this file is unit-tested.
import { db } from '../db'

/**
 * The trip desk's THREAD layer — who the desk is, which thread a case lives in, and who is
 * allowed to bind the two together. Nothing here authors a message; that is dm-flow's job.
 *
 * Ported from src/lib/visa/dm-thread.ts, whose three load-bearing rules are reproduced with
 * their reasons rather than their code:
 *
 *   1. THE SENDER IS RESOLVED FROM THE DESK, NEVER FROM AN ARGUMENT. No function here accepts
 *      a sender/author parameter. The desk identity comes from getTripDesk() alone, so no
 *      caller — and no future route forwarding a request body — can nominate who spoke.
 *   2. OWNERSHIP IS PROVEN BEFORE BINDING. TripAssistanceRequest.conversationId is written only
 *      after the case's own profileId has been shown to equal the thread's buyer. A binding is
 *      the thing every later gate trusts, so it must never be created on a caller's word.
 *   3. MODE IS DERIVED FROM THE NEWEST EVENT, NOT STORED IN A COLUMN. See tripDeskMode.
 */

/**
 * ⚠️ A LIST, and the fallback is an address that PROVABLY RESOLVES. Both details are scar
 * tissue from the visa surface, which went silently dead in prod on 2026-07-22 because its
 * owner constant was pinned to a single address for which no Profile row existed: every card,
 * binding and charge path failed closed while the products sat published. See the long note on
 * VISA_SHOP_OWNER_EMAILS in src/lib/visa-shop.ts.
 *
 * The default here is the support account because it is the only staffed operator identity in
 * this system that has been VERIFIED to have both an auth.users row and a Profile row (checked
 * in both columns during that investigation). Naming an aspirational address like
 * trips@eno.vn would reproduce the exact outage: a resolver that matches nothing, and a
 * feature that looks configured while being inert.
 *
 * Deliberately NOT importing VISA_SHOP_OWNER_EMAILS: the trip desk and the visa desk happen to
 * be the same account today, and coupling the two constants would mean a future visa-only
 * change silently retargets trip threads.
 */
export const TRIP_DESK_OWNER_EMAILS: readonly string[] = (
  process.env.TRIP_DESK_OWNER_EMAIL || 'support@eno.forum'
)
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean)

export type TripDesk = { id: string; ownerId: string; name: string }

/**
 * The storefront that answers trip-assistance threads. Fail-soft: a null here means the desk
 * is not set up, and every caller degrades to "assistance unavailable" rather than throwing.
 */
export const getTripDesk = cache(async (): Promise<TripDesk | null> => {
  try {
    // `in`, not `equals` — see TRIP_DESK_OWNER_EMAILS. memberSince ordering makes a duplicated
    // support identity resolve to the ORIGINAL storefront deterministically, not by row luck.
    const seller = await db.seller.findFirst({
      where: { owner: { email: { in: [...TRIP_DESK_OWNER_EMAILS] } } },
      orderBy: { memberSince: 'asc' },
      select: { id: true, ownerId: true, name: true },
    })
    // ⚠️ Seller.ownerId is NULLABLE. An unclaimed storefront has no profile to speak as, so it
    // is not a usable desk — treating it as one would create threads whose sellerProfileId is
    // null, and buildTripCardMeta refuses those, so every card would fail later instead of the
    // feature reporting itself unavailable now. Same rule findVisaThread applies on read.
    if (!seller?.ownerId) return null
    return { id: seller.id, ownerId: seller.ownerId, name: seller.name }
  } catch (e) {
    console.error('[trips] desk lookup', e)
    return null
  }
})

/**
 * A Conversation REQUIRES a listing (Conversation.listingId is non-null, and the table carries
 * @@unique([listingId, buyerProfileId]) — one thread per buyer per listing). Trip assistance
 * has no product to sell: eno arranges, the traveller pays suppliers directly. So the thread
 * hangs off a single anchor listing on the desk's own storefront, found by this marker.
 *
 * ⚠️ THE FEATURE IS DORMANT UNTIL THAT LISTING EXISTS, deliberately and visibly. No listing →
 * bindTripThread returns 'listing_unavailable' → the traveller sees assistance as unavailable,
 * and nothing 500s. Seeding it is an owner/Alex step (the visa shop needed
 * scripts/seed-visa-shop.mjs for the same reason); a seed script is outside T307's Owned paths,
 * so this resolver is written to fail closed rather than to conjure a listing of its own.
 */
export const TRIP_ASSISTANCE_LISTING_EXTERNAL_ID = 'trip-assistance-anchor'

export const getTripAssistanceListingId = cache(async (): Promise<string | null> => {
  const desk = await getTripDesk()
  if (!desk) return null
  try {
    const listing = await db.listing.findFirst({
      where: { sellerId: desk.id, externalId: TRIP_ASSISTANCE_LISTING_EXTERNAL_ID },
      select: { id: true },
    })
    return listing?.id ?? null
  } catch (e) {
    console.error('[trips] assistance listing lookup', e)
    return null
  }
})

export type TripThreadRef = { conversationId: string; buyerProfileId: string; deskProfileId: string }
export type BindTripThreadResult =
  | { ok: true; conversationId: string; created: boolean }
  | { ok: false; error: 'request_not_found' | 'not_your_request' | 'desk_unavailable' | 'listing_unavailable' | 'thread_conflict' }

/**
 * Bind an assistance case to a marketplace thread, creating the thread if needed.
 *
 * `buyerProfileId` is the CALLER'S OWN authenticated profile — the route passes the session
 * identity, never a body field — and rule (2) is enforced against it below.
 */
export async function bindTripThread(input: { requestId: string; buyerProfileId: string }): Promise<BindTripThreadResult> {
  const { requestId, buyerProfileId } = input

  const request = await db.tripAssistanceRequest.findUnique({
    where: { id: requestId },
    select: { id: true, profileId: true, conversationId: true },
  })
  if (!request) return { ok: false, error: 'request_not_found' }
  // (2) OWNERSHIP BEFORE BINDING. Everything downstream — card authorship, the traveller-match
  // gate in buildTripCardMeta, the operator's view — trusts this binding, so it is proven here
  // and nowhere else is allowed to create one.
  if (request.profileId !== buyerProfileId) return { ok: false, error: 'not_your_request' }

  const desk = await getTripDesk()
  if (!desk) return { ok: false, error: 'desk_unavailable' }
  // ⚠️ RESOLVED BEFORE THE THREAD LOOKUP, not just before a create. The anchor listing is what
  // IDENTIFIES a trip thread — see the lookup below — so a missing one means there is nothing
  // safe to reuse either, not merely nothing to create.
  const listingId = await getTripAssistanceListingId()
  if (!listingId) return { ok: false, error: 'listing_unavailable' }

  // Already bound: re-verify rather than trust the stored pointer. A thread whose buyer is not
  // this traveller means the binding is corrupt, and answering it would hand one traveller's
  // case to another's thread.
  if (request.conversationId) {
    const bound = await verifyDeskThread(request.conversationId, buyerProfileId, desk.ownerId)
    if (!bound) return { ok: false, error: 'thread_conflict' }
    return { ok: true, conversationId: bound, created: false }
  }

  // ⚠️ LOOKED UP BY (listingId, buyerProfileId) — THE COMPOSITE UNIQUE — NOT BY SELLER.
  //
  // This was a real bug, found independently by both external reviewers, using evidence this
  // file's own comments handed them: the trip desk and the VISA desk are currently the same
  // account. The previous lookup was findFirst({ sellerId, buyerProfileId }) ordered by
  // lastMessageAt, so any traveller who had ever opened a visa thread with that account would
  // have their trip case bound to THAT thread — trip quote cards posted into a visa
  // conversation, against a listing that is a visa product.
  //
  // Keying on the anchor listing fixes it at the root: a trip thread IS the thread on the
  // assistance listing. It is also strictly better mechanically — this is exactly the
  // @@unique([listingId, buyerProfileId]) index, so the read is a single-row findUnique with no
  // ordering to guess, and the P2002 handler below re-reads by the SAME key that threw.
  const existing = await db.conversation.findUnique({
    where: { listingId_buyerProfileId: { listingId, buyerProfileId } },
    select: { id: true, sellerProfileId: true },
  })
  // A reused thread keeps whatever sellerProfileId it was created with, so the desk identity is
  // NOT freshly derived for it (codex). Check it: if the desk account has moved, the old thread
  // is answered by nobody the current desk controls, and binding to it would silently produce
  // cards the new desk cannot author.
  if (existing && existing.sellerProfileId !== desk.ownerId) return { ok: false, error: 'thread_conflict' }
  let conversationId = existing?.id ?? ''
  let created = false
  if (!existing) {
    try {
      const convo = await db.conversation.create({
        // sellerProfileId is the desk OWNER's profile — the identity that will author every
        // card. Set here, from the resolved desk, so rule (1) holds structurally: there is no
        // later opportunity for a caller to supply an author.
        data: { listingId, buyerProfileId, sellerId: desk.id, sellerProfileId: desk.ownerId },
        select: { id: true },
      })
      conversationId = convo.id
      created = true
    } catch (e) {
      // Double-tap loser on @@unique([listingId, buyerProfileId]) — adopt the winner's thread
      // instead of failing the traveller's click.
      if ((e as { code?: string })?.code !== 'P2002') throw e
      // Re-read by the SAME unique key that just threw, so the winner is found by definition
      // rather than by a second guess at which thread was meant.
      const raced = await db.conversation.findUnique({
        where: { listingId_buyerProfileId: { listingId, buyerProfileId } },
        select: { id: true },
      })
      if (!raced) return { ok: false, error: 'thread_conflict' }
      conversationId = raced.id
    }
  }

  // COMPARE-AND-SET on the binding itself. `conversationId: null` in the WHERE means a second
  // concurrent bind of the same case matches zero rows instead of overwriting the first — two
  // tabs clicking "get help" cannot leave the case pointing at a thread that half the system
  // already stopped using. The loser adopts the winner's binding.
  //
  // `profileId` is in the WHERE too: the ownership check above is a READ, and a concurrent
  // change between it and this write would otherwise bind a case the caller no longer owns
  // (codex — the same finding it made against the card guard, which I had fixed there and not
  // here). Re-asserting it costs nothing; it is a column on the row being written.
  const claim = await db.tripAssistanceRequest.updateMany({
    where: { id: requestId, conversationId: null, profileId: buyerProfileId },
    data: { conversationId },
  })
  if (claim.count === 0) {
    const winner = await db.tripAssistanceRequest.findUnique({
      where: { id: requestId },
      select: { conversationId: true },
    })
    if (!winner?.conversationId) return { ok: false, error: 'thread_conflict' }
    // ⚠️ VERIFY WHAT WE ADOPT. Returning the winner's binding unchecked would hand back a
    // thread this function never validated — and the zero-row result could equally mean the
    // ownership predicate failed, i.e. the case is no longer the caller's at all.
    const verified = await verifyDeskThread(winner.conversationId, buyerProfileId, desk.ownerId)
    if (!verified) return { ok: false, error: 'thread_conflict' }
    return { ok: true, conversationId: verified, created: false }
  }
  return { ok: true, conversationId, created }
}

/**
 * Is this conversation a usable desk thread for THIS traveller? Returns its id or null.
 *
 * Both the already-bound path and the lost-race path go through here, so a binding is verified
 * the same way however it was arrived at — the two used to differ, and the second one verified
 * nothing at all.
 */
async function verifyDeskThread(conversationId: string, buyerProfileId: string, deskOwnerId: string): Promise<string | null> {
  const convo = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, buyerProfileId: true, sellerProfileId: true },
  })
  if (!convo) return null
  if (convo.buyerProfileId !== buyerProfileId) return null
  // The desk side must still be the desk we resolved — see the reuse check above.
  if (convo.sellerProfileId !== deskOwnerId) return null
  return convo.id
}

/** The thread a case lives in, with the two identities a card write needs. */
export async function findTripThread(requestId: string): Promise<TripThreadRef | null> {
  const request = await db.tripAssistanceRequest.findUnique({
    where: { id: requestId },
    select: { conversationId: true },
  })
  if (!request?.conversationId) return null
  const convo = await db.conversation.findUnique({
    where: { id: request.conversationId },
    select: { id: true, buyerProfileId: true, sellerProfileId: true },
  })
  // An unclaimed seller means nobody can author cards in this thread, so it is not a usable
  // trip thread — the same reason findVisaThread refuses one.
  if (!convo?.sellerProfileId) return null
  return { conversationId: convo.id, buyerProfileId: convo.buyerProfileId, deskProfileId: convo.sellerProfileId }
}

export type TripDeskMode = 'auto' | 'human'
/** The two events that move the mode, and what each means. */
const MODE_EVENTS: Record<string, TripDeskMode> = {
  desk_takeover_started: 'human',
  desk_takeover_ended: 'auto',
}

/**
 * (3) MODE IS DERIVED, NOT STORED. Whether a human operator has taken this case over is read
 * back from the newest takeover event rather than from a column, for the reason the visa desk
 * documents: a mode column is a second source of truth that drifts from the audit trail the
 * moment one write succeeds and the other doesn't. Derived, the trail IS the state.
 *
 * What it is FOR: stopping the automated flow from posting over a human. An operator mid-
 * conversation must not have a generated status card appear underneath them.
 *
 * Fails to 'auto' on a lookup error — the automated flow continuing is a smaller harm than the
 * whole surface going silent, and a human takeover is re-announced by its own card anyway.
 */
export async function tripDeskMode(requestId: string): Promise<TripDeskMode> {
  try {
    const latest = await db.tripAssistanceEvent.findFirst({
      // ⚠️ FILTERED TO THE TAKEOVER EVENTS, so "newest" means newest event THAT MOVES THE MODE,
      // not newest event on the case. That is deliberate and worth stating precisely, because I
      // described it wrongly when I sent it for review: an unmapped newer event (a
      // 'status_changed', say) is IGNORED, not treated as a reset to 'auto'. Ignoring is what a
      // mode wants — otherwise every ordinary status change would silently end a human takeover
      // mid-conversation, which is the exact thing this exists to prevent (codex).
      where: { requestId, event: { in: Object.keys(MODE_EVENTS) } },
      // id as a tiebreaker: two events in the same millisecond would otherwise resolve by row
      // order, which is not a guarantee Postgres makes.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { event: true },
    })
    if (!latest) return 'auto'
    // Unreachable given the filter above, kept as a defensive default rather than a `!`.
    return MODE_EVENTS[latest.event] ?? 'auto'
  } catch (e) {
    console.error('[trips] desk mode', e)
    return 'auto'
  }
}
