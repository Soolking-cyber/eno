// The teacher's "Share my phone, email & CV" in one conversation — and its revocation (2026-09-30).
import { route, ApiError } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { insertMessage } from '@/lib/messages'
import { logError } from '@/lib/log'
import { teacherThread } from '@/lib/teachers/share'
import { conversationGate } from '@/lib/enforcement'
import { isBlockedBetween } from '@/lib/user-blocks'

export const runtime = 'nodejs'

export const POST = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-share', limit: 10, window: '1 h', strict: true } },
  async ({ req, profile }) => {
    const body = (await req.json().catch(() => null)) as { conversationId?: unknown; share?: unknown } | null
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : ''
    // FAIL CLOSED (gate review, 2026-10-07): only a literal `true` sends and a literal `false` stops — a missing field or
    // the string "false" must never hand anything over.
    if (!conversationId || typeof body?.share !== 'boolean') throw new ApiError('bad_request', 400)
    const share = body.share
    const t = await teacherThread(conversationId)
    // Only the teacher of THIS thread may share or revoke. Anyone else: it does not exist.
    if (!t || t.teacherUserId !== profile.id) throw new ApiError('not_found', 404)
    // A suspended teacher posts nothing (sharing announces itself as a message).
    if ((await conversationGate(profile.id))?.error === 'account_suspended') throw new ApiError('account_suspended', 403)
    // Sharing from a hidden or pulled profile would announce details the recruiter cannot get.
    if (share && !t.profileLive) throw new ApiError('profile_hidden', 409)
    // App Store gate `ugc-safety` (R3): no contact handover across a block (unsharing still works).
    if (share && await isBlockedBetween(t.convo.buyerProfileId, t.convo.sellerProfileId)) throw new ApiError('blocked', 403)
    // ⚠️ AGAINST THE TEACHER'S OWN CHOICE (`shareOn`), NOT `shared`: on a hidden profile `shared` is
    // false, so "Stop sharing" was a no-op there and the share came back on un-hide (Opus, gate 09-30).
    if (share === t.shareOn) return { ok: true, shared: t.shareOn }
    // A line in the thread, as the teacher, so the recruiter is told (realtime + unread) — the same
    // way an accepted offer announces itself. Bilingual, like the offer lines.
    const convo = { id: t.convo.id, buyerProfileId: t.convo.buyerProfileId, sellerProfileId: t.convo.sellerProfileId, listingId: t.convo.listingId, sellerId: t.convo.sellerId }
    const now = new Date()
    if (share) {
      // ⛔ A SHARE COMMITS WITH ITS LINE OR NOT AT ALL (SendOpts.alongside, 2026-10-07). Written in two steps, a failed or
      // interrupted line left a grant the recruiter was never told about, and the no-op above then swallowed every retry
      // (the gap the intro-video review found here).
      await insertMessage(convo, profile.id, '📇 Đã chia sẻ số điện thoại, email và CV · Shared my phone, email and CV', {
        alongside: [db.teacherContactShare.upsert({ where: { conversationId }, create: { conversationId, sharedAt: now, revokedAt: null }, update: { sharedAt: now, revokedAt: null } })],
      })
    } else {
      // ⛔ A REVOKE NEVER DEPENDS ON ITS LINE: it commits first, on its own; the line is best-effort (gate review, 2026-10-07).
      await db.teacherContactShare.upsert({ where: { conversationId }, create: { conversationId, sharedAt: now, revokedAt: now }, update: { revokedAt: now } })
      await insertMessage(convo, profile.id, '🔒 Đã ngừng chia sẻ liên hệ · Stopped sharing my contact details')
        .catch((err) => logError(err, { op: 'teachers.contact_revoke_line' }))
    }
    return { ok: true, shared: share }
  },
)
