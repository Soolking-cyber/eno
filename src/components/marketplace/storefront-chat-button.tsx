'use client'

import { useRouter } from 'next/navigation'
import { MessageCircle } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'

/**
 * The storefront's "Chat now", lifted OUT of SellerCard so it can share a row with the
 * identity chips (owner, 2026-08-11: combine those two lines, mobile and desktop).
 *
 * ⚠️ THE CARD'S OWN CTA MUST BE SUPPRESSED WHEREVER THIS IS USED, or the page renders two.
 * SellerCard hides its primary button when `onChat` is omitted, which is exactly what
 * `chatListingId={null}` achieves through StorefrontSellerCard — that is the mechanism, not
 * a coincidence, so the two call sites belong together.
 *
 * The navigation is copied verbatim from StorefrontSellerCard: push to the anchor listing's
 * PDP contact anchor. It stays a client leaf for the same reason that wrapper exists — the
 * storefront itself is a server component and cannot hand down a callback.
 */
export function StorefrontChatButton({ chatListingId }: { chatListingId: string | null }) {
  const router = useRouter()
  const { tr } = useLanguage()
  if (!chatListingId) return null
  return (
    <Button
      variant="cta"
      size="none"
      onClick={() => router.push(`/listings/${chatListingId}#contact`)}
      // Matches the chip row's rhythm rather than the card's full-width CTA: `rounded-full`
      // and the chips' vertical padding, so the row reads as one band of controls instead of
      // a button that wandered in. It stays the only `variant="cta"` on the row, which is what
      // keeps it obviously primary next to two quiet chips.
      // ⚠️ `tap-44 relative` IS REQUIRED, AND THE `relative` IS HALF OF IT. Sizing this to the
      // chip row makes it 28px tall — measured — and 28px is well under the touch minimum for
      // what is the storefront's PRIMARY action. tap-44 grows the HIT AREA to 44px via an
      // absolutely-positioned ::before while leaving the visual at chip height.
      // The `relative` is not decoration: on an UNPOSITIONED element that pseudo-element
      // resolves against the nearest positioned ANCESTOR instead, so it silently covers a
      // chunk of the row and starts swallowing taps meant for the chips beside it. That trap
      // is already recorded in this codebase; ReportButton on this same row carries the pair
      // for the same reason.
      className="tap-44 relative gap-1.5 rounded-full px-4 py-1.5 text-xs"
    >
      <MessageCircle className="h-3.5 w-3.5" aria-hidden />
      {tr('Chat now', 'Nhắn tin')}
    </Button>
  )
}
