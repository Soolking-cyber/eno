import type { Metadata } from 'next'
import Link from 'next/link'
import { getAdmin } from '@/lib/admin'
import { AdminDenied } from '@/components/admin/admin-denied'
import { loadVerificationForReview } from '@/lib/core/business-verification-service'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { ReviewPanel } from './review-panel'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Review — eno.vn admin', robots: { index: false, follow: false } }

const CHANNEL1: Record<string, { label: string; variant: 'success' | 'warning' | 'destructive' | 'neutral' }> = {
  verified: { label: 'Tax registry: verified', variant: 'success' },
  mismatch: { label: 'Tax registry: NAME MISMATCH', variant: 'destructive' },
  inactive: { label: 'Tax registry: inactive taxpayer', variant: 'destructive' },
  not_found: { label: 'Tax registry: code not found', variant: 'destructive' },
  unchecked: { label: 'Tax registry: not checked yet', variant: 'warning' },
}

export default async function AdminVerificationDetail({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />
  const { id } = await params
  const kase = await loadVerificationForReview(id)

  const shell = (children: React.ReactNode) => (
    <div className="flex flex-1 flex-col bg-background">
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-4xl flex-1 px-3 py-8 sm:px-6 lg:px-8">
        <Link href="/admin/verification?tab=business" className="text-sm text-accent-foreground hover:underline">← Queue</Link>
        {children}
      </main>
    </div>
  )

  if (!kase) return shell(<Card className="mt-4 px-5 py-6"><p className="text-sm text-muted-foreground">Case not found.</p></Card>)

  const c1 = CHANNEL1[kase.channel1] ?? CHANNEL1.unchecked
  const seller = kase.seller

  return shell(
    <div className="mt-4 space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="h-title text-foreground">{seller?.name ?? '—'}</h1>
        <Badge variant={kase.status === 'pending' ? 'warning' : kase.status === 'approved' ? 'success' : 'neutral'}>{kase.status}</Badge>
        <Badge variant={c1.variant}>{c1.label}</Badge>
      </div>

      <Card className="space-y-2 px-5 py-4 text-sm">
        <p className="font-semibold text-foreground">Registered identity (what the documents must match)</p>
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <div><dt className="text-xs text-ink-4">Legal name</dt><dd className="font-medium text-foreground">{seller?.legalName ?? '—'}</dd></div>
          <div><dt className="text-xs text-ink-4">Tax code (MST)</dt><dd className="font-mono text-foreground">{seller?.taxCode ?? '—'}</dd></div>
          <div><dt className="text-xs text-ink-4">Registry name</dt><dd className="text-foreground">{seller?.taxRegisteredName ?? '—'}</dd></div>
          <div><dt className="text-xs text-ink-4">Display name</dt><dd className="text-foreground">{seller?.name ?? '—'}</dd></div>
        </dl>
        {kase.consentAt && <p className="text-xs text-ink-4">Consent recorded {new Date(kase.consentAt).toLocaleString()}.</p>}
      </Card>

      <ReviewPanel
        caseId={kase.id}
        status={kase.status}
        channel1={kase.channel1}
        legalName={seller?.legalName ?? seller?.name ?? ''}
        documents={kase.documents.map((d) => ({ kind: d.kind, path: d.path, mime: d.mime }))}
      />
    </div>,
  )
}
