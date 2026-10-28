import { after } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'
import { maskEmailHandle } from '@/lib/utils'
import { isSellerHiddenHere } from '@/lib/edition-scope'
import { logError } from '@/lib/log'
import {
  BLOCK_HANDLE_RE, BlockHandleKeyMissing, SellerBlocksMissing, blockHandle, blockingOn, hiddenSellerIdsFor, isMissingTable, isShopOnlyBlock,
  isStaffProfile, setSellerBlock, setUserBlock, shopBlockHandle, unblockByHandle,
} from '@/lib/user-blocks'
import { endCallsBetween } from '@/lib/calls/server/session'
import { afterCallEnded } from '@/lib/calls/server/finish'

// Blocking another user — App Store Guideline 1.2 (plan R3), behind the `ugc-safety` review gate.
// See src/lib/user-blocks.ts for what a block does and why it notifies through the feedback queue.
//
// ⚠️ THIS ENDPOINT NEVER TAKES OR GIVES A PROFILE ID. The client sends the conversation or the
// storefront it is looking at and the server resolves the person behind it, so the chat API never hands
// the other party's profile id to the client. The settings list names each block by an opaque HANDLE
// (an HMAC bound to the blocker — user-blocks.ts), and a handle is accepted ONLY to UNBLOCK, and only
// among the CALLER's OWN blocks (follow-up 3 of 0a470ed98). An unmatched handle answers 404 — which is
// not an oracle: a handle is minted per blocker with a server key, so the only handles that can ever
// match are ones GET already showed this same caller; a miss says "not one of your blocks (any more)",
// nothing about any other profile. (It used to answer 200 either way, which let a stale handle — a key
// rotation, a block already undone elsewhere — show "unblocked" while the block stood; opus, plan review.)
//
// ⛔ A SHOP NOBODY BLOCKABLE RUNS IS BLOCKED AS A SHOP (App Store 1.2 rejection, 2026-10-28 — the reviewer's screenshot
// was an imported "Linked shop" with Report and no Block). `sellerId` with no owner, or with an owner on the eno team,
// writes a SellerBlock (setSellerBlock) instead of answering "nobody to block"; a shop a person runs still blocks that
// person. `listingId` (optional, with `sellerId` only) says the block was made on that listing's page — it goes into the
// moderator note once the server has checked the listing is that shop's.
//
// Branches: 401 auth_required · 404 blocking_unavailable (gate off) · 503 blocking_unavailable (no
// signing secret, unblock only; or a shop block before scripts/seller-blocks-ddl.mjs) · 400 invalid_body (also: a
// handle with blocked:true) · 404 not_found (no such thread / shop, no person behind a thread, or a handle that is not
// one of the caller's blocks) · 403 forbidden (not your thread) · 400 cannot_block_self · 403 cannot_block_staff (a
// THREAD with the eno team, or a staffer blocking a person) · 200 {blocked}.

const bodySchema = z
  .object({
    conversationId: z.string().min(1).max(64).optional(),
    sellerId: z.string().min(1).max(64).optional(),
    handle: z.string().regex(BLOCK_HANDLE_RE).optional(),
    listingId: z.string().min(1).max(64).optional(),
    blocked: z.boolean(),
  })
  .refine((b) => [b.conversationId, b.sellerId, b.handle].filter(Boolean).length === 1, { message: 'exactly one target' })
  .refine((b) => !(b.handle && b.blocked), { message: 'a handle may only unblock' })
  .refine((b) => !b.listingId || !!b.sellerId, { message: 'a listing names its shop' })

export const POST = route(
  { auth: 'profile', body: bodySchema, invalidBodyCode: 'invalid_body', rateLimit: { bucket: 'user-block', limit: 30, window: '1 h' } },
  async ({ profile, body }) => {
    if (!blockingOn()) throw new ApiError('blocking_unavailable', 404)

    let target: string | null = null
    let surface: 'chat' | 'storefront' | 'listing' | 'settings' = 'settings'
    let listingId: string | null = null
    if (body.conversationId) {
      const convo = await db.conversation.findUnique({
        where: { id: body.conversationId },
        select: { buyerProfileId: true, sellerProfileId: true },
      })
      if (!convo) throw new ApiError('not_found', 404)
      if (convo.buyerProfileId !== profile.id && convo.sellerProfileId !== profile.id) throw new ApiError('forbidden', 403)
      // A support or reference thread has no person on the other side (sellerProfileId null).
      target = convo.buyerProfileId === profile.id ? convo.sellerProfileId : convo.buyerProfileId
      surface = 'chat'
    } else if (body.sellerId) {
      const seller = await db.seller.findUnique({ where: { id: body.sellerId }, select: { ownerId: true } })
      if (!seller) throw new ApiError('not_found', 404)
      if (seller.ownerId === profile.id) throw new ApiError('cannot_block_self', 400)
      if (body.listingId) {
        const listing = await db.listing.findUnique({ where: { id: body.listingId }, select: { sellerId: true } })
        if (listing?.sellerId === body.sellerId) listingId = body.listingId
      }
      surface = listingId ? 'listing' : 'storefront'
      // Nobody blockable runs it (no owner, or the eno team): block the SHOP — hidden from this user, moderators told.
      if (await isShopOnlyBlock(seller.ownerId)) {
        // The eno team does not block (opus, review): a moderator hiding a shop from their own browsing hides it
        // from the person who reviews it.
        if (body.blocked && (await isStaffProfile(profile.id))) throw new ApiError('cannot_block_staff', 403)
        try {
          await setSellerBlock(profile.id, body.sellerId, body.blocked, { surface, sellerId: body.sellerId, listingId })
        } catch (e) {
          if (!(e instanceof SellerBlocksMissing)) throw e
          logError(e, { op: 'blocks.sellerBlock' })
          throw new ApiError('blocking_unavailable', 503)
        }
        return { blocked: body.blocked }
      }
      target = seller.ownerId
    } else if (body.handle) {
      // Unblock only (the schema refuses blocked:true here) — among the caller's OWN blocks.
      let matched: boolean
      try {
        matched = await unblockByHandle(profile.id, body.handle)
      } catch (e) {
        // No signing secret: nothing can be verified, so say so rather than claim an unblock. Any OTHER
        // failure (the database) is not that, and goes to route()'s ordinary 500 (opus, gate round 2).
        if (!(e instanceof BlockHandleKeyMissing)) throw e
        logError(e, { op: 'blocks.unblockByHandle' })
        throw new ApiError('blocking_unavailable', 503)
      }
      if (!matched) throw new ApiError('not_found', 404)
      return { blocked: false }
    }
    if (!target) throw new ApiError('not_found', 404)
    if (target === profile.id) throw new ApiError('cannot_block_self', 400)
    // Neither side may be the eno team: it owns the e-Visa desk and imported shops (see isStaffProfile).
    if (body.blocked && ((await isStaffProfile(target)) || (await isStaffProfile(profile.id)))) throw new ApiError('cannot_block_staff', 403)

    await setUserBlock(profile.id, target, body.blocked, { surface, conversationId: body.conversationId ?? null, sellerId: body.sellerId ?? null, listingId })
    // ⛔ A BLOCK ENDS ANY LIVE CALL BETWEEN THE TWO, and revokes its relay credentials (in-app calls, DESIGN.md v3 §3.2
    // step 9). The end itself runs HERE, inside the request (commit-gate review: a block answered 200 while its call ran
    // on was the failure); only the revocation and the record wait for after(). A calls failure never fails the block —
    // and the heartbeat route re-checks blocks every 15 s, so a call this misses still ends within seconds.
    if (body.blocked) {
      try {
        const ended = await endCallsBetween(profile.id, target, 'blocked')
        for (const row of ended) after(() => afterCallEnded(row, 'blocked'))
      } catch (e) {
        if (!(e instanceof Error && /42P01|call_session" does not exist/.test(e.message))) logError(e, { op: 'blocks.endCalls' })
      }
    }
    // ⛔ A PERSON BLOCKED FROM THEIR OWN SHOP'S PAGE: their shop goes on the blocker's hidden list too — a SellerBlock row
    // with no second note (setUserBlock filed it). The blocker is looking at that shop, so its id tells them nothing new;
    // a person blocked from a CHAT gets no such row (src/lib/user-blocks.ts header). Unblocking the person lifts it
    // (deletePersonBlock, inside setUserBlock / unblockByHandle). AFTER the call end (codex, review), so a failure here can
    // never leave a call running; and NOT swallowed (codex + opus, review): the toast says "their listings are hidden",
    // so a row that did not land answers 500 and the button says "try again" — a retry is idempotent (the person block
    // is already there). Only a missing table (before the DDL) is let through.
    if (body.blocked && body.sellerId) {
      await setSellerBlock(profile.id, body.sellerId, true, { surface, sellerId: body.sellerId, listingId }, { note: false }).catch((e: unknown) => {
        if (!(e instanceof SellerBlocksMissing)) throw e
        logError(e, { op: 'blocks.ownShopRow' })
      })
    }
    return { blocked: body.blocked }
  },
)

/** hiddenSellerIdsFor, less any shop this edition hides anyway (the other edition's desk) — never even its id here. */
async function hiddenShopIdsHere(me: string): Promise<string[]> {
  const ids = await hiddenSellerIdsFor(me)
  const gone = await Promise.all(ids.map((id) => isSellerHiddenHere(id)))
  return ids.filter((_, i) => !gone[i])
}

// The signed-in user's block list, for the settings section. `enabled: false` while the gate is off,
// so the settings UI can stay hidden without a second flag of its own. Each row carries its opaque
// `handle` (null only when no signing secret is configured — the row then cannot be unblocked from here)
// and its `kind`: a person, or a shop blocked as a shop (newest first, together).
// `hiddenSellerIds` — the shops whose content src/lib/hidden-sellers.ts hides from this user (hiddenSellerIdsFor).
// `?only=ids` — that list alone: what AuthProvider's sync reads on every signed-in load, so it skips the list's joins.
export const GET = route({ auth: 'profile' }, async ({ profile, req }) => {
  if (!blockingOn()) return { enabled: false, blocked: [], hiddenSellerIds: [] }
  if (new URL(req.url).searchParams.get('only') === 'ids') return { enabled: true, hiddenSellerIds: await hiddenShopIdsHere(profile.id) }
  const [rows, shops, hiddenSellerIds] = await Promise.all([
    db.forumUserBlock.findMany({
      where: { blockerProfileId: profile.id },
      orderBy: { createdAt: 'desc' },
      take: 1000,
      select: {
        createdAt: true,
        blocked: { select: { id: true, displayName: true, email: true, avatarUrl: true, avatarColor: true } },
      },
    }),
    db.sellerBlock
      .findMany({
        where: { blockerProfileId: profile.id },
        orderBy: { createdAt: 'desc' },
        take: 1000,
        select: { createdAt: true, seller: { select: { id: true, ownerId: true, name: true, avatarUrl: true, avatarColor: true } } },
      })
      .catch((e: unknown) => { if (isMissingTable(e)) return []; throw e }),
    hiddenShopIdsHere(profile.id),
  ])
  const people = rows.map((r) => ({
    kind: 'person' as const,
    handle: blockHandle(profile.id, r.blocked.id),
    // Never the raw email — the same masking the inbox uses for a buyer with no display name.
    name: r.blocked.displayName || maskEmailHandle(r.blocked.email) || 'eno user',
    avatarUrl: r.blocked.avatarUrl,
    avatarColor: r.blocked.avatarColor,
    blockedAt: r.createdAt.toISOString(),
  }))
  // A person-run shop's row (written beside its owner's person block) is that PERSON's block: listed once, as them.
  // ⛔ And never a shop this edition hides (opus, review): the database is shared, so a block of eno.forum's e-Visa desk
  // made there would otherwise put the desk's name on eno.vn's settings page — where it may not even be mentioned.
  const peopleBlocked = new Set(rows.map((r) => r.blocked.id))
  const hiddenHere = await Promise.all(shops.map((r) => isSellerHiddenHere(r.seller.id)))
  const shopRows = shops.filter((r, i) => !hiddenHere[i] && (!r.seller.ownerId || !peopleBlocked.has(r.seller.ownerId))).map((r) => ({
    kind: 'shop' as const,
    handle: shopBlockHandle(profile.id, r.seller.id),
    name: r.seller.name,
    avatarUrl: r.seller.avatarUrl,
    avatarColor: r.seller.avatarColor,
    blockedAt: r.createdAt.toISOString(),
  }))
  return {
    enabled: true,
    blocked: [...people, ...shopRows].sort((a, b) => (a.blockedAt < b.blockedAt ? 1 : a.blockedAt > b.blockedAt ? -1 : 0)),
    hiddenSellerIds,
  }
})
