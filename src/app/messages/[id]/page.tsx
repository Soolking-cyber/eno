'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useChat } from '@/context/chat-context'
import { SignInPrompt } from '@/components/marketplace/account-actions'
import { createSupabaseBrowser } from '@/lib/supabase/browser'
import { ChevronLeft, Send, Phone, Loader2, Tag } from 'lucide-react'

type Msg = { id: string; mine: boolean; body: string; createdAt: string; pending?: boolean; kind?: string; offerAmount?: number | null; offerStatus?: string | null }
type Thread = {
  id: string
  me: string // current user's profile id — to tell my messages from incoming
  listing: { id: string; title: string; image: string | null }
  counterpart: { name: string; avatarColor: string; avatarUrl: string | null }
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
  const [contact, setContact] = useState<{ phone: string; telHref: string; zaloHref: string } | null>(null)
  const [revealing, setRevealing] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

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
      const serverKeys = new Set(data.messages.map((m: Msg) => `${m.mine}|${m.body}`))
      const pending = temps.filter((m) => !serverKeys.has(`${m.mine}|${m.body}`))
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

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [thread?.messages.length])

  const send = async (override?: string) => {
    const body = (override ?? text).trim()
    if (!body) return
    // Optimistic: show the bubble the instant Send is tapped — the POST swaps in the
    // real message; realtime ignores my own echo, so the UI never waits on the DB.
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
        refreshUnread(); refreshConvos()
      } else {
        setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== tempId) } : t))
        setText(body) // restore on failure
      }
    } catch {
      setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== tempId) } : t))
      setText(body)
    }
  }

  // Reveal the seller's number + Zalo on request (login-gated + rate-limited +
  // logged as a lead by the API). Gated in the UI to AFTER the seller has replied.
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
      if (res.ok) {
        // Drop the optimistic temp BEFORE load() — load() re-appends any remaining
        // temps onto fresh server data, which would duplicate the offer card.
        setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== tempId) } : t))
        await load(); refreshUnread(); refreshConvos()
      } else setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== tempId) } : t))
    } catch {
      setThread((t) => (t ? { ...t, messages: t.messages.filter((x) => x.id !== tempId) } : t))
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
      if (res.ok) { refreshUnread(); refreshConvos() }
    } catch {
      await load() // restore true state
    } finally {
      actingOffer.current = false
    }
  }

  const submitOffer = () => {
    const n = Number(offerInput.replace(/\D/g, ''))
    if (n > 0) { sendOffer(n); setShowOffer(false); setOfferInput('') }
  }

  // "+000" chip: append three zeros (the ×1,000 VND shortcut) to the current amount.
  const addThousand = () => setOfferInput((v) => {
    const d = v.replace(/\D/g, '')
    if (!d) return v
    return new Intl.NumberFormat('en-US').format(Number((d + '000').slice(0, 12)))
  })

  const toggleOffer = () => { setShowOffer((s) => !s); setOfferInput('') }

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
            <Link href="/messages" className="text-muted-foreground hover:text-accent-foreground lg:hidden"><ChevronLeft className="h-5 w-5" /></Link>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0a66c2] text-xs font-bold text-white">
              {thread?.counterpart.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-foreground">{thread?.counterpart.name || '…'}</div>
              {thread && <Link href={`/listings/${thread.listing.id}`} className="truncate text-xs text-accent-foreground hover:underline">{thread.listing.title}</Link>}
            </div>
          </div>

          {/* Contact is requested IN-CHAT, and only once the seller has replied —
              this is what gets sellers logging in daily to answer + keep listings fresh. */}
          {thread && (
            <div className="flex items-center gap-2 border-t border-border bg-card px-4 py-2">
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

          {/* Messages */}
          <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4 scroll-thin">
            {thread?.messages.map((m) => (
              <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                {m.kind === 'offer' ? (
                  <div className={`max-w-[80%] rounded-2xl border px-3 py-2.5 ${m.mine ? 'border-[#0a66c2]/30 bg-[#0a66c2]/5' : 'border-border bg-card'}`}>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-accent-foreground">💰 {tr('Offer', 'Đề nghị')}</div>
                    <div className="mt-0.5 text-base font-bold text-foreground">{new Intl.NumberFormat('en-US').format(m.offerAmount || 0)}₫</div>
                    {m.offerStatus && m.offerStatus !== 'pending' && (
                      <div className={`mt-1 text-xs font-semibold ${m.offerStatus === 'accepted' ? 'text-emerald-600' : m.offerStatus === 'declined' ? 'text-red-500' : 'text-ink-4'}`}>
                        {m.offerStatus === 'accepted' ? tr('Accepted', 'Đã chấp nhận') : m.offerStatus === 'declined' ? tr('Declined', 'Đã từ chối') : tr('Countered', 'Đã trả giá khác')}
                      </div>
                    )}
                    {!m.mine && m.offerStatus === 'pending' && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <button onClick={() => actOffer(m.id, 'accept')} className="rounded-lg bg-[#0a66c2] px-3 py-1 text-xs font-bold text-white transition-colors hover:bg-[#004182] cursor-pointer">{tr('Accept', 'Chấp nhận')}</button>
                        <button onClick={() => actOffer(m.id, 'decline')} className="rounded-lg px-3 py-1 text-xs font-bold text-body transition-colors hover:bg-muted cursor-pointer">{tr('Decline', 'Từ chối')}</button>
                        <button onClick={() => { setOfferInput(new Intl.NumberFormat('en-US').format(m.offerAmount ?? 0)); setShowOffer(true) }} className="rounded-lg px-3 py-1 text-xs font-bold text-accent-foreground transition-colors hover:bg-muted cursor-pointer">{tr('Counter', 'Trả giá')}</button>
                      </div>
                    )}
                    {m.mine && m.offerStatus === 'pending' && (
                      <div className="mt-1 text-xs text-ink-4">{tr('Waiting for a response…', 'Đang chờ phản hồi…')}</div>
                    )}
                  </div>
                ) : (
                  <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${m.mine ? 'bg-[#0a66c2] text-white' : 'bg-card text-foreground'}`}>
                    {m.body}
                  </div>
                )}
              </div>
            ))}
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
          </div>

          {/* Composer — the Tag toggle flips this same bar between a message field
              and the offer-amount field (no separate input bar). In offer mode the
              field shows an inline +000 chip and Send submits the offer. */}
          <div className="flex items-end gap-2 bg-card px-4 py-3 lg:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <button
              onClick={toggleOffer}
              aria-label={tr('Make an offer', 'Gửi đề nghị giá')}
              title={tr('Make an offer', 'Gửi đề nghị giá')}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors cursor-pointer ${showOffer ? 'bg-[#0a66c2]/10 text-accent-foreground' : 'text-ink-4 hover:bg-muted'}`}
            >
              <Tag className="h-[18px] w-[18px]" />
            </button>

            {showOffer ? (
              <div className="relative flex-1">
                <input
                  value={offerInput}
                  onChange={(e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 12); setOfferInput(d ? new Intl.NumberFormat('en-US').format(Number(d)) : '') }}
                  inputMode="numeric"
                  autoFocus
                  placeholder={tr('Offer amount (₫)', 'Số tiền đề nghị (₫)')}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitOffer() }}
                  className="w-full rounded-2xl border border-[#0a66c2] px-3.5 py-2.5 pr-16 text-sm outline-none focus:ring-2 focus:ring-[#0a66c2]/20"
                />
                {/* +000 chip, inside the input's right corner (×1,000 shortcut) */}
                <button
                  type="button"
                  onClick={addThousand}
                  aria-label={tr('Add three zeros', 'Thêm 000')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-accent px-2 py-1 text-xs font-bold text-accent-foreground transition-colors hover:bg-[#0a66c2]/15 cursor-pointer"
                >
                  +000
                </button>
              </div>
            ) : (
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                rows={1}
                placeholder={tr('Write a message…', 'Nhập tin nhắn…')}
                className="max-h-28 flex-1 resize-none rounded-2xl border border-line-strong px-3.5 py-2.5 text-sm outline-none focus:border-[#0a66c2] focus:ring-2 focus:ring-[#0a66c2]/20"
              />
            )}

            <button
              onClick={() => (showOffer ? submitOffer() : send())}
              disabled={showOffer ? !offerInput : !text.trim()}
              aria-label={showOffer ? tr('Send offer', 'Gửi đề nghị') : tr('Send', 'Gửi')}
              title={showOffer ? tr('Send offer', 'Gửi đề nghị') : tr('Send', 'Gửi')}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0a66c2] text-white transition-transform active:scale-90 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
