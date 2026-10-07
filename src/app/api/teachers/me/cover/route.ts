// The signed-in teacher's cover-lesson availability (2026-10-07) — the edit page's quick panel and its
// "Still available" tap, so a weekly update never means walking the whole five-step profile again.
// Body: { coverOpen, coverSlots, coverAreas, coverRateVnd, coverConsent } — ALL FIVE, always (a body with only some
// is refused, 400) — plus `coverBase`, the cover state the form loaded (409 cover_changed when it is stale), and
// `coverNotice`, the cover notice the page showed (the tick counts only under the one in force). The server-written
// cover columns are never read from it (publish.ts coverWrites).
import { NextResponse } from 'next/server'
import { route, ApiError } from '@/lib/api/handler'
import { PublishBlockedError } from '@/lib/publish-guard'
import { saveTeacherCover, TeacherCoverConflictError, TeacherValidationError } from '@/lib/teachers/publish'

export const runtime = 'nodejs'

export const PATCH = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-cover', limit: 60, window: '1 h', strict: true } },
  async ({ req, profile }) => {
    let body: unknown
    try { body = await req.json() } catch { throw new ApiError('bad_request', 400) }
    try {
      const saved = await saveTeacherCover(profile.id, body)
      if (!saved) throw new ApiError('teacher_profile_missing', 404)
      return { ok: true, ...saved }
    } catch (e) {
      if (e instanceof TeacherValidationError) {
        return NextResponse.json({ error: 'invalid_teacher_profile', fields: e.errors }, { status: 400 })
      }
      if (e instanceof TeacherCoverConflictError) return NextResponse.json({ error: 'cover_changed' }, { status: 409 })
      // The identity/trust gates (switching cover on publishes), worded like the profile save's.
      if (e instanceof PublishBlockedError) {
        return NextResponse.json({ error: e.code, detail: e.detail ?? null }, { status: e.code.startsWith('identity_') ? 403 : 422 })
      }
      throw e
    }
  },
)
