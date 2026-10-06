import { NextRequest, NextResponse } from 'next/server'
import { checkListingOwner } from '@/lib/listing-owner'
import { db } from '@/lib/db'
import { maskEmailHandle } from '@/lib/utils'
import { blockingOn, isBlockedBetween } from '@/lib/user-blocks'
import {
  asksBuyerAbout,
  declinedBuyerIds,
  listingThreadsWhere,
  nobodyEverMessaged,
  offerThreadIdsFor,
} from '@/lib/core/sale-loop'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The buyers who've messaged this seller — powers the native "Who did you sell to?"
// picker in the Mark-sold sheet. SELLER-scoped, not listing-scoped: threads are one-
// per-buyer-per-seller and get retargeted to the buyer's latest listing, so filtering
// by listingId would drop legitimate buyers who since asked about another item. Most
// recent conversation first (the buyer for this item is typically near the top).
//
// ⚠️ WS6 — NOT MIGRATED, and the reason is a measured regression rather than a preference.
// All four route() options would be empty here (public / no limiter / no schema), which is the
// pure-churn shape the migration declines — but `auth:` is worse than empty, it is a DOUBLE
// RESOLVE. checkListingOwner (src/lib/listing-owner.ts:15) opens with getCurrentProfile(), and
// neither it, getCurrentProfile nor createSupabaseServer is wrapped in React cache() (verified
// 2026-08-06 — no `cache(` in any of the three), so `auth: 'profile'` would run getUser() over
// the network TWICE and read the Profile row twice on every open of the Mark-sold sheet, purely
// to satisfy the wrapper. `auth: 'public'` with the helper left in place buys nothing at all.
//
// Branches, all unchanged: guest → 401 auth_required · no storefront → 403 no_storefront ·
// unknown listing → 404 not_found · someone else's listing → 403 forbidden · success → 200
// {"buyers":[…]}. Revisit if checkListingOwner ever grows a variant taking an already-resolved
// caller — at that point auth becomes a real option and this is a one-line migration.
//
// ── `?scope=listing` — the web "Who bought it?" sheet (B6) ──────────────────────────────────────
// That sheet's list is "the people who messaged about THIS listing" (listingThreadsWhere in
// src/lib/core/sale-loop.ts):
//   · the threads anchored to this listing now, and
//   · threads that carried an OFFER about it before being retargeted elsewhere. insertMessage and
//     actOnOffer stamp the thread's listing of the moment on the seller's 'offer' notification, which is
//     the only record of what a thread was about before a retarget (Message has no listingId).
// ⛔ POST /sold REFUSES ANYONE OUTSIDE THAT SAME SCOPE (400 buyer_not_in_conversations) — one predicate,
// so the sheet never offers a person the write rejects. And it leaves out anyone who already said "No,
// I did not" about this listing: POST /sold refuses them too (409 buyer_declined). ⛔ BOTH scopes leave out
// anyone with a block between them and this seller, either way (gate `ugc-safety`; blockedBuyerIds below).
// ⚠️ STILL LOSSY, in the direction of a false "nobody messaged": a buyer who only CHATTED about this
// listing and then asked the same seller about another one leaves no trace here. So an EMPTY list is
// not, by itself, permission to pre-select "someone not on eno" — `nobodyMessaged` below is: true only
// when NO thread of this seller has been active since the listing was created, i.e. when no conversation
// can have been about it, moved or not (nobodyEverMessaged). Unsure → false → the sheet picks nothing.
// `asksBuyer` says whether naming someone really sends them the "did you buy this?" question (a sale of
// goods, never the services desk — asksBuyerAbout), so the sheet's footer promises exactly that.
// Without the parameter the answer is the seller-wide list the native apps' picker has always read.
//
// `name` falls back to the masked e-mail handle ("mi***"), exactly as the inbox and the thread header do
// (conversations routes): a picker where every e-mail sign-up reads "Buyer" cannot tell two people apart.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await checkListingOwner(id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.code })
  const listingOnly = new URL(req.url).searchParams.get('scope') === 'listing'

  const offerThreadIds = listingOnly ? await offerThreadIdsFor(auth.profileId, id) : []

  const convos = await db.conversation.findMany({
    where: listingOnly ? listingThreadsWhere(auth.sellerId, id, offerThreadIds) : { sellerId: auth.sellerId },
    orderBy: { lastMessageAt: 'desc' },
    take: 50,
    select: {
      id: true,
      buyerProfileId: true,
      lastMessageAt: true,
      buyer: { select: { displayName: true, email: true, avatarUrl: true, avatarColor: true } },
    },
  })
  const project = (c: (typeof convos)[number]) => ({
    conversationId: c.id,
    profileId: c.buyerProfileId,
    name: c.buyer?.displayName || maskEmailHandle(c.buyer?.email) || null,
    avatarUrl: c.buyer?.avatarUrl ?? null,
    avatarColor: c.buyer?.avatarColor ?? null,
    lastMessageAt: c.lastMessageAt.toISOString(),
  })
  // ⛔ Nobody with a block between them and this seller, either way (gate `ugc-safety`), in EITHER scope:
  // POST /sold refuses them (blockedBuyerIds below).
  const blocked = await blockedBuyerIds(auth.profileId, convos.map((c) => c.buyerProfileId))
  const reachable = convos.filter((c) => !blocked.has(c.buyerProfileId))
  if (!listingOnly) return NextResponse.json({ buyers: reachable.map(project) })

  // edition-lint-allow: ONE row by id, the CALLER'S OWN listing (checkListingOwner above); it yields
  // two booleans and a decline filter, never a listing field.
  const listing = await db.listing.findUnique({
    where: { id },
    select: {
      createdAt: true, sellerId: true, listingType: true, category: { select: { slug: true } },
      saleBuyerHistory: true, saleDeclinedAt: true, soldToProfileId: true,
    },
  })
  if (!listing) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const declined = declinedBuyerIds(listing)
  const buyers = reachable.filter((c) => !declined.has(c.buyerProfileId)).map(project)
  // Only an EMPTY scope can be "nobody messaged"; proving it costs one indexed probe, paid only then. (`convos`,
  // not `reachable`: someone left out for a block still messaged.)
  const nobodyMessaged = convos.length === 0 && (await nobodyEverMessaged(auth.sellerId, listing.createdAt))
  const asksBuyer = await asksBuyerAbout({ sellerId: listing.sellerId, listingType: listing.listingType, categorySlug: listing.category?.slug ?? null })
  return NextResponse.json({ buyers, nobodyMessaged, asksBuyer })
}

/**
 * The listed buyers with a block between them and this seller, EITHER way (App Store gate `ugc-safety`). POST
 * /sold refuses each of them (isBlockedBetween — the same 400 as no thread), so the picker must not offer them.
 * Off ⇒ empty, with no query. On ⇒ ONE read for the whole list (the block table's primary key and its
 * blockedProfileId index) rather than a lookup per buyer — the native picker lists up to 50 — and
 * isBlockedBetween, the predicate /sold applies, has the last word on each (rare) hit, so its rules stay in one
 * place: a block with the eno team on either side is void, in the picker exactly as in the write.
 */
async function blockedBuyerIds(sellerProfileId: string, buyerProfileIds: string[]): Promise<Set<string>> {
  if (!blockingOn() || !buyerProfileIds.length) return new Set()
  const ids = [...new Set(buyerProfileIds)]
  const rows = await db.forumUserBlock.findMany({
    where: { OR: [{ blockerProfileId: sellerProfileId, blockedProfileId: { in: ids } }, { blockedProfileId: sellerProfileId, blockerProfileId: { in: ids } }] },
    select: { blockerProfileId: true, blockedProfileId: true },
  })
  const hits = [...new Set(rows.map((r) => (r.blockerProfileId === sellerProfileId ? r.blockedProfileId : r.blockerProfileId)))]
  const confirmed = await Promise.all(hits.map((b) => isBlockedBetween(sellerProfileId, b)))
  return new Set(hits.filter((_, i) => confirmed[i]))
}
