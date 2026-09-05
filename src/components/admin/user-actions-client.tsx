'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from '@/components/ui/icons'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ENFORCEMENT_STATES } from '@/lib/enforcement-machine'

// The actions an admin may take on one account. Each is a POST to an admin API that re-checks
// getAdmin(); the page gate is UX. Two of them are irreversible for the person (revoke, erase), so
// both need a written reason and erasure needs the email retyped — the wrong account, not a
// drive-by click, is the failure mode on this screen.
export function UserActionsClient({ profileId, email, phone, verificationStatus, enforcementState, isAdmin }: {
  profileId: string
  email: string | null
  phone: string | null
  verificationStatus: string
  enforcementState: string
  isAdmin: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [revokeReason, setRevokeReason] = useState('')
  const [stateOpen, setStateOpen] = useState(false)
  const [nextState, setNextState] = useState<string>(enforcementState)
  const [stateReason, setStateReason] = useState('')
  const [stateDays, setStateDays] = useState('')
  const [eraseOpen, setEraseOpen] = useState(false)
  const [eraseReason, setEraseReason] = useState('')
  const [eraseEmail, setEraseEmail] = useState('')

  const post = async (url: string, body: Record<string, unknown>, key: string): Promise<Record<string, unknown> | null> => {
    setBusy(key)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) { toast.error(`Failed: ${String(data.error ?? res.status)}`); return null }
      return data
    } catch {
      toast.error('Network error — nothing changed.')
      return null
    } finally {
      setBusy(null)
    }
  }

  const canRevoke = ['verified', 'expired'].includes(verificationStatus)
  // The confirmation the erase dialog asks for: the email, or the phone for a phone-only account.
  const confirmWith = email ?? phone
  const confirmOk = !!confirmWith && eraseEmail.trim().toLowerCase().replace(/\s+/g, '') === confirmWith.toLowerCase().replace(/\s+/g, '')

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => setStateOpen(true)} disabled={!!busy}>Set enforcement state</Button>
      <Button variant="outline" onClick={() => setRevokeOpen(true)} disabled={!!busy || !canRevoke} title={canRevoke ? undefined : 'Nothing to revoke — the account is not verified'}>
        Revoke identity verification
      </Button>
      <Button variant="outline" className="text-destructive" onClick={() => setEraseOpen(true)} disabled={!!busy || isAdmin} title={isAdmin ? 'An admin account cannot be erased here' : undefined}>
        Erase account (PDPL)
      </Button>

      <AlertDialog open={stateOpen} onOpenChange={setStateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set enforcement state</AlertDialogTitle>
            <AlertDialogDescription>
              Moves the account on the trust ladder by hand. Suspending records the account&apos;s identity anchors for ban-evasion checks; lifting is done from the Enforcement tab.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <div role="group" aria-label="State" className="flex flex-wrap gap-1">
              {ENFORCEMENT_STATES.map((s) => (
                <Button key={s} variant={nextState === s ? 'cta' : 'outline'} size="none" className="rounded-full px-3 py-1.5 text-xs capitalize" aria-pressed={nextState === s} onClick={() => setNextState(s)}>
                  {s.replace('_', ' ')}
                </Button>
              ))}
            </div>
            <Input type="number" min={1} value={stateDays} onChange={(e) => setStateDays(e.target.value)} placeholder="Days (blank = until lifted)" aria-label="Days" />
            <Textarea value={stateReason} onChange={(e) => setStateReason(e.target.value)} placeholder="Reason (goes on the record)" aria-label="Reason" rows={2} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              closeOnClick={false} // the dialog closes when the request has ANSWERED, not on the click — a 409 keeps the typed reason on screen
              disabled={nextState === enforcementState || !!busy}
              onClick={async () => {
                const days = Number(stateDays)
                const r = await post('/api/admin/enforcement', { action: 'set-state', profileId, state: nextState, reason: stateReason, ...(Number.isFinite(days) && days > 0 ? { days } : {}) }, 'state')
                if (r) { toast.success(`Now ${nextState.replace('_', ' ')}`); setStateOpen(false); router.refresh() }
              }}
            >
              {busy === 'state' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke identity verification</AlertDialogTitle>
            <AlertDialogDescription>
              The person loses verified status and cannot re-verify by themselves — restoration is an admin act. The reason goes on the audit record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} placeholder="Reason (required)" aria-label="Reason" rows={3} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              closeOnClick={false} // the dialog closes when the request has ANSWERED, not on the click — a 409 keeps the typed reason on screen
              disabled={!revokeReason.trim() || !!busy}
              onClick={async () => {
                const r = await post(`/api/admin/users/${profileId}`, { action: 'revoke-identity', reason: revokeReason }, 'revoke')
                if (r) { toast.success(`Verification revoked — status ${String(r.status)}`); setRevokeOpen(false); router.refresh() }
              }}
            >
              {busy === 'revoke' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Revoke'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={eraseOpen} onOpenChange={setEraseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Erase this account</AlertDialogTitle>
            <AlertDialogDescription>
              Irreversible. Listings, storefront, conversations, the profile and the sign-in are deleted; storage objects are queued for removal; the verification record survives pseudonymised. Refused while the account has open reports or an active hold — resolve those first.
              {confirmWith ? <> Type <span className="font-mono text-foreground">{confirmWith}</span> to confirm.</> : <> This account has neither an email nor a phone, so it cannot be confirmed here.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Input value={eraseEmail} onChange={(e) => setEraseEmail(e.target.value)} placeholder={email ? 'Account email' : 'Account phone'} aria-label="Confirm the account" autoComplete="off" />
            <Textarea value={eraseReason} onChange={(e) => setEraseReason(e.target.value)} placeholder="Reason — a ticket id or a date, never a name; it outlives the account (required)" aria-label="Reason" rows={2} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              closeOnClick={false} // the dialog closes when the request has ANSWERED, not on the click — a 409 keeps the typed reason on screen
              disabled={!confirmOk || !eraseReason.trim() || !!busy}
              onClick={async () => {
                const r = await post(`/api/admin/users/${profileId}`, { action: 'erase', reason: eraseReason, confirmEmail: eraseEmail }, 'erase')
                if (r) { toast.success('Account erased'); setEraseOpen(false); router.push('/admin/users') }
              }}
            >
              {busy === 'erase' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Erase'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
