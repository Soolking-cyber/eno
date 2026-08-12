import type { Metadata } from 'next'
import Link from 'next/link'
import { FileCheck2 } from '@/components/ui/icons'
import { getAdmin } from '@/lib/admin'
import { AdminDenied } from '@/components/admin/admin-denied'
import { listVisaAdminCases, type VisaQueueRow, type VisaDocumentRow } from '@/lib/visa-admin'
import { visaStatusLabel, visaStatusVariant } from './visa-status'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Visa queue — eno.vn admin', robots: { index: false, follow: false } }

// Visa operator queue — the forum's /admin/visas ported into the ONE dashboard
// (CLAUDE_ONE_DASHBOARD_PROMPT item 6): same Supabase tables, eno.vn's own
// service-role client, the shared admin shell (site Header via admin/layout.tsx,
// the rail's role-gated Admin group owns section nav). Same grouping and row
// columns as the forum queue: case id, status, document kinds, applicant, updated.

const ACTIVE_EXCLUDED = ['draft', 'needs_changes', 'approved', 'rejected', 'cancelled']

export default async function AdminVisasPage() {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />

  const data = await listVisaAdminCases()

  const shell = (children: React.ReactNode) => (
    <div className="flex flex-1 flex-col bg-background">
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 py-8 sm:px-6 lg:px-8">
        <div className="mb-5">
          <h1 className="h-title text-foreground">Visa queue</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Signed in as {admin}. Private review queue. Never invent an answer, accept a declaration, solve a challenge, pay, or submit without the applicant&apos;s recorded approval and a human review of the live official form.
          </p>
        </div>
        {children}
      </main>
    </div>
  )

  if (!data) {
    return shell(
      <Card className="px-5 py-6">
        <p className="text-sm text-muted-foreground">
          The visa tables are not reachable from this environment yet, so the queue cannot be shown. Once the shared Supabase project is provisioned here, cases appear automatically.
        </p>
      </Card>,
    )
  }

  const rows = data.applications
  const docs = data.documents
  const active = rows.filter((item) => !ACTIVE_EXCLUDED.includes(item.status))
  // Drafts never reach this queue (listVisaAdminCases excludes them — an applicant's
  // private, unpaid work); this group holds only cases sent back for changes.
  const changes = rows.filter((item) => item.status === 'needs_changes')
  const closed = rows.filter((item) => ['approved', 'rejected', 'cancelled'].includes(item.status))

  const CaseRow = ({ item }: { item: VisaQueueRow }) => {
    const kinds = docs.filter((d: VisaDocumentRow) => d.application_id === item.id).map((d) => d.kind)
    return (
      <Link href={`/admin/visas/${item.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-tint"><FileCheck2 className="h-4 w-4 text-ink-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm font-bold text-foreground">{item.id.slice(0, 8)}</span>
            <Badge variant={visaStatusVariant(item.status)} className="capitalize">{visaStatusLabel(item.status)}</Badge>
            {item.paid_at && <Badge variant="success">Fee paid · {item.payment_provider}</Badge>}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{kinds.join(', ') || 'No documents'} · applicant {item.user_id.slice(0, 8)}</p>
        </div>
        <time className="shrink-0 text-3xs text-ink-4">{new Date(item.updated_at).toLocaleDateString('en-GB')}</time>
      </Link>
    )
  }

  // Plain render helper, NOT a component (see admin/disputes — a component created
  // during render remounts its subtree every pass).
  const renderList = (list: VisaQueueRow[]) =>
    list.length === 0
      ? <p className="px-2 py-6 text-sm text-muted-foreground">No cases here.</p>
      : (
        <Card className="py-0">
          <ul className="divide-y divide-border">
            {list.map((item) => <li key={item.id}><CaseRow item={item} /></li>)}
          </ul>
        </Card>
      )

  return shell(
    <>
      <h2 className="text-sm font-bold uppercase tracking-wide text-ink-4">Active · {active.length}</h2>
      <div className="mt-2">{renderList(active)}</div>
      <h2 className="mt-10 text-sm font-bold uppercase tracking-wide text-ink-4">Changes requested · {changes.length}</h2>
      <div className="mt-2">{renderList(changes)}</div>
      <h2 className="mt-10 text-sm font-bold uppercase tracking-wide text-ink-4">Closed · {closed.length}</h2>
      <div className="mt-2 opacity-80">{renderList(closed)}</div>
    </>,
  )
}
