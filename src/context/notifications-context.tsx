'use client'

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useAuth } from './auth-context'

export type Notif = {
  id: string
  type: string // 'message' | 'offer' | 'system'
  title: string
  body: string | null
  actorName: string | null
  conversationId: string | null
  listingId: string | null
  url: string | null
  read: boolean
  createdAt: string
}

type Ctx = {
  items: Notif[]
  unread: number
  refresh: () => void
  markRead: (id: string) => void
  markAllRead: () => void
  remove: (id: string) => void
  clearAll: () => void
}

const NotificationsContext = createContext<Ctx | undefined>(undefined)

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [items, setItems] = useState<Notif[]>([])
  const [unread, setUnread] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/notifications')
      if (!r.ok) return
      const d = await r.json()
      setItems(d.notifications || [])
      setUnread(d.unread || 0)
      // Cache (userId-scoped) for an instant paint on the next visit.
      try { if (user) localStorage.setItem('eno-notifs', JSON.stringify({ userId: user.id, items: d.notifications || [], unread: d.unread || 0 })) } catch {}
    } catch { /* keep last state */ }
  }, [user])

  // Fetch on sign-in, then poll + refetch on focus (realtime can layer on later).
  useEffect(() => {
    if (!user) { setItems([]); setUnread(0); return }
    // Instant paint from cache, then revalidate.
    try {
      const c = JSON.parse(localStorage.getItem('eno-notifs') || 'null')
      if (c?.userId === user.id) { setItems(c.items || []); setUnread(c.unread || 0) }
    } catch {}
    // Poll only while the tab is VISIBLE (background tabs shouldn't burn function
    // invocations); refetch immediately when the tab is shown again.
    let iv: ReturnType<typeof setInterval> | null = null
    const stop = () => { if (iv) { clearInterval(iv); iv = null } }
    const start = () => { if (!iv) iv = setInterval(refresh, 45000) }
    const onVis = () => { if (document.visibilityState === 'visible') { refresh(); start() } else stop() }
    refresh()
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVis)
    return () => { stop(); document.removeEventListener('visibilitychange', onVis) }
  }, [user, refresh])

  // Drop the cached snapshot on any mutation so a reload doesn't instant-paint the
  // stale (pre-mutation) items/unread before refresh() lands.
  const dropCache = () => { try { localStorage.removeItem('eno-notifs') } catch {} }

  // Mark ONE notification read (optimistic) — used when the user opens it. No-op if
  // it's already read, so re-clicking doesn't churn the unread count.
  const markRead = useCallback(async (id: string) => {
    let wasUnread = false
    setItems((arr) => arr.map((n) => {
      if (n.id === id && !n.read) { wasUnread = true; return { ...n, read: true } }
      return n
    }))
    if (!wasUnread) return
    setUnread((u) => Math.max(0, u - 1))
    dropCache()
    try { await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id] }) }) } catch { /* optimistic */ }
  }, [])

  const markAllRead = useCallback(async () => {
    setUnread(0)
    setItems((arr) => arr.map((n) => ({ ...n, read: true })))
    dropCache()
    try { await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }) } catch { /* optimistic */ }
  }, [])

  // Delete one notification (optimistic; drops the unread count if it was unread).
  const remove = useCallback(async (id: string) => {
    setItems((arr) => {
      const target = arr.find((n) => n.id === id)
      if (target && !target.read) setUnread((u) => Math.max(0, u - 1))
      return arr.filter((n) => n.id !== id)
    })
    dropCache()
    try { await fetch(`/api/notifications/${id}`, { method: 'DELETE' }) } catch { /* optimistic */ }
  }, [])

  // Clear all notifications.
  const clearAll = useCallback(async () => {
    setItems([]); setUnread(0)
    dropCache()
    try { await fetch('/api/notifications', { method: 'DELETE' }) } catch { /* optimistic */ }
  }, [])

  return (
    <NotificationsContext.Provider value={{ items, unread, refresh, markRead, markAllRead, remove, clearAll }}>
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications must be used within a NotificationsProvider')
  return ctx
}
