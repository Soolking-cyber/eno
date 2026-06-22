'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Tag, Send, X } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { formatMoneyFull } from '@/lib/vnd'

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
  listingId, listingTitle, listingImage, price, currency,
}: {
  listingId: string
  listingTitle?: string
  listingImage?: string | null
  price?: number
  currency: string // raw listing currency, e.g. '₫'
}) {
  const { user, loading, openSignIn } = useAuth()
  const { tr, lang } = useLanguage()
  const router = useRouter()
  const [text, setText] = useState('')
  const [offering, setOffering] = useState(false)
  const [discount, setDiscount] = useState(10) // % off
  const ref = useRef<HTMLTextAreaElement>(null)

  const hasPrice = typeof price === 'number' && price > 0
  const offerPrice = hasPrice ? Math.round(price! * (1 - discount / 100)) : 0
  const offerLabel = lang === 'vi' ? 'Đề nghị' : 'Offer'

  const buildBody = () => {
    const note = text.trim()
    if (offering && hasPrice) {
      const line = `💰 ${offerLabel}: ${formatMoneyFull(offerPrice, currency)}`
      return note ? `${line}\n${note}` : line
    }
    return note
  }
  const canSend = (offering && hasPrice) || text.trim().length > 0

  const send = () => {
    if (!canSend) return
    if (!user && !loading) { openSignIn(); return }
    // Stash the message + context and redirect immediately — the /messages/pending
    // resolver creates the thread and sends in the background, then swaps to it.
    try {
      sessionStorage.setItem(COMPOSE_KEY, JSON.stringify({
        listingId,
        body: buildBody(),
        listingTitle: listingTitle ?? '',
        listingImage: listingImage ?? null,
        trackPrice: offering && hasPrice ? offerPrice : (price ?? null),
        currency,
      }))
    } catch { /* storage blocked — the pending page falls back to /messages */ }
    router.push('/messages/pending')
  }

  if (!loading && !user) {
    return (
      <button onClick={() => openSignIn()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0a66c2] py-2.5 text-sm font-bold text-white transition-all hover:bg-[#004182] active:scale-98 cursor-pointer">
        <Lock className="h-4 w-4" /> {tr('Sign in to contact seller', 'Đăng nhập để liên hệ người bán')}
      </button>
    )
  }

  return (
    <div className="space-y-2">
      {hasPrice && !offering && (
        <button
          type="button"
          onClick={() => { setOffering(true); setTimeout(() => ref.current?.focus(), 0) }}
          className="inline-flex items-center gap-1.5 rounded-full bg-tint px-3 py-1.5 text-xs font-semibold text-body transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer"
        >
          <Tag className="h-3.5 w-3.5" /> {tr('Make an offer', 'Trả giá')}
        </button>
      )}

      {hasPrice && offering && (
        <div className="rounded-xl bg-accent p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-body">{tr('Your offer', 'Giá đề nghị')}</span>
            <button type="button" onClick={() => setOffering(false)} aria-label={tr('Cancel offer', 'Hủy đề nghị')} className="rounded-full p-0.5 text-ink-4 hover:text-foreground cursor-pointer"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-accent-foreground tabular-nums">{formatMoneyFull(offerPrice, currency)}</span>
            <span className="text-xs font-semibold text-muted-foreground">−{discount}%</span>
          </div>
          <input
            type="range" min={0} max={MAX_DISCOUNT} step={1} value={discount}
            onChange={(e) => setDiscount(Number(e.target.value))}
            aria-label={tr('Discount', 'Mức giảm')}
            className="mt-2 w-full cursor-pointer accent-[#0a66c2]"
          />
          <div className="flex justify-between text-[10px] font-medium text-ink-4">
            <span>{tr('Asking', 'Giá rao')}: {formatMoneyFull(price!, currency)}</span>
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
        className="w-full resize-none rounded-xl bg-tint px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-ink-4 focus:ring-2 focus:ring-ring/30"
      />

      <button
        onClick={send}
        disabled={!canSend}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0a66c2] py-2.5 text-sm font-bold text-white transition-all hover:bg-[#004182] active:scale-98 disabled:opacity-40 cursor-pointer"
      >
        <Send className="h-4 w-4" />
        {offering && hasPrice ? `${tr('Send offer', 'Gửi đề nghị')} · ${formatMoneyFull(offerPrice, currency)}` : tr('Send', 'Gửi')}
      </button>
      <p className="text-center text-xs text-muted-foreground">
        {tr('Request their number or Zalo once they reply.', 'Yêu cầu số điện thoại hoặc Zalo sau khi họ trả lời.')}
      </p>
    </div>
  )
}
