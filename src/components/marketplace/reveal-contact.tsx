'use client'

import { useState } from 'react'
import { MessageCircle, Lock, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { trackContactSeller, type Currency } from '@/lib/analytics'
import { toast } from 'sonner'

/**
 * Messaging-first contact. The seller's number is NEVER on the listing — the
 * buyer messages first, then requests the number/Zalo inside the chat (see
 * ChatThread). Used on the listing detail page, the detail dialog, and (compact)
 * the mobile sticky bar.
 */
export function RevealContact({ listingId, listingTitle, price, currency, compact = false, onStartChat }: { listingId: string; listingTitle?: string; price?: number; currency?: Currency; compact?: boolean; onStartChat?: () => void }) {
  const { user, loading, openSignIn } = useAuth()
  const { tr } = useLanguage()
  const router = useRouter()
  const [msgBusy, setMsgBusy] = useState(false)

  // Create (or reuse) the conversation, then navigate to its full-page thread —
  // canvas, no floating window.
  const onMessage = async () => {
    if (!user && !loading) { openSignIn(); return }
    setMsgBusy(true)
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
      // Count the lead only on a genuinely new conversation (the API is idempotent).
      if (created) trackContactSeller({ id: listingId, title: listingTitle, price, currency })
      onStartChat?.()
      router.push(`/messages/${id}`)
    } catch {
      toast.error(tr('Could not start chat.', 'Không thể bắt đầu trò chuyện.'))
    } finally {
      setMsgBusy(false)
    }
  }

  // ── Logged-out: a single primary "sign in to contact" CTA ──
  if (!loading && !user) {
    if (compact) {
      return (
        <button onClick={() => openSignIn()} className="flex items-center justify-center gap-2 rounded-xl bg-[#0a66c2] px-5 py-2.5 text-sm font-bold text-white">
          <Lock className="h-4 w-4" /> {tr('Sign in', 'Đăng nhập')}
        </button>
      )
    }
    return (
      <button
        onClick={() => openSignIn()}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0a66c2] py-2.5 text-sm font-bold text-white hover:bg-[#004182] active:scale-98 transition-all cursor-pointer"
      >
        <Lock className="h-4 w-4" /> {tr('Sign in to contact seller', 'Đăng nhập để liên hệ người bán')}
      </button>
    )
  }

  // ── Compact (mobile sticky bar): a single full-width Message button ──
  if (compact) {
    return (
      <button onClick={onMessage} disabled={msgBusy} className="flex items-center justify-center gap-2 rounded-xl bg-[#0a66c2] px-6 py-2.5 text-sm font-bold text-white disabled:opacity-60">
        {msgBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />} {tr('Message', 'Nhắn tin')}
      </button>
    )
  }

  // ── Full: Message is the only CTA; number/Zalo are requested inside the chat ──
  return (
    <div className="space-y-2">
      <button
        onClick={onMessage}
        disabled={msgBusy || loading}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0a66c2] py-2.5 text-sm font-bold text-white hover:bg-[#004182] active:scale-98 transition-all cursor-pointer disabled:opacity-60"
      >
        {msgBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />} {tr('Message', 'Nhắn tin')}
      </button>
      <p className="text-center text-xs text-muted-foreground">
        {tr('Message the seller — request their number or Zalo once they reply.', 'Nhắn tin cho người bán — yêu cầu số điện thoại hoặc Zalo sau khi họ trả lời.')}
      </p>
    </div>
  )
}
