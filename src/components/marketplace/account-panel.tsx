'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  X, Store, Settings, Scale, CircleHelp, LogOut, LayoutDashboard,
  MessageSquareText, Heart, Plus, Upload, Code2, UsersRound,
} from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { PreferencesInline } from './preferences-inline'
import { TrustScore } from './trust-score'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { useDashboard } from '@/hooks/use-dashboard'

// Right-side account/dashboard NAV RAIL (owner 2026-07-15). The header avatar opens it; its
// section links (Listings, Settings, Disputes, Help, + Bulk/Developers for business) point at
// their own /dashboard/* PAGES, which render in <main> — no longer drilled in-panel. On DESKTOP
// the rail is a persistent sidebar next to the section (the page margin squeezes to make room,
// resizable via the seam); on MOBILE it's a launcher — tapping a link opens the full-screen
// section page and the rail closes. See use-dashboard.ts for the shared data.

// The dashboard sections are now their OWN pages under /dashboard/* (owner 2026-07-15);
// the panel is a right-side NAV RAIL that links to them, not an in-panel drill-in. This
// used to be a union of in-panel views — kept as an alias so `openTo('root')` callers
// (the forum) still typecheck; 'root' is the only meaningful value now.
export type PanelView = 'root'

const Ctx = createContext<{
  open: boolean
  setOpen: (o: boolean) => void
  /** Open the nav rail. (Arg retained for back-compat with openTo('root') callers.) */
  openTo: (v?: PanelView) => void
}>({ open: false, setOpen: () => {}, openTo: () => {} })
export const useAccountPanel = () => useContext(Ctx)

// The desktop rail is DRAGGABLE (owner 2026-07-15). Base UI ships no splitter/resizable
// primitive, and react-resizable-panels needs sibling flex panels in a PanelGroup — it
// can't drive a `position: fixed` overlay AND a separate content margin at once. So this
// is the policy's step (3): a hand-rolled pointer-drag, kept to one small handler. The
// width lives in ONE place — the `--account-w` CSS var on :root — so the panel, the
// content squeeze, the seam, and the fixed back-to-top all move together as you drag,
// which is what makes the rail read as part of the same canvas rather than a floating
// card. Clamped and persisted; the seam is a plain full-height line (no top/bottom caps).
const PANEL_MIN = 360
const PANEL_MAX = 720
const FORUM_URL = process.env.NEXT_PUBLIC_FORUM_URL || '/forum'
const clampW = (n: number) => Math.max(PANEL_MIN, Math.min(PANEL_MAX, Math.round(n)))
const setRootW = (px: number) => { document.documentElement.style.setProperty('--account-w', `${px}px`) }

export function AccountPanelShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [resizing, setResizing] = useState(false)
  // Lazy-mount: guests and users who never open the panel pay zero render cost.
  const [mounted, setMounted] = useState(false)
  if (open && !mounted) setMounted(true)
  const openTo = useCallback(() => { setOpen(true) }, [])

  // Mobile entry point. The bottom-nav "Account" tab lives OUTSIDE this provider, so it opens
  // the rail via a window event rather than the context — the launcher gesture on phones (tap
  // Account → the rail menu opens full-screen → pick a section → it navigates and the rail closes).
  useEffect(() => {
    const openRail = () => setOpen(true)
    window.addEventListener('eno:open-account', openRail)
    return () => window.removeEventListener('eno:open-account', openRail)
  }, [])

  // Broadcast the rail's open state back out (the reverse of eno:open-account) so the bottom-nav
  // Account tab — which lives OUTSIDE this provider — can light its active indicator while the rail
  // is open, exactly like the other tabs do for their page. Fires on every change (incl. closes).
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('eno:account-open-change', { detail: open }))
  }, [open])

  // Load the persisted rail width after mount (localStorage is client-only, so reading it
  // in useState would desync from the SSR default and flash). The :root var default (440px,
  // globals.css) covers the first paint; the panel is closed then anyway.
  useEffect(() => {
    const saved = Number(localStorage.getItem('eno-account-w'))
    if (Number.isFinite(saved) && saved > 0) setRootW(clampW(saved))
  }, [])

  // Drag the seam → resize. Width = distance from the viewport's right edge to the pointer.
  // We write the :root var DIRECTLY on every move (no React re-render per frame — that would
  // stutter), and only commit to state/localStorage on release. Transitions are suspended
  // for the duration so the panel and margin track the pointer 1:1 instead of easing behind.
  const startResize = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    setResizing(true)
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    const move = (ev: PointerEvent) => setRootW(clampW(window.innerWidth - ev.clientX))
    const up = (ev: PointerEvent) => {
      const w = clampW(window.innerWidth - ev.clientX)
      setRootW(w)
      try { localStorage.setItem('eno-account-w', String(w)) } catch { /* private mode */ }
      setResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [])

  // Keyboard resize for the role="separator" seam (arrows nudge in 24px steps).
  const nudge = useCallback((delta: number) => {
    const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--account-w')) || 440
    const w = clampW(cur + delta)
    setRootW(w)
    try { localStorage.setItem('eno-account-w', String(w)) } catch { /* private mode */ }
  }, [])

  // Nav-driven open/close: the rail IS the dashboard nav, so its open state follows the
  // route. On a /dashboard/* route the rail is the sidebar next to the section content, so
  // DESKTOP keeps it open (and opens it when you arrive from elsewhere). MOBILE has no room
  // for a sidebar beside a full-screen section, so navigating there CLOSES the rail to reveal
  // the page — the rail is a launcher on phones, a sidebar on desktops. Leaving /dashboard
  // entirely always closes it. Runs on MOUNT too (no prev-path guard), so a DIRECT desktop
  // load of /dashboard/* opens the rail immediately. It only re-fires when the pathname
  // actually changes, so a manual close mid-section survives until the next navigation.
  useEffect(() => {
    const inDash = pathname?.startsWith('/dashboard') ?? false
    const isDesktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 64rem)').matches
    setOpen(inDash && isDesktop)
  }, [pathname])

  return (
    <Ctx.Provider value={{ open, setOpen, openTo }}>
      <div
        className={cn(
          'duration-300 motion-reduce:transition-none',
          // Suspend the margin easing while dragging so the feed tracks the seam 1:1.
          resizing ? 'transition-none' : 'transition-[margin]',
          open && 'lg:mr-[var(--account-w)]',
        )}
        style={{ transitionTimingFunction: 'var(--ease-spring)' }}
      >
        {children}
      </div>
      {mounted && <AccountPanel open={open} onClose={() => setOpen(false)} resizing={resizing} onResizeStart={startResize} onResizeKey={nudge} />}
    </Ctx.Provider>
  )
}

function AccountPanel({ open, onClose, resizing, onResizeStart, onResizeKey }: { open: boolean; onClose: () => void; resizing: boolean; onResizeStart: (e: React.PointerEvent) => void; onResizeKey: (delta: number) => void }) {
  const { user, signOut } = useAuth()
  const { tr } = useLanguage()
  const pathname = usePathname()
  // ONE shared cache-first source, identical to what the /dashboard/* pages read — so the
  // rail's stats/identity and the section pages never diverge or double-fetch.
  const { dash } = useDashboard()

  // While open on MOBILE, freeze the page behind the overlay — without this the
  // background keeps scrolling under the panel (same body-lock recipe as the
  // gallery lightbox). Desktop squeezes the page instead, so it stays scrollable.
  useEffect(() => {
    if (!open) return
    const mq = window.matchMedia('(min-width: 64rem)')
    if (mq.matches) return
    const body = document.body
    const prevOverflow = body.style.overflow
    const prevOverscroll = body.style.overscrollBehavior
    body.style.overflow = 'hidden'
    body.style.overscrollBehavior = 'none'
    return () => {
      body.style.overflow = prevOverflow
      body.style.overscrollBehavior = prevOverscroll
    }
  }, [open])

  // Esc closes the rail. (No drill levels anymore — sections are their own pages.)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // MOBILE the panel is a full-screen MODAL (fixed inset, body-locked, no scrim), so focus MUST
  // be trapped inside it — otherwise Tab walks straight into the page behind, which is still in
  // the DOM (the panel toggles visibility, it never unmounts). DESKTOP it's a persistent non-modal
  // rail (the feed just squeezes to make room), so NO trap there.
  //
  // Decide modal-vs-rail when the panel opens and freeze it for that session — the SAME
  // matchMedia-at-open pattern the body-lock effect above uses, so the two never disagree. NOT
  // reactive-on-resize: useFocusTrap restores focus to the launcher whenever `active` goes false,
  // so toggling it across the lg breakpoint mid-open would rip focus out of an open panel.
  // Recompute on EVERY open/close (not just `if (open)`) so it is always FALSE while closed —
  // a stale TRUE lingering from a prior mobile session would otherwise transiently arm the trap
  // for one render on a desktop reopen, then rip focus when the effect corrected it.
  const [modalThisOpen, setModalThisOpen] = useState(false)
  useEffect(() => {
    setModalThisOpen(open && !window.matchMedia('(min-width: 64rem)').matches)
  }, [open])
  const trapRef = useFocusTrap<HTMLElement>(modalThisOpen)

  if (!user) return null
  const initial = (user.email || user.phone || '?').charAt(0).toUpperCase()
  const isBusiness = dash?.tier === 'business'
  const unread = dash?.stats?.unreadMessages ?? 0
  const displayName = dash?.profile.businessName || dash?.profile.displayName || user.email || user.phone

  // Kid-friendly ghost nav item (owner 2026-07-16, ChatGPT/Gemini aesthetic): soft + borderless,
  // generous padding, a fully-rounded pill on hover/active — no lines, no bright colour — so it
  // feels tactile and welcoming. Active = a filled soft pill (bg-secondary). ~48px tall (py-3 +
  // 20px line) clears the 44px touch minimum on iOS/Android.
  const navItem = 'flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary/60 cursor-pointer'
  const activeItem = 'bg-secondary hover:bg-secondary'
  // On mobile the rail is a launcher — tapping an item navigates and the rail must close (a route
  // CHANGE already closes it, but re-tapping the current route wouldn't, so close here too).
  const closeOnMobile = () => { if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 64rem)').matches) onClose() }
  const active = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || (pathname?.startsWith(href + '/') ?? false)

  // MIDDLE — core routing. Settings + Help live in the BOTTOM cluster now; the old 2×2 stats-tile
  // grid was dropped for a clean nav (the unread count rides Messages as a badge; views/leads/
  // refresh live on their own pages). Storefront + forum tail the list.
  const NAV: { href: string; label: string; icon: React.ElementType; exact?: boolean; badge?: number; external?: boolean }[] = [
    { href: '/dashboard', label: tr('Dashboard', 'Tổng quan'), icon: LayoutDashboard, exact: true },
    { href: '/dashboard/listings', label: tr('My listings', 'Tin của tôi'), icon: Store },
    { href: '/messages', label: tr('Messages', 'Tin nhắn'), icon: MessageSquareText, badge: unread },
    { href: '/saved', label: tr('Saved', 'Đã lưu'), icon: Heart },
    { href: '/dashboard/disputes', label: tr('Disputes', 'Khiếu nại'), icon: Scale },
    ...(isBusiness
      ? [
          { href: '/dashboard/bulk', label: tr('Bulk upload', 'Tải hàng loạt'), icon: Upload },
          { href: '/dashboard/dev', label: tr('Developers', 'Lập trình'), icon: Code2 },
        ]
      : []),
    ...(dash?.seller
      ? [{ href: dash.seller.handle ? `/${dash.seller.handle}` : `/sellers/${dash.seller.id}`, label: tr('View storefront', 'Xem gian hàng'), icon: Store, external: true }]
      : []),
    { href: FORUM_URL, label: tr('Community forum', 'Diễn đàn cộng đồng'), icon: UsersRound, external: true },
  ]

  // Plain render fn (NOT a nested component — that would remount the subtree each render). Reused
  // for the middle routing AND the Settings/Help rows in the bottom cluster.
  const renderNav = (it: { href: string; label: string; icon: React.ElementType; exact?: boolean; badge?: number; external?: boolean }) => {
    const Icon = it.icon
    const isOn = active(it.href, it.exact)
    const inner = (
      <>
        <Icon className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{it.label}</span>
        {it.badge ? (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-2xs font-bold text-white">{it.badge > 9 ? '9+' : it.badge}</span>
        ) : null}
      </>
    )
    return it.external ? (
      <a key={it.href} href={it.href} onClick={closeOnMobile} className={cn(navItem, isOn && activeItem)}>{inner}</a>
    ) : (
      <Link key={it.href} href={it.href} aria-current={isOn ? 'page' : undefined} onClick={closeOnMobile} className={cn(navItem, isOn && activeItem)}>{inner}</Link>
    )
  }

  return (
    <aside
      ref={trapRef}
      role="dialog"
      aria-label={tr('Account', 'Tài khoản')}
      // Modal ONLY on mobile (full-screen, focus-trapped); a plain non-modal rail on desktop.
      aria-modal={modalThisOpen ? true : undefined}
      className={cn(
        // BORDERLESS (owner 2026-07-16, ChatGPT/Gemini): no border, no shadow. On DESKTOP the rail
        // is set apart from the page ONLY by a whisper-quiet tint (lg:bg-muted/30) — a calmer column
        // of the SAME canvas, not a sidebar — sitting flush to the window's right edge like a native
        // panel. On MOBILE it's a FULL-SCREEN overlay, so it must be OPAQUE (bg-background) or the
        // page bleeds through; the 30% tint there would look broken.
        'fixed top-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] right-0 z-50 flex w-full flex-col bg-background motion-reduce:transition-none lg:bottom-0 lg:w-[var(--account-w)] lg:bg-muted/30',
        // Entrance is SPLIT by breakpoint and that split is load-bearing: MOBILE fades like a page
        // (opacity+visibility, transition-discrete so the fade-out finishes before it leaves the
        // a11y tree; max-lg:starting: gives the first lazy-mount fade WITHOUT slowing desktop);
        // DESKTOP slides via lg:transition-transform (v4 transitions translate together — an
        // arbitrary transform list would JUMP).
        resizing ? 'transition-none' : 'transition-[opacity,visibility] transition-discrete duration-150 lg:transition-transform lg:duration-300',
        open
          ? 'opacity-100 max-lg:starting:opacity-0 lg:translate-x-0'
          : 'invisible opacity-0 lg:visible lg:opacity-100 lg:translate-x-full',
      )}
      style={{ transitionTimingFunction: 'var(--ease-spring)' }}
    >
      {/* Resize seam (desktop only) — a wide transparent hit-strip on the left edge; the visible
          cue is a hairline that warms to brand ONLY on hover/drag, so at rest the boundary stays
          borderless. role="separator" + arrow keys make it operable without a pointer. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={tr('Resize dashboard', 'Đổi cỡ bảng điều khiển')}
        tabIndex={0}
        onPointerDown={onResizeStart}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); onResizeKey(24) }
          else if (e.key === 'ArrowRight') { e.preventDefault(); onResizeKey(-24) }
        }}
        className="group absolute inset-y-0 left-0 z-10 hidden w-3 -translate-x-1/2 cursor-ew-resize touch-none select-none focus-visible:outline-none lg:block"
      >
        <span className={cn('absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-brand group-focus-visible:bg-brand', resizing && 'bg-brand')} />
      </div>

      {/* TOP (sticky) — mobile close + the ONE primary action, a big soft brand pill (ChatGPT's
          "New chat"). */}
      <div className="shrink-0 space-y-2 p-3">
        <div className="flex justify-end lg:hidden">
          <IconButton onClick={onClose} aria-label={tr('Close', 'Đóng')} size="sm" className="text-ink-4 transition-colors hover:bg-secondary hover:text-foreground">
            <X className="h-5 w-5" />
          </IconButton>
        </div>
        <Button asChild variant="cta" size="none" className="w-full justify-center gap-2 rounded-2xl px-4 py-3 text-sm">
          <Link href="/post" onClick={closeOnMobile}><Plus className="h-5 w-5" strokeWidth={2.25} /> {tr('Post a listing', 'Đăng tin')}</Link>
        </Button>
      </div>

      {/* MIDDLE (scrollable) — the core routing */}
      <nav aria-label={tr('Dashboard', 'Bảng điều khiển')} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-2">
        {NAV.map(renderNav)}
      </nav>

      {/* BOTTOM (sticky) — the account: identity snippet, then Settings · Help · prefs · Sign out. */}
      <div className="shrink-0 space-y-1 p-3 pt-2">
        <div className="flex items-center gap-3 rounded-2xl px-3 py-2">
          {dash?.profile.avatarUrl ? (
            <img src={dash.profile.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">{initial}</span>
          )}
          <div className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <p className="truncate text-sm font-bold text-foreground">{displayName}</p>
              {typeof dash?.profile.trustScore === 'number' && <TrustScore score={dash.profile.trustScore} size="sm" href="/trust" />}
            </span>
            {dash?.profile.email && <p className="truncate text-xs text-ink-4">{dash.profile.email}</p>}
          </div>
        </div>

        {renderNav({ href: '/dashboard/settings', label: tr('Settings', 'Cài đặt'), icon: Settings })}
        {renderNav({ href: '/dashboard/help', label: tr('Help', 'Trợ giúp'), icon: CircleHelp })}

        {/* Language + theme — quiet device prefs. */}
        <div className="px-1 pt-1"><PreferencesInline compact className="w-full" /></div>

        <Button
          variant="bare"
          size="none"
          onClick={() => { onClose(); signOut() }}
          className={cn(navItem, 'text-destructive hover:bg-destructive/10 hover:text-destructive')}
        >
          <LogOut className="h-5 w-5 shrink-0" strokeWidth={2} /> <span className="flex-1 text-left">{tr('Sign out', 'Đăng xuất')}</span>
        </Button>
      </div>
    </aside>
  )
}
