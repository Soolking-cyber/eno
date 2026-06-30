import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { AdminHeader } from '@/components/admin/admin-header'
import { AdminNav } from '@/components/admin/admin-nav'
import { ModerationClient, type ModCase } from '@/components/admin/moderation-client'
import { reportContext, targetContext, type RawReport } from '@/lib/admin-reports'
import { ShieldAlert } from 'lucide-react'
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

  const reports = await db.report.findMany({
    where: { status: 'open' },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: { id: true, reason: true, detail: true, severity: true, createdAt: true, reporterProfileId: true, listingId: true, conversationId: true, targetSellerId: true, targetProfileId: true },
  })

  const raw: RawReport[] = reports.map((r) => ({ id: r.id, reporterProfileId: r.reporterProfileId, listingId: r.listingId, conversationId: r.conversationId, targetSellerId: r.targetSellerId, targetProfileId: r.targetProfileId }))
  const [{ reporterById, convoByReportId }, { targetByReportId, communityByReportId }] = await Promise.all([
    reportContext(raw),
    targetContext(raw),
  ])

  const now = Date.now()
  const cases: ModCase[] = reports.map((r) => {
    const reporter = r.reporterProfileId ? reporterById.get(r.reporterProfileId) ?? null : null
    const target = targetByReportId.get(r.id)!
    const community = communityByReportId.get(r.id) ?? 1
    const sevKey = r.severity && SEV_W[r.severity] ? r.severity : 'moderate'
    const cred = credibility(reporter)
    const ageDays = (now - r.createdAt.getTime()) / 86_400_000
    const priority = SEV_W[sevKey] * cred * (1 + 0.5 * (community - 1)) + (ageDays > 2 ? 1 : 0)
    const bucket: ModCase['bucket'] =
      community >= 3 || (sevKey === 'severe' && cred >= 1.2) || priority >= 5 ? 'critical' : priority >= 2.8 ? 'high' : 'standard'
    return {
      id: r.id, reason: r.reason, detail: r.detail, severity: r.severity, createdAt: r.createdAt.toISOString(),
      ageDays: Math.floor(ageDays), bucket, priority,
      reporter, conversationId: convoByReportId.get(r.id) ?? null, communityCount: community, target,
    }
  })
  // Critical first, then by priority, then newest.
  cases.sort((a, b) => BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket] || b.priority - a.priority || (a.createdAt < b.createdAt ? 1 : -1))

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AdminHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-3 py-8 sm:px-6">
        <AdminNav active="/admin" />
        <div className="mb-5">
          <h1 className="h-title text-foreground">Moderation</h1>
          <p className="mt-1 text-sm text-muted-foreground">Signed in as {admin}. One triaged inbox — most urgent first. Confirm docks the target&apos;s trust; abusive penalizes the reporter. Listings publish instantly (no review queue); low-trust accounts can&apos;t post until their score recovers.</p>
        </div>
        <ModerationClient cases={cases} />
      </main>
    </div>
  )
}
