// The signed-in teacher's own profile (2026-09-30): read, create/update, delete.
// The public side is the listing (/listings/<id>); contact data is never in any public payload.
import { NextResponse } from 'next/server'
import { route, ApiError } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { PublishBlockedError } from '@/lib/publish-guard'
import { saveTeacherProfile, deleteTeacherProfile, TeacherCoverConflictError, TeacherValidationError } from '@/lib/teachers/publish'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route({ auth: 'profile' }, async ({ profile }) => {
  const tp = await db.teacherProfile.findUnique({
    where: { profileId: profile.id },
    include: { private: { select: { phone: true, cvFileName: true } }, listing: { select: { status: true, verified: true } } },
  })
  if (!tp) return { teacher: null }
  const { private: priv, listing, ...rest } = tp
  // What schools actually see — a moderation pull keeps the listing down whatever `status` says.
  const listingLive = !!listing && listing.status === 'active' && listing.verified
  // The owner's own phone + whether a CV exists — never the CV path (it is not a URL anyone needs).
  return { teacher: { ...rest, listingLive, phone: priv?.phone ?? '', cvFileName: priv?.cvFileName ?? null } }
})

export const PUT = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-profile', limit: 30, window: '1 h', strict: true } },
  async ({ req, profile }) => {
    let body: unknown
    try { body = await req.json() } catch { throw new ApiError('bad_request', 400) }
    try {
      return await saveTeacherProfile({ id: profile.id, email: profile.email ?? null }, body)
    } catch (e) {
      if (e instanceof TeacherValidationError) {
        return NextResponse.json({ error: 'invalid_teacher_profile', fields: e.errors }, { status: 400 })
      }
      // The cover state changed in another window since this form loaded it (publish.ts TeacherCoverConflictError).
      if (e instanceof TeacherCoverConflictError) return NextResponse.json({ error: 'cover_changed' }, { status: 409 })
      if (e instanceof PublishBlockedError) {
        return NextResponse.json({ error: e.code, detail: e.detail ?? null }, { status: e.code.startsWith('identity_') ? 403 : 422 })
      }
      throw e
    }
  },
)

export const DELETE = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-profile-delete', limit: 10, window: '1 h', strict: true } },
  async ({ profile }) => {
    if (!(await deleteTeacherProfile(profile.id))) throw new ApiError('teacher_profile_missing', 404)
    return { ok: true }
  },
)
