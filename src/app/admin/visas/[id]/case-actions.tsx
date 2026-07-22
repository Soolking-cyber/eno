'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Download, Headset, Loader2, Sparkles, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { transitionVisaStatus } from './actions'

// The case's status-transition buttons (the server computes which pairs apply
// from VISA_ADMIN_ACTIONS and passes them down — this component holds no
// workflow knowledge). The action re-validates admin + transition server-side;
// revalidatePath inside it refreshes this server-rendered page on success.
//
// The handover download sits in the SAME row and is always rendered — a case with no
// legal transitions left (approved / rejected / cancelled) is still one an agent may need
// the pack for, which is why this component no longer returns null on an empty `actions`.
export function VisaCaseActions({ id, actions, hasResult }: { id: string; actions: Array<[string, string]>; hasResult: boolean }) {
  const [pending, startTransition] = useTransition()
  return (
    <div className="flex flex-wrap gap-2">
      <VisaHandoverDownload id={id} />
      <VisaResultUpload id={id} hasResult={hasResult} />
      {actions.map(([status, label]) => (
        <Button
          key={status}
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => startTransition(async () => {
            const result = await transitionVisaStatus(id, status)
            if (result.ok) toast.success('Visa case updated')
            else toast.error(`Update failed: ${(result.error || 'unknown error').replaceAll('_', ' ')}`)
          })}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}

/** The server names the file (case reference + date, never applicant data). Re-derived
 *  defensively anyway: only a safe basename ever reaches an `a.download`. */
function filenameFrom(disposition: string | null, id: string): string {
  const quoted = disposition?.match(/filename="([^"]+)"/)?.[1] ?? ''
  const safe = quoted.replace(/[^A-Za-z0-9._-]/g, '')
  return /\.zip$/.test(safe) ? safe : `eno-visa-${id.slice(0, 8)}.zip`
}

/**
 * THE HANDOVER PACK — one zip per case, forwarded to the agent who files the application
 * ("we will send it further to agents to apply for us"). Two identity photos plus a
 * labelled spreadsheet of every answer; assembled on demand by
 * /api/visa/admin/applications/[id]/bundle, which is admin-gated, audits each download and
 * answers `no-store`.
 *
 * ⚠️ FETCHED, NOT LINKED. The button pulls the bytes and clicks a temporary object URL
 * rather than pointing an <a> at the endpoint, for two reasons: a failed download is a
 * TOAST here instead of a raw JSON error page in a new tab, and no URL that resolves to a
 * passport dossier is ever left sitting in the DOM or in the browser history.
 *
 * The object URL is revoked on a short timer, not immediately: revoking inside the same
 * task can abort the download in some browsers, and holding it forever would leave a
 * decrypted dossier alive in the tab for the rest of the session.
 */
function VisaHandoverDownload({ id }: { id: string }) {
  const [pending, setPending] = useState(false)

  const download = async () => {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(`/api/visa/admin/applications/${id}/bundle`, { cache: 'no-store' })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        toast.error(`Download failed: ${(data?.error || 'unknown error').replaceAll('_', ' ')}`)
        return
      }
      const url = URL.createObjectURL(await res.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filenameFrom(res.headers.get('content-disposition'), id)
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      toast.success('Handover pack downloaded')
    } catch {
      toast.error('Download failed: network error')
    } finally {
      setPending(false)
    }
  }

  return (
    <Button type="button" variant="cta" size="sm" disabled={pending} onClick={download}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      Download handover pack
    </Button>
  )
}

/**
 * THE FINISHED VISA — the desk's last action on a case.
 *
 * One POST does three things (/api/visa/admin/applications/[id]/result): stores the PDF in
 * the private bucket, posts the download card in the applicant's chat, and emails it to them
 * with the thank-you. The route re-checks admin itself; this page's gate proves nothing
 * about the caller of that endpoint.
 *
 * ⚠️ IT CAN ONLY EVER HAPPEN ONCE (owner: "should be hard cap on reuploads only 1 time
 * result can be uploaded by admin"). Once a result exists the control renders SPENT — a
 * disabled row with a tick, not a button that looks live and can only 409. Offering a tap
 * that cannot succeed is the specific thing the rule asks us not to do. The refusal still
 * exists underneath (the route checks before it stores, and a partial unique index decides
 * a double-click), so this is presentation, never the enforcement.
 *
 * ⚠️ NO REPLACE, NO OVERWRITE, and none may be added. A wrong PDF is fixed by an admin
 * deleting the visa_documents row and its storage object directly — see
 * scripts/visa-result-unique.mjs. That is why the file input accepts only PDFs and the
 * server re-checks the magic bytes: the moment of upload is the last moment anything can be
 * refused.
 *
 * ⚠️ It does NOT change the case status. Uploading is what unlocks the existing "approved"
 * transition (src/lib/visa-admin.ts refuses to approve a case with no result document);
 * the operator presses that separately, in the same row.
 */
function VisaResultUpload({ id, hasResult }: { id: string; hasResult: boolean }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState(false)

  if (hasResult) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-success/40 bg-success/10 px-3 py-1.5 text-xs font-bold text-success">
        <CheckCircle2 className="h-4 w-4" aria-hidden />
        Visa PDF delivered
      </span>
    )
  }

  const upload = async (file: File) => {
    if (pending) return
    setPending(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch(`/api/visa/admin/applications/${id}/result`, { method: 'POST', body })
      const data = (await res.json().catch(() => null)) as
        | { error?: string; card?: string; email?: string; audited?: boolean }
        | null
      if (!res.ok) {
        toast.error(`Upload failed: ${(data?.error || 'unknown error').replaceAll('_', ' ')}`)
        return
      }
      // The upload SUCCEEDED even if the card or the email did not — the route says which,
      // and the operator must be told rather than shown a flat "done". There is no retry
      // for the upload itself, so a half-landed delivery is a thing a human follows up.
      const missed = [
        data?.card === 'posted' ? null : 'chat card',
        data?.email === 'sent' ? null : `email (${(data?.email || 'unknown').replaceAll('_', ' ')})`,
      ].filter(Boolean)
      if (missed.length) toast.warning(`Visa stored, but ${missed.join(' and ')} did not go out`)
      else toast.success('Visa delivered — card posted and emailed')
      // The control is rendered from the server's document list; re-read it rather than
      // holding a second copy of "has a result" on the client.
      router.refresh()
    } catch {
      toast.error('Upload failed: network error')
    } finally {
      setPending(false)
      // Same file re-picked after a refusal must re-fire `change`.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      {/* A file input is the platform control for picking a file; Base UI ships no
          equivalent, and a hidden input driven by a real <Button> keeps the brand CTA. */}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        id={`visa-result-${id}`}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void upload(file)
        }}
      />
      <Button type="button" variant="cta" size="sm" disabled={pending} onClick={() => inputRef.current?.click()}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        Upload visa PDF
      </Button>
    </>
  )
}

/**
 * Who is driving the applicant's chat: the AI wizard, or a human at the desk.
 *
 * ⚠️ A TAKEOVER IS AN EVENT, NOT A STATUS. It writes visa_events
 * `admin_takeover_started` / `admin_takeover_ended`, and the mode is DERIVED from the
 * newest of those (src/lib/visa/dm-thread.ts, getVisaThreadMode) — there is no column, no
 * migration, and nothing here may add one. The case's own status workflow
 * (VISA_ADMIN_TRANSITIONS) is untouched by this control and must stay that way: "an admin
 * is typing in the thread" is not a stage of a government application.
 *
 * While the mode is 'admin' the wizard stops emitting cards, so the desk is not talked
 * over mid-sentence; handing back returns the thread to 'ai' and the applicant's next
 * action resumes the loop where it left off.
 *
 * The route is admin-gated on its own (getAdmin re-verifies with the auth server) — this
 * page's gate proves nothing about the caller of that endpoint.
 */
export function VisaThreadTakeover({ id, mode }: { id: string; mode: 'ai' | 'human_requested' | 'admin' }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const live = mode === 'admin'

  const toggle = async () => {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(`/api/visa/admin/applications/${id}/takeover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !live }),
      })
      const data = (await res.json().catch(() => null)) as { mode?: string; error?: string } | null
      if (!res.ok) {
        toast.error(`Takeover failed: ${(data?.error || 'unknown error').replaceAll('_', ' ')}`)
        return
      }
      toast.success(data?.mode === 'admin' ? 'You are driving this chat' : 'Handed back to the assistant')
      // The mode is rendered by the server component above — re-read it rather than
      // holding a second copy of the truth on the client.
      router.refresh()
    } catch {
      toast.error('Takeover failed: network error')
    } finally {
      setPending(false)
    }
  }

  return (
    <Button type="button" variant={live ? 'outline' : 'cta'} size="sm" disabled={pending} onClick={toggle}>
      {pending
        ? <Loader2 className="h-4 w-4 animate-spin" />
        : live ? <Sparkles className="h-4 w-4" /> : <Headset className="h-4 w-4" />}
      {live ? 'Hand back to assistant' : 'Take over chat'}
    </Button>
  )
}
