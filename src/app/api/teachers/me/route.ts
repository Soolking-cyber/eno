// The signed-in teacher's own profile (2026-09-30): read, create/update, delete.
// The public side is the listing (/listings/<id>); contact data is never in any public payload.
import { NextResponse } from 'next/server'
import { route, ApiError } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { PublishBlockedError } from '@/lib/publish-guard'
import {
  saveTeacherProfile, deleteTeacherProfile, TeacherCoverConflictError, TeacherProfileChangedError, TeacherValidationError, TeacherVideoConflictError,
  TeacherVideoStoreError,
} from '@/lib/teachers/publish'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route({ auth: 'profile' }, async ({ profile }) => {
  const tp = await db.teacherProfile.findUnique({
    where: { profileId: profile.id },
    include: { private: { select: { phone: true, cvFileName: true, videoPath: true } }, listing: { select: { status: true, verified: true } } },
  })
  if (!tp) return { teacher: null }
  const { private: priv, listing, ...rest } = tp
  // What schools actually see — a moderation pull keeps the listing down whatever `status` says.
  const listingLive = !!listing && listing.status === 'active' && listing.verified
  // The owner's own phone + whether a CV or a private intro video exists — never either path (neither is a URL anyone
  // needs; the private video is watched only through a school's signed link). videoVersion is the form's video base.
  return { teacher: { ...rest, listingLive, phone: priv?.phone ?? '', cvFileName: priv?.cvFileName ?? null, hasPrivateVideo: !!priv?.videoPath } }
})

export const PUT = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-profile', limit: 30, window: '1 h', strict: true } },
  async ({ req, profile }) => {
    let body: unknown
    try { body = await req.json() } catch { throw new ApiError('bad_request', 400) }
    // ⛔ A SAVE NAMES THE PROFILE IT EDITS, OR CLAIMS THERE IS NONE — NEVER NEITHER (gate review, 2026-10-08). The edit
    // form sends the TeacherProfile id it loaded; a body without one — the join form's `null`, or an edit tab from before
    // the field — may only CREATE, and is refused once the account has a profile. A form opened as one account and still
    // open when the session became another (a sign-in in another tab) must never write that account's profile: its cover
    // and video bases could coincide (gate review, 2026-10-07), and an absent id used to fail OPEN — a pre-deploy edit tab
    // of account A overwrote B's profile. An old tab now gets 409 and a reload fixes it; the join form already sends a
    // teacher who has a profile to Edit.
    // This read is the FAST PATH (it refuses before any bucket copy); the guarantee is the same check under the account
    // lock, in the transaction that writes (publish.ts TeacherProfileChangedError).
    // ⚠️ The form's older calls (hide/show, CV, delete, the cover panel) act on the signed-in account: a tab of this release
    // remounts its form per account, so it shows that account; only a tab opened before it could reach another account,
    // until reloaded — an accepted residual, the same rule is their follow-up.
    const sentId = (body as { teacherProfileId?: unknown } | null)?.teacherProfileId
    const expected = typeof sentId === 'string' ? sentId : null
    const mine = await db.teacherProfile.findUnique({ where: { profileId: profile.id }, select: { id: true } })
    if ((mine?.id ?? null) !== expected) return NextResponse.json({ error: 'profile_changed' }, { status: 409 })
    try {
      return await saveTeacherProfile({ id: profile.id, email: profile.email ?? null }, body, { expectTeacherProfileId: expected })
    } catch (e) {
      if (e instanceof TeacherValidationError) {
        return NextResponse.json({ error: 'invalid_teacher_profile', fields: e.errors }, { status: 400 })
      }
      // The profile changed between the fast path above and the save's lock (deleted, made, or re-made in another window).
      if (e instanceof TeacherProfileChangedError) return NextResponse.json({ error: 'profile_changed' }, { status: 409 })
      // The cover state changed in another window since this form loaded it (publish.ts TeacherCoverConflictError).
      if (e instanceof TeacherCoverConflictError) return NextResponse.json({ error: 'cover_changed' }, { status: 409 })
      // The intro video changed in another window since this form loaded it, or a draft/old client tried to change it
      // without the version it loaded (src/lib/teachers/video.ts).
      if (e instanceof TeacherVideoConflictError) return NextResponse.json({ error: 'video_changed' }, { status: 409 })
      // A bucket move failed before anything was written (the copy's tombstone collects any half-made copy).
      if (e instanceof TeacherVideoStoreError) return NextResponse.json({ error: 'video_store_failed' }, { status: 502 })
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
