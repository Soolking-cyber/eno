'use client'

import { useRouter } from 'next/navigation'
import { MessageCircle } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { storeMember } from './store-pair'

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
export function StorefrontChatButton({ chatListingId, alone = false }: {
  chatListingId: string | null
  /** No Share beside it (a shop with no handle has no address to hand out): its own width, never the row's (store-pair.ts). */
  alone?: boolean
}) {
  const router = useRouter()
  const { tr } = useLanguage()
  if (!chatListingId) return null
  return (
    <Button
      variant="cta"
      size="none"
      onClick={() => router.push(`/listings/${chatListingId}#contact`)}
      // ⛔ SHARE'S EQUAL, 44px (owner, 2026-11-16 — hub Q21; store-pair.ts): the path storefront's row leads with
      // [Chat now][Share][⋯], as the subdomain storefront's does. It stays the only `variant="cta"` on the row.
      // (history) 2026-08-11 to 2026-11-16 it matched the chip row's rhythm: `rounded-full`, the chips' 28px with a
      // `tap-44 relative` hit area — the `relative` because an unpositioned element's ::before resolves against the
      // nearest positioned ancestor and swallows taps meant for its neighbours. At 44px it needs neither.
      className={cn('press gap-1.5 py-2.5', storeMember(!alone))}
    >
      <MessageCircle className="h-4 w-4" aria-hidden />
      {tr('Chat now', 'Nhắn tin')}
    </Button>
  )
}
