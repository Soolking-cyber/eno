'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Tag, Send, X } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { EnoSlider } from './eno-slider'
import { Button } from '@/components/ui/button'

const MAX_DISCOUNT = 50 // % off the asking price the slider allows
export const COMPOSE_KEY = 'eno-compose' // sessionStorage handoff → /messages/pending

/**
 * Unified contact + offer on the listing detail (replaces the separate Message
 * and Make-an-offer buttons). Type a message OR tap "Make an offer" to drag a
 * discount slider (new price shows live), plus an optional note. On send we
 * REDIRECT INSTANTLY to /messages/pending (no button spinner); that resolver
 * creates the conversation + posts the message in the background and swaps to the
 * real thread. "Redirect first, load in background."
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
  negotiable?: boolean // false = fixed price → no offer control (ask + buy directly)
}) {
  const { user, loading, openSignIn } = useAuth()
  const { lang, tr } = useLanguage()
  const locale = moneyLocale(lang) // offer amounts follow the viewer's language
  const router = useRouter()
  const [text, setText] = useState('')
  const [offering, setOffering] = useState(false)
  const [discount, setDiscount] = useState(10) // % off
  const ref = useRef<HTMLTextAreaElement>(null)

  // Arriving via a quick-chat link (/listings/id#contact) = intent to talk: scroll
  // the composer into view, prefill the opener, focus. Same one-tap-send promise as
  // the sticky bar's Contact button.
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hash !== '#contact') return
    // A card quick-offer arrives as ?offer=N — open straight into offer mode with
    // that discount slid in; otherwise prefill the classic chat opener.
    const offerParam = Number(new URLSearchParams(window.location.search).get('offer'))
    // Ignore a stray ?offer= on a fixed-price listing (e.g. a stale card link) — the
    // seller takes no offers, so fall through to the plain "is this available?" opener.
    const quickOffer = negotiable && Number.isFinite(offerParam) && offerParam >= 1 && offerParam <= MAX_DISCOUNT ? Math.round(offerParam) : null
    const t = window.setTimeout(() => {
      document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (quickOffer != null) {
        setOffering(true)
        setDiscount(quickOffer)
      } else {
        setText((cur) => cur.trim() ? cur : tr('Hi! Is this still available?', 'Chào bạn! Món này còn không?'))
      }
      window.setTimeout(() => ref.current?.focus({ preventScroll: true }), 350)
    }, 150)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // "Contact seller" (sticky bar) prefills the classic opener so sending is one tap —
  // an empty composer is where chats stall. Never overwrites anything already typed.
  useEffect(() => {
    const onPrefill = () => {
      setText((cur) => cur.trim() ? cur : tr('Hi! Is this still available?', 'Chào bạn! Món này còn không?'))
    }
    window.addEventListener('eno:prefill-contact', onPrefill)
    return () => window.removeEventListener('eno:prefill-contact', onPrefill)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Offers are only possible on a negotiable, priced listing.
  const hasPrice = typeof price === 'number' && price > 0
  const canOffer = hasPrice && negotiable
  const offerPrice = hasPrice ? Math.round(price! * (1 - discount / 100)) : 0

  // "Make offer" (sticky bar segment) opens the composer straight in offer mode —
  // slider stays at its default 10% (or wherever the buyer already dragged it).
  useEffect(() => {
    const onOffer = () => { if (canOffer) setOffering(true) }
    window.addEventListener('eno:open-offer', onOffer)
    return () => window.removeEventListener('eno:open-offer', onOffer)
  }, [canOffer])

  const canSend = (offering && canOffer) || text.trim().length > 0

  const send = () => {
    if (!canSend) return
    // Until auth resolves, treat as not-ready: don't push to /messages/pending
    // (which would 401-bounce and lose the typed message). Prompt only once we know
    // they're truly logged out.
    if (!user) { if (!loading) openSignIn({ listingTitle, listingImage, sellerName }); return }
    // Stash a STRUCTURED offer (offerAmount) + optional note — never a baked text
    // line — so the first message lands as a proper offer card (kind='offer'),
    // identical to in-thread offers. The /messages/pending resolver posts it and
    // swaps to the real thread.
    const offerAmount = offering && canOffer ? offerPrice : null
    try {
      sessionStorage.setItem(COMPOSE_KEY, JSON.stringify({
        listingId,
        body: text.trim(),
        offerAmount,
        listingTitle: listingTitle ?? '',
        listingImage: listingImage ?? null,
        trackPrice: offerAmount ?? (price ?? null),
        currency,
      }))
    } catch { /* storage blocked — the pending page falls back to /messages */ }
    router.push('/messages/pending')
  }

  if (!loading && !user) {
    return (
      <Button variant="cta" size="none" onClick={() => openSignIn({ listingTitle, listingImage, sellerName })} className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm transition-all active:scale-98 cursor-pointer">
        <Lock className="h-4 w-4" /> {tr('Sign in to contact seller', 'Đăng nhập để liên hệ người bán')}
      </Button>
    )
  }

  return (
    <div className="space-y-2">
      {canOffer && !offering && (
        <button
          type="button"
          onClick={() => { setOffering(true); setTimeout(() => ref.current?.focus(), 0) }}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-accent-foreground transition-colors hover:bg-muted cursor-pointer"
        >
          <Tag className="h-3.5 w-3.5" /> {tr('Make an offer', 'Trả giá')}
        </button>
      )}

      {canOffer && offering && (
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
          <div className="flex justify-between text-[10px] font-medium text-ink-4">
            <span>{tr('Asking', 'Giá rao')}: {formatMoneyFull(price!, currency, locale)}</span>
            <span>−{MAX_DISCOUNT}%</span>
          </div>
        </div>
      )}

      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        rows={2}
        placeholder={offering ? tr('Add a note (optional)…', 'Thêm ghi chú (không bắt buộc)…') : tr('Message the seller…', 'Nhắn tin cho người bán…')}
        className="w-full resize-none rounded-xl px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-ink-4 hover:bg-muted focus:bg-muted"
      />

      <Button
        variant="cta"
        size="none"
        onClick={send}
        disabled={!canSend}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm transition-all active:scale-98 disabled:opacity-40 cursor-pointer"
      >
        <Send className="h-4 w-4" />
        {offering && canOffer ? `${tr('Send offer', 'Gửi đề nghị')} · ${formatMoneyFull(offerPrice, currency, locale)}` : tr('Send', 'Gửi')}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        {tr('Request their number or Zalo once they reply.', 'Yêu cầu số điện thoại hoặc Zalo sau khi họ trả lời.')}
      </p>
    </div>
  )
}
