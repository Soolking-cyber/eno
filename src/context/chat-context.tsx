'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useAuth } from './auth-context'

type View = 'list' | 'thread'

type ChatCtx = {
  open: boolean
  view: View
  conversationId: string | null
  unread: number
  refreshUnread: () => void
  openInbox: () => void
  openThread: (id: string) => void
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
  const [unread, setUnread] = useState(0)

  const refreshUnread = useCallback(() => {
    if (!user) { setUnread(0); return }
    fetch('/api/conversations/unread').then((r) => r.json()).then((d) => setUnread(d.unread ?? 0)).catch(() => {})
  }, [user])

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

  const openInbox = useCallback(() => { setView('list'); setConversationId(null); setOpen(true) }, [])
  const openThread = useCallback((id: string) => { setConversationId(id); setView('thread'); setOpen(true) }, [])
  const back = useCallback(() => { setView('list'); setConversationId(null); refreshUnread() }, [refreshUnread])
  const close = useCallback(() => setOpen(false), [])

  return (
    <ChatContext.Provider value={{ open, view, conversationId, unread, refreshUnread, openInbox, openThread, back, close }}>
      {children}
    </ChatContext.Provider>
  )
}

export function useChat() {
  const c = useContext(ChatContext)
  if (!c) throw new Error('useChat must be used within a ChatProvider')
  return c
}
