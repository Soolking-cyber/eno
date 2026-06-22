'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Tag, X, Loader2 } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useChat } from '@/context/chat-context'
import { VndInput } from './vnd-input'
import { formatMoneyFull, parseVnd } from '@/lib/vnd'
import { trackContactSeller } from '@/lib/analytics'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

/**
 * "Make an offer" — sends a structured offer (a VND price) into the conversation
 * with the seller, who negotiates in chat. Reuses the conversation + message
 * APIs; the seller is notified like any new message. The buyer lands in the thread.
 */
export function OfferButton({ listingId, listingTitle, listingImage, price, currency, compact = false }: { listingId: string; listingTitle?: string; listingImage?: string | null; price: number; currency: string; compact?: boolean }) {
  const { user, loading, openSignIn } = useAuth()
  const { tr, lang } = useLanguage()
  const { cacheThread } = useChat()
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  // Quick presets relative to the asking price (the most useful anchors for an offer).
  const presets = price > 0 ? [
    { label: '−5%', value: Math.round(price * 0.95) },
    { label: '−10%', value: Math.round(price * 0.90) },
    { label: tr('Asking', 'Giá rao'), value: price },
  ] : undefined

  const openModal = () => {
    if (!user && !loading) { openSignIn(); return }
    setAmount(price > 0 ? String(price) : '')
    setOpen(true)
  }

  const send = async () => {
    const n = parseVnd(amount)
    if (!n || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId }),
      })
      if (res.status === 401) { openSignIn(); return }
      if (res.status === 400) {
        const { error } = await res.json().catch(() => ({}))
        toast.error(error === 'own_listing' ? tr("That's your own listing.", 'Đây là tin của chính bạn.') : tr('Could not send offer.', 'Không gửi được đề nghị.'))
        return
      }
      if (!res.ok) { toast.error(tr('Could not send offer.', 'Không gửi được đề nghị.')); return }
      const { id, created } = await res.json()
      // Build the message directly per the buyer's language — never via tr() (it
      // would machine-translate a unique per-amount string and bill for it).
      const label = lang === 'vi' ? 'Đề nghị' : 'Offer'
      const body = `💰 ${label}: ${formatMoneyFull(n, currency)}`
      const m = await fetch(`/api/conversations/${id}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
      })
      if (!m.ok) { toast.error(tr('Could not send offer.', 'Không gửi được đề nghị.')); return }
      const sent = (await m.json().catch(() => null)) as { id: string; body: string; createdAt: string } | null
      // Seed the thread cache so /messages/[id] paints the offer INSTANTLY (no blank
      // load); the page then revalidates counterpart/listing in the background.
      cacheThread(id, {
        id,
        me: user?.id ?? '',
        listing: { id: listingId, title: listingTitle ?? '', image: listingImage ?? null },
        counterpart: { name: '', avatarColor: '#0a66c2', avatarUrl: null },
        messages: sent ? [{ id: sent.id, mine: true, body: sent.body, createdAt: sent.createdAt }] : [],
      })
      if (created) trackContactSeller({ id: listingId, price: n, currency: currency === '₫' ? 'VND' : 'USD' })
      setOpen(false)
      router.push(`/messages/${id}`)
    } catch {
      toast.error(tr('Could not send offer.', 'Không gửi được đề nghị.'))
    } finally {
      setBusy(false)
    }
  }

  const trigger = compact ? (
    <button
      onClick={openModal}
      aria-label={tr('Make an offer', 'Trả giá')}
      className="flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[#0a66c2] px-4 text-sm font-bold text-accent-foreground transition-colors active:scale-95"
    >
      <Tag className="h-4 w-4" /> {tr('Offer', 'Trả giá')}
    </button>
  ) : (
    <button
      onClick={openModal}
      className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#0a66c2] py-2.5 text-sm font-bold text-accent-foreground transition-all hover:bg-accent active:scale-98 cursor-pointer"
    >
      <Tag className="h-4 w-4" /> {tr('Make an offer', 'Trả giá')}
    </button>
  )

  return (
    <>
      {trigger}
      {open && mounted && createPortal(
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onClick={() => !busy && setOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-t-2xl bg-card p-5 shadow-pop sm:rounded-2xl animate-in fade-in slide-in-from-bottom-2 duration-200"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-foreground">{tr('Make an offer', 'Trả giá')}</h2>
              <button onClick={() => setOpen(false)} aria-label={tr('Close', 'Đóng')} className="rounded-full p-1 text-ink-4 hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>

            {price > 0 && (
              <p className="mb-2 text-xs text-muted-foreground">
                {tr('Asking price', 'Giá rao')}: <span className="font-semibold text-foreground">{formatMoneyFull(price, currency)}</span>
              </p>
            )}

            <VndInput value={amount} onChange={setAmount} presets={presets} autoFocus placeholder={tr('Your offer', 'Giá bạn đề nghị')} />

            <button
              onClick={send}
              disabled={!parseVnd(amount) || busy}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0a66c2] py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#004182] disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4" />}
              {tr('Send offer', 'Gửi đề nghị')}
            </button>
            <p className="mt-2 text-center text-[11px] text-ink-4">{tr('The seller can accept or counter in chat.', 'Người bán có thể đồng ý hoặc trả giá lại trong tin nhắn.')}</p>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
