'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Check, EyeOff, Undo2 } from '@/components/ui/icons'

/**
 * THE TWO LICENCE DECISIONS, ON ONE GROUP OF LISTINGS (owner, 2026-10-14) — rendered by Admin › Catalogue › Licence checks
 * (licence-checks.tsx), which decides where each one sits:
 *   · 'licence-approve' on a group waiting for a check — the one action that stamps a row (src/lib/licence-stamp.ts).
 *     It sends `seen`: per id, the stamp of the values the admin is LOOKING AT, so the route refuses as stale a row
 *     whose values changed after the page rendered — an approval is of what was on screen;
 *   · 'licence-revoke' on an approved group (Quy chế Article 5: the licence expired, was revoked or changed) — clears the
 *     stamp and unpublishes until it is checked again. `unapproved` is the same action on a row that is live without
 *     ever having been approved (the tab's "live without a checked licence" section): it says Unpublish instead, and does
 *     now what the 00:00 ICT sweep would do.
 * ⚠️ THE CONFIRMATION REPEATS THE NAME, THE NUMBER AND THE COUNT, verbatim and in translate="no": a one-click approval of
 * fourteen listings must name exactly what it approves.
 * The route answers counts (zero ones omitted); each becomes its own toast so "approved 14" never hides "2 still held".
 * Then the server render is refreshed — the groups move between sections. Admin chrome: English only.
 */
export type LicenceAction = 'licence-approve' | 'licence-revoke'

export type LicenceSummary = { legalName: string; licenceNo: string; seller: string; aisle: string; enterpriseCode?: boolean }

/** A count from the route: a number, or (defensively) the list of ids it counted. Absent is 0. */
const count = (v: unknown): number => (typeof v === 'number' ? v : Array.isArray(v) ? v.length : 0)
const listings = (n: number) => `${n} listing${n === 1 ? '' : 's'}`

function reportApproval(d: Record<string, unknown>) {
  const approved = count(d.approved)
  // `affected` counts every row the approval cleared; `notLive` those of them the seller had hidden or marked sold —
  // cleared, but on sale only once relisted — so "published" is what buyers can see now.
  const notLive = count(d.notLive)
  const published = Math.max(0, count(d.affected) - notLive)
  const held = count(d.held)
  const alreadyHeld = count(d.alreadyHeld)
  const stillHeld = count(d.stillHeld)
  const stale = count(d.stale)
  const invalid = count(d.invalid)
  if (approved > 0) toast.success(`Approved ${listings(approved)} · ${published} published`)
  if (notLive > 0) toast.info(`${listings(notLive)} cleared but hidden or sold by the seller — live once they relist.`)
  // The seller identity gate (only while enforced): approved, but parked until the owner verifies.
  if (held > 0) toast.warning(`${held} held until the seller verifies their identity — they publish automatically once verified.`)
  if (alreadyHeld > 0) toast.info(`${alreadyHeld} were already held for the seller's identity check — still waiting for them to verify.`)
  // Approve publishes pure holds only: a reported row, a pulled owner's, a Restricted storefront's, or one a moderator
  // took down stays down — the tab's "Approved, still unpublished" says which.
  if (stillHeld > 0) toast.info(`${stillHeld} approved but still unpublished: an open or confirmed report, the owner's account held or suspended, a Restricted storefront, or taken down by a moderator — see “Approved, still unpublished”.`)
  if (stale > 0) toast.warning(`${stale} changed since you opened the page — it has reloaded: check the values again.`)
  if (invalid > 0) toast.error(`${invalid} cannot be approved: no longer in a licence aisle, eno's desk, or the values are missing or invalid.`)
  if (!approved && !stale && !invalid) toast.info('Nothing changed — already approved.')
}

export function LicenceActionButton({ action, ids, seen, summary, unapproved = false, grandfatherUnresolved = false }: {
  action: LicenceAction
  ids: string[]
  /** licence-approve only: the stamp of the values on screen, per id. */
  seen?: Record<string, string>
  summary: LicenceSummary
  /** licence-revoke on a row that was never approved — labelled Unpublish. */
  unapproved?: boolean
  /** …on VietKite's grandfathered rows while the grandfather does not resolve: the sweep leaves them alone, so this is
   *  the only way down — and nothing brings them back but an approval of values VietKite has not typed yet. */
  grandfatherUnresolved?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const approve = action === 'licence-approve'
  const verb = approve ? 'approve' : unapproved ? 'unpublish' : 'revoke'
  const label = approve ? 'Approve' : unapproved ? 'Unpublish' : 'Revoke licence check'
  const n = ids.length
  // The tab carries one of these per group, so the name says WHICH group — starting with the visible label (WCAG 2.5.3).
  const accessibleName = `${label} — ${summary.legalName || summary.seller} (${listings(n)})`

  const run = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/admin/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids, ...(seen ? { seen } : {}) }),
      })
      const d = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!res.ok || !d) {
        setError(`Could not ${verb}: ${typeof d?.error === 'string' ? d.error : `HTTP ${res.status}`}.`)
        return
      }
      setOpen(false)
      if (approve) reportApproval(d)
      else {
        const affected = count(d.affected)
        if (!affected) toast.info('Nothing changed — already unpublished, or no longer in a licence aisle.')
        else if (unapproved) toast.success(`Unpublished ${listings(affected)} — they wait for a licence check.`)
        else toast.success(`Licence check revoked · ${listings(affected)} unpublished until checked again`)
      }
      router.refresh()
    } catch {
      setError(`Could not ${verb}: the server did not answer. Try again.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setError('') }}>
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant={approve ? 'default' : 'outline'}
            aria-label={accessibleName}
            className={approve ? undefined : 'text-destructive hover:text-destructive'}
            title={approve ? undefined : unapproved ? 'Live without a checked licence: unpublish it now' : 'Expired, revoked or changed: unpublishes until checked again'}
          />
        }
      >
        {approve ? <Check className="h-4 w-4" /> : unapproved ? <EyeOff className="h-4 w-4" /> : <Undo2 className="h-4 w-4" />}
        {label}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {approve ? `Approve this licence for ${listings(n)}?` : unapproved ? `Unpublish ${listings(n)}?` : `Revoke the licence check on ${listings(n)}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {approve
              ? 'Approve only if both values match the licence and business registration in the support mailbox, character for character. Each listing that nothing else holds is published now; any later change of either value sends it back for a check.'
              : unapproved && grandfatherUnresolved
                ? 'VietKite’s grandfather does not resolve, so the daily sweep leaves these listings alone. This unpublishes them now, and it cannot be undone here: they come back only once their values are entered and approved.'
                : unapproved
                ? 'They are live without a checked licence. This does now what the 00:00 ICT sweep would do: they stay unpublished until a licence check is approved.'
                : 'For a licence that has expired, been revoked or changed: unpublishes until checked again. The listings go back to waiting for a check, with their values as they are.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-xl bg-tint px-3 py-2 text-sm">
          <dt className="text-muted-foreground">Registered name</dt>
          <dd className="break-words font-semibold text-foreground">
            {summary.legalName ? <span translate="no">{summary.legalName}</span> : <span className="font-normal text-ink-4">not entered</span>}
          </dd>
          <dt className="text-muted-foreground">Licence no.</dt>
          <dd className="break-all text-foreground">
            {summary.licenceNo ? <span translate="no" className="font-mono">{summary.licenceNo}</span> : <span className="text-ink-4">not entered</span>}
          </dd>
          <dt className="text-muted-foreground">Seller</dt>
          <dd className="break-words text-foreground">{summary.seller}</dd>
          <dt className="text-muted-foreground">Listings</dt>
          <dd className="text-foreground">{n} · {summary.aisle}</dd>
        </dl>
        {approve && summary.enterpriseCode && (
          <p className="text-xs text-warning">This number has the shape of a phone number: approve only if it is the enterprise code on the registration certificate.</p>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={approve ? 'default' : 'destructive'} disabled={busy} onClick={run}>
            {label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
