'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuth } from './auth-context'
import { hasConsent } from '@/lib/consent'

type View = 'list' | 'thread'

export type InboxConvo = {
  id: string; listingTitle: string; listingImage: string | null
  lastMessageAt: string; lastMessageText: string | null; unread: number
  counterpart: { name: string; avatarColor: string; avatarUrl: string | null }
}

const CONVOS_KEY = 'eno-convos' // localStorage cache: { userId, list } (consent-gated)

type ChatCtx = {
  open: boolean
  view: View
  conversationId: string | null
  starting: boolean
  unread: number
  convos: InboxConvo[] | null
  refreshConvos: () => void
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

  const refreshUnread = useCallback(() => {
    if (!user) { setUnread(0); return }
    fetch('/api/conversations/unread').then((r) => r.json()).then((d) => setUnread(d.unread ?? 0)).catch(() => {})
  }, [user])

  // Preload the inbox so opening Messages is instant. Persisted per-user to
  // localStorage (only with consent) for instant paint on repeat visits.
  const refreshConvos = useCallback(() => {
    if (!user) { setConvos(null); return }
    fetch('/api/conversations').then((r) => r.json()).then((d) => {
      const list: InboxConvo[] = d.conversations ?? []
      setConvos(list)
      if (hasConsent()) { try { localStorage.setItem(CONVOS_KEY, JSON.stringify({ userId: user.id, list })) } catch {} }
    }).catch(() => {})
  }, [user])

  useEffect(() => {
    if (!user) { setConvos(null); return }
    // Instant paint from this user's cached inbox (consent-gated), then revalidate.
    if (hasConsent()) {
      try {
        const cached = JSON.parse(localStorage.getItem(CONVOS_KEY) || 'null')
        if (cached && cached.userId === user.id) setConvos(cached.list)
      } catch {}
    }
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

  const openInbox = useCallback(() => { setView('list'); setConversationId(null); setStarting(false); setOpen(true); refreshConvos() }, [refreshConvos])
  const openThread = useCallback((id: string) => { setConversationId(id); setStarting(false); setView('thread'); setOpen(true) }, [])
  // Open the thread panel INSTANTLY (skeleton) while the conversation is created
  // in the background; openThread(id) then swaps in the real thread.
  const openPendingThread = useCallback(() => { setConversationId(null); setStarting(true); setView('thread'); setOpen(true) }, [])
  const back = useCallback(() => { setView('list'); setConversationId(null); setStarting(false); refreshUnread(); refreshConvos() }, [refreshUnread, refreshConvos])
  const close = useCallback(() => { setOpen(false); setStarting(false) }, [])

  return (
    <ChatContext.Provider value={{ open, view, conversationId, starting, unread, convos, refreshConvos, refreshUnread, openInbox, openThread, openPendingThread, back, close }}>
      {children}
    </ChatContext.Provider>
  )
}

export function useChat() {
  const c = useContext(ChatContext)
  if (!c) throw new Error('useChat must be used within a ChatProvider')
  return c
}
