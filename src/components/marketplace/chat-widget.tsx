'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { MessageSquare, ChevronLeft, ChevronRight, X, Send, Loader2, Phone, Trash2, Tag, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useChat } from '@/context/chat-context'
import { createSupabaseBrowser } from '@/lib/supabase/browser'
import { Price } from './price'

type Msg = { id: string; mine: boolean; body: string; createdAt: string; pending?: boolean; failed?: boolean; kind?: string; offerAmount?: number | null; offerStatus?: string | null }
type Listing = { id: string; title: string; image: string | null; price: number; currency: string; priceUnit: string }
type Thread = {
  id: string; me: string; listing: Listing
  counterpart: { name: string; avatarColor: string; avatarUrl: string | null; sellerId?: string | null }; messages: Msg[]
}

function Avatar({ name, color, url, size = 36 }: { name: string; color: string; url: string | null; size?: number }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" style={{ width: size, height: size }} className="shrink-0 rounded-full object-cover" />
  ) : (
    <span style={{ width: size, height: size, backgroundColor: color }} className="flex shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">
      {name.slice(0, 2).toUpperCase()}
    </span>
  )
}

/** Animated "…" the counterpart is typing (three bouncing dots). */
function TypingDots() {
  return (
    <div className="flex justify-start duration-200 animate-in fade-in slide-in-from-bottom-1">
      <div className="flex items-center gap-1 rounded-2xl bg-card px-3.5 py-3 shadow-pop">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
      </div>
    </div>
  )
}

/** Usable empty chat shown the instant "Message" is tapped — composer is ready
 *  to type while the conversation is created in the background. Whatever is typed
 *  (and a queued send) carries over to the real thread the moment it mounts. */
function PendingThread({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const { tr } = useLanguage()
  const { draft, setDraft, setPendingSend } = useChat()
  const queue = () => { if (draft.trim()) setPendingSend(true) } // sent by the real thread the instant it mounts
  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button onClick={onBack} aria-label={tr('Back', 'Quay lại')} className="text-muted-foreground hover:text-accent-foreground"><ChevronLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-foreground">{tr('New message', 'Tin nhắn mới')}</div>
        </div>
        <button onClick={onClose} aria-label={tr('Close', 'Đóng')} className="text-ink-4 hover:text-foreground"><X className="h-5 w-5" /></button>
      </div>
      <div className="flex flex-1 items-center justify-center bg-background px-6">
        <p className="text-center text-xs text-ink-4">{tr('Say hello — the seller is notified once you send.', 'Gửi lời chào — người bán sẽ được thông báo khi bạn gửi.')}</p>
      </div>
      <div className="flex items-end gap-2 px-3 py-2.5">
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); queue() } }}
          rows={1}
          placeholder={tr('Write a message…', 'Nhập tin nhắn…')}
          className="max-h-24 flex-1 resize-none rounded-2xl border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <button onClick={queue} disabled={!draft.trim()} aria-label={tr('Send', 'Gửi')} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white disabled:opacity-40">
          <Send className="h-4 w-4" />
        </button>
      </div>
    </>
  )
}

/** Floating chat: a corner launcher that expands into a docked panel (inbox +
 *  thread). Replaces full-page navigation; rendered once in the layout. */
export function ChatWidget() {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const { open, view, conversationId, starting, unread, refreshUnread, refreshConvos, openInbox, openThread, back, close } = useChat()

  // Render while auth is still resolving too, so an optimistically-opened panel
  // (Message tapped before auth settles) paints instantly. Truly-anon users are
  // already excluded by ChatWidgetGate.
  if (!user && !loading) return null

  return (
    <>
      {/* Launcher (hidden while the panel is open) */}
      {!open && (
        <button
          onClick={openInbox}
          aria-label={tr('Messages', 'Tin nhắn')}
          className="fixed bottom-5 right-5 z-[100] hidden h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-overlay transition-transform hover:scale-105 active:scale-95 lg:flex"
        >
          <MessageSquare className="h-6 w-6" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white ring-2 ring-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      )}

      {/* Docked panel */}
      {open && (
        <div className="fixed inset-x-2 top-16 z-[100] flex flex-col overflow-hidden rounded-2xl bg-card shadow-overlay bottom-[calc(4rem+env(safe-area-inset-bottom)+0.5rem)] sm:inset-x-auto sm:right-5 sm:left-auto sm:top-auto sm:h-[560px] sm:max-h-[80vh] sm:w-[380px] sm:bottom-[calc(4rem+env(safe-area-inset-bottom)+0.5rem)] lg:bottom-5">
          {view === 'thread' && conversationId ? (
            <ChatThread key={conversationId} id={conversationId} onBack={back} onClose={close} onSent={() => { refreshUnread(); refreshConvos() }} />
          ) : view === 'thread' && starting ? (
            <PendingThread onBack={back} onClose={close} />
          ) : (
            <ChatInbox onOpenThread={openThread} onClose={close} />
          )}
        </div>
      )}
    </>
  )
}

function ChatInbox({ onOpenThread, onClose }: { onOpenThread: (id: string) => void; onClose: () => void }) {
  const { tr } = useLanguage()
  // Preloaded + cached in ChatContext (prefetched on login) so this is instant.
  const { convos, deleteConvo } = useChat()
  const [confirmId, setConfirmId] = useState<string | null>(null) // row showing the Delete confirm

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-base font-bold text-foreground">{tr('Messages', 'Tin nhắn')}</h2>
        <button onClick={onClose} aria-label={tr('Close', 'Đóng')} className="text-ink-4 hover:text-foreground"><X className="h-5 w-5" /></button>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin">
        {convos === null ? (
          <div className="space-y-2 p-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-tint" />)}</div>
        ) : convos.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-ink-4">{tr('No messages yet. Tap "Message" on a listing to start a chat.', 'Chưa có tin nhắn. Nhấn "Nhắn tin" trên một tin đăng để bắt đầu.')}</p>
        ) : (
          <ul>
            {convos.map((c) => (
              <li key={c.id} className="group flex items-center hover:bg-muted">
                <button onClick={() => onOpenThread(c.id)} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left">
                  <Avatar name={c.counterpart.name} color={c.counterpart.avatarColor} url={c.counterpart.avatarUrl} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold text-foreground">{c.counterpart.name}</span>
                      {c.unread > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">{c.unread}</span>}
                    </div>
                    <p className="truncate text-xs text-ink-4">{c.listingTitle}</p>
                    <p className={`truncate text-xs ${c.unread > 0 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{c.lastMessageText || tr('New conversation', 'Cuộc trò chuyện mới')}</p>
                  </div>
                  {c.listingImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.listingImage} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
                  )}
                </button>
                {/* Delete conversation: tap the trash → it becomes a Delete/Cancel
                    confirm (so a stray tap on mobile can't wipe a thread). The
                    server-side delete is per-user + non-destructive. */}
                {confirmId === c.id ? (
                  <div className="flex shrink-0 items-center gap-1 pr-2 pl-1">
                    <button onClick={() => { deleteConvo(c.id); setConfirmId(null) }} className="rounded-full bg-red-500 px-2.5 py-1 text-[11px] font-bold text-white transition-transform active:scale-95">{tr('Delete', 'Xóa')}</button>
                    <button onClick={() => setConfirmId(null)} aria-label={tr('Cancel', 'Hủy')} className="rounded-full p-1 text-ink-4 hover:text-foreground"><X className="h-4 w-4" /></button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmId(c.id)}
                    aria-label={tr('Delete conversation', 'Xóa cuộc trò chuyện')}
                    className="mr-2 ml-1 shrink-0 rounded-full p-1.5 text-slate-400 opacity-100 transition hover:bg-red-50 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

function ChatThread({ id, onBack, onClose, onSent }: { id: string; onBack: () => void; onClose: () => void; onSent: () => void }) {
  const { tr } = useLanguage()
  const { getCachedThread, cacheThread, draft, setDraft, pendingSend, setPendingSend } = useChat()
  // Hydrate instantly from the prefetched cache (e.g. the most-recent thread),
  // then load() revalidates below.
  const cached = getCachedThread(id) as Thread | null
  const [thread, setThread] = useState<Thread | null>(cached)
  // Inherit anything typed in the pending shell so the swap loses nothing.
  const [text, setText] = useState(draft)
  const [showOffer, setShowOffer] = useState(false) // offer amount input visible
  const [offerInput, setOfferInput] = useState('')
  const [peerTyping, setPeerTyping] = useState(false)
  const [contact, setContact] = useState<{ phone: string; telHref: string; zaloHref: string } | null>(null)
  const [revealing, setRevealing] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const meRef = useRef(cached?.me ?? '')   // my profile id, for ignoring my own typing echo
  const lastTypingSent = useRef(0)         // throttle outgoing typing pings
  const peerTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/conversations/${id}`)
    if (!res.ok) return
    const data = (await res.json()) as Thread
    meRef.current = data.me
    setThread(data)
    cacheThread(id, data) // keep the cache warm for the next open
  }, [id, cacheThread])

  // Delete one of MY messages — optimistic; the API removes it (and a realtime
  // 'message_deleted' broadcast / the backstop poll removes it on the other side).
  // Reveal the seller's number + Zalo on request (login-gated + rate-limited +
  // logged as a lead by the API). The buyer messages first, then taps this.
  const requestContact = async () => {
    if (contact || revealing || !thread) return
    setRevealing(true)
    try {
      const res = await fetch(`/api/listings/${thread.listing.id}/contact`, { method: 'POST' })
      if (res.ok) setContact(await res.json())
    } finally {
      setRevealing(false)
    }
  }

  // Throttled "I'm typing" ping (server broadcasts it to the other participant).
  const sendTyping = () => {
    const now = Date.now()
    if (now - lastTypingSent.current < 2500) return
    lastTypingSent.current = now
    fetch(`/api/conversations/${id}/typing`, { method: 'POST' }).catch(() => {})
  }

  // Realtime: subscribe to this conversation's PRIVATE channel (RLS-gated to the
  // two participants). The DB trigger broadcasts the full message body, so we
  // render straight from the socket payload — ZERO refetch round-trip. If a
  // payload arrives without a body (e.g. an old content-free nudge) we fall back
  // to load(). A 20s/visibility poll is a permanent backstop so a dropped or
  // unauthorized socket (e.g. a missed token refresh) never loses a message.
  useEffect(() => {
    load()
    const supabase = createSupabaseBrowser()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    let attempts = 0

    // Tear down a channel WITHOUT re-entrancy: null the ref first so the status
    // callback (which fires 'CLOSED' on removal) can't call back into teardown.
    const drop = () => { if (channel) { const c = channel; channel = null; supabase.removeChannel(c) } }

    // Join the PRIVATE channel. AWAIT realtime auth with the current token FIRST —
    // a private join rejected for a missing token stays dead, and an un-awaited
    // setAuth can race the join into CHANNEL_ERROR. Retry only genuine failures
    // (never 'CLOSED' — that's our own teardown and would recurse), capped; the
    // 20s poll backstops delivery so nothing is lost meanwhile.
    const join = async () => {
      if (cancelled) return
      drop()
      const { data } = await supabase.auth.getSession()
      if (cancelled || !data.session) return
      await supabase.realtime.setAuth(data.session.access_token)
      if (cancelled) return
      channel = supabase
        .channel(`convo:${id}`, { config: { private: true } })
        .on('broadcast', { event: 'new_message' }, ({ payload }) => {
          setPeerTyping(false)
          const p = (payload ?? {}) as { id?: string; body?: string; senderProfileId?: string; createdAt?: string }
          if (!p.id || !p.body) { load(); return }
          // Offers / offer-actions carry structured fields the realtime payload
          // doesn't include — refetch to hydrate the offer card + status.
          if (/^(💰|✅|❌)/.test(p.body)) { load(); return }
          setThread((t) => {
            if (!t || t.messages.some((x) => x.id === p.id)) return t // dedup by id
            const msg: Msg = { id: p.id!, mine: p.senderProfileId === t.me, body: p.body!, createdAt: p.createdAt || new Date().toISOString() }
            return { ...t, messages: [...t.messages, msg] }
          })
        })
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
          const from = (payload as { from?: string } | null)?.from
          if (!from || from === meRef.current) return // ignore my own echo
          setPeerTyping(true)
          if (peerTypingTimer.current) clearTimeout(peerTypingTimer.current)
          peerTypingTimer.current = setTimeout(() => setPeerTyping(false), 3500)
        })
        .on('broadcast', { event: 'message_deleted' }, ({ payload }) => {
          const did = (payload as { id?: string } | null)?.id
          if (did) setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== did) } : t))
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') { attempts = 0; return }
          if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !cancelled && !retry && attempts < 5) {
            attempts++
            retry = setTimeout(() => { retry = null; join() }, 3000)
          }
        })
    }
    join()

    let iv: ReturnType<typeof setInterval> | null = null
    const stop = () => { if (iv) { clearInterval(iv); iv = null } }
    const start = () => { if (!iv) iv = setInterval(load, 20000) }
    const onVis = () => {
      if (document.visibilityState === 'visible') { load(); start() } else stop()
    }
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      if (retry) clearTimeout(retry)
      if (peerTypingTimer.current) clearTimeout(peerTypingTimer.current)
      drop()
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load, id])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [thread?.messages.length, peerTyping])

  const send = async (override?: string) => {
    const body = (override ?? text).trim()
    if (!body) return
    // Optimistic: show the bubble the instant Enter is pressed. On the POST
    // response we drop the temp and add the real message — but only if the
    // realtime broadcast (the sender receives its own message too) hasn't
    // already delivered it, so it's dup-proof in every interleaving.
    const tempId = `temp-${Date.now()}`
    const optimistic: Msg = { id: tempId, mine: true, body, createdAt: new Date().toISOString(), pending: true }
    setText('')
    setThread((t) => (t ? { ...t, messages: [...t.messages, optimistic] } : t))
    try {
      const res = await fetch(`/api/conversations/${id}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
      })
      if (res.ok) {
        const m = (await res.json()) as Msg
        setThread((t) => {
          if (!t) return t
          // Drop the optimistic temp, then add the real message only if the
          // realtime broadcast hasn't already delivered it (dedup by real id).
          const without = t.messages.filter((x) => x.id !== tempId)
          if (without.some((x) => x.id === m.id)) return { ...t, messages: without }
          return { ...t, messages: [...without, m] }
        })
        onSent()
      } else {
        markFailed(tempId)
      }
    } catch {
      markFailed(tempId)
    }
  }

  // Keep the bubble on failure (don't vanish it) — flip it to a tap-to-retry state
  // so a flaky-network send is never silently lost.
  const markFailed = (tempId: string) =>
    setThread((t) => (t ? { ...t, messages: t.messages.map((x) => (x.id === tempId ? { ...x, pending: false, failed: true } : x)) } : t))

  const retry = (m: Msg) => {
    setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== m.id) } : t))
    void send(m.body)
  }

  // Send a structured offer (a message with kind='offer' + amount). Optimistic,
  // then refetch to hydrate the real offer fields + supersede prior offers.
  const sendOffer = async (amount: number) => {
    const amt = Math.round(amount)
    if (!amt || amt <= 0) return
    const tempId = `temp-${Date.now()}`
    const body = `💰 Offered ${new Intl.NumberFormat('en-US').format(amt)}₫`
    const optimistic: Msg = { id: tempId, mine: true, body, createdAt: new Date().toISOString(), pending: true, kind: 'offer', offerAmount: amt, offerStatus: 'pending' }
    setThread((t) => (t ? { ...t, messages: [...t.messages, optimistic] } : t))
    try {
      const res = await fetch(`/api/conversations/${id}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offerAmount: amt }),
      })
      if (res.ok) { await load(); onSent() }
      else { setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== tempId) } : t)); toast.error(tr('Offer not sent — please try again.', 'Chưa gửi được đề nghị — vui lòng thử lại.')) }
    } catch {
      setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== tempId) } : t)); toast.error(tr('Offer not sent — please try again.', 'Chưa gửi được đề nghị — vui lòng thử lại.'))
    }
  }

  // Accept/decline a pending offer (recipient only). Optimistic flip, then ALWAYS
  // reconcile from the server (whether it succeeded or was rejected 409 — already
  // countered/not actionable) so the optimistic flip never sticks wrongly. A ref guard
  // blocks double-clicks from firing duplicate POSTs.
  const actingOffer = useRef(false)
  const actOffer = async (messageId: string, action: 'accept' | 'decline') => {
    if (actingOffer.current) return
    actingOffer.current = true
    setThread((t) => (t ? { ...t, messages: t.messages.map((m) => (m.id === messageId ? { ...m, offerStatus: action === 'accept' ? 'accepted' : 'declined' } : m)) } : t))
    try {
      await fetch(`/api/conversations/${id}/offer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId, action }),
      })
    } catch { /* network error — the reconcile below re-syncs */ }
    await load().catch(() => {})
    actingOffer.current = false
  }

  // Took over from the pending shell: clear the shared draft (already inherited
  // into local text) and auto-send if the user hit send before the convo existed.
  useEffect(() => {
    if (draft) setDraft('')
    if (pendingSend) { setPendingSend(false); void send(draft) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button onClick={onBack} aria-label={tr('Back', 'Quay lại')} className="text-muted-foreground hover:text-accent-foreground"><ChevronLeft className="h-5 w-5" /></button>
        <Avatar name={thread?.counterpart.name || '?'} color={thread?.counterpart.avatarColor || '#0a66c2'} url={thread?.counterpart.avatarUrl ?? null} size={32} />
        <div className="min-w-0 flex-1">
          {thread?.counterpart.sellerId ? (
            <Link onClick={onClose} href={`/sellers/${thread.counterpart.sellerId}`} className="block truncate text-sm font-bold text-foreground hover:underline">{thread.counterpart.name}</Link>
          ) : (
            <div className="truncate text-sm font-bold text-foreground">{thread?.counterpart.name || '…'}</div>
          )}
          {peerTyping && <div className="truncate text-[11px] font-medium text-accent-foreground">{tr('typing…', 'đang nhập…')}</div>}
        </div>
        <button onClick={onClose} aria-label={tr('Close', 'Đóng')} className="text-ink-4 hover:text-foreground"><X className="h-5 w-5" /></button>
      </div>

      {/* Pinned listing the conversation is about (Shopee-style product context). */}
      {thread && (
        <Link onClick={onClose} href={`/listings/${thread.listing.id}`} className="flex items-center gap-3 bg-card px-3 py-2 hover:bg-muted">
          {thread.listing.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thread.listing.image} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
          ) : (
            <div className="h-10 w-10 shrink-0 rounded-lg bg-tint" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-foreground">{thread.listing.title}</p>
            <Price price={thread.listing.price} currency={thread.listing.currency} priceUnit={thread.listing.priceUnit} className="text-xs font-bold text-accent-foreground" />
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-[#cbd5e1]" />
        </Link>
      )}

      {/* Contact is requested IN-CHAT, and only once the seller has replied — this
          is what gets sellers logging in daily to answer + keep listings fresh. */}
      {thread && (
        <div className="flex items-center gap-2 bg-card px-3 py-2">
          {contact ? (
            <>
              <a href={contact.telHref} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-foreground hover:bg-muted transition-colors">
                <Phone className="h-3.5 w-3.5" /> {contact.phone}
              </a>
              <a href={contact.zaloHref} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-full bg-[#0068ff] px-3 py-1.5 text-xs font-bold text-white">
                Zalo
              </a>
            </>
          ) : thread.messages.some((m) => !m.mine) ? (
            <button onClick={requestContact} disabled={revealing} className="flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50 cursor-pointer">
              {revealing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Phone className="h-3.5 w-3.5" />}
              {tr('Request number / Zalo', 'Lấy số / Zalo')}
            </button>
          ) : (
            <p className="flex items-center gap-1.5 text-[11px] text-body">
              <Phone className="h-3.5 w-3.5 shrink-0 text-ink-4" />
              {tr("You can request the seller's number or Zalo once they reply.", 'Bạn có thể xin số hoặc Zalo sau khi người bán trả lời.')}
            </p>
          )}
        </div>
      )}

      <div role="log" aria-live="polite" aria-relevant="additions" className="flex-1 space-y-2 overflow-y-auto bg-background px-3 py-3 scroll-thin">
        {!thread && (
          <div className="space-y-2">
            {[60, 42, 70, 50].map((w, i) => (
              <div key={i} className={`flex ${i % 2 ? 'justify-end' : 'justify-start'}`}>
                <div className="h-9 animate-pulse rounded-2xl bg-slate-200" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        )}
        {thread?.messages.map((m) => (
          <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
            {m.kind === 'offer' ? (
              <div className={`max-w-[80%] rounded-2xl border px-3 py-2.5 ${m.mine ? 'border-brand/30 bg-primary/5' : 'border-border bg-card'}`}>
                <div className="text-[11px] font-bold uppercase tracking-wide text-accent-foreground">💰 {tr('Offer', 'Đề nghị')}</div>
                <div className="mt-0.5 text-base font-bold text-foreground">{new Intl.NumberFormat('en-US').format(m.offerAmount || 0)}₫</div>
                {m.offerStatus === 'pending' && (
                  <div className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[#b45309]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#b45309]" /> {tr('Pending', 'Đang chờ')}
                  </div>
                )}
                {m.offerStatus && m.offerStatus !== 'pending' && (
                  <div className={`mt-1 text-xs font-semibold ${m.offerStatus === 'accepted' ? 'text-emerald-600' : m.offerStatus === 'declined' ? 'text-red-500' : 'text-ink-4'}`}>
                    {m.offerStatus === 'accepted' ? tr('Accepted', 'Đã chấp nhận') : m.offerStatus === 'declined' ? tr('Declined', 'Đã từ chối') : tr('Countered', 'Đã trả giá khác')}
                  </div>
                )}
                {!m.mine && m.offerStatus === 'pending' && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button onClick={() => actOffer(m.id, 'accept')} className="rounded-lg bg-primary px-3 py-1 text-xs font-bold text-white transition-colors hover:bg-brand-dark cursor-pointer">{tr('Accept', 'Chấp nhận')}</button>
                    <button onClick={() => actOffer(m.id, 'decline')} className="rounded-lg px-3 py-1 text-xs font-bold text-body transition-colors hover:bg-muted cursor-pointer">{tr('Decline', 'Từ chối')}</button>
                    <button onClick={() => { setOfferInput(m.offerAmount ? new Intl.NumberFormat('en-US').format(m.offerAmount) : ''); setShowOffer(true) }} className="rounded-lg px-3 py-1 text-xs font-bold text-accent-foreground transition-colors hover:bg-muted cursor-pointer">{tr('Counter', 'Trả giá')}</button>
                  </div>
                )}
                {m.mine && m.offerStatus === 'pending' && (
                  <div className="mt-1 text-xs text-ink-4">{tr('Waiting for a response…', 'Đang chờ phản hồi…')}</div>
                )}
              </div>
            ) : (
              <div className={cn('flex max-w-[80%] flex-col', m.mine ? 'items-end' : 'items-start')}>
                <div className={cn(
                  'rounded-2xl px-3 py-2 text-sm leading-relaxed',
                  m.failed ? 'border border-destructive/30 bg-destructive/10 text-destructive' : m.mine ? 'bg-primary text-white' : 'border border-border bg-card text-foreground',
                  m.pending && 'opacity-70',
                )}>
                  {m.body}
                </div>
                {m.mine && m.pending && (
                  <span className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-4"><Loader2 className="h-2.5 w-2.5 animate-spin" /> {tr('Sending…', 'Đang gửi…')}</span>
                )}
                {m.mine && m.failed && (
                  <button onClick={() => retry(m)} className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-destructive hover:underline cursor-pointer">
                    <RotateCcw className="h-2.5 w-2.5" /> {tr('Not sent — tap to retry', 'Chưa gửi — chạm để thử lại')}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {thread && thread.messages.length === 0 && !peerTyping && (
          <p className="py-10 text-center text-xs text-ink-4">{tr('Say hello — this seller will be notified.', 'Gửi lời chào — người bán sẽ được thông báo.')}</p>
        )}
        {peerTyping && <TypingDots />}
        <div ref={bottomRef} />
      </div>

      {/* Offer amount input (toggled by the Offer button) */}
      {showOffer && (
        <div className="flex items-center gap-2 px-3 pt-2">
          <input
            value={offerInput}
            onChange={(e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 12); setOfferInput(d ? new Intl.NumberFormat('en-US').format(Number(d)) : '') }}
            inputMode="numeric"
            autoFocus
            placeholder={tr('Offer amount (₫)', 'Số tiền đề nghị (₫)')}
            className="min-w-0 flex-1 rounded-2xl border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            onKeyDown={(e) => { if (e.key === 'Enter') { const n = Number(offerInput.replace(/\D/g, '')); if (n > 0) { sendOffer(n); setShowOffer(false); setOfferInput('') } } }}
          />
          <button
            onClick={() => { const n = Number(offerInput.replace(/\D/g, '')); if (n > 0) { sendOffer(n); setShowOffer(false); setOfferInput('') } }}
            disabled={!offerInput}
            className="shrink-0 rounded-2xl bg-primary px-3.5 py-2 text-sm font-bold text-white transition-colors hover:bg-brand-dark disabled:opacity-40 cursor-pointer"
          >
            {tr('Send offer', 'Gửi đề nghị')}
          </button>
          <button onClick={() => { setShowOffer(false); setOfferInput('') }} aria-label={tr('Cancel', 'Hủy')} className="shrink-0 text-ink-4 hover:text-foreground cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2 px-3 py-2.5">
        <button
          onClick={() => setShowOffer((s) => !s)}
          aria-label={tr('Make an offer', 'Gửi đề nghị giá')}
          title={tr('Make an offer', 'Gửi đề nghị giá')}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors cursor-pointer ${showOffer ? 'text-accent-foreground' : 'text-ink-4 hover:bg-muted'}`}
        >
          <Tag className="h-[18px] w-[18px]" />
        </button>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); sendTyping() }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          rows={1}
          placeholder={tr('Write a message…', 'Nhập tin nhắn…')}
          className="max-h-24 flex-1 resize-none rounded-2xl border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <button onClick={() => send()} disabled={!text.trim()} aria-label={tr('Send', 'Gửi')} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-transform active:scale-90 disabled:opacity-40">
          <Send className="h-4 w-4" />
        </button>
      </div>
    </>
  )
}
