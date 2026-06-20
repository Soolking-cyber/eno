'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { MessageSquare, ChevronLeft, X, Send, Loader2 } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useChat } from '@/context/chat-context'

type Convo = {
  id: string; listingTitle: string; lastMessageAt: string; lastMessageText: string | null
  unread: number; counterpart: { name: string; avatarColor: string; avatarUrl: string | null }
}
type Msg = { id: string; mine: boolean; body: string; createdAt: string }
type Thread = {
  id: string; listing: { id: string; title: string; image: string | null }
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
          className="fixed bottom-20 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#0a66c2] text-white shadow-overlay transition-transform hover:scale-105 active:scale-95 lg:bottom-5 lg:right-5"
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
        <div className="fixed inset-x-2 bottom-2 top-16 z-50 flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-overlay sm:inset-x-auto sm:right-5 sm:bottom-5 sm:top-auto sm:h-[560px] sm:max-h-[80vh] sm:w-[380px]">
          {view === 'thread' && conversationId ? (
            <ChatThread id={conversationId} onBack={back} onClose={close} onSent={refreshUnread} />
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
  const bottomRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/conversations/${id}`)
    if (!res.ok) return
    setThread(await res.json())
  }, [id])

  // Poll every 4s + refetch on focus.
  useEffect(() => {
    load()
    const iv = setInterval(load, 4000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(iv); window.removeEventListener('focus', onFocus) }
  }, [load])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [thread?.messages.length])

  const send = async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true); setText('')
    try {
      const res = await fetch(`/api/conversations/${id}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
      })
      if (res.ok) {
        const m = (await res.json()) as Msg
        setThread((t) => (t ? { ...t, messages: [...t.messages, m] } : t))
        onSent()
      } else setText(body)
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
        {thread?.messages.map((m) => (
          <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${m.mine ? 'bg-[#0a66c2] text-white' : 'border border-slate-200 bg-white text-[#1a202c]'}`}>{m.body}</div>
          </div>
        ))}
        {thread && thread.messages.length === 0 && (
          <p className="py-10 text-center text-xs text-[#94a3b8]">{tr('Say hello — this seller will be notified.', 'Gửi lời chào — người bán sẽ được thông báo.')}</p>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-end gap-2 border-t border-slate-200 px-3 py-2.5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
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
