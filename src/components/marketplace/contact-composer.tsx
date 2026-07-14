'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Tag, Send, X } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { EnoSlider } from './eno-slider'
import { Button } from '@/components/ui/button'

const MAX_DISCOUNT = 50 // % off the asking price the slider allows
export const COMPOSE_KEY = 'eno-compose' // sessionStorage handoff → /messages/pending

/**
 * Unified contact + offer on the listing detail. No typing required: the primary
 * "Chat now" button sends the canned opener ("Hi! Is this still available?")
 * straight through — one tap to a live thread. Hagglers tap "Make an offer" (tucked
 * under Chat now) to drag a discount slider and send a structured offer; still no
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
  // Offer starts OPEN (user decision 2026-07-14): the slider IS the negotiation
  // invitation — hiding it behind a button buried the marketplace's core ritual.
  // ✕ still collapses it. Default discount scales with the ticket: 5% on ordinary
  // items, but 1% on ≥1 tỷ đ (cars, apartments) where 5% is tens of millions and
  // reads as a lowball (user decision 2026-07-14).
  const [offering, setOffering] = useState(true)
  const [discount, setDiscount] = useState(typeof price === 'number' && price >= 1_000_000_000 ? 1 : 5) // % off

  // Offers are only possible on a negotiable, priced listing.
  const hasPrice = typeof price === 'number' && price > 0
  const canOffer = hasPrice && negotiable
  const offerPrice = hasPrice ? Math.round(price! * (1 - discount / 100)) : 0

  const opener = () => tr('Hi! Is this still available?', 'Chào bạn! Món này còn không?')

  // Stash the first message + optional STRUCTURED offer (offerAmount — never a baked
  // text line, so it lands as a proper offer card kind='offer'), then redirect
  // instantly. The /messages/pending resolver posts it and swaps to the real thread.
  const send = (opts: { body?: string; offerAmount?: number | null }) => {
    // Until auth resolves, treat as not-ready: don't push to /messages/pending
    // (which would 401-bounce). Prompt only once we know they're truly logged out.
    if (!user) { if (!loading) openSignIn({ listingTitle, listingImage, sellerName }); return }
    const offerAmount = opts.offerAmount ?? null
    try {
      sessionStorage.setItem(COMPOSE_KEY, JSON.stringify({
        listingId,
        body: (opts.body ?? '').trim(),
        offerAmount,
        listingTitle: listingTitle ?? '',
        listingImage: listingImage ?? null,
        trackPrice: offerAmount ?? (price ?? null),
        currency,
      }))
    } catch { /* storage blocked — the pending page falls back to /messages */ }
    router.push('/messages/pending')
  }

  const chatNow = () => send({ body: opener() })
  const sendOffer = () => { if (canOffer) send({ offerAmount: offerPrice }) }

  // Deep-link (/listings/id#contact): scroll the composer into view. ?offer=N (a card
  // quick-offer) opens straight into offer mode at that discount; a plain #contact
  // just brings Chat now into view — a shared link must NOT auto-fire a message.
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hash !== '#contact') return
    const offerParam = Number(new URLSearchParams(window.location.search).get('offer'))
    // Ignore a stray ?offer= on a fixed-price listing (stale card link) — no offers here.
    const quickOffer = negotiable && Number.isFinite(offerParam) && offerParam >= 1 && offerParam <= MAX_DISCOUNT ? Math.round(offerParam) : null
    const t = window.setTimeout(() => {
      document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (quickOffer != null) { setOffering(true); setDiscount(quickOffer) }
    }, 150)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sticky bar / seller-card actions: "Chat now" sends the opener directly (one tap →
  // live thread); the offer segment opens the slider at its current discount.
  useEffect(() => {
    const onChat = () => chatNow()
    const onOffer = () => { if (canOffer) setOffering(true) }
    window.addEventListener('eno:chat-now', onChat)
    window.addEventListener('eno:open-offer', onOffer)
    return () => {
      window.removeEventListener('eno:chat-now', onChat)
      window.removeEventListener('eno:open-offer', onOffer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canOffer, user, loading])

  // Chat is the SellerCard's "Chat now" (it fires eno:chat-now → send() above), so
  // this composer carries NO second chat button — only the offer flow + a safety line.
  const safetyLine = (
    <p className="text-center text-xs text-muted-foreground">
      {tr('Request their number or Zalo once they reply.', 'Yêu cầu số điện thoại hoặc Zalo sau khi họ trả lời.')}
    </p>
  )

  // Fixed-price listing: nothing to offer → just the reminder under the seller's Chat now.
  if (!canOffer) return safetyLine

  if (!loading && !user) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => openSignIn({ listingTitle, listingImage, sellerName })}
          className="press flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold text-accent-foreground transition-colors hover:bg-tint cursor-pointer"
        >
          <Tag className="h-4 w-4" /> {tr('Sign in to make an offer', 'Đăng nhập để trả giá')}
        </button>
        {safetyLine}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Make an offer — secondary to the SellerCard's "Chat now"; opens the slider. */}
      {!offering && (
        <button
          type="button"
          onClick={() => setOffering(true)}
          className="press flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold text-accent-foreground transition-colors hover:bg-tint cursor-pointer"
        >
          <Tag className="h-4 w-4" /> {tr('Make an offer', 'Trả giá')}
        </button>
      )}

      {offering && (
        <div className="rounded-2xl bg-accent p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-body">{tr('Your offer', 'Giá đề nghị')}</span>
            <button type="button" onClick={() => setOffering(false)} aria-label={tr('Cancel offer', 'Hủy đề nghị')} className="rounded-full p-0.5 text-ink-4 hover:text-foreground cursor-pointer relative tap-44"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-accent-foreground tabular-nums">{formatMoneyFull(offerPrice, currency, locale)}</span>
            <span className="text-xs font-semibold text-muted-foreground">−{discount}%</span>
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
          <Button
            variant="cta"
            size="none"
            onClick={sendOffer}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm transition-all active:scale-98 cursor-pointer"
          >
            <Send className="h-4 w-4" /> {tr('Send offer', 'Gửi đề nghị')} · {formatMoneyFull(offerPrice, currency, locale)}
          </Button>
        </div>
      )}

      {safetyLine}
    </div>
  )
}
