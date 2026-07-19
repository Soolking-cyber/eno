'use client'

import { useState, useEffect, useRef, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Image from 'next/image'
import { X, Loader2, ExternalLink, MessageSquare, ChevronDown, StickyNote, Users, ShieldQuestion, MoreHorizontal, Sparkles , Scale } from 'lucide-react'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { MOD_MACROS } from '@/lib/admin-macros'
import type { TargetInfo } from '@/lib/admin-reports'
import { shortDate } from '@/lib/dates'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/ui/empty-state'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'

export type Reporter = {
  id: string
  name: string
  email: string | null
  trustScore: number
  strikes: number
  sellerId: string | null
}

// One report = one CASE in the triaged inbox.
export type ModCase = {
  id: string
  reason: string
  detail: string | null
  severity: string | null
  createdAt: string
  ageDays: number
  bucket: 'critical' | 'high' | 'standard'
  priority: number
  // Phase 3 reporter ladder: filed by a ≥2-strike reporter — triaged LAST, never dropped.
  preScreen?: boolean
  reporter: Reporter | null
  conversationId: string | null
  communityCount: number
  target: TargetInfo
  internalNote: string | null
  // The reported party's formal reply (buyer-king SLA) — shown as evidence on the card.
  sellerResponse: string | null
  sellerRespondedAt: string | null
  appeal?: { note: string | null; images: string[]; at: string } | null
  resolution?: { status: string; by: string | null; at: string | null } | null
}

const REASON_LABEL: Record<string, string> = {
  scam: 'Scam', counterfeit: 'Counterfeit', sold: 'Already sold', 'wrong-info': 'Wrong info',
  duplicate: 'Duplicate', offensive: 'Offensive / harassment', other: 'Other',
  prohibited: 'Prohibited item (AI)', // auto-filed by AI content-safety; listing already hidden
  stolen_photos: 'Stolen photos (cross-app)', // auto-filed on a cross-seller image match; listing hidden
}
const PENALTY: Record<string, number> = { minor: -3, moderate: -10, severe: -25 }
const SEVERITIES = ['minor', 'moderate', 'severe'] as const

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch('/api/admin/moderate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error('action failed')
  // The API returns counts on bulk actions (confirmed/dismissed/skipped) — surface
  // them to callers instead of discarding the body. Fail-soft on an empty body.
  return res.json().catch(() => ({}))
}
const askedAgo = (iso: string) => {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  return h < 1 ? 'under 1h ago' : h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'destructive' | 'outline'

function TierChip({ tier, score }: { tier: string | null; score: number | null }) {
  if (score == null) return null
  const variant: BadgeVariant = tier === 'restricted' ? 'destructive'
    : tier === 'trusted' ? 'brand'
    : tier === 'exceptional' ? 'warning'
    : 'neutral'
  return <Badge variant={variant} size="sm" className="px-1.5 text-3xs">trust {score}{tier && tier !== 'standard' ? ` · ${tier}` : ''}</Badge>
}

function NoteEditor({ caseId, initial, onSaved }: { caseId: string; initial: string | null; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(initial || '')
  const [saving, setSaving] = useState(false)
  const dirty = text !== (initial || '')
  const save = async () => { setSaving(true); try { await post({ action: 'set-note', id: caseId, note: text }); onSaved() } catch { toast.error('Saving the note failed — try again.') } finally { setSaving(false) } }
  if (!open) {
    return (
      <Button variant="bare" size="none" onClick={(e) => { e.stopPropagation(); setOpen(true) }} className="gap-1 whitespace-normal text-3xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer">
        <StickyNote className="h-3 w-3" /> {initial ? 'Internal note ✓' : 'Add internal note'}
      </Button>
    )
  }
  return (
    <div className="w-full rounded-lg border border-border bg-tint/40 p-2" onClick={(e) => e.stopPropagation()}> {/* design-lint-allow */}
      <p className="mb-1 text-3xs font-semibold text-muted-foreground">Internal note (staff-only, never shown to users)</p>
      <Textarea variant="outline" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} aria-label="Internal note (staff-only, never shown to users)" className="min-h-0 resize-none px-2 py-1.5 text-xs" />
      <div className="mt-1.5 flex items-center gap-1.5">
        <Button size="none" onClick={save} disabled={saving || !dirty} className="gap-1 rounded-lg bg-foreground px-2.5 py-1 text-3xs font-bold text-background hover:bg-foreground hover:opacity-90 disabled:opacity-40 cursor-pointer">{saving ? <Loader2 className="size-3 animate-spin" /> : null} Save note</Button>
        <Button size="none" variant="ghost" onClick={() => { setText(initial || ''); setOpen(false) }} className="rounded-lg px-2 py-1 text-3xs font-bold text-muted-foreground hover:bg-muted hover:text-muted-foreground cursor-pointer">Close</Button>
      </div>
    </div>
  )
}

// Send a PRE-PREPARED macro (no free text). The recipient gets it in their language
// (server localizes via Profile.locale). Picking a macro sends it. Lives inside the
// "More" menu as a submenu — the trigger label carries the sending/sent state.
function MacroSender({ recipientId, label, listingId, conversationId }: { recipientId: string; label: string; listingId?: string | null; conversationId?: string | null }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const send = async (key: string) => {
    // In-flight guard — the submenu stays open (closeOnClick=false), so without
    // this a second macro click mid-send fires a second admin message.
    if (!key || state !== 'idle') return
    setState('sending')
    try {
      const res = await fetch('/api/admin/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipientId, macroKey: key, listingId, conversationId }) })
      if (res.ok) { setState('sent'); setTimeout(() => setState('idle'), 1800) } else setState('idle')
    } catch { setState('idle') }
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={state === 'sending'} className="text-2xs font-bold cursor-pointer data-disabled:opacity-50">
        {state === 'sending' && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
        {state === 'sent' ? `Sent to ${label} ✓` : state === 'sending' ? 'Sending…' : `Notify ${label}…`}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64">
        {MOD_MACROS.map((m) => <DropdownMenuItem key={m.key} closeOnClick={false} onClick={() => send(m.key)} className="text-2xs cursor-pointer">{m.label}</DropdownMenuItem>)}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

// Penalty picker — picking a severity only pre-selects it; the penalty applies on Confirm.
function SeverityMenu({ value, onPick }: { value: string; onPick: (s: string) => void }) {
  return (
    <span className="inline-block" onClick={(e) => e.stopPropagation()}> {/* design-lint-allow */}
      <DropdownMenu>
        <DropdownMenuTrigger title="Penalty applied on Confirm" className="inline-flex items-center gap-1 rounded-lg border border-line-strong px-2 py-1 text-2xs font-bold capitalize text-foreground hover:bg-muted cursor-pointer">
          {value} {PENALTY[value]} <ChevronDown className="h-3 w-3 text-ink-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40 p-1.5">
          {SEVERITIES.map((sv) => (
            <DropdownMenuItem key={sv} onClick={() => onPick(sv)} className={cn('justify-between text-2xs font-bold capitalize cursor-pointer', sv === value && 'bg-primary text-white focus:bg-primary focus:text-white')}>
              {sv} <span className={sv === value ? '' : 'text-ink-4'}>{PENALTY[sv]}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}

// Overflow menu for secondary actions (delete listing, notify, dismiss-all). Keeps the
// decision surface at exactly three buttons — everything else lives behind one "More".
function MoreMenu({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block" onClick={(e) => e.stopPropagation()}> {/* design-lint-allow */}
      <DropdownMenu>
        <DropdownMenuTrigger title="More actions" className="inline-flex items-center gap-1 rounded-lg border border-line-strong px-2 py-1 text-2xs font-semibold text-muted-foreground hover:bg-muted cursor-pointer">
          <MoreHorizontal className="h-3.5 w-3.5" /> More
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 p-1.5">
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}

// ── AI-assisted dispute review ────────────────────────────────────────────────
// Gemini reads the actual evidence (chat, listing, images, seller reply, trust
// history) and suggests an outcome with cited reasoning. Strictly ADVISORY: the
// panel never submits a decision — "Use suggestion" only pre-selects severity and
// highlights the matching button; the admin still clicks it.
export type AiReview = {
  outcome: 'confirm' | 'dismiss' | 'abusive'
  severity: 'minor' | 'moderate' | 'severe' | null
  confidence: number
  reasoning: string[]
  keyEvidence: { source: string; quote: string }[]
  counterpoints: string[]
  missing: string[]
}

const AI_OUTCOME_VARIANT: Record<AiReview['outcome'], BadgeVariant> = {
  confirm: 'destructive',
  dismiss: 'neutral',
  abusive: 'warning',
}
const AI_OUTCOME_LABEL: Record<AiReview['outcome'], string> = { confirm: 'Confirm report', dismiss: 'Dismiss report', abusive: 'Abusive reporter' }

function AiReviewPanel({ caseId, internalNote, onUse, refresh }: {
  caseId: string; internalNote: string | null
  onUse: (r: AiReview) => void
  refresh: () => void
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [review, setReview] = useState<AiReview | null>(null)
  const [err, setErr] = useState('')
  const [noteState, setNoteState] = useState<'idle' | 'saving' | 'saved'>('idle')

  const run = async () => {
    setState('loading')
    try {
      const res = await fetch('/api/admin/ai-review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportId: caseId }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(res.status === 429 ? (data.message || 'Daily AI review budget is used up — try again tomorrow.')
          : res.status === 503 ? 'AI is not configured on this deployment.'
          : 'AI review failed — try again.')
        setState('error')
        return
      }
      setReview(data as AiReview)
      setState('done')
    } catch {
      setErr('AI review failed — try again.')
      setState('error')
    }
  }

  // Audit trail: append a one-line summary of the AI's suggestion to the case's
  // internal note (the panel itself is ephemeral — nothing persists unless saved).
  const saveNote = async () => {
    if (!review || noteState !== 'idle') return
    setNoteState('saving')
    const d = new Date()
    const stamp = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
    const line = `[AI ${stamp}] ${review.outcome} (${Math.round(review.confidence * 100)}%)${review.reasoning[0] ? ` — ${review.reasoning[0]}` : ''}`
    try {
      // append-note is ATOMIC server-side (audit P2) — the old client-side concat from
      // the internalNote PROP overwrote concurrent NoteEditor / second-admin saves.
      await post({ action: 'append-note', id: caseId, note: line })
      setNoteState('saved')
      refresh()
    } catch { setNoteState('idle') }
  }

  if (state === 'idle' || state === 'loading' || state === 'error') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="none" variant="ghost" onClick={run} disabled={state === 'loading'} className="gap-1 rounded-lg border border-line-strong px-2.5 py-1 text-2xs font-semibold text-foreground hover:bg-muted hover:text-accent-foreground disabled:opacity-60 cursor-pointer">
          {state === 'loading' ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
          {state === 'loading' ? 'Reading the evidence…' : 'AI review'}
        </Button>
        {/* The AI run failed / was budget-capped — a whole-action outcome, so it is
            ANNOUNCED (role="alert"). Admin chrome is EN-only by convention. */}
        {state === 'error' && <span role="alert" className="text-2xs font-semibold text-warning">{err}</span>}
      </div>
    )
  }

  if (!review) return null
  return (
    <div className="rounded-lg border border-border bg-tint/40 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-ink-4" />
        <span className="text-3xs font-bold uppercase tracking-wide text-ink-4">AI suggestion — you decide</span>
        <Badge variant={AI_OUTCOME_VARIANT[review.outcome]} size="sm" className="px-2 text-3xs">{AI_OUTCOME_LABEL[review.outcome]}{review.severity ? ` · ${review.severity}` : ''}</Badge>
        <span className="text-3xs text-ink-4">{Math.round(review.confidence * 100)}% confidence</span>
      </div>
      {review.reasoning.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-foreground">
          {review.reasoning.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
      {review.keyEvidence.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {review.keyEvidence.map((e, i) => (
            <p key={i} className="text-2xs text-muted-foreground">
              <span className="mr-1 rounded-lg bg-tint px-1 py-0.5 text-3xs font-bold uppercase tracking-wide text-ink-4">{e.source.replace('_', ' ')}</span>
              “{e.quote}”
            </p>
          ))}
        </div>
      )}
      {review.counterpoints.length > 0 && (
        <div className="mt-1.5">
          <p className="text-3xs font-bold uppercase tracking-wide text-ink-4">On the other hand</p>
          <ul className="list-disc space-y-0.5 pl-4 text-2xs text-muted-foreground">
            {review.counterpoints.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
      {review.missing.length > 0 && <p className="mt-1.5 text-2xs text-muted-foreground"><span className="font-bold text-ink-4">Missing:</span> {review.missing.join(' · ')}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button size="none" onClick={() => onUse(review)} className="rounded-lg bg-foreground px-2.5 py-1 text-3xs font-bold text-background hover:bg-foreground hover:opacity-90 cursor-pointer">Use suggestion</Button>
        <Button size="none" variant="ghost" onClick={saveNote} disabled={noteState !== 'idle'} className="gap-1 rounded-lg border border-line-strong px-2.5 py-1 text-3xs font-bold text-foreground hover:bg-muted hover:text-foreground disabled:opacity-60 cursor-pointer">
          {noteState === 'saving' && <Loader2 className="size-3 animate-spin" />}
          {noteState === 'saved' ? 'Saved to case notes ✓' : 'Save to case notes'}
        </Button>
      </div>
      <p className="mt-1.5 text-3xs italic text-ink-4">AI can misread context — verify quotes in the conversation before confirming.</p>
    </div>
  )
}

const RAIL = { critical: 'border-l-destructive', high: 'border-l-warning', standard: 'border-l-line-strong' }

function CaseCard({ c, selected, busy, severity, readOnly, checked, onCheck, onSeverity, onSelect, onAction, onListing, onDismissTarget, refresh }: {
  c: ModCase; selected: boolean; busy: boolean; severity: string; readOnly?: boolean
  checked?: boolean; onCheck?: () => void
  onSeverity: (id: string, s: string) => void
  onSelect: () => void
  onAction: (action: string, id: string, severity?: string) => void
  onListing: (action: string, listingId: string) => void
  onDismissTarget: (id: string) => void
  refresh: () => void
}) {
  const t = c.target
  const isListing = t.kind === 'listing' && t.listing
  const { lang } = useLanguage() // admin chrome stays English; amounts follow the viewer's language
  // "Use suggestion" pre-selects the AI's severity + focuses/highlights the matching
  // decision button — it NEVER submits. The admin makes the final call.
  const decisionRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [aiFocus, setAiFocus] = useState<AiReview['outcome'] | null>(null)
  const useSuggestion = (r: AiReview) => {
    if (r.outcome === 'confirm' && r.severity && PENALTY[r.severity]) onSeverity(c.id, r.severity)
    setAiFocus(r.outcome)
    decisionRefs.current[r.outcome]?.focus()
  }
  const msgTargets = [
    c.reporter ? { recipientId: c.reporter.id, label: `reporter (${c.reporter.name})` } : null,
    t.profileId ? { recipientId: t.profileId, label: `${t.kind === 'listing' ? 'seller' : 'user'} (${t.name})` } : null,
  ].filter((x): x is { recipientId: string; label: string } => x !== null).filter((x, i, a) => a.findIndex((y) => y.recipientId === x.recipientId) === i)

  return (
    <Card onClick={onSelect} className={cn('cursor-pointer gap-0 border-l-[3px] px-4 shadow-pop transition-shadow', RAIL[c.bucket], selected && !readOnly && 'ring-2 ring-brand/40', readOnly && 'opacity-90')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {!readOnly && onCheck && <Checkbox checked={!!checked} onClick={(e) => e.stopPropagation()} onChange={onCheck} className="h-3.5 w-3.5" aria-label="Select case" />}
          {c.appeal && <Badge variant="warning" size="sm" className="px-1.5 text-3xs uppercase tracking-wide">Appeal</Badge>}
          {c.bucket === 'critical' && !c.appeal && !readOnly && <Badge variant="destructive" size="sm" className="px-1.5 text-3xs uppercase tracking-wide">Critical</Badge>}
          {c.preScreen && !readOnly && <Badge variant="neutral" size="sm" className="px-1.5 text-3xs uppercase tracking-wide" title="Filed by a reporter with 2+ false-report strikes — triaged last">Pre-screened</Badge>}
          <span className="text-sm font-bold text-foreground">{REASON_LABEL[c.reason] || c.reason}</span>
          {c.communityCount > 1 && !readOnly && <Badge variant="warning" size="sm" className="text-3xs">{c.communityCount} on this target</Badge>}
          <Badge variant="neutral" size="sm" className="text-3xs font-semibold capitalize">{t.kind}</Badge>
        </div>
        <span className="shrink-0 text-2xs text-ink-4">{c.ageDays <= 0 ? 'today' : `${c.ageDays}d ago`}</span>
      </div>

      <div className="mt-2 flex gap-3">
        {isListing && (
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-tint">
            {t.listing!.image ? <Image src={t.listing!.image} alt="" fill sizes="64px" className="object-cover" /> : <div className="flex h-full w-full items-center justify-center text-3xs text-ink-4">No image</div>}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {isListing ? (
            <>
              <a href={`/listings/${t.listing!.id}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 truncate text-sm font-bold text-foreground hover:text-accent-foreground"><span className="truncate">{t.listing!.title}</span><ExternalLink className="h-3 w-3 shrink-0 opacity-50" /></a>
              <p className="mt-0.5 text-xs font-semibold text-accent-foreground">{formatMoneyFull(t.listing!.price, t.listing!.currency, moneyLocale(lang))}</p>
              <p className="truncate text-2xs text-muted-foreground">{t.listing!.category} · {t.listing!.location}</p>
            </>
          ) : (
            <p className="text-sm font-bold text-foreground">{t.kind === 'chat' ? 'Reported conversation' : 'Reported account'}</p>
          )}
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
            <span>Target:</span>
            {t.sellerId ? <a href={`/sellers/${t.sellerId}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold text-foreground hover:underline">{t.name}</a> : <span className="font-semibold text-foreground">{t.name}</span>}
            <TierChip tier={t.trustTier} score={t.trustScore} />
            {t.isGuest && <span className="italic text-ink-4">guest — unreachable</span>}
          </p>
        </div>
      </div>

      {c.detail && <p className="mt-2 text-xs text-foreground">“{c.detail}”</p>}

      {/* The reported party's formal reply (buyer-king SLA) — evidence BEFORE decision.
          One-shot dispute replies set sellerRespondedAt (not sellerResponse — the text
          lives as their thread statement), so a stamped time = replied in the room.
          No reply + reachable target → show the running SLA clock instead. */}
      {(c.sellerResponse || c.sellerRespondedAt || (!readOnly && t.profileId)) && (
        <div className="mt-2 rounded-lg border border-border bg-tint/40 px-2 py-1.5">
          {c.sellerResponse ? (
            <>
              <p className="text-3xs font-bold uppercase tracking-wide text-ink-4">{t.kind === 'listing' ? 'Seller' : 'Reported party'} reply{c.sellerRespondedAt ? ` · ${shortDate(c.sellerRespondedAt)}` : ''}</p>
              <p className="mt-0.5 text-xs text-foreground">“{c.sellerResponse}”</p>
            </>
          ) : c.sellerRespondedAt ? (
            <p className="text-2xs font-semibold text-body">{t.kind === 'listing' ? 'Seller' : 'Reported party'} replied in the dispute room · {shortDate(c.sellerRespondedAt)} — open the case to read it.</p>
          ) : (
            <p className="text-2xs italic text-muted-foreground">No reply from the {t.kind === 'listing' ? 'seller' : 'reported party'} yet · asked {askedAgo(c.createdAt)}</p>
          )}
        </div>
      )}

      {/* Appeal: the target's explanation + proof, shown prominently. */}
      {c.appeal && (
        <div className="mt-2 rounded-lg border border-warning/40 bg-warning/10 p-2">
          <p className="text-3xs font-bold uppercase tracking-wide text-warning">Appeal · {shortDate(c.appeal.at)}</p>
          {c.appeal.note && <p className="mt-0.5 text-xs text-foreground">{c.appeal.note}</p>}
          {c.appeal.images.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {c.appeal.images.map((src, i) => (
                <a key={i} href={src} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="relative block h-14 w-14 overflow-hidden rounded-lg bg-tint">
                  <img src={src} alt="proof" className="h-full w-full object-cover" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
        {c.reporter ? (
          <span>By {c.reporter.sellerId ? <a href={`/sellers/${c.reporter.sellerId}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold text-foreground hover:underline">{c.reporter.name}</a> : <span className="font-semibold text-foreground">{c.reporter.name}</span>}<span className="text-ink-4"> · trust {c.reporter.trustScore}</span>{c.reporter.strikes > 0 && <span className="font-semibold text-warning"> · {c.reporter.strikes} false-report strike{c.reporter.strikes > 1 ? 's' : ''}</span>}</span>
        ) : <span className="italic">reporter account removed</span>}
        {c.conversationId && <a href={`/admin/conversation/${c.conversationId}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline"><MessageSquare className="h-3 w-3" /> View conversation</a>}
        {/* The full case room: thread + evidence + AI + decision, one case per page. */}
        <a href={`/admin/disputes/${c.id}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline"><Scale className="h-3 w-3" /> Dispute room</a>
      </div>

      {readOnly ? (
        <div className="mt-2 border-t border-border pt-2 text-2xs text-muted-foreground">
          <span className={cn('font-bold', c.resolution?.status === 'confirmed' ? 'text-destructive' : c.resolution?.status === 'abusive' ? 'text-warning' : 'text-foreground')}>{c.resolution?.status}</span>
          {c.resolution?.by ? ` · by ${c.resolution.by}` : ''}{c.resolution?.at ? ` · ${shortDate(c.resolution.at)}` : ''}
          {c.internalNote && <p className="mt-1 italic">Note: {c.internalNote}</p>}
        </div>
      ) : (
        <>
          {/* AI-assisted review: suggestion + cited evidence. Advisory only — never acts. */}
          <div className="mt-2" onClick={(e) => e.stopPropagation()}> {/* design-lint-allow */}
            <AiReviewPanel caseId={c.id} internalNote={c.internalNote} onUse={useSuggestion} refresh={refresh} />
          </div>

          {/* ONE decision row: penalty picker + the two primary verdicts on the left;
              Abusive (rare) + note + ⋯ everything-else on the right. Tooltips carry
              the detail the old three stacked rows spelled out. The verdict buttons
              stay ONE-CLICK by design — idempotency is handled server-side. */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
            <SeverityMenu value={severity} onPick={(sv) => onSeverity(c.id, sv)} />
            <Button size="none" variant="destructive" ref={(el) => { decisionRefs.current.confirm = el }} onClick={(e) => { e.stopPropagation(); onAction('confirm-report', c.id, severity) }} disabled={busy} title={`Docks the target ${PENALTY[severity]} trust${isListing ? ' and unpublishes the listing' : ''}`} className={cn('rounded-lg px-3 py-1 text-2xs font-bold disabled:opacity-40 cursor-pointer', aiFocus === 'confirm' && 'ring-2 ring-brand ring-offset-1')}>Confirm{isListing ? ' & unpublish' : ''}</Button>
            <Button size="none" variant="ghost" ref={(el) => { decisionRefs.current.dismiss = el }} onClick={(e) => { e.stopPropagation(); onAction('dismiss-report', c.id) }} disabled={busy} title={c.appeal ? 'Uphold the appeal — no penalty' : 'Keep the listing live — no penalty'} className={cn('rounded-lg border border-line-strong px-2.5 py-1 text-2xs font-semibold text-foreground hover:bg-muted hover:text-accent-foreground disabled:opacity-40 cursor-pointer', aiFocus === 'dismiss' && 'ring-2 ring-brand ring-offset-1')}>Dismiss</Button>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <span className="ml-auto inline-flex items-center gap-1.5">
              <Button size="none" variant="ghost" ref={(el) => { decisionRefs.current.abusive = el }} onClick={(e) => { e.stopPropagation(); onAction('abusive-report', c.id) }} disabled={busy} className={cn('rounded-lg px-2 py-1 text-2xs font-semibold text-warning hover:bg-warning/10 hover:text-warning disabled:opacity-40 cursor-pointer', aiFocus === 'abusive' && 'ring-2 ring-brand ring-offset-1')} title="False/abusive report — strike the reporter">Abusive</Button>
              <NoteEditor caseId={c.id} initial={c.internalNote} onSaved={refresh} />
              <MoreMenu>
                {isListing && <DropdownMenuItem variant="destructive" onClick={() => onListing('reject', t.listing!.id)} disabled={busy} className="text-2xs font-semibold cursor-pointer"><X className="size-3" /> Delete listing permanently</DropdownMenuItem>}
                {c.communityCount > 1 && <DropdownMenuItem onClick={() => onDismissTarget(c.id)} disabled={busy} className="text-2xs font-semibold cursor-pointer"><Users className="size-3" /> Dismiss all {c.communityCount} on this target</DropdownMenuItem>}
                {(isListing || c.communityCount > 1) && (msgTargets.length > 0 || t.isGuest) && <DropdownMenuSeparator />}
                {msgTargets.map((m) => <MacroSender key={m.recipientId} recipientId={m.recipientId} label={m.label} listingId={isListing ? t.listing!.id : null} conversationId={c.conversationId} />)}
                {t.isGuest && <p className="px-2 py-1 text-3xs italic text-ink-4">Reported party is a guest — can&apos;t be messaged.</p>}
              </MoreMenu>
            </span>
          </div>
        </>
      )}
    </Card>
  )
}

// Compact master-list row (the left pane of the two-pane layout). Selecting it loads the
// full CaseCard into the detail pane on the right.
function CaseRow({ c, active, checked, readOnly, onSelect, onCheck }: {
  c: ModCase; active: boolean; checked?: boolean; readOnly?: boolean; onSelect: () => void; onCheck?: () => void
}) {
  const t = c.target
  const isListing = t.kind === 'listing' && t.listing
  return (
    <button type="button" onClick={onSelect} className={cn('block w-full text-left cursor-pointer rounded-xl border border-l-[3px] p-2.5 transition-colors', RAIL[c.bucket], active ? 'border-brand/40 bg-tint ring-1 ring-brand/40' : 'border-border bg-card hover:bg-muted/50')}> {/* design-lint-allow */}
      <div className="flex items-start gap-2">
        {!readOnly && onCheck && <Checkbox checked={!!checked} onClick={(e) => e.stopPropagation()} onChange={onCheck} className="mt-0.5 h-3.5 w-3.5" aria-label="Select case" />}
        {isListing && (
          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-tint">
            {t.listing!.image ? <Image src={t.listing!.image} alt="" fill sizes="36px" className="object-cover" /> : null}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {c.appeal && <Badge variant="warning" size="sm" className="px-1 text-3xs uppercase leading-none">Appeal</Badge>}
            {c.bucket === 'critical' && !c.appeal && !readOnly && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />}
            <span className="truncate text-sm font-bold text-foreground">{REASON_LABEL[c.reason] || c.reason}</span>
          </div>
          <p className="mt-0.5 truncate text-2xs text-muted-foreground">
            <span className="capitalize text-ink-4">{t.kind}</span> · {t.name}
            {c.communityCount > 1 && <span className="font-semibold text-warning"> · ×{c.communityCount}</span>}
          </p>
        </div>
        <span className="shrink-0 text-3xs text-ink-4">{c.ageDays <= 0 ? 'today' : `${c.ageDays}d`}</span>
      </div>
    </button>
  )
}

type FilterKey = 'all' | 'critical' | 'aging' | 'listing' | 'account' | 'chat' | 'resolved'

export function ModerationClient({ cases, resolved }: { cases: ModCase[]; resolved: ModCase[] }) {
  const router = useRouter()
  const { tr } = useLanguage() // bulk-result toast copy follows the viewer's language
  const [filter, setFilter] = useState<FilterKey>('all')
  const [sel, setSel] = useState(0)
  // Post-mount, only ONE of the two layout trees stays mounted (audit §G: with a
  // long queue, rendering every full card for the CSS-hidden mobile list doubled
  // the work of every interaction). Pre-mount (null) both render, CSS-gated —
  // identical to the server HTML, so hydration stays clean.
  const [viewport, setViewport] = useState<'wide' | 'narrow' | null>(null)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const apply = () => setViewport(mq.matches ? 'wide' : 'narrow')
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [sevById, setSevById] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [bulkSev, setBulkSev] = useState('moderate')
  const [bulkBusy, setBulkBusy] = useState(false)

  const sevOf = (c: ModCase) => sevById[c.id] || (c.severity && PENALTY[c.severity] ? c.severity : 'moderate')
  const refresh = () => router.refresh()

  const showResolved = filter === 'resolved'
  const filtered = showResolved ? resolved : cases.filter((c) =>
    filter === 'all' ? true : filter === 'critical' ? c.bucket === 'critical' : filter === 'aging' ? c.ageDays > 2 : c.target.kind === filter)

  const counts = {
    all: cases.length,
    critical: cases.filter((c) => c.bucket === 'critical').length,
    aging: cases.filter((c) => c.ageDays > 2).length,
    listing: cases.filter((c) => c.target.kind === 'listing').length,
    account: cases.filter((c) => c.target.kind === 'account').length,
    chat: cases.filter((c) => c.target.kind === 'chat').length,
    resolved: resolved.length,
  }

  const act = async (action: string, id: string, severity?: string) => {
    setBusyId(id)
    try { await post({ action, id, ...(severity ? { severity } : {}) }); refresh() } catch { toast.error('Action failed — the case is unchanged.') } finally { setBusyId(null) }
  }
  const listingAct = async (action: string, listingId: string) => {
    setBusyId(listingId)
    try { await post({ action, id: listingId }); refresh() } catch { toast.error('Listing action failed — nothing changed.') } finally { setBusyId(null) }
  }
  const dismissTarget = async (id: string) => {
    setBusyId(id)
    try { await post({ action: 'dismiss-target', id }); refresh() } catch { toast.error('Dismiss failed — the reports are unchanged.') } finally { setBusyId(null) }
  }
  const bulk = async (action: 'bulk-dismiss' | 'bulk-confirm') => {
    const ids = [...checked]
    if (!ids.length) return
    setBulkBusy(true)
    // The API caps each call (100 confirm / 200 dismiss) — chunk client-side so a
    // larger selection isn't silently truncated, then toast the summed counts the
    // server actually transitioned (idempotency skips show as "already resolved").
    const cap = action === 'bulk-confirm' ? 100 : 200
    try {
      let done = 0
      for (let i = 0; i < ids.length; i += cap) {
        const res = await post({ action, ids: ids.slice(i, i + cap), ...(action === 'bulk-confirm' ? { severity: bulkSev } : {}) })
        done += Number(res[action === 'bulk-confirm' ? 'confirmed' : 'dismissed']) || 0
      }
      const already = ids.length - done
      const label = action === 'bulk-confirm' ? tr('confirmed', 'đã xác nhận') : tr('dismissed', 'đã bỏ qua')
      toast.success(already > 0 ? `${done} ${label} · ${already} ${tr('already resolved', 'đã xử lý trước đó')}` : `${done} ${label}`)
      setChecked(new Set()); refresh()
    } catch { toast.error('Bulk action failed — the selection is unchanged.') } finally { setBulkBusy(false) }
  }

  // Latest-values ref so the keydown listener is attached exactly once but always
  // reads the current filter/selection/handlers (no re-subscribe per keystroke of
  // state, no stale closures riding on `filtered`'s referential instability).
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  onKeyRef.current = (e: KeyboardEvent) => {
    if (showResolved) return
    const el = e.target as HTMLElement
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return
    // The primitives render popup triggers/items as buttons and divs — keep hotkeys
    // suppressed while a menu/select is focused, same as the old native <select> guard.
    if (el && typeof el.closest === 'function' && el.closest('[role="menu"], [role="menuitem"], [role="listbox"], [role="option"], [role="combobox"]')) return
    const cur = filtered[sel]
    if (e.key === 'j') { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)) }
    else if (e.key === 'k') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
    else if (cur && e.key === 'c') { e.preventDefault(); act('confirm-report', cur.id, sevOf(cur)) }
    else if (cur && e.key === 'd') { e.preventDefault(); act('dismiss-report', cur.id) }
    else if (cur && e.key === 'a') { e.preventDefault(); act('abusive-report', cur.id) }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onKeyRef.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => { if (sel > filtered.length - 1) setSel(Math.max(0, filtered.length - 1)) }, [filtered.length, sel])

  const CHIPS: [FilterKey, string][] = [['all', 'All'], ['critical', 'Critical'], ['aging', 'Aging >2d'], ['listing', 'Listings'], ['account', 'Accounts'], ['chat', 'Chats'], ['resolved', 'Resolved']]
  const targetsOfChecked = new Set(cases.filter((c) => checked.has(c.id)).map((c) => c.target.sellerId || c.target.profileId || c.id)).size
  const selectedCase = filtered[sel]

  // Shared full-card renderer — used inline below lg and in the detail pane at lg+.
  const renderCard = (c: ModCase, i: number) => (
    <CaseCard
      key={c.id}
      c={c}
      readOnly={showResolved}
      selected={i === sel}
      busy={busyId === c.id || (c.target.kind === 'listing' && c.target.listing != null && busyId === c.target.listing.id)}
      severity={sevOf(c)}
      checked={checked.has(c.id)}
      onCheck={() => setChecked((prev) => { const n = new Set(prev); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n })}
      onSeverity={(id, s) => setSevById((m) => ({ ...m, [id]: s }))}
      onSelect={() => setSel(i)}
      onAction={act}
      onListing={listingAct}
      onDismissTarget={dismissTarget}
      refresh={refresh}
    />
  )

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {/* Queue filters — segmented control. ui/button renders a native <button>, so
            these keep role=button with "Label (count)" accessible names — the e2e suite
            selects them. `bare` because the chip paints its own selected/hover colours. */}
        <div className="inline-flex flex-wrap items-center gap-0.5 rounded-xl bg-tint p-0.5">
          {CHIPS.map(([k, label]) => (
            <Button key={k} variant="bare" size="none" onClick={() => { setFilter(k); setSel(0) }} className={cn('rounded-lg px-3 py-1 text-xs font-semibold transition-colors cursor-pointer', filter === k ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-card', k === 'critical' && counts.critical > 0 && filter !== k && 'text-destructive')}>
              {label} ({counts[k]})
            </Button>
          ))}
        </div>
        {!showResolved && <span className="ml-auto hidden items-center gap-1 text-3xs text-ink-4 sm:inline-flex"><ChevronDown className="h-3 w-3" /> keys: j/k move · c confirm · d dismiss · a abusive</span>}
      </div>

      {!showResolved && checked.size > 0 && (
        <div className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-pop">
          <span className="text-xs font-bold text-foreground">{checked.size} selected{targetsOfChecked > 1 ? ` · ${targetsOfChecked} targets` : ''}</span>
          <Button size="none" variant="ghost" onClick={() => bulk('bulk-dismiss')} disabled={bulkBusy} className="rounded-lg border border-line-strong px-2.5 py-1 text-2xs font-bold text-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 cursor-pointer">Dismiss selected</Button>
          <span className="ml-1 flex items-center gap-1">
            <Select value={bulkSev} onValueChange={(v) => { if (typeof v === 'string') setBulkSev(v) }}>
              <SelectTrigger size="sm" aria-label="Severity for the selected reports" className="rounded-lg border-line-strong bg-card text-2xs cursor-pointer">
                {bulkSev} {PENALTY[bulkSev]}
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => <SelectItem key={s} value={s} className="text-2xs">{s} {PENALTY[s]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="none" variant="destructive" onClick={() => bulk('bulk-confirm')} disabled={bulkBusy} className="rounded-lg px-2.5 py-1 text-2xs font-bold disabled:opacity-40 cursor-pointer">Confirm selected</Button>
          </span>
          {bulkBusy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <Button size="none" variant="ghost" onClick={() => setChecked(new Set())} className="ml-auto rounded-lg px-2 py-1 text-2xs font-semibold text-muted-foreground hover:bg-muted hover:text-muted-foreground cursor-pointer">Clear</Button>
        </div>
      )}

      {filtered.length === 0 ? (
        showResolved
          ? <EmptyState icon={ShieldQuestion} title="No resolved reports yet." />
          : <EmptyState title="Nothing here. 🎉" />
      ) : (
        <>
          {/* Narrow / non-desktop: original single-column full cards (each self-contained). */}
          {viewport !== 'wide' && <div className="space-y-3 lg:hidden">
            {filtered.map((c, i) => renderCard(c, i))}
          </div>}

          {/* Desktop: master-detail. Left = compact list; right = the selected case in full. */}
          {viewport !== 'narrow' && <div className="hidden lg:grid lg:grid-cols-[minmax(300px,380px)_1fr] lg:items-start lg:gap-4">
            <div className="max-h-[calc(100vh-150px)] space-y-1.5 overflow-y-auto pr-1">
              {filtered.map((c, i) => (
                <CaseRow
                  key={c.id}
                  c={c}
                  active={i === sel}
                  readOnly={showResolved}
                  checked={checked.has(c.id)}
                  onSelect={() => setSel(i)}
                  onCheck={() => setChecked((prev) => { const n = new Set(prev); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n })}
                />
              ))}
            </div>
            <div className="sticky top-2">
              {selectedCase ? renderCard(selectedCase, sel) : (
                <EmptyState title="Select a case to review." />
              )}
            </div>
          </div>}
        </>
      )}
    </div>
  )
}
