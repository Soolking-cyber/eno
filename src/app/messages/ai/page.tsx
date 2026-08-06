'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Sparkles, Loader2 } from 'lucide-react'
import { STROKE_NAV } from '@/lib/icon-tokens'
import { ChatSendButton, MessageBubble } from '@/components/marketplace/chat-parts'
import { ImageSearchButton } from '@/components/marketplace/image-search-button'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { ListingCard } from '@/components/marketplace/listing-card'
import { haptic } from '@/lib/haptics'
import { useVirtualKeyboard } from '@/hooks/use-virtual-keyboard'
import { useSafeBack } from '@/lib/safe-back'
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
  // Back chevron: pop this thread off the stack rather than pushing /messages on top of it.
  const onBack = useSafeBack('/messages')
  const [messages, setMessages] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const listRef = useRef<HTMLDivElement>(null) // scroll only THIS, never the document (scrollIntoView can scroll <body> → header off)
  const footerRef = useRef<HTMLDivElement>(null) // composer; lifts to position:fixed above the keyboard (globals.css .chat-footer)
  const { open: kbOpen } = useVirtualKeyboard() // coalesced store → re-renders only on open/close, safe

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

  // Keep the latest message pinned above the composer by scrolling the LIST ONLY (its own
  // scrollTop) — never scrollIntoView, which on iOS can scroll <body> and shove the header
  // off-screen. Re-run when the keyboard opens: the list shrinks, so tall result cards must
  // re-anchor to the bottom instead of stranding at the top (short chats bottom-anchor via
  // the mt-auto wrapper). rAF lets the keyboard-open resize settle before we measure.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const toBottom = () => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    toBottom()
    const r = requestAnimationFrame(toBottom)
    return () => cancelAnimationFrame(r)
  }, [messages.length, loading, kbOpen])

  // Publish the composer's live height into --footer-h so the message list reserves exactly
  // that much bottom padding once the footer lifts to position:fixed (keyboard up) — the last
  // message then always clears it. Same mechanism as the regular thread (messages/[id]).
  useEffect(() => {
    const el = footerRef.current
    if (!el) return
    const root = document.documentElement
    const set = () => root.style.setProperty('--footer-h', `${el.offsetHeight}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => { ro.disconnect(); root.style.removeProperty('--footer-h') }
  }, [user])

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
    // overflow-hidden is load-bearing: it forces the flex-1 message list to respect the
    // shell height (like the regular thread) so it actually scrolls + the mt-auto bottom-
    // anchor has a bounded height to push against — without it the list grows past the
    // shell, content strands at the top, and a white void opens above the composer.
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      {/* Header — matches the thread page; back arrow only on mobile. */}
      <div className="flex items-center gap-3 bg-background px-4 py-3">
        {/* Pops rather than pushing /messages (src/lib/safe-back.ts) — same control, same
            rule as the regular thread; the href stays the cold-start fallback. */}
        {/* Back = nav chrome: h-6 at the platform weight, matching section-header's chevron. */}
        <Link href="/messages" onClick={onBack} aria-label={tr('Back', 'Quay lại')} className="text-muted-foreground hover:text-accent-foreground lg:hidden relative tap-44"><ChevronLeft className="h-6 w-6" strokeWidth={STROKE_NAV} aria-hidden /></Link>
        {/* Chrome coin, not a solid disc (icon-language §5/§6): saturated brand is reserved
            for user-state, so the AI identity rides the flat brand-50 coin like the Post chip. */}
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand"><Sparkles className="h-5 w-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-foreground">{tr('eno AI', 'eno AI')}</div>
          <div className="truncate text-xs text-accent-foreground">{tr('AI shopping assistant', 'Trợ lý mua sắm AI')}</div>
        </div>
      </div>

      {/* Messages */}
      <div ref={listRef} role="log" aria-live="polite" className="chat-scroll flex flex-1 min-h-0 flex-col overflow-y-auto overscroll-contain px-4 py-4 scroll-thin [&_.reveal-on-scroll]:![animation:none]">
        {/* Bottom-anchor: a short chat (greeting + a reply) sits just above the composer
            instead of stranded at the top with a huge gap. mt-auto pushes content down when
            it's shorter than the list, and simply collapses (scrolls normally) once it fills. */}
        <div className="mt-auto space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} ${i === messages.length - 1 ? 'bubble-in' : ''}`}>
            <MessageBubble mine={m.role === 'user'} className="max-w-[85%]">{m.content}</MessageBubble>
            {m.listings && m.listings.length > 0 && (
              <div className="mt-2 grid w-full grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5">
                {m.listings.map((l) => (
                  <ListingCard key={l.id} listing={l} onOpen={(x) => router.push(`/listings/${x.id}`)} />
                ))}
              </div>
            )}
            <span className="mt-0.5 px-1 text-3xs text-ink-4">{fmtTime(m.createdAt)}</span>
          </div>
        ))}
        {loading && (
          <div className="flex items-start">
            <div className="flex items-center gap-2 rounded-2xl bg-tint px-3.5 py-2.5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {tr('Searching…', 'Đang tìm…')}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Composer — message field + send (no offer mode; the AI doesn't haggle).
          Members-only: logged-out users get a sign-in CTA instead (the API is
          login-gated + 10/h per account to protect the paid AI credit).
          Wrapped in .chat-footer so it lifts to position:fixed FLUSH above the keyboard
          (globals.css) instead of reflowing the list on focus — which was aborting the
          iOS keyboard. Same wiring as the regular thread (messages/[id]). */}
      <div ref={footerRef} className="chat-footer shrink-0">
      {user ? (
        <div className="chat-composer flex items-end gap-2 bg-background px-4 pt-3 pb-3">
          {/* Photo search lives IN the assistant now (the search bars' camera icon
              folded in here) — recognize the item, then ask as a normal message.
              Same auth + hourly limits as typed messages, so no extra credit burn. */}
          <ImageSearchButton
            onResult={(r) => send([r.brand, r.query].filter(Boolean).join(' '))}
            onError={(msg) => setMessages((m) => [...m, { role: 'assistant', content: msg, createdAt: new Date().toISOString() }])}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-body transition-colors hover:bg-muted relative tap-44"
            iconClassName="h-5 w-5"
          />
          {/* min-h-0 is load-bearing twice: it keeps the one-line composer from
              inflating to the primitive's min-h-24, AND keeps the --footer-h
              ResizeObserver from over-padding the message list with that height. */}
          <Textarea
            variant="outline"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            rows={1}
            enterKeyHint="send"
            placeholder={tr('Ask for anything…', 'Hỏi bất cứ điều gì…')}
            className="min-h-0 max-h-28 flex-1 resize-none rounded-2xl px-3.5 py-2.5 text-base lg:text-sm"
          />
          <ChatSendButton
            onClick={() => send()}
            disabled={!text.trim() || loading}
            aria-label={tr('Send', 'Gửi')}
            title={tr('Send', 'Gửi')}
          />
        </div>
      ) : (
        <div className="chat-composer bg-background px-4 pt-3 pb-3">
          <Button
            variant="cta"
            size="none"
            onClick={() => openSignIn()}
            // ⚠️ NO `tap-44`. This button is `w-full` + py-3, already well past the 44px
            // floor — and the utility is actively harmful on an UNPOSITIONED element: its
            // ::before is `position:absolute` sized 100% of the containing block, which here
            // resolved to the PAGE ROOT, so an invisible layer covered the whole viewport and
            // swallowed taps on the header and the Log in link (found by a runtime audit,
            // 2026-07-24 — the same class of bug as a053e5d5). globals.css says "add
            // `relative` too"; not needing the pseudo-element at all is better.
            className="w-full rounded-2xl px-4 py-3 active:scale-[0.96]"
          >
            {tr('Sign in to use eno AI', 'Đăng nhập để dùng eno AI')}
          </Button>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {tr('AI shopping is free for members.', 'Mua sắm bằng AI miễn phí cho thành viên.')}
          </p>
        </div>
      )}
      </div>
    </div>
  )
}
