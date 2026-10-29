'use client'

import { useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { inAppSheetFrame } from '@/lib/app-review-gates'
import { isConciergeFramePath } from '@/lib/concierge/client'
import { publicPathname } from '@/lib/lang-variant'

const noSubscribe = () => () => {}

/**
 * Global hosts that belong to the PAGE and never run a second time inside the concierge's window (review, opus): the
 * window is a page of this app (/concierge) mounted in a frame, so without this it would ring calls, register push,
 * count a page view and open the sign-up and cookie prompts in a 192 px square, beside the page doing the same.
 * The app's page sheet (src/lib/app-sheet.ts) is the same kind of frame, found by its marker rather than its path.
 * The server cannot see that, so these hydrate, run their mount effects ONCE and leave on the next render (review,
 * codex + opus): best effort, not a wall. What makes the once harmless is the head script — the sheet's page has no
 * bridge (APP_SHEET_HEAD_JS hides `window.Capacitor`), so nothing here can reach the phone from it.
 */
export function OutsideConciergeFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const inSheet = useSyncExternalStore(noSubscribe, inAppSheetFrame, () => false)
  return inSheet || isConciergeFramePath(publicPathname(pathname ?? '')) ? null : <>{children}</>
}
