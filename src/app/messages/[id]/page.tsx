'use client'

import { Fragment, useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'

import { useParams } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useChat } from '@/context/chat-context'
import { SignInPrompt } from '@/components/marketplace/account-actions'
import { createSupabaseBrowser } from '@/lib/supabase/browser'
import { ChevronLeft, Send, Phone, Loader2, Tag, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { haptic } from '@/lib/haptics'
import { formatMoneyFull } from '@/lib/vnd'
import { Button } from '@/components/ui/button'
import { ReportButton } from '@/components/marketplace/report-button'
import { QuickReplyChips, MarkSoldPrompt } from '@/components/marketplace/quick-reply-chips'
import { ReviewPrompt } from '@/components/marketplace/review-prompt'
import { fmtTime, dayKey } from '@/lib/dates'

type Msg ={ id: string; mine: boolean; body: string; createdAt: string; pending?: boolean; failed?: boolean; kind?: string; offerAmount?: number | null; offerStatus?: string | null }
type Thread = {
  id: string
  me: string // current user's profile id — to tell my messages from incoming
  iAmSeller?: boolean // true = I'm the listing's seller → hide "request contact" (I'm the contact)
  hasReviewed?: boolean // buyer side: this conversation already produced a review → no prompt
  listing: { id: string; title: string; image: string | null; price?: number; availabilityConfirmedAt?: string | null; status?: string }
  counterpart: { name: string; avatarColor: string; avatarUrl: string | null; sellerId?: string | null }
  messages: Msg[]
}

export default function ThreadPage() {
  const { id } = useParams<{ id: string }>()
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const { getCachedThread, cacheThread, refreshUnread, refreshConvos } = useChat()
  // Paint instantly from the cached thread (e.g. one the offer/Message action just
  // seeded) and revalidate in the background — no blank "loading" flash on open.
  const [thread, setThread] = useState<Thread | null>(() => (getCachedThread(id) as Thread | null) ?? null)
  const [notFound, setNotFound] = useState(false)
  const [text, setText] = useState('')
  const [showOffer, setShowOffer] = useState(false) // offer-amount input visible
  const [offerInput, setOfferInput] = useState('')
  const [offerPct, setOfferPct] = useState(10) // slider mode (priced listings): % off asking
  const [contact, setContact] = useState<{ phone: string; telHref: string; zaloHref: string } | null>(null)
  const [revealing, setRevealing] = useState(false)
  // The offer THIS seller just accepted in this session → anchors the one-time
  // "Mark as sold?" follow-through under that offer card (never shown to the buyer).
  const [justAcceptedId, setJustAcceptedId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const openedRef = useRef<string | null>(null) // conversation id already auto-pinned to newest
  const prevCountRef = useRef(0)
  const [newBelow, setNewBelow] = useState(false) // unseen message below the fold
  const composerRef = useRef<HTMLTextAreaElement>(null)
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

    const iv = setInterval(load, 15000) // backstop only — realtime is primary
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      if (retry) clearTimeout(retry)
      drop()
      clearInterval(iv)
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

  const send = async (override?: string) => {
    const body = (override ?? text).trim()
    if (!body) return
    // Optimistic: show the bubble the instant Send is tapped — the POST swaps in the
    // real message; realtime ignores my own echo, so the UI never waits on the DB.
    const tempId = `temp-${Date.now()}`
    const optimistic: Msg = { id: tempId, mine: true, body, createdAt: new Date().toISOString(), pending: true }
    setText('')
    haptic()
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
    setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== m.id) } : t))
    void send(m.body)
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
  const sendOffer = async (amount: number) => {
    const amt = Math.round(amount)
    if (!amt || amt <= 0) return
    const tempId = `temp-${Date.now()}`
    // Body stays empty — the offer card derives its label from offerAmount.
    const optimistic: Msg = { id: tempId, mine: true, body: '', createdAt: new Date().toISOString(), pending: true, kind: 'offer', offerAmount: amt, offerStatus: 'pending' }
    setThread((t) => (t ? { ...t, messages: [...t.messages, optimistic] } : t))
    try {
      const res = await fetch(`/api/conversations/${id}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offerAmount: amt }),
      })
      if (res.ok) {
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

  const askingPrice = thread?.listing.price && thread.listing.price > 0 ? thread.listing.price : null
  const sliderOffer = askingPrice ? Math.round(askingPrice * (1 - offerPct / 100)) : null
  const submitOffer = () => {
    const n = sliderOffer ?? Number(offerInput.replace(/\D/g, ''))
    if (n > 0) { sendOffer(n); setShowOffer(false); setOfferInput('') }
  }

  // "+000" chip: append three zeros (the ×1,000 VND shortcut) to the current amount.
  const addThousand = () => setOfferInput((v) => {
    const d = v.replace(/\D/g, '')
    if (!d) return v
    return new Intl.NumberFormat('en-US').format(Number((d + '000').slice(0, 12)))
  })

  const toggleOffer = () => { setShowOffer((s) => !s); setOfferInput(''); setOfferPct(10) }

  // Quick-reply chip → INSERT into the composer (never auto-send), cursor at the
  // end so partial templates ("Can meet in ") are completed in one motion.
  const insertQuickReply = (t: string) => {
    setShowOffer(false)
    // REPLACE the composer content — each chip is a complete reply, and appending
    // turned two taps into garbage ("Can meet in Let me think about it"). Last tap
    // wins; anything half-typed is superseded deliberately by the tap.
    setText(t)
    requestAnimationFrame(() => {
      const el = composerRef.current
      if (el) { el.focus(); el.setSelectionRange(t.length, t.length) }
    })
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
          <div className="flex items-center gap-3 bg-card px-4 py-3">
            <Link href="/messages" className="text-muted-foreground hover:text-accent-foreground lg:hidden relative tap-44"><ChevronLeft className="h-5 w-5" /></Link>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              {thread?.counterpart.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              {thread?.counterpart.sellerId ? (
                <Link href={`/sellers/${thread.counterpart.sellerId}`} className="block truncate text-sm font-bold text-foreground hover:underline">{thread.counterpart.name}</Link>
              ) : (
                <div className="truncate text-sm font-bold text-foreground">{thread?.counterpart.name || '…'}</div>
              )}
              {thread && <Link href={`/listings/${thread.listing.id}`} className="truncate text-xs text-accent-foreground hover:underline">{thread.listing.title}</Link>}
            </div>
            {/* Report this conversation (harassment / scam in chat) — the report links
                the thread so an admin can read the exchange. */}
            {thread && <ReportButton conversationId={thread.id} className="shrink-0" />}
          </div>

          {/* Contact is requested IN-CHAT, and only once the seller has replied —
              this is what gets sellers logging in daily to answer + keep listings fresh. */}
          {thread && !thread.iAmSeller && (
            <div className="flex items-center gap-2 border-t border-border bg-card px-4 py-2">
              {contact ? (
                <>
                  <a href={contact.telHref} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-foreground hover:bg-muted transition-colors">
                    <Phone className="h-3.5 w-3.5" /> {contact.phone}
                  </a>
                  <a href={contact.zaloHref} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-xl bg-[#0068ff] px-3 py-1.5 text-xs font-bold text-white">
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

          {/* Messages */}
          <div ref={listRef} onScroll={() => { if (newBelow && distanceFromBottom() < 40) setNewBelow(false) }} role="log" aria-live="polite" aria-relevant="additions" className="flex-1 space-y-2 overflow-y-auto px-4 py-4 scroll-thin">
            {thread?.messages.map((m, i, arr) => {
              const prev = arr[i - 1]
              const showDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt)
              const dk = dayKey(m.createdAt)
              const dayText = dk === new Date().toDateString() ? tr('Today', 'Hôm nay')
                : dk === new Date(Date.now() - 864e5).toDateString() ? tr('Yesterday', 'Hôm qua')
                : new Date(m.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
              const askPct = m.kind === 'offer' && thread?.listing.price && m.offerAmount ? Math.round((m.offerAmount / thread.listing.price) * 100) : null
              return (
              <Fragment key={m.id}>
                {showDay && (
                  <div className="flex justify-center py-1.5">
                    <span className="rounded-full bg-tint px-3 py-0.5 text-[10px] font-semibold text-ink-4">{dayText}</span>
                  </div>
                )}
                <div className={`flex flex-col ${m.mine ? 'items-end' : 'items-start'}`}>
                {m.kind === 'offer' ? (
                  <div className={`max-w-[80%] rounded-2xl border px-3 py-2.5 ${m.mine ? 'border-brand/30 bg-primary/5' : 'border-border bg-card'}`}>
                    {/* Offer line is DERIVED from the structured offerAmount (tr'd + money
                        format) — never from the stored body. Legacy messages still carry a
                        baked "💰 Offered …₫" body: skip it (rendering it too would double up). */}
                    <div className="text-[11px] font-bold uppercase tracking-wide text-accent-foreground">💰 {tr('Offer', 'Đề nghị')}</div>
                    <div className="mt-0.5 text-base font-bold text-foreground">{tr('Offered', 'Đã trả giá')} {formatMoneyFull(m.offerAmount || 0, '₫')}</div>
                    {askPct != null && (
                      <div className="text-[11px] font-medium text-ink-4">{askPct}% {tr('of asking', 'của giá rao')} ({formatMoneyFull(thread!.listing.price!, '₫')})</div>
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
                        <button onClick={() => actOffer(m.id, 'decline')} className="rounded-lg px-3 py-1 text-xs font-bold text-body transition-colors hover:bg-muted cursor-pointer">{tr('Decline', 'Từ chối')}</button>
                        <button onClick={() => { setOfferInput(new Intl.NumberFormat('en-US').format(m.offerAmount ?? 0)); setShowOffer(true) }} className="rounded-lg px-3 py-1 text-xs font-bold text-accent-foreground transition-colors hover:bg-muted cursor-pointer">{tr('Counter', 'Trả giá')}</button>
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
                ) : (
                  <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${m.failed ? 'border border-destructive/30 bg-destructive/10 text-destructive' : m.mine ? 'bg-primary text-white' : 'bg-card text-foreground'} ${m.pending ? 'opacity-70' : ''}`}>
                    {m.body}
                  </div>
                )}
                  {m.mine && m.failed ? (
                    <button onClick={() => retry(m)} className="mt-0.5 flex items-center gap-1 px-1 text-[10px] font-semibold text-destructive hover:underline cursor-pointer">
                      <RotateCcw className="h-2.5 w-2.5" /> {tr('Not sent — tap to retry', 'Chưa gửi — chạm để thử lại')}
                    </button>
                  ) : m.mine && m.pending ? (
                    <span className="mt-0.5 flex items-center gap-1 px-1 text-[10px] text-ink-4"><Loader2 className="h-2.5 w-2.5 animate-spin" /> {tr('Sending…', 'Đang gửi…')}</span>
                  ) : (
                    <span className="mt-0.5 px-1 text-[10px] text-ink-4">{fmtTime(m.createdAt)}</span>
                  )}
                </div>
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
                    <div className={`h-9 ${w} rounded-2xl shimmer`} />
                  </div>
                ))}
              </div>
            )}
            <div ref={bottomRef} />
            {/* Sticky inside the scroll pane so it floats over the last bubbles. */}
            {newBelow && (
              <div className="sticky bottom-1 z-10 flex justify-center">
                <button
                  type="button"
                  onClick={() => { scrollBottom(true); setNewBelow(false) }}
                  className="flex items-center gap-1 rounded-full bg-primary px-3.5 py-1.5 text-xs font-bold text-white shadow-pop transition-transform active:scale-95 cursor-pointer"
                >
                  ↓ {tr('New messages', 'Tin nhắn mới')}
                </button>
              </div>
            )}
          </div>

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

          {/* Quick replies — seller: the 3 endless questions answered in one tap;
              buyer: "still available?" that self-answers from a fresh seller
              confirmation. Chips insert into the composer, never auto-send. */}
          {thread && (
            <QuickReplyChips
              isSeller={!!thread.iAmSeller}
              hasPendingBuyerOffer={hasPendingBuyerOffer}
              availabilityConfirmedAt={thread.listing.availabilityConfirmedAt}
              onInsert={insertQuickReply}
              onSend={(t) => send(t)}
              className="px-4 pt-1.5"
            />
          )}

          {/* Composer — the Tag toggle flips this same bar between a message field
              and the offer-amount field (no separate input bar). In offer mode the
              field shows an inline +000 chip and Send submits the offer. */}
          <div className="flex items-end gap-2 bg-card px-4 py-3 lg:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <button
              onClick={toggleOffer}
              aria-label={tr('Make an offer', 'Gửi đề nghị giá')}
              title={tr('Make an offer', 'Gửi đề nghị giá')}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors cursor-pointer relative tap-44 ${showOffer ? 'bg-primary/10 text-accent-foreground' : 'text-ink-4 hover:bg-muted'}`}
            >
              <Tag className="h-[18px] w-[18px]" />
            </button>

            {showOffer && sliderOffer !== null ? (
              /* Priced listing: the −% slider rolls in (left→right) where the chat
                 input was — pick the discount, Send submits the computed offer. */
              <div className="flex h-10 min-w-0 flex-1 items-center gap-2.5 self-center px-1 animate-in slide-in-from-left-2 fade-in duration-150">
                <span className="shrink-0 text-xs font-bold tabular-nums text-foreground">−{offerPct}%</span>
                <input
                  type="range"
                  min={5} max={50} step={5}
                  value={offerPct}
                  onChange={(e) => setOfferPct(Number(e.target.value))}
                  aria-label={tr('Discount', 'Mức giảm')}
                  className="min-w-0 flex-1 accent-[var(--brand)] cursor-pointer"
                />
                <span className="shrink-0 text-xs font-bold tabular-nums text-accent-foreground">{formatMoneyFull(sliderOffer, '₫')}</span>
              </div>
            ) : showOffer ? (
              <div className="relative flex-1">
                <input
                  value={offerInput}
                  onChange={(e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 12); setOfferInput(d ? new Intl.NumberFormat('en-US').format(Number(d)) : '') }}
                  inputMode="numeric"
                  autoFocus
                  placeholder={tr('Offer amount (VND)', 'Số tiền đề nghị (VND)')}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitOffer() }}
                  className="w-full rounded-2xl border border-brand px-3.5 py-2.5 pr-16 text-sm outline-none focus:ring-2 focus:ring-brand/20"
                />
                {/* +000 chip, inside the input's right corner (×1,000 shortcut) */}
                <button
                  type="button"
                  onClick={addThousand}
                  aria-label={tr('Add three zeros', 'Thêm 000')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-accent px-2 py-1 text-xs font-bold text-accent-foreground transition-colors hover:bg-primary/15 cursor-pointer tap-44"
                >
                  +000
                </button>
              </div>
            ) : (
              <textarea
                ref={composerRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                rows={1}
                placeholder={tr('Write a message…', 'Nhập tin nhắn…')}
                className="max-h-28 flex-1 resize-none rounded-2xl border border-line-strong px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
            )}

            <button
              onClick={() => (showOffer ? submitOffer() : send())}
              disabled={showOffer ? (sliderOffer === null && !offerInput) : !text.trim()}
              aria-label={showOffer ? tr('Send offer', 'Gửi đề nghị') : tr('Send', 'Gửi')}
              title={showOffer ? tr('Send offer', 'Gửi đề nghị') : tr('Send', 'Gửi')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-transform active:scale-90 disabled:opacity-40 relative tap-44"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
