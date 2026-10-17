'use client'

import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { ExternalLink } from '@/components/ui/icons'
import { escapeInAppBrowser, type InAppHost } from '@/lib/in-app-browser'
import { countTeacherFormEvent } from '@/lib/signup-counters'

/** Who is offered the way out: Meta's own built-in browsers on a phone (teachers/join/page.tsx decides, on the server). */
export type EscapeOffer = { host: InAppHost; os: 'android' | 'ios' }

/** How long the page may still be in front after the tap before the line says how to do it by hand. */
const STILL_HERE_MS = 1500

/**
 * "OPEN IN YOUR BROWSER" ON teacher.eno.vn's STEP 1, INSIDE FACEBOOK'S, MESSENGER'S OR INSTAGRAM'S BUILT-IN BROWSER (owner,
 * 2026-10-17: "drive them to actual website not in facebook browser"). The bounce study: inside Facebook's browser 2 of
 * 10 teacher sign-ins completed and Google could not finish at all; in a real browser 9 of 10 did.
 * ⛔ SERVER-RENDERED FROM THE USER AGENT, so the first paint already has it and nothing moves when the page hydrates.
 * ⛔ BEFORE ANY ANSWER: it hands this page's own address (with its campaign tags) to the real browser — an Android intent
 * cannot carry the hand-off's `#d=` fragment, so answers would be lost later on (in-app-browser.ts escapeInAppBrowser).
 * The visitor can ignore it and go on here; when the page is still in front a moment after the tap, the app did not let
 * go, and the line says how to leave by hand.
 */
export function OpenInBrowser({ offer }: { offer: EscapeOffer }) {
  const { tr } = useLanguage()
  const [stillHere, setStillHere] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const open = () => {
    countTeacherFormEvent('escape_tap')
    escapeInAppBrowser(window.location.href, offer.host)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { if (document.visibilityState === 'visible') setStillHere(true) }, STILL_HERE_MS)
  }
  // iOS Facebook and Messenger open Safari itself; Instagram and Android open the phone's default browser.
  const label = offer.os === 'ios' && offer.host !== 'instagram'
    ? tr('Open in Safari', 'Mở bằng Safari')
    : tr('Open in your browser', 'Mở bằng trình duyệt')
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-tint p-3.5" data-testid="open-in-browser">
      <p className="min-w-0 flex-1 text-sm text-body">{tr('Signing up is easiest in your browser — Google sign-in works there too.', 'Đăng ký dễ nhất trong trình duyệt — đăng nhập bằng Google cũng dùng được.')}</p>
      <Button variant="cta" size="sm" type="button" onClick={open}>
        <ExternalLink aria-hidden />
        {label}
      </Button>
      {stillHere && (
        <p role="status" className="w-full text-sm text-muted-foreground">{tr('If it did not open: tap ⋯ at the top, then “Open in browser”.', 'Nếu chưa mở: bấm ⋯ ở góc trên, rồi chọn “Mở bằng trình duyệt”.')}</p>
      )}
    </div>
  )
}
