'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight, LogOut } from '@/components/ui/icons'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useChat } from '@/context/chat-context'
import { useFavorites } from '@/context/favorites-context'
import { useDashboard } from '@/hooks/use-dashboard'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionHeader } from '@/components/marketplace/section-header'
import { TrustScore } from '@/components/marketplace/trust-score'
import { DASHBOARD_NAV } from '@/components/marketplace/dashboard-nav'
import { resolveNavGroups, type ResolvedNavItem } from '@/components/marketplace/dashboard-nav-resolve'
import { Rows, Row as RowItem, RowsSection } from '@/components/ui/rows'
import { PreferencesInline } from '@/components/marketplace/preferences-inline'
import { ICON_SIZE, STROKE_NAV } from '@/lib/icon-tokens'
import { cn } from '@/lib/utils'

// ── /dashboard/account — THE ACCOUNT DESTINATION (mobile) ────────────────────────────
//
// Owner (2026-07-24, the dashboard native-feel lane): the account launcher should be "a clear
// grouped account DESTINATION". Both external reviewers independently rated fixing it the
// single highest-ROI item in that plan, ahead of every animation idea they cut.
//
// WHAT IT REPLACES: tapping "Account" in the bottom nav used to cancel its own <Link>
// (preventDefault) and dispatch a window CustomEvent that opened a full-screen OVERLAY — body
// locked, focus trapped, no Close button, re-tap to dismiss. The route never changed, so:
// Android hardware-back and browser-back could not close it, the URL never said where you were,
// nothing was deep-linkable or shareable, and the tab could not light up from the route like
// every other tab. That is a modal wearing a tab's clothes.
//
// A PAGE NEEDS NONE OF THAT MACHINERY. Back works because it is history. The tab lights up
// because it is a route. It survives a reload and can be linked to. The body lock, focus trap
// and the CustomEvent pair are deleted rather than reimplemented.
//
// ⚠️ IT LIVES AT /dashboard/account, NOT /dashboard. Repurposing /dashboard was my first plan
// and BOTH reviewers pushed back for the same reason: desktop lands on /dashboard today (it
// redirects to /dashboard/listings), so taking that URL would drop desktop sellers onto a link
// list instead of their listings. /dashboard and its legacy `?tab=` mapping are untouched; only
// the mobile Account tab points here.
//
// ⚠️ ROWS COME FROM DASHBOARD_NAV, never a second hand-written list — same source, same
// role-gating (business/seller/admin/visa) and the same live badges as the desktop rail, via the
// pure resolveNavGroups. A parallel list here would drift the moment a section is added.

function NavRow({ item }: { item: ResolvedNavItem }) {
  const Icon = item.icon
  const body = (
    <>
      {/* ⛔ NO COIN. The bg-brand-50 squircle that used to back every row lead here was the
          R2 critic's single biggest finding, and it was banned TWICE by the spec it thought
          it was following: §6 allows the chrome coin in exactly two places — EmptyState's
          badge and the bottom-nav Post chip — and says "never behind inline icons"; §7
          separately names "colored circles behind every glyph" as the Chợ Tốt move the whole
          language exists to reject. Seven brand-tinted coins per screen also spent the wash
          on idle chrome, so the §5 location-active duotone (rail + bottom nav) stopped
          meaning "you are here". The lead is now a plain LINE glyph in the row's surface
          ink — the same nav set as the desktop rail one step down the ladder: h-5 (§4 list
          leads) at the platform weight (STROKE_NAV), so hub and rail still read as one
          system. Blue in this hub now appears only where it means something: the count
          Badge (user-state) and the identity row's TrustScore seal. */}
      <Icon className={cn(ICON_SIZE.lg, 'shrink-0')} strokeWidth={STROKE_NAV} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{item.label}</span>
      {/* A real count, never a zero-filled dot — an empty badge is noise. */}
      {!!item.badge && item.badge > 0 && <Badge variant="brand">{item.badge > 99 ? '99+' : item.badge}</Badge>}
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" aria-hidden />
    </>
  )
  // ⚠️ NO `tap-48` HERE, DELIBERATELY. These rows are exactly 48px tall (py-3.5 = 28px + the
  // 20px lead glyph — py bumped from py-3 when the 32px coin box left, so the tap floor
  // held), so the utility would add nothing — and it is actively DANGEROUS on an unpositioned
  // element: `tap-48::before` is `position:absolute` sized 100% of its containing block, so
  // without `relative` on the row it resolves against a distant positioned ancestor and each
  // row's hit layer covers THE WHOLE LIST. Stacked, the LAST row wins every tap — which is
  // exactly what shipped: every row opened the last one's page. The utility's own comment in
  // globals.css says "add `relative` too"; the honest fix here is to not need it at all.
  // No radius, no fill: on the flat canvas a row is separated by the hairline above it and
  // nothing else. -mx-1/px-1 lets the pressed/hover tint bleed to the gutter so it reads as a
  // full-width row rather than a floating pill.
  const cls = 'flex w-full items-center gap-3 -mx-1 px-1 py-3.5 transition-colors active:bg-tint/60 hover:bg-tint/40'
  return item.external
    ? <a href={item.href} className={cls}>{body}</a>
    : <Link href={item.href} className={cls}>{body}</Link>
}

export function AccountClient() {
  const { user, loading, signOut } = useAuth()
  const { tr } = useLanguage()
  const router = useRouter()
  // The SAME cache-first source the rail and the section pages read, so identity and counters
  // can never disagree between surfaces or double-fetch.
  const { dash } = useDashboard()
  const { unread } = useChat()
  const { count: savedCount } = useFavorites()

  const groups = resolveNavGroups(DASHBOARD_NAV, {
    isBusiness: dash?.tier === 'business',
    isAdmin: dash?.isAdmin === true,
    hasVisa: dash?.hasVisa === true,
    seller: dash?.seller ?? null,
    counters: { unread, saved: savedCount },
    label: tr,
  })

  // Identity comes from dash.PROFILE, exactly like the desktop rail — `dash.seller` is the
  // storefront and carries neither avatarColor nor trustScore.
  const name = dash?.profile.businessName || dash?.profile.displayName || user?.email || ''

  // Same client gate every sibling section uses — a SERVER redirect here would race the session
  // restore and reproduce the signin↔dashboard bounce /dashboard/page.tsx warns about.
  useEffect(() => {
    if (!loading && !user) router.replace('/signin?next=/dashboard/account')
  }, [loading, user, router])

  if (loading || !user) {
    // Content-shaped first paint (f359299b), NOT a centred spinner: identity block + grouped
    // card skeletons in the geometry the real rows land in, so arriving here never flashes.
    return (
      <div role="status" aria-label={tr('Loading…', 'Đang tải…')}>
        <SectionHeader title={tr('Account', 'Tài khoản')} />
        <div className="mx-auto w-full max-w-2xl pb-4">
          {/* IDENTITY — the real block is a <Link> with `-mx-1 px-1 py-3`, an xl (h-20) avatar,
              a TrustScore chip under the email and a trailing ChevronRight: 104px, not 80. The
              old `flex items-center gap-3 px-1` skeleton dropped the 24px of vertical padding
              and both trailing affordances. */}
          <div className="flex items-center gap-3 -mx-1 px-1 py-3">
            <Skeleton className="h-20 w-20 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-7 w-40 max-w-full" />
              <Skeleton className="mt-1 h-4 w-52 max-w-full" />
              <Skeleton className="mt-1.5 h-5 w-24 rounded-full" />
            </div>
            <Skeleton className="h-5 w-5 shrink-0" />
          </div>
          {/* Skeleton geometry must match what replaces it — flat hairline-separated ROWS
              inside <RowsSection> groups, not a stack of floating 44px cards. A nav row is
              `py-3.5` around an h-5 lead glyph = exactly 48px, and the groups after the first
              open with `mt-6 border-t pt-6` + an uppercase text-xs caption. */}
          <div className="mt-2">
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-3.5">
                  <Skeleton className="h-5 w-5 shrink-0" />
                  <Skeleton className="h-5 w-32 max-w-full" />
                  <Skeleton className="ml-auto h-4 w-4 shrink-0" />
                </div>
              ))}
            </div>
            <div className="mt-6 border-t border-border pt-6">
              <Skeleton className="h-4 w-24" />
              <div className="mt-2 divide-y divide-border">
                <div className="flex items-center gap-3 py-3.5">
                  <Skeleton className="h-5 w-5 shrink-0" />
                  <Skeleton className="h-5 w-28 max-w-full" />
                  <Skeleton className="ml-auto h-4 w-4 shrink-0" />
                </div>
              </div>
            </div>
            {/* Display — <PreferencesInline>: two selects and the theme switch in one row. */}
            <div className="mt-6 border-t border-border pt-6">
              <Skeleton className="h-4 w-20" />
              <div className="mt-2 flex items-center gap-2 pt-1">
                <Skeleton className="h-10 min-w-0 flex-1 rounded-xl" />
                <Skeleton className="h-10 min-w-0 flex-1 rounded-xl" />
                <Skeleton className="h-9 w-[60px] shrink-0 rounded-full" />
              </div>
            </div>
          </div>
          {/* Sign out */}
          <div className="mt-6 border-t border-border pt-6">
            <Skeleton className="h-9 w-full rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <SectionHeader title={tr('Account', 'Tài khoản')} />
    <div className="mx-auto w-full max-w-2xl pb-4">
      {/* IDENTITY — the header a native account tab opens with: who you are, and the one number
          that means anything here. It is also the way into Settings, exactly as on the desktop
          rail (whose identity card carries the same link) — without this, Settings has no row in
          DASHBOARD_NAV and would be unreachable from the account destination. */}
      <Link
        href="/dashboard/settings"
        aria-label={tr('Settings', 'Cài đặt')}
        className="flex items-center gap-3 -mx-1 px-1 py-3 transition-colors hover:bg-tint/40 active:bg-tint/60"
      >
        <Avatar name={name} url={dash?.profile.avatarUrl} color={dash?.profile.avatarColor} size="xl" />
        <div className="min-w-0 flex-1">
          {dash ? (
            <>
              <p className="truncate text-lg font-bold text-foreground">{name || tr('Your account', 'Tài khoản của bạn')}</p>
              <p className="truncate text-xs text-body">{dash?.profile.email || user?.email}</p>
            </>
          ) : (
            // Content-SHAPED, not a spinner: the same entry treatment the other dashboard
            // sections use, so landing here never flashes a centred loader then pops.
            <div>
              {/* Same two line boxes the loaded state paints: text-lg (28) + text-xs (16). */}
              <Skeleton className="h-7 w-40 max-w-full" />
              <Skeleton className="mt-1 h-4 w-52 max-w-full" />
            </div>
          )}
          {typeof dash?.profile.trustScore === 'number' && (
            // ⚠️ NO href HERE. TrustScore renders its own <a> when given one, and this whole
            // block is already a link to Settings — an anchor inside an anchor is invalid and
            // browsers recover from it unpredictably (the same trap the PDP shop strip avoids).
            // The score still explains itself on /trust from every other surface that shows it.
            <div className="mt-1.5"><TrustScore score={dash.profile.trustScore} size="sm" /></div>
          )}
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-ink-4" aria-hidden />
      </Link>

      {/* FLAT (canon §3b): a caption, a hairline above the block, and rows separated by lines —
          no card around the list. RowsSection/Rows carry the semantics (section + ul/li) that the
          removed border used to carry visually. */}
      <div className="mt-2">
        {groups.map((group, gi) => (
          <RowsSection key={group.caption} caption={group.caption} first={gi === 0}>
            <Rows>
              {group.items.map((item) => (
                <RowItem key={item.href + item.label} className="py-0">
                  <NavRow item={item} />
                </RowItem>
              ))}
            </Rows>
          </RowsSection>
        ))}

        {/* DISPLAY — language / currency / theme. The desktop account rail carries these
            (account-panel-body → PreferencesInline); on mobile the Account tab is a route, so the
            same shared control lives here or the phone has no way to reach them (owner 2026-07-24:
            "mobile account navbar … no language currency or theme selector"). Same component the
            desktop reads, so both stay in sync. */}
        <RowsSection caption={tr('Display', 'Hiển thị')}>
          <PreferencesInline className="pt-1" />
        </RowsSection>
      </div>

      <div className="mt-6 border-t border-border pt-6">
        {/* QUIET sign-out (R2 critic; §6 "everything else inherits surface ink"): red idle
            chrome is outside the sanctioned color roles, and Vinted/Carousell both keep the
            least-used destructive action the quietest control on the screen. The confirm
            surface for destructiveness is the action itself — not idle paint. */}
        <Button variant="outline" size="sm" onClick={() => void signOut()} className="w-full justify-center">
          <LogOut className="h-4 w-4" />
          {tr('Sign out', 'Đăng xuất')}
        </Button>
      </div>
    </div>
    </>
  )
}
