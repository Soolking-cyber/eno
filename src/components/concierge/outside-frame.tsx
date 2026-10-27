'use client'

import { usePathname } from 'next/navigation'
import { isConciergeFramePath } from '@/lib/concierge/client'
import { publicPathname } from '@/lib/lang-variant'

/**
 * Global hosts that belong to the PAGE and never run a second time inside the concierge's window (review, opus): the
 * window is a page of this app (/concierge) mounted in a frame, so without this it would ring calls, register push,
 * count a page view and open the sign-up and cookie prompts in a 192 px square, beside the page doing the same.
 */
export function OutsideConciergeFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return isConciergeFramePath(publicPathname(pathname ?? '')) ? null : <>{children}</>
}
