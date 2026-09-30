// The teacher's "Share my phone, email & CV" in one conversation — and its revocation (2026-09-30).
import { route, ApiError } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { insertMessage } from '@/lib/messages'
import { teacherThread } from '@/lib/teachers/share'
import { conversationGate } from '@/lib/enforcement'

export const runtime = 'nodejs'

export const POST = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-share', limit: 10, window: '1 h', strict: true } },
  async ({ req, profile }) => {
    const body = (await req.json().catch(() => null)) as { conversationId?: unknown; share?: unknown } | null
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : ''
    const share = body?.share !== false
    if (!conversationId) throw new ApiError('bad_request', 400)
    const t = await teacherThread(conversationId)
    // Only the teacher of THIS thread may share or revoke. Anyone else: it does not exist.
    if (!t || t.teacherUserId !== profile.id) throw new ApiError('not_found', 404)
    // A suspended teacher posts nothing (sharing announces itself as a message).
    if ((await conversationGate(profile.id))?.error === 'account_suspended') throw new ApiError('account_suspended', 403)
    // Sharing from a hidden or pulled profile would announce details the recruiter cannot get.
    if (share && !t.profileLive) throw new ApiError('profile_hidden', 409)
    // ⚠️ AGAINST THE TEACHER'S OWN CHOICE (`shareOn`), NOT `shared`: on a hidden profile `shared` is
    // false, so "Stop sharing" was a no-op there and the share came back on un-hide (Opus, gate 09-30).
    if (share === t.shareOn) return { ok: true, shared: t.shareOn }
    await db.teacherContactShare.upsert({
      where: { conversationId },
      create: { conversationId, sharedAt: new Date(), revokedAt: share ? null : new Date() },
      update: share ? { sharedAt: new Date(), revokedAt: null } : { revokedAt: new Date() },
    })
    // A line in the thread, as the teacher, so the recruiter is told (realtime + unread) — the same
    // way an accepted offer announces itself. Bilingual, like the offer lines.
    await insertMessage(
      { id: t.convo.id, buyerProfileId: t.convo.buyerProfileId, sellerProfileId: t.convo.sellerProfileId, listingId: t.convo.listingId, sellerId: t.convo.sellerId },
      profile.id,
      share
        ? '📇 Đã chia sẻ số điện thoại, email và CV · Shared my phone, email and CV'
        : '🔒 Đã ngừng chia sẻ liên hệ · Stopped sharing my contact details',
    )
    return { ok: true, shared: share }
  },
)
