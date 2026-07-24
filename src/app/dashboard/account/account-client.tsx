'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight, LogOut } from 'lucide-react'
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

function Row({ item, first, last }: { item: ResolvedNavItem; first: boolean; last: boolean }) {
  const Icon = item.icon
  const body = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-tint">
        <Icon className="h-4 w-4 text-accent-foreground" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{item.label}</span>
      {/* A real count, never a zero-filled dot — an empty badge is noise. */}
      {!!item.badge && item.badge > 0 && <Badge variant="brand">{item.badge > 99 ? '99+' : item.badge}</Badge>}
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" aria-hidden />
    </>
  )
  // ⚠️ NO `tap-48` HERE, DELIBERATELY. These rows are already 57px tall (py-3 + a 32px icon),
  // comfortably past the 48px floor, so the utility would add nothing — and it is actively
  // DANGEROUS on an unpositioned element: `tap-48::before` is `position:absolute` sized 100% of
  // its containing block, so without `relative` on the row it resolves against a distant
  // positioned ancestor and each row's hit layer covers THE WHOLE LIST. Stacked, the LAST row
  // wins every tap — which is exactly what shipped: every row opened the last one's page. The
  // utility's own comment in globals.css says "add `relative` too"; the honest fix here is to
  // not need it at all.
  const cls = cn(
    'flex w-full items-center gap-3 px-4 py-3 transition-colors active:bg-tint/70 hover:bg-tint/50',
    first && 'rounded-t-2xl',
    last && 'rounded-b-2xl',
  )
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
        <div className="mx-auto w-full max-w-2xl">
          <div className="flex items-center gap-3 px-1">
            <Skeleton className="h-20 w-20 rounded-full" />
            <div className="flex-1 space-y-1.5"><Skeleton className="h-5 w-40" /><Skeleton className="h-3 w-52" /></div>
          </div>
          <div className="mt-5 space-y-5">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
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
        className="flex items-center gap-3 rounded-2xl px-1 py-2 transition-colors hover:bg-tint/50 active:bg-tint/70"
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
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-52" />
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

      {/* NATIVE "INSET GROUPED" LISTS — muted caption above a rounded card of divided rows,
          matching the Settings groups shipped in the same lane so the two read as one app. */}
      <div className="mt-5 space-y-5">
        {groups.map((group) => (
          <section key={group.caption}>
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-4">{group.caption}</h2>
            <div className="mt-1.5 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {group.items.map((item, i) => (
                <Row key={item.href + item.label} item={item} first={i === 0} last={i === group.items.length - 1} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-6 px-1">
        <Button variant="outline" size="sm" onClick={() => void signOut()} className="w-full justify-center text-destructive">
          <LogOut className="h-4 w-4" />
          {tr('Sign out', 'Đăng xuất')}
        </Button>
      </div>
    </div>
    </>
  )
}
