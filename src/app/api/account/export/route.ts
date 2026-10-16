import { NextResponse } from 'next/server'
import { teacherExportOf } from '@/lib/teachers/export'
import { teacherDraftExportOf } from '@/lib/teachers/draft'
import { identityVerificationExportOf } from '@/lib/kyc/export'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { describeTrustEvent } from '@/lib/trust'

// Self-service data export (PDPL access right — "copies provided within 10 days";
// this does it instantly). Returns EVERYTHING we hold about the authenticated
// caller as a downloadable JSON, scoped strictly to their own id — no target
// param, so it can never be aimed at another user. Rate-limited so it can't be
// used as a heavy-query DoS lever.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ⚠️ WS6 — NOT MIGRATED. Three of its four branches would change shape:
//  · guest → `{"error":"Unauthorized"}` (capital U), not the wrapper's hardcoded `auth_required`;
//  · over limit → `{"error":"Too many requests — try again later"}`, a sentence rather than
//    `rate_limited`, and the export button renders `error` verbatim to the user;
//  · success → a `new NextResponse` carrying Content-Disposition + Cache-Control: no-store. That
//    one alone is survivable (route() passes a returned Response straight through), which is
//    exactly why it is worth writing down that it is NOT what blocks this route — the two error
//    strings are.
// Reproducing the sentences by hand under `auth: 'public'` would empty every wrapper option and
// leave pure indirection.
export async function GET() {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // strict: this runs 8 unbounded findMany queries per call, so the limiter must
  // fail CLOSED if Redis is down (matches the sibling /api/account/delete) — a
  // re-request once Redis recovers is acceptable, same rationale as deletion.
  const gate = await rateLimit('account-export', profile.id, 5, '1 h', { strict: true })
  if (!gate.success) return NextResponse.json({ error: 'Too many requests — try again later' }, { status: 429 })

  const seller = await db.seller.findUnique({ where: { ownerId: profile.id } })
  // Public @handles (user + shop) — part of "everything we hold".
  const handles = await db.handle.findMany({
    where: { OR: [{ profileId: profile.id }, ...(seller ? [{ sellerId: seller.id }] : [])] },
    select: { handle: true, profileId: true, createdAt: true },
  })

  const [listings, savedSearches, notifications, reviewsWritten, trustEvents, buyerConvos, sellerConvos, messages] = await Promise.all([
    seller ? db.listing.findMany({ where: { sellerId: seller.id } }) : Promise.resolve([]),
    db.savedSearch.findMany({ where: { profileId: profile.id } }),
    db.notification.findMany({ where: { recipientId: profile.id } }),
    db.review.findMany({ where: { authorProfileId: profile.id } }),
    db.trustEvent.findMany({ where: { subjectProfileId: profile.id } }),
    db.conversation.findMany({ where: { buyerProfileId: profile.id }, select: { id: true, listingId: true, createdAt: true } }),
    db.conversation.findMany({ where: { sellerProfileId: profile.id }, select: { id: true, listingId: true, createdAt: true } }),
    db.message.findMany({ where: { senderProfileId: profile.id }, select: { id: true, conversationId: true, body: true, createdAt: true } }),
  ])

  // /schools (2026-10-05, diff review: the access right covers it): the teacher's own votes, reviews (with the pay they
  // reported), the timestamped log of their vote changes, helpful votes, reports filed and proofs of employment —
  // never another account's, and never a ledger hash (pseudonymous; it says nothing the proofs listed do not).
  const school = { select: { slug: true, name: true } } as const
  const [schoolVotes, schoolVoteLog, schoolReviews, schoolHelpfulVotes, schoolProofs, schoolReports, schoolSuggestions] = await Promise.all([
    db.schoolVote.findMany({ where: { profileId: profile.id }, select: { value: true, createdAt: true, updatedAt: true, school } }),
    db.schoolVoteEvent.findMany({ where: { profileId: profile.id }, orderBy: { at: 'asc' }, select: { value: true, at: true, school } }),
    db.schoolReview.findMany({
      where: { profileId: profile.id },
      select: {
        current: true, tenure: true, leftYear: true, showLeftYear: true, role: true, employment: true, district: true, pros: true, cons: true, advice: true,
        goodTags: true, badTags: true, payAmount: true, payCurrency: true, payPeriod: true, status: true, rejectReason: true, submittedAt: true, school,
      },
    }),
    db.schoolReviewVote.findMany({ where: { profileId: profile.id }, select: { reviewId: true, value: true, createdAt: true } }),
    db.schoolEmployment.findMany({ where: { profileId: profile.id }, select: { method: true, status: true, linkedinUrl: true, rejectReason: true, decidedAt: true, createdAt: true, school } }),
    db.schoolReport.findMany({ where: { reporterProfileId: profile.id }, select: { kind: true, reason: true, detail: true, contactEmail: true, status: true, createdAt: true, school } }),
    // The school a suggestion became or matched only while it is PUBLIC (diff review: a duplicate of a hidden school
    // must not name it — the suggest route's own rule).
    db.schoolSuggestion.findMany({ where: { profileId: profile.id }, select: { name: true, kind: true, website: true, districts: true, note: true, status: true, rejectReason: true, createdAt: true, school: { select: { slug: true, name: true, status: true } } } })
      .then((rows) => rows.map(({ school: s, ...r }) => ({ ...r, school: s?.status === 'active' ? { slug: s.slug, name: s.name } : null }))),
  ])

  // Teacher profile (2026-09-30), cover lessons and the private intro video (2026-10-07) — src/lib/teachers/export.ts.
  const teacher = await teacherExportOf(profile.id)
  // An unfinished teacher profile (2026-10-11) — src/lib/teachers/draft.ts. Its own key: the profile export above is empty
  // when no profile was published.
  const teacherDraft = await teacherDraftExportOf(profile.id)

  // Sign-in methods (2026-10-15): the providers this account signs in with and what each SHARED with us — for Sign in
  // with LinkedIn, the name, email, photo link, language and member id GoTrue keeps (LinkedIn API Terms 5.1/5.2; PDPL
  // access right). Never a token: identity_data holds none, and anything named like one is dropped anyway. Null when the
  // auth schema cannot be read here (a role without the grant) — said, not hidden.
  const signInMethods = await db.$queryRaw<Array<{ provider: string; created_at: Date | null; last_sign_in_at: Date | null; identity_data: Record<string, unknown> | null }>>`
      SELECT provider, created_at, last_sign_in_at, identity_data FROM auth.identities WHERE user_id = ${profile.id}::uuid ORDER BY created_at`
    .then((rows) => rows.map((r) => ({
      provider: r.provider,
      linkedAt: r.created_at,
      lastSignInAt: r.last_sign_in_at,
      shared: Object.fromEntries(Object.entries(r.identity_data ?? {}).filter(([k]) => !/token|secret/i.test(k))),
    })))
    .catch(() => null)
  // Consent records this account acted under (2026-10-15): reading a CV with the AI, and Sign in with LinkedIn — the
  // notice version and its hash, never a value from the CV (src/app/api/teachers/me/import). A LinkedIn consent is
  // written before the account is known and linked to it after the sign-in; both rows are listed.
  const consentRecords = await (async () => {
    const own = await db.complianceAudit.findMany({
      where: { actorId: profile.id, action: { in: ['teacher.import.consent', 'teacher.import.result', 'auth.linkedin.consent.linked'] } },
      orderBy: { occurredAt: 'asc' },
      select: { action: true, occurredAt: true, subjectId: true, detail: true },
    })
    const linkedIds = own.filter((r) => r.action === 'auth.linkedin.consent.linked').map((r) => r.subjectId)
    const linkedin = linkedIds.length
      ? await db.complianceAudit.findMany({ where: { action: 'auth.linkedin.consent', subjectId: { in: linkedIds } }, orderBy: { occurredAt: 'asc' }, select: { action: true, occurredAt: true, subjectId: true, detail: true } })
      : []
    return [...linkedin, ...own].map((r) => ({ action: r.action, at: r.occurredAt, detail: r.detail }))
  })().catch(() => null)

  // Identity checks (2026-10-16) — src/lib/kyc/export.ts: the facts of each check and the declaration affirmed before
  // uploading, with its exact words (since identity-v2 also the consent for a teacher's "Identity verified"). Never the
  // document: the module selects the safe columns one by one. Null when it cannot be read — said, not hidden, and never
  // the whole export lost to one section (commit gate, opus round 2), as with the consent records above.
  const identityVerifications = await identityVerificationExportOf(profile.id).catch(() => null)

  // The Profile row minus purely-internal fields the user didn't provide and that
  // aren't "their" personal data (denormalized trust internals stay out).
  const { trustScore, trustTier, positiveInteractions, falseReportStrikes, enforcementState, ...profilePublicish } = profile

  const payload = {
    exportedAt: new Date().toISOString(),
    note: 'Your eno.vn personal data. Trust/enforcement internals are summarized, not itemized.',
    account: profilePublicish,
    handles: handles.map((h) => ({ handle: h.handle, kind: h.profileId ? 'user' : 'shop', createdAt: h.createdAt })),
    trustSummary: { score: trustScore, tier: trustTier, positiveInteractions },
    storefront: seller ?? null,
    listings,
    savedSearches,
    notifications,
    reviewsWritten,
    // Summarized per the note above: a description, points and date only — internal reason
    // metadata (admin notes, report ids) stays out of the export.
    // ⚠️ `event` REPLACES the raw `type`, deliberately. `type` is an internal catch-all: the
    // automated offer-spam penalty, the automatic new_account / phone_verified / kyc grants and
    // real admin action ALL wrote `manual_adjust`, so exporting it told users a machine penalty
    // was a "manual adjustment" — that a person had judged them. This is a PDPL access-right
    // disclosure and /legal/ranking invites users to dispute their score with support, so it is
    // the one place that distinction reaches a human. describeTrustEvent() reads the `reason` the
    // ledger already stores and says what actually happened; see the note on it in src/lib/trust.ts.
    trustEvents: trustEvents.map((e) => ({ event: describeTrustEvent(e.type, e.reason), points: e.delta, createdAt: e.createdAt })),
    conversations: { asBuyer: buyerConvos, asSeller: sellerConvos },
    messagesSent: messages,
    teacherProfile: teacher,
    teacherProfileDraft: teacherDraft,
    signInMethods,
    consentRecords,
    identityVerifications,
    schools: { votes: schoolVotes, voteLog: schoolVoteLog, reviews: schoolReviews, helpfulVotes: schoolHelpfulVotes, proofsOfEmployment: schoolProofs, reportsFiled: schoolReports, suggestions: schoolSuggestions },
  }

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="eno-data-export-${profile.id}.json"`,
      'Cache-Control': 'no-store',
    },
  })
}
