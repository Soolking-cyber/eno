// A school asks the teacher for their PRIVATE intro video (2026-10-07: "hide and send upon request"). A line in the
// thread as the school, and a ring for the teacher (within notify.ts's caps). A request unlocks NOTHING by itself — the
// teacher sends (video-share), or does not.
import { after } from 'next/server'
import { route, ApiError } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { insertMessage } from '@/lib/messages'
import { teacherThread } from '@/lib/teachers/share'
import { conversationGate } from '@/lib/enforcement'
import { isBlockedBetween } from '@/lib/user-blocks'
import { notifyTeacherOfSchoolMessage } from '@/lib/teachers/notify'

export const runtime = 'nodejs'

export const POST = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-video-request', limit: 10, window: '1 h', strict: true } },
  async ({ req, profile }) => {
    const body = (await req.json().catch(() => null)) as { conversationId?: unknown } | null
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : ''
    if (!conversationId) throw new ApiError('bad_request', 400)
    const t = await teacherThread(conversationId)
    if (!t || t.recruiterUserId !== profile.id) throw new ApiError('not_found', 404)
    if (profile.accountType !== 'business') throw new ApiError('business_only', 403)
    if ((await conversationGate(profile.id))?.error === 'account_suspended') throw new ApiError('account_suspended', 403)
    if (await isBlockedBetween(t.recruiterUserId, t.teacherUserId)) throw new ApiError('blocked', 403)
    if (!t.videoAvailable) throw new ApiError('video_not_on_request', 409)
    if (t.videoShared) return { ok: true, requested: false, shared: true }
    // A school may ask again a day later (share.ts ASK_AGAIN_MS), or once the teacher stopped sharing since — never
    // locked out by one revoke. ⛔ The SAME flags the strip reads (teacherVideoState `requested` / `askAgain`), never a
    // second clock: "Ask again" is offered exactly when this route would take it (gate review, 2026-10-08).
    // ⚠️ Accepted residual: two tabs asking at the same instant can both pass this check and post two identical 🎬
    // lines. The state is the same either way (an upsert), and notify.ts's pair limit (1 per thread per 6 h) keeps the
    // teacher's ring to one; the contact share route has the same shape.
    const askedRecently = t.videoRequested && !t.videoAskAgain
    if (askedRecently) return { ok: true, requested: true, shared: false }
    const now = new Date()
    // ⛔ ONE TRANSACTION (SendOpts.alongside): never a request the teacher was not told about — two steps left one after a
    // crash between them, and the "asked recently" rule above then silenced every retry for a day (gate review, 2026-10-07).
    await insertMessage(
      { id: t.convo.id, buyerProfileId: t.convo.buyerProfileId, sellerProfileId: t.convo.sellerProfileId, listingId: t.convo.listingId, sellerId: t.convo.sellerId },
      profile.id,
      '🎬 Bạn có thể gửi video giới thiệu không? · Could you send your intro video?',
      { alongside: [db.teacherVideoShare.upsert({ where: { conversationId }, create: { conversationId, requestedAt: now }, update: { requestedAt: now } })] },
    )
    // The teacher's bell + push — notify.ts's own pair limit (1 per thread per 6 h) and 20/day cap apply.
    const teacherProfileId = t.teacherUserId
    const listingId = t.convo.listingId
    after(() => notifyTeacherOfSchoolMessage({ teacherProfileId, conversationId, listingId }))
    return { ok: true, requested: true, shared: false }
  },
)
