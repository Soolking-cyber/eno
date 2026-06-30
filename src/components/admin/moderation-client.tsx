'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Check, X, Flag, Loader2, ExternalLink, EyeOff, MessageSquare, Send, ChevronDown } from 'lucide-react'
import { formatMoneyFull } from '@/lib/vnd'
import { cn } from '@/lib/utils'
import { MOD_MACROS } from '@/lib/admin-macros'
import type { TargetInfo } from '@/lib/admin-reports'

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
  reporter: Reporter | null
  conversationId: string | null
  communityCount: number
  target: TargetInfo
}

const REASON_LABEL: Record<string, string> = {
  scam: 'Scam', counterfeit: 'Counterfeit', sold: 'Already sold', 'wrong-info': 'Wrong info',
  duplicate: 'Duplicate', offensive: 'Offensive / harassment', other: 'Other',
}
const PENALTY: Record<string, number> = { minor: -3, moderate: -10, severe: -25 }
const SEVERITIES = ['minor', 'moderate', 'severe'] as const

async function moderate(action: string, id: string, severity?: string) {
  const res = await fetch('/api/admin/moderate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, id, ...(severity ? { severity } : {}) }),
  })
  if (!res.ok) throw new Error(`${action} failed`)
}

// Trust-tier chip — colored so an admin reads the target's standing at a glance.
function TierChip({ tier, score }: { tier: string | null; score: number | null }) {
  if (score == null) return null
  const cls = tier === 'restricted' ? 'bg-red-100 text-red-700'
    : tier === 'trusted' ? 'bg-accent text-accent-foreground'
    : tier === 'exceptional' ? 'bg-amber-100 text-amber-800'
    : 'bg-tint text-ink-4'
  return <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold', cls)}>trust {score}{tier && tier !== 'standard' ? ` · ${tier}` : ''}</span>
}

// Admin → user message with a canned-macro picker (prefill, then edit before send).
function AdminMessageButton({ recipientId, label, listingId, conversationId }: { recipientId: string; label: string; listingId?: string | null; conversationId?: string | null }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  const send = async () => {
    const t = text.trim()
    if (!t) return
    setState('sending')
    try {
      const res = await fetch('/api/admin/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipientId, text: t, listingId, conversationId }) })
      if (!res.ok) throw new Error()
      setState('sent'); setText('')
      setTimeout(() => { setOpen(false); setState('idle') }, 1400)
    } catch { setState('error') }
  }

  if (!open) {
    return (
      <button onClick={(e) => { e.stopPropagation(); setOpen(true) }} className="inline-flex items-center gap-1 rounded-md border border-line-strong bg-card px-2 py-0.5 text-[10px] font-bold text-foreground hover:bg-muted cursor-pointer">
        <MessageSquare className="h-3 w-3" /> Message {label}
      </button>
    )
  }
  return (
    <div className="w-full rounded-lg border border-border bg-card p-2" onClick={(e) => e.stopPropagation()}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold text-muted-foreground">Message {label}</p>
        <select
          value=""
          onChange={(e) => { const m = MOD_MACROS.find((x) => x.label === e.target.value); if (m) setText(m.text) }}
          className="rounded border border-line-strong bg-card px-1 py-0.5 text-[10px] text-foreground cursor-pointer"
        >
          <option value="">Insert macro…</option>
          {MOD_MACROS.map((m) => <option key={m.label} value={m.label}>{m.label}</option>)}
        </select>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000} placeholder="Write a message — it lands in their notifications…" className="w-full resize-none rounded-md border border-line-strong px-2 py-1.5 text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
      <div className="mt-1.5 flex items-center gap-1.5">
        <button onClick={send} disabled={state === 'sending' || !text.trim()} className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[10px] font-bold text-white hover:bg-brand-dark disabled:opacity-40 cursor-pointer">
          {state === 'sending' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          {state === 'sent' ? 'Sent ✓' : 'Send'}
        </button>
        <button onClick={() => { setOpen(false); setText(''); setState('idle') }} className="rounded-md px-2 py-1 text-[10px] font-bold text-muted-foreground hover:bg-muted cursor-pointer">Cancel</button>
        {state === 'error' && <span className="text-[10px] font-semibold text-red-600">Failed — try again.</span>}
      </div>
    </div>
  )
}

const RAIL = { critical: 'border-l-red-500', high: 'border-l-amber-400', standard: 'border-l-slate-300' }

function CaseCard({ c, selected, busy, severity, onSeverity, onSelect, onAction, onListing }: {
  c: ModCase; selected: boolean; busy: boolean; severity: string
  onSeverity: (id: string, s: string) => void
  onSelect: () => void
  onAction: (action: string, id: string, severity?: string) => void
  onListing: (action: string, listingId: string) => void
}) {
  const t = c.target
  const isListing = t.kind === 'listing' && t.listing
  // Message targets: reporter + the reported party (when reachable — guests have no account).
  const msgTargets = [
    c.reporter ? { recipientId: c.reporter.id, label: `reporter (${c.reporter.name})` } : null,
    t.profileId ? { recipientId: t.profileId, label: `${t.kind === 'listing' ? 'seller' : 'reported user'} (${t.name})` } : null,
  ].filter((x): x is { recipientId: string; label: string } => x !== null)
    .filter((x, i, a) => a.findIndex((y) => y.recipientId === x.recipientId) === i)

  return (
    <div onClick={onSelect} className={cn('cursor-pointer rounded-2xl border border-l-[3px] bg-card p-4 shadow-pop transition-shadow', RAIL[c.bucket], selected ? 'ring-2 ring-brand/40' : 'border-border')}>
      {/* Header: bucket, reason, community, age */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {c.bucket === 'critical' && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">Critical</span>}
          <span className="text-sm font-bold text-foreground">{REASON_LABEL[c.reason] || c.reason}</span>
          {c.communityCount > 1 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">{c.communityCount} reports on this target</span>}
          <span className="rounded-full bg-tint px-2 py-0.5 text-[10px] font-semibold capitalize text-ink-4">{t.kind}</span>
        </div>
        <span className="shrink-0 text-[11px] text-ink-4">{c.ageDays <= 0 ? 'today' : `${c.ageDays}d ago`}</span>
      </div>

      {/* Target */}
      <div className="mt-2 flex gap-3">
        {isListing && (
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-tint">
            {t.listing!.image ? <Image src={t.listing!.image} alt="" fill sizes="64px" className="object-cover" /> : <div className="flex h-full w-full items-center justify-center text-[10px] text-ink-4">No image</div>}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {isListing ? (
            <>
              <a href={`/listings/${t.listing!.id}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 truncate text-sm font-bold text-foreground hover:text-accent-foreground">
                <span className="truncate">{t.listing!.title}</span><ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
              </a>
              <p className="mt-0.5 text-xs font-semibold text-accent-foreground">{formatMoneyFull(t.listing!.price, t.listing!.currency)}</p>
              <p className="truncate text-[11px] text-muted-foreground">{t.listing!.category} · {t.listing!.location}</p>
            </>
          ) : (
            <p className="text-sm font-bold text-foreground">{t.kind === 'chat' ? 'Reported conversation' : 'Reported account'}</p>
          )}
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>Target:</span>
            {t.sellerId ? <a href={`/sellers/${t.sellerId}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold text-foreground hover:underline">{t.name}</a> : <span className="font-semibold text-foreground">{t.name}</span>}
            <TierChip tier={t.trustTier} score={t.trustScore} />
            {t.isGuest && <span className="italic text-ink-4">guest — unreachable</span>}
          </p>
        </div>
      </div>

      {c.detail && <p className="mt-2 text-xs text-foreground">“{c.detail}”</p>}

      {/* Reporter + conversation */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {c.reporter ? (
          <span>By {c.reporter.sellerId ? <a href={`/sellers/${c.reporter.sellerId}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold text-foreground hover:underline">{c.reporter.name}</a> : <span className="font-semibold text-foreground">{c.reporter.name}</span>}<span className="text-ink-4"> · trust {c.reporter.trustScore}</span>{c.reporter.strikes > 0 && <span className="font-semibold text-warning"> · {c.reporter.strikes} false-report strike{c.reporter.strikes > 1 ? 's' : ''}</span>}</span>
        ) : <span className="italic">reporter account removed</span>}
        {c.conversationId && <a href={`/admin/conversation/${c.conversationId}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline"><MessageSquare className="h-3 w-3" /> View conversation</a>}
      </div>

      {/* Decision */}
      <div className="mt-3 space-y-1.5 border-t border-border pt-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-ink-4">Penalty</span>
          {SEVERITIES.map((s) => (
            <button key={s} onClick={(e) => { e.stopPropagation(); onSeverity(c.id, s) }} className={cn('rounded-md px-2 py-0.5 text-[10px] font-bold capitalize transition-colors cursor-pointer', severity === s ? 'bg-primary text-white' : 'border border-line-strong text-foreground hover:bg-muted')}>{s} {PENALTY[s]}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={(e) => { e.stopPropagation(); onAction('confirm-report', c.id, severity) }} disabled={busy} className="rounded-md bg-red-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-red-700 disabled:opacity-40 cursor-pointer">Confirm{isListing ? ' & unpublish' : ''} ({PENALTY[severity]} trust)</button>
          <button onClick={(e) => { e.stopPropagation(); onAction('dismiss-report', c.id) }} disabled={busy} className="rounded-md px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted disabled:opacity-40 cursor-pointer">Dismiss</button>
          <button onClick={(e) => { e.stopPropagation(); onAction('abusive-report', c.id) }} disabled={busy} className="rounded-md px-2 py-1 text-[11px] font-semibold text-warning hover:bg-warning/10 disabled:opacity-40 cursor-pointer" title="False/abusive report — strike the reporter">Abusive</button>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        {/* Listing-level actions (only for listing reports) */}
        {isListing && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <button onClick={(e) => { e.stopPropagation(); onListing('approve', t.listing!.id) }} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-line-strong bg-card px-2 py-0.5 text-[10px] font-bold text-foreground hover:bg-muted disabled:opacity-40 cursor-pointer"><Check className="h-3 w-3" /> Keep &amp; clear reports</button>
            <button onClick={(e) => { e.stopPropagation(); onListing('unpublish', t.listing!.id) }} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-line-strong bg-card px-2 py-0.5 text-[10px] font-bold text-foreground hover:bg-muted disabled:opacity-40 cursor-pointer"><EyeOff className="h-3 w-3" /> Unpublish</button>
            <button onClick={(e) => { e.stopPropagation(); onListing('reject', t.listing!.id) }} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-card px-2 py-0.5 text-[10px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-40 cursor-pointer"><X className="h-3 w-3" /> Delete</button>
          </div>
        )}
      </div>

      {/* Reach out */}
      {(msgTargets.length > 0 || t.isGuest) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {msgTargets.map((m) => <AdminMessageButton key={m.recipientId} recipientId={m.recipientId} label={m.label} listingId={isListing ? t.listing!.id : null} conversationId={c.conversationId} />)}
          {t.isGuest && <span className="text-[10px] italic text-ink-4">Reported party is a guest — can&apos;t be messaged; act on the listing.</span>}
        </div>
      )}
    </div>
  )
}

type FilterKey = 'all' | 'critical' | 'aging' | 'listing' | 'account' | 'chat'

export function ModerationClient({ cases }: { cases: ModCase[] }) {
  const router = useRouter()
  const [filter, setFilter] = useState<FilterKey>('all')
  const [sel, setSel] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [sevById, setSevById] = useState<Record<string, string>>({})

  const sevOf = (c: ModCase) => sevById[c.id] || (c.severity && PENALTY[c.severity] ? c.severity : 'moderate')

  const filtered = cases.filter((c) =>
    filter === 'all' ? true
    : filter === 'critical' ? c.bucket === 'critical'
    : filter === 'aging' ? c.ageDays > 2
    : c.target.kind === filter)

  const counts = {
    all: cases.length,
    critical: cases.filter((c) => c.bucket === 'critical').length,
    aging: cases.filter((c) => c.ageDays > 2).length,
    listing: cases.filter((c) => c.target.kind === 'listing').length,
    account: cases.filter((c) => c.target.kind === 'account').length,
    chat: cases.filter((c) => c.target.kind === 'chat').length,
  }

  const act = async (action: string, id: string, severity?: string) => {
    setBusyId(id)
    try { await moderate(action, id, severity); router.refresh() } catch { /* surfaced by refresh staying */ } finally { setBusyId(null) }
  }
  const listingAct = async (action: string, listingId: string) => {
    setBusyId(listingId)
    try { await moderate(action, listingId); router.refresh() } catch { /* noop */ } finally { setBusyId(null) }
  }

  // Keyboard: j/k move, c confirm (current penalty), d dismiss, a abusive. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return
      const cur = filtered[sel]
      if (e.key === 'j') { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)) }
      else if (e.key === 'k') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
      else if (cur && e.key === 'c') { e.preventDefault(); act('confirm-report', cur.id, sevOf(cur)) }
      else if (cur && e.key === 'd') { e.preventDefault(); act('dismiss-report', cur.id) }
      else if (cur && e.key === 'a') { e.preventDefault(); act('abusive-report', cur.id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sel])

  useEffect(() => { if (sel > filtered.length - 1) setSel(Math.max(0, filtered.length - 1)) }, [filtered.length, sel])

  const CHIPS: [FilterKey, string][] = [['all', 'All'], ['critical', 'Critical'], ['aging', 'Aging >2d'], ['listing', 'Listings'], ['account', 'Accounts'], ['chat', 'Chats']]

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {CHIPS.map(([k, label]) => (
          <button key={k} onClick={() => { setFilter(k); setSel(0) }} className={cn('rounded-full px-3 py-1 text-xs font-semibold transition-colors cursor-pointer', filter === k ? 'bg-primary text-white' : 'bg-tint text-muted-foreground hover:bg-muted', k === 'critical' && counts.critical > 0 && filter !== k && 'text-red-700')}>
            {label} ({counts[k]})
          </button>
        ))}
        <span className="ml-auto hidden items-center gap-1 text-[10px] text-ink-4 sm:inline-flex"><ChevronDown className="h-3 w-3" /> keys: j/k move · c confirm · d dismiss · a abusive</span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-ink-4">Nothing here. 🎉</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((c, i) => (
            <CaseCard
              key={c.id}
              c={c}
              selected={i === sel}
              busy={busyId === c.id || (c.target.kind === 'listing' && c.target.listing != null && busyId === c.target.listing.id)}
              severity={sevOf(c)}
              onSeverity={(id, s) => setSevById((m) => ({ ...m, [id]: s }))}
              onSelect={() => setSel(i)}
              onAction={act}
              onListing={listingAct}
            />
          ))}
        </div>
      )}
    </div>
  )
}
