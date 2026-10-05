import { db } from '@/lib/db'
import { counterpartyName, disputeStage, disputeTimeline, loadDisputeForParty, partyCanPost, partyHasSubmitted } from '@/lib/dispute'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const firstImg = (images: string | null): string | null => {
  try { const a = JSON.parse(images || '[]'); return Array.isArray(a) && a[0] ? a[0] : null } catch { return null }
}

// One dispute case, PARTY view — the case room payload. 404s identically for
// "not found" and "not your case" so case ids don't leak. Identity rules:
// the respondent never sees who reported them (role labels only); the reporter
// sees the respondent's public storefront/display name. Admin identity is never
// exposed — admin/system rows render as "eno.vn".
//
// ⚠️ WS6 MIGRATION — auth preamble only. `auth: 'userId'` mirrors the getCurrentProfileId() this
// replaced; loadDisputeForParty() takes the id and does the party check itself, so no Profile row is
// needed. Branches unchanged: guest → 401 `auth_required`; not-a-party AND not-found both → 404
// `not_found` (the deliberate ambiguity above), now thrown as ApiError rather than returned.
// `params` arrives already awaited from ctx.
//
// ⚠️ FAILURE-PATH WIRE CHANGE, DELIBERATE: no .catch() on any of the loads, so a DB error used to be
// Next's default 500 and is now `{"error":"internal_error"}` 500.
export const GET = route({ auth: 'userId' }, async ({ userId: meId, params }) => {
  const { id } = params

  const loaded = await loadDisputeForParty(id, meId)
  if (!loaded) throw new ApiError('not_found', 404)
  const { report, role } = loaded

  const listing = report.listingId
    ? await db.listing.findUnique({ where: { id: report.listingId }, select: { id: true, title: true, images: true, status: true, verified: true } })
    : null

  // One-shot: the composer closes once THIS party has posted their single room
  // statement (the reporter's initial complaint `detail` is NOT a DisputeMessage, so
  // it doesn't count — they still get one evidence submission with photos).
  const submitted = await partyHasSubmitted(report.id, meId)
  const timeline = await disputeTimeline(report)

  return {
    id: report.id,
    role,
    reason: report.reason,
    status: report.status,
    stage: disputeStage(report),
    canPost: partyCanPost(report) && !submitted,
    submitted,
    withdrawn: report.resolvedBy === 'withdrawn-by-reporter',
    // Re-opened by the respondent's appeal: the reporter can no longer withdraw it (the
    // withdraw route refuses) — the page hides the button rather than offer a dead one.
    underAppeal: report.status === 'open' && !!report.appealedAt,
    createdAt: report.createdAt.toISOString(),
    evidenceUntil: report.evidenceUntil?.toISOString() ?? null,
    resolvedAt: report.resolvedAt?.toISOString() ?? null,
    decisionNote: report.status === 'open' ? null : report.decisionNote,
    // Chat-origin cases: ONLY the reporter gets the conversation link. A chat is
    // strictly 1:1, so telling the RESPONDENT which conversation triggered the case
    // would identify their sole counterparty there as the reporter — breaking the
    // "respondent never learns the reporter" invariant. (The respondent can still
    // reach that thread from their own inbox; we just don't pin the dispute to it.)
    conversationId: role === 'reporter' ? report.conversationId : null,
    listing: listing ? { id: listing.id, title: listing.title, image: firstImg(listing.images) } : null,
    counterparty: role === 'reporter' ? await counterpartyName(report) : null,
    timeline,
    // A CONTENT case (App Store gate `ugc-safety`, R5 — a report on a review or a Help-centre reply/post)
    // has no respondent: its author is not a party. The page then says only the eno team sees what the
    // reporter adds, instead of promising "the other side" a reply (opus, gate round 2). Known by its
    // POINTER ROW, not by empty target columns (codex + opus, round 5), and not gated: a case filed while
    // the gate was on keeps its true copy if it goes off (round 4). Every other case's payload is
    // byte-for-byte as before.
    ...(timeline.some((item) => item.about) ? { contentCase: true } : {}),
  }
})
