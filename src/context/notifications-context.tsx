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
  markAllRead: () => void
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
    refresh()
    const iv = setInterval(refresh, 30000)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(iv); window.removeEventListener('focus', onFocus) }
  }, [user, refresh])

  const markAllRead = useCallback(async () => {
    setUnread(0)
    setItems((arr) => arr.map((n) => ({ ...n, read: true })))
    try { await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }) } catch { /* optimistic */ }
  }, [])

  return (
    <NotificationsContext.Provider value={{ items, unread, refresh, markAllRead }}>
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications must be used within a NotificationsProvider')
  return ctx
}
