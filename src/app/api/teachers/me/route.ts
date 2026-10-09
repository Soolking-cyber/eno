// The signed-in teacher's own profile (2026-09-30): read, create/update, delete.
// The public side is the listing (/listings/<id>); contact data is never in any public payload.
import { NextResponse } from 'next/server'
import { route, ApiError } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { PublishBlockedError } from '@/lib/publish-guard'
import { isListingImageUrl } from '@/lib/listing-image'
import { sellerPublishDecision } from '@/lib/compliance/seller-publish-gate'
import { logError } from '@/lib/log'
import { isLegacyTeacherBody } from '@/lib/teachers/profile'
import {
  saveTeacherProfile, deleteTeacherProfile, TeacherCoverConflictError, TeacherNoticeChangedError, TeacherProfileChangedError,
  TeacherValidationError, TeacherVideoConflictError, TeacherVideoStoreError,
} from '@/lib/teachers/publish'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET — the caller's own profile, or (none yet) what the new form may START from (teacher onboarding redesign,
 * 2026-10-08):
 *   · `publishGate` — whether this account may publish right now (the identity gate, sellerPublishDecision) and the
 *     refusal code, so the Photo & publish step shows an identity check at its top instead of a refusal at the last tap.
 *     ⚠️ ADVISORY, so it never takes the page down (gate review, 2026-10-09): a failed check answers `publishGate: null`
 *     (not known — the form shows no notice) and is logged. The save re-runs the gate itself (assertSellerMayPublish),
 *     so nothing is published on the strength of this answer, while a failure here used to fail the whole edit page;
 *   · `prefill` (no profile only) — the account's display name, its photo only when it is stored on eno.vn (a listing
 *     photo must be), and its phone (Profile.phone is only ever an auth-VERIFIED number). The form offers them; it never
 *     saves them unasked.
 * ⛔ No runtime adapter (plan review D1): a row the backfill has not migrated comes back as stored (`situationVersion`
 * null, an empty teach-area list) and the edit form asks for what is missing.
 */
export const GET = route({ auth: 'profile' }, async ({ profile }) => {
  const [tp, decision] = await Promise.all([
    db.teacherProfile.findUnique({
      where: { profileId: profile.id },
      include: { private: { select: { phone: true, cvFileName: true, videoPath: true } }, listing: { select: { status: true, verified: true } } },
    }),
    sellerPublishDecision({ ownerId: profile.id }).catch((e: unknown) => {
      logError(e, { op: 'teachers.me.publishGate' })
      return null
    }),
  ])
  const publishGate = !decision ? null : decision.ok ? { ok: true as const, code: null } : { ok: false as const, code: decision.code }
  if (!tp) {
    return {
      teacher: null,
      publishGate,
      prefill: {
        displayName: profile.displayName ?? null,
        avatarUrl: profile.avatarUrl && isListingImageUrl(profile.avatarUrl) ? profile.avatarUrl : null,
        phone: profile.phone ?? null,
      },
    }
  }
  const { private: priv, listing, ...rest } = tp
  // What schools actually see — a moderation pull keeps the listing down whatever `status` says.
  const listingLive = !!listing && listing.status === 'active' && listing.verified
  // The owner's own phone + whether a CV or a private intro video exists — never either path (neither is a URL anyone
  // needs; the private video is watched only through a school's signed link). videoVersion is the form's video base.
  return { teacher: { ...rest, listingLive, phone: priv?.phone ?? '', cvFileName: priv?.cvFileName ?? null, hasPrivateVideo: !!priv?.videoPath }, publishGate }
})

export const PUT = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-profile', limit: 30, window: '1 h', strict: true } },
  async ({ req, profile }) => {
    let body: unknown
    try { body = await req.json() } catch { throw new ApiError('bad_request', 400) }
    // ⛔ ONE SHAPE (plan review D2, 2026-10-08): a body with no teach-area list comes from a tab opened before the
    // onboarding redesign. The server never guesses what an old body meant — 409 profile_changed ("reload"), and the
    // reload brings the new form (which maps that tab's sessionStorage draft at its own input boundary). Checked before
    // anything is read, so the old tab writes nothing.
    if (isLegacyTeacherBody(body)) return NextResponse.json({ error: 'profile_changed' }, { status: 409 })
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
      // The page showed an older Publish, cover or AI notice than the one in force ("This page was updated — reload").
      if (e instanceof TeacherNoticeChangedError) return NextResponse.json({ error: 'notice_changed', notice: e.notice }, { status: 409 })
      // The cover state changed in another window since this form loaded it (publish.ts TeacherCoverConflictError).
      if (e instanceof TeacherCoverConflictError) return NextResponse.json({ error: 'cover_changed' }, { status: 409 })
      // The intro video changed in another window since this form loaded it, or a draft/old client tried to change it
      // without the version it loaded (src/lib/teachers/video.ts).
      if (e instanceof TeacherVideoConflictError) return NextResponse.json({ error: 'video_changed' }, { status: 409 })
      // A bucket move failed before anything was written (the copy's tombstone collects any half-made copy).
      if (e instanceof TeacherVideoStoreError) return NextResponse.json({ error: 'video_store_failed' }, { status: 502 })
      // `detail` is the KEY of the refused field ('bio', 'experience.2') — never the word (publish.ts screenTeacherTexts).
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
