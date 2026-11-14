// A recruiter reads the teacher's phone + email — only while the teacher's share is active (2026-09-30), and the phone
// only when that share included it (TeacherContactShare.phoneShared, gate review 2026-10-09).
import { route, ApiError } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { teacherThread } from '@/lib/teachers/share'
import { conversationGate } from '@/lib/enforcement'
import { isBlockedBetween } from '@/lib/user-blocks'
import { isReviewSeatEmail } from '@/lib/review-seat-accounts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-contact', limit: 60, window: '1 h', strict: true } },
  async ({ req, profile }) => {
    const conversationId = new URL(req.url).searchParams.get('conversationId') ?? ''
    const t = conversationId ? await teacherThread(conversationId) : null
    if (!t || t.recruiterUserId !== profile.id) throw new ApiError('not_found', 404)
    // ⛔ A STORE-REVIEW SEAT NEVER READS A TEACHER'S PHONE OR EMAIL (round 5, 2026-11-14 — codex, round 4; src/lib/review-seat-accounts.ts):
    // a share made before the seat rules still stands, and it is an outside reviewer's shared login, not a school. Refused
    // before anything private is read or the reveal ledger written — personal or business alike, by the Profile row's address (the one ensureProfile
    // pins on a seat), never the session's. Never the lawyer (isReviewSeatEmail).
    if (isReviewSeatEmail(profile.email)) throw new ApiError('forbidden', 403)
    // A recruiter suspended after the teacher shared reads nothing more.
    if ((await conversationGate(profile.id))?.error === 'account_suspended') throw new ApiError('account_suspended', 403)
    if (!t.shared) throw new ApiError('share_required', 403)
    // App Store gate `ugc-safety`: a block also closes a share made BEFORE it — the teacher who blocks a
    // recruiter must not keep handing them a phone, email or CV (share/route.ts only stops NEW shares).
    // Either direction, like every block. Off ⇒ no query.
    if (await isBlockedBetween(t.recruiterUserId, t.teacherUserId)) throw new ApiError('blocked', 403)
    const priv = await db.teacherPrivate.findUnique({ where: { teacherProfileId: t.teacherProfileId }, select: { phone: true, email: true, cvPath: true } })
    // A lead signal, deduped per (listing, viewer) — the same ledger the listing contact route keeps.
    // Written once per (listing, viewer), never per read — this route is hit on every share signal.
    await db.contactReveal.createMany({ data: [{ listingId: t.convo.listingId!, viewerId: profile.id }], skipDuplicates: true })
    // ⛔ THE PHONE ONLY IF THE SHARE'S TAP INCLUDED IT (gate review, 2026-10-09). `priv` is the CURRENT private
    // row, so without this a teacher who shared "email & CV" (no phone on file — optional since A3) and added a
    // phone later, to switch staff calls on, silently handed it to every school shared with before. A share hands
    // over what its tap named.
    return { phone: t.phoneShared ? priv?.phone ?? null : null, email: priv?.email ?? null, hasCv: !!priv?.cvPath }
  },
)
