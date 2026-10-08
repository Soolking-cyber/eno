// The teacher's "Send my intro video" in one conversation — and its revocation (owner, 2026-10-07: "hide and send upon
// request"). ⛔ ITS OWN GRANT (TeacherVideoShare): it never unlocks the phone, email or CV, nor they it.
import { NextResponse } from 'next/server'
import { route, ApiError } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { insertMessage } from '@/lib/messages'
import { logError } from '@/lib/log'
import { teacherThread } from '@/lib/teachers/share'
import { conversationGate } from '@/lib/enforcement'
import { isBlockedBetween } from '@/lib/user-blocks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-video-share', limit: 20, window: '1 h', strict: true } },
  async ({ req, profile }) => {
    const body = (await req.json().catch(() => null)) as { conversationId?: unknown; share?: unknown } | null
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : ''
    // FAIL CLOSED (gate review, 2026-10-07): only a literal `true` sends and a literal `false` stops — a missing field or
    // the string "false" must never hand anything over.
    if (!conversationId || typeof body?.share !== 'boolean') throw new ApiError('bad_request', 400)
    const share = body.share
    const t = await teacherThread(conversationId)
    // Only the teacher of THIS thread may send or stop. Anyone else: it does not exist.
    if (!t || t.teacherUserId !== profile.id) throw new ApiError('not_found', 404)
    if (share) {
      // Sending announces itself and hands a video over: a suspended account does neither. STOPPING is always allowed —
      // a hold must never leave a teacher unable to take their video back (review, 2026-10-07).
      if ((await conversationGate(profile.id))?.error === 'account_suspended') throw new ApiError('account_suspended', 403)
      // ⛔ Business-only, like the ask and the watch: a personal account (a parent) can never watch the video, so it is
      // never sent one — the grant would sit there unusable (gate review, 2026-10-08). The thread's buyer, as re-read.
      if (!t.videoForBusiness) throw new ApiError('business_only', 403)
      if (!t.profileLive) throw new ApiError('profile_hidden', 409)
      if (!t.videoAvailable) throw new ApiError('video_missing', 404)
      if (await isBlockedBetween(t.convo.buyerProfileId, t.convo.sellerProfileId)) throw new ApiError('blocked', 403)
    }
    // Against the teacher's own grant (`videoShareOn`), never the gated `videoShared` — on a hidden profile that is
    // false, and "Stop" would be a no-op that comes back on un-hide (the contact route's lesson, gate 09-30).
    // ⚠️ Accepted residual: two tabs sending (or stopping) at the same instant can both pass this check and post two
    // identical 🎬 lines. The state is the same either way (an upsert), and a plain line rings nobody (insertMessage: no
    // bell or push for chat text); the contact share route has the same shape.
    if (share === t.videoShareOn) return { ok: true, shared: t.videoShareOn }
    const now = new Date()
    const convo = { id: t.convo.id, buyerProfileId: t.convo.buyerProfileId, sellerProfileId: t.convo.sellerProfileId, listingId: t.convo.listingId, sellerId: t.convo.sellerId }
    // The school is told in the thread, as the teacher (realtime + unread) — bilingual, like the contact line.
    // ⚠️ Every intro-video line starts with 🎬 — the strip refreshes its video state on that prefix, and the contact strip
    // on 📇/🔒 (messages/[id]/page.tsx), so neither refetches on the other's announcements.
    if (share) {
      // ⛔ A SEND COMMITS WITH ITS LINE OR NOT AT ALL (SendOpts.alongside): two steps left a grant with no line after a crash
      // between them, and every retry then hit the no-op above — the school was never told (gate review, 2026-10-07).
      // Realtime is delivered on commit, so the strip's re-read always finds the grant the line announces.
      // ⚠️ Accepted residual: a Send racing a REPLACEMENT saved in another tab (milliseconds apart) can land after that
      // save's revoke and so grant the new video — the teacher's own act of sending, to a school they chose; a save that
      // lands after this send revokes it as usual.
      await insertMessage(convo, profile.id, '🎬 Đã gửi video giới thiệu · Sent my intro video', {
        alongside: [db.teacherVideoShare.upsert({ where: { conversationId }, create: { conversationId, sharedAt: now, revokedAt: null }, update: { sharedAt: now, revokedAt: null } })],
      })
    } else {
      // ⛔ A STOP NEVER DEPENDS ON ITS LINE (gate review, 2026-10-07): the revoke commits first, on its own, and from that
      // moment the watch route mints no new link (one already handed out plays until it expires, ≤ 10 minutes — the strip
      // tells the teacher). The line is best-effort: a school not told yet sees the stop on its next read.
      await db.teacherVideoShare.upsert({ where: { conversationId }, create: { conversationId, revokedAt: now }, update: { revokedAt: now } })
      await insertMessage(convo, profile.id, '🎬 Đã ngừng chia sẻ video giới thiệu · Stopped sharing my intro video')
        .catch((err) => logError(err, { op: 'teachers.video_stop_line' }))
    }
    return { ok: true, shared: share }
  },
)

// The thread's video state for its two parties — what the strip re-reads when a 🎬 line lands (a send, a stop, an ask
// arrive as realtime messages, never as a new thread payload). Flags only, the same derivation as the thread payload.
export const GET = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-video-state', limit: 120, window: '1 h' } },
  async ({ req, profile }) => {
    const conversationId = new URL(req.url).searchParams.get('conversationId') ?? ''
    const t = conversationId ? await teacherThread(conversationId) : null
    if (!t || (t.teacherUserId !== profile.id && t.recruiterUserId !== profile.id)) throw new ApiError('not_found', 404)
    // ⛔ A thread closed by a block tells the SCHOOL nothing about the video — not a flag (gate review, 2026-10-08), as the
    // watch route and the thread payload. The TEACHER keeps theirs: a share made before the block must stay withdrawable.
    if (t.recruiterUserId === profile.id && (await isBlockedBetween(t.recruiterUserId, t.teacherUserId))) throw new ApiError('blocked', 403)
    const res = NextResponse.json({
      available: t.videoAvailable, shareOn: t.videoShareOn, shared: t.videoShared, requested: t.videoRequested,
      askAgain: t.videoAskAgain, forBusiness: t.videoForBusiness,
    })
    res.headers.set('Cache-Control', 'private, no-store')
    return res
  },
)
