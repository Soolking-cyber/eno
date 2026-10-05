'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { useAuth } from './auth-context'
import { useLanguage } from './language-context'
import { useUndoWindow } from '@/hooks/use-undo-window'

type View = 'list' | 'thread'

export type InboxConvo = {
  id: string; listingTitle: string; listingImage: string | null
  /**
   * The anchor listing's id — NULL on a listing-less thread (support, the rental desk); the server has always
   * sent it (api/conversations GET). The thread page reads it to skip the item-strip placeholder for a thread
   * it already knows has no item. Optional: an older cached row lacks it, and absent means "unknown".
   */
  listingId?: string | null
  lastMessageAt: string; lastMessageText: string | null; unread: number
  lastOffer?: { mine: boolean; amount: number | null; status: string | null } | null
  counterpart: { name: string; avatarColor: string; avatarUrl: string | null }
  /**
   * What this thread is ABOUT, from the server's `threadKind` — never derived on the client.
   *
   * ⚠️ OPTIONAL ON PURPOSE: this list is also read from a localStorage cache written before the
   * field existed, so an older cached row legitimately has no `kind`. Treat absent as "no label"
   * rather than defaulting to one — a wrong badge on a visa thread is worse than none.
   */
  kind?: 'visa' | 'itinerary' | 'listing'
}

/**
 * ⚠️ BUMPED WITH THE SERVER-SIDE THREAD FILTER, IN THE SAME RELEASE, AND THAT IS NOT OPTIONAL.
 * The inbox and every thread paint from this cache BEFORE the server answers. Without a new key the
 * gate looks perfect in a fresh incognito window and leaks for every real user who has ever used
 * chat — they keep painting their cached visa threads on eno.vn until the fetch resolves.
 */
const CONVOS_KEY = 'eno-convos-v2'  // localStorage cache: { userId, list }
const THREAD_PREFIX = 'eno-thr2:'   // per-thread localStorage cache: { userId, data }

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
  const { tr } = useLanguage()
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
    // Don't PERSIST a placeholder seed with no counterpart name (e.g. the pending-
    // compose seed) — it'd instant-paint a blank/'…' header on reload. Keep it in
    // memory only; persist once a real thread (with identity) has loaded.
    const name = (data as { counterpart?: { name?: string } } | null)?.counterpart?.name
    if (user && name) { try { localStorage.setItem(THREAD_PREFIX + id, JSON.stringify({ userId: user.id, data })) } catch {} }
  }, [user])
  const prefetchThread = useCallback((id: string) => {
    if (!id || threadCache.current.has(id)) return
    // ⚠️ peek=1 — a prefetch must NEVER mark the thread read. Without it this warm-up
    // (top 3 on inbox load, plus onTouchStart per row) cleared the unread counter on
    // threads the user never opened, so the blue rail + count badge vanished before
    // they could be seen and scrolling the list marked messages read.
    fetch(`/api/conversations/${id}?peek=1`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) cacheThread(id, d) }).catch(() => {})
  }, [cacheThread])

  // Preload the inbox so opening Messages is instant. This is FUNCTIONAL caching
  // of the user's OWN data, persisted per-user to localStorage (keyed by userId
  // so it never leaks across accounts) — it works without waiting for the cookie
  // banner. Also prefetches the top conversations so opening them is instant.
  // The undo window a deleted conversation waits out before its server DELETE (deleteConvo below).
  const undoWindow = useUndoWindow()
  const refreshConvos = useCallback(() => {
    if (!user) { setConvos(null); return }
    fetch('/api/conversations').then((r) => r.json()).then((d) => {
      // ⚠️ A conversation still inside its delete's undo window stays OUT of the list. The server has not
      // hidden it yet, so a refresh in those seconds — another conversation's Undo (which re-pulls), a
      // realtime bump, the tab coming back — used to put it back on screen with its DELETE still about to
      // go out. Its own Undo is not affected: the window closes before undo() runs, so it re-pulls itself in.
      const list: InboxConvo[] = ((d.conversations ?? []) as InboxConvo[]).filter((c) => !undoWindow.isOpen(`convo:${c.id}`))
      setConvos(list)
      try { localStorage.setItem(CONVOS_KEY, JSON.stringify({ userId: user.id, list })) } catch {}
      list.slice(0, 3).forEach((c) => prefetchThread(c.id))
    }).catch(() => {})
  }, [user, prefetchThread, undoWindow])

  // Mirror of `convos` for handler-time reads (deleteConvo computes the next
  // list without reaching inside a state updater — updaters must stay pure).
  const convosRef = useRef<InboxConvo[] | null>(null)
  useEffect(() => { convosRef.current = convos }, [convos])

  // Delete a conversation from MY inbox (per-user hide, non-destructive on the
  // server). Optimistic: drop it from the list + caches now, then call the API.
  const deleteConvo = useCallback((id: string) => {
    // Compute the next list OUTSIDE the setConvos updater: the localStorage
    // write is a side effect, and updaters must be pure (StrictMode double-
    // invokes them, so an impure updater writes the cache twice — or worse).
    const next = (convosRef.current ?? []).filter((c) => c.id !== id)
    convosRef.current = next
    setConvos(next)
    if (user) { try { localStorage.setItem(CONVOS_KEY, JSON.stringify({ userId: user.id, list: next })) } catch {} }
    threadCache.current.delete(id)
    if (user) { try { localStorage.removeItem(THREAD_PREFIX + id) } catch {} }
    // Hold the server DELETE inside an undo window so a mis-tap is recoverable — the row stays
    // server-side until then, so Undo just re-pulls the inbox.
    // ⛔ THE WINDOW IS THE HOUSE HOOK'S (src/hooks/use-undo-window.tsx). It used to be a 5s setTimeout
    // beside a sonner toast of `duration: 5000`; sonner PAUSES its timer while the toast is touched or
    // hovered and while the tab is hidden, so the DELETE could go out with "Undo" still on screen and a
    // tap on it re-pulled an inbox the conversation had already left. One clock now owns the window and
    // the toast is taken down the moment the DELETE is sent. Leaving — pagehide, the tab hidden — sends
    // it at once (this used to flush on pagehide only, which a phone discarding a backgrounded tab never
    // fires). keepalive on every send, because a timer commit can be followed by a reload that would
    // abort a plain fetch in flight; the route is an idempotent per-user hide, and the hook's flush also
    // stops the clock, so a bfcache restore cannot fire a SECOND DELETE whose deletedAt restamp could
    // hide a reply that landed in between.
    undoWindow.start(`convo:${id}`, {
      title: tr('Conversation removed', 'Đã xóa cuộc trò chuyện'),
      undoLabel: tr('Undo', 'Hoàn tác'),
      undo: () => refreshConvos(),
      commit: () => {
        // On failure, ROLL BACK the optimistic removal: the row still exists server-side,
        // so re-pulling the inbox restores it — and say so instead of silently desyncing.
        const rollback = () => { toast.error(tr("Couldn't delete — try again", 'Chưa xóa được — thử lại')); refreshConvos() }
        // On success, re-pull too: the window closes BEFORE the DELETE lands, so a pull answered in that gap
        // (a realtime bump, the tab coming back) could list the conversation again, and nothing else would
        // take it away (opus, 2026-10-06). ⚠️ Pulls are still unordered: an OLDER pull resolving after this
        // re-pull can show it until the next one. Ordering them belongs with the inbox's error handling
        // (fix 3 of the 2026-10-06 audit) — tried here, it drew a newest-pull-fails edge of its own.
        fetch(`/api/conversations/${id}`, { method: 'DELETE', keepalive: true })
          .then((r) => { if (r.ok) { refreshUnread(); refreshConvos() } else rollback() })
          .catch(rollback)
      },
    })
  }, [user, refreshUnread, refreshConvos, tr, undoWindow])

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
    // NO interval of our own: the periodic backstop rides NotificationsProvider's
    // 45s visibility-gated poll — /api/notifications piggybacks the conversations-
    // unread total and the provider broadcasts it as 'eno:convo-unread' (consumed
    // here), so signed-in tabs run ONE badge poll instead of two. This provider
    // keeps only the IMMEDIATE refresh triggers: sign-in, tab shown again, and
    // the realtime nudge / post-send refreshUnread() calls elsewhere.
    const onVis = () => { if (document.visibilityState === 'visible') refreshUnread() }
    const onBroadcast = (e: Event) => {
      const n = (e as CustomEvent<{ unread?: number }>).detail?.unread
      if (typeof n === 'number') setUnread(n)
    }
    refreshUnread()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('eno:convo-unread', onBroadcast)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('eno:convo-unread', onBroadcast)
    }
  }, [user, refreshUnread])

  // REALTIME: warm the socket on sign-in and subscribe to ONE private user topic
  // ('user:<myId>') so the unread badge + inbox update INSTANTLY on any incoming
  // message — across ALL my conversations, unbounded (no 30-convo cap). The trigger
  // broadcasts a content-free 'convo_activity' nudge to each participant's user
  // topic; the open thread keeps its own convo:<id> subscription for live content.
  // The 45s NotificationsProvider poll (via 'eno:convo-unread', consumed above)
  // stays as a backstop. Keyed only by user → never re-subscribes.
  useEffect(() => {
    if (!user) return
    // Supabase is imported LAZILY here (same pattern as auth-context) — a static
    // import in this globally-mounted provider put ~60 KiB of supabase-js in every
    // page's first-load bundle, including for logged-out visitors.
    const importClient = async () => (await import('@/lib/supabase/browser')).createSupabaseBrowser()
    let supabase: Awaited<ReturnType<typeof importClient>> | null = null
    let cancelled = false
    let debounce: ReturnType<typeof setTimeout> | null = null
    let channel: import('@supabase/supabase-js').RealtimeChannel | null = null
    const bump = () => { if (debounce) return; debounce = setTimeout(() => { debounce = null; refreshUnread(); refreshConvos() }, 300) }
    const subscribe = async () => {
      if (channel) return
      if (!supabase) supabase = await importClient()
      if (cancelled) return
      const { data } = await supabase.auth.getSession()
      if (cancelled || !data.session) return
      await supabase.realtime.setAuth(data.session.access_token)
      supabase.realtime.connect() // warm the WS so subsequent thread subscribes are instant
      channel = supabase
        .channel(`user:${user.id}`, { config: { private: true } })
        .on('broadcast', { event: 'convo_activity' }, ({ payload }) => {
          const p = (payload ?? {}) as { senderProfileId?: string }
          if (p.senderProfileId && p.senderProfileId === user.id) return // my own send
          bump()
        })
        .subscribe()
    }
    const unsubscribe = () => { if (channel && supabase) { supabase.removeChannel(channel); channel = null } }
    // An open WebSocket makes a page ineligible for the back/forward cache, so the
    // back button re-mounts everything instead of restoring instantly. Drop the
    // socket as the page enters bfcache (pagehide) and restore it on return.
    const onPageHide = () => { unsubscribe(); supabase?.realtime.disconnect() }
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) { refreshUnread(); refreshConvos(); subscribe() } }

    subscribe()
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      cancelled = true
      if (debounce) clearTimeout(debounce)
      unsubscribe()
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [user, refreshUnread, refreshConvos])

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

  const value = useMemo(() => ({ open, view, conversationId, starting, unread, convos, refreshConvos, deleteConvo, getCachedThread, cacheThread, prefetchThread, draft, setDraft, pendingSend, setPendingSend, refreshUnread, openInbox, openThread, openPendingThread, back, close }), [open, view, conversationId, starting, unread, convos, refreshConvos, deleteConvo, getCachedThread, cacheThread, prefetchThread, draft, pendingSend, refreshUnread, openInbox, openThread, openPendingThread, back, close])

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  )
}

export function useChat() {
  const c = useContext(ChatContext)
  if (!c) throw new Error('useChat must be used within a ChatProvider')
  return c
}
