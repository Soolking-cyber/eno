'use client'

import { createContext, Fragment, useContext, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Settings, CircleHelp, LogOut, PanelLeft } from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useChat } from '@/context/chat-context'
import { useFavorites } from '@/context/favorites-context'
import { PreferencesInline } from './preferences-inline'
// (useAuth is used by BOTH the shell — to keep the desktop rail permanent for signed-in users —
//  and the panel body.)
import { TrustScore } from './trust-score'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { useDashboard } from '@/hooks/use-dashboard'
import { DASHBOARD_NAV, type NavItem, type NavRole } from './dashboard-nav'

// LEFT account/dashboard NAV RAIL — Gemini "collapsed-by-default, expand-on-hover" model
// (owner 2026-07-17). DESKTOP: a narrow 72px column of crisp icons on the LEFT edge; hovering
// expands it to 280px, FLOATING over the content (position:fixed + z-50 + a width transition) so
// the page never reflows — the content margin stays locked at --account-w (72px). MOBILE: unchanged
// — a full-screen launcher overlay (opaque, body-locked, focus-trapped); tapping a section navigates
// and closes the rail. The sections are their own /dashboard/* pages (they render in <main>); this
// rail only links to them. Borderless throughout: no divider line — collapsed is a whisper tint, the
// hover-expansion lifts off the canvas with a soft blur + diffuse shadow.

const Ctx = createContext<{
  open: boolean
  setOpen: (o: boolean) => void
  /** Desktop rail expanded (pinned via the toggle). Lifted to the shell so the content padding can
   *  push the feed clear of the WIDE (280px) rail when open — otherwise the expansion overlaps it. */
  expanded: boolean
  setExpanded: Dispatch<SetStateAction<boolean>>
}>({ open: false, setOpen: () => {}, expanded: false, setExpanded: () => {} })
export const useAccountPanel = () => useContext(Ctx)

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
    <Ctx.Provider value={{ open, setOpen, expanded, setExpanded }}>
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
  // Live counters for the Messages + Saved rail items — same sources the (now-removed) header
  // icons used, so the counts stay real-time and consistent.
  const { unread } = useChat()
  const { count: savedCount } = useFavorites()

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
  const isBusiness = dash?.tier === 'business'
  // Admin-ness comes from the SERVER (isAdminEmail over the session email, shipped as
  // `isAdmin` on the /api/dashboard payload) — the client never decides it. False while the
  // payload hasn't loaded, when signed out, or when the user simply isn't an admin.
  const isAdmin = dash?.isAdmin === true
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
  type RailItem = { href: string; label: string; icon: React.ElementType; exact?: boolean; badge?: number; external?: boolean }
  const renderNav = (it: RailItem) => {
    const Icon = it.icon
    const isOn = active(it.href, it.exact)
    const badgeLabel = it.badge && it.badge > 0 ? (it.badge > 9 ? '9+' : String(it.badge)) : null
    // aria-label REPLACES the element's content for AT, which silenced the badge count — fold it in.
    const accessibleName = badgeLabel ? tr(`${it.label}, ${badgeLabel} new`, `${it.label}, ${badgeLabel} mới`) : it.label
    const inner = (
      <>
        <span className="relative shrink-0">
          <Icon className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
          {/* Collapsed desktop rail (icon-only): the count overlaps the icon's corner like the bottom
              nav — so Messages/Saved counters stay visible without expanding. Hidden on mobile + when
              expanded, where the inline pill below shows instead. */}
          {badgeLabel && (
            <span className={cn('absolute -right-1.5 -top-1.5 hidden h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-3xs font-bold text-white', expanded ? 'lg:hidden' : 'lg:flex')}>{badgeLabel}</span>
          )}
        </span>
        <span className={labelCls}>{it.label}</span>
        {badgeLabel && (
          <span className={cn('ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-2xs font-bold text-white', expanded ? 'lg:flex' : 'lg:hidden')}>{badgeLabel}</span>
        )}
      </>
    )
    const el = it.external ? (
      <a href={it.href} aria-current={isOn ? 'page' : undefined} aria-label={accessibleName} onClick={closeOnMobile} className={navItem(isOn)}>{inner}</a>
    ) : (
      <Link href={it.href} aria-current={isOn ? 'page' : undefined} aria-label={accessibleName} onClick={closeOnMobile} className={navItem(isOn)}>{inner}</Link>
    )
    // Collapsed desktop rail: hovering an icon reveals its NAME as a tooltip to the right (Gemini
    // model). Expanded → label already visible, so no tooltip. Mobile never hovers (Base UI Tooltip
    // stays closed on touch) and shows the label inline anyway, so it's inert there.
    return <Tooltip key={it.href} content={expanded ? undefined : it.label} side="right">{el}</Tooltip>
  }

  // MIDDLE — core routing, rendered from THE single navigation configuration (dashboard-nav.tsx;
  // owner spec: one config for desktop + mobile + every role — eno.forum carries no rail at all,
  // this is THE one dashboard).
  // Visibility is ROLE-gated, never path-switched: admins see the Admin group appended on EVERY
  // page (the old /admin pathname fork — and its 'Back to site' row — is gone; the regular
  // Marketplace/Community groups are always present to navigate back with). Settings + Help +
  // Sign out stay in the bottom cluster.
  const roleOk = (role: NavRole = 'all') =>
    role === 'all' || (role === 'business' ? isBusiness : role === 'seller' ? !!dash?.seller : isAdmin)
  // Config item → concrete rail row: resolve the storefront href for THIS seller, localize the
  // label (vi absent → EN verbatim, the admin-chrome convention), bind the live badge counters.
  const toRail = (it: NavItem): RailItem | null => {
    let href = it.href
    if (it.dynamic === 'storefront') {
      if (!dash?.seller) return null // role-gated already; belt-and-braces so the placeholder href never renders
      href = dash.seller.handle ? `/${dash.seller.handle}` : `/sellers/${dash.seller.id}`
    }
    return {
      href,
      label: it.vi ? tr(it.en, it.vi) : it.en,
      icon: it.icon,
      exact: it.exact,
      external: it.external,
      badge: it.badge === 'unread' ? unread : it.badge === 'saved' ? savedCount : undefined,
    }
  }
  const GROUPS: { caption?: string; items: RailItem[] }[] = DASHBOARD_NAV
    .filter((g) => roleOk(g.role))
    .map((g) => ({
      // Caption tolerates vi-less groups (Admin renders its EN caption verbatim).
      caption: g.vi ? tr(g.en, g.vi) : g.en,
      items: g.items
        .filter((it) => roleOk(it.role))
        .flatMap((it) => { const r = toRail(it); return r ? [r] : [] }),
    }))

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
          {GROUPS.map((g, gi) => (
            <Fragment key={g.caption ?? gi}>
              {/* Group caption (mobile + expanded desktop): the small-caps idiom the filter panels
                  use. The COLLAPSED 72px rail has no room for text — a hairline separator marks the
                  group break there instead (between groups only, so gi > 0). */}
              {g.caption && (
                <>
                  <div className={cn('px-3.5 pb-1 text-2xs font-bold uppercase tracking-wider text-muted-foreground', gi > 0 && 'pt-3', expanded ? 'lg:block' : 'lg:hidden')}>{g.caption}</div>
                  {gi > 0 && <div aria-hidden className={cn('mx-4 my-2 hidden h-px bg-border', !expanded && 'lg:block')} />}
                </>
              )}
              {g.items.map(renderNav)}
            </Fragment>
          ))}
        </nav>

        {/* BOTTOM — the account: identity snippet, then Settings · Help · prefs · Sign out. */}
        <div className="mt-auto space-y-1 pt-3">
          <div className={cn('flex items-center gap-3 rounded-2xl px-3 py-2', expanded ? 'lg:justify-start lg:gap-3 lg:px-3' : 'lg:justify-center lg:gap-0 lg:px-0')}>
            <Avatar url={dash?.profile.avatarUrl} name={displayName} color={dash?.profile.avatarColor} size="sm" />
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
              no collapsed icon form), so it's hidden on the collapsed desktop rail; full on mobile.
              MOBILE (owner 2026-07-18): sign-out rides THIS row, right of the theme toggle — the
              full-width destructive row below is desktop-only. */}
          <div className={cn('flex items-center gap-2 px-1 pt-1 lg:block', expanded ? 'lg:block' : 'lg:hidden')}>
            <PreferencesInline compact className="min-w-0 flex-1 lg:w-full" />
            <IconButton
              onClick={() => { onClose(); signOut() }}
              aria-label={tr('Sign out', 'Đăng xuất')}
              className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive lg:hidden"
            >
              <LogOut className="h-5 w-5" strokeWidth={2} />
            </IconButton>
          </div>

          <Tooltip content={expanded ? undefined : tr('Sign out', 'Đăng xuất')} side="right">
            <Button
              variant="bare"
              size="none"
              onClick={() => { onClose(); signOut() }}
              aria-label={tr('Sign out', 'Đăng xuất')}
              className={cn(navItem(false), 'max-lg:hidden text-destructive hover:bg-destructive/10 hover:text-destructive')}
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
