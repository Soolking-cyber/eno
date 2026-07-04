'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, Eye, MessageSquareText, Tag, Clock, Upload, List, LayoutGrid, Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ShareButton } from '@/components/marketplace/share-button'
import { Mascot } from '@/components/marketplace/mascot'
import { HelpCenter } from '@/components/marketplace/help-center'
import { DevelopersPanel } from '@/components/marketplace/developers-panel'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { SignInPrompt, SignOutButton } from '@/components/marketplace/account-actions'
import { DashboardListingRow } from '@/components/marketplace/dashboard-listing-row'
import { TrustScore } from '@/components/marketplace/trust-score'
import { BusinessProfileEditor } from '@/components/marketplace/business-profile-editor'
import { ProfileEditor } from '@/components/marketplace/profile-editor'
import { reviewKey, todayStr } from './availability/availability-client'
import { ReminderSettings } from '@/components/marketplace/reminder-settings'
import { AccountTypeSwitcher } from '@/components/marketplace/account-type-switcher'
import { ChangeEmailForm } from '@/components/marketplace/change-email-form'
import { PreferencesInline } from '@/components/marketplace/preferences-inline'
import { PostWizard } from '@/components/marketplace/post-wizard'
import type { SerializedCategory } from '@/lib/types'
import { isStale } from '@/lib/stale'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import type { SerializedListing } from '@/lib/types'

const KEY = 'eno-dashboard'

type Stats = {
  totalViews: number; totalLeads: number; activeCount: number; soldCount: number
  hiddenCount: number; heldCount: number; staleCount: number; unreadMessages: number
}
type Dashboard = {
  tier: 'business' | 'individual'
  profile: { displayName: string | null; email: string | null; phone: string | null; avatarUrl: string | null; avatarColor: string; businessName: string | null; trustScore: number; trustTier: string }
  seller: { id: string; name: string; verifiedSeller: boolean; trustScore: number; trustTier: string; responseRate: number; bio: string | null; location: string | null; phone: string | null; avatarUrl: string | null } | null
  stats: Stats
  listings: SerializedListing[]
}

// Module-level so it isn't re-created (and its subtree remounted) every render.
function StatCard({ icon, value, label, href, accent }: { icon: React.ReactNode; value: React.ReactNode; label: string; href?: string; accent?: boolean }) {
  const inner = (
    <div className={`flex items-center gap-3 rounded-2xl p-4 ${href ? 'cursor-pointer transition-colors hover:bg-muted' : ''}`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-tint text-accent-foreground">{icon}</span>
      <div className="leading-tight">
        <div className={`text-lg font-bold ${accent ? 'text-accent-foreground' : 'text-foreground'}`}>{value}</div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
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
  const [tab, setTab] = useState<'post' | 'listings' | 'account' | 'help' | 'dev'>('listings')
  // Listings layout: line (rows) vs grid (cards). Persisted per device.
  const [listView, setListView] = useState<'list' | 'grid'>('list')
  useEffect(() => { try { const v = localStorage.getItem('eno-dash-view'); if (v === 'grid' || v === 'list') setListView(v) } catch {} }, [])
  const setView = (v: 'list' | 'grid') => { setListView(v); try { localStorage.setItem('eno-dash-view', v) } catch {} }
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
    if (t === 'post' || t === 'listings' || t === 'account' || t === 'help' || t === 'dev') setTab(t)
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

  if (!loading && !user) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <Header />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-md flex-1 space-y-6 px-3 py-10">
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

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-3 py-6 sm:px-6 lg:px-8">
        {/* Identity header — avatar · name · email · trust, with post + sign out */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {d?.profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.profile.avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold text-white" style={{ backgroundColor: d?.profile.avatarColor || '#0a66c2' }}>
                {(d?.profile.businessName || d?.profile.displayName || d?.profile.email || '?').slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-bold text-foreground">{d?.profile.businessName || d?.profile.displayName || tr('Your account', 'Tài khoản của bạn')}</h1>
                {d && <a href="/trust"><TrustScore score={d.profile.trustScore} size="md" showLabel /></a>}
              </div>
              {d?.profile.email && <p className="truncate text-sm text-muted-foreground">{d.profile.email}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {d?.seller && (
              <>
                <a
                  href={`/sellers/${d.seller.id}`}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold text-body transition-colors hover:bg-muted"
                >
                  <Store className="h-4 w-4" /> {tr('View storefront', 'Xem gian hàng')}
                </a>
                <ShareButton
                  url={`${typeof window !== 'undefined' ? window.location.origin : 'https://eno.vn'}/sellers/${d.seller.id}`}
                  title={d.profile.businessName || d.seller.name}
                />
              </>
            )}
            <SignOutButton />
          </div>
        </div>

        {/* Tabs — Post · Listings · Settings · [Developers] · Help. All render inline
            under the tab (no redirect). Developers (API keys) is business-tier only. */}
        <div className="mt-5 flex flex-wrap items-center gap-1">
          {([
            'post', 'listings', 'account',
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
              {needsAttention.map((l) => <DashboardListingRow key={l.id} listing={l} onChanged={refresh} />)}
            </div>
          </section>
        )}

        {/* All listings */}
        <section className="mt-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="h-section text-foreground">{tr('My listings', 'Tin của tôi')}{d ? ` (${d.listings.length})` : ''}</h2>
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
          {!d && fetchFailed ? (
            // Failed fetch with no cache — show error + retry instead of an
            // empty-looking dashboard (mirrors the explorer's error state).
            <div className="mt-4 flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-line-strong py-14 px-6 text-center">
              <AlertTriangle className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-semibold text-body">{tr("Couldn't load your dashboard.", 'Không tải được trang quản lý.')}</p>
              <Button variant="cta" size="none"
                onClick={refresh}
                className="rounded-xl px-4 py-2 text-xs transition-colors cursor-pointer"
              >
                {tr('Try again', 'Thử lại')}
              </Button>
            </div>
          ) : !d ? (
            <div className="mt-4 space-y-2.5">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-[92px] rounded-2xl shimmer" />)}</div>
          ) : d.listings.length === 0 ? (
            <div className="mt-3 py-12 text-center">
              <Mascot name="wave" className="mx-auto h-48 w-48" />
              <p className="mt-3 text-sm text-muted-foreground">{tr('No listings yet — post your first one.', 'Chưa có tin nào — đăng tin đầu tiên.')}</p>
              <button
                onClick={() => { setTab('post'); router.replace('/dashboard?tab=post', { scroll: false }) }}
                className="mt-4 rounded-xl bg-primary px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-dark cursor-pointer"
              >
                {tr('Post your first listing', 'Đăng tin đầu tiên')}
              </button>
            </div>
          ) : (
            <div className={cn('mt-3', listView === 'grid' ? 'grid grid-cols-2 gap-2.5 lg:grid-cols-3' : 'space-y-2.5')}>
              {d.listings.map((l) => <DashboardListingRow key={l.id} listing={l} onChanged={refresh} variant={listView === 'grid' ? 'grid' : 'row'} />)}
            </div>
          )}
        </section>
      </>)}

      {tab === 'account' && (<>
        {/* Profile editor — business storefront (with representative) OR the
            individual's own profile. */}
        {isBusiness && d?.seller ? (
          <section className="mt-6">
            <h2 className="h-section text-foreground">{tr('Business profile', 'Hồ sơ doanh nghiệp')}</h2>
            <div className="mt-3"><BusinessProfileEditor seller={d.seller} repName={d.profile.displayName} onSaved={refresh} /></div>
          </section>
        ) : d ? (
          <section className="mt-6">
            <h2 className="h-section text-foreground">{tr('Your profile', 'Hồ sơ của bạn')}</h2>
            <div className="mt-3"><ProfileEditor profile={d.profile} onSaved={refresh} /></div>
          </section>
        ) : null}

        {/* Email — change-email (passwordless app, so this is the only credential here) */}
        {d && (
          <section className="mt-8">
            <h2 className="h-section text-foreground">{tr('Email', 'Email')}</h2>
            <div className="mt-3"><ChangeEmailForm currentEmail={d.profile.email} /></div>
          </section>
        )}

        {/* Account type — self-serve individual ↔ business switch */}
        {d && (
          <section className="mt-8">
            <h2 className="h-section text-foreground">{tr('Account type', 'Loại tài khoản')}</h2>
            <div className="mt-3"><AccountTypeSwitcher isBusiness={isBusiness} businessName={d.profile.businessName} onSaved={refresh} /></div>
          </section>
        )}

        {/* Reminders */}
        <section className="mt-8">
          <h2 className="h-section text-foreground">{tr('Reminders', 'Nhắc nhở')}</h2>
          <div className="mt-3"><ReminderSettings /></div>
        </section>

        {/* Preferences — language + appearance. Mobile only: on desktop (sm+) these
            live in the header account dropdown, so they'd be redundant here. */}
        <section className="mt-8 sm:hidden">
          <h2 className="h-section text-foreground mb-3">{tr('Preferences', 'Tùy chọn')}</h2>
          <PreferencesInline />
        </section>
      </>)}
      </main>
      <Footer />
    </div>
  )
}
