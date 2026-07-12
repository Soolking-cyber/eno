'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, Eye, MessageSquareText, Tag, Clock, Upload, List, LayoutGrid, Store, Search, X, CheckSquare, TrendingDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ShareButton } from '@/components/marketplace/share-button'
import { Mascot } from '@/components/marketplace/mascot'
import { HelpCenter } from '@/components/marketplace/help-center'
import dynamic from 'next/dynamic'
// Tab-gated heavyweights load on demand — they were statically bundled into the
// default listings tab (PostWizard alone pulls taxonomy + uploads + area-filter).
const DevelopersPanel = dynamic(() => import('@/components/marketplace/developers-panel').then((m) => m.DevelopersPanel), { ssr: false })
const DisputesPanel = dynamic(() => import('@/components/marketplace/disputes-panel').then((m) => m.DisputesPanel), { ssr: false })
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { SignInPrompt, SignOutButton } from '@/components/marketplace/account-actions'
import { DashboardListingRow } from '@/components/marketplace/dashboard-listing-row'
import { BulkDiscount } from '@/components/marketplace/bulk-discount'
import type { SparkPoint } from '@/components/marketplace/listing-sparkline'
import { TrustScore } from '@/components/marketplace/trust-score'
import { TrustProgress, type TrustProgressData } from '@/components/marketplace/trust-progress'
import { BusinessProfileEditor } from '@/components/marketplace/business-profile-editor'
import { ProfileEditor } from '@/components/marketplace/profile-editor'
import { reviewKey, todayStr } from './availability/availability-client'
import { ReminderSettings } from '@/components/marketplace/reminder-settings'
import { DeleteAccount } from '@/components/marketplace/delete-account'
import { HandleSettings } from '@/components/marketplace/handle-settings'
import { AccountTypeSwitcher } from '@/components/marketplace/account-type-switcher'
import { ChangeEmailForm } from '@/components/marketplace/change-email-form'
import { PreferencesInline } from '@/components/marketplace/preferences-inline'
const PostWizard = dynamic(() => import('@/components/marketplace/post-wizard').then((m) => m.PostWizard), { ssr: false })
import { EnforcementBanner, type EnforcementInfo } from '@/components/marketplace/enforcement-banner'
import type { SerializedCategory } from '@/lib/types'
import { isStale } from '@/lib/stale'
import { fold } from '@/lib/fold'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import type { SerializedListing } from '@/lib/types'

const KEY = 'eno-dashboard'

// Per-listing 14-day sparkline series (business tier only). Module-level cache
// so tab flips / remounts within the session don't refetch — the data changes
// once a day (cron rollup), so one fetch per page load is plenty.
type SparkSeries = Record<string, SparkPoint[]>
let sparkCache: { userId: string; series: SparkSeries } | null = null

type Stats = {
  totalViews: number; totalLeads: number; activeCount: number; soldCount: number
  hiddenCount: number; heldCount: number; staleCount: number; unreadMessages: number
}
type Dashboard = {
  tier: 'business' | 'individual'
  profile: { displayName: string | null; email: string | null; phone: string | null; avatarUrl: string | null; avatarColor: string; businessName: string | null; trustScore: number; trustTier: string }
  seller: { id: string; name: string; handle: string | null; verifiedSeller: boolean; trustScore: number; trustTier: string; responseRate: number; bio: string | null; location: string | null; phone: string | null; avatarUrl: string | null } | null
  stats: Stats
  listings: SerializedListing[]
  // Optional: absent in stale localStorage caches from before the panel shipped.
  trustProgress?: TrustProgressData
  // Optional for the same reason (and pre-migration the server sends good_standing
  // + empty lists, which renders nothing).
  enforcement?: EnforcementInfo
}

// Module-level so it isn't re-created (and its subtree remounted) every render.
function StatCard({ icon, value, label, href, accent }: { icon: React.ReactNode; value: React.ReactNode; label: string; href?: string; accent?: boolean }) {
  const inner = (
    <div className={`flex items-center gap-3 rounded-2xl p-4 ${href ? 'cursor-pointer transition-colors hover:bg-muted' : ''}`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-tint text-accent-foreground">{icon}</span>
      <div className="leading-tight">
        <div className={`text-lg font-bold ${accent ? 'text-accent-foreground' : 'text-foreground'}`}>{value}</div>
        <div className="text-2xs text-muted-foreground">{label}</div>
      </div>
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}

/** A titled settings section. ONE-CANVAS / borderless per the house language: NO box,
 *  border, resting fill or shadow — sections sit flush on the canvas, separated only by
 *  spacing + a bold title and a one-line description. The hierarchy comes from typography
 *  and the constrained column, not from cards. `tone="danger"` reddens the destructive
 *  group's title. (Fillable clarity lives on the inputs — flat `bg-tint`, no border.) */
function SettingsCard({ title, description, tone = 'default', className, children }: { title: string; description?: string; tone?: 'default' | 'danger'; className?: string; children: React.ReactNode }) {
  return (
    <section className={className}>
      <h2 className={cn('h-section', tone === 'danger' ? 'text-red-600' : 'text-foreground')}>{title}</h2>
      {description && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

/** Seller CRM dashboard. Cache-first paint (businesses hit it daily) then
 *  revalidate. Tiered: everyone gets stats + listings + messages; business adds
 *  the business-profile editor + bulk upload. Built on semantic tokens (dark-ready). */
export function DashboardClient({ categories }: { categories: SerializedCategory[] }) {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [data, setData] = useState<Dashboard | null>(null)
  // A failed /api/dashboard on a first-time load (no localStorage cache) must not
  // read as an empty dashboard — surfaced below as an error + retry.
  const [fetchFailed, setFetchFailed] = useState(false)
  const [tab, setTab] = useState<'post' | 'listings' | 'account' | 'help' | 'dev' | 'disputes'>('listings')
  // Listings layout: line (rows) vs grid (cards). Persisted per device.
  const [listView, setListView] = useState<'list' | 'grid'>('list')
  useEffect(() => { try { const v = localStorage.getItem('eno-dash-view'); if (v === 'grid' || v === 'list') setListView(v) } catch {} }, [])
  const setView = (v: 'list' | 'grid') => { setListView(v); try { localStorage.setItem('eno-dash-view', v) } catch {} }
  // Filter the seller's own listings by title — surfaced once a shop grows past a
  // scannable handful (matches EN + VI titles, accent-insensitive).
  const [listQ, setListQ] = useState('')
  // Bulk-discount selection mode over "My listings".
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const reviewedRef = useRef(false)

  // Daily availability review: the FIRST time a seller with live listings opens
  // the dashboard each day, send them through the quick review (auto, not opt-in).
  useEffect(() => {
    if (!user || reviewedRef.current || !data) return
    // Don't hijack an explicit deep-link (e.g. the header "Post" button →
    // ?tab=post): only auto-redirect when the user landed on a bare /dashboard.
    if (searchParams.get('tab')) { reviewedRef.current = true; return }
    if (!data.listings.some((l) => l.status === 'active')) return
    let done = false
    try { done = localStorage.getItem(reviewKey(user.id)) === todayStr() } catch {}
    if (!done) { reviewedRef.current = true; router.replace('/dashboard/availability') }
  }, [user, data, router, searchParams])

  // Drive the tab from ?tab= REACTIVELY (useSearchParams updates on client nav), so
  // the account-menu "Listings"/"Settings" links switch tabs even when ALREADY on
  // /dashboard — a one-time mount effect left them inert in that case.
  useEffect(() => {
    const t = searchParams.get('tab')
    if (t === 'post' || t === 'listings' || t === 'account' || t === 'help' || t === 'dev' || t === 'disputes') setTab(t)
  }, [searchParams])

  const refresh = useCallback(() => {
    const uid = user?.id
    setFetchFailed(false)
    fetch('/api/dashboard')
      .then((r) => (r.ok ? r.json() : { dashboard: null }))
      .then((d) => {
        // Ignore a late response after sign-out / account switch (cross-account safety).
        if (!uid || uid !== user?.id) return
        if (!d.dashboard) { setFetchFailed(true); return }
        setData(d.dashboard)
        try { localStorage.setItem(KEY, JSON.stringify({ userId: uid, dashboard: d.dashboard })) } catch {}
      })
      .catch(() => setFetchFailed(true))
  }, [user?.id])

  useEffect(() => {
    if (!user) { setData(null); return }
    try {
      const c = JSON.parse(localStorage.getItem(KEY) || 'null')
      if (c && c.userId === user.id) setData(c.dashboard)
    } catch {}
    refresh()
  }, [user, refresh])

  // Sparkline series — business tier only, fetched lazily AFTER first paint and
  // only while the listings tab is showing, so it costs individual sellers (and
  // the initial render) nothing. Module-level cache keeps tab flips free.
  const [spark, setSpark] = useState<SparkSeries | null>(null)
  useEffect(() => {
    const uid = user?.id
    if (!uid) { setSpark(null); return }
    if (tab !== 'listings' || data?.tier !== 'business') return
    if (sparkCache?.userId === uid) { setSpark(sparkCache.series); return }
    let cancelled = false
    fetch('/api/dashboard/analytics')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { series?: SparkSeries } | null) => {
        if (cancelled || !j?.series) return
        sparkCache = { userId: uid, series: j.series }
        setSpark(j.series)
      })
      .catch(() => {}) // decorative — a failed fetch just means no sparklines
    return () => { cancelled = true }
  }, [user?.id, tab, data?.tier])

  if (!loading && !user) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <Header />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-md flex-1 space-y-6 px-3 py-10 sm:px-6 lg:px-8">
          <div className="p-8 text-center">
            <h1 className="text-lg font-bold text-foreground">{tr('Your account', 'Tài khoản của bạn')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{tr('Sign in to manage your listings, messages and saved items.', 'Đăng nhập để quản lý tin đăng, tin nhắn và mục đã lưu.')}</p>
            <div className="mt-5"><SignInPrompt /></div>
          </div>
          {/* Language + appearance are device prefs — available before sign-in. */}
          <PreferencesInline />
        </main>
      </div>
    )
  }

  const d = data
  const s = d?.stats
  const isBusiness = d?.tier === 'business'
  // "Needs attention" = LIVE listings only: those held (failed auto-publish) or
  // active-but-stale. Sold/hidden are terminal — never actionable here.
  const needsAttention = d ? d.listings.filter((l) => l.status === 'active' && (!l.verified || isStale(l.availabilityConfirmedAt, l.postedAt))) : []

  // "My listings" filtered by the seller's own search box.
  const qFold = fold(listQ.trim())
  const shownListings = d ? (qFold ? d.listings.filter((l) => fold(`${l.title} ${l.titleVi ?? ''}`).includes(qFold)) : d.listings) : []
  // Only LIVE, priced listings can be discounted — the selectable set for bulk.
  const discountable = shownListings.filter((l) => l.status === 'active' && l.price > 0)
  const selectedItems = discountable.filter((l) => selected.has(l.id))
  const toggleSelect = (id: string) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()) }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 py-6 sm:px-6 lg:px-8">
        {/* Identity header — avatar · name · email · trust, with post + sign out */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar
              name={d?.profile.businessName || d?.profile.displayName || d?.profile.email}
              url={d?.profile.avatarUrl}
              color={d?.profile.avatarColor}
              size="lg"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-bold text-foreground">{d?.profile.businessName || d?.profile.displayName || tr('Your account', 'Tài khoản của bạn')}</h1>
                {d && <TrustScore score={d.profile.trustScore} size="md" showLabel href="/trust" />}
              </div>
              {d?.profile.email && <p className="truncate text-sm text-muted-foreground">{d.profile.email}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {d?.seller && (
              <>
                <a
                  href={d.seller.handle ? `/${d.seller.handle}` : `/sellers/${d.seller.id}`}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold text-body transition-colors hover:bg-muted"
                >
                  <Store className="h-4 w-4" /> {tr('View storefront', 'Xem gian hàng')}
                </a>
                <ShareButton
                  url={`${typeof window !== 'undefined' ? window.location.origin : 'https://eno.vn'}/${d.seller.handle ?? `sellers/${d.seller.id}`}`}
                  title={d.profile.businessName || d.seller.name}
                />
              </>
            )}
            <SignOutButton />
          </div>
        </div>

        {/* Tabs — Post · Listings · Settings · Disputes · [Developers] · Help. All
            render inline under the tab (no redirect). Developers (API keys) is
            business-tier only. */}
        <div className="mt-5 flex flex-wrap items-center gap-1">
          {([
            'post', 'listings', 'account', 'disputes',
            ...(isBusiness ? ['dev' as const] : []),
            'help',
          ] as const).map((tb) => (
            <button
              key={tb}
              onClick={() => { setTab(tb); router.replace(`/dashboard?tab=${tb}`, { scroll: false }) }}
              className={cn(
                '-mb-px flex items-center gap-1 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors cursor-pointer',
                tab === tb ? 'border-brand text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tb === 'post' ? tr('Post', 'Đăng tin')
                : tb === 'listings' ? tr('Listings', 'Tin đăng')
                : tb === 'account' ? tr('Settings', 'Cài đặt')
                : tb === 'disputes' ? tr('Disputes', 'Khiếu nại')
                : tb === 'dev' ? tr('Developers', 'Lập trình')
                : tr('Help', 'Trợ giúp')}
            </button>
          ))}
        </div>

        {tab === 'help' && (
          <div className="mt-6 pb-12">
            <HelpCenter />
          </div>
        )}

        {tab === 'disputes' && (
          <div className="mt-6 pb-12">
            <DisputesPanel compact />
          </div>
        )}

        {tab === 'dev' && isBusiness && (
          <div className="mt-6 pb-12">
            <DevelopersPanel />
          </div>
        )}

        {tab === 'post' && (
          <div className="mt-6">
            <PostWizard
              categories={categories}
              embedded
              onPosted={() => { refresh(); setTab('listings'); router.replace('/dashboard?tab=listings', { scroll: false }) }}
            />
          </div>
        )}

      {tab === 'listings' && (<>
        {/* Enforcement notice — only when the account isn't in good standing or a
            buyer report awaits a reply. What happened, what it means, ONE action. */}
        {d?.enforcement && <EnforcementBanner enforcement={d.enforcement} onChanged={refresh} />}

        {/* Action strip — the 3 questions: messages? performance? needs action? */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={<MessageSquareText className="h-5 w-5" />} value={s?.unreadMessages ?? '—'} label={tr('Unread messages', 'Tin nhắn chưa đọc')} href="/messages" accent={!!s && s.unreadMessages > 0} />
          <StatCard icon={<Clock className="h-5 w-5" />} value={s?.staleCount ?? '—'} label={tr('Need a refresh', 'Cần làm mới')} href="/dashboard/availability" accent={!!s && s.staleCount > 0} />
          <StatCard icon={<Eye className="h-5 w-5" />} value={s?.totalViews ?? '—'} label={tr('Total views', 'Lượt xem')} />
          <StatCard icon={<MessageSquareText className="h-5 w-5" />} value={s?.totalLeads ?? '—'} label={tr('Total leads', 'Liên hệ')} />
        </div>

        {/* Business tier: extra analytics + bulk upload. Shown for ALL business
            accounts (even before their first listing creates a storefront). */}
        {isBusiness && (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard icon={<Tag className="h-5 w-5" />} value={s?.activeCount ?? '—'} label={tr('Live listings', 'Tin hiển thị')} />
            <StatCard icon={<Tag className="h-5 w-5" />} value={s?.soldCount ?? '—'} label={tr('Sold', 'Đã bán')} />
            <StatCard icon={<MessageSquareText className="h-5 w-5" />} value={d?.seller ? `${d.seller.responseRate}%` : '—'} label={tr('Response rate', 'Tỉ lệ phản hồi')} />
            <StatCard icon={<Upload className="h-5 w-5" />} value={tr('Bulk', 'Hàng loạt')} label={tr('Upload via CSV', 'Tải lên CSV')} href="/dashboard/bulk" />
          </div>
        )}

        {/* Tier progress — "your path to {next tier}" (transparency beats anxiety):
            one row per REAL trust criterion, each with exactly one next step. */}
        {d?.trustProgress && (
          <TrustProgress
            score={d.profile.trustScore}
            tier={d.profile.trustTier}
            staleCount={s?.staleCount ?? 0}
            {...d.trustProgress}
          />
        )}

        {/* Business with no storefront yet → nudge to create one. */}
        {isBusiness && d && !d.seller && (
          <div className="mt-6">
            <h2 className="text-sm font-bold text-foreground">{tr('Set up your storefront', 'Tạo gian hàng của bạn')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{tr('Post your first listing to create your business storefront — then you can edit your profile, see analytics and bulk-upload.', 'Đăng tin đầu tiên để tạo gian hàng — sau đó bạn có thể chỉnh hồ sơ, xem phân tích và tải hàng loạt.')}</p>
          </div>
        )}

        {/* Needs attention */}
        {needsAttention.length > 0 && (
          <section className="mt-8">
            <h2 className="h-section text-foreground">{tr('Needs your attention', 'Cần xử lý')} ({needsAttention.length})</h2>
            <p className="mt-0.5 mb-3 text-xs text-muted-foreground">{tr('Confirm availability to bump these back to the top, or mark them sold.', 'Xác nhận còn hàng để đẩy tin lên đầu, hoặc đánh dấu đã bán.')}</p>
            <div className="space-y-2.5">
              {needsAttention.map((l) => <DashboardListingRow key={l.id} listing={l} onChanged={refresh} series={spark ? spark[l.id] ?? [] : undefined} />)}
            </div>
          </section>
        )}

        {/* All listings */}
        <section className="mt-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="h-section text-foreground">{tr('My listings', 'Tin của tôi')}{d ? ` (${d.listings.length})` : ''}</h2>
            <div className="flex items-center gap-2">
              {/* Bulk-discount: enter selection mode (only meaningful when there's a
                  live, priced listing to discount). */}
              {d && discountable.length > 0 && (
                selectMode ? (
                  <button onClick={exitSelect} className="rounded-lg px-2.5 py-1 text-xs font-semibold text-body transition-colors hover:bg-muted cursor-pointer">
                    {tr('Cancel', 'Hủy')}
                  </button>
                ) : (
                  <button onClick={() => setSelectMode(true)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-body transition-colors hover:bg-muted cursor-pointer">
                    <CheckSquare className="h-3.5 w-3.5" /> {tr('Select', 'Chọn')}
                  </button>
                )
              )}
              {/* Line ↔ grid view toggle (mirrors the explorer's). */}
              {d && d.listings.length > 0 && (
                <div className="flex items-center gap-0.5 rounded-xl bg-tint p-0.5">
                  {([['list', List], ['grid', LayoutGrid]] as const).map(([v, Icon]) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      aria-label={v === 'list' ? tr('List view', 'Dạng danh sách') : tr('Grid view', 'Dạng lưới')}
                      aria-pressed={listView === v}
                      className={cn('flex h-7 w-7 items-center justify-center rounded-lg transition-colors cursor-pointer', listView === v ? 'bg-card text-accent-foreground shadow-sm' : 'text-ink-4 hover:text-foreground')}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {/* Select-mode toolbar: select-all / clear + the bulk discount trigger.
              Counts reflect the currently-shown eligible set (search-aware). */}
          {selectMode && d && (() => {
            const allSelected = discountable.length > 0 && discountable.every((l) => selected.has(l.id))
            return (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-accent px-3 py-2">
                <span className="text-xs font-semibold text-accent-foreground">
                  {tr(`${selectedItems.length} selected`, `Đã chọn ${selectedItems.length}`)}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelected(allSelected ? new Set() : new Set(discountable.map((l) => l.id)))}
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-accent-foreground transition-colors hover:bg-brand/10 cursor-pointer"
                  >
                    {allSelected ? tr('Clear', 'Bỏ chọn') : tr('Select all', 'Chọn tất cả')}
                  </button>
                  <Button
                    variant="cta" size="none"
                    onClick={() => setBulkOpen(true)}
                    disabled={selectedItems.length === 0}
                    className="gap-1 rounded-lg px-3 py-1.5 text-xs disabled:opacity-40 cursor-pointer"
                  >
                    <TrendingDown className="h-3.5 w-3.5" /> {tr('Discount', 'Giảm giá')}{selectedItems.length > 0 ? ` (${selectedItems.length})` : ''}
                  </Button>
                </div>
              </div>
            )
          })()}
          {/* Search-your-own-listings — appears once a shop grows past a scannable
              handful so a seller can jump to one item instead of scrolling. */}
          {d && d.listings.length > 10 && (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-tint px-3 py-2 focus-within:ring-2 focus-within:ring-brand/20">
              <Search className="h-4 w-4 shrink-0 text-ink-4" />
              <input
                value={listQ}
                onChange={(e) => setListQ(e.target.value)}
                placeholder={tr('Search your listings…', 'Tìm trong tin của bạn…')}
                aria-label={tr('Search your listings', 'Tìm trong tin của bạn')}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
              {listQ && (
                <button onClick={() => setListQ('')} aria-label={tr('Clear', 'Xóa')} className="shrink-0 text-ink-4 hover:text-foreground cursor-pointer">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
          {!d && fetchFailed ? (
            // Failed fetch with no cache — show error + retry instead of an
            // empty-looking dashboard.
            <EmptyState
              className="mt-4"
              icon={AlertTriangle}
              title={tr("Couldn't load your dashboard.", 'Không tải được trang quản lý.')}
              action={
                <Button variant="cta" size="none" onClick={refresh} className="rounded-xl px-4 py-2 text-xs transition-colors cursor-pointer">
                  {tr('Try again', 'Thử lại')}
                </Button>
              }
            />
          ) : !d ? (
            <div className="mt-4 space-y-2.5">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-[92px] rounded-2xl shimmer" />)}</div>
          ) : d.listings.length === 0 ? (
            <div className="mt-3 py-12 text-center">
              <Mascot name="wave" className="mx-auto h-48 w-48" />
              <p className="mt-3 text-sm text-muted-foreground">{tr('No listings yet — post your first one.', 'Chưa có tin nào — đăng tin đầu tiên.')}</p>
              <Button
                variant="cta" size="none"
                onClick={() => { setTab('post'); router.replace('/dashboard?tab=post', { scroll: false }) }}
                className="mt-4 px-6 py-2.5 cursor-pointer"
              >
                {tr('Post your first listing', 'Đăng tin đầu tiên')}
              </Button>
            </div>
          ) : shownListings.length === 0 ? (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              {tr('No listings match', 'Không có tin nào khớp')} “{listQ.trim()}”.
            </p>
          ) : (
            <div className={cn('mt-3', listView === 'grid' ? 'grid grid-cols-2 gap-2.5 lg:grid-cols-3' : 'space-y-2.5 lg:grid lg:grid-cols-2 lg:gap-2.5 lg:space-y-0')}>
              {shownListings.map((l) => {
                const canSelect = selectMode && l.status === 'active' && l.price > 0
                return (
                  <DashboardListingRow
                    key={l.id}
                    listing={l}
                    onChanged={refresh}
                    variant={listView === 'grid' ? 'grid' : 'row'}
                    series={spark ? spark[l.id] ?? [] : undefined}
                    selectable={canSelect}
                    selected={selected.has(l.id)}
                    onSelectToggle={() => toggleSelect(l.id)}
                  />
                )
              })}
            </div>
          )}
        </section>

        {/* Bulk-discount dialog — % applied across the selected live listings. */}
        <BulkDiscount
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          listings={selectedItems.map((l) => ({ id: l.id, price: l.price, currency: l.currency }))}
          onDone={() => { exitSelect(); refresh() }}
        />
      </>)}

      {tab === 'account' && (
        // Full width, matching every other dashboard tab. On desktop the sections flow
        // into TWO columns (CSS multi-column) with a `column-rule` divider line between —
        // a long single column read sparse. `break-inside-avoid` keeps each section whole;
        // the profile section spans BOTH columns (its form needs the full width). Stacks
        // to one column on mobile.
        <div className="mt-6 pb-12 lg:columns-2 lg:gap-10 lg:[column-rule:1px_solid_var(--border)] [&>*]:mb-9 [&>*]:break-inside-avoid">
          {/* Profile editor — business storefront (with representative) OR the
              individual's own profile. Spans both columns. */}
          {isBusiness && d?.seller ? (
            <SettingsCard
              className="lg:[column-span:all]"
              title={tr('Business profile', 'Hồ sơ doanh nghiệp')}
              description={tr('Your storefront — logo, name, area and contact buyers see.', 'Gian hàng của bạn — logo, tên, khu vực và liên hệ mà người mua thấy.')}
            >
              <BusinessProfileEditor seller={d.seller} repName={d.profile.displayName} onSaved={refresh} />
            </SettingsCard>
          ) : d ? (
            <SettingsCard
              className="lg:[column-span:all]"
              title={tr('Your profile', 'Hồ sơ của bạn')}
              description={tr('Your name, photo and area — how you appear to buyers.', 'Tên, ảnh và khu vực của bạn — cách người mua nhìn thấy bạn.')}
            >
              <ProfileEditor profile={d.profile} onSaved={refresh} />
            </SettingsCard>
          ) : null}

          {/* Public handle — the account's one shareable eno.vn/name link (shop or personal) */}
          <SettingsCard
            title={tr('Handle', 'Tên định danh')}
            description={tr('Your one shareable eno.vn link.', 'Liên kết eno.vn duy nhất bạn có thể chia sẻ.')}
          >
            <HandleSettings />
          </SettingsCard>

          {/* Email — change-email (passwordless app, so this is the only credential here) */}
          {d && (
            <SettingsCard
              title={tr('Email', 'Email')}
              description={tr('Used for sign-in and important account notices.', 'Dùng để đăng nhập và nhận thông báo quan trọng.')}
            >
              <ChangeEmailForm currentEmail={d.profile.email} />
            </SettingsCard>
          )}

          {/* Account type — self-serve individual ↔ business switch */}
          {d && (
            <SettingsCard
              title={tr('Account type', 'Loại tài khoản')}
              description={tr('Switch between an individual and a business account.', 'Chuyển đổi giữa tài khoản cá nhân và doanh nghiệp.')}
            >
              <AccountTypeSwitcher isBusiness={isBusiness} businessName={d.profile.businessName} onSaved={refresh} />
            </SettingsCard>
          )}

          {/* Reminders */}
          <SettingsCard
            title={tr('Reminders', 'Nhắc nhở')}
            description={tr('Get a nudge to keep your listings fresh and answer buyers.', 'Nhận nhắc nhở để giữ tin đăng mới và trả lời người mua.')}
          >
            <ReminderSettings />
          </SettingsCard>

          {/* Preferences — language + appearance. Mobile only: on desktop (sm+) these
              live in the header account dropdown, so they'd be redundant here. */}
          <div className="sm:hidden">
            <SettingsCard
              title={tr('Preferences', 'Tùy chọn')}
              description={tr('Language and appearance.', 'Ngôn ngữ và giao diện.')}
            >
              <PreferencesInline />
            </SettingsCard>
          </div>

          {/* Danger zone — self-service account deletion (PDPL deletion right) */}
          <SettingsCard
            tone="danger"
            title={tr('Danger zone', 'Vùng nguy hiểm')}
            description={tr('Permanently delete your account and all its data.', 'Xóa vĩnh viễn tài khoản và toàn bộ dữ liệu.')}
          >
            <DeleteAccount />
          </SettingsCard>
        </div>
      )}
      </main>
      <Footer />
    </div>
  )
}
