'use client'

import { useState } from 'react'
import { Clipboard, ExternalLink, FileText, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import type { VisaPayload } from '@/lib/visa/schema'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type Document = { id: string; kind: string; mimeType: string; sizeBytes: number; width: number | null; height: number | null; createdAt: string }
type Event = { id: string; actorType: string; event: string; metadata: Record<string, unknown>; createdAt: string }
type Case = { id: string; status: string; payload?: VisaPayload; checklist: string[]; applicantConfirmedAt: string | null; authorizedAt: string | null; assignedAdmin: string | null; submittedAt: string | null; resolvedAt: string | null; createdAt: string; updatedAt: string; documents: Document[]; events?: Event[] }

const actions: Record<string, Array<[string, string]>> = {
  ready_for_review: [['under_review', 'Start review'], ['needs_changes', 'Request changes'], ['applicant_approval', 'Send final approval']],
  under_review: [['needs_changes', 'Request changes'], ['applicant_approval', 'Send final approval']],
  applicant_approval: [['under_review', 'Return to review'], ['needs_changes', 'Request changes']],
  ready_to_submit: [['submitted', 'Mark submitted'], ['payment_required', 'Payment required'], ['processing', 'Mark processing']],
  submitted: [['payment_required', 'Payment required'], ['processing', 'Mark processing'], ['needs_changes', 'Request changes'], ['rejected', 'Reject']],
  payment_required: [['submitted', 'Payment complete'], ['processing', 'Mark processing'], ['rejected', 'Reject']],
  processing: [['needs_changes', 'Action required'], ['rejected', 'Reject']],
}

const hidden = new Set(['schemaVersion', 'aiDocumentProcessingConsent', 'adminMessage'])

export function VisaAdminCase({ initialApplication }: { initialApplication: Case }) {
  const [application, setApplication] = useState(initialApplication)
  const [message, setMessage] = useState(application.payload?.adminMessage || '')
  const [registrationCode, setRegistrationCode] = useState(application.payload?.governmentRegistrationCode || '')
  const [governmentStatus, setGovernmentStatus] = useState(application.payload?.governmentApplicationStatus || '')
  const [busy, setBusy] = useState(false)
  const [command, setCommand] = useState('')

  const refresh = async () => { const response = await fetch(`/api/visa/admin/applications/${application.id}`); const result = await response.json(); if (response.ok) setApplication(result.application) }
  const update = async (status?: string) => {
    setBusy(true)
    try {
      const response = await fetch(`/api/visa/admin/applications/${application.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, applicantMessage: message, governmentRegistrationCode: registrationCode, governmentApplicationStatus: governmentStatus }) })
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'update_failed'); setApplication(result.application); toast.success('Visa case updated')
    } catch (error) { toast.error((error as Error).message.replaceAll('_', ' ')) } finally { setBusy(false) }
  }
  const openDocument = async (document: Document) => { const preview = window.open('about:blank', '_blank'); if (preview) preview.opener = null; const response = await fetch(`/api/visa/applications/${application.id}/documents/${document.id}`); const result = await response.json(); if (!response.ok) { preview?.close(); return toast.error(result.error) } if (preview) preview.location.href = result.url; else window.location.assign(result.url) }
  const prefill = async () => {
    setBusy(true)
    try { const response = await fetch(`/api/visa/admin/applications/${application.id}/prefill-session`, { method: 'POST' }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setCommand(result.command); await navigator.clipboard.writeText(result.command); toast.success('One-use command copied; expires in five minutes') }
    catch (error) { toast.error((error as Error).message.replaceAll('_', ' ')) } finally { setBusy(false) }
  }
  const uploadResult = async (file: File | null) => {
    if (!file) return; setBusy(true); const form = new FormData(); form.set('file', file)
    try { const response = await fetch(`/api/visa/admin/applications/${application.id}/result`, { method: 'POST', body: form }); const result = await response.json(); if (!response.ok) throw new Error(result.error); await refresh(); toast.success('Official PDF delivered to applicant') }
    catch (error) { toast.error((error as Error).message.replaceAll('_', ' ')) } finally { setBusy(false) }
  }
  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-3xl font-bold tracking-tight">Visa case {application.id.slice(0, 8)}</h1><Badge variant={application.status === 'approved' ? 'success' : application.status === 'rejected' ? 'destructive' : 'neutral'} className="capitalize">{application.status.replaceAll('_', ' ')}</Badge></div><p className="mt-1 font-mono text-xs text-body">{application.id}</p></div><div className="flex flex-wrap gap-2">{(actions[application.status] || []).map(([status, label]) => <Button key={status} type="button" variant="outline" size="sm" disabled={busy} onClick={() => void update(status)}>{label}</Button>)}</div></div>
    <Card><CardHeader><CardTitle>Safety gate</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-3"><Info label="Applicant declaration" value={application.applicantConfirmedAt ? new Date(application.applicantConfirmedAt).toLocaleString() : 'Not confirmed'} /><Info label="Prefill authorization" value={application.authorizedAt ? new Date(application.authorizedAt).toLocaleString() : 'Not authorized'} /><Info label="Assigned admin" value={application.assignedAdmin || 'Unassigned'} /></CardContent></Card>
    <Card><CardHeader><CardTitle>Private documents</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-2">{application.documents.map((document) => <Button key={document.id} type="button" variant="outline" className="h-11" onClick={() => void openDocument(document)}><FileText className="h-4 w-4" />{document.kind}<ExternalLink className="h-3.5 w-3.5" /></Button>)}</CardContent></Card>
    {application.payload && <Card><CardHeader><CardTitle>Applicant-approved answers</CardTitle></CardHeader><CardContent><dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(application.payload).filter(([key]) => !hidden.has(key)).map(([key, value]) => <div key={key} className="min-w-0"><dt className="text-xs capitalize text-ink-4">{key.replace(/([A-Z])/g, ' $1')}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words text-sm font-semibold text-foreground">{String(value || '—')}</dd></div>)}</dl></CardContent></Card>}
    <Card><CardHeader><CardTitle>Private applicant update</CardTitle></CardHeader><CardContent className="space-y-3"><Textarea variant="outline" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Explain missing information without copying passport data into this message." /><div className="grid gap-3 sm:grid-cols-2"><Input variant="outline" className="h-11 py-0" value={registrationCode} onChange={(event) => setRegistrationCode(event.target.value)} placeholder="Government registration code" /><Input variant="outline" className="h-11 py-0" value={governmentStatus} onChange={(event) => setGovernmentStatus(event.target.value)} placeholder="Government status" /></div><Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => void update()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save update</Button></CardContent></Card>
    {application.status === 'ready_to_submit' && <Card><CardHeader><CardTitle>Review-first browser prefill</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-body">Creates one single-use five-minute handoff. The visible browser fills known fields and then stops before declaration, Next, CAPTCHA, payment, and submission.</p><Button type="button" variant="cta" className="h-11" disabled={busy} onClick={() => void prefill()}><Clipboard className="h-4 w-4" />Create and copy command</Button>{command && <code className="block overflow-x-auto rounded-xl bg-tint p-3 text-xs">{command}</code>}</CardContent></Card>}
    {['submitted', 'payment_required', 'processing'].includes(application.status) && <Card><CardHeader><CardTitle>Deliver issued e-Visa</CardTitle></CardHeader><CardContent><label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-line-strong px-4 text-sm font-bold"><Upload className="h-4 w-4" />Upload official PDF<input type="file" accept="application/pdf" className="sr-only" disabled={busy} onChange={(event) => void uploadResult(event.target.files?.[0] || null)} /></label></CardContent></Card>}
    <Card><CardHeader><CardTitle>Audit trail</CardTitle></CardHeader><CardContent><ol className="space-y-3">{(application.events || []).map((event) => <li key={event.id} className="flex justify-between gap-4 text-sm"><span className="font-medium capitalize">{event.event.replaceAll('_', ' ')}</span><time className="shrink-0 text-xs text-ink-4">{new Date(event.createdAt).toLocaleString()}</time></li>)}</ol></CardContent></Card>
  </div>
}

function Info({ label, value }: { label: string; value: string }) { return <p><span className="block text-xs text-ink-4">{label}</span><span className="text-sm font-semibold">{value}</span></p> }
