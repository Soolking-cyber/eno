import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'
import { counterpartyName, disputeStage, disputeTimeline, loadDisputeForParty, partyCanPost, partyHasSubmitted } from '@/lib/dispute'

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
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  const { id } = await params

  const loaded = await loadDisputeForParty(id, meId)
  if (!loaded) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const { report, role } = loaded

  const listing = report.listingId
    ? await db.listing.findUnique({ where: { id: report.listingId }, select: { id: true, title: true, images: true, status: true, verified: true } })
    : null

  // One-shot: the composer closes once THIS party has posted their single room
  // statement (the reporter's initial complaint `detail` is NOT a DisputeMessage, so
  // it doesn't count — they still get one evidence submission with photos).
  const submitted = await partyHasSubmitted(report.id, meId)

  return NextResponse.json({
    id: report.id,
    role,
    reason: report.reason,
    status: report.status,
    stage: disputeStage(report),
    canPost: partyCanPost(report) && !submitted,
    submitted,
    withdrawn: report.resolvedBy === 'withdrawn-by-reporter',
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
    timeline: await disputeTimeline(report),
  })
}
