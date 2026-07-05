'use client'

import { MessageCircle } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Price } from './price'
import { Button } from '@/components/ui/button'

/**
 * Sticky mobile CTA bar on the listing detail (<lg only): price + the contact
 * action always one thumb away — the single highest-traffic path to first
 * contact must survive the long scroll through gallery/description/map (the
 * mobile stack put price+CTA ~4 viewports down). Same geometry as the post
 * wizard's publish bar: background runs to bottom-0 (no gap when the bottom
 * nav auto-hides) while the content is padded up clear of the nav; the page's
 * <main> reserves matching bottom padding. z-30 sits below the photo lightbox
 * (z-[100]) so it never floats over full-screen photos.
 *
 * Signed-in → smooth-scroll to the existing #contact composer and focus it
 * (zero duplicate compose logic). Guest → the sign-in gate with listing
 * context, identical to the composer's own gate.
 */
export function ListingContactBar({
  price, currency, priceUnit, listingTitle, listingImage, sellerName,
}: {
  price: number
  currency: string
  priceUnit: string
  listingTitle?: string
  listingImage?: string | null
  sellerName?: string
}) {
  const { user, loading, openSignIn } = useAuth()
  const { tr } = useLanguage()

  const contact = () => {
    if (!user) { if (!loading) openSignIn({ listingTitle, listingImage, sellerName }); return }
    const el = document.getElementById('contact')
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // Prefill the classic opener (composer ignores it if something's typed), then
    // focus once the scroll settles so the keyboard opens with Send one tap away.
    window.dispatchEvent(new Event('eno:prefill-contact'))
    window.setTimeout(() => el.querySelector('textarea')?.focus({ preventScroll: true }), 350)
  }

  return (
    <div data-fab-clear className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 pt-2.5 pb-[calc(4.75rem+env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <Price price={price} currency={currency} priceUnit={priceUnit} className="min-w-0 truncate text-lg font-bold text-foreground tracking-tight" />
        <Button variant="cta" size="none" onClick={contact} className="flex shrink-0 items-center gap-2 rounded-xl px-5 py-2.5 text-sm transition-all active:scale-98 cursor-pointer">
          <MessageCircle className="h-4 w-4" />
          {tr('Contact seller', 'Liên hệ người bán')}
        </Button>
      </div>
    </div>
  )
}
