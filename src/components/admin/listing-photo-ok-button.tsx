'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Check } from '@/components/ui/icons'

/**
 * "Photo is fine" — Admin › Catalogue › Listing photos (owner, 2026-11-15). The human route against a wrong refusal of a
 * listing photo: POST /api/admin/listings/photo-override, which re-checks getAdmin(), records the override for this
 * listing, puts a removed photo back and re-runs the check. One tap, no dialog: it only ever lets a photo through.
 */
export function ListingPhotoOkButton({ listingId, objectKey, title }: { listingId: string; objectKey: string; title: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/listings/photo-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, key: objectKey }),
      })
      const d = (await res.json().catch(() => null)) as { error?: string; restored?: number } | null
      if (!res.ok) { toast.error(d?.error === 'retry' ? 'The listing changed just now — tap again.' : `Could not approve: ${d?.error ?? `HTTP ${res.status}`}.`); return }
      toast.success(d?.restored ? `Approved — the photo is back on “${title}”.` : `Approved — the check now lets this photo through on “${title}”.`)
      router.refresh()
    } catch {
      toast.error('Could not reach the server — check the connection and try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="secondary" size="sm" type="button" loading={busy} disabled={busy} onClick={() => { void run() }} aria-label={`Photo is fine — ${title}`}>
      <Check className="size-4" />Photo is fine
    </Button>
  )
}
