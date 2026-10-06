'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import { useAuth } from './auth-context'
import { useLanguage } from './language-context'
import { useUndoWindow } from '@/hooks/use-undo-window'
import type { DashError } from '@/hooks/use-dashboard'

// The house degrade (currency-context.tsx): a layout effect where there is a layout, a plain one on the
// server, which would otherwise log "useLayoutEffect does nothing on the server" on every SSR'd page.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * A GET whose JSON body must arrive within `ms`, or it rejects. An AbortController and a timer, not
 * `AbortSignal.timeout`: that one is missing before Safari 16 / Chrome 103, where calling it threw before
 * the fetch existed — outside any `.catch` — and a feature-detected fallback without a timer left a hung
 * pull loading forever (codex + opus, 2026-10-06). ⚠️ The timer covers the BODY too: cleared on the
 * headers, a stalled body (a flaky mobile link, a proxy holding the stream) left `r.json()` pending with
 * nothing to end it (opus). Aborting the controller ends the body read as well. A non-2xx rejects here.
 */
class HttpError extends Error {
  constructor(readonly status: number) { super(`HTTP ${status}`) }
}
async function getJsonWithTimeout(url: string, ms: number): Promise<unknown> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctl.signal })
    if (!r.ok) throw new HttpError(r.status)
    return await r.json()
  } finally {
    clearTimeout(timer)
  }
}
/** 45s, not less: a large inbox on a weak mobile link can take well over 15s, and a give-up that fires
 *  before a slow answer can land fails every retry the same way (opus, round 4). It only has to end a
 *  request that is never going to answer. */
const PULL_TIMEOUT_MS = 45_000

/**
 * ⛔ PER-SESSION ORDER: AN ANSWER APPLIES WHEN IT IS NEWER THAN THE ONE ON SCREEN (codex + opus, round 4).
 * "Only the newest pull started may apply" starved a busy inbox — on a slow link with a message every few
 * seconds every pull was superseded before it answered, and nothing ever landed — and one shared counter
 * let a stale callback from a PREVIOUS session invalidate the current one's pull. So each session (the
 * provider's `session`) keeps its own `started` / `shown`: an answer applies iff it is newer than what is
 * shown, which never starves and still ignores an older pull that lands late.
 * The inbox's ERROR belongs to the newest pull started: only it may raise one (an older pull failing while
 * a newer one is out says nothing about the newer one), and only an answer newer than that failure
 * (`failed`) clears it — an older answer landing late still shows its data, but under the banner, because
 * the refresh that was meant to follow it failed.
 */
type PullOrder = Map<number, { started: number; shown: number; failed: number; retry: number }>
function startPull(order: PullOrder, session: number): number {
  const o = order.get(session) ?? { started: 0, shown: 0, failed: 0, retry: 0 }
  o.started += 1
  order.set(session, o)
  return o.started
}

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
  /** The last inbox pull FAILED: 'auth' for a 401 (the session expired under a signed-in client — the fix is
   *  signing in again, not retrying), 'failed' for anything else (network, non-2xx, an unreadable body, 45s
   *  without an answer). `convos` then still holds what was there before, or null if there never was one. */
  convosError: DashError
  refreshConvos: () => void
  /** Try again: pulls, KEEPING the error up and marking the retry in flight (`convosRetrying`) until an
   *  answer lands (which clears both) or the retry fails (which ends it, error still up). Over a list the
   *  caution stays while the list may still be stale, and the tap shows as busy rather than as nothing. */
  retryConvos: () => void
  /** A Try again is in flight — see retryConvos. */
  convosRetrying: boolean
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
  const [convosError, setConvosError] = useState<DashError>(null)
  /**
   * ⛔ A CHANGE OF USER RESETS THE INBOX STATE IN THE SAME RENDER (codex + opus, 2026-10-06). The effects
   * below clear it only after the new user's first paint — one frame of the previous account's names and
   * messages — and, now that a failed pull KEEPS what was there, a failed first pull for the new account
   * would have kept the previous account's inbox and unread badge on screen indefinitely. React's
   * "adjust state when a prop changes" pattern: compared and reset during render, before anything paints.
   * The same block starts a new `session` (below).
   */
  const [stateOwner, setStateOwner] = useState<string | null>(user?.id ?? null)
  const [session, setSession] = useState(0)
  /** The session a Try again is in flight for (retryConvos). Tagged, not a boolean, so a stale retry from a
   *  previous session — its answer is dropped on arrival and could never clear it — cannot leave the next
   *  session's inbox busy (codex, round 8): `convosRetrying` is true only for the current session. */
  const [retryingFor, setRetryingFor] = useState<number | null>(null)
  const convosRetrying = retryingFor === session
  if (stateOwner !== (user?.id ?? null)) {
    setStateOwner(user?.id ?? null)
    setSession((s) => s + 1)
    setConvos(null)
    setConvosError(null)
    setRetryingFor(null)
    setUnread(0)
  }

  /**
   * ⛔ AN ANSWER BELONGS TO THE SESSION THAT ASKED (Emil-skills audit + review rounds, 2026-10-06). A pull or
   * an unread count in flight when the user changes — signing out, into another account, or out and back
   * into the SAME one — used to land afterwards: the previous user's inbox shown (and cached) while signed
   * out, or an answer from before a sign-out landing in the next session. And a callback holding an OLD
   * closure (a realtime bump, the tab coming back) could fetch with the new session's cookie and file the
   * answer under the old user — or, after a switch back, show it to the old user (codex + opus, round 5).
   * A user id cannot tell those apart; a session can. `session` moves in the render-phase reset above, on
   * every change of user id, so it has moved before ANY effect runs. Every request captures the session it
   * was made in and is dropped on ARRIVAL if that is no longer the session. There is deliberately no check
   * before starting: a child's effects run before the provider's, and such a check (against a ref the
   * provider had not updated yet) dropped the child's legitimate sign-in pull (opus, round 3).
   * ⚠️ THE REF FOLLOWS `session` IN A LAYOUT EFFECT, NOT A PASSIVE ONE: React runs a CHILD's passive effects
   * before its parent's; layout effects run before every passive effect in the tree, children's included.
   * Auth updates are not transitions (auth-context.tsx), so no render yields between the reset and this.
   */
  const sessionRef = useRef(session)
  const unreadOrder = useRef<PullOrder>(new Map()) // per-session order of unread answers (refreshUnread)
  const convosOrder = useRef<PullOrder>(new Map()) // per-session order of inbox answers (refreshConvos)
  useIsoLayoutEffect(() => {
    sessionRef.current = session
    // Only this session's order is read again — an answer from any other is dropped BEFORE its order is
    // looked up — so the rest go when the session changes (codex + opus, round 6). A stale callback can put
    // its old session back until the next change: a few numbers, bounded.
    for (const order of [unreadOrder.current, convosOrder.current]) {
      for (const k of order.keys()) if (k !== session) order.delete(k)
    }
  }, [session])

  const refreshUnread = useCallback(() => {
    if (!user) { setUnread(0); return }
    const forSession = session
    // ⚠️ A FAILURE KEEPS THE BADGE. A 401/500 body used to read as `unread ?? 0` and hide the count;
    // only a real number from a 2xx answer in THIS session changes it.
    const pull = startPull(unreadOrder.current, forSession) // ordered like the inbox below
    getJsonWithTimeout('/api/conversations/unread', PULL_TIMEOUT_MS)
      .then((d) => {
        const n = (d as { unread?: unknown } | null)?.unread
        if (sessionRef.current !== forSession) return // another session's answer (its order may be gone)
        const o = unreadOrder.current.get(forSession)!
        if (pull <= o.shown || typeof n !== 'number') return
        o.shown = pull
        setUnread(n)
      })
      .catch(() => {})
  }, [user, session])

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
    const forSession = session
    const pull = startPull(convosOrder.current, forSession) // ordered per session — see PullOrder
    /**
     * ⛔ A FAILED PULL IS NOT AN EMPTY INBOX (Emil-skills audit, 2026-10-06). A 401/500 JSON body read as
     * `conversations ?? []`, so an outage told the user "No messages yet" — and CACHED that empty list,
     * so it came back on the next load too; a non-JSON body left the skeletons up forever. Only a 2xx
     * answer with an array is data. Anything else — the network, an unreadable body, 45s without an
     * answer — leaves `convos` and the cache exactly as they were and raises `convosError`, which the
     * inbox turns into a retry, or into Sign in for a 401 (conversation-list.tsx). A real empty inbox is
     * `{ conversations: [] }` and still reads as one.
     */
    getJsonWithTimeout('/api/conversations', PULL_TIMEOUT_MS).then((body) => {
      if (sessionRef.current !== forSession) return // another session's answer (its order may be gone)
      const o = convosOrder.current.get(forSession)!
      if (pull <= o.shown) return
      const d = body as { conversations?: unknown } | null
      if (!Array.isArray(d?.conversations)) throw new Error('unreadable inbox')
      o.shown = pull
      if (pull > o.failed) setConvosError(null)
      if (pull >= o.retry) setRetryingFor(null) // an OLDER pull landing mid-retry does not end it
      // ⚠️ A conversation still inside its delete's undo window stays OUT of the list. The server has not
      // hidden it yet, so a refresh in those seconds — another conversation's Undo (which re-pulls), a
      // realtime bump, the tab coming back — used to put it back on screen with its DELETE still about to
      // go out. Its own Undo is not affected: the window closes before undo() runs, so it re-pulls itself in.
      const list: InboxConvo[] = ((d.conversations ?? []) as InboxConvo[]).filter((c) => !undoWindow.isOpen(`convo:${c.id}`))
      setConvos(list)
      try { localStorage.setItem(CONVOS_KEY, JSON.stringify({ userId: user.id, list })) } catch {}
      list.slice(0, 3).forEach((c) => prefetchThread(c.id))
    }).catch((e: unknown) => {
      if (sessionRef.current !== forSession) return
      const o = convosOrder.current.get(forSession)!
      if (pull <= o.shown || pull !== o.started) return
      o.failed = pull
      if (pull >= o.retry) setRetryingFor(null) // always: the newest pull is the retry or newer
      setConvosError(e instanceof HttpError && e.status === 401 ? 'auth' : 'failed')
    })
  }, [user, session, prefetchThread, undoWindow])
  const retryConvos = useCallback(() => {
    if (!user) return
    refreshConvos()
    // The retry is THIS pull: only its answer, or a newer pull's, ends the busy state — an older pull that
    // lands meanwhile does not (codex + opus, round 7).
    const o = convosOrder.current.get(session)
    if (o) o.retry = o.started
    setRetryingFor(session)
  }, [user, session, refreshConvos])

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

  const value = useMemo(() => ({ open, view, conversationId, starting, unread, convos, convosError, convosRetrying, refreshConvos, retryConvos, deleteConvo, getCachedThread, cacheThread, prefetchThread, draft, setDraft, pendingSend, setPendingSend, refreshUnread, openInbox, openThread, openPendingThread, back, close }), [open, view, conversationId, starting, unread, convos, convosError, convosRetrying, refreshConvos, retryConvos, deleteConvo, getCachedThread, cacheThread, prefetchThread, draft, pendingSend, refreshUnread, openInbox, openThread, openPendingThread, back, close])

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
