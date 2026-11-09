'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Sparkles, Loader2 } from '@/components/ui/icons'
import { STROKE_NAV } from '@/lib/icon-tokens'
import { ChatSendButton, MessageBubble } from '@/components/marketplace/chat-parts'
import { ImageSearchButton } from '@/components/marketplace/image-search-button'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { ListingCard } from '@/components/marketplace/listing-card'
import { ReportAiAnswer } from '@/components/marketplace/report-ai-answer'
import { haptic } from '@/lib/haptics'
import { useVirtualKeyboard } from '@/hooks/use-virtual-keyboard'
import { useSafeBack } from '@/lib/safe-back'
import type { SerializedListingCard } from '@/lib/types'
import { fmtTime } from '@/lib/dates'
import { scrollBehavior } from '@/lib/reduced-motion'
import { aiConsentNeeded, askAiConsentAnswer, type AiConsent } from '@/lib/ai-consent'
import { useAiConsent } from '@/hooks/use-ai-consent'
import { askForHelp, useConciergeAvailable } from '@/lib/concierge/client'
import { variantOfLanguage } from '@/lib/lang-variant'
import { THREAD_HEADER_CLASS } from '@/lib/thread-chrome'

// The "eno AI" conversation — rendered as a native thread in the messages tab (the AI
// is just another contact). Self-contained: messages live in component state +
// localStorage (no DB conversation), and replies come from POST /api/ai/concierge,
// which returns a reply + matching listings the buyer can browse right in the chat.

// `greeting`: eno's own opening line, stored as a MARK and worded at render in the page's language — stored as text, it
// stayed in the language of the first visit (an English bubble on a Vietnamese page, and the reverse).
type Msg = { role: 'user' | 'assistant'; content: string; listings?: SerializedListingCard[]; createdAt: string; greeting?: true }
// An authored { en, vi } pair, so gen-ui-strings still harvests it for the machine-translated languages.
// The example ENDS the greeting (2026-11-06 audit): mid-sentence, its button wrapped onto a line of its own and left
// "— e.g." and "— and I'll find it." as fragments around it; last, it takes the last line whole.
const GREETING = { en: "Hi! I'm eno AI. Tell me what you're looking for and I'll find it. For example: “a road bike under 8M near Thảo Điền”", vi: 'Chào bạn! Mình là eno AI. Bạn cần tìm gì, mình sẽ tìm giúp. Ví dụ: "xe đạp dưới 8 triệu gần Thảo Điền"' }
// The greeting's words before the mark (2026-10-22): a chat stored then holds them as TEXT, and is recognised by them.
const GREETING_STORED = [
  "Hi! I'm eno AI. Tell me what you're looking for — e.g. “a road bike under 8M near Thảo Điền” — and I'll find it.",
  'Chào bạn! Mình là eno AI. Bạn đang tìm gì? Ví dụ "xe đạp dưới 8 triệu gần Thảo Điền" — mình sẽ tìm giúp.',
]

// The greeting's example, a button that fills the composer (2026-11-06 audit): these exact words, which the greeting quotes in
// both languages. An authored pair like GREETING; a translation that does not carry them word for word keeps the greeting plain.
const GREETING_EXAMPLE = { en: 'a road bike under 8M near Thảo Điền', vi: 'xe đạp dưới 8 triệu gần Thảo Điền' }

const STORE_KEY = 'eno:ai_chat_v1'

export default function AiThreadPage() {
  const router = useRouter()
  const { tr, lang } = useLanguage()
  // The voice guide is the first way to ask for help, this chat its fallback (owner, 2026-10-28): when this account may use
  // it, the header offers it here too (client.ts askForHelp — on the explorer, the window over it).
  const voiceGuide = useConciergeAvailable()
  const { user, openSignIn } = useAuth()
  // Back chevron: pop this thread off the stack rather than pushing /messages on top of it.
  const onBack = useSafeBack('/messages')
  const [messages, setMessages] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const listRef = useRef<HTMLDivElement>(null) // scroll only THIS, never the document (scrollIntoView can scroll <body> → header off)
  const footerRef = useRef<HTMLDivElement>(null) // composer; lifts to position:fixed above the keyboard (globals.css .chat-footer)
  const { open: kbOpen } = useVirtualKeyboard() // coalesced store → re-renders only on open/close, safe
  // App Store gate `app-ai-notice` (src/lib/ai-consent.ts): in the apps, "Not now" to Google AI leaves a keyword-only
  // assistant, and the header says so. Gate off ⇒ askFirst is false and nothing here changes.
  const aiConsent = useAiConsent('assistant')
  const googleAiOff = aiConsent.askFirst && aiConsent.consent === 'off'
  const askingAi = useRef(false) // a Google AI question is open (see send)

  const greetingText = tr(GREETING.en, GREETING.vi)
  const greeting: Msg = { role: 'assistant', createdAt: new Date().toISOString(), content: '', greeting: true }
  // What a message says on screen and to the concierge: the greeting in today's language, anything else as stored.
  const said = (m: Msg) => (m.greeting ? greetingText : m.content)
  // A tap on the greeting's example puts it in the composer, to send or to change — never sent for the reader; a guest is asked
  // to sign in first, as Send asks (2026-11-06 audit). ⚠️ NEVER OVER A DRAFT (codex + opus, gate 2026-11-06): words already in
  // the composer stay — the example fills an empty one only; with a draft, the tap just puts the reader back in it.
  const composerId = useId()
  const example = tr(GREETING_EXAMPLE.en, GREETING_EXAMPLE.vi)
  const tryExample = () => {
    if (!user) { openSignIn(); return }
    setText((t) => (t.trim() ? t : example))
    document.getElementById(composerId)?.focus()
  }
  const greetingBody = () => {
    const at = greetingText.indexOf(example)
    if (at < 0) return greetingText
    // The quote marks around it are dropped with it: the chip is the quotation (a narrow bubble never strands one either).
    const q = /["“]/.test(greetingText.charAt(at - 1)) && /["”]/.test(greetingText.charAt(at + example.length)) ? 1 : 0
    const after = greetingText.slice(at + example.length + q)
    return (
      <span>
        {greetingText.slice(0, at - q)}
        {/* ⚠️ A SUGGESTION CHIP, NOT AN UNDERLINED LINK (2026-11-09, codex all20: "its clickable behavior is visually
            indistinguishable from ordinary navigation"). It never navigated — it fills the composer — so it wears the
            shape AI chats use for a prompt to try: outlined, rounded, the assistant's Sparkles mark. Ending the greeting it
            takes a line of its own (2026-11-06 audit); a translation that puts it mid-sentence keeps it in the line.
            ⚠️ NO hover:bg-muted HERE: --muted IS the received bubble's --tint (#f5f5f5 / #262626), so a hover blanked the chip into
            its bubble (pre-deploy review, 2026-11-09). The outline variant's own hover:bg-accent shows. */}
        <Button variant="outline" size="none" type="button" onClick={tryExample} className={`relative gap-1.5 rounded-full bg-card px-3 py-1.5 text-left text-sm font-semibold whitespace-normal text-foreground tap-44 ${after.trim() ? 'inline-flex align-middle' : 'mt-2 flex w-fit'}`}>
          <Sparkles className="size-4 shrink-0 text-accent-foreground" aria-hidden />
          {example}
        </Button>
        {after}
      </span>
    )
  }

  // Restore prior chat (this device); seed the greeting if empty.
  // `restoredCount`: everything restored was already read, so only messages added AFTER it play the
  // `.bubble-in` arrival — the last restored turn used to rise in on every open.
  const restoredCount = useRef(0)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
      // A chat stored before the mark keeps its greeting as text: recognised by its exact wording, in either language.
      if (Array.isArray(saved) && saved[0]?.role === 'assistant' && GREETING_STORED.includes(saved[0].content)) {
        saved[0] = { ...saved[0], content: '', greeting: true }
      }
      const restored = Array.isArray(saved) && saved.length ? saved : [greeting]
      restoredCount.current = restored.length
      setMessages(restored)
    } catch { restoredCount.current = 1; setMessages([greeting]) }
  }, [])

  // Persist (cap to the last 30 turns so storage stays small).
  useEffect(() => {
    if (messages.length) { try { localStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-30))) } catch { /* quota */ } }
  }, [messages])

  // Keep the latest message pinned above the composer by scrolling the LIST ONLY (its own
  // scrollTop) — never scrollIntoView, which on iOS can scroll <body> and shove the header
  // off-screen. Re-run when the keyboard opens: the list shrinks, so tall result cards must
  // re-anchor to the bottom instead of stranding at the top (a chat shorter than the list
  // simply reads from the top, as a person's thread does). rAF lets the keyboard-open resize
  // settle before we measure.
  // ⚠️ THE FIRST PIN IS INSTANT. `messages` starts [] and the history is restored from localStorage
  // in an effect, so this ran a second time with up to 30 turns in the pane — and SMOOTH-scrolled
  // from the top through all of them, listing-card grids included, on every open. Opening a thread
  // should land on its newest message the way the person-to-person thread does (scrollBottom(false)
  // there); only what arrives after that follows smoothly.
  // ⚠️ A LAYOUT effect, like the person-to-person thread's pin: a plain effect runs AFTER paint, so a
  // hard load painted one frame at scrollTop 0 — the oldest restored turn at the top — before the
  // instant pin jumped to the newest (measured on a phone). This runs before the browser paints.
  const pinnedRef = useRef(false)
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    const behavior = pinnedRef.current ? scrollBehavior() : 'instant'
    const toBottom = () => el.scrollTo({ top: el.scrollHeight, behavior })
    toBottom()
    const r = requestAnimationFrame(() => {
      toBottom()
      if (messages.length) pinnedRef.current = true
    })
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
    // ⚠️ App Store gate `app-ai-notice`: in the apps, the FIRST send asks before anything typed here reaches Google
    // (Gemini + Vertex AI Search). "Not now" still gets an answer — the request carries `ai: false` and the route uses
    // its own keyword reading and Postgres search; no answer at all sends nothing. Gate off ⇒ aiConsentNeeded() is
    // false: no await, no `ai` field, the request exactly as before. The text stays in the composer while it is open.
    // ⚠️ ONE QUESTION AT A TIME (codex, review): `loading` is set only after the answer, so a second Return before the
    // notice appeared started a second wait — and "Allow" would have sent the message twice.
    let noAi = false
    if (aiConsentNeeded('assistant', user.id)) {
      if (askingAi.current) return
      askingAi.current = true
      let answer: AiConsent = null
      try { answer = await askAiConsentAnswer('assistant', { userId: user.id }) } finally { askingAi.current = false }
      // NO ANSWER IS NOT "NOT NOW" (codex, review): Escape, or a question voided because the page or the account changed
      // while it was open, sends nothing at all — the text stays in the composer.
      if (answer === null) return
      noAi = answer !== 'on'
    }
    haptic()
    const next: Msg[] = [...messages, { role: 'user', content: body, createdAt: new Date().toISOString() }]
    setMessages(next)
    setText('')
    setLoading(true)
    try {
      const res = await fetch('/api/ai/concierge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lang, messages: next.map((m) => ({ role: m.role, content: said(m) })), ...(noAi ? { ai: false } : {}) }),
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
    // shell height (like the regular thread), so it scrolls instead of growing past the shell.
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      {/* Header — matches the thread page; back arrow only on mobile. Below lg it is the top of the screen (no site header:
          messages-shell.tsx, 2026-11-07 audit), so it wears the thread header's box and owns the status-bar inset. */}
      <div className={THREAD_HEADER_CLASS}>
        {/* Pops rather than pushing /messages (src/lib/safe-back.ts) — same control, same
            rule as the regular thread; the href stays the cold-start fallback. */}
        {/* Back = nav chrome: h-6 at the platform weight, matching section-header's chevron. */}
        <Link href="/messages" onClick={onBack} aria-label={tr('Back', 'Quay lại')} className="text-muted-foreground hover:text-accent-foreground lg:hidden relative tap-44"><ChevronLeft className="h-6 w-6" strokeWidth={STROKE_NAV} aria-hidden /></Link>
        {/* Chrome coin, not a solid disc (icon-language §5/§6): saturated brand is reserved
            for user-state, so the AI identity rides the flat brand-50 coin like the Post chip. */}
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand"><Sparkles className="h-5 w-5" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-foreground lg:text-base">{tr('eno AI', 'eno AI')}</div>
          <div className="truncate text-xs text-accent-foreground lg:text-sm">
            {googleAiOff
              ? tr('Keyword search · Google AI off', 'Tìm theo từ khóa · Đã tắt Google AI')
              : tr('AI shopping assistant', 'Trợ lý mua sắm AI')}
          </div>
        </div>
        {voiceGuide && (
          <Button size="sm" variant="secondary" onClick={() => void askForHelp(router, variantOfLanguage(lang), { voiceOnly: true })}>
            {tr('Talk instead', 'Nói thay vì gõ')}
          </Button>
        )}
      </div>

      {/* Messages */}
      <div ref={listRef} role="log" aria-live="polite" className="chat-scroll flex flex-1 min-h-0 flex-col overflow-y-auto overscroll-contain px-4 py-4 scroll-thin [&_.reveal-on-scroll]:![animation:none]">
        {/* From the top, as a person's thread reads (2026-11-07 audit: anchored to the composer, the greeting alone sat at
            the foot of an empty pane and the page read as blank — under the header is where eno AI first says what it does).
            A chat taller than the list scrolls, pinned to its newest turn by the layout effect above. */}
        <div className="space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} ${i === messages.length - 1 && i >= restoredCount.current ? 'bubble-in' : ''}`}>
            <MessageBubble mine={m.role === 'user'} className="max-w-[85%]">{m.greeting ? greetingBody() : said(m)}</MessageBubble>
            {m.listings && m.listings.length > 0 && (
              <div className="mt-2 grid w-full grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5">
                {m.listings.map((l) => (
                  <ListingCard key={l.id} listing={l} onOpen={(x) => router.push(`/listings/${x.id}`)} />
                ))}
              </div>
            )}
            {m.role === 'assistant' && !m.greeting && m.content ? (
              // The answer's own Report, on its time line (Google Play, AI-Generated Content — src/lib/ai-report.ts). Every line
              // in the AI's place but the greeting: it reports what was on screen and never claims who wrote it, since a saved
              // chat cannot tell an answer from eno's own line (a limit, an error), nor a keyword answer from Google's.
              <div className="mt-0.5 flex items-center gap-1 px-1">
                <span className="text-2xs text-ink-4 lg:text-xs">{fmtTime(m.createdAt, lang)}</span>
                <ReportAiAnswer answer={m.content} />
              </div>
            ) : (
              <span className="mt-0.5 px-1 text-2xs text-ink-4 lg:text-xs">{fmtTime(m.createdAt, lang)}</span>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex items-start">
            <div className="flex items-center gap-2 rounded-2xl bg-tint px-3.5 py-2.5 text-sm text-muted-foreground lg:text-base">
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
            id={composerId}
            variant="outline"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            rows={1}
            enterKeyHint="send"
            placeholder={tr('Ask for anything…', 'Hỏi bất cứ điều gì…')}
            // 16px at every width since 2026-11-07, as the thread's field and the bubbles from lg.
            className="min-h-0 max-h-28 flex-1 resize-none rounded-2xl px-3.5 py-2.5 text-base"
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
