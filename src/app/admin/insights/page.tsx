import type { Metadata } from 'next'
import { getAdmin } from '@/lib/admin'
import { AdminDenied } from '@/components/admin/admin-denied'
import { AdminSectionShell, pickTab } from '@/components/admin/section-shell'
import { FunnelReport } from '@/components/admin/sections/funnel-report'
import { FeedbackInbox } from '@/components/admin/sections/feedback-inbox'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Insights — eno.vn admin', robots: { index: false, follow: false } }

// Console v2: the publish funnel and the feedback inbox — what sellers struggle with and what users
// tell us — are two tabs of ONE Insights section.
const TABS = ['funnel', 'feedback'] as const

export default async function AdminInsightsPage({ searchParams }: { searchParams?: Promise<{ tab?: string | string[] }> }) {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />
  const tab = pickTab((await searchParams)?.tab, TABS, 'funnel')
  return (
    <AdminSectionShell
      title="Insights"
      description={<>Signed in as {admin}. Where publishing effort is lost, and what people send through Help.</>}
      basePath="/admin/insights"
      tabs={[{ key: 'funnel', label: 'Publish funnel' }, { key: 'feedback', label: 'Feedback' }]}
      active={tab}
    >
      {tab === 'funnel' ? <FunnelReport /> : <FeedbackInbox />}
    </AdminSectionShell>
  )
}
