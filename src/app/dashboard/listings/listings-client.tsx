'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useDashboard } from '@/hooks/use-dashboard'
import { ListChecks } from '@/components/ui/icons'
import { timeAgo } from '@/lib/types'
import { DashboardListingRow } from '@/components/marketplace/dashboard-listing-row'
import { SectionHeader } from '@/components/marketplace/section-header'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Segmented } from '@/components/ui/segmented'

/** One <DashboardListingRow> placeholder, built from the ROW'S OWN box model rather than a
 *  guessed height — that is what makes it right at every width.
 *
 *  ⚠️ A FLAT `h-[92px]` BAR WAS WRONG AT BOTH ENDS. Measured 2026-08-07 by rendering the real
 *  row: it is 132px in the dashboard's content column (p-3 + an 80px thumb beside a
 *  24 title / 24 price / 16 meta / 34 action-chip stack) and 170px on a phone, where the
 *  action chips wrap onto a second line. Reproducing the same `flex flex-wrap` chip row makes
 *  the placeholder wrap where the row wraps, so it is never 40–78px short. */
function ListingRowSkeleton() {
  return (
    <div className="flex gap-3 rounded-2xl p-3">
      <Skeleton className="h-20 w-20 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <Skeleton className="h-6 w-48 max-w-full" />
          <Skeleton className="h-[19px] w-10 shrink-0 rounded-full" />
        </div>
        {/* Price — text-base line box (24), not the 20px glyph height */}
        <Skeleton className="h-6 w-28" />
        <div className="mt-0.5"><Skeleton className="h-4 w-40 max-w-full" /></div>
        {/* Discount · Mark sold · overflow — same widths, so the same wrap point */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Skeleton className="h-[34px] w-[108px] rounded-lg" />
          <Skeleton className="h-[34px] w-[115px] rounded-lg" />
          <Skeleton className="h-[30px] w-[38px] rounded-lg" />
        </div>
      </div>
    </div>
  )
}

/** The `<AvailabilityButton>` pill, reserved. Measured 2026-08-07 on the real row: the link is
 *  `size="none"` + `px-4 py-2.5` around a text-base line box → **40px tall in its own `mt-4`
 *  block = 56px of document**, and because it is `inline-flex` it is the SAME 292px wide on a
 *  phone as on a desktop. The skeleton reserved neither, which is half of a measured +112px jump
 *  at both 390 and 1440. */
function AvailabilityPillSkeleton() {
  return <div className="mt-4"><Skeleton className="h-10 w-[292px] max-w-full rounded-xl" /></div>
}

/** The status `<Segmented>` filter, reserved. `p-1` around an `h-9` track = **44px**, plus its own
 *  `mb-3` = 56px of document, identical at both viewports (it is `w-full` in a grid). This was the
 *  other half of the same jump.
 *
 *  ⚠️ LIKE THE CATEGORY SKELETON, THIS IS DRAWN UNCONDITIONALLY on purpose: the real control only
 *  renders once `dash.listings.length > 3`, and a skeleton cannot know the count before the fetch.
 *  A seller with 1–3 listings therefore sees this 56px collapse instead of grow — the smaller of
 *  the two errors, since the sellers who wait on this screen are the ones with listings on it. */
function StatusFilterSkeleton() {
  return <Skeleton className="mb-3 h-11 w-full rounded-xl" />
}

/** The four marketplace stat tiles, reserved (`h-[68px]`, the tile's px-3 py-3 + text-lg/text-xs
 *  stack). Shared by the auth-resolving gate and the dash-fetching state so the two agree. */
function StatsGridSkeleton() {
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[68px] rounded-xl" />)}
    </div>
  )
}

/** /dashboard/listings — the seller's listings management, rendered in <main>.
 *  Reads the shared dashboard cache so an edit/delete here re-pulls the one source. */
export function ListingsClient({ embedded = false }: { embedded?: boolean } = {}) {
  const { user, loading } = useAuth()
  const { tr, lang } = useLanguage()
  const router = useRouter()
  const { dash, refresh } = useDashboard()
  // Native segmented status filter over the seller's own listings (shown only once there are
  // enough to be worth filtering). 'active' includes a held (unverified) listing — its chip reads
  // "Held" but it is still status:'active'.
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'sold' | 'hidden'>('all')

  useEffect(() => {
    if (!loading && !user) router.replace('/signin?next=/dashboard/listings')
  }, [loading, user, router])

  if (loading || !user) {
    // Content-shaped first paint (dashboard native-feel review, Gemini): the auth-resolving gate
    // renders the SAME shell as the loaded state — stack title bar + greeting + availability pill
    // + a 4-tile stats grid + the status filter + three row skeletons — matching geometry exactly,
    // so entering the section never flashes a spinner then pops to a full layout.
    return (
      <div role="status" aria-label={tr('Loading…', 'Đang tải…')}>
        {!embedded && <SectionHeader title={tr('My listings', 'Tin của tôi')} />}
        {/* Greeting hero: `.h-greeting` is --text-display × 1.15, i.e. FLUID (32 → 46px), so a
            flat h-8 bar was 14px short on a desktop. The subtitle is text-sm (20), and the real
            stack is space-y-1, not space-y-1.5. */}
        <div className="space-y-1">
          <Skeleton className="h-[calc(var(--text-display)*1.15)] w-40 rounded-lg" />
          <Skeleton className="h-5 w-52 rounded-lg" />
        </div>
        <AvailabilityPillSkeleton />
        <StatsGridSkeleton />
        <div className="mt-6">
          <StatusFilterSkeleton />
          <div className="space-y-2.5">
            {Array.from({ length: 3 }).map((_, i) => <ListingRowSkeleton key={i} />)}
          </div>
        </div>
      </div>
    )
  }

  // First name for the greeting (business name → display name → nothing).
  const name = (dash?.profile.businessName || dash?.profile.displayName || '').trim().split(/\s+/)[0]

  return (
    <>
      {/* Native stack-nav title bar (mobile only). Title = this section's established nav
          name (dashboard-nav's tr('My listings','Tin của tôi')); the greeting h1 below is a
          hero, not a duplicate of it, so it stays visible on every size. */}
      {!embedded && <SectionHeader title={tr('My listings', 'Tin của tôi')} />}
      {/* Gemini-style greeting hero — a light, crisp welcome that floats on the flat dashboard
          canvas (globals .dashboard-canvas) instead of a bold boxed title.
          ⚠️ h2 WHEN EMBEDDED: the Listings shell already renders the section's <h1> ("My listings"),
          so the greeting drops to an <h2> under it rather than putting a second <h1> on the page.
          Standalone (no shell) it stays the page's <h1>. */}
      <div className="space-y-1">
        {embedded ? (
          <h2 className="h-greeting text-ink-2">{tr('Hi', 'Chào')}{name ? ` ${name}` : ''}</h2>
        ) : (
          <h1 className="h-greeting text-ink-2">{tr('Hi', 'Chào')}{name ? ` ${name}` : ''}</h1>
        )}
        <p className="text-sm text-muted-foreground">{tr('Manage your listings', 'Quản lý tin đăng của bạn')}</p>
      </div>
      {/* Availability review lives HERE now (owner 2026-07-18: out of the rail, into the tab
          it governs). Red + a periodic hop once no listing has been confirmed for 3+ days;
          otherwise a quiet pill with a live "last reviewed" timer. */}
      {/* ⚠️ THERE ARE TWO LOADING STATES ON THIS SCREEN, and only one of them used to be shaped:
          auth resolving (the gate above) and auth resolved but /api/dashboard still in flight
          (`!dash`, below). The second one used to render the greeting with NOTHING under it, so
          the pill, the tiles and the filter all landed at once. Both now reserve the same three. */}
      {dash ? <AvailabilityButton dash={dash} tr={tr} lang={lang} /> : <AvailabilityPillSkeleton />}
      {/* Marketplace stats live HERE now (owner 2026-07-18: no dedicated dashboard home —
          the sections are the dashboard, and market info belongs to My listings). */}
      {!dash ? <StatsGridSkeleton /> : (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl bg-tint px-3 py-3"><p className="text-lg font-bold tabular-nums">{dash.stats.activeCount ?? dash.listings.filter((l) => l.status === 'active').length}</p><p className="text-xs text-body">{tr('Active listings', 'Tin đang đăng')}</p></div>
          <Link href="/messages" className="press rounded-xl bg-tint px-3 py-3 transition-colors hover:bg-muted"><p className="text-lg font-bold tabular-nums">{dash.stats.unreadMessages}</p><p className="text-xs text-body">{tr('Unread messages', 'Tin nhắn chưa đọc')}</p></Link>
          <div className="rounded-xl bg-tint px-3 py-3"><p className="text-lg font-bold tabular-nums">{dash.stats.saves ?? 0}</p><p className="text-xs text-body">{tr('Saves', 'Lượt lưu')}</p></div>
          <div className="rounded-xl bg-tint px-3 py-3"><p className="text-lg font-bold tabular-nums">{dash.stats.totalViews} / {dash.stats.totalLeads}</p><p className="text-xs text-body">{tr('Views / leads', 'Lượt xem / liên hệ')}</p></div>
        </div>
      )}
      <div className="mt-6">
        {!dash ? (
          <>
            <StatusFilterSkeleton />
            <div className="space-y-2.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <ListingRowSkeleton key={i} />
              ))}
            </div>
          </>
        ) : dash.listings.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title={tr('No listings yet', 'Chưa có tin nào')}
            subtitle={tr('Post your first one — it only takes a minute.', 'Đăng tin đầu tiên — chỉ mất một phút.')}
            action={<Button variant="cta" asChild><Link href="/post">{tr('Post a listing', 'Đăng tin')}</Link></Button>}
          />
        ) : (() => {
          // Show the filter only once there are enough listings to warrant it — and when it's
          // HIDDEN, ignore any remembered filter (else deleting down to ≤3 would leave the list
          // silently filtered with the control gone and no way to reset it — codex).
          const showFilter = dash.listings.length > 3
          const shown = showFilter && statusFilter !== 'all' ? dash.listings.filter((l) => l.status === statusFilter) : dash.listings
          return (
            <>
              {showFilter && (
                <Segmented
                  className="mb-3"
                  aria-label={tr('Filter listings by status', 'Lọc tin theo trạng thái')}
                  value={statusFilter}
                  onValueChange={setStatusFilter}
                  options={[
                    { value: 'all', label: tr('All', 'Tất cả') },
                    { value: 'active', label: tr('Active', 'Đang đăng') },
                    { value: 'sold', label: tr('Sold', 'Đã bán') },
                    { value: 'hidden', label: tr('Hidden', 'Đã ẩn') },
                  ]}
                />
              )}
              {shown.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{tr('No listings in this filter.', 'Không có tin nào phù hợp bộ lọc.')}</p>
              ) : (
                <div className="space-y-2.5">
                  {shown.map((l) => (
                    <DashboardListingRow key={l.id} listing={l} onChanged={refresh} />
                  ))}
                </div>
              )}
            </>
          )
        })()}
      </div>
    </>
  )
}


function AvailabilityButton({ dash, tr, lang }: {
  dash: ReturnType<typeof useDashboard>['dash']
  tr: (en: string, vi: string) => string
  lang: string
}) {
  // Live timer: relative "last reviewed" re-renders each minute without a data refetch.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const lastReviewed = useMemo(() => {
    const times = (dash?.listings ?? [])
      .map((l) => l.availabilityConfirmedAt)
      .filter((v): v is string => !!v)
      .map((v) => Date.parse(v))
      .filter((n) => !Number.isNaN(n))
    return times.length ? Math.max(...times) : null
  }, [dash])
  const hasActive = (dash?.listings ?? []).some((l) => l.status === 'active')
  if (!dash || !hasActive) return null
  const overdue = !lastReviewed || nowTick - lastReviewed > 3 * 864e5
  return (
    <div className="mt-4">
      <Button variant="bare" size="none" asChild>
        <Link
          href="/dashboard/availability"
          className={
            overdue
              ? 'availability-overdue press inline-flex items-center gap-2 rounded-xl bg-destructive px-4 py-2.5 font-bold text-white cursor-pointer'
              : 'press inline-flex items-center gap-2 rounded-xl bg-tint px-4 py-2.5 font-semibold text-body transition-colors hover:bg-muted cursor-pointer'
          }
        >
          <ListChecks className="h-4 w-4 shrink-0" />
          <span>{tr('Availability review', 'Xác nhận còn hàng')}</span>
          <span className={overdue ? 'text-xs font-medium text-white/85' : 'text-xs font-medium text-ink-4'}>
            {lastReviewed
              ? `· ${tr('Last reviewed', 'Xem lại lần cuối')} ${timeAgo(new Date(lastReviewed).toISOString(), lang)}`
              : `· ${tr('Not reviewed yet', 'Chưa xác nhận lần nào')}`}
          </span>
        </Link>
      </Button>
    </div>
  )
}
