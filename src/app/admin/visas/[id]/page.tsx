import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, FileText, Lock } from 'lucide-react'
import { getAdmin } from '@/lib/admin'
import { AdminDenied } from '@/components/admin/admin-denied'
import { loadVisaAdminCase, signVisaDocumentUrl, type VisaDocumentRow } from '@/lib/visa-admin'
import { VISA_ADMIN_ACTIONS, visaStatusLabel, visaStatusVariant } from '../visa-status'
import { VisaCaseActions } from './case-actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Visa case — eno.vn admin', robots: { index: false, follow: false } }

// One visa case, ADMIN view — the forum's /admin/visas/[id] ported into the one
// dashboard: safety gate, private documents (signed same-project storage URLs,
// rendered once at SSR like the disputes evidence), status-transition actions and
// the audit trail. Applicant payload contents are intentionally ABSENT: they are
// encrypted with VISA_DATA_ENCRYPTION_KEY, which eno.vn does not have (see the
// TODO in src/lib/visa-admin.ts).

const IMAGE_KINDS = ['passport', 'portrait']
const docTitle = (kind: string) => (kind === 'passport' ? 'Passport data page' : kind === 'portrait' ? 'Portrait photo' : kind)

export default async function AdminVisaCasePage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />
  const { id } = await params

  const result = await loadVisaAdminCase(id)
  if (result.state === 'not-found') notFound()
  if (result.state === 'unavailable') {
    return (
      <div className="flex flex-1 flex-col bg-background">
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 py-8 sm:px-6 lg:px-8">
          <Card className="px-5 py-6">
            <p className="text-sm text-muted-foreground">The visa tables are not reachable from this environment yet, so this case cannot be shown.</p>
          </Card>
        </main>
      </div>
    )
  }
  const { application, documents, events } = result

  const imageDocuments = documents.filter((d) => IMAGE_KINDS.includes(d.kind))
  const otherDocuments = documents.filter((d) => !IMAGE_KINDS.includes(d.kind))
  // Sign once at SSR (6h, matching the admin dispute room) so previews survive a
  // long deliberation; a failed signature degrades to "preview unavailable".
  const signedUrls = new Map<string, string | null>(
    await Promise.all(documents.map(async (d) => [d.id, await signVisaDocumentUrl(d.storage_path)] as const)),
  )

  const issuesOf = (d: VisaDocumentRow): string[] => {
    const issues = d.validation_report?.issues
    return Array.isArray(issues) ? issues.filter((i): i is string => typeof i === 'string') : []
  }

  return (
    <div className="flex flex-1 flex-col bg-background">
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 py-8 sm:px-6 lg:px-8">
        <Link href="/admin/visas" className="inline-flex items-center gap-1.5 text-sm font-bold text-accent-foreground">
          <ArrowLeft className="h-4 w-4" />Visa queue
        </Link>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="h-title text-foreground">Visa case {application.id.slice(0, 8)}</h1>
              <Badge variant={visaStatusVariant(application.status)} className="capitalize">{visaStatusLabel(application.status)}</Badge>
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{application.id} · applicant {application.user_id.slice(0, 8)}</p>
          </div>
          <VisaCaseActions id={application.id} actions={VISA_ADMIN_ACTIONS[application.status] || []} />
        </div>

        <div className="mt-5 space-y-5">
          <Card>
            <CardHeader><CardTitle>Safety gate</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Info label="Applicant declaration" value={application.applicant_confirmed_at ? new Date(application.applicant_confirmed_at).toLocaleString('en-GB') : 'Not confirmed'} />
              <Info label="Prefill authorization" value={application.authorized_at ? new Date(application.authorized_at).toLocaleString('en-GB') : 'Not authorized'} />
              <Info label="Service fee" value={application.paid_at ? `Paid ${new Date(application.paid_at).toLocaleString('en-GB')} · ${application.payment_provider}` : 'Not paid'} />
              <Info label="Assigned admin" value={application.assigned_admin || 'Unassigned'} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Private documents</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {documents.length === 0 && <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>}
              {imageDocuments.length > 0 && (
                <div className="grid gap-4 lg:grid-cols-2">
                  {imageDocuments.map((d) => {
                    const url = signedUrls.get(d.id)
                    const issues = issuesOf(d)
                    return (
                      <article key={d.id} className="overflow-hidden rounded-2xl border border-line-strong bg-tint/40">
                        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
                          <div>
                            <h3 className="font-bold text-foreground">{docTitle(d.kind)}</h3>
                            <p className="mt-0.5 text-xs text-body">{d.width && d.height ? `${d.width} × ${d.height}px · ` : ''}{Math.max(1, Math.round(d.size_bytes / 1024))} KB</p>
                          </div>
                          <Badge variant={d.validation_status === 'passed' ? 'success' : d.validation_status === 'failed' ? 'destructive' : 'warning'}>{d.validation_status || 'pending'}</Badge>
                        </div>
                        <div className="flex h-72 w-full items-center justify-center overflow-hidden bg-white p-3 lg:h-80">
                          {url
                            /* plain <img>: short-lived signed URL, same idiom as the disputes evidence viewer */
                            ? <img src={url} alt={`${docTitle(d.kind)} submitted by applicant`} className="h-full w-full object-contain" loading="lazy" />
                            : <p className="text-sm text-body">Preview unavailable.</p>}
                        </div>
                        {issues.length > 0 && (
                          <ul className="list-disc space-y-1 border-t border-border px-8 py-3 text-xs text-destructive">
                            {issues.map((issue) => <li key={issue}>{issue.replaceAll('_', ' ')}</li>)}
                          </ul>
                        )}
                      </article>
                    )
                  })}
                </div>
              )}
              {otherDocuments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {otherDocuments.map((d) => {
                    const url = signedUrls.get(d.id)
                    return url
                      ? (
                        <Button key={d.id} asChild variant="outline" size="none">
                          <a href={url} target="_blank" rel="noopener noreferrer" className="h-11 px-4 capitalize"><FileText className="h-4 w-4" />{d.kind}</a>
                        </Button>
                      )
                      : <Badge key={d.id} variant="outline" size="md" className="capitalize">{d.kind} · link unavailable</Badge>
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Applicant answers</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-start gap-3 rounded-xl border border-line-strong bg-tint px-4 py-3">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-4" />
                <p className="text-sm text-body">
                  The applicant&apos;s answers are stored encrypted and the decryption key is not configured on eno.vn, so they cannot be shown or edited here. Review them — and send any applicant message — from the forum operator tools for now.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Audit trail</CardTitle></CardHeader>
            <CardContent>
              {events.length === 0
                ? <p className="text-sm text-muted-foreground">No events recorded yet.</p>
                : (
                  <ol className="space-y-3">
                    {events.map((event) => (
                      <li key={event.id} className="flex justify-between gap-4 text-sm">
                        <span className="font-medium capitalize">{event.event.replaceAll('_', ' ')}</span>
                        <time className="shrink-0 text-xs text-ink-4">{new Date(event.created_at).toLocaleString('en-GB')}</time>
                      </li>
                    ))}
                  </ol>
                )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="block text-xs text-ink-4">{label}</span>
      <span className="text-sm font-semibold text-foreground">{value}</span>
    </p>
  )
}
