'use client'

import { useEffect, useRef, useState } from 'react'

/** A floor under a navigation that never arrives — the same 4s as ListingCard's. */
export const PENDING_MAX_MS = 4000

/**
 * ⛔ A ROW'S PRESS HOLDS UNTIL THE NEXT SCREEN PAINTS (ListingCard's fix, which the list row took over; listing-card.tsx has the
 * measurements). `onOpen` is a router push and the listing page paints 0.5–2.3s after the tap, while `:active` releases at
 * touchend: the row looked untouched and invited a second tap. `open()` marks the row `pending` (the caller renders it as
 * `data-pending`, the pressed look) until the row unmounts — a 4s floor frees it if the push never lands — and a second tap
 * while pending is a no-op instead of a duplicate push.
 * Extracted verbatim from compact-listing-row.tsx (2026-11-14) so the job card row (job-card-row.tsx) presses the same way.
 */
export function useRowPress(onOpen: () => void): { pending: boolean; open: () => void } {
  const [pending, setPending] = useState(false)
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (pendingTimer.current) clearTimeout(pendingTimer.current) }, [])
  const open = () => {
    if (pending) return
    setPending(true)
    if (pendingTimer.current) clearTimeout(pendingTimer.current)
    pendingTimer.current = setTimeout(() => { pendingTimer.current = null; setPending(false) }, PENDING_MAX_MS)
    onOpen()
  }
  return { pending, open }
}
