'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { CircleStop, ExternalLink, Eye, FileText, Loader2, MonitorUp, RotateCcw, ShieldCheck, Upload } from 'lucide-react'
import { toast } from 'sonner'
import type { VisaApplication, VisaDocument } from '@/lib/visa/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { isAdminPrefillableStatus, isAdminReviewStatus } from '@/lib/visa/workflow'

type HostedSession = { id: string; liveViewUrl: string; expiresAt: string; warnings: string[]; persistentLogin: boolean }

const actions: Record<string, Array<[string, string]>> = {
  applicant_approval: [['under_review', 'Return to review'], ['needs_changes', 'Request changes']],
  ready_to_submit: [['applicant_approval', 'Refresh authorization'], ['submitted', 'Mark submitted'], ['payment_required', 'Payment required'], ['processing', 'Mark processing']],
  submitted: [['payment_required', 'Payment required'], ['processing', 'Mark processing'], ['needs_changes', 'Request changes'], ['rejected', 'Reject']],
  payment_required: [['submitted', 'Payment complete'], ['processing', 'Mark processing'], ['rejected', 'Reject']],
  processing: [['needs_changes', 'Action required'], ['rejected', 'Reject']],
}

const hidden = new Set(['schemaVersion', 'aiDocumentProcessingConsent', 'adminMessage'])

export function VisaAdminCase({ initialApplication }: { initialApplication: VisaApplication }) {
  const [application, setApplication] = useState(initialApplication)
  const [message, setMessage] = useState(application.payload?.adminMessage || '')
  const [registrationCode, setRegistrationCode] = useState(application.payload?.governmentRegistrationCode || '')
  const [governmentStatus, setGovernmentStatus] = useState(application.payload?.governmentApplicationStatus || '')
  const [busy, setBusy] = useState(false)
  const [hostedSession, setHostedSession] = useState<HostedSession | null>(null)
  const [hostedBrowserConfigured, setHostedBrowserConfigured] = useState<boolean | null>(null)
  const [persistentLoginConfigured, setPersistentLoginConfigured] = useState(false)
  const [documentUrls, setDocumentUrls] = useState<Record<string, string>>({})
  const [previewDocument, setPreviewDocument] = useState<VisaDocument | null>(null)

  useEffect(() => {
    if (!isAdminPrefillableStatus(application.status)) {
      setHostedSession(null)
      return
    }
    let cancelled = false
    void fetch(`/api/visa/admin/applications/${application.id}/prefill-session`, { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json()
        if (!cancelled && response.ok) {
          setHostedBrowserConfigured(result.configured)
          setPersistentLoginConfigured(Boolean(result.persistentLoginConfigured))
          setHostedSession(result.session)
        }
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [application.id, application.status])

  useEffect(() => {
    const imageDocuments = application.documents.filter((document) => ['passport', 'portrait'].includes(document.kind))
    if (!imageDocuments.length) return
    let cancelled = false
    void Promise.all(imageDocuments.map(async (document) => {
      const response = await fetch(`/api/visa/applications/${application.id}/documents/${document.id}`, { cache: 'no-store' })
      const result = await response.json()
      return response.ok && typeof result.url === 'string' ? [document.id, result.url] as const : null
    })).then((items) => {
      if (!cancelled) setDocumentUrls(Object.fromEntries(items.filter((item): item is readonly [string, string] => Boolean(item))))
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [application.documents, application.id])

  // Signed preview URLs expire (storage ttl 300s) — re-fetch a document's URL when
  // its <Image> errors so a case left open past 5 minutes recovers instead of showing
  // a broken preview. Per-document throttle guards against an error→refetch loop.
  const urlRefreshAt = useRef<Record<string, number>>({})
  const refreshDocumentUrl = (documentId: string) => {
    const last = urlRefreshAt.current[documentId] || 0
    if (Date.now() - last < 5000) return
    urlRefreshAt.current[documentId] = Date.now()
    void fetch(`/api/visa/applications/${application.id}/documents/${documentId}`, { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json()
        if (response.ok && typeof result.url === 'string') setDocumentUrls((previous) => ({ ...previous, [documentId]: result.url }))
      })
      .catch(() => undefined)
  }

  const refresh = async () => { const response = await fetch(`/api/visa/admin/applications/${application.id}`); const result = await response.json(); if (response.ok) setApplication(result.application) }
  const update = async (status?: string) => {
    setBusy(true)
    try {
      const response = await fetch(`/api/visa/admin/applications/${application.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, applicantMessage: message, governmentRegistrationCode: registrationCode, governmentApplicationStatus: governmentStatus }) })
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'update_failed'); setApplication(result.application); toast.success('Visa case updated')
    } catch (error) { toast.error((error as Error).message.replaceAll('_', ' ')) } finally { setBusy(false) }
  }
  const openDocument = async (document: VisaDocument) => { const preview = window.open('about:blank', '_blank'); if (preview) preview.opener = null; const response = await fetch(`/api/visa/applications/${application.id}/documents/${document.id}`); const result = await response.json(); if (!response.ok) { preview?.close(); return toast.error(result.error) } if (preview) preview.location.href = result.url; else window.location.assign(result.url) }
  const browserError = (code: string) => ({
    hosted_browser_not_configured: 'Add the Browserbase server credentials before launching the secure browser.',
    applicant_authorization_refresh_required: 'Return the case for fresh applicant authorization to use the disclosed hosted browser.',
    authorized_snapshot_changed: 'The approved answers changed. Return the case for applicant authorization.',
    verified_images_required: 'Both government-ready images must pass checking first.',
  })[code] || code.replaceAll('_', ' ')
  const prefill = async () => {
    setBusy(true)
    const liveWindow = window.open('about:blank', '_blank')
    if (liveWindow) {
      liveWindow.opener = null
      liveWindow.document.title = 'Preparing secure visa browser…'
      liveWindow.document.body.innerHTML = '<p style="font:16px system-ui;padding:32px">Preparing the secure visa browser and approved fields…</p>'
    }
    try {
      const response = await fetch(`/api/visa/admin/applications/${application.id}/prefill-session`, { method: 'POST' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setHostedBrowserConfigured(true)
      setPersistentLoginConfigured(Boolean(result.session?.persistentLogin))
      setHostedSession(result.session)
      if (liveWindow) liveWindow.location.replace(result.session.liveViewUrl)
      await refresh()
      toast.success(result.reused ? 'Secure browser resumed' : 'Official form prepared for review')
    }
    catch (error) { liveWindow?.close(); toast.error(browserError((error as Error).message)) } finally { setBusy(false) }
  }
  const releaseSession = async () => {
    if (!hostedSession) return
    setBusy(true)
    try {
      const response = await fetch(`/api/visa/admin/applications/${application.id}/prefill-session`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: hostedSession.id }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setHostedSession(null)
      toast.success('Secure browser session ended')
    } catch (error) { toast.error(browserError((error as Error).message)) } finally { setBusy(false) }
  }
  const uploadResult = async (file: File | null) => {
    if (!file) return; setBusy(true); const form = new FormData(); form.set('file', file)
    try { const response = await fetch(`/api/visa/admin/applications/${application.id}/result`, { method: 'POST', body: form }); const result = await response.json(); if (!response.ok) throw new Error(result.error); await refresh(); toast.success('Official PDF delivered to applicant') }
    catch (error) { toast.error((error as Error).message.replaceAll('_', ' ')) } finally { setBusy(false) }
  }
  const imageDocuments = application.documents.filter((document) => ['passport', 'portrait'].includes(document.kind))
  const otherDocuments = application.documents.filter((document) => !['passport', 'portrait'].includes(document.kind))
  const reviewing = isAdminReviewStatus(application.status)
  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-3xl font-bold tracking-tight">Visa case {application.id.slice(0, 8)}</h1><Badge variant={application.status === 'approved' ? 'success' : application.status === 'rejected' ? 'destructive' : 'neutral'} className="capitalize">{application.status.replaceAll('_', ' ')}</Badge></div><p className="mt-1 font-mono text-xs text-body">{application.id}</p></div><div className="flex flex-wrap gap-2">{(actions[application.status] || []).map(([status, label]) => <Button key={status} type="button" variant="outline" size="sm" disabled={busy} onClick={() => void update(status)}>{label}</Button>)}</div></div>
    <Card><CardHeader><CardTitle>Safety gate</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-3"><Info label="Applicant declaration" value={application.applicantConfirmedAt ? new Date(application.applicantConfirmedAt).toLocaleString() : 'Not confirmed'} /><Info label="Prefill authorization" value={application.authorizedAt ? new Date(application.authorizedAt).toLocaleString() : 'Not authorized'} /><Info label="Assigned admin" value={application.assignedAdmin || 'Unassigned'} /></CardContent></Card>
    <Card><CardHeader><CardTitle>Private documents</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">{imageDocuments.map((document) => {
        const url = documentUrls[document.id]
        return <article key={document.id} className="overflow-hidden rounded-2xl border border-line-strong bg-tint/40">
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3"><div><h3 className="font-bold capitalize text-foreground">{document.kind === 'passport' ? 'Passport data page' : 'Portrait photo'}</h3><p className="mt-0.5 text-xs text-body">{document.width && document.height ? `${document.width} × ${document.height}px · ` : ''}{Math.max(1, Math.round(document.sizeBytes / 1024))} KB</p></div><Badge variant={document.validationStatus === 'passed' ? 'success' : document.validationStatus === 'failed' ? 'destructive' : 'warning'}>{document.validationStatus || 'pending'}</Badge></div>
          <button type="button" disabled={!url} onClick={() => setPreviewDocument(document)} className="group relative flex h-72 w-full items-center justify-center overflow-hidden bg-white p-3 text-body disabled:cursor-wait lg:h-80" aria-label={`Enlarge ${document.kind} image`}>
            {url ? <><Image src={url} alt={`${document.kind} submitted by applicant`} fill unoptimized sizes="(min-width: 1024px) 40vw, 90vw" className="object-contain p-3" onError={() => refreshDocumentUrl(document.id)} /><span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-card/95 px-3 py-1.5 text-xs font-bold text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"><Eye className="h-3.5 w-3.5" />Enlarge here</span></> : <><Loader2 className="h-5 w-5 animate-spin" /><span className="ml-2 text-sm">Loading private preview…</span></>}
          </button>
          {document.validationReport?.issues?.length ? <ul className="list-disc space-y-1 border-t border-border px-8 py-3 text-xs text-destructive">{document.validationReport.issues.map((issue) => <li key={issue}>{issue.replaceAll('_', ' ')}</li>)}</ul> : null}
        </article>
      })}</div>
      {otherDocuments.length > 0 && <div className="flex flex-wrap gap-2">{otherDocuments.map((document) => <Button key={document.id} type="button" variant="outline" className="h-11" onClick={() => void openDocument(document)}><FileText className="h-4 w-4" />{document.kind}<ExternalLink className="h-3.5 w-3.5" /></Button>)}</div>}
    </CardContent></Card>
    {application.payload && <Card><CardHeader><CardTitle>Applicant-approved answers</CardTitle></CardHeader><CardContent><dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(application.payload).filter(([key]) => !hidden.has(key)).map(([key, value]) => <div key={key} className="min-w-0"><dt className="text-xs capitalize text-ink-4">{key.replace(/([A-Z])/g, ' $1')}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words text-sm font-semibold text-foreground">{String(value || '—')}</dd></div>)}</dl></CardContent></Card>}
    {reviewing && <Card className="border-brand/30"><CardHeader><CardTitle>Admin decision</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm leading-relaxed text-body">Compare the inline images with every applicant-approved answer. If they match, one action records your approval, opens the official form, uploads both images, and prefills matching fields.</p>
      <Textarea variant="outline" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Only explain what the applicant must correct. Do not copy passport details into this message." />
      {hostedBrowserConfigured === false && <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">Hosted browser credentials are not configured yet. Add <code>BROWSERBASE_API_KEY</code>, optional <code>BROWSERBASE_PROJECT_ID</code>, and a reusable <code>BROWSERBASE_CONTEXT_ID</code> to the forum Vercel project.</p>}
      <div className="flex flex-col gap-2 sm:flex-row"><Button type="button" variant="cta" className="h-11 sm:min-w-64" disabled={busy || hostedBrowserConfigured === false} onClick={() => void prefill()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Approve and open official form</Button><Button type="button" variant="outline" className="h-11 sm:min-w-44" disabled={busy || message.trim().length < 3} onClick={() => void update('needs_changes')}>Request changes</Button></div>
      <p className="text-xs leading-relaxed text-body">The applicant has already consented to this approved snapshot. Contact them only if something needs correction.</p>
    </CardContent></Card>}
    {!reviewing && <Card><CardHeader><CardTitle>Private applicant update</CardTitle></CardHeader><CardContent className="space-y-3"><Textarea variant="outline" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Explain missing information without copying passport data into this message." /><div className="grid gap-3 sm:grid-cols-2"><Input variant="outline" className="h-11 py-0" value={registrationCode} onChange={(event) => setRegistrationCode(event.target.value)} placeholder="Government registration code" /><Input variant="outline" className="h-11 py-0" value={governmentStatus} onChange={(event) => setGovernmentStatus(event.target.value)} placeholder="Government status" /></div><Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => void update()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save update</Button></CardContent></Card>}
    {application.status === 'ready_to_submit' && <Card><CardHeader><CardTitle>Secure hosted government form</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm leading-relaxed text-body">Launch from any secure modern computer browser—no repository, command, or preconfigured admin machine is required. eno opens a temporary Asia-region browser, uploads the approved images, and fills every matching structured field. Recording, session logs, and automatic CAPTCHA solving are disabled.</p>
      <p className="text-sm leading-relaxed text-body">Compare the visible official form with the approved answers, complete any flagged structured details, then personally handle declarations, CAPTCHA, payment, and final submission. If the official payment page offers a QR, scan it with MoMo on your phone. End the session when finished; it also expires automatically after 30 minutes.</p>
      {hostedBrowserConfigured === false && <p className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">Hosted browser credentials are not configured yet. Add <code>BROWSERBASE_API_KEY</code>, optional <code>BROWSERBASE_PROJECT_ID</code>, and a reusable <code>BROWSERBASE_CONTEXT_ID</code> to the forum Vercel project.</p>}
      {hostedBrowserConfigured && <p className="rounded-xl border border-line-strong bg-tint px-4 py-3 text-sm text-body">{persistentLoginConfigured ? 'Private official-site browser context enabled. Cookies and login state can continue across sessions; sign in again in the live browser if the authority expires them.' : 'This launches a fresh private browser. Add BROWSERBASE_CONTEXT_ID to reuse an official-site login after the operator signs in once.'}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="cta" className="h-11 sm:min-w-52" disabled={busy || hostedBrowserConfigured === false} onClick={() => void prefill()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : hostedSession ? <RotateCcw className="h-4 w-4" /> : <MonitorUp className="h-4 w-4" />}{hostedSession ? 'Resume secure browser' : 'Launch and prefill'}</Button>
        {hostedSession && <Button type="button" variant="outline" className="h-11 sm:min-w-52" disabled={busy} onClick={() => void releaseSession()}><CircleStop className="h-4 w-4" />End browser session</Button>}
      </div>
      {hostedSession && <div className="rounded-xl border border-line-strong bg-tint p-4 text-sm">
        <p className="font-semibold text-foreground">Live until approximately {new Date(hostedSession.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
        <button type="button" className="mt-1 inline-flex items-center gap-1 font-bold text-accent-foreground underline-offset-4 hover:underline" onClick={() => window.open(hostedSession.liveViewUrl, '_blank', 'noopener,noreferrer')}>Open live browser <ExternalLink className="h-3.5 w-3.5" /></button>
        {hostedSession.warnings.length > 0 && <div className="mt-3"><p className="font-semibold text-foreground">Manual checks from the current official form</p><ul className="mt-1 list-disc space-y-1 pl-5 text-body">{hostedSession.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
      </div>}
    </CardContent></Card>}
    {['submitted', 'payment_required', 'processing'].includes(application.status) && <Card><CardHeader><CardTitle>Deliver issued e-Visa</CardTitle></CardHeader><CardContent><label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-line-strong px-4 text-sm font-bold"><Upload className="h-4 w-4" />Upload official PDF<input type="file" accept="application/pdf" className="sr-only" disabled={busy} onChange={(event) => void uploadResult(event.target.files?.[0] || null)} /></label></CardContent></Card>}
    <Card><CardHeader><CardTitle>Audit trail</CardTitle></CardHeader><CardContent><ol className="space-y-3">{(application.events || []).map((event) => <li key={event.id} className="flex justify-between gap-4 text-sm"><span className="font-medium capitalize">{event.event.replaceAll('_', ' ')}</span><time className="shrink-0 text-xs text-ink-4">{new Date(event.createdAt).toLocaleString()}</time></li>)}</ol></CardContent></Card>
    <Dialog open={Boolean(previewDocument)} onOpenChange={(open) => { if (!open) setPreviewDocument(null) }}>
      <DialogContent className="h-[min(92dvh,900px)] max-w-6xl grid-rows-[auto_minmax(0,1fr)] p-4 sm:p-5">
        <DialogHeader><DialogTitle className="capitalize">{previewDocument?.kind === 'passport' ? 'Passport data page' : 'Portrait photo'}</DialogTitle><DialogDescription>Private same-page review. Compare this image with the applicant-approved answers before continuing.</DialogDescription></DialogHeader>
        <div className="relative min-h-0 overflow-hidden rounded-xl border border-line-strong bg-white">{previewDocument && documentUrls[previewDocument.id] ? <Image src={documentUrls[previewDocument.id]} alt={`${previewDocument.kind} submitted by applicant`} fill unoptimized sizes="95vw" className="object-contain p-3" onError={() => refreshDocumentUrl(previewDocument.id)} /> : <div className="flex h-full items-center justify-center text-sm text-body"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading private preview…</div>}</div>
      </DialogContent>
    </Dialog>
  </div>
}

function Info({ label, value }: { label: string; value: string }) { return <p><span className="block text-xs text-ink-4">{label}</span><span className="text-sm font-semibold">{value}</span></p> }
