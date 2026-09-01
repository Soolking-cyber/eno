'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { approveIdentityAction, rejectIdentityAction } from './actions'

/**
 * ONE CASE, WITH THE TWO CAPTURES AND THE TWO DECISIONS. EN-only admin chrome.
 *
 * ⛔ THE DOCUMENTS OPEN IN A NEW TAB, NEVER INLINE — same rule as the business queue next door. An
 * `<img src={signedUrl}>` puts a passport photograph into the page's own DOM, its cache and any
 * screenshot of the admin screen; opening it deliberately keeps the act of looking at someone's
 * document a separate, visible decision.
 *
 * ⚠️ `rel="noopener noreferrer"` IS LOAD-BEARING, NOT BOILERPLATE. codex flagged signed URLs as
 * bearer credentials: without `noreferrer` the destination receives the admin page's URL, and
 * `noopener` stops the opened tab reaching back through `window.opener`.
 */

const ERROR_TEXT: Record<string, string> = {
  not_pending: 'No longer pending — someone else already decided this one.',
  not_found: 'Case not found.',
  expired_at_review: 'Cannot approve: the document is inside the six-month validity floor measured from TODAY. It was valid at submission and is not now.',
  duplicate_identity: 'Cannot approve: this identity is already verified on another account.',
  still_pending: 'The decision did not stick — reload and try again.',
  failed: 'Something went wrong. Nothing was changed.',
}

export function IdentityReviewPanel({ item }: {
  item: {
    id: string
    tier: string
    fullName: string | null
    nationality: string | null
    documentExpiresAt: string | null
    submittedAt: string
    method: string
    documentUrl: string | null
    selfieUrl: string | null
    expectedNote: string
    checksPassed: string[]
  }
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const act = async (decision: 'approve' | 'reject') => {
    setBusy(true)
    try {
      const res = decision === 'approve'
        ? await approveIdentityAction(item.id)
        : await rejectIdentityAction(item.id, note)
      if (res.ok) {
        toast.success(res.status === 'verified' ? 'Approved.' : 'Rejected.')
        location.reload()
      } else {
        toast.error(ERROR_TEXT[res.code] ?? res.code)
      }
    } finally {
      setBusy(false)
    }
  }

  // ⚠️ TIER IS SHOWN FIRST AND IN WORDS. A reviewer who assumes every case is a passport will mark
  // a perfectly valid CCCD down for lacking an MRZ and a six-month expiry it never had.
  const tierLabel = item.tier === 'A' ? 'Tier A — Vietnamese CCCD' : 'Tier B — foreign passport'

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-foreground">{item.fullName || '(no name read)'}</p>
          <p className="text-xs text-muted-foreground">
            {tierLabel} · {item.nationality || 'nationality not read'} · submitted{' '}
            {new Date(item.submittedAt).toISOString().slice(0, 16).replace('T', ' ')}
          </p>
        </div>
        <Badge variant={item.tier === 'A' ? 'brand' : 'outline'}>{item.method}</Badge>
      </div>

      <dl className="grid gap-2 rounded-xl bg-tint p-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Document expires</dt>
          <dd className="font-medium">{item.documentExpiresAt?.slice(0, 10) ?? 'not read'}</dd>
        </div>
        <div>
          {/*
            ⛔ THE ONE THING THE REVIEWER IS ACTUALLY CHECKING BY EYE. The selfie must show this exact
            code written on paper and held by the person. It is what makes the pair of images harder
            to forge than either alone — a stolen passport photo cannot produce it.
          */}
          <dt className="text-xs text-muted-foreground">Code that must appear in the selfie</dt>
          <dd className="font-mono font-semibold tracking-widest">{item.expectedNote}</dd>
        </div>
      </dl>

      {item.checksPassed.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Automatic checks passed: {item.checksPassed.join(', ')}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {/*
          ⚠️ ABSENT LINKS ARE STATED, NOT HIDDEN. A missing capture is a case that cannot be judged;
          silently rendering one button instead of two would let a reviewer approve on half the
          evidence without noticing the other half was never there.
        */}
        {item.documentUrl ? (
          <Button variant="secondary" size="sm" asChild>
            <a href={item.documentUrl} target="_blank" rel="noopener noreferrer">Open document</a>
          </Button>
        ) : (
          <span className="text-xs text-destructive">Document image unavailable</span>
        )}
        {item.selfieUrl ? (
          <Button variant="secondary" size="sm" asChild>
            <a href={item.selfieUrl} target="_blank" rel="noopener noreferrer">Open selfie</a>
          </Button>
        ) : (
          <span className="text-xs text-destructive">Selfie unavailable</span>
        )}
      </div>

      <div className="space-y-2">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason — required to reject, recorded on the case"
          rows={2}
        />
        <div className="flex gap-2">
          {/*
            ⚠️ THE SERVER DECIDES, THE BUTTON ONLY REPORTS. Approve is refused server-side when the
            document is inside the validity floor measured from TODAY or the identity is already
            verified elsewhere — `reviewKycCase` re-runs the whole decision rather than reading back
            what submission concluded. Disabling on `!note` is a courtesy; the real rule is in
            `rejectIdentityAction`.
          */}
          <Button variant="cta" size="sm" disabled={busy} onClick={() => void act('approve')}>
            Approve
          </Button>
          <Button variant="outline" size="sm" disabled={busy || !note.trim()} onClick={() => void act('reject')}>
            Reject
          </Button>
        </div>
      </div>
    </Card>
  )
}
