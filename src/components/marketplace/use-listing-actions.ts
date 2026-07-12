'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'
import type { SerializedListing } from '@/lib/types'

// Shared optimistic lifecycle actions for a seller's own listing — used by the
// dashboard row cards AND the desktop data-table so both surfaces behave
// identically: status flips instantly (local override), the request fires in
// the background, rollback + revalidate on failure. Delete is the Gmail way —
// hide instantly, commit after the undo-toast expires.
export function useListingActions(
  listing: SerializedListing,
  onChanged: () => void,
  // Optional mirror for hosts that render OTHER cells from the same listing
  // (the data-table): reports every optimistic transition ('sold'/'active'
  // flip, 'gone' during the undo-delete window, null on rollback/undo) so
  // status badges and row selectability stay in lockstep with the actions.
  onState?: (state: 'sold' | 'active' | 'gone' | null) => void,
) {
  const { tr } = useLanguage()
  const [gone, setGoneRaw] = useState(false)
  const [optStatus, setOptStatusRaw] = useState<string | null>(null)
  const setGone = (g: boolean) => { setGoneRaw(g); onState?.(g ? 'gone' : null) }
  const setOptStatus = (s: 'sold' | 'active' | null) => { setOptStatusRaw(s); onState?.(s) }

  const act = (
    optimistic: () => void,
    rollback: () => void,
    url: string,
    method: 'POST' | 'DELETE',
    body?: unknown,
  ) => {
    optimistic()
    fetch(url, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
      .then((res) => { if (!res.ok) throw new Error('failed'); onChanged() })
      .catch(() => { rollback(); onChanged() })
  }

  const setStatus = (s: 'sold' | 'active') => act(
    () => setOptStatus(s),
    () => setOptStatus(null),
    `/api/listings/${listing.id}/status`, 'POST', { status: s },
  )

  const del = () => {
    setGone(true)
    let undone = false
    const commit = setTimeout(() => {
      if (undone) return
      fetch(`/api/listings/${listing.id}`, { method: 'DELETE' })
        .then((res) => { if (!res.ok) throw new Error('failed'); onChanged() })
        .catch(() => { setGone(false); toast.error(tr('Could not delete — listing restored.', 'Không xóa được — đã khôi phục tin.')); onChanged() })
    }, 5000)
    toast(tr('Listing deleted', 'Đã xóa tin'), {
      duration: 5000,
      action: {
        label: tr('Undo', 'Hoàn tác'),
        onClick: () => { undone = true; clearTimeout(commit); setGone(false) },
      },
    })
  }

  return { gone, status: optStatus ?? listing.status, setStatus, del }
}
