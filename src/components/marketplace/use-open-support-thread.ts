'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { logError } from '@/lib/log'

/**
 * Opens the signed-in person's support conversation in /messages. Owner: *"auto open message ... route to message tab
 * and open message with support"*. Shared by the desktop support bubble (support-button.tsx) and Help's "Message
 * support" (help-center.tsx), which is the phone's way in since the bubble left phones (owner, 2026-11-08).
 *
 * ⚠️ THE ROUTE TAKES NO BODY. Buyer, seller and edition are all resolved server-side, so there is nothing here that
 * could open somebody else's thread or reach the other edition's desk.
 * ⚠️ IT RESOLVES false ON FAILURE AND THE CALLER FALLS BACK, never to an error page: a person asking for support is
 * already having a problem. The bubble falls back to its email form, Help to its email address.
 * ⚠️ A ref, not only state, guards the second tap: two taps inside one render would both read `opening === false`.
 *
 * ⛔ AN ASK DIES THE MOMENT THE PERSON NAVIGATES OR THE ASKING COMPONENT UNMOUNTS (reviews r1–r3, 2026-11-08). A slow POST
 * that settled after they moved on dragged them into /messages from wherever they went. Comparing the address when it
 * settles was the wrong mechanism — each review found a new way back to the same address (leave Help and return; the
 * bubble, mounted across pages, on a round trip). So each ask takes a ticket, and ANY pathname change or unmount after
 * it voids the ticket for good: the effect's cleanup bumps `navigations`, and it runs on both. A voided ask does
 * nothing: a made thread waits in their inbox, and a failure shows no fallback. A query or hash change on the same
 * page (Help's search) is not a pathname change, so it does not void the ask.
 */
export function useOpenSupportThread() {
  const router = useRouter()
  const pathname = usePathname()
  const [opening, setOpening] = useState(false)
  const busy = useRef(false)
  const navigations = useRef(0)
  useEffect(() => () => { navigations.current++ }, [pathname])
  const open = useCallback(async (): Promise<boolean> => {
    if (busy.current) return true
    busy.current = true
    setOpening(true)
    const ticket = navigations.current
    const live = () => navigations.current === ticket
    try {
      const res = await fetch('/api/support/thread', { method: 'POST' })
      if (!res.ok) throw new Error(`support-thread ${res.status}`)
      const { id } = (await res.json()) as { id: string }
      if (live()) router.push(`/messages/${id}`)
      return true
    } catch (e) {
      logError(e, { op: 'support.openThread' })
      return !live() // moved on: no fallback appears where they went
    } finally {
      busy.current = false
      setOpening(false)
    }
  }, [router])
  return { open, opening }
}
