'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAuth } from './auth-context'
import { createSupabaseBrowser } from '@/lib/supabase/browser'

type View = 'list' | 'thread'

export type InboxConvo = {
  id: string; listingTitle: string; listingImage: string | null
  lastMessageAt: string; lastMessageText: string | null; unread: number
  counterpart: { name: string; avatarColor: string; avatarUrl: string | null }
}

const CONVOS_KEY = 'eno-convos'  // localStorage cache: { userId, list }
const THREAD_PREFIX = 'eno-thr:' // per-thread localStorage cache: { userId, data }

type ChatCtx = {
  open: boolean
  view: View
  conversationId: string | null
  starting: boolean
  unread: number
  convos: InboxConvo[] | null
  refreshConvos: () => void
  deleteConvo: (id: string) => void
  getCachedThread: (id: string) => unknown
  cacheThread: (id: string, data: unknown) => void
  prefetchThread: (id: string) => void
  // Composer draft shared across the pending shell and the real thread, so the
  // user can type the instant the panel opens and nothing is lost on the swap.
  draft: string
  setDraft: (s: string) => void
  pendingSend: boolean
  setPendingSend: (b: boolean) => void
  refreshUnread: () => void
  openInbox: () => void
  openThread: (id: string) => void
  openPendingThread: () => void
  back: () => void
  close: () => void
}

const ChatContext = createContext<ChatCtx | undefined>(undefined)

/** Global chat state for the floating widget (launcher + docked panel). */
export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('list')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false) // thread opened optimistically, conversation creating in the background
  const [unread, setUnread] = useState(0)
  const [convos, setConvos] = useState<InboxConvo[] | null>(null)
  const [draft, setDraft] = useState('')          // composer text shared across pending → real thread
  const [pendingSend, setPendingSend] = useState(false) // user hit send before the convo id was ready

  const refreshUnread = useCallback(() => {
    if (!user) { setUnread(0); return }
    fetch('/api/conversations/unread').then((r) => r.json()).then((d) => setUnread(d.unread ?? 0)).catch(() => {})
  }, [user])

  // Thread cache: in-memory (fast) backed by localStorage (per-user, so a
  // previously-opened conversation paints instantly even after a reload). Keyed
  // by userId so it never renders across accounts; cleared on explicit sign-out.
  const threadCache = useRef<Map<string, unknown>>(new Map())
  const getCachedThread = useCallback((id: string) => {
    const mem = threadCache.current.get(id)
    if (mem) return mem
    if (!user) return null
    try {
      const raw = JSON.parse(localStorage.getItem(THREAD_PREFIX + id) || 'null')
      if (raw && raw.userId === user.id) { threadCache.current.set(id, raw.data); return raw.data }
    } catch {}
    return null
  }, [user])
  const cacheThread = useCallback((id: string, data: unknown) => {
    threadCache.current.set(id, data)
    if (user) { try { localStorage.setItem(THREAD_PREFIX + id, JSON.stringify({ userId: user.id, data })) } catch {} }
  }, [user])
  const prefetchThread = useCallback((id: string) => {
    if (!id || threadCache.current.has(id)) return
    fetch(`/api/conversations/${id}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) cacheThread(id, d) }).catch(() => {})
  }, [cacheThread])

  // Preload the inbox so opening Messages is instant. This is FUNCTIONAL caching
  // of the user's OWN data, persisted per-user to localStorage (keyed by userId
  // so it never leaks across accounts) — it works without waiting for the cookie
  // banner. Also prefetches the top conversations so opening them is instant.
  const refreshConvos = useCallback(() => {
    if (!user) { setConvos(null); return }
    fetch('/api/conversations').then((r) => r.json()).then((d) => {
      const list: InboxConvo[] = d.conversations ?? []
      setConvos(list)
      try { localStorage.setItem(CONVOS_KEY, JSON.stringify({ userId: user.id, list })) } catch {}
      list.slice(0, 3).forEach((c) => prefetchThread(c.id))
    }).catch(() => {})
  }, [user, prefetchThread])

  // Delete a conversation from MY inbox (per-user hide, non-destructive on the
  // server). Optimistic: drop it from the list + caches now, then call the API.
  const deleteConvo = useCallback((id: string) => {
    setConvos((prev) => {
      const next = (prev ?? []).filter((c) => c.id !== id)
      if (user) { try { localStorage.setItem(CONVOS_KEY, JSON.stringify({ userId: user.id, list: next })) } catch {} }
      return next
    })
    threadCache.current.delete(id)
    if (user) { try { localStorage.removeItem(THREAD_PREFIX + id) } catch {} }
    fetch(`/api/conversations/${id}`, { method: 'DELETE' }).then(() => refreshUnread()).catch(() => {})
  }, [user, refreshUnread])

  useEffect(() => {
    if (!user) { setConvos(null); threadCache.current.clear(); return }
    // Instant paint from this user's cached inbox, then revalidate.
    try {
      const cached = JSON.parse(localStorage.getItem(CONVOS_KEY) || 'null')
      if (cached && cached.userId === user.id) setConvos(cached.list)
    } catch {}
    refreshConvos()
  }, [user, refreshConvos])

  useEffect(() => {
    if (!user) { setUnread(0); return }
    let iv: ReturnType<typeof setInterval> | null = null
    const stop = () => { if (iv) { clearInterval(iv); iv = null } }
    const start = () => { if (!iv) iv = setInterval(refreshUnread, 8000) }
    const onVis = () => {
      if (document.visibilityState === 'visible') { refreshUnread(); start() } else stop()
    }
    refreshUnread()
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVis)
    return () => { stop(); document.removeEventListener('visibilitychange', onVis) }
  }, [user, refreshUnread])

  // REALTIME: warm the socket on sign-in and subscribe to my conversations so the
  // unread badge + inbox update INSTANTLY on an incoming message (reuses the
  // participant-gated convo:<id> broadcast — no DB change). The 8s poll above stays
  // as a backstop. Keyed by the conversation-id set so it only re-subscribes when
  // the set actually changes.
  const convoIds = useMemo(() => (convos ?? []).slice(0, 30).map((c) => c.id).join(','), [convos])
  useEffect(() => {
    if (!user || !convoIds) return
    const supabase = createSupabaseBrowser()
    let cancelled = false
    let debounce: ReturnType<typeof setTimeout> | null = null
    const channels: ReturnType<typeof supabase.channel>[] = []
    const bump = () => { if (debounce) return; debounce = setTimeout(() => { debounce = null; refreshUnread(); refreshConvos() }, 300) }
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (cancelled || !data.session) return
      await supabase.realtime.setAuth(data.session.access_token)
      supabase.realtime.connect() // warm the WS so subsequent thread subscribes are instant
      for (const id of convoIds.split(',')) {
        const ch = supabase
          .channel(`convo:${id}`, { config: { private: true } })
          .on('broadcast', { event: 'new_message' }, ({ payload }) => {
            const p = (payload ?? {}) as { senderProfileId?: string }
            if (p.senderProfileId && p.senderProfileId === user.id) return // my own echo
            bump()
          })
          .subscribe()
        channels.push(ch)
      }
    })()
    return () => {
      cancelled = true
      if (debounce) clearTimeout(debounce)
      channels.forEach((c) => supabase.removeChannel(c))
    }
  }, [user, convoIds, refreshUnread, refreshConvos])

  const openInbox = useCallback(() => { setView('list'); setConversationId(null); setStarting(false); setDraft(''); setPendingSend(false); setOpen(true); refreshConvos() }, [refreshConvos])
  // openThread does NOT reset the draft — the real thread inherits whatever was
  // typed in the pending shell and consumes it.
  const openThread = useCallback((id: string) => { setConversationId(id); setStarting(false); setView('thread'); setOpen(true) }, [])
  // Open the thread panel INSTANTLY as a usable empty chat (composer ready) while
  // the conversation is created in the background; openThread(id) then swaps in
  // the real thread, inheriting the draft.
  const openPendingThread = useCallback(() => { setConversationId(null); setStarting(true); setView('thread'); setDraft(''); setPendingSend(false); setOpen(true) }, [])
  const back = useCallback(() => { setView('list'); setConversationId(null); setStarting(false); setDraft(''); setPendingSend(false); refreshUnread(); refreshConvos() }, [refreshUnread, refreshConvos])
  const close = useCallback(() => { setOpen(false); setStarting(false); setDraft(''); setPendingSend(false) }, [])

  return (
    <ChatContext.Provider value={{ open, view, conversationId, starting, unread, convos, refreshConvos, deleteConvo, getCachedThread, cacheThread, prefetchThread, draft, setDraft, pendingSend, setPendingSend, refreshUnread, openInbox, openThread, openPendingThread, back, close }}>
      {children}
    </ChatContext.Provider>
  )
}

export function useChat() {
  const c = useContext(ChatContext)
  if (!c) throw new Error('useChat must be used within a ChatProvider')
  return c
}
