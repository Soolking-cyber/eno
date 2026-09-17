'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { approveVerificationAction, rejectVerificationAction, signVerificationDocAction } from './actions'

// Admin review controls (EN-only admin chrome). Documents open through a freshly minted
// 10-minute signed URL (download disposition), never rendered inline. Approve is refused
// server-side unless Channel 1 is verified AND the seller's live identity still matches
// the frozen submission — the button just surfaces the result.

type Doc = { kind: string; path: string; mime: string }

const APPROVE_ERROR: Record<string, string> = {
  channel1_unverified: 'Cannot approve: the tax-registry check (Channel 1) is not verified. Fix the tax code / legal name first.',
  identity_moved: 'Cannot approve: the seller edited their identity after submitting. They must resubmit.',
  not_pending: 'This case is no longer pending (someone else acted, or it was resubmitted).',
  not_found: 'Case not found.',
  seller_gone: 'The seller record is gone.',
}

export function ReviewPanel({ caseId, status, channel1, legalName, documents }: {
  caseId: string
  status: string
  channel1: string
  legalName: string
  documents: Doc[]
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const decided = status !== 'pending'

  const openDoc = async (path: string) => {
    const preview = window.open('about:blank', '_blank')
    if (preview) preview.opener = null
    const res = await signVerificationDocAction(caseId, path)
    if ('url' in res) { if (preview) preview.location.href = res.url; else window.location.assign(res.url) }
    else { preview?.close(); toast.error('Could not open the document.') }
  }

  const approve = async () => {
    setBusy(true)
    try {
      const res = await approveVerificationAction(caseId)
      if (res.ok) { toast.success('Approved — badge granted.'); location.reload() }
      else toast.error(APPROVE_ERROR[res.error] ?? res.error)
    } finally { setBusy(false) }
  }

  const reject = async () => {
    if (!note.trim()) { toast.error('Give a rejection reason.'); return }
    setBusy(true)
    try {
      const res = await rejectVerificationAction(caseId, note)
      if (res.ok) { toast.success('Rejected.'); location.reload() }
      else toast.error(APPROVE_ERROR[res.error] ?? res.error)
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3 px-5 py-4">
        <p className="text-sm font-semibold text-foreground">Documents</p>
        {!documents.length && <p className="text-sm text-muted-foreground">No documents on this case.</p>}
        <div className="flex flex-wrap gap-2">
          {documents.map((d) => (
            <Button key={d.path} variant="outline" size="sm" onClick={() => void openDoc(d.path)} disabled={busy}>
              {d.kind} · {d.mime === 'application/pdf' ? 'PDF' : 'image'}
            </Button>
          ))}
        </div>
        <p className="text-xs text-ink-4">
          Bank check: confirm a bank document&apos;s account-holder name matches <span className="font-semibold text-foreground">{legalName || '—'}</span>.
          Then confirm the identity document. Both are the human half (Channel 2).
        </p>
      </Card>

      {!decided && (
        <Card className="space-y-3 px-5 py-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="cta" onClick={() => void approve()} disabled={busy || channel1 !== 'verified'}>
              Approve — grant badge
            </Button>
            <Button variant="destructive" onClick={() => void reject()} disabled={busy}>Reject</Button>
          </div>
          {channel1 !== 'verified' && (
            <p className="text-xs text-warning">Approve is blocked until Channel 1 (tax registry) is verified.</p>
          )}
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Rejection reason (shown to the seller)…"
            className="min-h-20"
          />
        </Card>
      )}
      {decided && <p className="text-sm text-muted-foreground">This case is {status}.</p>}
    </div>
  )
}
