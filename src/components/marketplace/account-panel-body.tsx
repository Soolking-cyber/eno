'use client'

// The account panel BODY — everything below the shell's mount gate, split into its
// own chunk (perf Phase 1): the shell's lazy `mounted` flag already kept guests from
// RENDERING this, but the module still shipped in the root bundle (nav resolver,
// dashboard cache hook, icons, prefs, trust UI). Now the chunk only downloads when
// the panel first opens (mobile launcher) or a signed-in desktop session mounts it.
import { Fragment, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CircleHelp, LogOut } from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useChat } from '@/context/chat-context'
import { useFavorites } from '@/context/favorites-context'
import { PreferencesInline } from './preferences-inline'
import { TrustScore } from './trust-score'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { cn } from '@/lib/utils'
import { useFocusTrap } from '@/lib/use-focus-trap'
import { useDashboard } from '@/hooks/use-dashboard'
import { DASHBOARD_NAV } from './dashboard-nav'
import { resolveNavGroups, type ResolvedNavItem } from './dashboard-nav-resolve'
import { useAccountPanel } from './account-panel'

export function AccountPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
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

  // DESKTOP expand — HOVER-DRIVEN (owner 2026-07-23; the pinned toggle it replaced is gone). The
  // aside's onMouseEnter/Leave flip this; when collapsed, a hovered icon still shows its NAME as a
  // tooltip (see renderNav). Desktop-only. State lives in the SHELL (via context) so it survives
  // this body's re-renders and the shell can reset it on close — the shell no longer reserves
  // 280px, so an expanded rail overlays the feed instead of pushing it.
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

  // Belt-and-braces collapse: mouseleave already closes the hover-expanded rail, but a pointerdown
  // OUTSIDE it collapses too, so a tap that never triggers mouseleave (touch on a hybrid device, or
  // focus moving away) can't leave it stuck open. Desktop-only — `expanded` is never set on mobile.
  //
  // ⚠️ A press inside a PORTALED popup counts as INSIDE. The prefs language/currency
  // selects (bottom cluster) render their menus in a base-ui portal on <body> — DOM-wise
  // outside the aside. Collapsing on that press hides the popup's ANCHOR (the cluster is
  // `expanded ? lg:block : lg:hidden`) mid-interaction; floating-ui flags anchor-hidden
  // and parks the open menu at the VIEWPORT ORIGIN, so the user watches their menu fly
  // to the top-left corner and the mouseup lands on nothing (owner report, proven
  // mid-press 2026-07-23: (16,550) → (0,47) with data-anchor-hidden set).
  useEffect(() => {
    if (!expanded) return
    const onDown = (e: PointerEvent) => {
      const node = trapRef.current
      const target = e.target as Node | null
      if ((target as Element | null)?.closest?.('[data-base-ui-portal]')) return
      if (node && target && !node.contains(target)) setExpanded(false)
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
  type RailItem = ResolvedNavItem
  const renderNav = (it: RailItem) => {
    const Icon = it.icon
    const isOn = active(it.href, it.exact)
    const badgeLabel = it.badge && it.badge > 0 ? (it.badge > 9 ? '9+' : String(it.badge)) : null
    // aria-label REPLACES the element's content for AT, which silenced the badge count — fold it in.
    const accessibleName = badgeLabel ? tr(`${it.label}, ${badgeLabel} new`, `${it.label}, ${badgeLabel} mới`) : it.label
    const inner = (
      <>
        <span className="relative shrink-0">
          {/* ⚠️ h-6 + strokeWidth 2.25 IS THE PLATFORM WEIGHT, not a bump for its own sake (owner,
                2026-08-03: "icons sizes to platform ui now it seems too small"). The header bell and
                the mobile bottom nav both render lucide at 2.25 (STROKE in header.tsx), while this
                rail was alone at h-5/2 — visibly lighter and smaller than every other nav surface in
                the app. Matching them makes the rail read as the same control set. */}
            <Icon className="h-6 w-6 shrink-0" strokeWidth={2.25} aria-hidden />
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
  // The role-gating + storefront-URL + label/badge resolution is a PURE function
  // (dashboard-nav-resolve.ts) so its branches are unit-testable outside the authed e2e.
  const GROUPS = resolveNavGroups(DASHBOARD_NAV, {
    isBusiness,
    isAdmin,
    // Server-computed; hides the "My e-Visa" row until the viewer has a case. Undefined while
    // the dashboard payload loads → false → the row simply appears once it resolves.
    hasVisa: dash?.hasVisa === true,
    seller: dash?.seller ?? null,
    counters: { unread, saved: savedCount },
    label: tr,
  })

  return (
    <aside
      ref={trapRef}
      // DESKTOP HOVER-OPEN (owner 2026-07-23). Entering the collapsed rail reveals the labels;
      // leaving collapses them. It only sets the desktop `expanded` state — the shell no longer
      // reserves 280px, so this overlays the feed rather than reflowing it. Mobile never fires
      // these (the panel there is the full-screen `open` overlay, and touch has no hover), and
      // every expanded visual is lg-gated anyway.
      onMouseEnter={() => setExpanded(true)}
      // Same portal rule as the pointerdown collapse above: leaving INTO a portaled
      // menu (a wide currency popup can overflow the 280px rail) must not collapse
      // the rail out from under the menu's anchor.
      onMouseLeave={(e) => {
        const to = e.relatedTarget as Element | null
        if (to?.closest?.('[data-base-ui-portal]')) return
        setExpanded(false)
      }}
      role="dialog"
      aria-label={tr('Account', 'Tài khoản')}
      // Modal ONLY on mobile (full-screen, focus-trapped); a plain non-modal rail on desktop.
      aria-modal={modalThisOpen ? true : undefined}
      className={cn(
        // Base (MOBILE): full-screen OPAQUE overlay (bg-background) — anything less lets the page
        // bleed through. left-0 + w-full, so the L/R move is moot on phones. overflow-hidden clips
        // the label reveal on desktop; the inner div owns the y-scroll.
        // pt-[env(safe-area-inset-top)]: the native WebView is edge-to-edge (contentInset 'never'),
        // so top-0 sits under the Dynamic Island — the opaque bg still fills behind the status bar
        // while the CONTENT starts below it (the iOS-native look). 0 on web, so desktop is untouched.
        // 4.5rem tracks <BottomNavSpacer/> — the tab bar's real height (was a stale 4rem).
        'fixed top-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-0 z-50 flex w-full flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)] motion-reduce:transition-none lg:bottom-0',
        // DESKTOP: a LEFT rail. BORDERLESS + SHADOWLESS — no divider, no edge shadow (owner
        // 2026-07-17). Collapsed = 72px of icons over a whisper tint (lg:bg-muted/10); toggled open it
        // expands to 280px and FLOATS over the content on an OPAQUE bg-background (so the content
        // behind is cleanly covered without needing a shadow). Click-outside collapses it. Width /
        // colour / transform ease together; position:fixed so the width change never reflows the page.
        'lg:transition-[width,background-color,transform] lg:duration-200',
        expanded
          ? 'lg:w-[var(--account-w-open)] lg:bg-background'
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

        {/* BOTTOM — the account: the identity snippet (which IS the Settings link), then prefs · Sign out. */}
        <div className="mt-auto space-y-1 pt-3">
          {/* The identity snippet IS the Settings link (owner, 2026-07-22: "when user clicks on
              profile settings should open, no need for separate icon"). The separate Settings
              row that used to sit under this is gone with it.
              ⚠️ STRETCHED LINK, not a wrapper <Link>. This block already contains an anchor —
              the trust badge links to /trust — and an <a> inside an <a> is invalid HTML that
              browsers silently un-nest, which would break BOTH targets. So the link is an
              absolutely-positioned overlay covering the row, and the trust badge is lifted
              above it with relative z-10 so it stays independently clickable. */}
          <div className={cn('group relative flex items-center gap-3 rounded-2xl px-3 py-2 transition-colors hover:bg-tint', expanded ? 'lg:justify-start lg:gap-3 lg:px-3' : 'lg:justify-center lg:gap-0 lg:px-0')}>
            <Link
              href="/dashboard/settings"
              aria-label={tr('Settings', 'Cài đặt')}
              className="absolute inset-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            <Avatar url={dash?.profile.avatarUrl} name={displayName} color={dash?.profile.avatarColor} size="sm" />
            <div className={cn('min-w-0 overflow-hidden transition-[max-width,opacity] duration-200', 'max-w-[180px] flex-1 opacity-100', expanded ? 'lg:max-w-[180px] lg:flex-1 lg:opacity-100' : 'lg:max-w-0 lg:opacity-0')}>
              <span className="flex items-center gap-1.5">
                <p className="truncate text-sm font-bold text-foreground group-hover:text-accent-foreground">{displayName}</p>
                {typeof dash?.profile.trustScore === 'number' && (
                  <span className="relative z-10 inline-flex"><TrustScore score={dash.profile.trustScore} size="sm" href="/trust" /></span>
                )}
              </span>
              {dash?.profile.email && <p className="truncate text-xs text-ink-4">{dash.profile.email}</p>}
            </div>
          </div>

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
