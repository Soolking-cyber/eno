import type { Metadata } from 'next'
import { getAdmin } from '@/lib/admin'
import { db } from '@/lib/db'
import { AdminDenied } from '@/components/admin/admin-denied'
import { AdminSectionShell, pickTab } from '@/components/admin/section-shell'
import { ReportsInbox } from '@/components/admin/sections/reports-inbox'
import { DisputesList } from '@/components/admin/sections/disputes-list'
import { EnforcementClient } from '@/components/admin/enforcement-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Moderation — eno.vn admin', robots: { index: false, follow: false } }

// Console v2: the reports inbox (fast triage), the dispute center (case rooms) and the enforcement
// ladder are three tabs of ONE Moderation section. Detail pages keep their URLs
// (/admin/disputes/[id], /admin/conversation/[id]) — they are deep links, not sections.
const TABS = ['reports', 'disputes', 'enforcement'] as const

export default async function AdminModerationPage({ searchParams }: { searchParams?: Promise<{ tab?: string | string[] }> }) {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />
  const tab = pickTab((await searchParams)?.tab, TABS, 'reports')
  const [openReports, appeals] = await Promise.all([
    db.report.count({ where: { status: 'open' } }),
    db.report.count({ where: { status: 'open', appealedAt: { not: null } } }),
  ])
  return (
    <AdminSectionShell
      title="Moderation"
      description={<>Signed in as {admin}. Reports to triage, disputes to mediate, enforcement to review{appeals > 0 ? <> — <strong className="text-foreground">{appeals} appeal{appeals === 1 ? '' : 's'}</strong> waiting</> : null}.</>}
      basePath="/admin/moderation"
      tabs={[
        { key: 'reports', label: 'Reports', count: openReports },
        { key: 'disputes', label: 'Disputes' },
        { key: 'enforcement', label: 'Enforcement' },
      ]}
      active={tab}
    >
      {tab === 'reports' && <ReportsInbox />}
      {tab === 'disputes' && <DisputesList />}
      {tab === 'enforcement' && (
        <section aria-labelledby="enforcement-console">
          <h2 id="enforcement-console" className="sr-only">Enforcement</h2>
          <p className="mb-4 text-sm text-muted-foreground">The trust ladder: active actions, appeals to decide, buyers waiting on a seller&apos;s reply. Lift, overturn or uphold — every decision is recorded against the account.</p>
          <EnforcementClient />
        </section>
      )}
    </AdminSectionShell>
  )
}
