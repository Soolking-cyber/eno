'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, MessageSquare, ExternalLink, Gavel, Clock, ShieldQuestion, Flag } from 'lucide-react'
import { cn } from '@/lib/utils'
import { shortDate } from '@/lib/dates'

// Admin enforcement console (EN-only, like the rest of /admin). Consumes
// GET /api/admin/enforcement (getAdmin re-checked server-side on every call) and
// posts lift/overturn/uphold_appeal/set-state/dismiss_flag. Four groups, most
// urgent first: pending appeals → buyer-waiting reports (>72h unanswered) →
// review flags (silent — the seller was never told) → active actions.

type QueueAction = {
  id: string
  profileId: string
  state: string
  reason: string
  adminNote: string | null
  triggerReportId: string | null
  decidedBy: string
  status: string
  expiresAt: string | null
  pulledCount: number
  appealText: string | null
  appealedAt: string | null
  appealOutcome: string | null
  createdAt: string
  profile: { displayName: string | null; email: string | null; trustScore: number; trustTier: string } | null
}

type BuyerWaiting = {
  id: string
  reason: string
  detail: string | null
  createdAt: string
  waitingHours: number
  listingId: string | null
  conversationId: string | null
  reporterProfileId: string | null
  targetProfileId: string | null
  targetSellerId: string | null
}

type Queue = { actions: QueueAction[]; flags?: QueueAction[]; appeals: QueueAction[]; buyerWaiting: BuyerWaiting[] }

const STATE_CLS: Record<string, string> = {
  warned: 'bg-warning/10 text-warning',
  throttled: 'bg-warning/10 text-warning',
  held: 'bg-destructive/10 text-destructive',
  suspended: 'bg-destructive/10 text-destructive',
  good_standing: 'bg-success/10 text-success',
}

const REASON_LABEL: Record<string, string> = {
  scam_hold: 'Scam hold (dues unpaid)',
  conduct_restricted: 'Conduct — score below 60',
  conduct_warning: 'Conduct warning (dual-threshold)',
  insurance_grace: '72h insurance grace',
  admin_manual: 'Manual (admin)',
  ban_evasion_review: 'Ban evasion — phone matches a suspended account',
  ban_evasion_email: 'Ban-evasion signal — email matches a suspended account',
  velocity_review: 'Velocity spike — positive events far above baseline',
}

const fmtAge = (iso: string) => {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  return h < 1 ? 'now' : h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`
}

function StateChip({ state }: { state: string }) {
  return <span className={cn('rounded-full px-2 py-0.5 text-3xs font-bold capitalize', STATE_CLS[state] ?? 'bg-tint text-ink-4')}>{state.replace('_', ' ')}</span>
}

function WhoLine({ a }: { a: QueueAction }) {
  return (
    <p className="truncate text-2xs text-muted-foreground">
      <span className="font-semibold text-foreground">{a.profile?.displayName || a.profile?.email || a.profileId.slice(0, 8)}</span>
      {a.profile?.email && a.profile.displayName ? ` · ${a.profile.email}` : ''}
      {a.profile ? <span className="text-ink-4"> · trust {a.profile.trustScore}{a.profile.trustTier !== 'standard' ? ` · ${a.profile.trustTier}` : ''}</span> : null}
    </p>
  )
}

function ActionMeta({ a }: { a: QueueAction }) {
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-muted-foreground">
      <span>{REASON_LABEL[a.reason] ?? a.reason}</span>
      <span className="text-ink-4">· by {a.decidedBy}</span>
      <span className="text-ink-4">· {fmtAge(a.createdAt)} ago</span>
      {a.expiresAt && <span className="text-ink-4">· expires {shortDate(a.expiresAt)}</span>}
      {a.pulledCount > 0 && <span className="font-semibold text-destructive">· {a.pulledCount} listing{a.pulledCount > 1 ? 's' : ''} pulled</span>}
      {a.status !== 'active' && <span className="font-semibold">· {a.status}</span>}
    </p>
  )
}

export function EnforcementClient() {
  const [queue, setQueue] = useState<Queue | null>(null)
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(() => {
    setFailed(false)
    fetch('/api/admin/enforcement')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('load'))))
      .then(setQueue)
      .catch(() => setFailed(true))
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (body: Record<string, unknown>, busyKey: string) => {
    setBusyId(busyKey)
    try {
      await fetch('/api/admin/enforcement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      load()
    } catch { /* stays — reload shows truth */ } finally { setBusyId(null) }
  }

  if (failed) {
    return (
      <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-ink-4">
        Couldn&apos;t load the enforcement queue. <button onClick={load} className="font-bold text-foreground underline cursor-pointer">Retry</button>
      </div>
    )
  }
  if (!queue) {
    return <div className="space-y-2.5">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 rounded-2xl shimmer" />)}</div>
  }

  const flags = queue.flags ?? []
  const empty = !queue.appeals.length && !queue.buyerWaiting.length && !flags.length && !queue.actions.length

  return (
    <div className="space-y-8">
      {empty && (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-ink-4">
          <span className="inline-flex items-center gap-2"><ShieldQuestion className="h-4 w-4" /> No appeals, waiting buyers or active actions. 🎉</span>
        </div>
      )}

      {/* 1 · Pending appeals — a human answer is owed; handled first. */}
      {queue.appeals.length > 0 && (
        <section>
          <h2 className="h-section text-foreground">Pending appeals ({queue.appeals.length})</h2>
          <p className="mt-0.5 mb-3 text-xs text-muted-foreground">Overturn lifts the action, restores pulled listings and resolves the appeal in the seller&apos;s favour. Uphold keeps the action and closes the appeal.</p>
          <div className="space-y-3">
            {queue.appeals.map((a) => (
              <div key={a.id} className="rounded-2xl border border-border border-l-[3px] border-l-amber-400 bg-card p-4 shadow-pop">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-lg bg-amber-500 px-1.5 py-0.5 text-3xs font-bold uppercase tracking-wide text-white">Appeal</span>
                  <StateChip state={a.state} />
                  <span className="ml-auto text-2xs text-ink-4">appealed {a.appealedAt ? fmtAge(a.appealedAt) : '?'} ago</span>
                </div>
                <div className="mt-1.5"><WhoLine a={a} /><ActionMeta a={a} /></div>
                {a.appealText && <p className="mt-2 rounded-lg bg-tint/40 p-2 text-xs text-foreground">“{a.appealText}”</p>}
                {a.adminNote && <p className="mt-1 text-2xs italic text-muted-foreground">Note to seller: {a.adminNote}</p>}
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <button onClick={() => act({ action: 'overturn', id: a.id }, a.id)} disabled={busyId === a.id} className="rounded-lg bg-foreground px-3 py-1 text-2xs font-bold text-background hover:opacity-90 disabled:opacity-40 cursor-pointer">Overturn (restore seller)</button>
                  <button onClick={() => act({ action: 'uphold_appeal', id: a.id }, a.id)} disabled={busyId === a.id} className="rounded-lg border border-line-strong px-2.5 py-1 text-2xs font-semibold text-foreground hover:bg-muted disabled:opacity-40 cursor-pointer">Uphold (decision stands)</button>
                  {busyId === a.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 2 · Buyer waiting — open reports the seller hasn't answered in 72h (oldest first). */}
      {queue.buyerWaiting.length > 0 && (
        <section>
          <h2 className="h-section text-foreground">Buyer waiting ({queue.buyerWaiting.length})</h2>
          <p className="mt-0.5 mb-3 text-xs text-muted-foreground">Open reports unanswered by the seller for over 72 hours — resolve them in <a href="/admin" className="font-semibold text-accent-foreground hover:underline">Moderation</a>, or suspend a clear bad actor here.</p>
          <div className="space-y-2">
            {queue.buyerWaiting.map((r) => (
              <div key={r.id} className="rounded-2xl border border-border border-l-[3px] border-l-red-500 bg-card p-3.5 shadow-pop">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-lg bg-red-100 px-1.5 py-0.5 text-3xs font-bold uppercase tracking-wide text-red-700"><Clock className="h-3 w-3" /> waiting {Math.floor(r.waitingHours / 24) > 0 ? `${Math.floor(r.waitingHours / 24)}d` : `${r.waitingHours}h`}</span>
                  <span className="text-sm font-bold capitalize text-foreground">{r.reason}</span>
                  <span className="ml-auto text-2xs text-ink-4">{shortDate(r.createdAt)}</span>
                </div>
                {r.detail && <p className="mt-1.5 text-xs text-foreground">“{r.detail}”</p>}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs">
                  {r.conversationId && <a href={`/admin/conversation/${r.conversationId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline"><MessageSquare className="h-3 w-3" /> View conversation</a>}
                  {r.listingId && <a href={`/listings/${r.listingId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline"><ExternalLink className="h-3 w-3" /> Listing</a>}
                  {r.targetSellerId && <a href={`/sellers/${r.targetSellerId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline"><ExternalLink className="h-3 w-3" /> Storefront</a>}
                  {/* Cheap manual suspend on the reported account (admin-decided: the system won't silently undo it). */}
                  {r.targetProfileId && (
                    <button
                      onClick={() => act({ action: 'set-state', profileId: r.targetProfileId, state: 'suspended', note: `Unanswered report ${r.id} (buyer waiting)` }, r.id)}
                      disabled={busyId === r.id}
                      className="ml-auto rounded-lg border border-red-200 px-2.5 py-1 text-2xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40 cursor-pointer"
                    >
                      Suspend account
                    </button>
                  )}
                  {busyId === r.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3 · Review flags (Phase 3) — SILENT annotations: the seller was never
          notified and their state never moved. Velocity spikes are usually a good
          week; email matches are often a shared mailbox — a human decides. */}
      {flags.length > 0 && (
        <section>
          <h2 className="h-section text-foreground">Review flags ({flags.length})</h2>
          <p className="mt-0.5 mb-3 text-xs text-muted-foreground">Silent flags — the seller was <span className="font-semibold">not</span> notified and nothing changed for them. Dismiss if it looks organic; Hold or Suspend if it doesn&apos;t (either also closes the flag).</p>
          <div className="space-y-2">
            {flags.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-border border-l-[3px] border-l-sky-400 bg-card p-3.5 shadow-pop">
                <Flag className="h-4 w-4 shrink-0 text-sky-500" />
                <StateChip state={a.state} />
                <div className="min-w-0 flex-1"><WhoLine a={a} /><ActionMeta a={a} /></div>
                <button onClick={() => act({ action: 'dismiss_flag', id: a.id }, a.id)} disabled={busyId === a.id} className="rounded-lg border border-line-strong px-2.5 py-1 text-2xs font-bold text-foreground hover:bg-muted disabled:opacity-40 cursor-pointer">Dismiss</button>
                <button onClick={() => act({ action: 'set-state', profileId: a.profileId, state: 'held', flagId: a.id, note: `Review flag ${a.reason}` }, a.id)} disabled={busyId === a.id} className="rounded-lg border border-amber-300 px-2.5 py-1 text-2xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-40 cursor-pointer">Hold</button>
                <button onClick={() => act({ action: 'set-state', profileId: a.profileId, state: 'suspended', flagId: a.id, note: `Review flag ${a.reason}` }, a.id)} disabled={busyId === a.id} className="rounded-lg border border-red-200 px-2.5 py-1 text-2xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40 cursor-pointer">Suspend</button>
                {busyId === a.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4 · Active actions — the current ladder state across the platform. */}
      {queue.actions.length > 0 && (
        <section>
          <h2 className="h-section text-foreground">Active actions ({queue.actions.length})</h2>
          <p className="mt-0.5 mb-3 text-xs text-muted-foreground">Lift restores pulled listings and resets the account to good standing. System actions also step down on their own as the derived state improves.</p>
          <div className="space-y-2">
            {queue.actions.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3.5 shadow-pop">
                <Gavel className="h-4 w-4 shrink-0 text-ink-4" />
                <StateChip state={a.state} />
                <div className="min-w-0 flex-1"><WhoLine a={a} /><ActionMeta a={a} /></div>
                <button onClick={() => act({ action: 'lift', id: a.id }, a.id)} disabled={busyId === a.id} className="rounded-lg border border-line-strong px-2.5 py-1 text-2xs font-bold text-foreground hover:bg-muted disabled:opacity-40 cursor-pointer">Lift</button>
                {busyId === a.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
