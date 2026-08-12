'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, MessageSquare, ExternalLink, Gavel, Clock, ShieldQuestion, Flag } from '@/components/ui/icons'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
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

const STATE_VARIANT: Record<string, 'warning' | 'destructive' | 'success'> = {
  warned: 'warning',
  throttled: 'warning',
  held: 'destructive',
  suspended: 'destructive',
  good_standing: 'success',
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

export function EnforcementClient() {
  const [queue, setQueue] = useState<Queue | null>(null)
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Suspend awaiting the destructive confirm (alert-dialog, same idiom as admin-listings).
  const [pendingSuspend, setPendingSuspend] = useState<{ body: Record<string, unknown>; busyKey: string } | null>(null)

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
      const res = await fetch('/api/admin/enforcement', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) toast.error('Action failed — nothing changed. Try again.')
      load() // reload shows truth either way
    } catch { toast.error('Action failed — network error. Try again.') } finally { setBusyId(null) }
  }

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
                  <Button variant="cta" size="none" onClick={() => act({ action: 'overturn', id: a.id }, a.id)} disabled={busyId === a.id} className="rounded-lg px-3 py-1 text-2xs disabled:opacity-40 cursor-pointer">Overturn (restore seller)</Button>
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
          <p className="mt-0.5 mb-3 text-xs text-muted-foreground">Lift restores pulled listings and resets the account to good standing. System actions also step down on their own as the derived state improves.</p>
          <div className="space-y-2">
            {queue.actions.map((a) => (
              <Card key={a.id} size="sm" className="flex-row flex-wrap items-center gap-2 p-3.5 shadow-pop">
                <Gavel className="h-4 w-4 shrink-0 text-ink-4" />
                <StateChip state={a.state} />
                <div className="min-w-0 flex-1"><WhoLine a={a} /><ActionMeta a={a} /></div>
                <Button variant="outline" size="none" onClick={() => act({ action: 'lift', id: a.id }, a.id)} disabled={busyId === a.id} className={`${DECIDE} border-line-strong bg-transparent font-bold text-foreground hover:bg-muted hover:text-foreground`}>Lift</Button>
                {busyId === a.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </Card>
            ))}
          </div>
        </section>
      )}

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
