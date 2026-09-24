'use client'

import { Heart, MessageCircle, Bell } from '@/components/ui/icons'
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
      {/* ⚠️ ROOM TO BREATHE AND ROOM TO TAP. In a two-column feed on a 390px phone the card is
          ~147px inside its padding: the 148px 'Continue with Google' label touched both edges of its
          pill (the pill has no padding of its own at size="none"), and the email link under it was a
          147×15 strip of 10px text. The CTA now keeps 8px a side and wraps rather than kiss the
          edge; the link is a 44px row with its text centred in it.
          ⚠️ THE CARD SETS ITS FEED ROW'S HEIGHT (it is already the tallest item in that row), so every
          px added here stretches the listing card beside it. The email row therefore drops its
          `mt-1.5` (its 44px box already carries ~14px of air above the text) and borrows 8px of the
          card's bottom padding (`-mb-2`) — the target grows, the row grows as little as it can. */}
      <div className="mt-auto pt-3">
        <Button
          type="button"
          variant="cta"
          size="none"
          onClick={() => openSignIn()}
          className="w-full whitespace-normal px-2 py-2.5 text-center active:scale-[0.96] cursor-pointer"
        >
          {tr('Continue with Google', 'Tiếp tục với Google')}
        </Button>
        <Button
          type="button"
          variant="bare"
          size="none"
          onClick={() => openSignIn()}
          className="-mb-2 flex min-h-11 w-full items-center justify-center whitespace-normal text-center text-2xs font-bold text-body transition-colors hover:text-accent-foreground active:scale-100 cursor-pointer"
        >
          {tr('or email · free, 10 seconds', 'hoặc email · miễn phí, 10 giây')}
        </Button>
      </div>
    </div>
  )
}
