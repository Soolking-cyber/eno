// The signed-in teacher's OWN private intro video (2026-10-07).
//   · GET    — watch it: the same 10-minute signed link a school gets. Their data, their access (the PDPL access right; the
//              account export can only say that one exists), and how the form lets them check what they keep private.
//   · DELETE — remove it. A save body never removes one — the form never holds its URL — so this is its own call, under the
//              same lock and version check as a save (publish.ts).
import { NextResponse } from 'next/server'
import { route, ApiError } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { deleteTeacherVideo, TeacherVideoConflictError } from '@/lib/teachers/publish'
import { signTeacherVideo } from '@/lib/teachers/video-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-video-own', limit: 60, window: '1 h', strict: true } },
  async ({ profile }) => {
    const tp = await db.teacherProfile.findUnique({ where: { profileId: profile.id }, select: { private: { select: { videoPath: true } } } })
    const path = tp?.private?.videoPath
    if (!path) throw new ApiError('video_missing', 404)
    const url = await signTeacherVideo(path)
    if (!url) throw new ApiError('video_store_failed', 502)
    const res = NextResponse.json({ url, expiresIn: 600 })
    res.headers.set('Cache-Control', 'private, no-store')
    return res
  },
)

export const DELETE = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-video-remove', limit: 20, window: '1 h', strict: true } },
  async ({ req, profile }) => {
    // `base` = the videoVersion this form loaded: a stale window never deletes a video saved after it.
    const params = new URL(req.url).searchParams
    const raw = params.get('base')
    const base = raw !== null && /^\d+$/.test(raw) ? Number(raw) : null
    // ⛔ `tp` = the TeacherProfile that form loaded. A form loaded as one account, still open when the session became another
    // (a sign-in in another tab), must never remove THAT account's video — versions start low and could match (gate
    // review, 2026-10-07). Required: this route is new, and every caller sends it.
    // This read is the FAST PATH; the guarantee is deleteTeacherVideo's own check under the account lock, in the
    // transaction that removes (gate review, 2026-10-08).
    const expected = params.get('tp')
    if (!expected) throw new ApiError('bad_request', 400)
    const mine = await db.teacherProfile.findUnique({ where: { profileId: profile.id }, select: { id: true } })
    if (mine?.id !== expected) return NextResponse.json({ error: 'video_changed' }, { status: 409 })
    try {
      const video = await deleteTeacherVideo(profile.id, base, expected)
      if (!video) throw new ApiError('video_missing', 404)
      return { ok: true, video }
    } catch (e) {
      if (e instanceof TeacherVideoConflictError) return NextResponse.json({ error: 'video_changed' }, { status: 409 })
      throw e
    }
  },
)
