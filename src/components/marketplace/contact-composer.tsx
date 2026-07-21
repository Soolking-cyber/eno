'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Tag, Send, MessageCircle } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { EnoSlider } from './eno-slider'
import { Button } from '@/components/ui/button'
import { stashCompose } from '@/lib/quick-contact'
import { hapticTap, hapticConfirm } from '@/lib/haptics'

const MAX_DISCOUNT = 50 // % off the asking price the slider allows
export { COMPOSE_KEY } from '@/lib/quick-contact' // re-export: the key + writer live in the lib

/**
 * Unified contact + offer on the listing detail. No typing required: the SellerCard's
 * "Chat now" sends the canned opener ("Hi! Is this still available?") straight through
 * — one tap to a live thread. Below it, on any negotiable listing, the offer slider is
 * ALWAYS open (no trigger, no ✕): drag a discount, send a structured offer; still no
 * free-text box. On send we REDIRECT INSTANTLY to /messages/pending (no button
 * spinner); that resolver creates the conversation + posts the message/offer in the
 * background and swaps to the real thread. "Redirect first, load in background."
 */
export function ContactComposer({
  listingId, listingTitle, listingImage, sellerName, price, currency, negotiable = true,
}: {
  listingId: string
  listingTitle?: string
  listingImage?: string | null
  sellerName?: string
  price?: number
  currency: string // raw listing currency, e.g. '₫'
  negotiable?: boolean // false = fixed price → no offer control (ask directly)
}) {
  const { user, loading, openSignIn } = useAuth()
  const { lang, tr } = useLanguage()
  const locale = moneyLocale(lang) // offer amounts follow the viewer's language
  const router = useRouter()
  // The offer is ALWAYS open on a negotiable listing (user decisions 2026-07-14): the
  // slider IS the negotiation invitation — hiding it behind a button buried the
  // marketplace's core ritual, and a ✕ to close it just gave the buyer a way to hide
  // the thing they came for. There is no `offering` state any more. The default
  // discount scales with the ticket: 5% on ordinary items, 1% on ≥1 tỷ đ (cars,
  // apartments), where 5% is tens of millions and reads as a lowball.
  const [discount, setDiscount] = useState(typeof price === 'number' && price >= 1_000_000_000 ? 1 : 5) // % off

  // Offers are only possible on a negotiable, priced listing.
  const hasPrice = typeof price === 'number' && price > 0
  const canOffer = hasPrice && negotiable
  const offerPrice = hasPrice ? Math.round(price! * (1 - discount / 100)) : 0

  const opener = () => tr('Hi! Is this still available?', 'Chào bạn! Món này còn không?')

  // Stash the first message + optional STRUCTURED offer (offerAmount — never a baked
  // text line, so it lands as a proper offer card kind='offer'), then redirect
  // instantly. The /messages/pending resolver posts it and swaps to the real thread.
  // A tap that lands while auth is still resolving is BUFFERED here (not dropped)
  // and drained by the effect below once `loading` settles — an early "Chat now"
  // click used to silently no-op, which e2e papered over with retries.
  const pendingRef = useRef<{ body?: string; offerAmount?: number | null } | null>(null)
  const send = (opts: { body?: string; offerAmount?: number | null }) => {
    // Until auth resolves, treat as not-ready: don't push to /messages/pending
    // (which would 401-bounce). Prompt only once we know they're truly logged out.
    if (!user) {
      if (loading) { pendingRef.current = opts; return }
      openSignIn({ listingTitle, listingImage, sellerName })
      return
    }
    const offerAmount = opts.offerAmount ?? null
    // Shared single writer (src/lib/quick-contact) — a stash failure is deliberately
    // ignored here: the pending page falls back to /messages.
    stashCompose({ listingId, body: opts.body, offerAmount, listingTitle, listingImage, price, currency })
    router.push('/messages/pending')
  }

  // Drain a buffered intent once auth resolves: send() then routes it (signed-in →
  // stash + redirect; signed-out → sign-in prompt). One-shot: cleared before replay.
  useEffect(() => {
    if (loading || !pendingRef.current) return
    const opts = pendingRef.current
    pendingRef.current = null
    send(opts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading])

  // Touch feedback on the two highest-commitment taps in the app. Fired in the gesture
  // handler (never in send(), which also runs from the deferred auth drain — a buzz
  // arriving after the fact would confirm a tap the user has already forgotten about).
  //  · Chat now = a light tap: it acknowledges the press, the thread is the real payoff.
  //  · Send offer = the success texture, but ONLY when the offer will actually go out.
  //    A signed-out tap just opens sign-in — a normal gate, neither a success (lying) nor
  //    an error (punishing a guest for being a guest) — so it gets the same light tap.
  const chatNow = () => { hapticTap(); send({ body: opener() }) }
  const sendOffer = () => {
    if (!canOffer) return
    if (user) hapticConfirm()
    else hapticTap()
    send({ offerAmount: offerPrice })
  }

  // Deep-link (/listings/id#contact): scroll the composer into view. ?offer=N (a card
  // quick-offer) pre-sets the slider to that discount; a plain #contact just brings the
  // composer into view — a shared link must NOT auto-fire a message.
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hash !== '#contact') return
    const offerParam = Number(new URLSearchParams(window.location.search).get('offer'))
    // Ignore a stray ?offer= on a fixed-price listing (stale card link) — no offers here.
    const quickOffer = negotiable && Number.isFinite(offerParam) && offerParam >= 1 && offerParam <= MAX_DISCOUNT ? Math.round(offerParam) : null
    const t = window.setTimeout(() => {
      document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (quickOffer != null) setDiscount(quickOffer)
    }, 150)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The SellerCard's "Chat now" sends the opener directly (one tap → live thread).
  // (There was an 'eno:open-offer' listener here too; it existed to un-collapse the
  // offer, nothing dispatches it any more, and the offer no longer collapses.)
  useEffect(() => {
    const onChat = () => chatNow()
    window.addEventListener('eno:chat-now', onChat)
    return () => window.removeEventListener('eno:chat-now', onChat)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canOffer, user, loading])

  // "Chat now" is now this composer's OWN primary CTA (moved here 2026-07-17 when the seller card
  // was consolidated into the shop-on-top link, which took over the identity/trust). chatNow() sends
  // the canned opener straight to a thread and gates guests to sign-in; the composer still ALSO
  // answers the eno:chat-now event (the mobile action bar).
  const safetyLine = (
    <p className="text-center text-xs text-muted-foreground">
      {tr('Request their number or Zalo once they reply.', 'Yêu cầu số điện thoại hoặc Zalo sau khi họ trả lời.')}
    </p>
  )
  const chatButton = (
    <Button
      type="button"
      variant="cta"
      size="none"
      onClick={chatNow}
      className="press flex w-full items-center justify-center gap-1.5 py-2.5 active:scale-100 cursor-pointer"
    >
      <MessageCircle className="h-4 w-4" /> {tr('Chat now', 'Chat ngay')}
    </Button>
  )

  // Fixed-price listing: no offer → Chat now + the safety reminder.
  if (!canOffer) return <div className="space-y-2">{chatButton}{safetyLine}</div>

  if (!loading && !user) {
    return (
      <div className="space-y-2">
        {chatButton}
        <Button
          type="button"
          variant="bare"
          size="none"
          onClick={() => openSignIn({ listingTitle, listingImage, sellerName })}
          className="press flex w-full cursor-pointer gap-1.5 py-2.5 font-bold text-accent-foreground hover:bg-tint active:scale-100"
        >
          <Tag className="h-4 w-4" /> {tr('Sign in to make an offer', 'Đăng nhập để trả giá')}
        </Button>
        {safetyLine}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* The offer is always open on a negotiable listing (user decisions 2026-07-14:
          haggling is the norm here, so it opens at a default discount). There's no
          close ✕ and no "Make an offer" trigger — nothing to close it TO: leaving the
          slider untouched already costs the buyer nothing, and Chat now sits beside
          Send offer (owner 2026-07-18: one 70/30 row) for anyone who doesn't want
          to haggle. The standalone full-width Chat now remains for fixed-price and
          signed-out listings above. */}
      <div className="rounded-2xl bg-accent p-3">
        <span className="text-xs font-semibold text-body">{tr('Your offer', 'Giá đề nghị')}</span>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-accent-foreground tabular-nums">{formatMoneyFull(offerPrice, currency, locale)}</span>
          {/* text-body, not muted-foreground: the latter is ~3.5:1 on the bg-accent
              tint → a serious WCAG AA contrast failure (axe caught it on the PDP). */}
          <span className="text-xs font-semibold text-body">−{discount}%</span>
        </div>
        <EnoSlider
          min={0} max={MAX_DISCOUNT} step={1} value={discount}
          onChange={setDiscount}
          aria-label={tr('Discount', 'Mức giảm')}
          className="mt-2"
        />
        <div className="flex justify-between text-3xs font-medium text-ink-4">
          <span>{tr('Asking', 'Giá rao')}: {formatMoneyFull(price!, currency, locale)}</span>
          <span>−{MAX_DISCOUNT}%</span>
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            variant="cta"
            size="none"
            onClick={sendOffer}
            className="flex min-w-0 basis-[70%] items-center justify-center gap-2 rounded-xl py-2.5 text-sm transition-all active:scale-98 cursor-pointer"
          >
            <Send className="h-4 w-4 shrink-0" />
            <span className="truncate">{tr('Send offer', 'Gửi đề nghị')} · {formatMoneyFull(offerPrice, currency, locale)}</span>
          </Button>
          <Button
            type="button"
            variant="bare"
            size="none"
            onClick={chatNow}
            className="press flex min-w-0 basis-[30%] items-center justify-center gap-1.5 rounded-xl bg-card py-2.5 text-sm font-bold text-accent-foreground hover:bg-tint active:scale-100 cursor-pointer"
          >
            <MessageCircle className="h-4 w-4 shrink-0" /> <span className="truncate">{tr('Chat now', 'Chat ngay')}</span>
          </Button>
        </div>
      </div>

      {safetyLine}
    </div>
  )
}
