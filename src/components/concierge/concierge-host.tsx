'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { CloseButton } from '@/components/ui/close-button'
import { explorerMounted } from '@/lib/explorer-presence'
import { publicPathname } from '@/lib/lang-variant'
import { peekWard, provinceByCode } from '@/lib/vn-areas'
import { isNativeAppClient } from '@/lib/app-review-gates'
import { IS_SERVICES } from '@/lib/edition'
import {
  CONCIERGE_FRAME_PATH, CONCIERGE_OPEN_EVENT, areaForGo, isConciergeHiddenPath, safeConciergeHref, setConciergeAvailable,
  type ConciergeMessage,
} from '@/lib/concierge/client'

/** How often the page may ask again whether this account may open the window (the server checks every turn anyway). */
const CONFIG_EVERY_MS = 5 * 60_000

/**
 * THE VOICE CONCIERGE'S FLOATING WINDOW — the host, mounted once in providers.tsx (owner, 2026-10-27: "a small square
 * floating window with close button … navigate through app seamlessly"). Tiny on purpose: it ships with every page.
 *
 * ⛔ THE WINDOW IS A SAME-ORIGIN FRAME (/concierge): the face (Spatius AvatarKit — ~9 MB, page-global statics, a WebGPU
 * hide for the page's life), the microphone, the live-listening socket and the voice all run in the frame's own document,
 * under the frame page's own security policy (next.config.ts adds the face's and the listening hosts there only). The
 * marketplace page keeps its policy and its globals; nothing in the window can break it.
 * ⛔ THE FRAME NEVER TOUCHES THIS PAGE: it posts `go` (a path the SERVER built from a validated action) and the host moves
 * the app — the explorer through its own events (it does not watch the URL), any other page through the router. A message
 * counts only from THIS host's frame, from this origin, in the expected shape, and the path is checked again here.
 * Opened by the ✨ "Ask eno AI" buttons for the accounts the switch admits (GET /api/concierge/config); everyone else keeps
 * the text assistant. Closed by ✕, Escape, an account change, or a page the window never floats over.
 */
export function ConciergeHost() {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const pathname = usePathname()
  const router = useRouter()
  const { tr } = useLanguage()
  const [open, setOpen] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)

  // May this account open it? Asked once after the page settles, and again when the tab comes back to the front — at most
  // every CONFIG_EVERY_MS (review, opus: a phone that switches apps asked on every return). Never on eno.forum, which has
  // no guide (config.ts), nor in the native apps (below): there ✨ stays the text assistant without asking.
  useEffect(() => {
    if (!userId || IS_SERVICES || isNativeAppClient()) return
    let cancelled = false
    let asked = 0
    const ask = () => {
      if (asked && Date.now() - asked < CONFIG_EVERY_MS) return
      asked = Date.now()
      void fetch('/api/concierge/config', { cache: 'no-store' })
        .then((r) => (r.ok ? (r.json() as Promise<{ open?: boolean }>) : null))
        // ⛔ Not in the native apps (review, opus): they ask the `app-ai-notice` question before voice leaves the phone, and
        // the window does not — nor can their webview open the microphone yet (PLAN §4). ✨ stays the text assistant there.
        .then((b) => { if (!cancelled) setConciergeAvailable(!!b?.open && !isNativeAppClient()) })
        .catch(() => { asked = 0 /* a blip is not "closed": the next look decides */ })
    }
    const onVisible = () => { if (document.visibilityState === 'visible') ask() }
    document.addEventListener('visibilitychange', onVisible)
    const t = window.setTimeout(ask, 1_500)
    return () => {
      cancelled = true
      window.clearTimeout(t)
      document.removeEventListener('visibilitychange', onVisible)
      // ⛔ Another account, or none: the window (and its microphone) goes with the old one.
      setConciergeAvailable(false)
      setOpen(false)
    }
  }, [userId])

  useEffect(() => {
    const onOpen = () => { if (!isConciergeHiddenPath(publicPathname(window.location.pathname))) setOpen(true) }
    window.addEventListener(CONCIERGE_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(CONCIERGE_OPEN_EVENT, onOpen)
  }, [])

  // A page the window never floats over CLOSES it — a running microphone is never just hidden.
  const path = publicPathname(pathname)
  useEffect(() => { if (open && isConciergeHiddenPath(path)) setOpen(false) }, [open, path])

  // While it is open the floating support / back-to-top cluster steps aside (back-to-top.tsx reads this attribute).
  useEffect(() => {
    if (!open) return
    document.documentElement.dataset.concierge = ''
    return () => { delete document.documentElement.dataset.concierge }
  }, [open])

  const go = useCallback((href: string) => {
    const u = new URL(href, window.location.origin)
    const toExplorer = u.pathname === '/' || u.pathname === '/vi'
    // On the explorer (same language) its own events, exactly as the header search: the AREA first (a stale "near you"
    // circle would otherwise override the district), then the rest in the same task — one render, one history write.
    if (toExplorer && explorerMounted() && publicPathname(window.location.pathname) === publicPathname(u.pathname)) {
      // areaForGo: a place in the href replaces the area (its ward too — the explorer's own cached one), a page place the
      // href dropped clears it, and no place on either side leaves the person's ward or "near you" alone.
      const area = areaForGo(u.searchParams, new URLSearchParams(window.location.search))
      if (area) {
        const detail = { province: provinceByCode(area.province), ward: peekWard(area.province, area.ward), nearby: null }
        window.dispatchEvent(new CustomEvent('eno:set-area', { detail }))
      }
      window.dispatchEvent(new CustomEvent('eno:apply-url', { detail: { url: `${u.pathname}${u.search}` } }))
      return
    }
    router.push(`${u.pathname}${u.search}`)
  }, [router])

  useEffect(() => {
    if (!open) return
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || !frame.current || e.source !== frame.current.contentWindow) return
      const m = e.data as ConciergeMessage | null
      if (!m || typeof m !== 'object') return
      if (m.type === 'eno-concierge:close') { setOpen(false); return }
      if (m.type === 'eno-concierge:chat') { setOpen(false); router.push('/messages/ai'); return }
      if (m.type !== 'eno-concierge:go') return
      const href = safeConciergeHref(m.href)
      if (!href) return
      go(href)
      // A page the window cannot live on (/post, /messages, /teachers/join): the app goes there, the window closes.
      if (m.closes === true) setOpen(false)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [go, open, router])

  if (!open || !userId) return null
  const name = tr('eno guide', 'Trợ lý eno')
  return (
    <DialogPrimitive.Root open modal={false} disablePointerDismissal onOpenChange={(o) => { if (!o) setOpen(false) }}>
      <DialogPrimitive.Portal>
        {/* ⚠️ GEOMETRY: above the phone's bottom band (the tab bar's 4.5rem + the safe area + a breath — the cookie bar's
            arithmetic); on a desktop, the corner the support cluster yields. ⛔ Never `hidden` while the keyboard is up (pre-review,
            codex): a hidden window would keep its microphone listening — it stays where it is, under the keyboard. */}
        <DialogPrimitive.Popup
          aria-label={name}
          className="fixed bottom-[calc(5.5rem+max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px)))] right-3 z-fab size-48 overflow-hidden rounded-2xl border border-foreground/10 bg-brand-deeper shadow-overlay pc:bottom-6 pc:right-6 pc:size-64"
        >
          <DialogPrimitive.Title className="sr-only">{name}</DialogPrimitive.Title>
          <iframe ref={frame} src={CONCIERGE_FRAME_PATH} title={name} allow="microphone; autoplay" className="size-full border-0" />
          <DialogPrimitive.Close
            render={<CloseButton size="sm" variant="overlay" label={tr('Close the guide', 'Đóng trợ lý')} className="absolute right-1 top-1" />}
          />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
