'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Tag, Loader2, Send } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useChat } from '@/context/chat-context'
import { trackContactSeller, type Currency } from '@/lib/analytics'
import { toast } from 'sonner'

/**
 * Unified contact + offer on the listing detail (replaces the separate Message
 * and Make-an-offer buttons). The buyer types a message OR taps "Make an offer"
 * to prefill an offer line and fills the amount, then sends. On send we create
 * the conversation, post the message, SEED the thread cache, and navigate to
 * /messages/[id] — which paints instantly from that cache (no blank load).
 */
export function ContactComposer({
  listingId, listingTitle, listingImage, price, currency,
}: {
  listingId: string
  listingTitle?: string
  listingImage?: string | null
  price?: number
  currency?: Currency
}) {
  const { user, loading, openSignIn } = useAuth()
  const { tr, lang } = useLanguage()
  const { cacheThread } = useChat()
  const router = useRouter()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  // Prefill an offer line (💰 prefix → the seller's notification is flagged as an
  // offer), then focus so the buyer just types the amount.
  const addOffer = () => {
    const prefix = `💰 ${lang === 'vi' ? 'Đề nghị' : 'Offer'}: `
    setText((t) => (t.startsWith('💰') ? t : prefix + t))
    setTimeout(() => { const el = ref.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } }, 0)
  }

  const send = async () => {
    const body = text.trim()
    if (!body || busy) return
    if (!user && !loading) { openSignIn(); return }
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

      // Seed the thread cache so the destination paints the message instantly.
      cacheThread(id, {
        id,
        me: user?.id ?? '',
        listing: { id: listingId, title: listingTitle ?? '', image: listingImage ?? null },
        counterpart: { name: '', avatarColor: '#0a66c2', avatarUrl: null },
        messages: sent ? [{ id: sent.id, mine: true, body: sent.body, createdAt: sent.createdAt }] : [],
      })
      if (created) trackContactSeller({ id: listingId, title: listingTitle, price, currency })
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
      <button
        type="button"
        onClick={addOffer}
        className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-card px-3 py-1.5 text-xs font-semibold text-body transition-colors hover:border-[#0a66c2] hover:bg-accent hover:text-accent-foreground cursor-pointer"
      >
        <Tag className="h-3.5 w-3.5" /> {tr('Make an offer', 'Trả giá')}
      </button>

      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        rows={2}
        placeholder={tr('Message the seller…', 'Nhắn tin cho người bán…')}
        className="w-full resize-none rounded-xl border border-line-strong bg-card px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-ink-4 focus:border-[#0a66c2] focus:ring-2 focus:ring-[#0a66c2]/20"
      />

      <button
        onClick={send}
        disabled={!text.trim() || busy}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0a66c2] py-2.5 text-sm font-bold text-white transition-all hover:bg-[#004182] active:scale-98 disabled:opacity-40 cursor-pointer"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {tr('Send', 'Gửi')}
      </button>
      <p className="text-center text-xs text-muted-foreground">
        {tr('Request their number or Zalo once they reply.', 'Yêu cầu số điện thoại hoặc Zalo sau khi họ trả lời.')}
      </p>
    </div>
  )
}
