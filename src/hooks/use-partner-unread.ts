'use client'

import { useEffect, useState } from 'react'

/**
 * Admin › Partner inbox's badge: the partner shops' unread chats (GET /api/admin/partner-inbox — admins only, counts only).
 * Live, not cached (codex plan review 2026-11-12: the dashboard payload loads once and is stored on the device): fetched
 * when the rail shows for an admin, every minute while the page is visible, and when the tab comes back. Kept in memory
 * only. 0 for everyone else, and on any error the last value stands.
 */
const EVERY_MS = 60_000

export function usePartnerUnread(isAdmin: boolean): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!isAdmin) { setCount(0); return }
    let alive = true
    let inFlight: AbortController | null = null
    const load = async () => {
      if (document.visibilityState !== 'visible' || inFlight) return
      const ctl = new AbortController()
      inFlight = ctl
      const timer = setTimeout(() => ctl.abort(), 10_000)
      try {
        const r = await fetch('/api/admin/partner-inbox', { cache: 'no-store', signal: ctl.signal })
        if (r.ok) {
          const j = (await r.json()) as { unreadChats?: unknown }
          if (alive && typeof j.unreadChats === 'number') setCount(j.unreadChats)
        }
      } catch { /* the last value stands */ } finally {
        clearTimeout(timer)
        inFlight = null
      }
    }
    void load()
    const id = setInterval(load, EVERY_MS)
    const onVisible = () => { void load() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      alive = false
      clearInterval(id)
      inFlight?.abort()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [isAdmin])
  return count
}
