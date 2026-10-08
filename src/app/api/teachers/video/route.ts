// A school watches the intro video a teacher SENT it in this conversation (2026-10-07) — a 10-minute inline link from the
// private `teacher-videos` bucket, minted per request behind the same gate as the CV.
import { NextResponse } from 'next/server'
import { route, ApiError } from '@/lib/api/handler'
import { teacherThread } from '@/lib/teachers/share'
import { conversationGate } from '@/lib/enforcement'
import { isBlockedBetween } from '@/lib/user-blocks'
import { signTeacherVideo } from '@/lib/teachers/video-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route(
  // 60/h: one per view, and a re-mint on a playback error (bounded in the strip); seeks inside 10 minutes need none.
  { auth: 'profile', rateLimit: { bucket: 'teacher-video', limit: 60, window: '1 h', strict: true } },
  async ({ req, profile }) => {
    const conversationId = new URL(req.url).searchParams.get('conversationId') ?? ''
    const t = conversationId ? await teacherThread(conversationId) : null
    if (!t || t.recruiterUserId !== profile.id) throw new ApiError('not_found', 404)
    // teacherThread refuses no account type (it only folds the buyer's into the video flags) — every read route checks, here too.
    if (profile.accountType !== 'business') throw new ApiError('business_only', 403)
    if ((await conversationGate(profile.id))?.error === 'account_suspended') throw new ApiError('account_suspended', 403)
    // A block closes a grant made BEFORE it too, in either direction (the CV route's rule). ⛔ BEFORE every state check:
    // a school the teacher blocked must learn nothing more about the profile — answered after them, `profile_hidden`
    // vs `video_not_on_request` told it whether the teacher had hidden their profile (gate review, 2026-10-08).
    if (await isBlockedBetween(t.recruiterUserId, t.teacherUserId)) throw new ApiError('blocked', 403)
    // Not watchable at all first — a hidden or pulled profile, a video now public or removed — each with its own reason;
    // `share_required` only when the teacher's grant is what is missing (integration review, 2026-10-08).
    if (!t.videoAvailable) throw new ApiError(t.profileLive ? 'video_not_on_request' : 'profile_hidden', 409)
    if (!t.videoShared) throw new ApiError('share_required', 403)
    // The path judged WITH the grant above, from the same read (teacherThread privateVideoPath) — never a second lookup.
    // ⚠️ Accepted residual, the same class as the link's own 10 minutes: a stop committing between that read and the
    // signing below still gets this one link out; every request after the stop is refused.
    if (!t.privateVideoPath) throw new ApiError('video_missing', 404)
    const url = await signTeacherVideo(t.privateVideoPath)
    if (!url) throw new ApiError('video_store_failed', 502)
    // JSON for web and the native shell alike (it plays inline, in the strip). Never cached anywhere on the way.
    const res = NextResponse.json({ url, expiresIn: 600 })
    res.headers.set('Cache-Control', 'private, no-store')
    return res
  },
)
