import Link from 'next/link'
import { FileCheck2 } from '@/components/ui/icons'
import type { VisaDeskScope } from '@/lib/desk-operator'
import { listVisaAdminCases, type VisaQueueRow, type VisaDocumentRow } from '@/lib/visa-admin'
import { visaStatusLabel, visaStatusVariant } from '../visas/visa-status'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

// Visa operator queue — same Supabase tables, eno.vn's own service-role client. Same grouping and
// row columns as the forum queue it was ported from: case id, status, document kinds, applicant,
// updated. The Visas tab of /admin/services (services edition only: this file is imported only by
// page.svc.tsx, so a marketplace build never compiles it).
const ACTIVE_EXCLUDED = ['draft', 'needs_changes', 'approved', 'rejected', 'cancelled']

export async function VisaQueue({ scope }: { scope: VisaDeskScope }) {
  const data = await listVisaAdminCases(scope)
  if (!data) {
    return (
      <Card className="px-5 py-6">
        <p className="text-sm text-muted-foreground">
          The visa tables are not reachable from this environment yet, so the queue cannot be shown. Once the shared Supabase project is provisioned here, cases appear automatically.
        </p>
      </Card>
    )
  }
  const rows = data.applications
  const docs = data.documents
  const active = rows.filter((item) => !ACTIVE_EXCLUDED.includes(item.status))
  // Drafts never reach this queue (listVisaAdminCases excludes them — an applicant's private, unpaid
  // work); this group holds only cases sent back for changes.
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
  const renderList = (list: VisaQueueRow[]) =>
    list.length === 0
      ? <p className="px-2 py-6 text-sm text-muted-foreground">No cases here.</p>
      : (
        <Card className="py-0">
          <ul className="divide-y divide-border">{list.map((item) => <li key={item.id}><CaseRow item={item} /></li>)}</ul>
        </Card>
      )
  return (
    <section aria-labelledby="visa-queue">
      <h2 id="visa-queue" className="text-base font-bold text-foreground">Visa queue</h2>
      <p className="mb-4 mt-1 max-w-3xl text-sm text-muted-foreground">
        Private review queue. Never invent an answer, accept a declaration, solve a challenge, pay, or submit without the applicant&apos;s recorded approval.
      </p>
      <h3 className="text-sm font-bold uppercase tracking-wide text-ink-4">Active · {active.length}</h3>
      <div className="mt-2">{renderList(active)}</div>
      <h3 className="mt-10 text-sm font-bold uppercase tracking-wide text-ink-4">Changes requested · {changes.length}</h3>
      <div className="mt-2">{renderList(changes)}</div>
      <h3 className="mt-10 text-sm font-bold uppercase tracking-wide text-ink-4">Closed · {closed.length}</h3>
      <div className="mt-2 opacity-80">{renderList(closed)}</div>
    </section>
  )
}
