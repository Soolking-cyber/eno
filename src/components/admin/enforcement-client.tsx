'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, MessageSquare, ExternalLink, Gavel, Clock, ShieldQuestion, Flag } from '@/components/ui/icons'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { shortDate } from '@/lib/dates'
import { TRUST } from '@/lib/trust-math'
import { ENFORCEMENT } from '@/lib/enforcement-machine'

// Mirrors SCAM_RELEASE_PLAN_MIN (src/lib/scam-hold.ts — server-only, so not importable here). The
// server is the authority and answers `plan_required` with its own minimum; this only keeps the
// button honest.
const RELEASE_PLAN_MIN = 30

// Admin enforcement console (EN-only, like the rest of /admin). Consumes
// GET /api/admin/enforcement (getAdmin re-checked server-side on every call) and
// posts lift/overturn/uphold_appeal/set-state/dismiss_flag/release_scam_hold/overturn_scam. Four
// groups, most urgent first: pending appeals → buyer-waiting reports (>72h unanswered) →
// review flags (silent — the seller was never told) → active actions.
//
// ⛔ A SCAM HOLD HAS NO "LIFT" (2026-09-23). It is derived from the trust ledger and the daily sync
// re-applies it, so a lift was undone within a day. Its row offers RELEASE (the seller's plan,
// ≥14 days after confirmation, no open report, verified identity — the server enforces them all) and
// OVERTURN REPORT (a confirmed report was wrong). Any other row whose lift the server refuses with
// `scam_hold_use_release` (an admin suspension on top of a scam hold) grows the same two controls.
// ⚠️ THE OVERTURN NAMES ITS REPORTS (review, 2026-09-24). The dialog loads the account's standing
// scam charges (GET ?charges=<actionId>) and the admin ticks the one(s) found wrong — an overturn used
// to reverse every charge on the account, a second victim's valid report included.

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

/** One standing scam charge (src/lib/scam-hold.ts ScamChargeView) — what the overturn dialog lists. */
type ChargeView = {
  reportId: string | null
  stage: 'held' | 'released'
  confirmedAt: string
  listingId: string | null
  reason: string | null
  reportStatus: string | null
}

/**
 * The charge(s) ticked when the dialog opens: the report that triggered the action, when it is still a
 * standing charge; else the only charge, when there is exactly one. Otherwise NOTHING — with two or
 * more charges the admin must choose, because an overturn tells each chosen report's reporter "no
 * violation".
 */
export function defaultOverturnPick(charges: ChargeView[], triggerReportId: string | null): string[] {
  const reportable = charges.filter((c) => c.reportId)
  if (triggerReportId && reportable.some((c) => c.reportId === triggerReportId)) return [triggerReportId]
  if (charges.length === 1 && reportable.length === 1) return [reportable[0].reportId as string]
  return []
}

/**
 * What the overturn dialog may submit. With charges standing, the admin's ticks — and nothing until
 * something is ticked. With NO charge standing (a stale row: the reports were already reversed, the
 * re-derive never landed) there is nothing to tick, and the overturn is sent without a selection:
 * the server ends the stale row (scam-hold.ts). Before this the button stayed disabled on an empty
 * list, so a stale row could only be cleared through Release, with a plan (agy, review 2026-09-24).
 */
export function overturnSubmission(charges: ChargeView[] | null, picked: ReadonlySet<string>): { ok: false } | { ok: true; reportIds?: string[] } {
  if (charges === null) return { ok: false }
  if (charges.length === 0) return { ok: true }
  return picked.size ? { ok: true, reportIds: [...picked] } : { ok: false }
}

const STATE_VARIANT: Record<string, 'warning' | 'destructive' | 'success'> = {
  warned: 'warning',
  throttled: 'warning',
  held: 'destructive',
  suspended: 'destructive',
  good_standing: 'success',
}

const REASON_LABEL: Record<string, string> = {
  scam_hold: 'Scam hold (awaiting release)',
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

// Compact decision-control idiom for these dense rows (rounded-lg per the canon's
// dense-admin-surface tier); Button size="none" so the padding here is the whole story.
const DECIDE = 'rounded-lg px-2.5 py-1 text-2xs disabled:opacity-40 cursor-pointer'

function StateChip({ state }: { state: string }) {
  return <Badge variant={STATE_VARIANT[state] ?? 'neutral'} className="capitalize">{state.replace('_', ' ')}</Badge>
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

/** A refusal from the console API, in words. Unknown codes fall back to the generic line. */
function refusalText(d: Record<string, unknown>): string | null {
  switch (d.error) {
    case 'scam_hold_use_release':
      return 'This account has a scam charge nobody has released — a lift would be undone by the next daily sync. Release it, or overturn the report.'
    case 'open_reports': {
      const n = Number(d.count) || 0
      return `Not released: ${n} report${n === 1 ? '' : 's'} against this seller ${n === 1 ? 'is' : 'are'} still open (an appeal of the charge counts). Decide ${n === 1 ? 'it' : 'them'} in Moderation first — other victims coming forward is what the wait is for.`
    }
    case 'choose_reports':
      return 'Choose which report(s) to overturn — the account has more than one scam charge, or the selection is out of date. The list has been refreshed.'
    case 'release_too_soon':
      return `Too soon to release: allowed from ${shortDate(String(d.eligibleAt))} (${TRUST.SCAM_RELEASE_MIN_DAYS} days after the report was confirmed).`
    case 'identity_unverified':
      return 'Not released: the seller has no live verified identity. Ask them to verify first (Dashboard → Verification).'
    case 'identity_linked': {
      const ids = Array.isArray(d.linkedProfileIds) ? (d.linkedProfileIds as string[]).map((x) => x.slice(0, 8)).join(', ') : ''
      return `Not released: the seller's identity is shared with another held or suspended account${ids ? ` (${ids})` : ''}.`
    }
    case 'plan_required':
      return `Write the seller's plan first — at least ${Number(d.min) || RELEASE_PLAN_MIN} characters.`
    case 'no_scam_hold':
      return 'Nothing to release or overturn — no scam charge is holding this account.'
    case 'legacy_charge':
      return 'This hold comes from a legacy charge with no report, which cannot be overturned — use Release.'
    case 'not_active':
      return 'That action is no longer active.'
    default:
      return null
  }
}

export function EnforcementClient() {
  const [queue, setQueue] = useState<Queue | null>(null)
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Suspend awaiting the destructive confirm (alert-dialog, same idiom as admin-listings).
  const [pendingSuspend, setPendingSuspend] = useState<{ body: Record<string, unknown>; busyKey: string } | null>(null)
  // Scam-hold decisions: the release form and the overturn confirm, each for one action row.
  const [releaseFor, setReleaseFor] = useState<QueueAction | null>(null)
  const [plan, setPlan] = useState('')
  const [overturnFor, setOverturnFor] = useState<{ a: QueueAction; action: 'overturn' | 'overturn_scam' } | null>(null)
  // The overturn dialog's charge list (null while loading) and the admin's selection (report ids).
  const [charges, setCharges] = useState<ChargeView[] | null>(null)
  const [chargesFailed, setChargesFailed] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const chargesReq = useRef(0) // a late answer for a row the admin already left must not land
  // Rows whose plain lift was refused because a scam charge sits underneath — they grow the controls.
  const [scamRows, setScamRows] = useState<Set<string>>(() => new Set())

  const load = useCallback(() => {
    setFailed(false)
    fetch('/api/admin/enforcement')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('load'))))
      .then(setQueue)
      .catch(() => setFailed(true))
  }, [])
  useEffect(() => { load() }, [load])

  /**
   * POST one decision. Returns the response body on success, null on any failure (already toasted);
   * `onRefused` sees a refusal's body (the overturn dialog refreshes its list from `choose_reports`).
   */
  const act = async (body: Record<string, unknown>, busyKey: string, onRefused?: (d: Record<string, unknown>) => void): Promise<Record<string, unknown> | null> => {
    setBusyId(busyKey)
    try {
      const res = await fetch('/api/admin/enforcement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        toast.error(refusalText(d) ?? 'Action failed — nothing changed. Try again.')
        if (d.error === 'scam_hold_use_release' && typeof body.id === 'string') setScamRows((prev) => new Set(prev).add(body.id as string))
        onRefused?.(d)
        return null
      }
      // Seller identity gate (only while enforced): a lift restores pulled listings, but those of an
      // owner who cannot publish yet are parked until they verify — say so, or the lift reads as
      // "everything is back" while some of it is not.
      if (Number(d.held) > 0) toast.warning(`${Number(d.held)} listing(s) held until the seller verifies their identity.`)
      return d
    } catch {
      toast.error('Action failed — network error. Try again.')
      return null
    } finally {
      setBusyId(null)
      load() // reload shows truth either way
    }
  }

  const submitRelease = async () => {
    if (!releaseFor) return
    const d = await act({ action: 'release_scam_hold', id: releaseFor.id, plan }, releaseFor.id)
    if (!d) return // the dialog stays open with the plan still typed
    // The server re-derives and reports the state that ACTUALLY resulted — an admin action on top,
    // or a failed sync, leaves it elsewhere, and the console must not claim otherwise.
    const state = String(d.state ?? '')
    if (state === 'held' || state === 'suspended') toast.warning(`Release recorded, but the account is still ${state} — another action is holding it.`)
    else toast.success(`Released — the account is now ${state.replace('_', ' ')}.`)
    setReleaseFor(null)
    setPlan('')
  }

  /** Open the overturn dialog for a row and load the account's standing charges into it. */
  const openOverturn = (a: QueueAction) => {
    const req = ++chargesReq.current
    setOverturnFor({ a, action: a.reason === 'scam_hold' ? 'overturn' : 'overturn_scam' })
    setCharges(null)
    setChargesFailed(false)
    setPicked(new Set())
    fetch(`/api/admin/enforcement?charges=${encodeURIComponent(a.id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('charges'))))
      .then((d: { charges?: ChargeView[] }) => {
        if (req !== chargesReq.current) return
        const list = d.charges ?? []
        setCharges(list)
        setPicked(new Set(defaultOverturnPick(list, a.triggerReportId)))
      })
      .catch(() => { if (req === chargesReq.current) setChargesFailed(true) })
  }

  const closeOverturn = () => {
    chargesReq.current++
    setOverturnFor(null)
  }

  const submitOverturn = async () => {
    const sub = overturnSubmission(charges, picked)
    if (!overturnFor || !sub.ok) return
    const d = await act({ action: overturnFor.action, id: overturnFor.a.id, ...(sub.reportIds ? { reportIds: sub.reportIds } : {}) }, overturnFor.a.id, (refused) => {
      // The server's own list is the truth now: show it and make the admin choose again.
      if (refused.error === 'choose_reports' && Array.isArray(refused.charges)) {
        setCharges(refused.charges as ChargeView[])
        setPicked(new Set())
      }
    })
    if (!d) return // refused: the dialog stays open on the (refreshed) list
    // Say what ACTUALLY happened: how many reports were reversed, and whether the account is still held.
    const state = String(d.state ?? '').replace('_', ' ')
    const n = Number(d.charges) || 0
    const remaining = Number(d.remaining) || 0
    if (n === 0) toast.success(`No scam charge was left to overturn — the stale hold was ended. The account is now ${state}.`)
    else if (remaining > 0) toast.warning(`Overturned ${n} report${n === 1 ? '' : 's'}, but ${remaining} other scam charge${remaining === 1 ? '' : 's'} still hold${remaining === 1 ? 's' : ''} the account — it is ${state}.`)
    else toast.success(`Overturned ${n} report${n === 1 ? '' : 's'} — the account is now ${state}.`)
    closeOverturn()
  }

  /** Release + Overturn-report controls for a scam-held account's row. */
  const scamControls = (a: QueueAction) => (
    <>
      <Button variant="outline" size="none" onClick={() => { setPlan(''); setReleaseFor(a) }} disabled={busyId === a.id} className={`${DECIDE} border-line-strong bg-transparent font-bold text-foreground hover:bg-muted hover:text-foreground`}>Release…</Button>
      <Button variant="outline" size="none" onClick={() => openOverturn(a)} disabled={busyId === a.id} className={`${DECIDE} border-line-strong bg-transparent font-semibold text-foreground hover:bg-muted hover:text-foreground`}>Overturn report…</Button>
    </>
  )

  if (failed) {
    return (
      <EmptyState
        tone="admin"
        title="Couldn't load the enforcement queue."
        action={<Button variant="outline" size="sm" onClick={load} className="font-bold">Retry</Button>}
      />
    )
  }
  if (!queue) {
    return <div className="space-y-2.5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
  }

  const flags = queue.flags ?? []
  const empty = !queue.appeals.length && !queue.buyerWaiting.length && !flags.length && !queue.actions.length

  return (
    <div className="space-y-8">
      {empty && (
        <EmptyState tone="admin" icon={ShieldQuestion} title="No appeals, waiting buyers or active actions. 🎉" />
      )}

      {/* 1 · Pending appeals — a human answer is owed; handled first. */}
      {queue.appeals.length > 0 && (
        <section>
          <h2 className="h-section text-foreground">Pending appeals ({queue.appeals.length})</h2>
          <p className="mt-0.5 mb-3 text-xs text-muted-foreground">Overturn lifts the action, restores pulled listings and resolves the appeal in the seller&apos;s favour. Uphold keeps the action and closes the appeal.</p>
          <div className="space-y-3">
            {queue.appeals.map((a) => (
              <Card key={a.id} size="sm" className="block border-l-[3px] border-l-warning p-4 shadow-pop">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge className="bg-warning uppercase tracking-wide text-white">Appeal</Badge>
                  <StateChip state={a.state} />
                  <span className="ml-auto text-2xs text-ink-4">appealed {a.appealedAt ? fmtAge(a.appealedAt) : '?'} ago</span>
                </div>
                <div className="mt-1.5"><WhoLine a={a} /><ActionMeta a={a} /></div>
                {a.appealText && <p className="mt-2 rounded-lg bg-tint/40 p-2 text-xs text-foreground">“{a.appealText}”</p>}
                {a.adminNote && <p className="mt-1 text-2xs italic text-muted-foreground">Note to seller: {a.adminNote}</p>}
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {a.reason === 'scam_hold' || scamRows.has(a.id) ? (
                    scamControls(a)
                  ) : (
                    <Button variant="cta" size="none" onClick={() => act({ action: 'overturn', id: a.id }, a.id)} disabled={busyId === a.id} className="rounded-lg px-3 py-1 text-2xs disabled:opacity-40 cursor-pointer">Overturn (restore seller)</Button>
                  )}
                  <Button variant="outline" size="none" onClick={() => act({ action: 'uphold_appeal', id: a.id }, a.id)} disabled={busyId === a.id} className={`${DECIDE} border-line-strong bg-transparent font-semibold text-foreground hover:bg-muted hover:text-foreground`}>Uphold (decision stands)</Button>
                  {busyId === a.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </div>
              </Card>
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
              <Card key={r.id} size="sm" className="block border-l-[3px] border-l-destructive p-3.5 shadow-pop">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="destructive" className="uppercase tracking-wide"><Clock className="h-3 w-3" /> waiting {Math.floor(r.waitingHours / 24) > 0 ? `${Math.floor(r.waitingHours / 24)}d` : `${r.waitingHours}h`}</Badge>
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
                    <Button
                      variant="outline"
                      size="none"
                      onClick={() => setPendingSuspend({ body: { action: 'set-state', profileId: r.targetProfileId, state: 'suspended', note: `Unanswered report ${r.id} (buyer waiting)` }, busyKey: r.id })}
                      disabled={busyId === r.id}
                      className={`${DECIDE} ml-auto border-destructive/30 bg-transparent font-semibold text-destructive hover:bg-destructive/5 hover:text-destructive`}
                    >
                      Suspend account
                    </Button>
                  )}
                  {busyId === r.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </div>
              </Card>
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
              <Card key={a.id} size="sm" className="flex-row flex-wrap items-center gap-2 border-l-[3px] border-l-info p-3.5 shadow-pop">
                <Flag className="h-4 w-4 shrink-0 text-info" />
                <StateChip state={a.state} />
                <div className="min-w-0 flex-1"><WhoLine a={a} /><ActionMeta a={a} /></div>
                <Button variant="outline" size="none" onClick={() => act({ action: 'dismiss_flag', id: a.id }, a.id)} disabled={busyId === a.id} className={`${DECIDE} border-line-strong bg-transparent font-bold text-foreground hover:bg-muted hover:text-foreground`}>Dismiss</Button>
                <Button variant="outline" size="none" onClick={() => act({ action: 'set-state', profileId: a.profileId, state: 'held', flagId: a.id, note: `Review flag ${a.reason}` }, a.id)} disabled={busyId === a.id} className={`${DECIDE} border-warning/40 bg-transparent font-semibold text-warning hover:bg-warning/10 hover:text-warning`}>Hold</Button>
                <Button variant="outline" size="none" onClick={() => setPendingSuspend({ body: { action: 'set-state', profileId: a.profileId, state: 'suspended', flagId: a.id, note: `Review flag ${a.reason}` }, busyKey: a.id })} disabled={busyId === a.id} className={`${DECIDE} border-destructive/30 bg-transparent font-semibold text-destructive hover:bg-destructive/5 hover:text-destructive`}>Suspend</Button>
                {busyId === a.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* 4 · Active actions — the current ladder state across the platform. */}
      {queue.actions.length > 0 && (
        <section>
          <h2 className="h-section text-foreground">Active actions ({queue.actions.length})</h2>
          <p className="mt-0.5 mb-3 text-xs text-muted-foreground">Lift restores pulled listings and resets the account to good standing. System actions also step down on their own as the derived state improves — except a scam hold, which only a person ends: Release it ({TRUST.SCAM_RELEASE_MIN_DAYS}+ days after the report was confirmed, no open report, verified identity, the seller&apos;s written plan) or overturn the report(s) found wrong.</p>
          <div className="space-y-2">
            {queue.actions.map((a) => (
              <Card key={a.id} size="sm" className="flex-row flex-wrap items-center gap-2 p-3.5 shadow-pop">
                <Gavel className="h-4 w-4 shrink-0 text-ink-4" />
                <StateChip state={a.state} />
                <div className="min-w-0 flex-1"><WhoLine a={a} /><ActionMeta a={a} /></div>
                {a.reason !== 'scam_hold' && (
                  <Button variant="outline" size="none" onClick={() => act({ action: 'lift', id: a.id }, a.id)} disabled={busyId === a.id} className={`${DECIDE} border-line-strong bg-transparent font-bold text-foreground hover:bg-muted hover:text-foreground`}>Lift</Button>
                )}
                {(a.reason === 'scam_hold' || scamRows.has(a.id)) && scamControls(a)}
                {busyId === a.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Scam-hold RELEASE — the plan goes on the audit record; the server enforces the rules. */}
      <AlertDialog open={releaseFor !== null} onOpenChange={(open) => { if (!open) setReleaseFor(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release scam hold</AlertDialogTitle>
            <AlertDialogDescription>
              The listings the hold pulled come back — except the listing a confirmed report was about, which stays down (approve it in Moderation if it should return). The confirmed report stays on their record at full weight, so they may stay throttled with a caution note. Posting comes back, capped: while the charge stands they can hold at most {ENFORCEMENT.SCAM_RELEASED.MAX_ACTIVE_LISTINGS} active listings (the restored ones count), so new posts and relists are refused at the limit. Allowed only {TRUST.SCAM_RELEASE_MIN_DAYS}+ days after the report was confirmed, with no report against the seller still open, and only for a seller with a verified identity not shared with another held or suspended account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {releaseFor?.appealText && <p className="rounded-lg bg-tint/40 p-2 text-xs text-foreground">Seller wrote: “{releaseFor.appealText}”</p>}
          <Textarea
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            placeholder="The seller's plan: what happened, what they changed, how it won't happen again (goes on the audit record)"
            aria-label="Seller's plan"
            rows={5}
            maxLength={2000}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              closeOnClick={false} // closes when the server has ANSWERED — a refusal keeps the plan on screen
              disabled={plan.trim().length < RELEASE_PLAN_MIN || (releaseFor !== null && busyId === releaseFor.id)}
              onClick={() => { void submitRelease() }}
            >
              {releaseFor !== null && busyId === releaseFor.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Release'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Scam-hold OVERTURN — the report(s) the admin TICKS were wrong; nothing else is reversed. */}
      <AlertDialog open={overturnFor !== null} onOpenChange={(open) => { if (!open) closeOverturn() }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Overturn scam report(s)</AlertDialogTitle>
            <AlertDialogDescription>
              Marks only the report(s) you tick as overturned, removes those charges from the seller&apos;s trust record and tells their reporters the case closed with no violation. The hold ends — and the pulled listings come back — only if no other held charge is left. The listing an overturned report was about stays down; approve it in Moderation if it should return.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {charges === null ? (
            chargesFailed
              ? <p className="text-xs text-destructive">Couldn&apos;t load this account&apos;s scam charges. Close the dialog and try again.</p>
              : <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <div className="space-y-1.5">
              <p className="text-2xs text-muted-foreground">{charges.length} scam charge{charges.length === 1 ? '' : 's'} on this account{picked.size ? ` · ${picked.size} selected` : ''}</p>
              {charges.length === 0 && <p className="text-xs text-foreground">No scam charge stands any more — this hold is stale. Overturning ends it; no report is reversed.</p>}
              {charges.map((c) => (
                <label key={c.reportId ?? c.confirmedAt} className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2 text-xs">
                  <Checkbox
                    checked={!!c.reportId && picked.has(c.reportId)}
                    disabled={!c.reportId}
                    onChange={(next) => {
                      if (!c.reportId) return
                      const id = c.reportId
                      setPicked((prev) => { const n = new Set(prev); if (next) n.add(id); else n.delete(id); return n })
                    }}
                    className="mt-0.5 h-3.5 w-3.5"
                  />
                  <span className="min-w-0">
                    <span className="font-semibold text-foreground">{c.reportId ? `Report ${c.reportId.slice(0, 8)}` : 'Legacy charge (no report)'}</span>
                    <span className="text-ink-4"> · {c.stage === 'held' ? 'holding the account' : 'released'} · confirmed {shortDate(c.confirmedAt)}{c.reason ? ` · ${c.reason}` : ''}{c.listingId ? ` · listing ${c.listingId.slice(0, 8)}` : ''}</span>
                    {!c.reportId && <span className="block text-2xs text-muted-foreground">Has no report, so it cannot be overturned — use Release.</span>}
                  </span>
                </label>
              ))}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              closeOnClick={false} // closes when the server has ANSWERED — a refusal keeps the list on screen
              disabled={!overturnSubmission(charges, picked).ok || (overturnFor !== null && busyId === overturnFor.a.id)}
              onClick={() => { void submitOverturn() }}
            >
              {overturnFor !== null && busyId === overturnFor.a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : picked.size ? `Overturn ${picked.size} report${picked.size === 1 ? '' : 's'}` : charges?.length === 0 ? 'End stale hold' : 'Overturn'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Destructive confirm for suspend (both call sites route here). */}
      <AlertDialog open={pendingSuspend !== null} onOpenChange={(open) => { if (!open) setPendingSuspend(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suspend account</AlertDialogTitle>
            <AlertDialogDescription>Suspend this account? Their active listings are pulled and the seller is locked out until an admin lifts it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (pendingSuspend) void act(pendingSuspend.body, pendingSuspend.busyKey); setPendingSuspend(null) }}
            >
              Suspend
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
