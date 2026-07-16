'use client'

import { Tag, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'

/**
 * Mobile-only fixed action bar for the listing detail page (`lg:hidden`). It keeps the
 * primary conversion CTAs reachable no matter how far the buyer has scrolled — the whole
 * reason the composer no longer needs to sit above the fold on mobile.
 *
 * It owns NO compose logic. "Chat" fires the SAME `eno:chat-now` event the SellerCard's
 * "Chat now" uses, so the single mounted <ContactComposer> sends the canned opener +
 * redirects to the thread (or prompts sign-in for guests) — one shared contact path, one
 * composer mount. (A second ContactComposer would register a second `eno:chat-now`
 * listener and send twice.) "Make offer" just scrolls the always-open offer slider
 * (`#contact`) into view. The page reserves bottom padding on <main> so this bar never
 * covers content, and the global mobile tab-nav hides on the PDP so the two don't stack.
 */
export function PdpMobileBar({ canOffer }: { canOffer: boolean }) {
  const { tr } = useLanguage()
  const chat = () => window.dispatchEvent(new Event('eno:chat-now'))
  const offer = () =>
    document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth', block: 'center' })

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex items-center gap-2 border-t border-border bg-background/95 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-md shadow-[0_-4px_20px_-8px_rgba(0,0,0,0.18)] lg:hidden">
      {canOffer && (
        <Button
          type="button"
          variant="outline"
          onClick={offer}
          className="h-12 flex-1 gap-1.5 rounded-xl text-sm font-semibold"
        >
          <Tag className="h-4 w-4" /> {tr('Make offer', 'Trả giá')}
        </Button>
      )}
      <Button
        type="button"
        variant="cta"
        onClick={chat}
        className="h-12 flex-1 gap-1.5 rounded-xl text-sm"
      >
        <MessageCircle className="h-4 w-4" /> {tr('Chat', 'Nhắn tin')}
      </Button>
    </div>
  )
}
