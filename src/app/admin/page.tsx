import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { AdminHeader } from '@/components/admin/admin-header'
import { AdminNav } from '@/components/admin/admin-nav'
import { ModerationClient, type ModCase } from '@/components/admin/moderation-client'
import { reportContext, targetContext, type RawReport } from '@/lib/admin-reports'
import { ShieldAlert, Monitor } from 'lucide-react'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Moderation — eno.vn',
  robots: { index: false, follow: false },
}

// Priority = severity × reporter-credibility × community pile-on, age-boosted. Tunable.
const SEV_W: Record<string, number> = { severe: 3, moderate: 2, minor: 1 }
function credibility(rep: { trustScore: number; strikes: number } | null): number {
  if (!rep) return 0.6
  if (rep.strikes > 0) return 0.4 // serial / penalized reporter → down-weight
  if (rep.trustScore >= 110) return 1.4
  if (rep.trustScore >= 85) return 1.2
  return 1.0
}
const BUCKET_RANK: Record<ModCase['bucket'], number> = { critical: 0, high: 1, standard: 2 }

export default async function AdminPage() {
  const admin = await getAdmin()

  if (!admin) {
    return (
      <div className="flex min-h-screen flex-col">
        <AdminHeader />
        <main id="main" tabIndex={-1} className="flex flex-1 items-center justify-center px-3">
          <div className="max-w-sm rounded-2xl bg-card p-8 text-center shadow-pop">
            <ShieldAlert className="mx-auto h-10 w-10 text-ink-4" />
            <h1 className="mt-4 text-lg font-bold text-foreground">Restricted area</h1>
            <p className="mt-2 text-sm text-muted-foreground">Sign in with an authorized eno.vn admin account to access the moderation queue.</p>
            <a href="/" className="mt-5 inline-block rounded-xl bg-primary px-6 py-2 text-sm font-bold text-white hover:bg-brand-dark transition-colors">Back to eno.vn</a>
          </div>
        </main>
      </div>
    )
  }

  const SELECT = { id: true, reason: true, detail: true, severity: true, status: true, createdAt: true, resolvedBy: true, resolvedAt: true, internalNote: true, appealNote: true, appealImages: true, appealedAt: true, sellerResponse: true, sellerRespondedAt: true, reporterProfileId: true, listingId: true, conversationId: true, targetSellerId: true, targetProfileId: true } as const
  const [openRows, resolvedRows] = await Promise.all([
    db.report.findMany({ where: { status: 'open' }, orderBy: { createdAt: 'desc' }, take: 500, select: SELECT }),
    db.report.findMany({ where: { status: { not: 'open' } }, orderBy: { resolvedAt: 'desc' }, take: 60, select: SELECT }),
  ])
  type Rep = (typeof openRows)[number]

  // Phase 3 reporter ladder: reports filed by a ≥2-strike reporter are pre-screened —
  // still in the queue (never silently dropped) but triaged LAST. preScreen is
  // @ignore'd until scripts/add-ban-evasion.mjs runs → guarded raw id lookup
  // (pre-migration: nothing is screened).
  let preScreened = new Set<string>()
  try {
    const rows = await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Report" WHERE "status" = 'open' AND "preScreen" = true LIMIT 500`
    preScreened = new Set(rows.map((r) => r.id))
  } catch { /* migration pending */ }

  const raw: RawReport[] = [...openRows, ...resolvedRows].map((r) => ({ id: r.id, reporterProfileId: r.reporterProfileId, listingId: r.listingId, conversationId: r.conversationId, targetSellerId: r.targetSellerId, targetProfileId: r.targetProfileId }))
  const [{ reporterById, convoByReportId }, { targetByReportId }] = await Promise.all([reportContext(raw), targetContext(raw)])

  // Community = how many OPEN reports share a target (the actionable pile-on).
  const keyOf = (r: Rep) => r.targetProfileId || r.targetSellerId || r.listingId || r.id
  const openByKey = new Map<string, number>()
  for (const r of openRows) { const k = keyOf(r); openByKey.set(k, (openByKey.get(k) || 0) + 1) }

  const now = Date.now()
  const buildCase = (r: Rep, resolved: boolean): ModCase => {
    const reporter = r.reporterProfileId ? reporterById.get(r.reporterProfileId) ?? null : null
    const target = targetByReportId.get(r.id)!
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
      reporter, conversationId: convoByReportId.get(r.id) ?? null, communityCount: community, target,
      internalNote: r.internalNote ?? null,
      // The seller's formal reply (buyer-king SLA) — evidence the admin sees before deciding.
      sellerResponse: r.sellerResponse ?? null,
      sellerRespondedAt: r.sellerRespondedAt ? r.sellerRespondedAt.toISOString() : null,
      appeal: r.appealedAt ? { note: r.appealNote ?? null, images: Array.isArray(appealImages) ? appealImages : [], at: r.appealedAt.toISOString() } : null,
      resolution: resolved ? { status: r.status, by: r.resolvedBy, at: r.resolvedAt ? r.resolvedAt.toISOString() : null } : null,
    }
  }

  const cases: ModCase[] = openRows.map((r) => buildCase(r, false))
  // preScreen is the LEADING sort key: a pre-screened report sinks below every
  // bucket (spec: triaged last) — it's still reviewable, just never jumps the line.
  cases.sort((a, b) => Number(a.preScreen) - Number(b.preScreen) || BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket] || b.priority - a.priority || (a.createdAt < b.createdAt ? 1 : -1))
  const resolved: ModCase[] = resolvedRows.map((r) => buildCase(r, true))

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AdminHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-3 py-8 sm:px-6 lg:px-8">
        {/* The moderation panel is web/desktop-only. */}
        <div className="flex flex-col items-center justify-center gap-2 py-24 text-center md:hidden">
          <Monitor className="h-10 w-10 text-ink-4" />
          <p className="text-sm font-semibold text-foreground">The moderation panel is available on desktop only.</p>
          <p className="text-xs text-muted-foreground">Open eno.vn/admin on a larger screen.</p>
        </div>
        <div className="hidden md:block">
          <AdminNav active="/admin" />
          <div className="mb-5">
            <h1 className="h-title text-foreground">Moderation</h1>
            <p className="mt-1 text-sm text-muted-foreground">Signed in as {admin}. One triaged inbox — most urgent first. Confirm docks the target&apos;s trust; abusive penalizes the reporter. Listings publish instantly (no review queue); low-trust accounts can&apos;t post until their score recovers.</p>
          </div>
          <ModerationClient cases={cases} resolved={resolved} />
        </div>
      </main>
    </div>
  )
}
