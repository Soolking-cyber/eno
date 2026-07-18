'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useDashboard } from '@/hooks/use-dashboard'
import { ListChecks } from 'lucide-react'
import { timeAgo } from '@/lib/types'
import { DashboardListingRow } from '@/components/marketplace/dashboard-listing-row'
import { SectionHeader } from '@/components/marketplace/section-header'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

/** /dashboard/listings — the seller's listings management, rendered in <main>.
 *  Reads the shared dashboard cache so an edit/delete here re-pulls the one source. */
export function ListingsClient() {
  const { user, loading } = useAuth()
  const { tr, lang } = useLanguage()
  const router = useRouter()
  const { dash, refresh } = useDashboard()

  useEffect(() => {
    if (!loading && !user) router.replace('/signin?next=/dashboard/listings')
  }, [loading, user, router])

  if (loading || !user) {
    return (
      <div role="status" className="flex min-h-[40vh] items-center justify-center">
        <Spinner size="lg" />
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
      <SectionHeader title={tr('My listings', 'Tin của tôi')} />
      {/* Gemini-style greeting hero — a light, crisp welcome that floats on the flat dashboard
          canvas (globals .dashboard-canvas) instead of a bold boxed title. */}
      <div className="space-y-1">
        <h1 className="h-greeting text-ink-2">
          {tr('Hi', 'Chào')}{name ? ` ${name}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">{tr('Manage your listings', 'Quản lý tin đăng của bạn')}</p>
      </div>
      {/* Availability review lives HERE now (owner 2026-07-18: out of the rail, into the tab
          it governs). Red + a periodic hop once no listing has been confirmed for 3+ days;
          otherwise a quiet pill with a live "last reviewed" timer. */}
      <AvailabilityButton dash={dash} tr={tr} lang={lang} />
      {/* Marketplace stats live HERE now (owner 2026-07-18: no dedicated dashboard home —
          the sections are the dashboard, and market info belongs to My listings). */}
      {dash && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl bg-tint px-3 py-3"><p className="text-lg font-bold tabular-nums">{dash.stats.activeCount ?? dash.listings.filter((l) => l.status === 'active').length}</p><p className="text-xs text-body">{tr('Active listings', 'Tin đang đăng')}</p></div>
          <Link href="/messages" className="press rounded-xl bg-tint px-3 py-3 transition-colors hover:bg-muted"><p className="text-lg font-bold tabular-nums">{dash.stats.unreadMessages}</p><p className="text-xs text-body">{tr('Unread messages', 'Tin nhắn chưa đọc')}</p></Link>
          <div className="rounded-xl bg-tint px-3 py-3"><p className="text-lg font-bold tabular-nums">{dash.stats.saves ?? 0}</p><p className="text-xs text-body">{tr('Saves', 'Lượt lưu')}</p></div>
          <div className="rounded-xl bg-tint px-3 py-3"><p className="text-lg font-bold tabular-nums">{dash.stats.totalViews} / {dash.stats.totalLeads}</p><p className="text-xs text-body">{tr('Views / leads', 'Lượt xem / liên hệ')}</p></div>
        </div>
      )}
      <div className="mt-6">
        {!dash ? (
          <div className="space-y-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[92px] rounded-2xl" />
            ))}
          </div>
        ) : dash.listings.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {tr('No listings yet — post your first one.', 'Chưa có tin nào — đăng tin đầu tiên.')}
            </p>
            <Button variant="cta" asChild>
              <Link href="/post">{tr('Post a listing', 'Đăng tin')}</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-2.5">
            {dash.listings.map((l) => (
              <DashboardListingRow key={l.id} listing={l} onChanged={refresh} />
            ))}
          </div>
        )}
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
