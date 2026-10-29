'use client'

import { useLanguage } from '@/context/language-context'
import { handleExternalClick } from '@/lib/native-browser'

/**
 * A GoPlus room's own page on goplus.com.vn (owner, 2026-10-29: "all goplus apartments should have a link that leads to
 * that apartment in goplus website"). The listing page builds `href` on the server from the row's `goplus:<id>` externalId
 * (goplus-listing.ts goplusRoomPageUrl), on an official partner's storefront only — a flag eno's staff set — and always to
 * goplus.com.vn; never from anything a seller can type. In the app the
 * link opens the in-app browser over eno (native-browser.ts); on the web, a new tab.
 */
export function GoplusRoomLink({ href }: { href: string }) {
  const { tr } = useLanguage()
  return (
    <p className="text-sm text-body">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleExternalClick}
        className="font-semibold text-accent-foreground underline-offset-2 hover:underline"
      >
        {/* "on GoPlus", not "this room": the same link sits on a GoPlus shopfront (commercial space) too. */}
        {tr('View on GoPlus', 'Xem trên GoPlus')}
        <span className="sr-only"> {tr('(opens in a new tab)', '(mở trong tab mới)')}</span>
      </a>
    </p>
  )
}
