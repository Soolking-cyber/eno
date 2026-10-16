'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Check } from '@/components/ui/icons'

/**
 * "Photo is fine" — Admin › Catalogue › Teacher photos (owner, 2026-10-16). The human route against a wrong automated
 * refusal: POST /api/admin/teachers/photo-override, which re-checks getAdmin() and writes the durable override. One tap,
 * no dialog: it only ever lets a photo through, and the teacher is never told anything by it.
 */
export function TeacherPhotoOkButton({ profileId, objectKey, name }: { profileId: string; objectKey: string; name: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/teachers/photo-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, key: objectKey }),
      })
      const d = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) { toast.error(`Could not approve: ${d?.error ?? `HTTP ${res.status}`}.`); return }
      toast.success(`Approved ${name}'s photo — the save, the re-check and their edit page now let it through.`)
      router.refresh()
    } catch {
      toast.error('Could not reach the server — check the connection and try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="secondary" size="sm" type="button" loading={busy} disabled={busy} onClick={() => { void run() }} aria-label={`Photo is fine — ${name}`}>
      <Check className="size-4" />Photo is fine
    </Button>
  )
}
