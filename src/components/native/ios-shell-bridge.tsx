'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useLanguage } from '@/context/language-context'

/**
 * ⛔ THE iOS 1.2 SHELL'S NATIVE CHROME READS THE WEB, NEVER REPLACES IT (owner, 2026-11-23: "make ios app more native" — native
 * tab bar, page transitions, long-press previews, fast launch; the 2026-07 rule stands: the app MIRRORS the web app).
 *
 * The shell announces what it draws with a document-start script, `window.__enoShell` (MainViewController + EnoShell.swift),
 * which no older binary sets — so every line below is inert on the web, on Android and in iOS 1.1. The head script turns the
 * same flags into `native-tabbar` / `native-menus` on <html> before first paint (layout.tsx).
 *
 * · TABS. The web bottom nav keeps its place and its layout (globals.css `html.native-tabbar .mobile-nav`: invisible, never
 *   display:none), so no page's spacing moves. The native UITabBar is a skin over it: this posts `enoTabs` with what the web
 *   nav shows — each tab's own label (any of the 11 languages), which one is current, its count badge, and whether the web
 *   nav is on screen at all (a page that hides it hides the native one) — and a native tap CLICKS the web tab, so guest
 *   gates, sign-in notes and tap-again-to-top stay the web's.
 * · NAV. `arm` on a tap that may navigate (the shell pictures the screen then, before anything can change), `commit` once a
 *   new path has rendered, with `pop` when a history step (Back) brought it. The shell slides only a commit that follows an
 *   arm by a beat: a tap that navigates nowhere (a guest gate, a sheet) lets its arm expire, a native tab tap never arms
 *   (tabs switch, they do not push), and a touch that starts on the left edge — iOS's own swipe-back, which WebKit already
 *   animates — never arms either. (Not a click "intent": a capture listener cannot see a later preventDefault — review.)
 * · MENUS. A long-press on a listing card: the shell asks `__enoCardAt()` for the card under the last touch — its box (the
 *   preview is a picture of the web's own card), link, saved state and the action labels in the page's language — and
 *   sends the chosen action back as `eno:native-card`.
 */
type Shell = { tabs?: number; nav?: number; menus?: number; photos?: number; spotlight?: number }
type Handler = { postMessage: (body: unknown) => void }

/**
 * ⛔ iOS 1.3: A LISTING'S PHOTOS OPEN IN THE NATIVE VIEWER (owner, 2026-11-23: "make it super native" → native photo viewer).
 * Called by listing-gallery's openAt before its own lightbox: when the shell draws photos (`__enoShell.photos`, which no
 * older binary sets), it gets the photos and the one tapped, and the web lightbox stays shut — returns true. Each photo goes
 * by the site's own image optimizer (the stored URL may be internal to the box), at its widest allowed size (next.config
 * deviceSizes: 1080) and its upper quality (70); the shell draws the eno.vn mark over each, as the web does.
 */
export function openNativePhotos(images: readonly string[], index: number, title?: string, fallback?: () => void): boolean {
  if (!shell()?.photos || images.length === 0 || location.protocol !== 'https:') return false
  // The shell confirms it showed the viewer; without that within a beat (another sheet up, the age gate) the page's own
  // lightbox opens after all — a tap never does nothing (review).
  if (fallback) {
    let shown = false
    const onShown = () => { shown = true }
    window.addEventListener('eno:native-photos-shown', onShown, { once: true })
    window.setTimeout(() => { window.removeEventListener('eno:native-photos-shown', onShown); if (!shown) fallback() }, 1200)
  }
  // Always through the site's own optimizer, so the shell can accept this origin alone (review: never an arbitrary host).
  const urls = images.map((src) => `${location.origin}/_next/image?url=${encodeURIComponent(src)}&w=1080&q=70`)
  post('enoPhotos', { urls, index: Math.max(0, Math.min(index, urls.length - 1)), title: title ?? document.title })
  return true
}

/** iOS's swipe-back starts at the left edge; a touch there is the system's gesture, not a tap on the page. */
const EDGE_PX = 24

const shell = (): Shell | null => (typeof window === 'undefined' ? null : ((window as unknown as { __enoShell?: Shell }).__enoShell ?? null))
const post = (name: string, body: unknown) => {
  try {
    ;(window as unknown as { webkit?: { messageHandlers?: Record<string, Handler | undefined> } }).webkit?.messageHandlers?.[name]?.postMessage(body)
  } catch { /* the shell is gone or older: nothing to tell */ }
}

const navItems = (): HTMLElement[] => {
  const nav = document.querySelector('.mobile-nav')
  return nav ? Array.from(nav.querySelectorAll<HTMLElement>(':scope > div > a, :scope > div > button')) : []
}

/**
 * A modal layer is up, or something reaches the strip the tab bar covers. Base UI's modal dialogs and sheets lock the page's
 * scroll with an inline overflow on <html> (no aria-modal to read); a non-modal card that sits above the nav — the cookie
 * card — does neither, and keeps the bar. A dialog whose box reaches the bottom 100px (a bottom sheet, a drawer) hides it.
 */
const overlayOpen = () => {
  const html = document.documentElement
  if (html.style.overflow === 'hidden' || document.body.style.overflow === 'hidden') return true
  const strip = window.innerHeight - 100
  return Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).some((el) => {
    const r = el.getBoundingClientRect()
    return r.height > 0 && r.bottom > strip && r.top < window.innerHeight
  })
}

/**
 * The web bar has slid away for its own reasons — the reader scrolling down, the keyboard up (mobile-nav.tsx `off`): the native
 * bar steps aside with it (owner, 2026-11-24: "when scroll up native navbar overlaps chat button … dont stack one above another
 * one disappears another pops just like web version"). The listing's own action (pdp-action-bar.tsx) shows only while the
 * tab bar has left, so the two take turns, as they do on the web. ⛔ `translate-y-full` is mobile-nav.tsx's own retract class
 * (ios-native-shell.test.ts pins the pair). Focus is not read: under `native-tabbar` the web nav is `visibility: hidden`, so
 * nothing in it can take focus.
 */
const navRetracted = (nav: Element | null) => !!nav && nav.classList.contains('translate-y-full')

function tabsSnapshot() {
  const nav = document.querySelector<HTMLElement>('.mobile-nav')
  const items = navItems()
  return {
    // 1.3 shells slide their bar away while this holds, and keep the web nav hidden (it has left too); older ones ignore it.
    retracted: navRetracted(nav),
    // On screen at all — its own display, an ancestor's, a :has() rule — but NOT our `visibility: hidden` (it still has a box);
    // nor while the phone search hides it (its own visibility rule), nor under an open dialog or sheet: the native bar sits
    // ABOVE every web layer, so a sheet's bottom button would be under it and its taps would go to a tab (review).
    visible: !!nav && nav.getClientRects().length > 0 && items.length > 0
      && !document.documentElement.hasAttribute('data-phone-search') && !overlayOpen(),
    items: items.map((el) => ({
      label: el.getAttribute('aria-label') ?? '',
      // Where it goes, so the shell picks the tab's symbol by destination, never by position (review: a variant with fewer tabs).
      href: el.getAttribute('href') ?? '',
      active: ['page', 'true'].includes(el.getAttribute('aria-current') ?? ''),
      // The count badge (ui/badge carries no hook): the item's one leaf whose whole text is a count, "3" or "9+".
      badge: Array.from(el.querySelectorAll('span, div')).find((n) => n.childElementCount === 0 && /^\d+\+?$/.test(n.textContent?.trim() ?? ''))?.textContent?.trim() ?? null,
    })),
  }
}

export function IosShellBridge() {
  const pathname = usePathname()
  const { tr } = useLanguage()
  const syncTabs = useRef<() => void>(() => {})
  const poppedAt = useRef(0)
  // The menu's words in the reader's language (tr follows the in-app language switch, the nine MT languages included).
  const words = useRef({ share: '', copy: '', save: '' })
  useEffect(() => { words.current = { share: tr('Share', 'Chia sẻ'), copy: tr('Copy link', 'Sao chép liên kết'), save: tr('Save listing', 'Lưu tin') } }, [tr])

  useEffect(() => {
    const s = shell()
    if (!s) return
    const cleanups: (() => void)[] = []

    if (s.tabs) {
      let last = ''
      let lastRetracted = false
      let frame: ReturnType<typeof setTimeout> | undefined
      let watched: Element | null = null
      const read = () => {
        // A remounted nav (a flow that drops it and brings it back) is a new node: follow it (review).
        if (document.querySelector('.mobile-nav') !== watched) watch()
        const snap = tabsSnapshot()
        lastRetracted = snap.retracted
        const next = JSON.stringify(snap)
        if (next === last) return
        last = next
        post('enoTabs', JSON.parse(next)) // plain JSON only reaches the shell (review)
      }
      // Throttled, not per frame and never starved: the first change schedules ONE read 120ms on, which sees every change
      // made meanwhile (the page-wide observer below fires on each carousel slide and image load — review).
      const sync = () => {
        if (frame) return
        frame = setTimeout(() => { frame = undefined; read() }, 120)
      }
      // …but the bar sliding away or back is told at once, so the native bar moves WITH the web's (one cheap class check).
      const onMutation = () => {
        if (navRetracted(document.querySelector('.mobile-nav')) === lastRetracted) { sync(); return }
        clearTimeout(frame)
        frame = undefined
        read()
      }
      syncTabs.current = sync
      const obs = new MutationObserver(onMutation)
      const watch = () => {
        obs.disconnect()
        const nav = document.querySelector('.mobile-nav')
        watched = nav
        if (nav) obs.observe(nav, { subtree: true, childList: true, attributes: true, characterData: true })
        // What hides the web nav keys on <html> (chat, post flow, phone search, a scroll lock's style) and on what mounts in
        // the page (`body:has(...)` rules, dialogs and sheets portalled into <body>). Coalesced to one read per frame.
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-post-done', 'data-phone-search'] })
        obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'data-open', 'data-closed', 'hidden', 'open'] })
      }
      watch()
      sync()
      // By the tab's own name first — the set can change between the bar's last read and the tap (a sign-in) — then by place.
      const onTab = (e: Event) => {
        const d = (e as CustomEvent<{ index?: number; label?: string }>).detail
        const items = navItems()
        const byName = d?.label ? items.find((el) => el.getAttribute('aria-label') === d.label) : undefined
        ;(byName ?? (typeof d?.index === 'number' ? items[d.index] : undefined))?.click()
      }
      window.addEventListener('eno:native-tab', onTab)
      window.addEventListener('resize', sync)
      cleanups.push(() => { obs.disconnect(); clearTimeout(frame); window.removeEventListener('eno:native-tab', onTab); window.removeEventListener('resize', sync) })
    }

    if (s.nav) {
      const MAY_NAVIGATE = 'a[href], [data-card-root], [data-header-back], [data-photo-back]'
      // A TAP, not a touch: armed as the finger lifts after a short press that barely moved, so a scroll — most touches on a
      // feed start on a card — never pictures the screen (review), and its click comes right after.
      let start: { x: number; y: number; at: number } | null = null
      const onStart = (e: TouchEvent) => {
        const t = e.touches[0]
        start = t && e.touches.length === 1 && t.clientX >= EDGE_PX && e.target instanceof Element && e.target.closest(MAY_NAVIGATE)
          ? { x: t.clientX, y: t.clientY, at: Date.now() } : null
      }
      const onEnd = (e: TouchEvent) => {
        const t = e.changedTouches[0]
        const s0 = start
        start = null
        if (!s0 || !t || Date.now() - s0.at > 600 || Math.hypot(t.clientX - s0.x, t.clientY - s0.y) > 10) return
        // A new tap is a new intent: a history step from before it (a sheet closed by Back) says nothing about where it goes.
        poppedAt.current = 0
        post('enoNav', { kind: 'arm' })
      }
      const onPop = () => { poppedAt.current = Date.now() }
      document.addEventListener('touchstart', onStart, { passive: true, capture: true })
      document.addEventListener('touchend', onEnd, { passive: true, capture: true })
      window.addEventListener('popstate', onPop)
      cleanups.push(() => {
        document.removeEventListener('touchstart', onStart, true)
        document.removeEventListener('touchend', onEnd, true)
        window.removeEventListener('popstate', onPop)
      })
    }

    if (s.menus) {
      let x = 0
      let y = 0
      const onTouch = (e: TouchEvent) => { const t = e.touches[0]; if (t) { x = t.clientX; y = t.clientY } }
      document.addEventListener('touchstart', onTouch, { passive: true, capture: true })
      // The card's heart, by its own name (listing-card SaveButton: constant label, aria-pressed carries the state).
      const saveButton = (card: Element) => Array.from(card.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')).find((b) => b.getAttribute('aria-label') === words.current.save) ?? null
      const cardAtTouch = () => document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-card-root]') ?? null
      const w = window as unknown as { __enoCardAt?: () => unknown; __enoMenuWords?: () => unknown }
      // The words alone, for the shell's fallback menu when the card under the finger cannot be pictured.
      w.__enoMenuWords = () => ({ share: words.current.share, copy: words.current.copy })
      w.__enoCardAt = () => {
        const card = cardAtTouch()
        const link = card?.querySelector<HTMLAnchorElement>('a[data-card-link]')
        if (!card || !link) return null
        const r = card.getBoundingClientRect()
        const save = saveButton(card)
        const name = (el: Element | null | undefined) => el?.getAttribute('aria-label') ?? ''
        return {
          rect: { x: r.left, y: r.top, width: r.width, height: r.height },
          href: link.href,
          title: name(link),
          saved: save ? save.getAttribute('aria-pressed') === 'true' : null,
          // The page's own words, in its language: Save is the card's own button name; the rest are the web's labels.
          labels: { save: name(save), share: words.current.share, copy: words.current.copy },
        }
      }
      const onCard = (e: Event) => {
        const d = (e as CustomEvent<{ action?: string; href?: string }>).detail
        const card = Array.from(document.querySelectorAll<HTMLElement>('[data-card-root]')).find((c) => c.querySelector<HTMLAnchorElement>('a[data-card-link]')?.href === d?.href)
        if (!card) return
        if (d?.action === 'open') card.querySelector<HTMLAnchorElement>('a[data-card-link]')?.click()
        if (d?.action === 'save') saveButton(card)?.click()
      }
      window.addEventListener('eno:native-card', onCard)
      cleanups.push(() => { document.removeEventListener('touchstart', onTouch, true); window.removeEventListener('eno:native-card', onCard); delete w.__enoCardAt; delete w.__enoMenuWords })
    }

    return () => cleanups.forEach((f) => f())
  }, [])

  // iOS 1.3 (`spotlight`): a listing page that has rendered tells the shell what it is — its page's own title, description
  // and share image (the og: tags the page already publishes) — so iPhone search finds the listings this reader opened.
  useEffect(() => {
    if (!shell()?.spotlight || !/^\/listings\/[^/]+$/.test(pathname)) return
    const at = window.setTimeout(() => {
      const meta = (p: string) => document.querySelector<HTMLMetaElement>(`meta[property="${p}"]`)?.content ?? ''
      const title = meta('og:title')
      // Only once the page's own og:url is THIS listing: a slow client navigation must not index the previous one (review).
      if (!meta('og:url').endsWith(location.pathname)) return
      if (title) post('enoViewed', { url: location.origin + location.pathname, title, description: meta('og:description'), image: meta('og:image') })
    }, 1500)
    return () => window.clearTimeout(at)
  }, [pathname])

  useEffect(() => {
    if (!shell()) return
    // A history step in the last beat brought this path (Back); one that changed nothing a while ago (a sheet's own entry,
    // a query-only step) has gone stale by the next commit (review).
    if (shell()?.nav) post('enoNav', { kind: 'commit', path: location.pathname, pop: Date.now() - poppedAt.current < 1500 })
    poppedAt.current = 0
    syncTabs.current()
  }, [pathname])

  return null
}
