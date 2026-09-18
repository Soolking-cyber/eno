import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from '@/components/ui/icons'
import { STROKE_NAV } from '@/lib/icon-tokens'
import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { AdminDenied } from '@/components/admin/admin-denied'
import { reportContext, targetContext, type RawReport } from '@/lib/admin-reports'
import { disputeStage, disputeTimeline } from '@/lib/dispute'
import { DisputeRoomAdmin, type AdminCase } from '@/components/admin/dispute-room-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Dispute case — eno.vn admin', robots: { index: false, follow: false } }

// One dispute case, ADMIN view: full identities + trust context on both parties,
// the shared thread (evidence signed server-side), mediation composer, AI analysis
// and the decision bar (wired to the same /api/admin/moderate actions as the queue).
export default async function AdminDisputeRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />
  const { id } = await params

  const report = await db.report.findUnique({
    where: { id },
    select: {
      id: true, reason: true, detail: true, severity: true, status: true,
      reporterProfileId: true, targetProfileId: true, targetSellerId: true,
      listingId: true, conversationId: true,
      evidenceUntil: true, lastMessageAt: true, decisionNote: true, internalNote: true,
      sellerResponse: true, sellerRespondedAt: true,
      appealNote: true, appealImages: true, appealedAt: true,
      aiAnalysis: true, aiAnalyzedAt: true,
      resolvedBy: true, resolvedAt: true, createdAt: true,
    },
  })
  if (!report) notFound()

  const raw: RawReport[] = [{
    id: report.id, reporterProfileId: report.reporterProfileId, listingId: report.listingId,
    conversationId: report.conversationId, targetSellerId: report.targetSellerId, targetProfileId: report.targetProfileId,
  }]
  const [{ reporterById, convoByReportId }, { targetByReportId }, timeline] = await Promise.all([
    reportContext(raw),
    targetContext(raw),
    // Admin renders once at SSR (no polling) — sign evidence for 6h so images don't
    // 404 mid-review during a long deliberation. The party page re-signs every poll.
    disputeTimeline(report, { signTtl: 6 * 3600 }),
  ])
  const reporter = report.reporterProfileId ? reporterById.get(report.reporterProfileId) ?? null : null
  const target = targetByReportId.get(report.id) ?? null

  // Pattern signal: how many other CONFIRMED cases exist against the same identity.
  const targetOr = [
    report.targetProfileId ? { targetProfileId: report.targetProfileId } : null,
    report.targetSellerId ? { targetSellerId: report.targetSellerId } : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null)
  const priorConfirmed = targetOr.length
    ? await db.report.count({ where: { status: 'confirmed', id: { not: report.id }, OR: targetOr } })
    : 0

  let ai: AdminCase['ai'] = null
  if (report.aiAnalysis && report.aiAnalyzedAt) {
    try { ai = { ...JSON.parse(report.aiAnalysis), analyzedAt: report.aiAnalyzedAt.toISOString() } } catch { /* corrupt cache */ }
  }

  const data: AdminCase = {
    id: report.id,
    reason: report.reason,
    detail: report.detail,
    severity: report.severity,
    status: report.status,
    stage: disputeStage(report),
    withdrawn: report.resolvedBy === 'withdrawn-by-reporter',
    appealed: !!report.appealedAt,
    createdAt: report.createdAt.toISOString(),
    evidenceUntil: report.evidenceUntil?.toISOString() ?? null,
    resolvedBy: report.resolvedBy,
    resolvedAt: report.resolvedAt?.toISOString() ?? null,
    decisionNote: report.decisionNote,
    internalNote: report.internalNote,
    listingId: report.listingId,
    conversationId: convoByReportId.get(report.id) ?? null,
    reporter: reporter
      ? { name: reporter.name, email: reporter.email, trustScore: reporter.trustScore, strikes: reporter.strikes, sellerId: reporter.sellerId }
      : null,
    target,
    priorConfirmed,
    timeline,
    ai,
  }

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-3 py-8 sm:px-6 lg:px-8">
        {/* One back-link idiom across /admin (piece rule: no '←' text glyphs):
            muted ink + nav-tier ChevronLeft, exactly as the conversation viewer. */}
        <Link href="/admin/moderation?tab=disputes" className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-accent-foreground">
          <ChevronLeft className="h-4 w-4" strokeWidth={STROKE_NAV} /> Dispute center
        </Link>
        <DisputeRoomAdmin data={data} />
      </main>
    </div>
  )
}
