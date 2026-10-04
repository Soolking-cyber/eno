import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'
import { maskEmailHandle } from '@/lib/utils'
import { blockingOn, isStaffProfile, setUserBlock } from '@/lib/user-blocks'

// Blocking another user — App Store Guideline 1.2 (plan R3), behind the `ugc-safety` review gate.
// See src/lib/user-blocks.ts for what a block does and why it notifies through the feedback queue.
//
// ⚠️ A BLOCK NEVER NAMES A PROFILE ID. The client sends the conversation or the storefront it is looking
// at and the server resolves the person behind it, so the chat API never hands the other party's
// profile id to the client. A profile id is accepted ONLY to UNBLOCK (the settings list, which this
// route returned), and it answers the same whether or not such a block existed — so the endpoint is
// not an oracle for which profile ids exist (codex + opus, review).
//
// Branches: 401 auth_required · 404 blocking_unavailable (gate off) · 400 invalid_body (also: a
// profile id with blocked:true) · 404 not_found (no such thread / shop, or no person behind it) ·
// 403 forbidden (not your thread) · 400 cannot_block_self · 403 cannot_block_staff · 200 {blocked}.

const bodySchema = z
  .object({
    conversationId: z.string().min(1).max(64).optional(),
    sellerId: z.string().min(1).max(64).optional(),
    profileId: z.string().uuid().optional(),
    blocked: z.boolean(),
  })
  .refine((b) => [b.conversationId, b.sellerId, b.profileId].filter(Boolean).length === 1, { message: 'exactly one target' })
  .refine((b) => !(b.profileId && b.blocked), { message: 'a profile id may only unblock' })

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
    } else if (body.profileId) {
      // Unblock only (the schema refuses blocked:true here) — idempotent and silent about whether the
      // id exists or was ever blocked.
      await setUserBlock(profile.id, body.profileId, false, { surface: 'settings' })
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
// so the settings UI can stay hidden without a second flag of its own.
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
      profileId: r.blocked.id,
      // Never the raw email — the same masking the inbox uses for a buyer with no display name.
      name: r.blocked.displayName || maskEmailHandle(r.blocked.email) || 'eno user',
      avatarUrl: r.blocked.avatarUrl,
      avatarColor: r.blocked.avatarColor,
      blockedAt: r.createdAt.toISOString(),
    })),
  }
})
