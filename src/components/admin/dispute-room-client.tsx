'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Clock, Loader2, Scale, Shield, Sparkles } from 'lucide-react'
import type { TargetInfo } from '@/lib/admin-reports'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

// Admin dispute room: shared thread + mediation composer + AI analysis + decision
// bar. Decisions call the SAME /api/admin/moderate actions as the triage queue —
// this surface adds the deliberation, not a second resolution engine.

type TimelineItem = {
  id: string
  kind: 'message' | 'system' | 'decision'
  role: 'reporter' | 'respondent' | 'admin' | 'system'
  body: string
  images: string[]
  at: string
}

type AiReview = {
  outcome: 'confirm' | 'dismiss' | 'abusive'
  severity: string | null
  confidence: number
  reasoning: string[]
  keyEvidence: { source: string; quote: string }[]
  counterpoints: string[]
  missing: string[]
  cached?: boolean
  analyzedAt?: string
}

export type AdminCase = {
  id: string
  reason: string
  detail: string | null
  severity: string | null
  status: string
  stage: 'evidence' | 'review' | 'decided'
  withdrawn: boolean
  appealed: boolean
  createdAt: string
  evidenceUntil: string | null
  resolvedBy: string | null
  resolvedAt: string | null
  decisionNote: string | null
  internalNote: string | null
  listingId: string | null
  conversationId: string | null
  reporter: { name: string; email: string | null; trustScore: number; strikes: number; sellerId: string | null } | null
  target: TargetInfo | null
  priorConfirmed: number
  timeline: TimelineItem[]
  ai: AiReview | null
}

const SEVERITIES = ['minor', 'moderate', 'severe'] as const

async function post(body: Record<string, unknown>) {
  const res = await fetch('/api/admin/moderate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(String((await res.json().catch(() => null))?.error || res.status))
  return res.json()
}

function timeLeft(iso: string | null): string | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return null
  const h = Math.floor(ms / 3_600_000)
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m`
}

export function DisputeRoomAdmin({ data }: { data: AdminCase }) {
  const router = useRouter()
  const [message, setMessage] = useState('')
  const [decisionNote, setDecisionNote] = useState('')
  const [severity, setSeverity] = useState(data.severity || 'moderate')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [ai, setAi] = useState<AiReview | null>(data.ai)
  const [aiBusy, setAiBusy] = useState(false)
  const [note, setNote] = useState(data.internalNote || '')
  const [noteSaved, setNoteSaved] = useState(false)

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action); setErr('')
    try {
      await post({ action, id: data.id, ...extra })
      router.refresh()
    } catch (e) {
      setErr(`Action failed: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  const sendMessage = async () => {
    const text = message.trim()
    if (!text) return
    setBusy('dispute-message'); setErr('')
    try {
      await post({ action: 'dispute-message', id: data.id, message: text })
      setMessage('')
      router.refresh()
    } catch (e) {
      setErr(`Send failed: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  const runAi = async (force: boolean) => {
    setAiBusy(true); setErr('')
    try {
      const res = await fetch('/api/admin/ai-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: data.id, force }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(res.status === 429 ? (d.message || 'Daily AI budget used up.') : res.status === 503 ? 'AI not configured on this deployment.' : 'AI analysis failed.')
        return
      }
      setAi(d as AiReview)
      if (d.severity) setSeverity(d.severity)
    } catch {
      setErr('AI analysis failed.')
    } finally {
      setAiBusy(false)
    }
  }

  const saveNote = async () => {
    setBusy('set-note')
    try {
      await post({ action: 'set-note', id: data.id, note })
      setNoteSaved(true); setTimeout(() => setNoteSaved(false), 1500)
    } catch (e) { setErr(`Note failed: ${(e as Error).message}`) } finally { setBusy(null) }
  }

  const left = data.stage === 'evidence' ? timeLeft(data.evidenceUntil) : null
  const open = data.status === 'open'

  return (
    <div>
      {/* ── Case header ── */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Scale className="h-5 w-5 text-accent-foreground" />
        <h1 className="h-title capitalize text-foreground">{data.reason}</h1>
        {open ? (
          data.stage === 'evidence'
            ? <Badge variant="neutral" size="md" className="text-accent-foreground"><Clock className="h-3 w-3" />evidence window{left ? ` · ${left} left` : ''}</Badge>
            : <Badge variant="warning" size="md" className="bg-warning/10">awaiting decision</Badge>
        ) : (
          <Badge variant="neutral" size="md" className={cn('capitalize', data.status === 'confirmed' ? 'text-success' : data.status === 'abusive' ? 'text-destructive' : 'text-ink-4')}>
            {data.withdrawn ? 'withdrawn by reporter' : `${data.status}${data.resolvedBy && !data.withdrawn ? ` by ${data.resolvedBy}` : ''}`}
          </Badge>
        )}
        {data.appealed && open && <Badge variant="warning" size="md" className="bg-warning/10">appeal</Badge>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Filed {new Date(data.createdAt).toLocaleString('en-GB')}
        {data.listingId && <> · <Link className="font-bold text-accent-foreground hover:underline" href={`/listings/${data.listingId}`}>listing</Link></>}
        {data.conversationId && <> · <Link className="font-bold text-accent-foreground hover:underline" href={`/admin/conversation/${data.conversationId}`}>conversation</Link></>}
      </p>

      {/* ── Party panels ── */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-3xs font-bold uppercase tracking-wide text-ink-4">Reporter</p>
          {data.reporter ? (
            <p className="mt-1 text-sm text-foreground">
              <span className="font-bold">{data.reporter.name}</span>
              {data.reporter.email && <span className="text-muted-foreground"> · {data.reporter.email}</span>}
              <br />
              <span className="text-xs text-muted-foreground">trust {data.reporter.trustScore}{data.reporter.strikes > 0 && <span className="font-bold text-destructive"> · {data.reporter.strikes} false-report strikes</span>}</span>
              {data.reporter.sellerId && <> · <Link className="text-xs font-bold text-accent-foreground hover:underline" href={`/sellers/${data.reporter.sellerId}`}>storefront</Link></>}
            </p>
          ) : <p className="mt-1 text-sm text-muted-foreground">Unknown / removed account</p>}
        </div>
        <div>
          <p className="text-3xs font-bold uppercase tracking-wide text-ink-4">Respondent</p>
          {data.target ? (
            <p className="mt-1 text-sm text-foreground">
              <span className="font-bold">{data.target.name}</span>
              {data.target.isGuest && <Badge variant="neutral" size="sm" className="ml-1.5 text-3xs">unreachable — no account</Badge>}
              <br />
              <span className="text-xs text-muted-foreground">
                {data.target.trustScore != null ? `trust ${data.target.trustScore} (${data.target.trustTier})` : 'no trust record'}
                {data.priorConfirmed > 0 && <span className="font-bold text-destructive"> · {data.priorConfirmed} prior confirmed</span>}
              </span>
              {data.target.sellerId && <> · <Link className="text-xs font-bold text-accent-foreground hover:underline" href={`/sellers/${data.target.sellerId}`}>storefront</Link></>}
            </p>
          ) : <p className="mt-1 text-sm text-muted-foreground">Unknown</p>}
        </div>
      </div>

      {/* ── AI analysis ── */}
      <div className="mt-6">
        {!ai ? (
          <Button
            variant="bare"
            size="none"
            onClick={() => runAi(false)}
            disabled={aiBusy}
            className="gap-1.5 bg-foreground px-4 py-2 text-xs font-bold text-background transition-opacity hover:opacity-90 disabled:opacity-60 cursor-pointer"
          >
            {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {aiBusy ? 'Reading the evidence…' : 'Analyze with AI'}
          </Button>
        ) : (
          <div className="rounded-2xl bg-tint/50 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-4 w-4 text-ink-4" />
              <span className="text-3xs font-bold uppercase tracking-wide text-ink-4">AI suggestion — you decide</span>
              <Badge
                variant={ai.outcome === 'confirm' ? 'destructive' : ai.outcome === 'abusive' ? 'warning' : 'neutral'}
                size="sm"
                className={cn('text-3xs',
                  ai.outcome === 'abusive' && 'bg-warning/10',
                  ai.outcome !== 'confirm' && ai.outcome !== 'abusive' && 'text-body')}
              >
                {ai.outcome === 'confirm' ? 'Confirm report' : ai.outcome === 'abusive' ? 'Abusive reporter' : 'Dismiss report'}{ai.severity ? ` · ${ai.severity}` : ''}
              </Badge>
              <span className="text-3xs text-ink-4">{Math.round(ai.confidence * 100)}% confidence{ai.analyzedAt ? ` · ${new Date(ai.analyzedAt).toLocaleString('en-GB')}` : ''}{ai.cached ? ' · cached' : ''}</span>
              <Button variant="soft" size="none" onClick={() => runAi(true)} disabled={aiBusy} className="ml-auto gap-1 rounded-lg px-2 py-1 text-3xs font-bold text-accent-foreground transition-colors disabled:opacity-60 cursor-pointer">
                {aiBusy && <Loader2 className="h-3 w-3 animate-spin" />} Re-analyze
              </Button>
            </div>
            {ai.reasoning.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-foreground">
                {ai.reasoning.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
            {ai.keyEvidence.length > 0 && (
              <div className="mt-2 space-y-1">
                {ai.keyEvidence.map((e, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    <Badge variant="neutral" size="sm" className="mr-1 rounded-lg px-1 text-3xs uppercase tracking-wide">{e.source.replace('_', ' ')}</Badge>
                    “{e.quote}”
                  </p>
                ))}
              </div>
            )}
            {ai.counterpoints.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground"><span className="font-bold text-ink-4">On the other hand:</span> {ai.counterpoints.join(' · ')}</p>
            )}
            {ai.missing.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground"><span className="font-bold text-ink-4">Missing:</span> {ai.missing.join(' · ')} — ask for it below or extend the window.</p>
            )}
            <p className="mt-2 text-3xs italic text-ink-4">AI can misread context — verify quotes in the thread before deciding.</p>
          </div>
        )}
      </div>

      {/* ── Thread ── */}
      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-ink-4">Case thread</h2>
      <div className="mt-3 space-y-4">
        {data.timeline.length === 0 && <p className="text-center text-sm text-ink-4">No statements yet.</p>}
        {data.timeline.map((item) => {
          if (item.kind === 'system' || item.kind === 'decision') {
            return (
              <div key={item.id} className="text-center">
                <Badge variant="neutral" size="md" className="px-3 font-semibold whitespace-normal text-body">
                  {item.kind === 'decision' ? `Decision: ${data.withdrawn ? 'withdrawn' : data.status}${item.body ? ` — ${item.body}` : ''}` : item.body}
                </Badge>
                <p className="mt-0.5 text-3xs text-ink-4">{new Date(item.at).toLocaleString('en-GB')}</p>
              </div>
            )
          }
          const fromReporter = item.role === 'reporter'
          const isAdmin = item.role === 'admin'
          const who = isAdmin ? 'eno.vn moderation' : fromReporter ? (data.reporter?.name ?? 'Reporter') : (data.target?.name ?? 'Respondent')
          return (
            <div key={item.id} className={cn('flex flex-col', fromReporter ? 'items-start' : isAdmin ? 'items-center' : 'items-end')}>
              <div className={cn('max-w-[85%] rounded-2xl px-3.5 py-2.5', isAdmin ? 'bg-accent' : fromReporter ? 'bg-tint' : 'bg-primary/10')}>
                {isAdmin && <p className="mb-1 flex items-center gap-1 text-2xs font-bold text-accent-foreground"><Shield className="h-3 w-3" /> eno.vn</p>}
                {item.body && <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{item.body}</p>}
                {item.images.length > 0 && (
                  <div className={cn('flex flex-wrap gap-2', item.body && 'mt-2')}>
                    {item.images.map((src, i) => (
                      <a key={i} href={src} target="_blank" rel="noreferrer" className="block h-28 w-28 overflow-hidden rounded-xl bg-background/50">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <span className="mt-0.5 px-1 text-3xs text-ink-4">{who} · {new Date(item.at).toLocaleString('en-GB')}</span>
            </div>
          )
        })}
      </div>

      {/* ── Mediation composer + window control ── */}
      <div className="mt-6">
        <Textarea
          size="compact"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Message both parties (visible in the case room, notified to both)…"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            variant="cta"
            size="none"
            onClick={sendMessage}
            disabled={busy !== null || !message.trim()}
            className="gap-1.5 px-4 py-2 text-xs disabled:opacity-40 cursor-pointer"
          >
            {busy === 'dispute-message' && <Loader2 className="size-4 animate-spin" />} Send to both parties
          </Button>
          {open && (
            <Button
              variant="soft"
              size="none"
              onClick={() => act('extend-window')}
              disabled={busy !== null}
              className="gap-1.5 px-3 py-2 text-xs font-bold text-accent-foreground transition-colors disabled:opacity-40 cursor-pointer"
            >
              {busy === 'extend-window' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clock className="h-3 w-3" />} Extend window +72h
            </Button>
          )}
        </div>
      </div>

      {/* ── Decision bar ── */}
      {open && (
        <div className="mt-8 rounded-2xl bg-tint/50 p-4">
          <p className="text-3xs font-bold uppercase tracking-wide text-ink-4">Decide the case</p>
          <Textarea
            size="compact"
            value={decisionNote}
            onChange={(e) => setDecisionNote(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Outcome note shown to BOTH parties (optional but recommended — say why)…"
            className="mt-2 bg-card"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Select value={severity} onValueChange={(v) => setSeverity(v as string)}>
              <SelectTrigger aria-label="Severity" className="h-auto rounded-xl border-0 bg-card py-2 pr-2.5 pl-3 text-xs font-bold text-foreground cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button
              variant="destructive"
              size="none"
              onClick={() => act('confirm-report', { severity, decisionNote })}
              disabled={busy !== null}
              className="gap-1.5 px-4 py-2 text-xs font-bold disabled:opacity-40 cursor-pointer"
            >
              {busy === 'confirm-report' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Confirm & penalize
            </Button>
            <Button
              variant="bare"
              size="none"
              onClick={() => act('dismiss-report', { decisionNote })}
              disabled={busy !== null}
              className="bg-card px-4 py-2 text-xs font-bold text-foreground transition-colors hover:bg-muted disabled:opacity-40 cursor-pointer"
            >
              {busy === 'dismiss-report' ? 'Working…' : 'Dismiss — no violation'}
            </Button>
            <Button
              variant="soft"
              size="none"
              onClick={() => act('abusive-report', { decisionNote })}
              disabled={busy !== null}
              className="px-4 py-2 text-xs font-bold text-warning transition-colors disabled:opacity-40 cursor-pointer"
            >
              {busy === 'abusive-report' ? 'Working…' : 'Abusive report'}
            </Button>
          </div>
          <p className="mt-2 text-2xs text-ink-4">
            Confirm docks the respondent&apos;s trust by the severity weight and pulls the listing · Dismiss closes with no action · Abusive penalizes the reporter. Both parties are notified either way.
          </p>
        </div>
      )}

      {/* ── Internal note (staff-only) ── */}
      <div className="mt-6">
        <p className="text-3xs font-bold uppercase tracking-wide text-ink-4">Internal note (never shown to users)</p>
        <Textarea
          size="compact"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={2000}
          aria-label="Internal note (never shown to users)"
          className="mt-1"
        />
        <Button
          variant="soft"
          size="none"
          onClick={saveNote}
          disabled={busy !== null}
          className="mt-1.5 px-3 py-1.5 text-xs font-bold text-accent-foreground transition-colors disabled:opacity-40 cursor-pointer"
        >
          {noteSaved ? 'Saved ✓' : busy === 'set-note' ? 'Saving…' : 'Save note'}
        </Button>
      </div>

      {err && <p role="alert" className="mt-4 text-sm font-semibold text-destructive">{err}</p>}
    </div>
  )
}
