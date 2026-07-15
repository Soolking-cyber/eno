'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  X, Store, Settings, Scale, CircleHelp, LogOut, LayoutDashboard,
  MessageSquareText, CalendarCheck, Eye, ChevronRight, Upload, Code2,
} from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { PreferencesInline } from './preferences-inline'
import { TrustScore } from './trust-score'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'
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

  if (!user) return null
  const initial = (user.email || user.phone || '?').charAt(0).toUpperCase()
  const isBusiness = dash?.tier === 'business'
  const stats = dash?.stats
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer'

  // Each section is now a /dashboard/* PAGE; the rail links to them and highlights the
  // one that matches the current route.
  const SECTIONS: { key: string; label: string; icon: React.ElementType }[] = [
    { key: 'listings', label: tr('Listings', 'Tin đăng'), icon: Store },
    { key: 'settings', label: tr('Settings', 'Cài đặt'), icon: Settings },
    { key: 'disputes', label: tr('Disputes', 'Khiếu nại'), icon: Scale },
    ...(isBusiness ? ([
      { key: 'bulk', label: tr('Bulk upload', 'Tải hàng loạt'), icon: Upload },
      { key: 'dev', label: tr('Developers', 'Lập trình'), icon: Code2 },
    ]) : []),
    { key: 'help', label: tr('Help', 'Trợ giúp'), icon: CircleHelp },
  ]
  const isActive = (key: string) => pathname === `/dashboard/${key}`

  return (
    <>
      {/* No mobile scrim: the panel is a FULL-SCREEN page on mobile, so a scrim behind it is
          never seen except as a modal-style dim bleeding through during the fade — which is
          exactly the "floating overlay" feel we're removing. The dashboard enters as a page
          (fade), not a modal. Desktop squeezes the feed instead of dimming, so it had no scrim
          either. Close on mobile is the header X (the panel covers any tap-to-close area). */}
      <aside
        role="dialog"
        aria-label={tr('Account', 'Tài khoản')}
        className={cn(
          // Full screen below lg (the panel IS the dashboard); a DRAGGABLE rail on desktop
          // whose width is the shared --account-w var. NO shadow: the rail is not a floating
          // card over the feed — it is a column of the same canvas, divided from it by a single
          // full-height seam (the border-l, open top and bottom). The seam is the drag handle.
          'fixed top-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] right-0 z-50 flex w-full flex-col border-l border-border bg-background motion-reduce:transition-none lg:bottom-0 lg:w-[var(--account-w)]',
          // ENTRANCE — two different motions on purpose:
          // · MOBILE the dashboard is reached from the bottom nav, a sibling of Explore /
          //   Saved / Messages, so it must ENTER like one of them: a fade, matching the app's
          //   page template (`animate-in fade-in duration-150`) and the same tw-animate-css
          //   vocabulary every Base UI surface uses for data-open. NOT a right-sliding sheet —
          //   that read as a modal, not a page.
          // · DESKTOP the resizable rail slides in from the right (transform).
          // `transition-discrete` (transition-behavior: allow-discrete) lets `visible/invisible`
          // flip discretely so the fade-OUT finishes before the panel leaves the a11y tree, and
          // `starting:opacity-0` gives the fade-IN on the very first (lazy) mount too.
          //
          // ⚠️ The transition is SPLIT by breakpoint, and that split is load-bearing. Tailwind v4's
          // `translate-x-*` animates the `translate` PROPERTY, not `transform` — so an arbitrary
          // `transition-[…,transform,…]` list does NOT cover the desktop slide and it would JUMP.
          // `lg:transition-transform` is the v4 utility that transitions transform+translate+scale
          // +rotate together, so the rail slides; mobile only needs opacity+visibility.
          resizing ? 'transition-none' : 'transition-[opacity,visibility] transition-discrete duration-150 lg:transition-transform lg:duration-300',
          open
            // max-lg:starting: keeps the fade-IN on first (lazy) mount MOBILE-ONLY — an
            // unscoped starting:opacity-0 would also fade the DESKTOP rail on its first open
            // (and it mounts at translate-x-0, so it wouldn't slide), making desktop's first
            // open a fade and every later open a slide. Scope it so desktop always slides.
            ? 'opacity-100 max-lg:starting:opacity-0 lg:translate-x-0'
            : 'invisible opacity-0 lg:visible lg:opacity-100 lg:translate-x-full',
        )}
        style={{ transitionTimingFunction: 'var(--ease-spring)' }}
      >
        {/* The seam IS the resize handle (desktop only). A wide, transparent hit-strip
            straddling the left edge for grab comfort; the visible cue is a hairline that
            warms to brand on hover/drag. role="separator" + arrow keys make it operable
            without a pointer. Open top and bottom — no caps — so it reads as one canvas. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={tr('Resize dashboard', 'Đổi cỡ bảng điều khiển')}
          tabIndex={0}
          onPointerDown={onResizeStart}
          onKeyDown={(e) => {
            // ArrowLeft widens the rail (its edge moves left), ArrowRight narrows it.
            if (e.key === 'ArrowLeft') { e.preventDefault(); onResizeKey(24) }
            else if (e.key === 'ArrowRight') { e.preventDefault(); onResizeKey(-24) }
          }}
          className={cn(
            'group absolute inset-y-0 left-0 z-10 hidden w-3 -translate-x-1/2 cursor-ew-resize touch-none select-none lg:block',
            'focus-visible:outline-none',
          )}
        >
          <span
            className={cn(
              'absolute inset-y-0 left-1/2 -translate-x-1/2 w-px transition-colors',
              'bg-transparent group-hover:bg-brand group-focus-visible:bg-brand',
              resizing && 'bg-brand',
            )}
          />
        </div>
        {/* Header — always the identity; the rail is a single nav surface now. */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          {dash?.profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={dash.profile.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">{initial}</span>
          )}
          <div className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <p className="truncate text-sm font-bold text-foreground">{dash?.profile.businessName || dash?.profile.displayName || user.email || user.phone}</p>
              {typeof dash?.profile.trustScore === 'number' && <TrustScore score={dash.profile.trustScore} size="sm" href="/trust" />}
            </span>
            {dash?.profile.email && <p className="truncate text-xs text-ink-4">{dash.profile.email}</p>}
          </div>
          <IconButton onClick={onClose} aria-label={tr('Close', 'Đóng')} size="sm" className="text-ink-4 transition-colors hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </IconButton>
        </div>

        {/* The nav. One scrolling surface: quick stats, the section links (each opens its
            /dashboard/* PAGE in main, highlighting the active one), Post, storefront, prefs. */}
        <div className="flex-1 overflow-y-auto p-3">
          {/* Quick stats — each jumps to the page that owns that number. */}
          {stats && (
            <div className="mb-3 grid grid-cols-2 gap-2">
              <StatTile icon={<MessageSquareText className="h-4 w-4" />} value={stats.unreadMessages} label={tr('Unread', 'Chưa đọc')} href="/messages" accent={stats.unreadMessages > 0} />
              <StatTile icon={<CalendarCheck className="h-4 w-4" />} value={stats.staleCount} label={tr('Need refresh', 'Cần làm mới')} href="/dashboard/availability" accent={stats.staleCount > 0} />
              <StatTile icon={<Eye className="h-4 w-4" />} value={stats.totalViews} label={tr('Views', 'Lượt xem')} href="/dashboard/listings" />
              <StatTile icon={<Store className="h-4 w-4" />} value={stats.totalLeads} label={tr('Leads', 'Liên hệ')} href="/dashboard/listings" />
            </div>
          )}

          <div className="space-y-0.5">
            {SECTIONS.map((s) => (
              <Link
                key={s.key}
                href={`/dashboard/${s.key}`}
                aria-current={isActive(s.key) ? 'page' : undefined}
                // On mobile the rail is a launcher — close it on tap. The nav effect already
                // closes it on a route CHANGE, but re-tapping the section you're already on
                // doesn't change the route, so it would otherwise stay covering the page.
                onClick={() => { if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 64rem)').matches) onClose() }}
                className={cn(item, 'justify-between', isActive(s.key) && 'bg-accent text-accent-foreground')}
              >
                <span className="flex items-center gap-2.5"><s.icon className="h-4 w-4 text-accent-foreground" /> {s.label}</span>
                <ChevronRight className="h-4 w-4 text-ink-4" />
              </Link>
            ))}
          </div>

          <Link href="/post" className={cn(item, 'mt-2 bg-accent font-semibold text-accent-foreground hover:bg-brand/15')}>
            <LayoutDashboard className="h-4 w-4" /> {tr('Post a listing', 'Đăng tin')}
          </Link>
          {dash?.seller && (
            <a href={dash.seller.handle ? `/${dash.seller.handle}` : `/sellers/${dash.seller.id}`} className={item}>
              <Store className="h-4 w-4 text-accent-foreground" /> {tr('View storefront', 'Xem gian hàng')}
            </a>
          )}

          {/* Language + theme — device prefs. */}
          <div className="mt-2 border-t border-border px-1.5 pb-1 pt-3">
            <PreferencesInline compact />
          </div>
        </div>

        <div className="border-t border-border p-3">
          <Button
            variant="bare"
            size="none"
            onClick={() => { onClose(); signOut() }}
            className={cn(item, 'justify-start hover:bg-destructive/10 hover:text-destructive')}
          >
            <LogOut className="h-4 w-4" /> {tr('Sign out', 'Đăng xuất')}
          </Button>
        </div>
      </aside>
    </>
  )
}

function StatTile({ icon, value, label, href, onClick, accent }: { icon: React.ReactNode; value: number; label: string; href?: string; onClick?: () => void; accent?: boolean }) {
  const inner = (
    <>
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tint', accent ? 'text-accent-foreground' : 'text-ink-4')}>{icon}</span>
      <span className="min-w-0 leading-tight">
        <span className={cn('block text-sm font-bold', accent ? 'text-accent-foreground' : 'text-foreground')}>{value}</span>
        <span className="block truncate text-2xs text-muted-foreground">{label}</span>
      </span>
    </>
  )
  const cls = 'flex items-center gap-2.5 rounded-xl border border-border bg-card p-2.5 text-left transition-colors hover:bg-muted cursor-pointer'
  return href
    ? <Link href={href} className={cls}>{inner}</Link>
    : <Button variant="bare" size="none" onClick={onClick} className={cn(cls, 'justify-start font-normal')}>{inner}</Button>
}
