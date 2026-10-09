'use client'

import React, { createContext, useCallback, useMemo, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAuth } from './auth-context'
import { actingAccountHeaders } from '@/lib/api/acting-account'

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

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
const CACHE_KEY = 'eno-notifs'

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const account = user?.id ?? null
  /**
   * ⛔ THE BELL'S ROWS CARRY THEIR ACCOUNT, AND ARE SHOWN ONLY TO IT (F6 — found by the F5 verification). They had none:
   * after a switch with no sign-out between (a sign-in from the thread page's "session ended" card while the client
   * still held the old account, or a sign-in in another tab), the next account saw the previous one's rows — offer
   * amounts and notes — and its unread count until its own first poll answered, for good if that poll failed; and a
   * poll still in flight at the switch landed the previous account's rows over the next one's.
   *  · The state holds the account its rows are for. A change of account resets it IN THE RENDER that changes it, so
   *    no frame paints the previous account's rows.
   *  · An answer names the account it was made for (`me`, the JWT `sub` — /api/notifications) and is applied by an
   *    updater that checks the STATE's own account at apply time: however React schedules the switch, a late answer
   *    for another account changes nothing.
   *  · The device copy is labelled the same way and read only when its own `me` is the account signed in — a copy
   *    from before this change carries none and is passed over once.
   *  · An optimistic edit (read, read all, remove, clear) belongs to the rows it was made on, and its request names
   *    their account (F1's x-eno-acting-account) — the server refuses it under another account's cookie.
   */
  const [shown, setShown] = useState<{ account: string | null; items: Notif[]; unread: number }>({ account, items: [], unread: 0 })
  // React re-runs this component with the reset state before rendering any child, so no consumer sees the old rows.
  if (shown.account !== account) setShown({ account, items: [], unread: 0 })
  const { items, unread } = shown
  /** The account signed in now — for what is not state (the broadcast, the device copy). Moved at the commit. */
  const accountNow = useRef(account)
  useIsoLayoutEffect(() => {
    const was = accountNow.current
    accountNow.current = account
    // An account → nobody (signed out here, or in another tab): a poll that answered between signOut's device clear
    // and this commit was still the old account's and was kept — accountNow only moves here. So its copy goes again
    // now; from this commit on, nothing more is kept (the same window chat-context closes for its thread copies).
    if (was !== null && account === null) {
      try { if (JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')?.me === was) localStorage.removeItem(CACHE_KEY) } catch {}
    }
  }, [account])
  /** Edit the rows of the account they belong to — never another account's (an optimistic edit landing after a switch). */
  const editShown = useCallback((forAccount: string | null, edit: (s: { items: Notif[]; unread: number }) => { items: Notif[]; unread: number }) => {
    setShown((s) => (s.account === forAccount ? { account: s.account, ...edit(s) } : s))
  }, [])

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/notifications')
      if (!r.ok) return
      const d = await r.json()
      const me = typeof d.me === 'string' && d.me ? d.me : null
      // Only an answer for the account signed in now: another account's (a poll that left before a switch, or a
      // cookie switched in another tab) is neither shown, broadcast nor cached.
      if (!me || me !== accountNow.current) return
      const notifications: Notif[] = d.notifications || []
      editShown(me, () => ({ items: notifications, unread: d.unread || 0 }))
      // The route piggybacks the conversations-unread total on this poll so
      // ChatProvider doesn't need its own duplicate 45s interval — broadcast it
      // (app-wide eno:* event idiom) for chat-context to consume, naming whose it is.
      if (typeof d.convoUnread === 'number') {
        try { window.dispatchEvent(new CustomEvent('eno:convo-unread', { detail: { unread: d.convoUnread, me } })) } catch {}
      }
      // Cache (account-labelled, by the answer's own `me`) for an instant paint on the next visit.
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ userId: me, me, items: notifications, unread: d.unread || 0 })) } catch {}
    } catch { /* keep last state */ }
  }, [editShown])

  // Fetch on sign-in, then poll + refetch on focus (realtime can layer on later).
  useEffect(() => {
    if (!user) return // signed out: the state above is already nobody's (empty)
    // Instant paint from cache, then revalidate.
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
      if (c?.userId === user.id && c?.me === user.id) editShown(user.id, () => ({ items: c.items || [], unread: c.unread || 0 }))
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
  }, [user, refresh, editShown])

  // Drop the cached snapshot on any mutation so a reload doesn't instant-paint the
  // stale (pre-mutation) items/unread before refresh() lands — only that ACCOUNT's copy: an edit made on one
  // account's rows never takes away another's.
  const dropCache = (forAccount: string) => {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
      if (!c || c.me === forAccount) localStorage.removeItem(CACHE_KEY)
    } catch {}
  }

  // Mark ONE notification read (optimistic) — used when the user opens it. No-op if
  // it's already read, so re-clicking doesn't churn the unread count.
  // The optimistic edits below belong to the account whose rows they were made on — the state's own account, read
  // with the rows at the tap (`shownNow`) — and to no one when no account owns them (nothing is sent then: an unnamed
  // request would act as whoever signs in next):
  //  · they change only those rows, each in ONE updater over `{ items, unread }`, so the count is never computed from
  //    rows another update replaced;
  //  · their request names that account, so a tab still showing it after another tab switched the cookie is refused
  //    (409) instead of editing the other account's bell. Nothing is put back on a 409: that state lasts only until
  //    supabase-js relays the other tab's sign-in to this one (its BroadcastChannel → onAuthStateChange), which moves
  //    this bell to the new account; the refused account's rows come from the server again when it returns. (Putting
  //    snapshots back drew new edges in review — overlapping restores, a cache left dropped — for a moment that ends
  //    by itself.)
  // Read through a ref, so the four callbacks keep one identity across polls (a consumer may list them in an effect).
  const shownNow = useRef(shown)
  useIsoLayoutEffect(() => { shownNow.current = shown }, [shown])
  const markRead = useCallback(async (id: string) => {
    const { account: rowsFor, items: rows } = shownNow.current
    const target = rows.find((n) => n.id === id)
    if (!rowsFor || !target || target.read) return // no account, or already read: re-clicking does not churn the count
    editShown(rowsFor, (s) => ({
      items: s.items.map((n) => (n.id === id ? { ...n, read: true } : n)),
      unread: s.items.some((n) => n.id === id && !n.read) ? Math.max(0, s.unread - 1) : s.unread,
    }))
    dropCache(rowsFor)
    try { await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json', ...actingAccountHeaders(rowsFor) }, body: JSON.stringify({ ids: [id] }) }) } catch { /* optimistic */ }
  }, [editShown])

  const markAllRead = useCallback(async () => {
    const rowsFor = shownNow.current.account
    if (!rowsFor) return
    editShown(rowsFor, (s) => ({ items: s.items.map((n) => ({ ...n, read: true })), unread: 0 }))
    dropCache(rowsFor)
    try { await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json', ...actingAccountHeaders(rowsFor) }, body: '{}' }) } catch { /* optimistic */ }
  }, [editShown])

  // Delete one notification (optimistic; drops the unread count if it was unread).
  const remove = useCallback(async (id: string) => {
    const rowsFor = shownNow.current.account
    if (!rowsFor) return
    editShown(rowsFor, (s) => {
      const target = s.items.find((n) => n.id === id)
      return { items: s.items.filter((n) => n.id !== id), unread: target && !target.read ? Math.max(0, s.unread - 1) : s.unread }
    })
    dropCache(rowsFor)
    try { await fetch(`/api/notifications/${id}`, { method: 'DELETE', headers: actingAccountHeaders(rowsFor) }) } catch { /* optimistic */ }
  }, [editShown])

  // Clear all notifications.
  const clearAll = useCallback(async () => {
    const rowsFor = shownNow.current.account
    if (!rowsFor) return
    editShown(rowsFor, () => ({ items: [], unread: 0 }))
    dropCache(rowsFor)
    try { await fetch('/api/notifications', { method: 'DELETE', headers: actingAccountHeaders(rowsFor) }) } catch { /* optimistic */ }
  }, [editShown])

  const value = useMemo(() => ({ items, unread, refresh, markRead, markAllRead, remove, clearAll }), [items, unread, refresh, markRead, markAllRead, remove, clearAll])

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications must be used within a NotificationsProvider')
  return ctx
}
