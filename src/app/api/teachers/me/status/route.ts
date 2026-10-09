// Show or hide the signed-in teacher's public profile.
import { NextResponse } from 'next/server'
import { route, ApiError } from '@/lib/api/handler'
import { PublishBlockedError } from '@/lib/publish-guard'
import { setTeacherStatus, TeacherNoGoalError } from '@/lib/teachers/publish'

export const runtime = 'nodejs'

export const PATCH = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-status', limit: 60, window: '1 h', strict: true } },
  async ({ req, profile }) => {
    const body = (await req.json().catch(() => null)) as { status?: unknown } | null
    const status = body?.status === 'live' || body?.status === 'hidden' ? body.status : null
    if (!status) throw new ApiError('bad_request', 400)
    try {
      if (!(await setTeacherStatus(profile.id, status))) throw new ApiError('teacher_profile_missing', 404)
    } catch (e) {
      // Showing the profile again is a relist and passes the identity gate (setTeacherStatus).
      if (e instanceof PublishBlockedError) return NextResponse.json({ error: e.code }, { status: 403 })
      // ⛔ Nothing to be found for — no job goal, no public cover: what an edit save hides (D6) is never shown again by
      // the switch alone (gate review, 2026-10-09). A stable code the form words as "pick the work you want, or switch
      // cover lessons on, and save first"; 409 — the request is fine, the profile's state refuses it.
      if (e instanceof TeacherNoGoalError) return NextResponse.json({ error: 'no_teaching_goal' }, { status: 409 })
      throw e
    }
    return { ok: true, status }
  },
)
