'use client'

import { Heart, MessageCircle, Bell } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'

/**
 * In-grid signup capture (5a #7) — one card slotted into the guest feed at the point
 * of interest. Value-first copy, one tap to the sign-in dialog (Google/phone/email all
 * live there). Renders nothing for signed-in users; the grid slot simply closes up.
 * One-canvas: tinted interactive surface, no border.
 */
export function CaptureCard() {
  const { user, loading, openSignIn } = useAuth()
  const { tr } = useLanguage()
  if (user || loading) return null
  return (
    <div className="flex h-full flex-col rounded-xl bg-tint p-4">
      <p className="text-base font-extrabold leading-snug text-foreground">{tr('Never miss a deal.', 'Đừng bỏ lỡ món hời.')}</p>
      <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-body">
        <li className="flex items-center gap-2"><Heart className="h-3.5 w-3.5 shrink-0 text-accent-foreground" /> {tr('Keep your saved items', 'Giữ tin đã lưu')}</li>
        <li className="flex items-center gap-2"><MessageCircle className="h-3.5 w-3.5 shrink-0 text-accent-foreground" /> {tr('Chat with sellers instantly', 'Nhắn tin ngay với người bán')}</li>
        <li className="flex items-center gap-2"><Bell className="h-3.5 w-3.5 shrink-0 text-accent-foreground" /> {tr('Price-drop & search alerts', 'Báo giá giảm & tin mới')}</li>
      </ul>
      <div className="mt-auto pt-3">
        <Button
          type="button"
          variant="cta"
          size="none"
          onClick={() => openSignIn()}
          className="w-full py-2.5 active:scale-[0.98] cursor-pointer"
        >
          {tr('Continue with Google', 'Tiếp tục với Google')}
        </Button>
        <button
          type="button"
          onClick={() => openSignIn()}
          className="mt-1.5 w-full text-center text-2xs font-bold text-body transition-colors hover:text-accent-foreground cursor-pointer"
        >
          {tr('or email · free, 10 seconds', 'hoặc email · miễn phí, 10 giây')}
        </button>
      </div>
    </div>
  )
}
