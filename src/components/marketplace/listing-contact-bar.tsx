'use client'

import { MessageCircle } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useCurrency } from '@/context/currency-context'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'

/**
 * Sticky mobile CTA bar on the listing detail (<lg only), Shopee-style two
 * segments: a quiet Chat segment and a solid primary action ("Make offer ·
 * {price}" on negotiable listings, "Contact seller" on fixed price). The
 * single highest-traffic path to first contact must survive the long scroll
 * through gallery/description/map. Same geometry as before: background runs
 * to bottom-0 (no gap when the bottom nav auto-hides) while the 52px segment
 * row is padded up clear of the nav (h-16 = 4rem — segments sit flush on its
 * top edge); the page's <main> reserves matching bottom padding. z-30 sits
 * below the photo lightbox (z-[100]) so it never floats over full-screen
 * photos.
 *
 * Signed-in → smooth-scroll to the existing #contact composer and hand it the
 * intent via an event ('eno:prefill-contact' for chat, 'eno:open-offer' for
 * offer mode at the slider's default 10%) — zero duplicate compose/offer
 * logic lives here. Guest → the sign-in gate with listing context, identical
 * to the composer's own gate.
 */
export function ListingContactBar({
  price, currency, listingTitle, listingImage, sellerName, negotiable = true,
}: {
  price: number
  currency: string
  listingTitle?: string
  listingImage?: string | null
  sellerName?: string
  negotiable?: boolean
}) {
  const { user, loading, openSignIn } = useAuth()
  const { lang, tr } = useLanguage()
  const { format } = useCurrency()
  const locale = moneyLocale(lang)

  const goToComposer = (intent: 'eno:prefill-contact' | 'eno:open-offer') => {
    if (!user) { if (!loading) openSignIn({ listingTitle, listingImage, sellerName }); return }
    const el = document.getElementById('contact')
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // Hand the composer the intent (it ignores a prefill if something's typed),
    // then focus once the scroll settles so the keyboard opens with Send one
    // tap away.
    window.dispatchEvent(new Event(intent))
    window.setTimeout(() => el.querySelector('textarea')?.focus({ preventScroll: true }), 350)
  }

  // Offers need a negotiable, priced listing — same rule as the composer.
  const canOffer = negotiable && price > 0
  // Asking price in the viewer's display currency + number locale (mirrors <Price>;
  // the rare non-VND listing shows unconverted in its own currency).
  const askLabel = currency === '₫' ? format(price, locale) : formatMoneyFull(price, currency, locale)

  return (
    <div data-fab-clear className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[calc(4rem+env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
      {/* Edge-to-edge segment row: no gutter, no gap, no radius between segments. */}
      <div className="mx-auto flex h-[52px] max-w-7xl items-stretch">
        <button
          type="button"
          onClick={() => goToComposer('eno:prefill-contact')}
          className="flex w-[35%] shrink-0 flex-col items-center justify-center gap-1 bg-tint text-accent-foreground transition-colors active:bg-muted cursor-pointer"
        >
          <MessageCircle className="h-5 w-5" />
          <span className="text-[11px] font-semibold leading-none">{tr('Chat', 'Chat')}</span>
        </button>
        <button
          type="button"
          onClick={() => goToComposer(canOffer ? 'eno:open-offer' : 'eno:prefill-contact')}
          className="flex w-[65%] items-center justify-center bg-primary px-3 text-sm font-bold text-white transition-opacity active:opacity-90 cursor-pointer"
        >
          {canOffer ? (
            <span className="truncate tabular-nums">{tr('Make offer', 'Trả giá')} · {askLabel}</span>
          ) : (
            tr('Contact seller', 'Liên hệ người bán')
          )}
        </button>
      </div>
    </div>
  )
}
