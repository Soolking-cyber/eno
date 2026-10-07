import { NextResponse } from 'next/server'
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

  // Teacher profile (2026-09-30) + cover lessons (2026-10-07) — the access right covers what the teacher entered and
  // what eno recorded about it (cover consent and withdrawal timestamps), and their own private contact row. The CV
  // is named, not its storage path (a bucket key is not their data). Matches are the local matcher's output: kept out.
  const teacher = await db.teacherProfile.findUnique({ where: { profileId: profile.id }, include: { private: { select: { phone: true, email: true, cvFileName: true, updatedAt: true } } } })

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
    teacherProfile: teacher ?? null,
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
