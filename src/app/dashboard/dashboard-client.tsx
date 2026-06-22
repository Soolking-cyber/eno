'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Eye, MessageSquareText, Tag, Clock, Store, Upload, Loader2, Plus } from 'lucide-react'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { SignInPrompt } from '@/components/marketplace/account-actions'
import { DashboardListingRow } from '@/components/marketplace/dashboard-listing-row'
import { TrustBadge } from '@/components/marketplace/trust-badge'
import { BusinessProfileEditor } from '@/components/marketplace/business-profile-editor'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import type { SerializedListing } from '@/lib/types'

const KEY = 'eno-dashboard'

type Stats = {
  totalViews: number; totalLeads: number; activeCount: number; soldCount: number
  hiddenCount: number; heldCount: number; staleCount: number; unreadMessages: number
}
type Dashboard = {
  tier: 'business' | 'individual'
  profile: { displayName: string | null; email: string | null; avatarUrl: string | null; avatarColor: string; businessName: string | null; trustScore: number; trustTier: string }
  seller: { id: string; name: string; verifiedSeller: boolean; trustScore: number; trustTier: string; responseRate: number; bio: string | null; location: string | null; avatarUrl: string | null } | null
  stats: Stats
  listings: SerializedListing[]
}

// Module-level so it isn't re-created (and its subtree remounted) every render.
function StatCard({ icon, value, label, href, accent }: { icon: React.ReactNode; value: React.ReactNode; label: string; href?: string; accent?: boolean }) {
  const inner = (
    <div className={`flex items-center gap-3 rounded-2xl border p-4 shadow-pop transition-colors ${accent ? 'border-[#0a66c2]/30 bg-accent' : 'border-border bg-card'} ${href ? 'hover:border-[#0a66c2]/40 cursor-pointer' : ''}`}>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${accent ? 'bg-[#0a66c2] text-white' : 'bg-tint text-accent-foreground'}`}>{icon}</span>
      <div className="leading-tight">
        <div className="text-lg font-bold text-foreground">{value}</div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}

/** Seller CRM dashboard. Cache-first paint (businesses hit it daily) then
 *  revalidate. Tiered: everyone gets stats + listings + messages; business adds
 *  the business-profile editor + bulk upload. Built on semantic tokens (dark-ready). */
export function DashboardClient() {
  const { user, loading } = useAuth()
  const { tr } = useLanguage()
  const [data, setData] = useState<Dashboard | null>(null)

  const refresh = useCallback(() => {
    const uid = user?.id
    fetch('/api/dashboard')
      .then((r) => (r.ok ? r.json() : { dashboard: null }))
      .then((d) => {
        // Ignore a late response after sign-out / account switch (cross-account safety).
        if (!d.dashboard || !uid || uid !== user?.id) return
        setData(d.dashboard)
        try { localStorage.setItem(KEY, JSON.stringify({ userId: uid, dashboard: d.dashboard })) } catch {}
      })
      .catch(() => {})
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
        <main className="mx-auto w-full max-w-md flex-1 px-3 py-10">
          <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-pop">
            <h1 className="text-lg font-bold text-foreground">{tr('Seller dashboard', 'Bảng điều khiển')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{tr('Sign in to manage your listings and messages.', 'Đăng nhập để quản lý tin đăng và tin nhắn.')}</p>
            <div className="mt-5"><SignInPrompt /></div>
          </div>
        </main>
      </div>
    )
  }

  const d = data
  const s = d?.stats
  const isBusiness = d?.tier === 'business'
  // "Needs attention" = LIVE listings only: those held (failed auto-publish) or
  // active-but-stale. Sold/hidden are terminal — never actionable here.
  const needsAttention = d ? d.listings.filter((l) => l.status === 'active' && (!l.verified || Date.now() - new Date(l.availabilityConfirmedAt || l.postedAt).getTime() > 7 * 86_400_000)) : []

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="mx-auto w-full max-w-5xl flex-1 px-3 py-6 sm:px-6">
        {/* Title + trust + post */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h1 className="h-title text-foreground">{d?.profile.businessName || d?.profile.displayName || tr('Dashboard', 'Bảng điều khiển')}</h1>
            {d && <TrustBadge tier={d.profile.trustTier} size="sm" />}
          </div>
          <Link href="/post" className="inline-flex items-center gap-1.5 rounded-xl bg-[#0a66c2] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#004182]">
            <Plus className="h-4 w-4" /> {tr('Post a listing', 'Đăng tin')}
          </Link>
        </div>

        {/* Action strip — the 3 questions: messages? performance? needs action? */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={<MessageSquareText className="h-5 w-5" />} value={s?.unreadMessages ?? '—'} label={tr('Unread messages', 'Tin nhắn chưa đọc')} href="/messages" accent={!!s && s.unreadMessages > 0} />
          <StatCard icon={<Clock className="h-5 w-5" />} value={s?.staleCount ?? '—'} label={tr('Need a refresh', 'Cần làm mới')} accent={!!s && s.staleCount > 0} />
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
          <div className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-pop">
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

        {/* Business profile editor */}
        {isBusiness && d?.seller && (
          <section className="mt-8">
            <h2 className="h-section text-foreground">{tr('Business profile', 'Hồ sơ doanh nghiệp')}</h2>
            <div className="mt-3"><BusinessProfileEditor seller={d.seller} onSaved={refresh} /></div>
          </section>
        )}

        {/* All listings */}
        <section className="mt-8">
          <h2 className="h-section text-foreground">{tr('My listings', 'Tin của tôi')}{d ? ` (${d.listings.length})` : ''}</h2>
          {!d ? (
            <div className="mt-4 space-y-2.5">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-[92px] rounded-2xl shimmer" />)}</div>
          ) : d.listings.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-line-strong py-12 text-center">
              <Store className="mx-auto h-8 w-8 text-ink-4" />
              <p className="mt-2 text-sm text-muted-foreground">{tr('No listings yet — post your first one.', 'Chưa có tin nào — đăng tin đầu tiên.')}</p>
            </div>
          ) : (
            <div className="mt-3 space-y-2.5">
              {d.listings.map((l) => <DashboardListingRow key={l.id} listing={l} onChanged={refresh} />)}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </div>
  )
}
