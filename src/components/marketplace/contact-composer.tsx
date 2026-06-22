'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Tag, Loader2, Send, X } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useChat } from '@/context/chat-context'
import { trackContactSeller, currencyCode } from '@/lib/analytics'
import { formatMoneyFull } from '@/lib/vnd'
import { toast } from 'sonner'

const MAX_DISCOUNT = 50 // % off the asking price the slider allows

/**
 * Unified contact + offer on the listing detail (replaces the separate Message
 * and Make-an-offer buttons). The buyer types a message OR taps "Make an offer"
 * to reveal a discount slider — drag the % off and the new price shows live as
 * the offer, with an optional note. On send we create the conversation, post the
 * message, SEED the thread cache, and navigate to /messages/[id] (instant paint).
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
  const { cacheThread } = useChat()
  const router = useRouter()
  const [text, setText] = useState('')
  const [offering, setOffering] = useState(false)
  const [discount, setDiscount] = useState(10) // % off
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  const hasPrice = typeof price === 'number' && price > 0
  const offerPrice = hasPrice ? Math.round(price! * (1 - discount / 100)) : 0
  const offerLabel = lang === 'vi' ? 'Đề nghị' : 'Offer'

  // The message body: an offer line (💰 → flagged as an offer for the seller's
  // notification) plus the optional typed note, or just the typed message.
  const buildBody = () => {
    const note = text.trim()
    if (offering && hasPrice) {
      const line = `💰 ${offerLabel}: ${formatMoneyFull(offerPrice, currency)}`
      return note ? `${line}\n${note}` : line
    }
    return note
  }
  const canSend = (offering && hasPrice) || text.trim().length > 0

  const send = async () => {
    if (!canSend || busy) return
    if (!user && !loading) { openSignIn(); return }
    const body = buildBody()
    setBusy(true)
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId }),
      })
      if (res.status === 401) { openSignIn(); return }
      if (res.status === 400) {
        const { error } = await res.json().catch(() => ({}))
        toast.error(error === 'own_listing' ? tr("That's your own listing.", 'Đây là tin của chính bạn.') : tr('Could not start chat.', 'Không thể bắt đầu trò chuyện.'))
        return
      }
      if (!res.ok) { toast.error(tr('Could not start chat.', 'Không thể bắt đầu trò chuyện.')); return }
      const { id, created } = await res.json()

      const mres = await fetch(`/api/conversations/${id}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
      })
      const sent = mres.ok ? ((await mres.json().catch(() => null)) as { id: string; body: string; createdAt: string } | null) : null

      cacheThread(id, {
        id,
        me: user?.id ?? '',
        listing: { id: listingId, title: listingTitle ?? '', image: listingImage ?? null },
        counterpart: { name: '', avatarColor: '#0a66c2', avatarUrl: null },
        messages: sent ? [{ id: sent.id, mine: true, body: sent.body, createdAt: sent.createdAt }] : [],
      })
      if (created) trackContactSeller({ id: listingId, title: listingTitle, price: offering && hasPrice ? offerPrice : price, currency: currencyCode(currency) })
      router.push(`/messages/${id}`)
    } catch {
      toast.error(tr('Could not start chat.', 'Không thể bắt đầu trò chuyện.'))
    } finally {
      setBusy(false)
    }
  }

  // Logged-out → single sign-in CTA.
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
          className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-card px-3 py-1.5 text-xs font-semibold text-body transition-colors hover:border-[#0a66c2] hover:bg-accent hover:text-accent-foreground cursor-pointer"
        >
          <Tag className="h-3.5 w-3.5" /> {tr('Make an offer', 'Trả giá')}
        </button>
      )}

      {/* Offer slider — drag the discount, the new price shows live as the offer. */}
      {hasPrice && offering && (
        <div className="rounded-xl border border-[#0a66c2]/30 bg-accent p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-body">{tr('Your offer', 'Giá đề nghị')}</span>
            <button type="button" onClick={() => setOffering(false)} aria-label={tr('Cancel offer', 'Hủy đề nghị')} className="rounded-full p-0.5 text-ink-4 hover:text-foreground cursor-pointer"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-accent-foreground tabular-nums">{formatMoneyFull(offerPrice, currency)}</span>
            <span className="text-xs font-semibold text-muted-foreground">−{discount}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={MAX_DISCOUNT}
            step={1}
            value={discount}
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
        className="w-full resize-none rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-ink-4 focus:border-[#0a66c2] focus:ring-2 focus:ring-[#0a66c2]/20"
      />

      <button
        onClick={send}
        disabled={!canSend || busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0a66c2] py-2.5 text-sm font-bold text-white transition-all hover:bg-[#004182] active:scale-98 disabled:opacity-40 cursor-pointer"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {offering && hasPrice ? `${tr('Send offer', 'Gửi đề nghị')} · ${formatMoneyFull(offerPrice, currency)}` : tr('Send', 'Gửi')}
      </button>
      <p className="text-center text-xs text-muted-foreground">
        {tr('Request their number or Zalo once they reply.', 'Yêu cầu số điện thoại hoặc Zalo sau khi họ trả lời.')}
      </p>
    </div>
  )
}
