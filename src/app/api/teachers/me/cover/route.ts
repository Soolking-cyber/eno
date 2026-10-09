// The signed-in teacher's cover-lesson availability (2026-10-07) — the edit page's quick panel and its
// "Still available" tap, so a weekly update never means walking the whole profile again.
// Body: { coverOpen, coverSlots, coverRateVnd, coverConsent } — ALL FOUR, always (a body with only some is refused, 400)
// — plus `coverBase`, the cover state the form loaded (409 cover_changed when it is stale), and `coverNotice`, the cover
// notice the page showed (the switch counts as consent only under the one in force — 409 notice_changed otherwise).
// Since the onboarding redesign (2026-10-08) the areas are DERIVED from the teacher's teach areas (places.ts
// coverReachOf) and never sent; the server-written cover columns are never read from the body (publish.ts coverWrites).
import { NextResponse } from 'next/server'
import { route, ApiError } from '@/lib/api/handler'
import { PublishBlockedError } from '@/lib/publish-guard'
import {
  isLegacyCoverBody, saveTeacherCover, TeacherCoverConflictError, TeacherNoticeChangedError, TeacherValidationError,
} from '@/lib/teachers/publish'

export const runtime = 'nodejs'

export const PATCH = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-cover', limit: 60, window: '1 h', strict: true } },
  async ({ req, profile }) => {
    let body: unknown
    try { body = await req.json() } catch { throw new ApiError('bad_request', 400) }
    // ⛔ ONE SHAPE (plan review D2, 2026-10-08): a body that still sends picked areas is a panel opened before the
    // redesign. Its switch-ON is refused — 409 profile_changed, "reload" — rather than re-read with a reach the teacher
    // never saw; its switch-OFF still saves below, because a withdrawal is never blocked (plan review D6).
    if (isLegacyCoverBody(body) && (body as { coverOpen?: unknown }).coverOpen === true) {
      return NextResponse.json({ error: 'profile_changed' }, { status: 409 })
    }
    try {
      const saved = await saveTeacherCover(profile.id, body)
      if (!saved) throw new ApiError('teacher_profile_missing', 404)
      // `hidden`: cover went off and the teacher has no job goal either — the profile was hidden, and the panel says so.
      // `live`: what schools see now — a save never re-shows a hidden profile, so cover re-confirmed over one that is
      // hidden answers `live: false`, and the panel points at the Visibility switch (publish.ts saveTeacherCover).
      return { ok: true, ...saved }
    } catch (e) {
      if (e instanceof TeacherValidationError) {
        return NextResponse.json({ error: 'invalid_teacher_profile', fields: e.errors }, { status: 400 })
      }
      if (e instanceof TeacherCoverConflictError) return NextResponse.json({ error: 'cover_changed' }, { status: 409 })
      if (e instanceof TeacherNoticeChangedError) return NextResponse.json({ error: 'notice_changed', notice: e.notice }, { status: 409 })
      // The identity/trust gates (switching cover on publishes), worded like the profile save's.
      if (e instanceof PublishBlockedError) {
        return NextResponse.json({ error: e.code, detail: e.detail ?? null }, { status: e.code.startsWith('identity_') ? 403 : 422 })
      }
      throw e
    }
  },
)
