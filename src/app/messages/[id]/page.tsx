'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Header } from '@/components/marketplace/header'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { SignInPrompt } from '@/components/marketplace/account-actions'
import { ChevronLeft, Send } from 'lucide-react'

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
  const bottomRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/conversations/${id}`)
    if (res.status === 404 || res.status === 403) { setNotFound(true); return }
    if (!res.ok) return
    const data = await res.json()
    // Preserve any still-pending optimistic messages so a background poll never
    // makes a just-sent message flicker away before the POST confirms it.
    setThread((prev) => {
      if (!prev) return data
      const temps = prev.messages.filter((m) => String(m.id).startsWith('temp-'))
      return temps.length ? { ...data, messages: [...data.messages, ...temps] } : data
    })
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
    if (!body) return
    // Optimistic: show the bubble the instant Send is tapped — the POST + 4s poll
    // reconcile in the background, so the UI never waits on the DB round-trip.
    const tempId = `temp-${Date.now()}`
    const optimistic: Msg = { id: tempId, mine: true, body, createdAt: new Date().toISOString() }
    setText('')
    setThread((t) => (t ? { ...t, messages: [...t.messages, optimistic] } : t))
    try {
      const res = await fetch(`/api/conversations/${id}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
      })
      if (res.ok) {
        const m = (await res.json()) as Msg
        // Swap the temp for the real message — unless a poll already delivered it.
        setThread((t) => {
          if (!t) return t
          const without = t.messages.filter((x) => x.id !== tempId)
          if (without.some((x) => x.id === m.id)) return { ...t, messages: without }
          return { ...t, messages: [...without, m] }
        })
      } else {
        setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== tempId) } : t))
        setText(body) // restore on failure
      }
    } catch {
      setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== tempId) } : t))
      setText(body)
    }
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
              <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${m.mine ? 'bg-[#0a66c2] text-white' : 'bg-white text-[#1a202c] border border-slate-200'}`}>
                  {m.body}
                </div>
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
            <button onClick={send} disabled={!text.trim()} aria-label={tr('Send', 'Gửi')} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0a66c2] text-white transition-transform active:scale-90 disabled:opacity-40">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </main>
      )}
    </div>
  )
}
