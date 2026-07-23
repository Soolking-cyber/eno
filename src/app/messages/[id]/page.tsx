'use client'

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import Link from 'next/link'

import { useParams } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { cn } from '@/lib/utils'
import { contactLinksFor, extractPhoneNumber } from '@/lib/phone'
import { useLanguage } from '@/context/language-context'
import { useChat } from '@/context/chat-context'
import { SignInPrompt } from '@/components/marketplace/account-actions'
import { createSupabaseBrowser } from '@/lib/supabase/browser'
import { ChevronLeft, Phone, Loader2, Tag, RotateCcw, Sparkles, UserRound, AlertTriangle } from 'lucide-react'
import { ChatSendButton, MessageBubble } from '@/components/marketplace/chat-parts'
import { toast } from 'sonner'
import { haptic } from '@/lib/haptics'
import { formatMoneyFull, groupVnd, moneyLocale } from '@/lib/vnd'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { EnoSlider } from '@/components/ui/slider'
import { ReportButton } from '@/components/marketplace/report-button'
import { TrustMeta } from '@/components/marketplace/trust-meta'
import { QuickReplyChips, MarkSoldPrompt } from '@/components/marketplace/quick-reply-chips'
import { ReviewPrompt } from '@/components/marketplace/review-prompt'
import { ChatComposer, type ChatComposerHandle } from '@/components/marketplace/chat-composer'
import { useSafeBack } from '@/lib/safe-back'
import { FirstContactNote, OffPlatformWarning, findOffPlatformMessageId } from '@/components/marketplace/chat-safety-note'
import {
  VisaCheckoutCard, VisaResendChip, VisaResultCard, VisaStepCard, VisaThreadStrip,
  parseVisaCheckoutMeta, parseVisaResultMeta, parseVisaStepMeta, parseVisaThreadInfo,
  prepareVisaImage, useVisaCase, visaErrorCopy,
  type VisaQuoteWire,
} from '@/components/marketplace/visa-cards'
import { Avatar } from '@/components/ui/avatar'
import { fmtTime, dayKey } from '@/lib/dates'

// `meta` is the structured payload of a CARD message (visa_step / visa_checkout) — the
// thread GET parses and re-validates it server-side (parseMessageMeta), so an unreadable
// blob arrives as null and renders as an inert bubble. Typed `unknown` here on purpose: the
// card renderers own the shape and parse it themselves.
type Tr = (en: string, vi: string) => string

// ── ENO CONCIERGE, IN THE COMPOSER ──────────────────────────────────────────────────
//
// "so there is 2 chips human request Eno AI concierge" (owner). Two chips, side by side,
// mounted by the COMPOSER — the one part of a chat that is always on screen — so neither
// is something you have to scroll up to find.
//
// ⚠️ THE CONCIERGE CHIP ONLY EXISTS IN 'ai' MODE. "ife person requested ai doesnt answer":
// once a person has been asked for (or an admin has taken the thread over) the chip is not
// rendered at all and the server refuses the route with its own code. Two locks, one door —
// the UI rule alone would not be a rule.
function conciergeErrorCopy(code: string | undefined, tr: Tr): string {
  switch (code) {
    case 'human_help_pending':
      return tr('A person has been asked for — Eno concierge stays quiet until they reply.', 'Đã yêu cầu nhân viên — Eno concierge sẽ im lặng cho đến khi họ trả lời.')
    case 'admin_takeover':
      return tr('An eno specialist is in this chat — Eno concierge stays quiet.', 'Chuyên viên eno đang trong cuộc trò chuyện — Eno concierge sẽ im lặng.')
    case 'concierge_unavailable':
      // ⚠️ HONEST, NEVER A GUESS. The server refuses rather than inventing visa guidance, so
      // this sentence has to point at the other chip instead of pretending to answer.
      return tr('Eno concierge cannot answer right now. Tap “Request a person” and someone will reply here.', 'Eno concierge hiện chưa trả lời được. Hãy chạm “Yêu cầu nhân viên” để có người trả lời tại đây.')
    case 'question_required':
      return tr('Type your question first.', 'Hãy nhập câu hỏi trước.')
    default:
      return visaErrorCopy(code, tr)
  }
}

/**
 * The two chips. Rendered only for the APPLICANT and only while the thread is still the
 * assistant's ('ai') — the desk drives its own side, and the other two modes render the
 * existing VisaThreadStrip banner instead.
 */
// ⚠️ EVERY CHIP BUTTON HERE CARRIES `relative`, AND IT IS LOAD-BEARING, NOT COSMETIC.
// `tap-44` grows an absolutely-positioned ::before hit-target sized 100% of its containing
// block (globals.css). Without `relative` on the button, that block is the nearest POSITIONED
// ancestor — and inside a thread `html.chat-locked` makes <body> position:relative, so the
// invisible target blew up to the whole viewport and swallowed every tap and swipe: the chips
// went dead and the message list would not scroll. The compact `display:contents` row made it
// worse by removing the wrapper boxes, so nothing stopped the ::before escaping to body.
// Diagnosed by an external review (GPT-5.6, 2026-07-23) after the symptom was "chips unclickable
// + broken scroll whenever the visa form card was on screen". Do not drop `relative`.
function VisaAssistChips({
  armed, thinking, busy, error, onToggleConcierge, onAskHuman, compact, className,
}: {
  armed: boolean
  thinking: boolean
  busy: boolean
  error: string | null
  onToggleConcierge: () => void
  onAskHuman: () => void | Promise<void>
  /** Buttons only — the caller owns the row and the single explanatory line under it. */
  compact?: boolean
  className?: string
}) {
  const { tr } = useLanguage()
  return (
    <div className={compact ? 'contents' : `flex flex-col gap-1 ${className ?? ''}`}>
      <div className={compact ? 'contents' : 'flex flex-wrap items-center gap-2'}>
        {/* "name is Eno concierge" (owner) — the name is the product, identical in both
            languages, so tr() carries the same string twice rather than translating it. */}
        <Button
          variant="soft"
          size="none"
          type="button"
          aria-pressed={armed}
          disabled={thinking}
          onClick={onToggleConcierge}
          className={`relative tap-44 shrink-0 gap-1.5 rounded-full border px-3 py-1.5 text-2xs font-bold ${armed ? 'border-brand bg-primary/10 text-accent-foreground' : 'border-line-strong text-foreground'}`}
        >
          {thinking
            ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
            : <Sparkles className="size-3.5 shrink-0" aria-hidden />}
          {tr('Eno concierge', 'Eno concierge')}
        </Button>
        <Button
          variant="soft"
          size="none"
          type="button"
          disabled={busy}
          onClick={() => void onAskHuman()}
          className="relative tap-44 shrink-0 gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-2xs font-bold text-foreground"
        >
          <UserRound className="size-3.5 shrink-0" aria-hidden />
          {tr('Request a person', 'Yêu cầu nhân viên')}
        </Button>
      </div>
      {/* ONE line for the whole row. The idle sentence used to explain what the two buttons
          already say ("Eno concierge is an AI assistant… A person can take over any time"), so
          in compact mode it is dropped entirely — the ACTIVE states still speak, because
          "armed" and "thinking" are states a label cannot show. basis-full keeps it on its own
          line inside the caller's flex row. */}
      {(!compact || thinking || armed) && (
        <p className={cn('text-2xs leading-relaxed text-ink-4', compact && 'basis-full')}>
          {thinking
            ? tr('Eno concierge is reading your application…', 'Eno concierge đang xem hồ sơ của bạn…')
            : armed
              ? tr('Ask below and Eno concierge answers here in the chat.', 'Hãy hỏi bên dưới, Eno concierge sẽ trả lời ngay trong cuộc trò chuyện.')
              : tr('Eno concierge is an AI assistant for this application. A person can take over any time.', 'Eno concierge là trợ lý AI cho hồ sơ này. Nhân viên có thể tiếp nhận bất cứ lúc nào.')}
        </p>
      )}
      {/* role="status" so a screen reader hears the refusal — the chips do not move. */}
      {error && (
        <p role="status" className={cn('flex items-start gap-1.5 text-2xs leading-relaxed text-warning', compact && 'basis-full')}>
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          {conciergeErrorCopy(error, tr)}
        </p>
      )}
    </div>
  )
}

type Msg ={ id: string; mine: boolean; body: string; createdAt: string; pending?: boolean; failed?: boolean; kind?: string; offerAmount?: number | null; offerStatus?: string | null; meta?: unknown }
type Thread = {
  id: string
  me: string // current user's profile id — to tell my messages from incoming
  iAmSeller?: boolean // true = I'm the listing's seller → hide "request contact" (I'm the contact)
  hasReviewed?: boolean // buyer side: this conversation already produced a review → no prompt
  // The e-Visa case this thread is bound to + the desk state its cards render against
  // (mode · picked product · server-issued USD quote · live payment providers). Absent on
  // every ordinary conversation.
  visaApplicationId?: string | null
  visa?: unknown
  listing: { id: string; title: string; image: string | null; price?: number; negotiable?: boolean; availabilityConfirmedAt?: string | null; status?: string }
  counterpart: {
    name: string
    avatarColor: string
    avatarUrl: string | null
    sellerId?: string | null
    // Trust meta for the header row (only when the counterpart has a seller identity).
    trust?: { trustScore: number; trustTier: string; memberSinceYear: number; isNew: boolean } | null
  }
  messages: Msg[]
}

export default function ThreadPage() {
  const { id } = useParams<{ id: string }>()
  const { user, loading } = useAuth()
  const { lang, tr } = useLanguage()
  const locale = moneyLocale(lang) // offer amounts follow the viewer's language
  const { getCachedThread, cacheThread, refreshUnread, refreshConvos } = useChat()
  // Back chevron: pop the thread off the stack rather than pushing /messages on top of it.
  const onBack = useSafeBack('/messages')
  // Paint instantly from the cached thread (e.g. one the offer/Message action just
  // seeded) and revalidate in the background — no blank "loading" flash on open.
  const [thread, setThread] = useState<Thread | null>(() => (getCachedThread(id) as Thread | null) ?? null)
  const [notFound, setNotFound] = useState(false)
  const [text, setText] = useState('')
  const [showOffer, setShowOffer] = useState(false) // offer-amount input visible
  const [offerInput, setOfferInput] = useState('')
  const [offerPct, setOfferPct] = useState(10) // slider mode (priced listings): % off asking
  // Countering an incoming offer needs the EXACT-amount text field, not the −% slider (which only
  // expresses a round % off asking and can't represent the number being countered). counterMode
  // forces the text input AND makes submitOffer read offerInput — otherwise the seeded counter
  // amount is shown/sent as nothing and Send silently fires "% off asking" instead.
  const [counterMode, setCounterMode] = useState(false)
  const [contact, setContact] = useState<{ phone: string; telHref: string; zaloHref: string } | null>(null)
  const [revealing, setRevealing] = useState(false)
  // The offer THIS seller just accepted in this session → anchors the one-time
  // "Mark as sold?" follow-through under that offer card (never shown to the buyer).
  const [justAcceptedId, setJustAcceptedId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const footerRef = useRef<HTMLDivElement>(null) // review+quick-replies+composer; lifts to fixed on keyboard
  const openedRef = useRef<string | null>(null) // conversation id already auto-pinned to newest
  const prevCountRef = useRef(0)
  const [newBelow, setNewBelow] = useState(false) // unseen message below the fold
  const composerRef = useRef<ChatComposerHandle>(null)
  // Current user's profile id, in a ref so the realtime handler (a stable closure)
  // can tell an incoming counterpart message from my own echo without re-subscribing.
  const meRef = useRef<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/conversations/${id}`)
    if (res.status === 404 || res.status === 403) { setNotFound(true); return }
    if (!res.ok) return
    const data = await res.json()
    cacheThread(id, data) // keep the cache warm for an instant paint next time
    // Preserve any still-pending optimistic messages so a background poll never
    // makes a just-sent message flicker away before the POST confirms it — but DROP
    // any temp the server already returned (match on mine+body), so a poll landing
    // mid-POST can't render the message twice (server-confirmed wins).
    setThread((prev) => {
      if (!prev) return data
      const temps = prev.messages.filter((m) => String(m.id).startsWith('temp-'))
      if (!temps.length) return data
      // Count-aware: only drop a temp if the server has an UNMATCHED copy of the same
      // (mine, body). Sending "ok" twice → two server rows clear two temps; one temp
      // confirmed + one still pending keeps the pending bubble (no flicker-hide).
      const counts = new Map<string, number>()
      for (const m of data.messages as Msg[]) { const k = `${m.mine}|${m.body}`; counts.set(k, (counts.get(k) || 0) + 1) }
      const pending = temps.filter((m) => {
        const k = `${m.mine}|${m.body}`
        const c = counts.get(k) || 0
        if (c > 0) { counts.set(k, c - 1); return false } // server already has this one
        return true
      })
      return pending.length ? { ...data, messages: [...data.messages, ...pending] } : data
    })
  }, [id, cacheThread])

  // Realtime: subscribe to this conversation's PRIVATE channel so an incoming
  // message paints the instant it's sent (the same socket the old widget used).
  // A slow poll + focus refetch stay as a backstop if the socket drops.
  useEffect(() => {
    if (!user) return
    // Opening the thread zeroes this conversation's unread server-side (the GET in
    // load()). Reconcile the inbox caches ONCE so the header Messages badge + the
    // conversation-list unread pill clear immediately, instead of staying stale for
    // up to the 45s poll (glaring on the desktop two-pane next to the open thread).
    load().then(() => { refreshUnread(); refreshConvos() })

    const supabase = createSupabaseBrowser()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    let attempts = 0

    // Tear down WITHOUT re-entrancy: null the ref first so the 'CLOSED' status
    // callback can't recurse back into teardown.
    const drop = () => { if (channel) { const c = channel; channel = null; supabase.removeChannel(c) } }

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
          const p = (payload ?? {}) as { id?: string; senderProfileId?: string; body?: string; createdAt?: string }
          if (!p.id || !p.body) { load(); return }
          // Offers / offer-actions carry structured fields (kind/amount/status) the
          // realtime payload doesn't include — refetch to hydrate the offer card.
          if (/^(💰|✅|❌)/.test(p.body)) { load(); return }
          setThread((t) => {
            if (!t) return t
            if (p.senderProfileId === t.me) return t // my own message: handled by optimistic send + POST
            if (t.messages.some((x) => x.id === p.id)) return t // dedup (poll may have it)
            return { ...t, messages: [...t.messages, { id: p.id!, mine: false, body: p.body!, createdAt: p.createdAt || new Date().toISOString() }] }
          })
          // A counterpart message arrived while this thread is open → mark it read
          // server-side (the GET zeroes this conversation's unread) and reconcile the
          // inbox row + header badge, so they don't drift to "unread" for an already-
          // read thread until the next backstop poll. Skips my own echo.
          if (p.senderProfileId && p.senderProfileId !== meRef.current) {
            void load().then(() => { refreshUnread(); refreshConvos() })
          }
        })
        .on('broadcast', { event: 'message_deleted' }, ({ payload }) => {
          const did = (payload as { id?: string } | null)?.id
          if (did) setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== did) } : t))
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') { attempts = 0; return }
          // Never retry 'CLOSED' (that's our own teardown → would recurse); cap the rest.
          if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !cancelled && !retry && attempts < 5) {
            attempts++
            retry = setTimeout(() => { retry = null; join() }, 3000)
          }
        })
    }
    join()

    // Backstop poll, gated on visibility (audit P2 — the chat-context idiom): a
    // backgrounded tab used to keep polling every 15s indefinitely. Realtime is
    // primary; on return to visibility we refetch once and resume.
    let iv: ReturnType<typeof setInterval> | null = document.visibilityState === 'visible' ? setInterval(load, 15000) : null
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        if (!iv) { load(); iv = setInterval(load, 15000) }
      } else if (iv) { clearInterval(iv); iv = null }
    }
    document.addEventListener('visibilitychange', onVis)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      if (retry) clearTimeout(retry)
      drop()
      if (iv) clearInterval(iv)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onFocus)
    }
  }, [user, load, id])

  // Messenger-standard scroll behavior. The pane (listRef) is the ONLY thing that
  // ever moves — never scrollIntoView, which scrolls every ancestor and yanked the
  // whole page to the top when a conversation opened. Rules: opening a thread pins
  // to the newest message instantly; a message I send follows smoothly; a message
  // that arrives while I'm reading history does NOT move me — it shows the
  // "New messages" pill instead.
  const scrollBottom = useCallback((smooth: boolean) => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])
  const distanceFromBottom = () => {
    const el = listRef.current
    return el ? el.scrollHeight - el.scrollTop - el.clientHeight : 0
  }
  useLayoutEffect(() => {
    const count = thread?.messages.length ?? 0
    const prev = prevCountRef.current
    prevCountRef.current = count
    if (!count) return
    if (openedRef.current !== id) {
      openedRef.current = id
      scrollBottom(false)
      return
    }
    if (count <= prev) return // poll refresh / deletion — hold the reading position
    const last = thread!.messages[count - 1]
    // 240px ≈ "I was at the bottom" even after the new bubble pushed the height.
    if (last?.mine || distanceFromBottom() < 240) scrollBottom(true)
    else setNewBelow(true)
  }, [thread?.messages.length, id, scrollBottom]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setNewBelow(false) }, [id])
  useEffect(() => { meRef.current = thread?.me ?? null }, [thread?.me])

  // Publish the composer footer's live height into --footer-h so the message list can
  // reserve exactly that much bottom padding once the footer lifts to position:fixed
  // (keyboard up) — the last message then always clears it, for a 1-line or grown composer.
  useEffect(() => {
    const el = footerRef.current
    if (!el) return
    const root = document.documentElement
    const set = () => root.style.setProperty('--footer-h', `${el.offsetHeight}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => { ro.disconnect(); root.style.removeProperty('--footer-h') }
  }, [id])

  // clientId per LOGICAL send (audit P2): a dropped response after a committed POST
  // flips the bubble to retry — the retry reuses the id and the server replays the
  // original message instead of inserting a duplicate.
  const sendClientIds = useRef(new Map<string, string>())
  const send = async (override?: string, reuseClientId?: string) => {
    const body = (override ?? text).trim()
    if (!body) return
    // Optimistic: show the bubble the instant Send is tapped — the POST swaps in the
    // real message; realtime ignores my own echo, so the UI never waits on the DB.
    const tempId = `temp-${Date.now()}`
    const clientId = reuseClientId ?? crypto.randomUUID()
    sendClientIds.current.set(tempId, clientId)
    const optimistic: Msg = { id: tempId, mine: true, body, createdAt: new Date().toISOString(), pending: true }
    setText('')
    composerRef.current?.clear() // empty the contenteditable DOM immediately (no 1-frame lag)
    haptic()
    setThread((t) => (t ? { ...t, messages: [...t.messages, optimistic] } : t))
    try {
      const res = await fetch(`/api/conversations/${id}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, clientId }),
      })
      if (res.ok) {
        const m = (await res.json()) as Msg
        // Swap the temp for the real message — unless a poll already delivered it.
        sendClientIds.current.delete(tempId)
        setThread((t) => {
          if (!t) return t
          const without = t.messages.filter((x) => x.id !== tempId)
          if (without.some((x) => x.id === m.id)) return { ...t, messages: without }
          return { ...t, messages: [...without, m] }
        })
        refreshUnread(); refreshConvos()
      } else {
        markFailed(tempId)
      }
    } catch {
      markFailed(tempId)
    }
  }

  // On a failed send, keep the bubble and flip it to a tap-to-retry state instead of
  // silently dropping it (Vietnam's mobile networks drop requests often).
  const markFailed = (tempId: string) =>
    setThread((t) => (t ? { ...t, messages: t.messages.map((x) => (x.id === tempId ? { ...x, pending: false, failed: true } : x)) } : t))

  const retry = (m: Msg) => {
    const clientId = sendClientIds.current.get(m.id)
    sendClientIds.current.delete(m.id)
    setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== m.id) } : t))
    void send(m.body, clientId)
  }

  // Reveal the seller's number + Zalo on request (login-gated + rate-limited +
  // logged as a lead by the API). Gated in the UI to AFTER the seller has replied.
  const requestContact = async () => {
    if (contact || revealing || !thread) return
    setRevealing(true)
    try {
      const res = await fetch(`/api/listings/${thread.listing.id}/contact`, { method: 'POST' })
      if (res.ok) { setContact(await res.json()); return }
      // Surface WHY instead of silently doing nothing (looks broken otherwise).
      const err = (await res.json().catch(() => null))?.error
      toast.error(
        err === 'no_contact' ? tr("This seller hasn't added a phone number yet.", 'Người bán chưa thêm số điện thoại.')
        : err === 'reply_required' ? tr('You can request contact once the seller replies.', 'Bạn có thể xin liên hệ sau khi người bán trả lời.')
        : err === 'rate_limited' ? tr('Too many requests — please try again shortly.', 'Quá nhiều yêu cầu — vui lòng thử lại sau.')
        : err === 'auth_required' ? tr('Please sign in to request contact.', 'Vui lòng đăng nhập để xin liên hệ.')
        : tr('Could not get contact — please try again.', 'Không lấy được liên hệ — vui lòng thử lại.'),
      )
    } catch {
      toast.error(tr('Could not get contact — please try again.', 'Không lấy được liên hệ — vui lòng thử lại.'))
    } finally {
      setRevealing(false)
    }
  }

  // Send a structured offer (a message with kind='offer' + amount). Optimistic,
  // then refetch to hydrate the real offer fields + supersede prior offers.
  const lastOfferSend = useRef<{ amount: number; clientId: string } | null>(null)
  const sendOffer = async (amount: number) => {
    const amt = Math.round(amount)
    if (!amt || amt <= 0) return
    // Same amount re-sent (a retry after "not sent", incl. the committed-but-response-
    // dropped case) keeps its clientId → the server replays instead of duplicating.
    const clientId = lastOfferSend.current?.amount === amt ? lastOfferSend.current.clientId : crypto.randomUUID()
    lastOfferSend.current = { amount: amt, clientId }
    const tempId = `temp-${Date.now()}`
    // Body stays empty — the offer card derives its label from offerAmount.
    const optimistic: Msg = { id: tempId, mine: true, body: '', createdAt: new Date().toISOString(), pending: true, kind: 'offer', offerAmount: amt, offerStatus: 'pending' }
    setThread((t) => (t ? { ...t, messages: [...t.messages, optimistic] } : t))
    try {
      const res = await fetch(`/api/conversations/${id}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offerAmount: amt, clientId }),
      })
      if (res.ok) {
        // SUCCESS clears the reuse slot — a later, genuinely new offer of the same
        // amount must mint a fresh id (only failure-path re-taps replay).
        lastOfferSend.current = null
        // Drop the optimistic temp BEFORE load() — load() re-appends any remaining
        // temps onto fresh server data, which would duplicate the offer card.
        setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== tempId) } : t))
        await load(); refreshUnread(); refreshConvos()
      } else { setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== tempId) } : t)); toast.error(tr('Offer not sent — please try again.', 'Chưa gửi được đề nghị — vui lòng thử lại.')) }
    } catch {
      setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== tempId) } : t)); toast.error(tr('Offer not sent — please try again.', 'Chưa gửi được đề nghị — vui lòng thử lại.'))
    }
  }

  // Accept/decline a pending offer (recipient only). Optimistic flip, then refetch.
  const actingOffer = useRef(false)
  const actOffer = async (messageId: string, action: 'accept' | 'decline') => {
    if (actingOffer.current) return // block double-click double-POST
    actingOffer.current = true
    // Acting on an offer closes any armed counter composer — otherwise arming "Counter", then
    // Accept/Decline instead, would leave the exact-amount composer live and a stray Send could
    // fire an unintended counter-offer.
    setShowOffer(false); setCounterMode(false); setOfferInput('')
    // Optimistic flip.
    setThread((t) => (t ? { ...t, messages: t.messages.map((m) => (m.id === messageId ? { ...m, offerStatus: action === 'accept' ? 'accepted' : 'declined' } : m)) } : t))
    try {
      const res = await fetch(`/api/conversations/${id}/offer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId, action }),
      })
      // ALWAYS reconcile from the server — on a reject (409/429/403) load() reverts
      // the optimistic flip so we never leave a phantom "Accepted" the server refused.
      await load()
      if (res.ok) {
        refreshUnread(); refreshConvos()
        // Seller accepted → offer the natural next step (mark the listing sold).
        if (action === 'accept' && thread?.iAmSeller) setJustAcceptedId(messageId)
      }
    } catch {
      await load() // restore true state
    } finally {
      actingOffer.current = false
    }
  }

  // ── e-VISA IN THE THREAD ────────────────────────────────────────────────────────
  //
  // "one tap e visa service should be available through direct message" — the five-step
  // wizard, the passport uploads and the checkout all happen in these bubbles. The server
  // owns every decision (which step, which price, who may act); this client renders the
  // cards it is sent and calls the frozen routes.
  //
  // ⚠️ NO PII TAKES A DETOUR THROUGH HERE. A card's `meta` carries a step number, an
  // application id and FIELD NAMES. The applicant's answers are fetched by useVisaCase
  // straight into their own browser (the route scopes by user_id, so the desk's session
  // gets a 404 and sees value-free cards), and edits go back out through the encrypted
  // payload path. Nothing applicant-typed is logged or put in a message body.
  const visaInfo = useMemo(() => parseVisaThreadInfo(thread?.visa), [thread?.visa])
  // Only the APPLICANT drives the wizard: acknowledging a passport is their act, and the
  // act route refuses anyone but the thread's buyer.
  const iAmApplicant = !!visaInfo && !thread?.iAmSeller
  const { kase: visaCase, unavailable: visaCaseError, reload: reloadVisaCase } = useVisaCase(visaInfo?.applicationId ?? null, iAmApplicant)
  const [visaBusy, setVisaBusy] = useState(false)

  // One POST helper for the visa routes. Never throws, and never surfaces anything but a
  // CODE — these routes carry passport data, so a refusal names the class of failure and
  // the client turns that into a sentence (visaErrorCopy).
  const visaPost = useCallback(async (path: string, body?: unknown): Promise<{ ok: boolean; error?: string; data: Record<string, unknown> }> => {
    try {
      const isForm = body instanceof FormData
      const res = await fetch(path, {
        method: 'POST',
        headers: isForm ? undefined : { 'Content-Type': 'application/json' },
        body: isForm ? body : JSON.stringify(body ?? {}),
      })
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
      const error = typeof data?.error === 'string' ? data.error : undefined
      return { ok: res.ok, error: res.ok ? undefined : error, data: data ?? {} }
    } catch {
      return { ok: false, error: 'network', data: {} }
    }
  }, [])

  // THE LOOP, once per thread open. /advance is idempotent by contract ("make sure the card
  // for the current step exists", never "post one"), so this recovers a flow whose card
  // failed to post and picks up answers the applicant gave on the dashboard instead. NOT on
  // the 15s poll: idempotent is not the same as free.
  const visaAdvancedRef = useRef<string | null>(null)
  useEffect(() => {
    const applicationId = iAmApplicant ? visaInfo?.applicationId : null
    if (!applicationId || visaAdvancedRef.current === applicationId) return
    visaAdvancedRef.current = applicationId
    void visaPost(`/api/visa/applications/${applicationId}/advance`).then((res) => { if (res.ok) void load() })
  }, [iAmApplicant, visaInfo?.applicationId, visaPost, load])

  // Acknowledge / skip / edit. The server recomputes the step FIRST and only then closes the
  // card, so a "skip" that cannot actually be skipped just keeps asking — we simply refetch
  // and let the same card render again.
  const actOnVisaCard = async (messageId: string, action: 'acknowledge' | 'skip' | 'edit', fields?: Record<string, string>): Promise<boolean> => {
    if (visaBusy) return false
    setVisaBusy(true)
    try {
      const res = await visaPost(`/api/visa/cards/${messageId}/act`, { action, ...(fields ? { fields } : {}) })
      if (!res.ok) toast.error(visaErrorCopy(res.error, tr))
      await Promise.all([load(), reloadVisaCase()])
      if (res.ok) { refreshUnread(); refreshConvos() }
      return res.ok
    } finally {
      setVisaBusy(false)
    }
  }

  // The passport / portrait upload, IN THE THREAD — the same documents + extract endpoints
  // the dashboard wizard uses (there is deliberately no second uploader), then one /advance
  // so the next card appears without waiting for a poll.
  const uploadVisaDocument = async (kind: 'passport' | 'portrait', file: File) => {
    const applicationId = visaInfo?.applicationId
    if (!applicationId || visaBusy) return
    setVisaBusy(true)
    const toastId = `visa-${kind}`
    try {
      toast.loading(tr('Preparing your photo…', 'Đang chuẩn bị ảnh…'), { id: toastId })
      let prepared: File
      try {
        prepared = await prepareVisaImage(file)
      } catch (e) {
        toast.error(visaErrorCopy((e as Error)?.message, tr), { id: toastId })
        return
      }
      const form = new FormData()
      form.set('kind', kind)
      form.set('file', prepared)
      toast.loading(tr('Sending your photo…', 'Đang gửi ảnh…'), { id: toastId })
      const uploaded = await visaPost(`/api/visa/applications/${applicationId}/documents`, form)
      if (!uploaded.ok) { toast.error(visaErrorCopy(uploaded.error, tr), { id: toastId }); return }
      const documentId = (uploaded.data.document as { id?: string } | undefined)?.id
      toast.loading(
        kind === 'passport'
          ? tr('Reading your passport…', 'Đang đọc hộ chiếu…')
          : tr('Checking the portrait…', 'Đang kiểm tra ảnh chân dung…'),
        { id: toastId },
      )
      const analyzed = await visaPost(`/api/visa/applications/${applicationId}/extract`, { kind, ...(documentId ? { documentId } : {}) })
      if (!analyzed.ok) {
        toast.error(visaErrorCopy(analyzed.error, tr), { id: toastId })
      } else if ((analyzed.data.document as { validationStatus?: string } | undefined)?.validationStatus === 'passed') {
        toast.success(
          kind === 'passport'
            ? tr('Passport read. Check the details below.', 'Đã đọc hộ chiếu. Hãy kiểm tra thông tin bên dưới.')
            : tr('Portrait accepted.', 'Đã nhận ảnh chân dung.'),
          { id: toastId },
        )
      } else {
        // The refusal reason is on the document itself; the card lists it in full.
        toast.error(tr('That photo did not pass the check — see the notes below.', 'Ảnh chưa đạt yêu cầu — xem ghi chú bên dưới.'), { id: toastId })
      }
      await visaPost(`/api/visa/applications/${applicationId}/advance`)
      await Promise.all([load(), reloadVisaCase()])
    } finally {
      setVisaBusy(false)
    }
  }

  // ── ENO CONCIERGE ───────────────────────────────────────────────────────────────
  //
  // "also hook ai gemini 3.5 flash there so it can answer all related latest updates about
  // visa application name is Eno concierge" (owner).
  //
  // The chip ARMS THE COMPOSER rather than opening a second input — the same idiom the offer
  // Tag button already uses in this bar, so a phone keeps one text field and one Send. The
  // question goes to /concierge, and the SERVER writes both messages (the applicant's
  // question, then the answer labelled "✨ Eno concierge"), so the answer survives a reload
  // and the desk can read what the assistant told their applicant.
  //
  // ⚠️ AVAILABLE ONLY IN 'ai' MODE. "ife person requested ai doesnt answer" — asking for a
  // person disarms and un-mounts this immediately; the route refuses it a second time.
  const [conciergeArmed, setConciergeArmed] = useState(false)
  const [conciergeBusy, setConciergeBusy] = useState(false)
  const [conciergeError, setConciergeError] = useState<string | null>(null)
  const conciergeAvailable = !!visaInfo && iAmApplicant && visaInfo.mode === 'ai'
  useEffect(() => { if (!conciergeAvailable) setConciergeArmed(false) }, [conciergeAvailable])

  const askConcierge = async (raw: string) => {
    const applicationId = visaInfo?.applicationId
    const question = raw.trim()
    if (!applicationId || !question || conciergeBusy) return
    setConciergeBusy(true)
    setConciergeError(null)
    // Clear the field immediately (the send() idiom) — the question comes back from the
    // server as a real message, so there is nothing to keep locally.
    setText('')
    composerRef.current?.clear()
    haptic()
    try {
      // EN/VI only, like every other string on this surface: `lang` is one of ELEVEN
      // interface languages, and the answer is PERSISTED into the thread where the desk has
      // to be able to read it too. The server coerces the same way — this is belt and braces.
      const res = await visaPost(`/api/visa/applications/${applicationId}/concierge`, { question, lang: lang === 'vi' ? 'vi' : 'en' })
      // The refusal sits under the chips the finger is still on, not in a toast that slides
      // away from where they are looking.
      if (!res.ok) setConciergeError(res.error ?? 'internal_error')
      await load()
      // Both messages are somebody else's as far as the scroll rule is concerned (the answer
      // is authored by the desk), so take them to it instead of leaving a "New messages" pill.
      requestAnimationFrame(() => { scrollBottom(true); setNewBelow(false) })
      refreshUnread(); refreshConvos()
    } finally {
      setConciergeBusy(false)
    }
  }

  const toggleConcierge = () => {
    // Arming the concierge closes the offer composer — one composer, one meaning.
    setShowOffer(false); setCounterMode(false); setOfferInput('')
    setConciergeError(null)
    setConciergeArmed((armed) => !armed)
  }

  // "they can request human intervention or help if needed" — flips the thread's mode and
  // puts the request in front of the desk. The wizard deliberately keeps working while they
  // wait; only an admin TAKEOVER stops the cards.
  const askVisaHuman = async () => {
    const applicationId = visaInfo?.applicationId
    if (!applicationId || visaBusy) return
    setVisaBusy(true)
    // Disarmed the instant a person is asked for, without waiting for the mode to come back
    // on the reload: the composer must not still be pointed at the bot they just declined.
    setConciergeArmed(false)
    setConciergeError(null)
    try {
      const res = await visaPost(`/api/visa/applications/${applicationId}/help`, {})
      if (!res.ok) { toast.error(visaErrorCopy(res.error, tr)); return }
      toast.success(tr('Asked for a person — we will reply here.', 'Đã yêu cầu nhân viên — chúng tôi sẽ trả lời tại đây.'))
      await load()
      refreshUnread(); refreshConvos()
    } finally {
      setVisaBusy(false)
    }
  }

  // ── THE WAY BACK TO THE FORM ────────────────────────────────────────────────────
  //
  // "also admin can send visa application form from chip if the original one is way up in
  // conversation" (owner). One tap posts the CURRENT card to the bottom of the thread.
  //
  // ⚠️ NOT /advance. That route is idempotent by contract — asked for a card that already
  // exists it hands back the SAME messageId and writes nothing, which is precisely the
  // unreachable card the user is complaining about. /resend is the separate path that
  // deliberately posts one; it changes no step, no answer and no price.
  //
  // The refusal is kept in state rather than thrown at a toast: the chip sits right above the
  // composer, so its own failure sentence belongs under it (a 429 is the expected one — the
  // route caps this per thread on purpose).
  const [visaResendError, setVisaResendError] = useState<string | null>(null)
  const resendVisaCard = async () => {
    const applicationId = visaInfo?.applicationId
    if (!applicationId || visaBusy) return
    setVisaBusy(true)
    setVisaResendError(null)
    try {
      const res = await visaPost(`/api/visa/applications/${applicationId}/resend`)
      if (!res.ok) { setVisaResendError(res.error ?? 'internal_error'); return }
      haptic()
      await load()
      // The card is authored by the DESK, so to the applicant it arrives as somebody else's
      // message — and the scroll rule then leaves them where they are behind a "New messages"
      // pill, which is the exact problem this chip exists to solve. Take them to it. rAF, not
      // straight after load(): the layout effect that decides "pill or scroll" runs on the
      // commit, and this has to win afterwards.
      requestAnimationFrame(() => { scrollBottom(true); setNewBelow(false) })
      refreshUnread(); refreshConvos()
    } finally {
      setVisaBusy(false)
    }
  }

  // Pay. The body names a PRODUCT and echoes the quote that was on screen — never an amount:
  // the server re-resolves the listing's đồng price, re-issues its own dollar quote, refuses
  // if the two disagree, and charges its own number.
  const payVisa = async (provider: 'stripe' | 'paypal', quote: VisaQuoteWire) => {
    const applicationId = visaInfo?.applicationId
    const listingId = visaInfo?.product?.listingId
    if (!applicationId || !listingId || visaBusy) return
    setVisaBusy(true)
    let leaving = false
    try {
      const res = await visaPost(`/api/visa/applications/${applicationId}/checkout`, {
        provider, listingId, quote, declarationAccepted: true, prefillAuthorized: true,
      })
      const url = typeof res.data.url === 'string' ? res.data.url : null
      if (res.ok && url) {
        // Leaving for the provider's hosted page — keep the CTA busy so it cannot double-fire.
        leaving = true
        window.location.assign(url)
        return
      }
      toast.error(visaErrorCopy(res.error, tr))
      // The price moved, the desk closed, or an answer went missing: re-read both sides so
      // the card shows what the server is now willing to sell.
      await Promise.all([load(), reloadVisaCase()])
    } finally {
      if (!leaving) setVisaBusy(false)
    }
  }

  // WHICH card is live: the NEWEST visa_step card that speaks for the case this thread is
  // CURRENTLY bound to and is still 'active'. Everything above it — and every card left
  // behind by a previous case (a repeat applicant rebinds the thread) — is history, and
  // history is never a prompt. An admin takeover silences the step cards entirely.
  const liveVisaStepId = useMemo(() => {
    if (!thread || !visaInfo || visaInfo.mode === 'admin') return null
    for (let i = thread.messages.length - 1; i >= 0; i--) {
      const m = thread.messages[i]
      const meta = parseVisaStepMeta(m.kind, m.meta)
      if (!meta) continue
      return meta.state === 'active' && meta.applicationId === visaInfo.applicationId ? m.id : null
    }
    return null
  }, [thread, visaInfo])

  // The pay card is deliberately NOT silenced by a takeover: an admin who stepped in still
  // needs the applicant to pay, and this card is the only way to ask.
  const liveVisaCheckoutId = useMemo(() => {
    if (!thread || !visaInfo) return null
    for (let i = thread.messages.length - 1; i >= 0; i--) {
      const m = thread.messages[i]
      const meta = parseVisaCheckoutMeta(m.kind, m.meta)
      if (!meta) continue
      return meta.status === 'unpaid' && meta.applicationId === visaInfo.applicationId ? m.id : null
    }
    return null
  }, [thread, visaInfo])

  const askingPrice = thread?.listing.price && thread.listing.price > 0 ? thread.listing.price : null
  const sliderOffer = askingPrice ? Math.round(askingPrice * (1 - offerPct / 100)) : null
  const submitOffer = () => {
    // counterMode → the typed amount; otherwise the slider wins when the listing has a price.
    const n = counterMode || sliderOffer === null ? Number(offerInput.replace(/\D/g, '')) : sliderOffer
    if (n > 0) { sendOffer(n); setShowOffer(false); setOfferInput(''); setCounterMode(false) }
  }

  // "+000" chip: append three zeros (the ×1,000 VND shortcut) to the current amount.
  const addThousand = () => setOfferInput((v) => {
    const d = v.replace(/\D/g, '')
    if (!d) return v
    return groupVnd((d + '000').slice(0, 12), locale)
  })

  // Opening the offer composer disarms the concierge — one composer, one meaning (the
  // mirror of toggleConcierge closing the offer composer).
  const toggleOffer = () => { setShowOffer((s) => !s); setOfferInput(''); setOfferPct(10); setCounterMode(false); setConciergeArmed(false) }

  // Quick-reply chip → INSERT into the composer (never auto-send), cursor at the
  // end so partial templates ("Can meet in ") are completed in one motion.
  const insertQuickReply = (t: string) => {
    setShowOffer(false); setCounterMode(false)
    // REPLACE the composer content — each chip is a complete reply, and appending
    // turned two taps into garbage ("Can meet in Let me think about it"). Last tap
    // wins; anything half-typed is superseded deliberately by the tap.
    setText(t)                       // keep parent state + send-button styling in sync
    // insert() focuses SYNCHRONOUSLY inside the tap gesture (iOS only opens the keyboard
    // for focus in the same call stack as the touch) and drops the caret at the end.
    composerRef.current?.insert(t)
  }

  // Seller-only "Let me think about it" chip appears while the buyer's latest
  // message is a still-pending offer.
  const lastTheirs = thread ? [...thread.messages].reverse().find((m) => !m.mine) : undefined
  const hasPendingBuyerOffer = !!lastTheirs && lastTheirs.kind === 'offer' && lastTheirs.offerStatus === 'pending'

  // Buyer-side review prompt: the deal closed (listing sold OR an offer here was
  // accepted) and this conversation hasn't produced a review yet.
  const hasAcceptedOffer = !!thread?.messages.some((m) => m.kind === 'offer' && m.offerStatus === 'accepted')
  const showReviewPrompt = !!thread && !thread.iAmSeller && !thread.hasReviewed && !!thread.counterpart.sellerId &&
    (thread.listing.status === 'sold' || hasAcceptedOffer)

  // Safety interjections — pure render-time, no fetch/send involvement.
  // First-contact hint: I haven't spoken yet (or the thread barely started).
  // Genuine thread STARTS only — an old unanswered thread (buyer wrote 10 messages
  // weeks ago, seller never replied) is not a 'first chat' and the copy would lie.
  const showFirstContactNote = !!thread && thread.messages.length <= 3 && !thread.messages.some((m) => m.mine)
  // Off-platform lure: anchor ONE warning under the first suspicious incoming message.
  const offPlatformWarnId = thread ? findOffPlatformMessageId(thread.messages) : null

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {!loading && !user ? (
        <div className="flex flex-1 items-center justify-center px-3">
          <div className="rounded-2xl bg-card p-8 text-center shadow-pop">
            <p className="text-sm text-muted-foreground">{tr('Sign in to view this conversation.', 'Đăng nhập để xem cuộc trò chuyện này.')}</p>
            <div className="mt-4"><SignInPrompt /></div>
          </div>
        </div>
      ) : notFound ? (
        <div className="flex flex-1 items-center justify-center px-3">
          <p className="text-sm text-muted-foreground">{tr('Conversation not found.', 'Không tìm thấy cuộc trò chuyện.')}</p>
        </div>
      ) : (
        <div className="flex h-full w-full flex-col overflow-hidden">
          {/* Thread header (back arrow only on mobile — the list is always shown on desktop) */}
          <div className="flex items-center gap-3 bg-background px-4 py-3">
            {/* POPS the thread off the stack (see src/lib/safe-back.ts) and only pushes
                /messages when there's nothing to pop — a push-notification tap, a shared
                link, a cold native start. Pushing unconditionally used to grow the stack,
                so the next hardware-back / edge-swipe re-entered the thread just left. */}
            <Link href="/messages" onClick={onBack} aria-label={tr('Back', 'Quay lại')} className="text-muted-foreground hover:text-accent-foreground lg:hidden relative tap-44"><ChevronLeft className="h-5 w-5" aria-hidden /></Link>
            <Avatar name={thread?.counterpart.name} url={thread?.counterpart.avatarUrl} color={thread?.counterpart.avatarColor} size="sm" />
            <div className="min-w-0 flex-1 cursor-pointer">
              {thread?.counterpart.sellerId ? (
                <Link href={`/sellers/${thread.counterpart.sellerId}`} className="block truncate text-sm font-bold text-foreground hover:underline">{thread.counterpart.name}</Link>
              ) : (
                <div className="truncate text-sm font-bold text-foreground">{thread?.counterpart.name || '…'}</div>
              )}
              {thread?.counterpart.trust && (
                <div className="mt-0.5">
                  <TrustMeta
                    trustScore={thread.counterpart.trust.trustScore}
                    trustTier={thread.counterpart.trust.trustTier}
                    memberSinceYear={thread.counterpart.trust.memberSinceYear}
                    isNew={thread.counterpart.trust.isNew}
                    responseBucket={{ key: null, en: '', vi: '' }}
                  />
                </div>
              )}
              {thread && <Link href={`/listings/${thread.listing.id}`} className="block truncate text-xs text-accent-foreground hover:underline">{thread.listing.title}</Link>}
            </div>
            {/* Report this conversation (harassment / scam in chat) — the report links
                the thread so an admin can read the exchange. */}
            {thread && <ReportButton conversationId={thread.id} className="shrink-0" />}
          </div>

          {/* Contact is requested IN-CHAT, and only once the seller has replied —
              this is what gets sellers logging in daily to answer + keep listings fresh. */}
          {thread && !thread.iAmSeller && (
            <div className="flex items-center gap-2 border-t border-border bg-background px-4 py-2">
              {contact ? (
                <>
                  <a href={contact.telHref} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-foreground hover:bg-muted transition-colors">
                    <Phone className="h-3.5 w-3.5" /> {contact.phone}
                  </a>
                  <a href={contact.zaloHref} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-xl bg-[#0068ff] px-3 py-1.5 text-xs font-bold text-white">
                    Zalo
                  </a>
                  {/* WhatsApp off the SAME number (owner: "request Zalo or Whatsapp in chat
                      top"). A Vietnamese seller lives on Zalo; a foreign buyer usually has only
                      WhatsApp, and one VN mobile reaches both — so pinning both here is the
                      point. The digits come from the revealed number, not a second lookup:
                      contact.zaloHref already ends in the E.164 digits, but extractPhoneNumber
                      re-derives them from the display string so a formatting change to either
                      side can't desync the two links. */}
                  {(() => {
                    const digits = extractPhoneNumber(contact.phone)
                    return digits ? (
                      <a href={contactLinksFor(digits).whatsapp} target="_blank" rel="noreferrer nofollow" className="flex items-center gap-1.5 rounded-xl bg-[#25d366] px-3 py-1.5 text-xs font-bold text-white">
                        WhatsApp
                      </a>
                    ) : null
                  })()}
                </>
              ) : thread.messages.some((m) => !m.mine) ? (
                <Button variant="bare" size="none" onClick={requestContact} disabled={revealing} className="gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted cursor-pointer">
                  {revealing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Phone className="h-3.5 w-3.5" />}
                  {tr('Request number · Zalo / WhatsApp', 'Lấy số · Zalo / WhatsApp')}
                </Button>
              ) : (
                <p className="flex items-center gap-1.5 text-2xs text-body">
                  <Phone className="h-3.5 w-3.5 shrink-0 text-ink-4" />
                  {tr("You can request the seller's number once they reply — one number works for both Zalo and WhatsApp.", 'Bạn có thể xin số sau khi người bán trả lời — một số dùng được cho cả Zalo và WhatsApp.')}
                </p>
              )}
            </div>
          )}

          {/* Messages */}
          <div ref={listRef} onScroll={() => { if (newBelow && distanceFromBottom() < 40) setNewBelow(false) }} role="log" aria-live="polite" aria-relevant="additions" className="chat-scroll flex-1 min-h-0 space-y-2 overflow-y-auto overscroll-contain px-4 py-4 scroll-thin">
            {showFirstContactNote && <FirstContactNote />}
            {thread?.messages.map((m, i, arr) => {
              const prev = arr[i - 1]
              const showDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt)
              const dk = dayKey(m.createdAt)
              const dayText = dk === new Date().toDateString() ? tr('Today', 'Hôm nay')
                : dk === new Date(Date.now() - 864e5).toDateString() ? tr('Yesterday', 'Hôm qua')
                : new Date(m.createdAt).toLocaleDateString(locale === 'vi' ? 'vi-VN' : 'en-US', { month: 'short', day: 'numeric' })
              const askPct = m.kind === 'offer' && thread?.listing.price && m.offerAmount ? Math.round((m.offerAmount / thread.listing.price) * 100) : null
              // KIND DISPATCH. Each structured kind parses its own metaJson and refuses to
              // render as a live prompt off a blob it cannot read (the server already
              // strict-parses every write, so an unreadable one is a legacy/hand-written row).
              const visaStepMeta = parseVisaStepMeta(m.kind, m.meta)
              const visaCheckoutMeta = parseVisaCheckoutMeta(m.kind, m.meta)
              const visaResultMeta = parseVisaResultMeta(m.kind, m.meta)
              return (
              <Fragment key={m.id}>
                {showDay && (
                  <div className="flex justify-center py-1.5">
                    <Badge variant="neutral" className="px-3 text-3xs font-semibold">{dayText}</Badge>
                  </div>
                )}
                {/* Only the NEWEST bubble animates in (each new send/receive), so the
                    history never mass-animates on thread open. */}
                <div className={`flex flex-col ${m.mine ? 'items-end' : 'items-start'} ${i === arr.length - 1 ? 'bubble-in' : ''}`}>
                {m.kind === 'offer' ? (
                  <div className={`allow-select max-w-[80%] rounded-2xl border px-3 py-2.5 ${m.mine ? 'border-brand/30 bg-primary/5' : 'border-border bg-card'}`}>
                    {/* Offer line is DERIVED from the structured offerAmount (tr'd + money
                        format) — never from the stored body. Legacy messages still carry a
                        baked "💰 Offered …₫" body: skip it (rendering it too would double up). */}
                    <div className="text-2xs font-bold uppercase tracking-wide text-accent-foreground">💰 {tr('Offer', 'Đề nghị')}</div>
                    <div className="mt-0.5 text-base font-bold text-foreground">{tr('Offered', 'Đã trả giá')} {formatMoneyFull(m.offerAmount || 0, '₫', locale)}</div>
                    {askPct != null && (
                      <div className="text-2xs font-medium text-ink-4">{askPct}% {tr('of asking', 'của giá rao')} ({formatMoneyFull(thread!.listing.price!, '₫', locale)})</div>
                    )}
                    {m.body && !m.body.startsWith('💰') && (
                      <div className="mt-1 text-sm leading-relaxed text-foreground">{m.body}</div>
                    )}
                    {m.offerStatus === 'pending' && (
                      <div className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-warning">
                        <span className="h-1.5 w-1.5 rounded-full bg-warning" /> {tr('Pending', 'Đang chờ')}
                      </div>
                    )}
                    {m.offerStatus && m.offerStatus !== 'pending' && (
                      <div className={`mt-1 text-xs font-semibold ${m.offerStatus === 'accepted' ? 'text-success' : m.offerStatus === 'declined' ? 'text-destructive' : 'text-ink-4'}`}>
                        {m.offerStatus === 'accepted' ? tr('Accepted', 'Đã chấp nhận') : m.offerStatus === 'declined' ? tr('Declined', 'Đã từ chối') : tr('Countered', 'Đã trả giá khác')}
                      </div>
                    )}
                    {!m.mine && m.offerStatus === 'pending' && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Button variant="cta" size="none" onClick={() => actOffer(m.id, 'accept')} className="rounded-lg px-3 py-1 text-xs transition-colors cursor-pointer">{tr('Accept', 'Chấp nhận')}</Button>
                        {/* hover:text-body is LOAD-BEARING: ghost injects hover:text-accent-foreground,
                            and text-body is a COLOUR — without the re-assert the label flips colour on hover. */}
                        <Button variant="ghost" size="none" onClick={() => actOffer(m.id, 'decline')} className="rounded-lg px-3 py-1 text-xs font-bold text-body transition-colors hover:bg-muted hover:text-body cursor-pointer">{tr('Decline', 'Từ chối')}</Button>
                        {/* Countering SENDS a new offer, so hide it on a fixed-price listing
                            (Accept/Decline don't send offers and stay). A stale pending offer
                            can outlive a switch to fixed price — the 409 would otherwise reject
                            the counter and, for a buyer, dock trust for a control we showed. */}
                        {thread?.listing.negotiable !== false && (
                          <Button variant="ghost" size="none" onClick={() => { setOfferInput(groupVnd(String(m.offerAmount ?? 0), locale)); setCounterMode(true); setShowOffer(true) }} className="rounded-lg px-3 py-1 text-xs font-bold text-accent-foreground transition-colors hover:bg-muted cursor-pointer">{tr('Counter', 'Trả giá')}</Button>
                        )}
                      </div>
                    )}
                    {m.mine && m.offerStatus === 'pending' && (
                      <div className="mt-1 text-xs text-ink-4">{tr('Waiting for a response…', 'Đang chờ phản hồi…')}</div>
                    )}
                    {/* Seller just accepted THIS offer → follow through to "sold". */}
                    {thread?.iAmSeller && m.id === justAcceptedId && m.offerStatus === 'accepted' && (
                      <MarkSoldPrompt listingId={thread.listing.id} listingTitle={thread.listing.title} />
                    )}
                  </div>
                ) : visaStepMeta ? (
                  <VisaStepCard
                    meta={visaStepMeta}
                    info={visaInfo}
                    kase={visaCase}
                    caseError={visaCaseError}
                    // Live only for the applicant, only for the newest active card of the
                    // bound case, and never while a human has taken the thread over.
                    live={iAmApplicant && m.id === liveVisaStepId}
                    busy={visaBusy}
                    onAct={(action, fields) => actOnVisaCard(m.id, action, fields)}
                    onUpload={uploadVisaDocument}
                  />
                ) : visaCheckoutMeta ? (
                  <VisaCheckoutCard
                    meta={visaCheckoutMeta}
                    info={visaInfo}
                    kase={visaCase}
                    live={iAmApplicant && m.id === liveVisaCheckoutId}
                    busy={visaBusy}
                    onPay={payVisa}
                  />
                ) : visaResultMeta ? (
                  // The finished visa. No `live` flag: it is never a prompt and never
                  // expires — the card is a permanent download, for whoever the thread
                  // belongs to (the endpoint re-proves that on every request).
                  <VisaResultCard meta={visaResultMeta} info={visaInfo} />
                ) : m.kind === 'visa_step' || m.kind === 'visa_checkout' || m.kind === 'visa_result' ? (
                  // A card whose meta this build cannot read. Its body is empty by design,
                  // so it must NOT fall through to an empty bubble.
                  <MessageBubble mine={m.mine} className="max-w-[78%] text-ink-4">
                    {tr('This e-Visa step could not be shown here — open the full form to continue.', 'Không hiển thị được bước E-Visa này — hãy mở biểu mẫu đầy đủ để tiếp tục.')}
                  </MessageBubble>
                ) : (
                  <MessageBubble mine={m.mine} failed={m.failed} pending={m.pending} className="max-w-[78%]">{m.body}</MessageBubble>
                )}
                  {m.mine && m.failed ? (
                    // A send that FAILED must be spoken, not just reddened. The scroller
                    // above is role="log" aria-relevant="additions", so a pending bubble
                    // FLIPPING to failed is a text change it never announces. role="alert"
                    // goes on this WRAPPER, never on the Button — overriding a button's
                    // role would strip its button semantics and lose the retry affordance.
                    <div role="alert" className="mt-0.5">
                      <Button variant="bare" size="none" onClick={() => retry(m)} className="gap-1 px-1 text-3xs font-semibold text-destructive hover:underline cursor-pointer">
                        <RotateCcw className="h-2.5 w-2.5" /> {tr('Not sent — tap to retry', 'Chưa gửi — chạm để thử lại')}
                      </Button>
                    </div>
                  ) : m.mine && m.pending ? (
                    <span className="mt-0.5 flex items-center gap-1 px-1 text-3xs text-ink-4"><Loader2 className="h-2.5 w-2.5 animate-spin" /> {tr('Sending…', 'Đang gửi…')}</span>
                  ) : (
                    <span className="mt-0.5 px-1 text-3xs text-ink-4">{fmtTime(m.createdAt)}</span>
                  )}
                </div>
                {m.id === offPlatformWarnId && <OffPlatformWarning />}
              </Fragment>
              )
            })}
            {thread && thread.messages.length === 0 && (
              <p className="py-10 text-center text-xs text-ink-4">{tr('Say hello — this seller will be notified.', 'Gửi lời chào — người bán sẽ được thông báo.')}</p>
            )}
            {/* Uncached thread → skeleton bubbles (not a blank pane) while it loads. */}
            {!thread && (
              <div className="space-y-2" aria-hidden>
                {[['start', 'w-40'], ['end', 'w-28'], ['start', 'w-52'], ['end', 'w-36']].map(([side, w], i) => (
                  <div key={i} className={`flex ${side === 'end' ? 'justify-end' : 'justify-start'}`}>
                    <Skeleton className={`h-9 ${w} rounded-2xl`} />
                  </div>
                ))}
              </div>
            )}
            <div ref={bottomRef} />
            {/* Sticky inside the scroll pane so it floats over the last bubbles. */}
            {newBelow && (
              <div className="sticky bottom-1 z-10 flex justify-center">
                <Button
                  variant="cta"
                  size="none"
                  type="button"
                  onClick={() => { scrollBottom(true); setNewBelow(false) }}
                  className="flex items-center gap-1 rounded-full px-3.5 py-1.5 text-xs shadow-pop transition-transform active:scale-95 cursor-pointer"
                >
                  ↓ {tr('New messages', 'Tin nhắn mới')}
                </Button>
              </div>
            )}
          </div>

          {/* ── FOOTER (review prompt + quick-replies + composer): one unit that lifts to
              position:fixed FLUSH above the keyboard when kb-open (globals.css .chat-footer);
              a plain flow footer when the keyboard is closed. Wrapped together so the
              quick-reply chips are never hidden behind the fixed composer. */}
          <div ref={footerRef} className="chat-footer shrink-0">
          {/* Post-transaction review prompt (buyer only) — one quiet card above the
              composer; ✕ hides it for the session, it stays gone once reviewed. */}
          {showReviewPrompt && thread && (
            <ReviewPrompt
              sellerId={thread.counterpart.sellerId!}
              sellerName={thread.counterpart.name}
              conversationId={thread.id}
              className="px-4 pt-1.5"
            />
          )}

          {/* e-Visa thread, APPLICANT SIDE — the two chips the owner asked for, side by side
              and mounted by the composer so neither is ever scrolled out of reach.
              ⚠️ MODE SPLIT, and it is the whole "ife person requested ai doesnt answer" rule:
              in 'ai' the pair is offered; in 'human_requested'/'admin' the concierge chip does
              not exist at all and VisaThreadStrip's banner explains who is answering instead
              (it renders "Talk to a person" only in 'ai', so the two never double up). */}
          {/* ⚠️ ONE ROW, ONE EXPLANATION (owner: "also put the chips in one neat row"). These
              used to be two stacked blocks, each with its own helper sentence, plus the resend
              chip's block below — three paragraphs of chrome above the composer on a phone, and
              they read as three separate features instead of one set of choices. The row is
              owned HERE; VisaAssistChips and VisaResendChip both render in `compact` mode
              (display:contents), so their buttons become items of this flex row while their
              own notes wrap onto a line of their own. */}
          {visaInfo && (
            <div className="flex flex-wrap items-center gap-2 px-4 pt-1.5">
              {iAmApplicant && (conciergeAvailable ? (
                <VisaAssistChips
                  armed={conciergeArmed}
                  thinking={conciergeBusy}
                  busy={visaBusy}
                  error={conciergeError}
                  onToggleConcierge={toggleConcierge}
                  onAskHuman={askVisaHuman}
                  compact
                />
              ) : (
                <VisaThreadStrip info={visaInfo} busy={visaBusy} onAskHuman={askVisaHuman} compact />
              ))}
              <VisaResendChip
                info={visaInfo}
                isDesk={!!thread?.iAmSeller}
                busy={visaBusy}
                error={visaResendError}
                onResend={resendVisaCard}
                compact
              />
            </div>
          )}

          {/* Quick replies — seller: the 3 endless questions answered in one tap;
              buyer: "still available?" that self-answers from a fresh seller
              confirmation. Chips insert into the composer, never auto-send.
              Suppressed on a visa thread: "is this still available?" is nonsense at a
              government-form desk, and the cards are the affordance there. */}
          {thread && !visaInfo && (
            <QuickReplyChips
              isSeller={!!thread.iAmSeller}
              hasPendingBuyerOffer={hasPendingBuyerOffer}
              availabilityConfirmedAt={thread.listing.availabilityConfirmedAt}
              onInsert={insertQuickReply}
              onSend={(t) => send(t)}
              composerText={text}
              className="px-4 pt-1.5"
            />
          )}

          {/* Composer — the Tag toggle flips this same bar between a message field
              and the offer-amount field (no separate input bar). In offer mode the
              field shows an inline +000 chip and Send submits the offer. */}
          <div className="chat-composer flex items-end gap-2 bg-background px-4 pt-3 pb-3">
            {/* Offer control only on negotiable listings — a fixed-price seller takes
                no offers (buyers just ask availability + buy). Undefined = older cached
                thread → allow (server still enforces). */}
            {thread?.listing.negotiable !== false && (
              <IconButton
                size="lg"
                onClick={toggleOffer}
                aria-label={tr('Make an offer', 'Gửi đề nghị giá')}
                title={tr('Make an offer', 'Gửi đề nghị giá')}
                className={`transition-colors ${showOffer ? 'bg-primary/10 text-accent-foreground' : 'text-ink-4 hover:bg-muted'}`}
              >
                <Tag className="h-[18px] w-[18px]" />
              </IconButton>
            )}

            {showOffer && sliderOffer !== null && !counterMode ? (
              /* Priced listing: the −% slider rolls in (left→right) where the chat
                 input was — pick the discount, Send submits the computed offer. */
              <div className="flex h-10 min-w-0 flex-1 items-center gap-2.5 self-center px-1 animate-in slide-in-from-left-2 fade-in duration-150">
                <span className="shrink-0 text-xs font-bold tabular-nums text-foreground">−{offerPct}%</span>
                <EnoSlider
                  min={5} max={50} step={5}
                  value={offerPct}
                  onChange={setOfferPct}
                  aria-label={tr('Discount', 'Mức giảm')}
                  className="min-w-0 flex-1"
                />
                <span className="shrink-0 text-xs font-bold tabular-nums text-accent-foreground">{formatMoneyFull(sliderOffer, '₫', locale)}</span>
              </div>
            ) : showOffer ? (
              <div className="relative flex-1">
                {/* text-base + lg:text-sm is LOAD-BEARING (iOS zooms the viewport on focus
                    below 16px); border-brand is the armed/active state. */}
                <Input
                  variant="outline"
                  value={offerInput}
                  onChange={(e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 12); setOfferInput(d ? groupVnd(d, locale) : '') }}
                  inputMode="numeric"
                  enterKeyHint="send"
                  autoFocus
                  aria-label={tr('Offer amount (VND)', 'Số tiền đề nghị (VND)')}
                  placeholder={tr('Offer amount (VND)', 'Số tiền đề nghị (VND)')}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitOffer() }}
                  className="rounded-2xl border-brand px-3.5 py-2.5 pr-16 text-base focus:ring-brand/20 lg:text-sm"
                />
                {/* +000 chip, inside the input's right corner (×1,000 shortcut) */}
                <Button
                  variant="bare"
                  size="none"
                  type="button"
                  onClick={addThousand}
                  aria-label={tr('Add three zeros', 'Thêm 000')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-accent px-2 py-1 text-xs font-bold text-accent-foreground transition-colors hover:bg-primary/15 cursor-pointer tap-44"
                >
                  +000
                </Button>
              </div>
            ) : (
              /* contenteditable, NOT <textarea> — iOS attaches the keyboard accessory
                 bar (‹ › + Done) to form controls only, so this removes it entirely.
                 Enter-to-send + Vietnamese IME are handled inside ChatComposer. */
              <ChatComposer
                ref={composerRef}
                value={text}
                onChange={setText}
                /* Armed → the same field, the same Return key, a different destination:
                   /concierge instead of the ordinary message POST. */
                onSend={() => (conciergeArmed ? void askConcierge(text) : send())}
                placeholder={conciergeArmed ? tr('Ask Eno concierge…', 'Hỏi Eno concierge…') : tr('Write a message…', 'Nhập tin nhắn…')}
                ariaLabel={conciergeArmed ? tr('Ask Eno concierge', 'Hỏi Eno concierge') : tr('Write a message', 'Nhập tin nhắn')}
              />
            )}

            {showOffer ? (
              /* Offer modes keep a real Send — the price slider has no text field, so
                 there's no Return key to send it. preventDefault on pointer/mouse-down
                 holds focus so tapping never blurs the field: on mobile that blur
                 dismisses the keyboard, the viewport resizes, and the button shifts out
                 from under the finger before the tap lands — which is why taps were lost. */
              <ChatSendButton
                onClick={submitOffer}
                disabled={sliderOffer === null && !offerInput}
                aria-label={tr('Send offer', 'Gửi đề nghị')}
                title={tr('Send offer', 'Gửi đề nghị')}
              />
            ) : (
              /* Text mode: a real tap-Send button (the Zalo/FB pattern users expect).
                 onMouseDown preventDefault HOLDS the composer's focus so the tap never
                 blurs the field → dismisses the keyboard → shifts the button out from
                 under the finger (the earlier reason tap-Send was unreliable). Return
                 still sends too (enterKeyHint="send"). */
              <ChatSendButton
                onClick={() => (conciergeArmed ? void askConcierge(text) : send())}
                disabled={!text.trim() || conciergeBusy}
                aria-label={conciergeArmed ? tr('Ask Eno concierge', 'Hỏi Eno concierge') : tr('Send', 'Gửi')}
                title={conciergeArmed ? tr('Ask Eno concierge', 'Hỏi Eno concierge') : tr('Send', 'Gửi')}
              />
            )}
          </div>
          </div>
        </div>
      )}
    </div>
  )
}
