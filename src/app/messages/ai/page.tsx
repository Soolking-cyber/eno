'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Send, Sparkles, Loader2 } from 'lucide-react'
import { ImageSearchButton } from '@/components/marketplace/image-search-button'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { ListingCard } from '@/components/marketplace/listing-card'
import { haptic } from '@/lib/haptics'
import type { SerializedListingCard } from '@/lib/types'
import { fmtTime } from '@/lib/dates'

// The "eno AI" conversation — rendered as a native thread in the messages tab (the AI
// is just another contact). Self-contained: messages live in component state +
// localStorage (no DB conversation), and replies come from POST /api/ai/concierge,
// which returns a reply + matching listings the buyer can browse right in the chat.

type Msg = { role: 'user' | 'assistant'; content: string; listings?: SerializedListingCard[]; createdAt: string }

const STORE_KEY = 'eno:ai_chat_v1'

export default function AiThreadPage() {
  const router = useRouter()
  const { tr, lang } = useLanguage()
  const { user, openSignIn } = useAuth()
  const [messages, setMessages] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const greeting: Msg = {
    role: 'assistant',
    createdAt: new Date().toISOString(),
    content: tr(
      "Hi! I'm eno AI. Tell me what you're looking for — e.g. “a road bike under 8M near Thảo Điền” — and I'll find it.",
      'Chào bạn! Mình là eno AI. Bạn đang tìm gì? Ví dụ "xe đạp dưới 8 triệu gần Thảo Điền" — mình sẽ tìm giúp.',
    ),
  }

  // Restore prior chat (this device); seed the greeting if empty.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
      setMessages(Array.isArray(saved) && saved.length ? saved : [greeting])
    } catch { setMessages([greeting]) }
  }, [])

  // Persist (cap to the last 30 turns so storage stays small).
  useEffect(() => {
    if (messages.length) { try { localStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-30))) } catch { /* quota */ } }
  }, [messages])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length, loading])

  async function send(override?: string) {
    const body = (override ?? text).trim()
    if (!body || loading) return
    // AI is members-only (it draws the paid Vertex/Gemini credit). Prompt sign-in
    // instead of firing a request that the server would 401 anyway.
    if (!user) { openSignIn(); return }
    haptic()
    const next: Msg[] = [...messages, { role: 'user', content: body, createdAt: new Date().toISOString() }]
    setMessages(next)
    setText('')
    setLoading(true)
    try {
      const res = await fetch('/api/ai/concierge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang, messages: next.map((m) => ({ role: m.role, content: m.content })) }),
      })
      if (res.status === 401) { openSignIn(); setLoading(false); return }
      const d = await res.json().catch(() => null)
      setMessages((m) => [...m, {
        role: 'assistant',
        createdAt: new Date().toISOString(),
        content: res.status === 429
          ? tr("You've reached the hourly AI limit (10/hour). Please try again later.", 'Bạn đã đạt giới hạn AI mỗi giờ (10 lần/giờ). Vui lòng thử lại sau.')
          : (d && d.reply) || tr('Something went wrong — please try again.', 'Đã có lỗi — vui lòng thử lại.'),
        listings: (d && d.listings) || [],
      }])
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: tr('Network error — please try again.', 'Lỗi mạng — vui lòng thử lại.'), createdAt: new Date().toISOString() }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* Header — matches the thread page; back arrow only on mobile. */}
      <div className="flex items-center gap-3 bg-card px-4 py-3">
        <Link href="/messages" className="text-muted-foreground hover:text-accent-foreground lg:hidden relative tap-44"><ChevronLeft className="h-5 w-5" /></Link>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white"><Sparkles className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-foreground">{tr('eno AI', 'eno AI')}</div>
          <div className="truncate text-xs text-accent-foreground">{tr('AI shopping assistant', 'Trợ lý mua sắm AI')}</div>
        </div>
      </div>

      {/* Messages */}
      <div role="log" aria-live="polite" className="flex-1 space-y-3 overflow-y-auto px-4 py-4 scroll-thin">
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${m.role === 'user' ? 'bg-primary text-white' : 'bg-card text-foreground'}`}>
              {m.content}
            </div>
            {m.listings && m.listings.length > 0 && (
              <div className="mt-2 grid w-full grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5">
                {m.listings.map((l) => (
                  <ListingCard key={l.id} listing={l} onOpen={(x) => router.push(`/listings/${x.id}`)} />
                ))}
              </div>
            )}
            <span className="mt-0.5 px-1 text-[10px] text-ink-4">{fmtTime(m.createdAt)}</span>
          </div>
        ))}
        {loading && (
          <div className="flex items-start">
            <div className="flex items-center gap-2 rounded-2xl bg-card px-3.5 py-2.5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {tr('Searching…', 'Đang tìm…')}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer — message field + send (no offer mode; the AI doesn't haggle).
          Members-only: logged-out users get a sign-in CTA instead (the API is
          login-gated + 10/h per account to protect the paid AI credit). */}
      {user ? (
        <div className="flex items-end gap-2 bg-card px-4 py-3 lg:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {/* Photo search lives IN the assistant now (the search bars' camera icon
              folded in here) — recognize the item, then ask as a normal message.
              Same auth + hourly limits as typed messages, so no extra credit burn. */}
          <ImageSearchButton
            onResult={(r) => send([r.brand, r.query].filter(Boolean).join(' '))}
            onError={(msg) => setMessages((m) => [...m, { role: 'assistant', content: msg, createdAt: new Date().toISOString() }])}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-body transition-colors hover:bg-muted relative tap-44"
            iconClassName="h-5 w-5"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            rows={1}
            placeholder={tr('Ask for anything…', 'Hỏi bất cứ điều gì…')}
            className="max-h-28 flex-1 resize-none rounded-2xl border border-line-strong px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <button
            onClick={() => send()}
            disabled={!text.trim() || loading}
            aria-label={tr('Send', 'Gửi')}
            title={tr('Send', 'Gửi')}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-transform active:scale-90 disabled:opacity-40 relative tap-44"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="bg-card px-4 py-3 lg:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button
            onClick={() => openSignIn()}
            className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white transition-transform active:scale-[0.98] tap-44"
          >
            {tr('Sign in to use eno AI', 'Đăng nhập để dùng eno AI')}
          </button>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {tr('AI shopping is free for members.', 'Mua sắm bằng AI miễn phí cho thành viên.')}
          </p>
        </div>
      )}
    </div>
  )
}
