import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'
import { maskEmailHandle } from '@/lib/utils'
import { logError } from '@/lib/log'
import { BLOCK_HANDLE_RE, BlockHandleKeyMissing, blockHandle, blockingOn, isStaffProfile, setUserBlock, unblockByHandle } from '@/lib/user-blocks'

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
// Branches: 401 auth_required · 404 blocking_unavailable (gate off) · 503 blocking_unavailable (no
// signing secret, unblock only) · 400 invalid_body (also: a handle with blocked:true) · 404 not_found
// (no such thread / shop, no person behind it, or a handle that is not one of the caller's blocks) ·
// 403 forbidden (not your thread) · 400 cannot_block_self · 403 cannot_block_staff · 200 {blocked}.

const bodySchema = z
  .object({
    conversationId: z.string().min(1).max(64).optional(),
    sellerId: z.string().min(1).max(64).optional(),
    handle: z.string().regex(BLOCK_HANDLE_RE).optional(),
    blocked: z.boolean(),
  })
  .refine((b) => [b.conversationId, b.sellerId, b.handle].filter(Boolean).length === 1, { message: 'exactly one target' })
  .refine((b) => !(b.handle && b.blocked), { message: 'a handle may only unblock' })

export const POST = route(
  { auth: 'profile', body: bodySchema, invalidBodyCode: 'invalid_body', rateLimit: { bucket: 'user-block', limit: 30, window: '1 h' } },
  async ({ profile, body }) => {
    if (!blockingOn()) throw new ApiError('blocking_unavailable', 404)

    let target: string | null = null
    let surface: 'chat' | 'storefront' | 'settings' = 'settings'
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
      target = seller.ownerId // an imported, ownerless shop has nobody to block
      surface = 'storefront'
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

    await setUserBlock(profile.id, target, body.blocked, { surface, conversationId: body.conversationId ?? null, sellerId: body.sellerId ?? null })
    return { blocked: body.blocked }
  },
)

// The signed-in user's block list, for the settings section. `enabled: false` while the gate is off,
// so the settings UI can stay hidden without a second flag of its own. Each row carries its opaque
// `handle` (null only when no signing secret is configured — the row then cannot be unblocked from here).
export const GET = route({ auth: 'profile' }, async ({ profile }) => {
  if (!blockingOn()) return { enabled: false, blocked: [] }
  const rows = await db.forumUserBlock.findMany({
    where: { blockerProfileId: profile.id },
    orderBy: { createdAt: 'desc' },
    take: 1000,
    select: {
      createdAt: true,
      blocked: { select: { id: true, displayName: true, email: true, avatarUrl: true, avatarColor: true } },
    },
  })
  return {
    enabled: true,
    blocked: rows.map((r) => ({
      handle: blockHandle(profile.id, r.blocked.id),
      // Never the raw email — the same masking the inbox uses for a buyer with no display name.
      name: r.blocked.displayName || maskEmailHandle(r.blocked.email) || 'eno user',
      avatarUrl: r.blocked.avatarUrl,
      avatarColor: r.blocked.avatarColor,
      blockedAt: r.createdAt.toISOString(),
    })),
  }
})
