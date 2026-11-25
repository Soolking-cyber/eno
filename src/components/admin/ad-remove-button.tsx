'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatMoneyFull } from '@/lib/vnd'

/**
 * "Remove" — Admin › Catalogue › Ads (owner 2026-11-25). A written reason is required (it goes into the audit row and the
 * creative); then POST /api/admin/ads/remove, which re-checks getAdmin(). The answer lists what each ended run did not use,
 * for the manual pro-rata refund. Admin chrome: English only.
 */
export function AdRemoveButton({ creativeId, headline }: { creativeId: string; headline: string }) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const id = `ad-remove-reason-${creativeId}`
  const run = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/ads/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ creativeId, reason }) })
      const d = (await res.json().catch(() => null)) as { error?: string; refunds?: { adId: string; unused_usdc?: string; unused_vnd?: number; settled: boolean }[]; alreadyRemoved?: boolean } | null
      if (!res.ok) { toast.error(`Could not remove: ${d?.error ?? `HTTP ${res.status}`}.`); return }
      // Each run in its own money (src/lib/ads/currency.ts): USDC over x402, đồng by bank transfer.
      const unused = (r: { unused_usdc?: string; unused_vnd?: number }) => (r.unused_vnd != null ? (r.unused_vnd ? formatMoneyFull(r.unused_vnd, '₫') : null) : r.unused_usdc && r.unused_usdc !== '0' ? `${r.unused_usdc} USDC` : null)
      const owed = (d?.refunds ?? []).filter((r) => unused(r) !== null)
      // (A payment not confirmed yet is listed whole: refund it only if it settles.)
      toast.success(d?.alreadyRemoved ? 'It was already removed.' : `Removed “${headline}”.${owed.length ? ` Unused, to refund on request: ${owed.map((r) => `${unused(r)} (${r.adId}${r.settled ? '' : ', only if its payment settles'})`).join(', ')}.` : ''}`)
      router.refresh()
    } catch {
      toast.error('Could not reach the server — check the connection and try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap items-end gap-2 pt-1">
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="text-xs">Reason (kept in the audit log)</Label>
        <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Unlicensed medicine on the landing page" className="mt-1" />
      </div>
      <Button variant="secondary" size="sm" type="button" loading={busy} disabled={busy || !reason.trim()} onClick={() => { void run() }} aria-label={`Remove the ad “${headline}”`}>
        Remove
      </Button>
    </div>
  )
}
