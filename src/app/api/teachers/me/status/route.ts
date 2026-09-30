// Show or hide the signed-in teacher's public profile.
import { NextResponse } from 'next/server'
import { route, ApiError } from '@/lib/api/handler'
import { PublishBlockedError } from '@/lib/publish-guard'
import { setTeacherStatus } from '@/lib/teachers/publish'

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
      throw e
    }
    return { ok: true, status }
  },
)
