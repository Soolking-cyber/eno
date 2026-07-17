'use client'

import { createContext, useCallback, useContext, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  X, Store, Settings, Scale, CircleHelp, LogOut,
  MessageSquareText, Heart, Upload, Code2, UsersRound, PanelLeft,
  Flag, ShieldAlert, ClipboardList, Tags, Star, Home,
} from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { PreferencesInline } from './preferences-inline'
// (useAuth is used by BOTH the shell — to keep the desktop rail permanent for signed-in users —
//  and the panel body.)
import { TrustScore } from './trust-score'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { useDashboard } from '@/hooks/use-dashboard'

// LEFT account/dashboard NAV RAIL — Gemini "collapsed-by-default, expand-on-hover" model
// (owner 2026-07-17). DESKTOP: a narrow 72px column of crisp icons on the LEFT edge; hovering
// expands it to 280px, FLOATING over the content (position:fixed + z-50 + a width transition) so
// the page never reflows — the content margin stays locked at --account-w (72px). MOBILE: unchanged
// — a full-screen launcher overlay (opaque, body-locked, focus-trapped); tapping a section navigates
// and closes the rail. The sections are their own /dashboard/* pages (they render in <main>); this
// rail only links to them. Borderless throughout: no divider line — collapsed is a whisper tint, the
// hover-expansion lifts off the canvas with a soft blur + diffuse shadow.

export type PanelView = 'root'

const Ctx = createContext<{
  open: boolean
  setOpen: (o: boolean) => void
  /** Open the nav rail. (Arg retained for back-compat with openTo('root') callers.) */
  openTo: (v?: PanelView) => void
  /** Desktop rail expanded (pinned via the toggle). Lifted to the shell so the content padding can
   *  push the feed clear of the WIDE (280px) rail when open — otherwise the expansion overlaps it. */
  expanded: boolean
  setExpanded: Dispatch<SetStateAction<boolean>>
}>({ open: false, setOpen: () => {}, openTo: () => {}, expanded: false, setExpanded: () => {} })
export const useAccountPanel = () => useContext(Ctx)

const FORUM_URL = process.env.NEXT_PUBLIC_FORUM_URL || '/forum'

export function AccountPanelShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  // Desktop rail expanded (toggle-pinned). Lives HERE (not in AccountPanel) so the content padding
  // below can push the feed clear of the 280px expanded rail. Resets whenever the rail closes.
  const [expanded, setExpanded] = useState(false)
  useEffect(() => { if (!open) setExpanded(false) }, [open])
  // Lazy-mount: guests and users who never open the panel pay zero render cost.
  const [mounted, setMounted] = useState(false)
  if (open && !mounted) setMounted(true)
  const openTo = useCallback(() => { setOpen(true) }, [])

  // Mobile entry point. The bottom-nav "Account" tab lives OUTSIDE this provider, so it drives the
  // rail via a window event rather than the context — the launcher gesture on phones (tap Account →
  // the rail menu opens full-screen → pick a section → it navigates and the rail closes). The event
  // carries `detail`: `false` CLOSES it (dispatched by the OTHER bottom-nav tabs) so tapping e.g.
  // Explore while the launcher is open reverts to that page EVEN WHEN the route doesn't change (the
  // route-driven close below can't fire when you're already on the target — the reported bug).
  useEffect(() => {
    const onEvt = (e: Event) => setOpen((e as CustomEvent).detail !== false)
    window.addEventListener('eno:open-account', onEvt)
    return () => window.removeEventListener('eno:open-account', onEvt)
  }, [])

  // Broadcast the rail's open state back out (the reverse of eno:open-account) so the bottom-nav
  // Account tab — which lives OUTSIDE this provider — can light its active indicator while the rail
  // is open, exactly like the other tabs do for their page. Fires on every change (incl. closes).
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('eno:account-open-change', { detail: open }))
  }, [open])

  // PERMANENT desktop rail (owner 2026-07-17). The collapsed 72px icon column is ALWAYS on the left
  // for a signed-in user on desktop — on every page, not just /dashboard/* — mirroring Gmail/Discord.
  // MOBILE has no room for a persistent sidebar, so it stays a LAUNCHER (closed by default; the
  // bottom-nav Account tab opens it full-screen via eno:open-account). `sync` re-runs on every route
  // change (which CLOSES the mobile launcher after a tap-navigate — desktop just stays open) and on
  // the viewport crossing the lg breakpoint (resize/orientation), so the rail is correct without a
  // reload. Guests get neither (user is null → open stays false → nothing mounts, no content margin).
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 64rem)')
    const sync = () => setOpen(mq.matches && !!user)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [pathname, user])

  return (
    <Ctx.Provider value={{ open, setOpen, openTo, expanded, setExpanded }}>
      <div
        className={cn(
          // duration-200 matches the rail's own width transition, so the push and the widen move in
          // lockstep — the rail's right edge never runs ahead of the content clearing it.
          'transition-[padding] duration-200 motion-reduce:transition-none',
          // Clear the rail with padding so the content stays BALANCED (not shoved by a one-sided
          // margin, which put it ~72px off-centre). COLLAPSED: symmetric 72px both sides → content
          // centred in the viewport, rail in the left gutter. EXPANDED (toggle-pinned, 280px): push
          // the feed right to clear the wide rail (pl-280) while keeping the same 72px right gutter,
          // so it never overlaps and stays balanced beside the rail. Animates the push (transition
          // padding). Only when open (desktop, signed-in) — guests get nothing.
          open && (expanded ? 'lg:pl-[280px] lg:pr-[var(--account-w)]' : 'lg:px-[var(--account-w)]'),
        )}
        style={{ transitionTimingFunction: 'var(--ease-spring)' }}
      >
        {children}
      </div>
      {mounted && <AccountPanel open={open} onClose={() => setOpen(false)} />}
    </Ctx.Provider>
  )
}

function AccountPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, signOut } = useAuth()
  const { tr } = useLanguage()
  const pathname = usePathname()
  // ONE shared cache-first source, identical to what the /dashboard/* pages read — so the
  // rail's stats/identity and the section pages never diverge or double-fetch.
  const { dash } = useDashboard()

  // DESKTOP expand — PINNED by a toggle button (Gemini "Open sidebar"), not hover: hovering a
  // collapsed icon reveals its NAME as a tooltip instead (see renderNav). Desktop-only. State lives
  // in the SHELL (via context) so the content padding can push the feed clear of the 280px rail;
  // reset-on-close also lives there.
  const { expanded, setExpanded } = useAccountPanel()

  // While open on MOBILE, freeze the page behind the overlay — without this the background keeps
  // scrolling under the panel (same body-lock recipe as the gallery lightbox). Desktop squeezes the
  // page instead (72px), so it stays scrollable.
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

  // Esc closes the rail. (No drill levels — sections are their own pages.)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // MOBILE the panel is a full-screen MODAL (fixed inset, body-locked), so focus MUST be trapped
  // inside it — otherwise Tab walks into the page behind, which is still in the DOM (the panel
  // toggles visibility, it never unmounts). DESKTOP it's a persistent non-modal rail (the feed just
  // squeezes to make room), so NO trap there. Decide modal-vs-rail at open and freeze it for the
  // session (the SAME matchMedia-at-open pattern the body-lock uses, so the two never disagree).
  // Recompute on EVERY open/close so it is always FALSE while closed.
  const [modalThisOpen, setModalThisOpen] = useState(false)
  useEffect(() => {
    setModalThisOpen(open && !window.matchMedia('(min-width: 64rem)').matches)
  }, [open])
  const trapRef = useFocusTrap<HTMLElement>(modalThisOpen)

  // Click/tap OUTSIDE the EXPANDED desktop rail collapses it (drawer behaviour). Desktop-only —
  // `expanded` is never set on mobile. pointerdown so it lands before a link navigation; the
  // expanding toggle is inside the aside, so it never self-closes.
  useEffect(() => {
    if (!expanded) return
    const onDown = (e: PointerEvent) => {
      const node = trapRef.current
      if (node && !node.contains(e.target as Node)) setExpanded(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [expanded, trapRef])

  if (!user) return null
  const initial = (user.email || user.phone || '?').charAt(0).toUpperCase()
  const isBusiness = dash?.tier === 'business'
  const unread = dash?.stats?.unreadMessages ?? 0
  const displayName = dash?.profile.businessName || dash?.profile.displayName || user.email || user.phone

  // On mobile the rail is a launcher — tapping an item navigates and the rail must close (a route
  // CHANGE already closes it, but re-tapping the current route wouldn't, so close here too).
  const closeOnMobile = () => { if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 64rem)').matches) onClose() }
  const active = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || (pathname?.startsWith(href + '/') ?? false)

  // Ghost pill (borderless, tactile). On the collapsed desktop rail the icon sits CENTRED in the
  // 72px column with no label; expanded, it left-aligns with the revealed label. bg-secondary/60 on
  // hover, filled bg-secondary when active.
  const navItem = (isOn: boolean) => cn(
    'flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary/60 cursor-pointer',
    expanded ? 'lg:justify-start lg:gap-3 lg:px-3.5' : 'lg:justify-center lg:gap-0 lg:px-0',
    isOn && 'bg-secondary hover:bg-secondary',
  )
  // Label that reveals as the rail expands. FULL on mobile; on desktop it slides + fades between a
  // 0-width collapsed state and a bounded expanded state. Only max-width + opacity animate (compositor
  // -friendly; no layout reflow of the page since the panel is position:fixed). Under reduced-motion
  // the global guard collapses the transition to instant.
  const labelCls = cn(
    'overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200',
    'max-w-[180px] opacity-100',
    expanded ? 'lg:max-w-[180px] lg:opacity-100' : 'lg:max-w-0 lg:opacity-0',
  )

  // Plain render fn (NOT a nested component — that would remount the subtree each render). Reused
  // for the middle routing AND the Settings/Help rows in the bottom cluster.
  const renderNav = (it: { href: string; label: string; icon: React.ElementType; exact?: boolean; badge?: number; external?: boolean }) => {
    const Icon = it.icon
    const isOn = active(it.href, it.exact)
    const inner = (
      <>
        <Icon className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
        <span className={labelCls}>{it.label}</span>
        {it.badge ? (
          <span className={cn('ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-2xs font-bold text-white', expanded ? 'lg:flex' : 'lg:hidden')}>{it.badge > 9 ? '9+' : it.badge}</span>
        ) : null}
      </>
    )
    const el = it.external ? (
      <a href={it.href} aria-current={isOn ? 'page' : undefined} aria-label={it.label} onClick={closeOnMobile} className={navItem(isOn)}>{inner}</a>
    ) : (
      <Link href={it.href} aria-current={isOn ? 'page' : undefined} aria-label={it.label} onClick={closeOnMobile} className={navItem(isOn)}>{inner}</Link>
    )
    // Collapsed desktop rail: hovering an icon reveals its NAME as a tooltip to the right (Gemini
    // model). Expanded → label already visible, so no tooltip. Mobile never hovers (Base UI Tooltip
    // stays closed on touch) and shows the label inline anyway, so it's inert there.
    return <Tooltip key={it.href} content={expanded ? undefined : it.label} side="right">{el}</Tooltip>
  }

  // MIDDLE — core routing. On /admin/* the rail becomes a DEDICATED ADMIN dashboard (EN-only per
  // convention — the admin chrome isn't localized) showing ONLY admin sections; everyone else gets
  // the seller/user nav. Only admins can reach /admin (server-gated on every route), so keying off
  // the path is safe. Settings + Help + Sign out stay in the bottom cluster for both.
  const inAdmin = pathname?.startsWith('/admin') ?? false
  const NAV: { href: string; label: string; icon: React.ElementType; exact?: boolean; badge?: number; external?: boolean }[] = inAdmin
    ? [
        { href: '/admin', label: 'Reports', icon: Flag, exact: true },
        { href: '/admin/disputes', label: 'Disputes', icon: Scale },
        { href: '/admin/enforcement', label: 'Enforcement', icon: ShieldAlert },
        { href: '/admin/listings', label: 'Listings', icon: ClipboardList },
        { href: '/admin/brands', label: 'Brands', icon: Tags },
        { href: '/admin/feedback', label: 'Feedback', icon: Star },
        { href: '/', label: 'Back to site', icon: Home, external: true },
      ]
    : [
        // "Dashboard" was removed (owner 2026-07-17): /dashboard just redirects to /dashboard/listings,
        // so it duplicated "My listings" and led nowhere of its own.
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

  return (
    <aside
      ref={trapRef}
      role="dialog"
      aria-label={tr('Account', 'Tài khoản')}
      // Modal ONLY on mobile (full-screen, focus-trapped); a plain non-modal rail on desktop.
      aria-modal={modalThisOpen ? true : undefined}
      className={cn(
        // Base (MOBILE): full-screen OPAQUE overlay (bg-background) — anything less lets the page
        // bleed through. left-0 + w-full, so the L/R move is moot on phones. overflow-hidden clips
        // the label reveal on desktop; the inner div owns the y-scroll.
        'fixed top-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 z-50 flex w-full flex-col overflow-hidden bg-background motion-reduce:transition-none lg:bottom-0',
        // DESKTOP: a LEFT rail. BORDERLESS + SHADOWLESS — no divider, no edge shadow (owner
        // 2026-07-17). Collapsed = 72px of icons over a whisper tint (lg:bg-muted/10); toggled open it
        // expands to 280px and FLOATS over the content on an OPAQUE bg-background (so the content
        // behind is cleanly covered without needing a shadow). Click-outside collapses it. Width /
        // colour / transform ease together; position:fixed so the width change never reflows the page.
        'lg:transition-[width,background-color,transform] lg:duration-200',
        expanded
          ? 'lg:w-[280px] lg:bg-background'
          : 'lg:w-[var(--account-w)] lg:bg-muted/10',
        // Entrance is SPLIT by breakpoint: MOBILE fades like a page (opacity+visibility,
        // transition-discrete so the fade-out finishes before it leaves the a11y tree; max-lg:starting
        // gives the first lazy-mount fade WITHOUT slowing desktop); DESKTOP slides in from the LEFT.
        'transition-[opacity,visibility] transition-discrete duration-150',
        open
          ? 'opacity-100 max-lg:starting:opacity-0 lg:translate-x-0'
          : 'invisible opacity-0 lg:visible lg:opacity-100 lg:-translate-x-full',
      )}
      style={{ transitionTimingFunction: 'var(--ease-spring)' }}
    >
      {/* TOP — MOBILE ONLY: close the full-screen launcher. The desktop rail is persistent (no
          close). "Post a listing" was REMOVED here (owner 2026-07-17) — the header/bottom-nav Post
          button is the single entry point, so the rail no longer duplicates it. */}
      <div className="flex shrink-0 justify-end p-3 lg:hidden">
        <IconButton onClick={onClose} aria-label={tr('Close', 'Đóng')} size="sm" className="text-ink-4 transition-colors hover:bg-secondary hover:text-foreground">
          <X className="h-5 w-5" />
        </IconButton>
      </div>

      {/* DESKTOP toggle — PIN the rail expanded (labels) / collapsed (icons only). This is the
          Gemini "Open sidebar" control: it replaces whole-rail hover-expand (hover now reveals a
          per-icon tooltip instead, see renderNav). Desktop-only. */}
      <div className="hidden shrink-0 px-3 pt-3 lg:block">
        <Tooltip content={expanded ? undefined : tr('Expand menu', 'Mở rộng menu')} side="right">
          <Button
            variant="bare"
            size="none"
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? tr('Collapse sidebar', 'Thu gọn thanh bên') : tr('Expand sidebar', 'Mở rộng thanh bên')}
            aria-expanded={expanded}
            className={cn(navItem(false), 'group/toggle text-ink-4 hover:text-foreground')}
          >
            {/* Collapsed: the eno MARK sits here as the brand — hovering morphs it into the sidebar
                toggle icon (its affordance), a press expands. Expanded: it's just the collapse icon. */}
            <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
              {!expanded && (
                <img src="/logo-mark.svg" alt="" aria-hidden className="absolute inset-0 h-5 w-5 transition-opacity duration-150 group-hover/toggle:opacity-0" />
              )}
              <PanelLeft
                strokeWidth={2}
                aria-hidden
                className={cn('h-5 w-5 transition-opacity duration-150', expanded ? 'opacity-100' : 'absolute inset-0 opacity-0 group-hover/toggle:opacity-100')}
              />
            </span>
            <span className={labelCls}>{tr('Collapse', 'Thu gọn')}</span>
          </Button>
        </Tooltip>
      </div>

      {/* MIDDLE + BOTTOM share ONE scroll area so nothing is ever unreachable on a short viewport or
          under text zoom. The bottom cluster gets mt-auto — pinned to the bottom when there's room to
          spare, scrolling with the rest when there isn't. pt-3 gives the first nav item top air on the
          desktop rail (whose mobile-only close row above collapses to nothing at lg). */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 pt-3 pb-3 lg:pt-2">
        {/* MIDDLE — the core routing */}
        <nav aria-label={tr('Dashboard', 'Bảng điều khiển')} className="space-y-1">
          {NAV.map(renderNav)}
        </nav>

        {/* BOTTOM — the account: identity snippet, then Settings · Help · prefs · Sign out. */}
        <div className="mt-auto space-y-1 pt-3">
          <div className={cn('flex items-center gap-3 rounded-2xl px-3 py-2', expanded ? 'lg:justify-start lg:gap-3 lg:px-3' : 'lg:justify-center lg:gap-0 lg:px-0')}>
            {dash?.profile.avatarUrl ? (
              <img src={dash.profile.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">{initial}</span>
            )}
            <div className={cn('min-w-0 overflow-hidden transition-[max-width,opacity] duration-200', 'max-w-[180px] flex-1 opacity-100', expanded ? 'lg:max-w-[180px] lg:flex-1 lg:opacity-100' : 'lg:max-w-0 lg:opacity-0')}>
              <span className="flex items-center gap-1.5">
                <p className="truncate text-sm font-bold text-foreground">{displayName}</p>
                {typeof dash?.profile.trustScore === 'number' && <TrustScore score={dash.profile.trustScore} size="sm" href="/trust" />}
              </span>
              {dash?.profile.email && <p className="truncate text-xs text-ink-4">{dash.profile.email}</p>}
            </div>
          </div>

          {renderNav({ href: '/dashboard/settings', label: tr('Settings', 'Cài đặt'), icon: Settings })}
          {renderNav({ href: '/dashboard/help', label: tr('Help', 'Trợ giúp'), icon: CircleHelp })}

          {/* Language + theme — quiet device prefs. Only meaningful expanded (a horizontal control has
              no collapsed icon form), so it's hidden on the collapsed desktop rail; full on mobile. */}
          <div className={cn('px-1 pt-1', expanded ? 'lg:block' : 'lg:hidden')}><PreferencesInline compact className="w-full" /></div>

          <Tooltip content={expanded ? undefined : tr('Sign out', 'Đăng xuất')} side="right">
            <Button
              variant="bare"
              size="none"
              onClick={() => { onClose(); signOut() }}
              aria-label={tr('Sign out', 'Đăng xuất')}
              className={cn(navItem(false), 'text-destructive hover:bg-destructive/10 hover:text-destructive')}
            >
              <LogOut className="h-5 w-5 shrink-0" strokeWidth={2} />
              <span className={labelCls}>{tr('Sign out', 'Đăng xuất')}</span>
            </Button>
          </Tooltip>
        </div>
      </div>
    </aside>
  )
}
