import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, FileText, Lock, MessageSquare } from '@/components/ui/icons'
import { getVisaDeskScope } from '@/lib/desk-operator'
import { AdminDenied } from '@/components/admin/admin-denied'
import { loadVisaAdminCase, signVisaDocumentUrl, type VisaDocumentRow } from '@/lib/visa-admin'
import { findVisaThread, getVisaThreadMode, type VisaThreadMode } from '@/lib/visa/dm-thread'
import { VISA_ADMIN_ACTIONS, visaStatusLabel, visaStatusVariant } from '../visa-status'
import { VisaCaseActions, VisaThreadTakeover } from './case-actions'
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

/** Who is driving the applicant's chat right now. Derived from visa_events (newest of the
 *  three mode events wins) — a takeover is an EVENT, never a status on the case. */
const THREAD_MODE_COPY: Record<VisaThreadMode, { label: string; variant: 'neutral' | 'warning' | 'brand'; hint: string }> = {
  ai: {
    label: 'Assistant guiding',
    variant: 'neutral',
    hint: 'The AI wizard is walking the applicant through the five steps and posting the cards.',
  },
  human_requested: {
    label: 'Human help requested',
    variant: 'warning',
    hint: 'The applicant asked for a person. The wizard keeps running while they wait — take over to answer them yourself.',
  },
  admin: {
    label: 'You have taken over',
    variant: 'brand',
    hint: 'The wizard has stopped posting cards. Hand back when you are done and the applicant’s next action resumes it.',
  },
}

export default async function AdminVisaCasePage({ params }: { params: Promise<{ id: string }> }) {
  // The desk scope, for the same reason as the queue page — and here it also decides WHICH cases
  // resolve: a case outside the scope answers `not-found` below, never a 403, so a partner desk
  // cannot use this page to discover that another deployment's case exists.
  const scope = await getVisaDeskScope()
  if (!scope) return <AdminDenied />
  const { id } = await params

  const result = await loadVisaAdminCase(id, scope)
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

  // The chat this case is lived out in, and who is driving it. Both are reads: the thread
  // comes from Conversation.visaApplicationId (@unique, so at most one), and the mode is
  // derived from visa_events. Neither fails the page — a case filed through the dashboard
  // wizard has no thread at all, and getVisaThreadMode itself fails soft to 'ai'.
  const [thread, threadMode] = await Promise.all([
    findVisaThread(application.id).catch(() => null),
    getVisaThreadMode(application.id),
  ])
  const modeCopy = THREAD_MODE_COPY[threadMode] ?? THREAD_MODE_COPY.ai

  const imageDocuments = documents.filter((d) => IMAGE_KINDS.includes(d.kind))
  const otherDocuments = documents.filter((d) => !IMAGE_KINDS.includes(d.kind))
  // Sign once at SSR (6h, matching the admin dispute room) so previews survive a
  // long deliberation; a failed signature degrades to "preview unavailable".
  const signedUrls = new Map<string, string | null>(
    await Promise.all(documents.map(async (d) => [d.id, await signVisaDocumentUrl(d.storage_path)] as const)),
  )

  const codesOf = (d: VisaDocumentRow, field: 'issues' | 'warnings'): string[] => {
    const codes = d.validation_report?.[field]
    return Array.isArray(codes) ? codes.filter((i): i is string => typeof i === 'string') : []
  }
  const issuesOf = (d: VisaDocumentRow): string[] => codesOf(d, 'issues')
  // ⚠️ THE DESK IS THE SAFETY NET FOR THE DEMOTED CHECKS, SO IT HAS TO SEE THEM.
  //
  // On 2026-07-29 four portrait checks — background, clothing, centering, lighting — stopped
  // blocking the applicant, on the explicit basis that a human looks at the photo between payment
  // and submission. This page read only `issues`, so those four would have been invisible here:
  // the applicant would be waved through with an amber note, and the only person who could catch a
  // genuinely bad background would never have been shown it. That would make the promise on
  // /vietnam-evisa/rejected ("a person looks at the portrait again") false. Found in review.
  //
  // Passports have carried four advisory codes (glare, cropping, missing corners, unreadable MRZ)
  // since long before this, and they had never been rendered to anyone either — this fixes that
  // too, which is why the helper is by field rather than portrait-specific.
  const warningsOf = (d: VisaDocumentRow): string[] => codesOf(d, 'warnings')

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
          {/* hasResult renders the upload control as SPENT rather than offering a tap that
              can only 409 — one result per case, ever (owner 2026-07-23). */}
          <VisaCaseActions
            id={application.id}
            actions={VISA_ADMIN_ACTIONS[application.status] || []}
            hasResult={documents.some((d) => d.kind === 'result')}
          />
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

          {/* The case's CHAT — "if needed admin can take over chat but mostly ai should
              guide" (owner). The thread is the applicant's own conversation with the visa
              desk; this card is the way into it and the switch between the two drivers. */}
          <Card>
            <CardHeader><CardTitle>Applicant chat</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={modeCopy.variant}>{modeCopy.label}</Badge>
                {thread
                  ? <span className="font-mono text-xs text-muted-foreground">thread {thread.conversationId.slice(0, 8)}</span>
                  : null}
              </div>
              <p className="text-sm text-body">{modeCopy.hint}</p>
              {thread
                ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/messages/${thread.conversationId}`}>
                        <MessageSquare className="h-4 w-4" />Open chat
                      </Link>
                    </Button>
                    <VisaThreadTakeover id={application.id} mode={threadMode} />
                  </div>
                )
                : (
                  <p className="text-sm text-muted-foreground">
                    No chat thread is bound to this case — the applicant filed it from the dashboard wizard rather than from a message.
                  </p>
                )}
              {/* Said out loud because the link 404s for anyone else: the thread belongs to
                  the visa storefront's own account, and that is the account it opens as. */}
              <p className="text-xs text-ink-4">The chat opens as the visa desk account (the storefront owner), not as your personal inbox.</p>
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
                    const warnings = warningsOf(d)
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
                        {/* The advisory codes the applicant was NOT blocked on — this is the
                            operator's whole job on a demoted check. Amber, and labelled, so it
                            cannot be mistaken for the red list above: these did not stop anyone. */}
                        {warnings.length > 0 && (
                          <div className="border-t border-border px-8 py-3">
                            <p className="text-2xs font-bold uppercase tracking-wide text-body">Accepted with warnings — check these before submitting</p>
                            <ul className="mt-1 list-disc space-y-1 text-xs text-warning">
                              {warnings.map((warning) => <li key={warning}>{warning.replaceAll('_', ' ')}</li>)}
                            </ul>
                          </div>
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
