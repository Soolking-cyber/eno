'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Header } from '@/components/marketplace/header'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { SignInPrompt } from '@/components/marketplace/account-actions'
import { ChevronLeft, Send, Loader2, Trash2 } from 'lucide-react'

type Msg = { id: string; mine: boolean; body: string; createdAt: string }
type Thread = {
  id: string
  listing: { id: string; title: string; image: string | null }
  counterpart: { name: string; avatarColor: string; avatarUrl: string | null }
  messages: Msg[]
}

export default function ThreadPage() {
  const { id } = useParams<{ id: string }>()
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const [thread, setThread] = useState<Thread | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null) // message id whose Delete is revealed
  const bottomRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/conversations/${id}`)
    if (res.status === 404 || res.status === 403) { setNotFound(true); return }
    if (!res.ok) return
    setThread(await res.json())
  }, [id])

  // Initial load + poll every 4s + refetch on tab focus (the reliable backstop).
  useEffect(() => {
    if (!user) return
    load()
    const iv = setInterval(load, 4000)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(iv); window.removeEventListener('focus', onFocus) }
  }, [user, load])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [thread?.messages.length])

  const send = async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setText('')
    try {
      const res = await fetch(`/api/conversations/${id}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
      })
      if (res.ok) {
        const m = (await res.json()) as Msg
        setThread((t) => (t ? { ...t, messages: [...t.messages, m] } : t))
      } else {
        setText(body) // restore on failure
      }
    } finally {
      setSending(false)
    }
  }

  // Delete your own message (optimistic; the API recomputes the thread preview).
  const deleteMessage = async (mid: string) => {
    setMenuFor(null)
    setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== mid) } : t))
    try {
      await fetch(`/api/conversations/${id}/messages/${mid}`, { method: 'DELETE' })
    } catch { /* the 4s poll self-heals if the request failed */ }
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-[#fafafa]">
      <Header />
      {!loading && !user ? (
        <main className="flex flex-1 items-center justify-center px-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-pop">
            <p className="text-sm text-[#64748b]">{tr('Sign in to view this conversation.', 'Đăng nhập để xem cuộc trò chuyện này.')}</p>
            <div className="mt-4"><SignInPrompt /></div>
          </div>
        </main>
      ) : notFound ? (
        <main className="flex flex-1 items-center justify-center px-4">
          <p className="text-sm text-[#64748b]">{tr('Conversation not found.', 'Không tìm thấy cuộc trò chuyện.')}</p>
        </main>
      ) : (
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-hidden px-0 sm:px-6">
          {/* Thread header */}
          <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
            <Link href="/messages" className="text-[#64748b] hover:text-[#0a66c2]"><ChevronLeft className="h-5 w-5" /></Link>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: thread?.counterpart.avatarColor || '#0a66c2' }}>
              {thread?.counterpart.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-[#1a202c]">{thread?.counterpart.name || '…'}</div>
              {thread && <Link href={`/listings/${thread.listing.id}`} className="truncate text-xs text-[#0a66c2] hover:underline">{thread.listing.title}</Link>}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4 scroll-thin">
            {thread?.messages.map((m) => (
              <div key={m.id} className={`group flex flex-col ${m.mine ? 'items-end' : 'items-start'}`}>
                <div className="flex items-end gap-1">
                  {/* Desktop convenience: trash on hover over your own message. */}
                  {m.mine && (
                    <button
                      onClick={() => deleteMessage(m.id)}
                      aria-label={tr('Delete message', 'Xóa tin nhắn')}
                      className="hidden shrink-0 p-1 text-slate-400 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100 sm:block"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <div
                    onClick={() => { if (m.mine) setMenuFor(menuFor === m.id ? null : m.id) }}
                    className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${m.mine ? 'cursor-pointer bg-[#0a66c2] text-white' : 'bg-white text-[#1a202c] border border-slate-200'}`}
                  >
                    {m.body}
                  </div>
                </div>
                {/* Tap your own message → explicit Delete button (works on mobile too). */}
                {m.mine && menuFor === m.id && (
                  <button
                    onClick={() => deleteMessage(m.id)}
                    className="mt-1 flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-600 transition-transform active:scale-95"
                  >
                    <Trash2 className="h-3 w-3" /> {tr('Delete', 'Xóa')}
                  </button>
                )}
              </div>
            ))}
            {thread && thread.messages.length === 0 && (
              <p className="py-10 text-center text-xs text-[#94a3b8]">{tr('Say hello — this seller will be notified.', 'Gửi lời chào — người bán sẽ được thông báo.')}</p>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Composer */}
          <div className="flex items-end gap-2 border-t border-slate-200 bg-white px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              rows={1}
              placeholder={tr('Write a message…', 'Nhập tin nhắn…')}
              className="max-h-28 flex-1 resize-none rounded-2xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-[#0a66c2] focus:ring-2 focus:ring-[#0a66c2]/20"
            />
            <button onClick={send} disabled={!text.trim() || sending} aria-label={tr('Send', 'Gửi')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0a66c2] text-white disabled:opacity-40">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </main>
      )}
    </div>
  )
}
