'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { MessageSquare, ChevronLeft, X, Send, Loader2 } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useChat } from '@/context/chat-context'
import { createSupabaseBrowser } from '@/lib/supabase/browser'

type Convo = {
  id: string; listingTitle: string; lastMessageAt: string; lastMessageText: string | null
  unread: number; counterpart: { name: string; avatarColor: string; avatarUrl: string | null }
}
type Msg = { id: string; mine: boolean; body: string; createdAt: string; pending?: boolean }
type Thread = {
  id: string; me: string; listing: { id: string; title: string; image: string | null }
  counterpart: { name: string; avatarColor: string; avatarUrl: string | null }; messages: Msg[]
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
      <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white px-3.5 py-3">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
      </div>
    </div>
  )
}

/** Floating chat: a corner launcher that expands into a docked panel (inbox +
 *  thread). Replaces full-page navigation; rendered once in the layout. */
export function ChatWidget() {
  const { user } = useAuth()
  const { tr } = useLanguage()
  const { open, view, conversationId, unread, refreshUnread, openInbox, openThread, back, close } = useChat()

  if (!user) return null // anon users contact via the listing's gated Message button

  return (
    <>
      {/* Launcher (hidden while the panel is open) */}
      {!open && (
        <button
          onClick={openInbox}
          aria-label={tr('Messages', 'Tin nhắn')}
          className="fixed bottom-5 right-5 z-[100] hidden h-14 w-14 items-center justify-center rounded-full bg-[#0a66c2] text-white shadow-overlay transition-transform hover:scale-105 active:scale-95 lg:flex"
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
        <div className="fixed inset-x-2 bottom-2 top-16 z-[100] flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-overlay sm:inset-x-auto sm:right-5 sm:left-auto sm:bottom-5 sm:top-auto sm:h-[560px] sm:max-h-[80vh] sm:w-[380px]">
          {view === 'thread' && conversationId ? (
            <ChatThread key={conversationId} id={conversationId} onBack={back} onClose={close} onSent={refreshUnread} />
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
  const [convos, setConvos] = useState<Convo[] | null>(null)

  useEffect(() => {
    fetch('/api/conversations').then((r) => r.json()).then((d) => setConvos(d.conversations ?? [])).catch(() => setConvos([]))
  }, [])

  return (
    <>
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-base font-bold text-[#1a202c]">{tr('Messages', 'Tin nhắn')}</h2>
        <button onClick={onClose} aria-label={tr('Close', 'Đóng')} className="text-[#94a3b8] hover:text-[#1a202c]"><X className="h-5 w-5" /></button>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin">
        {convos === null ? (
          <div className="space-y-2 p-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}</div>
        ) : convos.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-[#94a3b8]">{tr('No messages yet. Tap "Message" on a listing to start a chat.', 'Chưa có tin nhắn. Nhấn "Nhắn tin" trên một tin đăng để bắt đầu.')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {convos.map((c) => (
              <li key={c.id}>
                <button onClick={() => onOpenThread(c.id)} className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-slate-50">
                  <Avatar name={c.counterpart.name} color={c.counterpart.avatarColor} url={c.counterpart.avatarUrl} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold text-[#1a202c]">{c.counterpart.name}</span>
                      {c.unread > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0a66c2] px-1.5 text-[10px] font-bold text-white">{c.unread}</span>}
                    </div>
                    <p className="truncate text-xs text-[#94a3b8]">{c.listingTitle}</p>
                    <p className={`truncate text-xs ${c.unread > 0 ? 'font-semibold text-[#1a202c]' : 'text-[#64748b]'}`}>{c.lastMessageText || tr('New conversation', 'Cuộc trò chuyện mới')}</p>
                  </div>
                </button>
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
  const [thread, setThread] = useState<Thread | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [peerTyping, setPeerTyping] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const meRef = useRef('')                 // my profile id, for ignoring my own typing echo
  const lastTypingSent = useRef(0)         // throttle outgoing typing pings
  const peerTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/conversations/${id}`)
    if (!res.ok) return
    const data = (await res.json()) as Thread
    meRef.current = data.me
    setThread(data)
  }, [id])

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

    // Join the PRIVATE channel. Arm realtime auth with the current token FIRST —
    // a private join rejected for a missing token stays permanently dead (setAuth
    // only re-arms already-joined channels). If a join still fails, retry; the
    // 20s poll backstops delivery in the meantime so nothing is lost.
    const join = async () => {
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      if (data.session) supabase.realtime.setAuth(data.session.access_token)
      channel = supabase
        .channel(`convo:${id}`, { config: { private: true } })
        .on('broadcast', { event: 'new_message' }, ({ payload }) => {
          setPeerTyping(false)
          const p = (payload ?? {}) as { id?: string; body?: string; senderProfileId?: string; createdAt?: string }
          if (!p.id || !p.body) { load(); return }
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
        .subscribe((status) => {
          if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') && !cancelled && !retry) {
            if (channel) { supabase.removeChannel(channel); channel = null }
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
      if (channel) supabase.removeChannel(channel)
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load, id])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [thread?.messages.length, peerTyping])

  const send = async () => {
    const body = text.trim()
    if (!body || sending) return
    // Optimistic: show the bubble the instant Enter is pressed. On the POST
    // response we drop the temp and add the real message — but only if the
    // realtime broadcast (the sender receives its own message too) hasn't
    // already delivered it, so it's dup-proof in every interleaving.
    const tempId = `temp-${Date.now()}`
    const optimistic: Msg = { id: tempId, mine: true, body, createdAt: new Date().toISOString(), pending: true }
    setText(''); setSending(true)
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
        // Failed: drop the temp bubble and restore the text so the user can retry.
        setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== tempId) } : t))
        setText(body)
      }
    } catch {
      setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== tempId) } : t))
      setText(body)
    } finally { setSending(false) }
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5">
        <button onClick={onBack} aria-label={tr('Back', 'Quay lại')} className="text-[#64748b] hover:text-[#0a66c2]"><ChevronLeft className="h-5 w-5" /></button>
        <Avatar name={thread?.counterpart.name || '?'} color={thread?.counterpart.avatarColor || '#0a66c2'} url={thread?.counterpart.avatarUrl ?? null} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-[#1a202c]">{thread?.counterpart.name || '…'}</div>
          {thread && <Link href={`/listings/${thread.listing.id}`} className="truncate text-[11px] text-[#0a66c2] hover:underline">{thread.listing.title}</Link>}
        </div>
        <button onClick={onClose} aria-label={tr('Close', 'Đóng')} className="text-[#94a3b8] hover:text-[#1a202c]"><X className="h-5 w-5" /></button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto bg-[#fafafa] px-3 py-3 scroll-thin">
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
          <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'} duration-200 animate-in fade-in slide-in-from-bottom-1`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed transition-opacity ${m.mine ? 'bg-[#0a66c2] text-white' : 'border border-slate-200 bg-white text-[#1a202c]'} ${m.pending ? 'opacity-60' : ''}`}>{m.body}</div>
          </div>
        ))}
        {thread && thread.messages.length === 0 && !peerTyping && (
          <p className="py-10 text-center text-xs text-[#94a3b8]">{tr('Say hello — this seller will be notified.', 'Gửi lời chào — người bán sẽ được thông báo.')}</p>
        )}
        {peerTyping && <TypingDots />}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-end gap-2 border-t border-slate-200 px-3 py-2.5">
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); sendTyping() }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          rows={1}
          placeholder={tr('Write a message…', 'Nhập tin nhắn…')}
          className="max-h-24 flex-1 resize-none rounded-2xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#0a66c2] focus:ring-2 focus:ring-[#0a66c2]/20"
        />
        <button onClick={send} disabled={!text.trim() || sending} aria-label={tr('Send', 'Gửi')} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0a66c2] text-white disabled:opacity-40">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </>
  )
}
