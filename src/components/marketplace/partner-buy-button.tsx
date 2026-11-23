'use client'

import { Button } from '@/components/ui/button'
import { ShoppingBag } from '@/components/ui/icons'
import { useLanguage } from '@/context/language-context'
import { handleExternalClick } from '@/lib/native-browser'

/**
 * "Buy now" — under the buy-now welcome and the shop's "Buy now" line (src/lib/partner-welcome-line.ts isPartnerBuyMessage), on
 * both sides of the thread (owner, 2026-11-23: "the link non suspicious looking official looking … or just click here to buy").
 * A button, never the raw link: the address (the thread payload's `buyUrl`, src/lib/partner-buy.ts) is only its href. In the
 * app it opens the in-app browser over eno (native-browser.ts); on the web, a new tab. `sponsored nofollow`: a paid link.
 */
export function PartnerBuyButton({ href }: { href: string }) {
  const { tr } = useLanguage()
  return (
    <div className="mt-1 flex items-center gap-2 px-1">
      <Button size="sm" variant="cta" asChild>
        <a href={href} target="_blank" rel="noopener noreferrer sponsored nofollow" onClick={handleExternalClick}>
          <ShoppingBag className="h-4 w-4" /> {tr('Buy now', 'Mua ngay')}
          <span className="sr-only"> {tr('(opens in a new tab)', '(mở trong tab mới)')}</span>
        </a>
      </Button>
    </div>
  )
}
