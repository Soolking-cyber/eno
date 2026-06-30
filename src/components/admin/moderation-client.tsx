'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { X, Loader2, ExternalLink, MessageSquare, ChevronDown, StickyNote, Users, ShieldQuestion } from 'lucide-react'
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
  internalNote: string | null
  appeal?: { note: string | null; images: string[]; at: string } | null
  resolution?: { status: string; by: string | null; at: string | null } | null
}

const REASON_LABEL: Record<string, string> = {
  scam: 'Scam', counterfeit: 'Counterfeit', sold: 'Already sold', 'wrong-info': 'Wrong info',
  duplicate: 'Duplicate', offensive: 'Offensive / harassment', other: 'Other',
}
const PENALTY: Record<string, number> = { minor: -3, moderate: -10, severe: -25 }
const SEVERITIES = ['minor', 'moderate', 'severe'] as const

async function post(body: Record<string, unknown>) {
  const res = await fetch('/api/admin/moderate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error('action failed')
}
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

function TierChip({ tier, score }: { tier: string | null; score: number | null }) {
  if (score == null) return null
  const cls = tier === 'restricted' ? 'bg-red-100 text-red-700'
    : tier === 'trusted' ? 'bg-accent text-accent-foreground'
    : tier === 'exceptional' ? 'bg-amber-100 text-amber-800'
    : 'bg-tint text-ink-4'
  return <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold', cls)}>trust {score}{tier && tier !== 'standard' ? ` · ${tier}` : ''}</span>
}

function NoteEditor({ caseId, initial, onSaved }: { caseId: string; initial: string | null; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(initial || '')
  const [saving, setSaving] = useState(false)
  const dirty = text !== (initial || '')
  const save = async () => { setSaving(true); try { await post({ action: 'set-note', id: caseId, note: text }); onSaved() } catch { /* noop */ } finally { setSaving(false) } }
  if (!open) {
    return (
      <button onClick={(e) => { e.stopPropagation(); setOpen(true) }} className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground cursor-pointer">
        <StickyNote className="h-3 w-3" /> {initial ? 'Internal note ✓' : 'Add internal note'}
      </button>
    )
  }
  return (
    <div className="w-full rounded-lg border border-border bg-tint/40 p-2" onClick={(e) => e.stopPropagation()}>
      <p className="mb-1 text-[10px] font-semibold text-muted-foreground">Internal note (staff-only, never shown to users)</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} className="w-full resize-none rounded-md border border-line-strong bg-card px-2 py-1.5 text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
      <div className="mt-1.5 flex items-center gap-1.5">
        <button onClick={save} disabled={saving || !dirty} className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1 text-[10px] font-bold text-background hover:opacity-90 disabled:opacity-40 cursor-pointer">{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Save note</button>
        <button onClick={() => { setText(initial || ''); setOpen(false) }} className="rounded-md px-2 py-1 text-[10px] font-bold text-muted-foreground hover:bg-muted cursor-pointer">Close</button>
      </div>
    </div>
  )
}

// Send a PRE-PREPARED macro (no free text). The recipient gets it in their language
// (server localizes via Profile.locale). Picking a macro sends it.
function MacroSender({ recipientId, label, listingId, conversationId }: { recipientId: string; label: string; listingId?: string | null; conversationId?: string | null }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const send = async (key: string) => {
    if (!key) return
    setState('sending')
    try {
      const res = await fetch('/api/admin/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipientId, macroKey: key, listingId, conversationId }) })
      if (res.ok) { setState('sent'); setTimeout(() => setState('idle'), 1800) } else setState('idle')
    } catch { setState('idle') }
  }
  return (
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <select value="" disabled={state === 'sending'} onChange={(e) => send(e.target.value)} className="rounded-md border border-line-strong bg-card px-2 py-0.5 text-[10px] font-bold text-foreground cursor-pointer disabled:opacity-50">
        <option value="">{state === 'sent' ? `Sent to ${label} ✓` : state === 'sending' ? 'Sending…' : `Notify ${label}…`}</option>
        {MOD_MACROS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
      </select>
      {state === 'sending' && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
    </span>
  )
}

const RAIL = { critical: 'border-l-red-500', high: 'border-l-amber-400', standard: 'border-l-slate-300' }

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
  const msgTargets = [
    c.reporter ? { recipientId: c.reporter.id, label: `reporter (${c.reporter.name})` } : null,
    t.profileId ? { recipientId: t.profileId, label: `${t.kind === 'listing' ? 'seller' : 'user'} (${t.name})` } : null,
  ].filter((x): x is { recipientId: string; label: string } => x !== null).filter((x, i, a) => a.findIndex((y) => y.recipientId === x.recipientId) === i)

  return (
    <div onClick={onSelect} className={cn('cursor-pointer rounded-2xl border border-l-[3px] bg-card p-4 shadow-pop transition-shadow', RAIL[c.bucket], selected && !readOnly ? 'ring-2 ring-brand/40' : 'border-border', readOnly && 'opacity-90')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {!readOnly && onCheck && <input type="checkbox" checked={!!checked} onClick={(e) => e.stopPropagation()} onChange={onCheck} className="h-3.5 w-3.5 cursor-pointer accent-brand" aria-label="Select case" />}
          {c.appeal && <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Appeal</span>}
          {c.bucket === 'critical' && !c.appeal && !readOnly && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">Critical</span>}
          <span className="text-sm font-bold text-foreground">{REASON_LABEL[c.reason] || c.reason}</span>
          {c.communityCount > 1 && !readOnly && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">{c.communityCount} on this target</span>}
          <span className="rounded-full bg-tint px-2 py-0.5 text-[10px] font-semibold capitalize text-ink-4">{t.kind}</span>
        </div>
        <span className="shrink-0 text-[11px] text-ink-4">{c.ageDays <= 0 ? 'today' : `${c.ageDays}d ago`}</span>
      </div>

      <div className="mt-2 flex gap-3">
        {isListing && (
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-tint">
            {t.listing!.image ? <Image src={t.listing!.image} alt="" fill sizes="64px" className="object-cover" /> : <div className="flex h-full w-full items-center justify-center text-[10px] text-ink-4">No image</div>}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {isListing ? (
            <>
              <a href={`/listings/${t.listing!.id}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 truncate text-sm font-bold text-foreground hover:text-accent-foreground"><span className="truncate">{t.listing!.title}</span><ExternalLink className="h-3 w-3 shrink-0 opacity-50" /></a>
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

      {/* Appeal: the target's explanation + proof, shown prominently. */}
      {c.appeal && (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Appeal · {shortDate(c.appeal.at)}</p>
          {c.appeal.note && <p className="mt-0.5 text-xs text-amber-900">{c.appeal.note}</p>}
          {c.appeal.images.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {c.appeal.images.map((src, i) => (
                <a key={i} href={src} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="relative block h-14 w-14 overflow-hidden rounded-md bg-tint">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="proof" className="h-full w-full object-cover" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {c.reporter ? (
          <span>By {c.reporter.sellerId ? <a href={`/sellers/${c.reporter.sellerId}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="font-semibold text-foreground hover:underline">{c.reporter.name}</a> : <span className="font-semibold text-foreground">{c.reporter.name}</span>}<span className="text-ink-4"> · trust {c.reporter.trustScore}</span>{c.reporter.strikes > 0 && <span className="font-semibold text-warning"> · {c.reporter.strikes} false-report strike{c.reporter.strikes > 1 ? 's' : ''}</span>}</span>
        ) : <span className="italic">reporter account removed</span>}
        {c.conversationId && <a href={`/admin/conversation/${c.conversationId}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline"><MessageSquare className="h-3 w-3" /> View conversation</a>}
      </div>

      {readOnly ? (
        <div className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
          <span className={cn('font-bold', c.resolution?.status === 'confirmed' ? 'text-red-600' : c.resolution?.status === 'abusive' ? 'text-warning' : 'text-foreground')}>{c.resolution?.status}</span>
          {c.resolution?.by ? ` · by ${c.resolution.by}` : ''}{c.resolution?.at ? ` · ${shortDate(c.resolution.at)}` : ''}
          {c.internalNote && <p className="mt-1 italic">Note: {c.internalNote}</p>}
        </div>
      ) : (
        <>
          <div className="mt-3 space-y-1.5 border-t border-border pt-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wide text-ink-4">Penalty</span>
              {SEVERITIES.map((s) => (
                <button key={s} onClick={(e) => { e.stopPropagation(); onSeverity(c.id, s) }} className={cn('rounded-md px-2 py-0.5 text-[10px] font-bold capitalize transition-colors cursor-pointer', severity === s ? 'bg-primary text-white' : 'border border-line-strong text-foreground hover:bg-muted')}>{s} {PENALTY[s]}</button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={(e) => { e.stopPropagation(); onAction('confirm-report', c.id, severity) }} disabled={busy} className="rounded-md bg-red-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-red-700 disabled:opacity-40 cursor-pointer">Confirm{isListing ? ' & unpublish' : ''} ({PENALTY[severity]} trust)</button>
              <button onClick={(e) => { e.stopPropagation(); onAction('dismiss-report', c.id) }} disabled={busy} className="rounded-md border border-line-strong px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted disabled:opacity-40 cursor-pointer">{c.appeal ? 'Dismiss (uphold appeal)' : 'Dismiss (keep live)'}</button>
              <button onClick={(e) => { e.stopPropagation(); onAction('abusive-report', c.id) }} disabled={busy} className="rounded-md px-2 py-1 text-[11px] font-semibold text-warning hover:bg-warning/10 disabled:opacity-40 cursor-pointer" title="False/abusive report — strike the reporter">Abusive</button>
              {isListing && <button onClick={(e) => { e.stopPropagation(); onListing('reject', t.listing!.id) }} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40 cursor-pointer"><X className="h-3 w-3" /> Delete listing</button>}
              {c.communityCount > 1 && <button onClick={(e) => { e.stopPropagation(); onDismissTarget(c.id) }} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-line-strong px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-muted disabled:opacity-40 cursor-pointer"><Users className="h-3 w-3" /> Dismiss all {c.communityCount}</button>}
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            </div>
          </div>

          {/* Notify (pre-prepared, bilingual) + internal note */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {msgTargets.map((m) => <MacroSender key={m.recipientId} recipientId={m.recipientId} label={m.label} listingId={isListing ? t.listing!.id : null} conversationId={c.conversationId} />)}
            {t.isGuest && <span className="text-[10px] italic text-ink-4">Reported party is a guest — can&apos;t be messaged.</span>}
            <NoteEditor caseId={c.id} initial={c.internalNote} onSaved={refresh} />
          </div>
        </>
      )}
    </div>
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
    <div onClick={onSelect} className={cn('cursor-pointer rounded-xl border border-l-[3px] p-2.5 transition-colors', RAIL[c.bucket], active ? 'border-brand/40 bg-tint ring-1 ring-brand/40' : 'border-border bg-card hover:bg-muted/50')}>
      <div className="flex items-start gap-2">
        {!readOnly && onCheck && <input type="checkbox" checked={!!checked} onClick={(e) => e.stopPropagation()} onChange={onCheck} className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-brand" aria-label="Select case" />}
        {isListing && (
          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md bg-tint">
            {t.listing!.image ? <Image src={t.listing!.image} alt="" fill sizes="36px" className="object-cover" /> : null}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {c.appeal && <span className="rounded bg-amber-500 px-1 py-0.5 text-[9px] font-bold uppercase leading-none text-white">Appeal</span>}
            {c.bucket === 'critical' && !c.appeal && !readOnly && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />}
            <span className="truncate text-[13px] font-bold text-foreground">{REASON_LABEL[c.reason] || c.reason}</span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            <span className="capitalize text-ink-4">{t.kind}</span> · {t.name}
            {c.communityCount > 1 && <span className="font-semibold text-amber-700"> · ×{c.communityCount}</span>}
          </p>
        </div>
        <span className="shrink-0 text-[10px] text-ink-4">{c.ageDays <= 0 ? 'today' : `${c.ageDays}d`}</span>
      </div>
    </div>
  )
}

type FilterKey = 'all' | 'critical' | 'aging' | 'listing' | 'account' | 'chat' | 'resolved'

export function ModerationClient({ cases, resolved }: { cases: ModCase[]; resolved: ModCase[] }) {
  const router = useRouter()
  const [filter, setFilter] = useState<FilterKey>('all')
  const [sel, setSel] = useState(0)
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
    try { await post({ action, id, ...(severity ? { severity } : {}) }); refresh() } catch { /* stays */ } finally { setBusyId(null) }
  }
  const listingAct = async (action: string, listingId: string) => {
    setBusyId(listingId)
    try { await post({ action, id: listingId }); refresh() } catch { /* noop */ } finally { setBusyId(null) }
  }
  const dismissTarget = async (id: string) => {
    setBusyId(id)
    try { await post({ action: 'dismiss-target', id }); refresh() } catch { /* noop */ } finally { setBusyId(null) }
  }
  const bulk = async (action: 'bulk-dismiss' | 'bulk-confirm') => {
    const ids = [...checked]
    if (!ids.length) return
    setBulkBusy(true)
    try { await post({ action, ids, ...(action === 'bulk-confirm' ? { severity: bulkSev } : {}) }); setChecked(new Set()); refresh() } catch { /* noop */ } finally { setBulkBusy(false) }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showResolved) return
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
  }, [filtered, sel, showResolved])

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
        {CHIPS.map(([k, label]) => (
          <button key={k} onClick={() => { setFilter(k); setSel(0) }} className={cn('rounded-full px-3 py-1 text-xs font-semibold transition-colors cursor-pointer', filter === k ? 'bg-primary text-white' : 'bg-tint text-muted-foreground hover:bg-muted', k === 'critical' && counts.critical > 0 && filter !== k && 'text-red-700')}>
            {label} ({counts[k]})
          </button>
        ))}
        {!showResolved && <span className="ml-auto hidden items-center gap-1 text-[10px] text-ink-4 sm:inline-flex"><ChevronDown className="h-3 w-3" /> keys: j/k move · c confirm · d dismiss · a abusive</span>}
      </div>

      {!showResolved && checked.size > 0 && (
        <div className="sticky top-2 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-pop">
          <span className="text-xs font-bold text-foreground">{checked.size} selected{targetsOfChecked > 1 ? ` · ${targetsOfChecked} targets` : ''}</span>
          <button onClick={() => bulk('bulk-dismiss')} disabled={bulkBusy} className="rounded-md border border-line-strong px-2.5 py-1 text-[11px] font-bold text-foreground hover:bg-muted disabled:opacity-40 cursor-pointer">Dismiss selected</button>
          <span className="ml-1 flex items-center gap-1">
            <select value={bulkSev} onChange={(e) => setBulkSev(e.target.value)} className="rounded border border-line-strong bg-card px-1 py-0.5 text-[11px] cursor-pointer">{SEVERITIES.map((s) => <option key={s} value={s}>{s} {PENALTY[s]}</option>)}</select>
            <button onClick={() => bulk('bulk-confirm')} disabled={bulkBusy} className="rounded-md bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-red-700 disabled:opacity-40 cursor-pointer">Confirm selected</button>
          </span>
          {bulkBusy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <button onClick={() => setChecked(new Set())} className="ml-auto rounded-md px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted cursor-pointer">Clear</button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-ink-4">{showResolved ? <span className="inline-flex items-center gap-2"><ShieldQuestion className="h-4 w-4" /> No resolved reports yet.</span> : 'Nothing here. 🎉'}</div>
      ) : (
        <>
          {/* Narrow / non-desktop: original single-column full cards (each self-contained). */}
          <div className="space-y-3 lg:hidden">
            {filtered.map((c, i) => renderCard(c, i))}
          </div>

          {/* Desktop: master-detail. Left = compact list; right = the selected case in full. */}
          <div className="hidden lg:grid lg:grid-cols-[minmax(300px,380px)_1fr] lg:items-start lg:gap-4">
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
                <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-ink-4">Select a case to review.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
