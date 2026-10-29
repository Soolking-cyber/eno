'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { useLanguage } from '@/context/language-context'
import { appReviewGate, isNativeAppClient } from '@/lib/app-review-gates'
import {
  APP_SHEET_EVENT, APP_SHEET_EXTERNAL_EVENT, APP_SHEET_FRAME_ATTR, appSheetUrl, inAppSheetFrame, isPhoneScheme, leavesThroughApp, openAppSheet,
  samePageHash, setAppSheetReady,
} from '@/lib/app-sheet'
import { useBackToClose } from '@/lib/back-to-close'
import { isNativeShell, openExternal } from '@/lib/native-browser'

/** The link a click lands on, if it is a plain primary click on an <a href> (never a modified or middle click). */
function plainLinkClick(e: MouseEvent): HTMLAnchorElement | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null
  const a = (e.target as Element | null)?.closest?.('a[href]')
  return a instanceof HTMLAnchorElement && !a.hasAttribute('download') ? a : null
}

const opensNewWindow = (a: HTMLAnchorElement) => {
  const t = (a.getAttribute('target') || '').toLowerCase()
  return t !== '' && t !== '_self' && t !== '_top' && t !== '_parent'
}

/**
 * INSIDE the sheet: take the click first. Its own <Link>s must not client-navigate (a joint-history entry Back would
 * walk before the sheet closes), so the default goes at once, before React's handlers; a handler that still calls
 * preventDefault (an in-page modal) is recorded through the event's own preventDefault and wins. The price, accepted for
 * the frame's content pages: a handler that first checks `defaultPrevented` sees the click as taken (review, opus).
 */
function claimFirst(e: MouseEvent, act: () => void): void {
  const own = MouseEvent.prototype.preventDefault.bind(e)
  let theirs = false
  Object.defineProperty(e, 'preventDefault', { configurable: true, value: () => { theirs = true; own() } })
  own()
  setTimeout(() => { if (!theirs) act() }, 0)
}

/**
 * In the APP's main frame: take the click LAST — only if no other handler took it. Decided when the click reaches the
 * window at the end of its bubble, so every handler (React's included) has seen an untouched event and may claim it
 * its own way, `if (e.defaultPrevented) return` or not (review, codex). A handler that stops propagation keeps the
 * click entirely and the link takes its old way out — predictable, and only admin queues do it.
 */
function claimLast(e: MouseEvent, act: () => void): void {
  const atWindow = (ev: Event) => {
    if (ev !== e) return
    window.removeEventListener('click', atWindow)
    if (e.defaultPrevented) return
    e.preventDefault()
    setTimeout(act, 0)
  }
  window.addEventListener('click', atWindow)
  // A dispatch that never reaches the window (propagation stopped) leaves nothing behind.
  setTimeout(() => window.removeEventListener('click', atWindow), 0)
}

/** The page's own name for the sheet's title: the document title without the site's suffix. */
const pageTitle = (title: string) => title.split(/\s+[|·–—]\s+/)[0]?.trim() || ''

/**
 * The app's page sheet (src/lib/app-sheet.ts has the rule and the why). Mounted once, in providers.tsx.
 *
 * · In the APP's main frame: a new-window link to an eno page opens here, over the screen, instead of leaving for
 *   Safari or the in-app browser (see `claimLast` for which handler wins a click).
 * · INSIDE the sheet's frame: every eno link — a #section one too — REPLACES the frame's page (no joint-history entry,
 *   so after any link Back and "Done" close the sheet in one step; a page's own router.push or form could still add
 *   one, which Back then walks first, as in any browser) and everything else is handed to the main frame, which has
 *   the bridge for the in-app browser (src/lib/native-browser.ts openExternal).
 * · On the web, and in the frame itself, it renders nothing.
 */
export function AppSheetHost() {
  const { tr } = useLanguage()
  const pathname = usePathname()
  const [url, setUrl] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (inAppSheetFrame()) {
      const onClick = (e: MouseEvent) => {
        const a = plainLinkClick(e)
        if (!a) return
        // A #section link scrolls in place — REPLACING the frame's entry, so the sheet never grows a history of its own
        // for Back to walk through before it closes (review, codex + opus).
        if (samePageHash(a.href, window.location.href)) { const to = a.href; claimFirst(e, () => window.location.replace(to)); return }
        const sheet = appSheetUrl(a.href, window.location.href)
        const href = a.href
        if (sheet) claimFirst(e, () => window.location.replace(sheet))
        else if (leavesThroughApp(href, window.location.href)) {
          claimFirst(e, () => window.parent.dispatchEvent(new CustomEvent<string>(APP_SHEET_EXTERNAL_EVENT, { detail: href })))
        }
      }
      document.addEventListener('click', onClick, true)
      return () => document.removeEventListener('click', onClick, true)
    }
    // The app's main frame only — never another frame of the app's pages (the concierge's window, /concierge). The
    // switch is `app-signin-tidy`, the gate that already sent first-party pages to a sheet: off, every link takes its
    // old way out again (review, opus — a kill switch for a change every installed binary gets at once).
    if (window.top !== window || !appReviewGate('app-signin-tidy') || (!isNativeShell() && !isNativeAppClient())) return
    const onClick = (e: MouseEvent) => {
      const a = plainLinkClick(e)
      if (!a || !opensNewWindow(a) || samePageHash(a.href, window.location.href)) return
      const sheet = appSheetUrl(a.href, window.location.href)
      if (sheet) claimLast(e, () => openAppSheet(sheet))
    }
    const onOpen = (e: Event) => {
      const next = (e as CustomEvent<string>).detail
      if (typeof next !== 'string' || !next) return
      setTitle('')
      setLoading(true)
      setUrl(next)
    }
    // A link the sheet's page hands up (leavesThroughApp): another site goes where the app sends every other site, and
    // a tel:/mailto: link becomes a main-frame navigation, which both shells give to the phone.
    const onExternal = (e: Event) => {
      const href = (e as CustomEvent<string>).detail
      if (typeof href !== 'string' || !href) return
      if (/^https?:/i.test(href)) void openExternal(href)
      else if (isPhoneScheme(href)) window.location.href = href // never a script URL — openExternal hands up whatever it was given
    }
    document.addEventListener('click', onClick, true)
    window.addEventListener(APP_SHEET_EVENT, onOpen)
    window.addEventListener(APP_SHEET_EXTERNAL_EVENT, onExternal)
    setAppSheetReady(true)
    return () => {
      setAppSheetReady(false)
      document.removeEventListener('click', onClick, true)
      window.removeEventListener(APP_SHEET_EVENT, onOpen)
      window.removeEventListener(APP_SHEET_EXTERNAL_EVENT, onExternal)
    }
  }, [])

  const close = useCallback(() => setUrl(null), [])
  const { release } = useBackToClose(url !== null, close, 'app-sheet')

  // The screen underneath moved on (a sign-in that finished, a redirect): the sheet belonged to the old one. Its entry
  // is left for that navigation to replace, never popped under it (back-to-close.ts `release`).
  const openedOn = useRef(pathname)
  useEffect(() => {
    if (url === null) { openedOn.current = pathname; return }
    if (openedOn.current !== pathname) { release(); setUrl(null) }
  }, [pathname, url, release])

  const onLoad = () => {
    setLoading(false)
    // A page the frame cannot read (it redirected off this origin) still gets a name, never "Loading…" for good.
    let name = ''
    try { name = pageTitle(frameRef.current?.contentDocument?.title ?? '') } catch { /* not ours */ }
    setTitle(name || 'eno')
  }

  if (url === null) return null
  return (
    <Sheet open onOpenChange={(open) => { if (!open) setUrl(null) }}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        swipeToDismiss
        className="gap-0 overflow-hidden rounded-t-2xl p-0 data-[side=bottom]:h-[calc(100dvh-max(env(safe-area-inset-top),var(--safe-area-inset-top,0px))-0.75rem)]"
      >
        <div className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          <SheetTitle className="min-w-0 flex-1 truncate text-base font-semibold">{title || tr('Loading…', 'Đang tải…')}</SheetTitle>
          <SheetClose className="-mr-2 min-h-11 shrink-0 cursor-pointer px-2 font-semibold text-accent-foreground">{tr('Done', 'Xong')}</SheetClose>
        </div>
        <div className="relative min-h-0 flex-1">
          {loading && <div className="absolute inset-0 grid place-items-center" aria-hidden><Spinner size="md" /></div>}
          <iframe
            ref={frameRef}
            key={url}
            src={url}
            title={title || tr('Page', 'Trang')}
            {...{ [APP_SHEET_FRAME_ATTR]: '' }}
            onLoad={onLoad}
            className="block h-full w-full border-0 bg-background"
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
