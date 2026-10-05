import { db } from '@/lib/db'
import { ModerationClient, type ModCase } from '@/components/admin/moderation-client'
import { reportContext, reportTargetKey, targetContext, type RawReport } from '@/lib/admin-reports'
import { reportedContentFor } from '@/lib/reported-content'
import { EmptyState } from '@/components/ui/empty-state'
import { Monitor } from '@/components/ui/icons'

// The triaged reports inbox — most urgent first. Was the /admin home until console v2 (2026-09-05);
// now the Reports tab of /admin/moderation. Priority = severity × reporter-credibility × community
// pile-on, age-boosted. Tunable.
const SEV_W: Record<string, number> = { severe: 3, moderate: 2, minor: 1 }
function credibility(rep: { trustScore: number; strikes: number } | null): number {
  if (!rep) return 0.6
  if (rep.strikes > 0) return 0.4 // serial / penalized reporter → down-weight
  if (rep.trustScore >= 110) return 1.4
  if (rep.trustScore >= 85) return 1.2
  return 1.0
}
const BUCKET_RANK: Record<ModCase['bucket'], number> = { critical: 0, high: 1, standard: 2 }

export async function ReportsInbox() {
  const SELECT = { id: true, reason: true, detail: true, severity: true, status: true, createdAt: true, resolvedBy: true, resolvedAt: true, internalNote: true, appealNote: true, appealImages: true, appealedAt: true, sellerResponse: true, sellerRespondedAt: true, reporterProfileId: true, listingId: true, conversationId: true, targetSellerId: true, targetProfileId: true }
  const [openRows, resolvedRows] = await Promise.all([
    db.report.findMany({ where: { status: 'open' }, orderBy: { createdAt: 'desc' }, take: 500, select: SELECT }),
    db.report.findMany({ where: { status: { not: 'open' } }, orderBy: { resolvedAt: 'desc' }, take: 60, select: SELECT }),
  ])
  type Rep = (typeof openRows)[number]

  // Phase 3 reporter ladder: reports filed by a ≥2-strike reporter are pre-screened — still in the
  // queue (never silently dropped) but triaged LAST. preScreen is @ignore'd until
  // scripts/add-ban-evasion.mjs runs → guarded raw id lookup (pre-migration: nothing is screened).
  let preScreened = new Set<string>()
  try {
    const rows = await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Report" WHERE "status" = 'open' AND "preScreen" = true LIMIT 500`
    preScreened = new Set(rows.map((r) => r.id))
  } catch { /* migration pending */ }

  const raw: RawReport[] = [...openRows, ...resolvedRows].map((r) => ({ id: r.id, reporterProfileId: r.reporterProfileId, listingId: r.listingId, conversationId: r.conversationId, targetSellerId: r.targetSellerId, targetProfileId: r.targetProfileId }))
  // CONTENT cases (ugc-safety, R5): the review / help reply / help post each one names, resolved live.
  // One DisputeMessage query for the page, plus one per content kind present.
  const [{ reporterById, convoByReportId }, { targetByReportId }, contentByReportId] = await Promise.all([reportContext(raw), targetContext(raw), reportedContentFor(raw.map((r) => r.id))])
  const CONTENT_LABEL = { review: 'Reported review', 'help-comment': 'Reported help-centre reply', 'help-post': 'Reported help-centre post' } as const
  // The pile-on key: a content case groups with every other open report on the SAME content, not by its
  // (absent) target — several people reporting one review is exactly the signal the count exists for.
  const keyOf = (r: Rep) => { const ct = contentByReportId.get(r.id); return ct ? `content:${ct.kind}:${ct.id}` : reportTargetKey(r) }

  // Community = how many OPEN reports share a target (the actionable pile-on).
  const openByKey = new Map<string, number>()
  for (const r of openRows) { const k = keyOf(r); openByKey.set(k, (openByKey.get(k) || 0) + 1) }

  const now = Date.now()
  const buildCase = (r: Rep, resolved: boolean): ModCase => {
    const reporter = r.reporterProfileId ? reporterById.get(r.reporterProfileId) ?? null : null
    const content = contentByReportId.get(r.id) ?? null
    const target = content
      ? { kind: 'content' as const, name: CONTENT_LABEL[content.kind], trustScore: null, trustTier: null, sellerId: null, profileId: null, isGuest: false, listing: null }
      : targetByReportId.get(r.id)!
    const community = resolved ? 1 : openByKey.get(keyOf(r)) ?? 1
    const sevKey = r.severity && SEV_W[r.severity] ? r.severity : 'moderate'
    const cred = credibility(reporter)
    const ageDays = (now - r.createdAt.getTime()) / 86_400_000
    const isAppeal = !resolved && !!r.appealedAt
    const priority = SEV_W[sevKey] * cred * (1 + 0.5 * (community - 1)) + (ageDays > 2 ? 1 : 0) + (isAppeal ? 5 : 0)
    const bucket: ModCase['bucket'] =
      isAppeal || community >= 3 || (sevKey === 'severe' && cred >= 1.2) || priority >= 5 ? 'critical' : priority >= 2.8 ? 'high' : 'standard'
    let appealImages: string[] = []
    try { appealImages = r.appealImages ? JSON.parse(r.appealImages) : [] } catch { /* ignore */ }
    return {
      id: r.id, reason: r.reason, detail: r.detail, severity: r.severity, createdAt: r.createdAt.toISOString(),
      ageDays: Math.floor(ageDays), bucket, priority,
      preScreen: preScreened.has(r.id),
      reporter, conversationId: convoByReportId.get(r.id) ?? null, communityCount: community, target, content,
      internalNote: r.internalNote ?? null,
      sellerResponse: r.sellerResponse ?? null,
      sellerRespondedAt: r.sellerRespondedAt ? r.sellerRespondedAt.toISOString() : null,
      appeal: r.appealedAt ? { note: r.appealNote ?? null, images: Array.isArray(appealImages) ? appealImages : [], at: r.appealedAt.toISOString() } : null,
      resolution: resolved ? { status: r.status, by: r.resolvedBy, at: r.resolvedAt ? r.resolvedAt.toISOString() : null } : null,
    }
  }

  const cases: ModCase[] = openRows.map((r) => buildCase(r, false))
  // preScreen is the LEADING sort key: a pre-screened report sinks below every bucket (spec: triaged
  // last) — it's still reviewable, just never jumps the line.
  cases.sort((a, b) => Number(a.preScreen) - Number(b.preScreen) || BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket] || b.priority - a.priority || (a.createdAt < b.createdAt ? 1 : -1))
  const resolved: ModCase[] = resolvedRows.map((r) => buildCase(r, true))

  return (
    <section aria-labelledby="reports-inbox">
      <h2 id="reports-inbox" className="sr-only">Reports</h2>
      {/* The triage inbox is desktop-only (dense, multi-column). */}
      <EmptyState tone="admin" icon={Monitor} title="The reports inbox is available on desktop only." subtitle="Open eno.vn/admin/moderation on a larger screen." className="py-24 md:hidden" />
      <div className="hidden md:block">
        <p className="mb-4 text-sm text-muted-foreground">One triaged inbox — most urgent first. Confirm docks the target&apos;s trust; abusive penalizes the reporter.</p>
        <ModerationClient cases={cases} resolved={resolved} />
      </div>
    </section>
  )
}
