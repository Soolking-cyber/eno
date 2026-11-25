'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/**
 * Mark paid / Cancel on one bank-transfer ad order — Admin › Catalogue › Ads › Awaiting transfer (owner 2026-11-25:
 * "ADMIN CONFIRMS"). POST /api/admin/ads/bank, which re-checks getAdmin(); both are idempotent there, so a double press
 * changes nothing. Admin chrome: English only.
 */
export function AdBankOrderActions({ adId, reference }: { adId: string; reference: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<'paid' | 'cancel' | null>(null)
  const run = async (action: 'paid' | 'cancel') => {
    setBusy(action)
    try {
      const res = await fetch('/api/admin/ads/bank', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adId, action }) })
      const d = (await res.json().catch(() => null)) as { error?: string; already?: boolean; status?: string; startsAt?: string | null } | null
      if (!res.ok) { toast.error(`Could not ${action === 'paid' ? 'mark it paid' : 'cancel it'}: ${d?.error === 'order_closed' ? 'the order is already closed' : (d?.error ?? `HTTP ${res.status}`)}.`); return }
      if (action === 'cancel') toast.success(d?.already ? 'It was already cancelled.' : `Cancelled ${reference}.`)
      else if (d?.status === 'review') toast.warning(`${reference}: paid, but it can no longer run (the listing or the ad is gone). Refund it by hand.`)
      else toast.success(d?.already ? 'It was already marked paid.' : `${reference} is paid: the ad runs from ${d?.startsAt ? `${d.startsAt.slice(0, 16).replace('T', ' ')} UTC` : 'now'}.`)
      router.refresh()
    } catch {
      toast.error('Could not reach the server — check the connection and try again.')
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      <Button variant="cta" size="sm" type="button" loading={busy === 'paid'} disabled={!!busy} onClick={() => { void run('paid') }} aria-label={`Mark ${reference} paid`}>
        Mark paid
      </Button>
      <Button variant="outline" size="sm" type="button" loading={busy === 'cancel'} disabled={!!busy} onClick={() => { void run('cancel') }} aria-label={`Cancel ${reference}`}>
        Cancel
      </Button>
    </div>
  )
}
