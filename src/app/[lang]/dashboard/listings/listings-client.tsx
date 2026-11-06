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
import { formatInteger, moneyLocale } from '@/lib/vnd'
import { DashboardFetchError } from '@/components/marketplace/dashboard-fetch-error'
import { SectionHeader } from '@/components/marketplace/section-header'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Segmented } from '@/components/ui/segmented'
import { Alert } from '@/components/ui/alert'
import { inAvailabilityReview } from '@/lib/stale'


const ROWS_STEP = 60
/** One <DashboardListingRow> placeholder, built from the ROW'S OWN box model rather than a
 *  guessed height — that is what makes it right at every width.
 *
 *  ⚠️ A FLAT `h-[92px]` BAR WAS WRONG AT BOTH ENDS. Measured 2026-08-07 by rendering the real
 *  row: it is 132px in the dashboard's content column (p-3 + an 80px thumb beside a
 *  24 title / 24 price / 16 meta / 34 action-chip stack) and 170px on a phone, where the
 *  action chips wrap onto a second line. Reproducing the same `flex flex-wrap` chip row makes
 *  the placeholder wrap where the row wraps, so it is never 40–78px short.
 *  From lg (2026-11-06) the row puts its chips beside the text and its 96px thumb sets the height — 120px —
 *  and this placeholder takes the same shape. */
function ListingRowSkeleton() {
  return (
    <div className="flex gap-3 rounded-2xl p-3 lg:items-center lg:gap-4">
      <Skeleton className="h-20 w-20 shrink-0 rounded-xl lg:h-24 lg:w-24" />
      <div className="min-w-0 flex-1 lg:flex lg:items-center lg:gap-6">
        <div className="min-w-0 lg:flex-1">
          <div className="flex items-start justify-between gap-2 lg:justify-start">
            <Skeleton className="h-6 w-48 max-w-full" />
            <Skeleton className="h-6 w-12 shrink-0 rounded-full" />
          </div>
          {/* Price — text-base line box (24), not the 20px glyph height */}
          <Skeleton className="h-6 w-28" />
          <div className="mt-0.5"><Skeleton className="h-4 w-40 max-w-full lg:h-5" /></div>
        </div>
        {/* Edit · Mark sold · overflow — the row's chips since inbox-12, at their phone widths (one row at 360); beside the text from lg */}
        <div className="mt-2 flex flex-wrap items-center gap-2 lg:mt-0 lg:shrink-0">
          <Skeleton className="h-[34px] w-[48px] rounded-lg" />
          <Skeleton className="h-[34px] w-[90px] rounded-lg" />
          <Skeleton className="h-[30px] w-[36px] rounded-lg" />
        </div>
      </div>
    </div>
  )
}

/** The `<AvailabilityButton>` pill, reserved. Measured 2026-08-07 on the real row: the link is
 *  `size="none"` + `px-4 py-2.5` around a text-base line box → **40px tall in its own `mt-4`
 *  block = 56px of document**, and because it is `inline-flex` it is the SAME width on a
 *  phone as on a desktop. The skeleton reserved neither, which is half of a measured +112px jump
 *  at both 390 and 1440. Since 2026-11-06 the status is no longer inside the button (~184px alone, was
 *  292px with it): it sits BESIDE it from 360px (40px: at most two lines of status, the button's own height)
 *  and UNDER it below that (+4 gap +20 line = 64px), and this placeholder takes the same two shapes. */
function AvailabilityPillSkeleton() {
  return (
    <div className="mt-4 flex flex-col items-start gap-1 min-[360px]:flex-row min-[360px]:items-center min-[360px]:gap-3">
      <Skeleton className="h-10 w-[184px] max-w-full rounded-xl" />
      <Skeleton className="h-5 w-28 rounded-lg" />
    </div>
  )
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

/** The stats strip, reserved: below md its two rows are 1 + 68 + 69 + 1 = 139px (a cell is py-2.5 around the
 *  text-lg/text-sm stack, 68px; the second row adds its own hairline); from md its one row is 1 + 68 + 1 = 70px, and
 *  74px from lg once the figure steps up to text-2xl. Shared by the auth-resolving gate and the dash-fetching state so
 *  the two agree. */
function StatsGridSkeleton() {
  return <Skeleton className="mt-4 h-[139px] rounded-xl md:h-[70px] lg:h-[74px]" />
}

/** A cell's figure and its label — one pair per measure, the same in every cell (2026-11-06 audit). */
const STAT_FIGURE = 'text-lg font-bold tabular-nums lg:text-2xl'
const STAT_LABEL = 'text-sm text-body'

/** /dashboard/listings — the seller's listings management, rendered in <main>.
 *  Reads the shared dashboard cache so an edit/delete here re-pulls the one source. */
export function ListingsClient({ embedded = false }: { embedded?: boolean } = {}) {
  const { user, loading } = useAuth()
  const { tr, lang } = useLanguage()
  // Grouped like every other count in the app (break-ui, 2026-10-05): the tiles printed "1284000 / 12841".
  const grouped = (v: number) => formatInteger(v, moneyLocale(lang))
  const router = useRouter()
  const { dash: cachedDash, refresh, error } = useDashboard()
  /**
   * ⛔ NEVER STUCK (inbox-10). A failed /api/dashboard with no cache used to leave the pill, the tiles and
   * the rows on their skeletons forever — a loading screen that would never load. Now:
   *   · 'auth' (with or without a cache) → ONLY "session expired" with Sign in;
   *   · 'failed', no cache               → an error state with Retry (`refresh()`);
   *   · 'failed', a cache                → the cached copy, under a one-line notice that it may be out of date.
   * ⛔ NEVER A CACHED ACCOUNT UNDER AN EXPIRED SESSION (privacy): on a shared device the session that cached
   * these listings and stats may belong to someone else, so on 'auth' not one row of it renders. The hook
   * already drops the cache on a 401; this holds even if it ever hands one over.
   */
  const dash = error === 'auth' ? null : cachedDash
  const stuck = !dash && !!error
  // 'auth' → Sign in: the shared useSignInAgain (dashboard-fetch-error.tsx) — a LOCAL-scope sign-out plus the
  // app's device cleanup, with /signin always reachable.
  // Native segmented status filter over the seller's own listings (shown only once there are
  // enough to be worth filtering). 'active' includes a held (unverified) listing — its chip reads
  // "Held" but it is still status:'active'.
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'sold' | 'hidden'>('all')
  // ⚠️ ROWS RENDER IN PAGES OF ROWS_STEP (break-ui, 2026-10-05): the dashboard payload carries EVERY
  // non-removed listing (core/dashboard.ts), and a thousand DashboardListingRows took 38–52s to mount
  // in the harness. Every filter change starts the list at one page again — reset in the change handler,
  // not an effect, and not remembered per filter (codex: coming BACK to an expanded tab re-mounted it all).
  const [limit, setLimit] = useState(ROWS_STEP)

  useEffect(() => {
    if (!loading && !user) router.replace('/signin?next=/dashboard/listings')
  }, [loading, user, router])

  if (loading || !user) {
    // Content-shaped first paint (dashboard native-feel review, Gemini): the auth-resolving gate
    // renders the SAME shell as the loaded state — stack title bar + greeting + availability pill
    // + the stats strip + the status filter + three row skeletons — matching geometry exactly,
    // so entering the section never flashes a spinner then pops to a full layout.
    return (
      <div role="status" aria-label={tr('Loading…', 'Đang tải…')}>
        {!embedded && <SectionHeader title={tr('My listings', 'Tin của tôi')} />}
        {/* Greeting hero: `.h-greeting` is --text-display × 1.15, i.e. FLUID (32 → 46px), so a
            flat h-8 bar was 14px short on a desktop. The subtitle is text-sm (20), and the real
            stack is space-y-1, not space-y-1.5. */}
        <div className="space-y-1">
          <Skeleton className="h-[calc(var(--text-display)*1.15)] w-40 rounded-lg" />
          {/* Only where the loaded stack has its subtitle (2026-11-06 audit): embedded under the Listings tabs it has none,
              and this 24px line moved the whole screen up the moment the session resolved. */}
          {!embedded && <Skeleton className="h-5 w-52 rounded-lg" />}
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
        {/* Embedded, the section's h1 above already says "My listings"; the line would say it twice. */}
        {!embedded && <p className="text-sm text-muted-foreground">{tr('Manage your listings', 'Quản lý tin đăng của bạn')}</p>}
      </div>
      {/* Availability review lives HERE now (owner 2026-07-18: out of the rail, into the tab
          it governs). Red + a periodic hop once no listing has been confirmed for 3+ days;
          otherwise a quiet pill with a live "last reviewed" timer. */}
      {/* ⚠️ THERE ARE TWO LOADING STATES ON THIS SCREEN, and only one of them used to be shaped:
          auth resolving (the gate above) and auth resolved but /api/dashboard still in flight
          (`!dash`, below). The second one used to render the greeting with NOTHING under it, so
          the pill, the tiles and the filter all landed at once. Both now reserve the same three. */}
      {/* Only ever 'failed' here — on 'auth' `dash` is null, so the session-expired state below stands alone. */}
      {dash && error === 'failed' && (
        <Alert
          tone="warning"
          appearance="flat"
          size="xs"
          data-dash-stale=""
          className="mt-4 rounded-xl"
          action={
            <Button variant="bare" size="none" onClick={refresh} className="relative text-xs font-semibold underline underline-offset-2 cursor-pointer tap-44">
              {tr('Try again', 'Thử lại')}
            </Button>
          }
        >
          {tr('Couldn’t load new data', 'Không tải được dữ liệu mới')}
        </Alert>
      )}
      {dash ? <AvailabilityButton dash={dash} tr={tr} lang={lang} /> : stuck ? null : <AvailabilityPillSkeleton />}
      {/* Marketplace stats live HERE now (owner 2026-07-18: no dedicated dashboard home —
          the sections are the dashboard, and market info belongs to My listings). */}
      {/* FIVE MEASURES, FIVE CELLS, ONE HAIRLINE STRIP (2026-11-06 audit). Four tiles held five measures, so the last one
          carried two (judged "squeezed" in it, "cryptic" as "Views · 23 leads" before), and their grey fills read as
          controls beside the tab track, the status filter and the row chips. Now hairlines and no fill: on a phone the
          account's own counts over the buyers' (views · leads · saves, each row's meta order), five across from md.
          ⚠️ px-2 FROM md TO lg: at 768 a fifth of the column is 144px, and px-3 would leave "Tin nhắn chưa đọc" (122px at
          text-sm) 119px — a label that wraps stretches the row past StatsGridSkeleton (the 2026-11-06 review's sm→md
          lesson); px-2 leaves it 127px. Each cell draws its own hairlines, so nothing clips the Messages cell's focus ring. */}
      {!dash ? (stuck ? null : <StatsGridSkeleton />) : (
        <div className="mt-4 grid grid-cols-6 border-y border-border md:grid-cols-5">
          <div className="col-span-3 py-2.5 pr-3 md:col-span-1 md:pr-2 lg:pr-3"><p className={STAT_FIGURE}>{grouped(dash.stats.activeCount ?? dash.listings.filter((l) => l.status === 'active').length)}</p><p className={STAT_LABEL}>{tr('Active listings', 'Tin đang đăng')}</p></div>
          <Link href="/messages" className="col-span-3 border-l border-border px-3 py-2.5 transition-colors hover:bg-muted md:col-span-1 md:px-2 lg:px-3"><p className={STAT_FIGURE}>{grouped(dash.stats.unreadMessages ?? 0)}</p><p className={STAT_LABEL}>{tr('Unread messages', 'Tin nhắn chưa đọc')}</p></Link>
          <div className="col-span-2 border-t border-border py-2.5 pr-3 md:col-span-1 md:border-t-0 md:border-l md:px-2 lg:px-3"><p className={STAT_FIGURE}>{grouped(dash.stats.totalViews ?? 0)}</p><p className={STAT_LABEL}>{tr('Views', 'Lượt xem')}</p></div>
          <div className="col-span-2 border-l border-t border-border px-3 py-2.5 md:col-span-1 md:border-t-0 md:px-2 lg:px-3"><p className={STAT_FIGURE}>{grouped(dash.stats.totalLeads ?? 0)}</p><p className={STAT_LABEL}>{tr('Leads', 'Liên hệ')}</p></div>
          <div className="col-span-2 border-l border-t border-border px-3 py-2.5 md:col-span-1 md:border-t-0 md:px-2 lg:px-3"><p className={STAT_FIGURE}>{grouped(dash.stats.saves ?? 0)}</p><p className={STAT_LABEL}>{tr('Saves', 'Lượt lưu')}</p></div>
        </div>
      )}
      <div className="mt-6">
        {stuck && error ? (
          <DashboardFetchError
            error={error}
            onRetry={refresh}
            next="/dashboard/listings"
            authSubtitle={tr('Sign in again to see your listings.', 'Đăng nhập lại để xem tin đăng của bạn.')}
            failedTitle={tr('Couldn’t load your listings', 'Không tải được tin đăng')}
          />
        ) : !dash ? (
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
                  // Capped on desktop: four ~255px segments across the whole column read as an empty bar, not a filter (2026-11-06 audit).
                  className="mb-3 lg:max-w-lg"
                  aria-label={tr('Filter listings by status', 'Lọc tin theo trạng thái')}
                  value={statusFilter}
                  onValueChange={(v) => { setStatusFilter(v); setLimit(ROWS_STEP) }}
                  options={[
                    { value: 'all', label: tr('All', 'Tất cả') },
                    { value: 'active', label: tr('Active', 'Đang đăng') },
                    // A rented room lands here too (its row says "Rented"), so with a rental in the list the tab is "Closed":
                    // "Sold / rented" truncated in the four-way control on a 390px phone (blind judge, 2026-11-06).
                    { value: 'sold', label: dash.listings.some((l) => l.category?.slug === 'rentals') ? tr('Closed', 'Đã đóng') : tr('Sold', 'Đã bán') },
                    { value: 'hidden', label: tr('Hidden', 'Đã ẩn') },
                  ]}
                />
              )}
              {shown.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">{tr('No listings in this filter.', 'Không có tin nào phù hợp bộ lọc.')}</p>
              ) : (
                <div className="space-y-2.5">
                  {shown.slice(0, limit).map((l) => (
                    <DashboardListingRow key={l.id} listing={l} onChanged={refresh} />
                  ))}
                  {shown.length > limit && (
                    <Button variant="outline" className="w-full" onClick={() => setLimit((l) => l + ROWS_STEP)}>
                      {tr('Show {n} more', 'Xem thêm {n} tin').replace('{n}', () => grouped(Math.min(ROWS_STEP, shown.length - limit)))}
                    </Button>
                  )}
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
    // Goods only: a teacher's profile is never in this review (stale.ts inAvailabilityReview) — theirs is the weekly check-in.
    const times = (dash?.listings ?? [])
      .filter(inAvailabilityReview)
      .map((l) => l.availabilityConfirmedAt)
      .filter((v): v is string => !!v)
      .map((v) => Date.parse(v))
      .filter((n) => !Number.isNaN(n))
    return times.length ? Math.max(...times) : null
  }, [dash])
  const hasActive = (dash?.listings ?? []).some((l) => l.status === 'active' && inAvailabilityReview(l))
  if (!dash || !hasActive) return null
  const overdue = !lastReviewed || nowTick - lastReviewed > 3 * 864e5
  return (
    // The status is no longer INSIDE the button (2026-11-06 audit): one control carried an action and a report. BESIDE it
    // from 360px, wrapping inside its own column rather than dropping under the button: at 360 the widest status, "Xem
    // lại lần cuối 59 phút trước" (197px at text-sm), makes two 20px lines beside the ~186px Vietnamese button — the
    // button's own 40px, and the button never shrinks (ui/button's base is shrink-0) — so the row never changes height
    // and the skeleton holds it. text-balance splits those two lines evenly ("Xem lại lần cuối / 59 phút trước"), never a
    // lone "ago" or "nào" — where the browser balances text (Safari 17.5+, Chrome 114+); Safari 16 wraps greedily, still
    // two lines and the same 40px, only split unevenly (2026-11-06 review). Those widths are Vietnamese at the default
    // text size; the nine machine-translated languages are unmeasured. (The first cut let the line DROP under the button
    // when it did not fit, a shift no skeleton can reserve, so it put the line under on every phone: one more line above
    // the stats.) Under it only below 360px.
    <div className="mt-4 flex flex-col items-start gap-1 min-[360px]:flex-row min-[360px]:items-center min-[360px]:gap-3">
      {/* ON THE PRIMITIVE, not the Link (break-ui, 2026-10-05): ui/button's base carries `whitespace-nowrap`
          and `justify-center`, and an asChild child's classes are CONCATENATED, not merged (CLAUDE.md) — only
          <Button className> goes through tailwind-merge. Without the wrap, "Xác nhận còn hàng · Chưa xác
          nhận lần nào" pushed the whole dashboard to 342px on a 320px phone. */}
      <Button variant="bare" size="none" asChild className="max-w-full flex-wrap justify-start whitespace-normal text-left">
        <Link
          href="/dashboard/availability"
          className={
            // The one blue, not red (2026-11-05): a review that is due is the next thing to do, not an alarm, and red is the Report colour.
            overdue
              ? 'availability-overdue press inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-bold text-primary-foreground cursor-pointer'
              : 'press inline-flex items-center gap-2 rounded-xl bg-tint px-4 py-2.5 font-semibold text-body transition-colors hover:bg-muted cursor-pointer'
          }
        >
          <ListChecks className="h-4 w-4 shrink-0" />
          <span>{tr('Review availability', 'Xác nhận còn hàng')}</span>
        </Link>
      </Button>
      <span className="min-w-0 text-balance text-sm text-body">
        {lastReviewed
          ? `${tr('Last reviewed', 'Xem lại lần cuối')} ${timeAgo(new Date(lastReviewed).toISOString(), lang)}`
          : tr('Not reviewed yet', 'Chưa xác nhận lần nào')}
      </span>
    </div>
  )
}
