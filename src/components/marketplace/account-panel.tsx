'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import {
  X, Store, Settings, Scale, CircleHelp, LogOut, LayoutDashboard,
  MessageSquareText, CalendarCheck, Eye, ChevronLeft, ChevronRight, Upload, Code2,
} from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { PreferencesInline } from './preferences-inline'
import { TrustScore } from './trust-score'
import { DashboardListingRow } from './dashboard-listing-row'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { SerializedListing } from '@/lib/types'

// Right-side account/dashboard panel — THE main dashboard surface (user
// decision 2026-07-13): the header avatar opens it, and its sections (Listings,
// Settings incl. account + seller settings, Disputes, Help) open INSIDE the
// panel, sliding in right→left like the panel itself. Desktop squeezes the
// marketplace (margin transition); mobile is an overlay sheet with the same
// drill-in navigation. The /dashboard page remains for deep links + heavy
// flows (posting, bulk, data-table).

// Heavy sections load on demand — the panel itself is lazy-mounted, and these
// keep the first open cheap too.
const DisputesPanel = dynamic(() => import('./disputes-panel').then((m) => m.DisputesPanel), { ssr: false })
const HelpCenter = dynamic(() => import('./help-center').then((m) => m.HelpCenter), { ssr: false })
const BusinessProfileEditor = dynamic(() => import('./business-profile-editor').then((m) => m.BusinessProfileEditor), { ssr: false })
const ProfileEditor = dynamic(() => import('./profile-editor').then((m) => m.ProfileEditor), { ssr: false })
const HandleSettings = dynamic(() => import('./handle-settings').then((m) => m.HandleSettings), { ssr: false })
const ChangeEmailForm = dynamic(() => import('./change-email-form').then((m) => m.ChangeEmailForm), { ssr: false })
const AccountTypeSwitcher = dynamic(() => import('./account-type-switcher').then((m) => m.AccountTypeSwitcher), { ssr: false })
const ReminderSettings = dynamic(() => import('./reminder-settings').then((m) => m.ReminderSettings), { ssr: false })
const DeleteAccount = dynamic(() => import('./delete-account').then((m) => m.DeleteAccount), { ssr: false })
const DevelopersPanel = dynamic(() => import('./developers-panel').then((m) => m.DevelopersPanel), { ssr: false })
const BulkUploadPanel = dynamic(() => import('./bulk-upload-panel').then((m) => m.BulkUploadPanel), { ssr: false })

export type PanelView = 'root' | 'listings' | 'settings' | 'disputes' | 'dev' | 'bulk' | 'help'

const Ctx = createContext<{
  open: boolean
  setOpen: (o: boolean) => void
  /** Open the panel directly on a section — THE dashboard entry point. */
  openTo: (v: PanelView) => void
  /** Open AFTER the next route change lands — for callers that navigate away as
   *  part of opening (the /dashboard redirect unmounts before it could open,
   *  and the panel's close-on-navigation guard would kill an early open). */
  openAfterNav: (v: PanelView) => void
}>({ open: false, setOpen: () => {}, openTo: () => {}, openAfterNav: () => {} })
export const useAccountPanel = () => useContext(Ctx)

// Light mirror of the /api/dashboard payload (the parts the panel renders).
type Dash = {
  tier: 'business' | 'individual'
  profile: { displayName: string | null; email: string | null; phone: string | null; avatarUrl: string | null; avatarColor: string; businessName: string | null; trustScore: number }
  seller: { id: string; name: string; handle: string | null; responseRate: number; bio: string | null; location: string | null; phone: string | null; avatarUrl: string | null; legalName?: string | null; legalAddress?: string | null; idNumber?: string | null; taxCode?: string | null } | null
  stats: { unreadMessages: number; staleCount: number; totalViews: number; totalLeads: number }
  listings: SerializedListing[]
}

export function AccountPanelShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<PanelView>('root')
  // Lazy-mount: guests and users who never open the panel pay zero render cost.
  const [mounted, setMounted] = useState(false)
  if (open && !mounted) setMounted(true)
  const openTo = useCallback((v: PanelView) => { setView(v); setOpen(true) }, [])

  // Deferred open: fire once the route change has actually landed (the shell
  // outlives every page, so this survives the caller unmounting).
  const pendingRef = useRef<{ v: PanelView; from: string } | null>(null)
  const openAfterNav = useCallback((v: PanelView) => { pendingRef.current = { v, from: pathname } }, [pathname])
  useEffect(() => {
    const p = pendingRef.current
    if (p && pathname !== p.from) { pendingRef.current = null; setView(p.v); setOpen(true) }
  }, [pathname])

  return (
    <Ctx.Provider value={{ open, setOpen, openTo, openAfterNav }}>
      <div
        className={cn('transition-[margin] duration-300 motion-reduce:transition-none', open && 'lg:mr-[440px]')}
        style={{ transitionTimingFunction: 'var(--ease-spring)' }}
      >
        {children}
      </div>
      {mounted && <AccountPanel open={open} view={view} setView={setView} onClose={() => setOpen(false)} />}
    </Ctx.Provider>
  )
}

function AccountPanel({ open, view, setView, onClose }: { open: boolean; view: PanelView; setView: (v: PanelView) => void; onClose: () => void }) {
  const { user, signOut } = useAuth()
  const { tr } = useLanguage()
  const pathname = usePathname()
  const [dash, setDash] = useState<Dash | null>(null)
  const firstPath = useRef(pathname)

  // Cache-first dashboard data (same eno-dashboard cache the page uses), then
  // revalidate once per open. Sections render instantly on repeat opens.
  const refresh = useCallback(() => {
    const uid = user?.id
    if (!uid) return
    fetch('/api/dashboard')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.dashboard || uid !== user?.id) return
        setDash(d.dashboard)
        try { localStorage.setItem('eno-dashboard', JSON.stringify({ userId: uid, dashboard: d.dashboard })) } catch {}
      })
      .catch(() => {})
  }, [user?.id])

  useEffect(() => {
    if (!user || !open) return
    try {
      const c = JSON.parse(localStorage.getItem('eno-dashboard') || 'null')
      if (c?.userId === user.id && c.dashboard) setDash(c.dashboard)
    } catch {}
    refresh()
  }, [user, open, refresh])

  // Close on navigation — links that leave the panel should reveal their page.
  useEffect(() => {
    if (pathname !== firstPath.current) { firstPath.current = pathname; onClose(); setView('root') }
  }, [pathname, onClose])

  // While open on MOBILE, freeze the page behind the overlay — without this the
  // background keeps scrolling under the panel (same body-lock recipe as the
  // gallery lightbox). Desktop squeezes the page instead, so it stays scrollable.
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

  // Esc pops one level first, then closes — mirrors the drill-in metaphor.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (view !== 'root') setView('root')
      else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, view, onClose])

  // Reset to root whenever the panel fully closes.
  useEffect(() => { if (!open) setView('root') }, [open])

  if (!user) return null
  const initial = (user.email || user.phone || '?').charAt(0).toUpperCase()
  const isBusiness = dash?.tier === 'business'
  const stats = dash?.stats
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer'

  const SECTIONS: { key: Exclude<PanelView, 'root'>; label: string; icon: React.ElementType }[] = [
    { key: 'listings', label: tr('Listings', 'Tin đăng'), icon: Store },
    { key: 'settings', label: tr('Settings', 'Cài đặt'), icon: Settings },
    { key: 'disputes', label: tr('Disputes', 'Khiếu nại'), icon: Scale },
    ...(isBusiness ? ([
      { key: 'bulk' as const, label: tr('Bulk upload', 'Tải hàng loạt'), icon: Upload },
      { key: 'dev' as const, label: tr('Developers', 'Lập trình'), icon: Code2 },
    ]) : []),
    { key: 'help', label: tr('Help', 'Trợ giúp'), icon: CircleHelp },
  ]
  const active = SECTIONS.find((s) => s.key === view)

  return (
    <>
      {/* Mobile scrim — desktop squeezes instead of dimming. */}
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          'fixed inset-x-0 top-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 bg-black/40 transition-opacity duration-300 lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        role="dialog"
        aria-label={tr('Account', 'Tài khoản')}
        className={cn(
          // Full screen below lg (the panel IS the dashboard); fixed 440px rail on desktop.
          'fixed top-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] right-0 z-50 flex w-full flex-col border-l border-border bg-background shadow-overlay transition-transform duration-300 motion-reduce:transition-none lg:bottom-0 lg:w-[440px]',
          open ? 'translate-x-0' : 'invisible translate-x-full',
        )}
        style={{ transitionTimingFunction: 'var(--ease-spring)' }}
      >
        {/* Header: identity at root; back + section title inside a section. */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          {view === 'root' ? (
            <>
              {dash?.profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={dash.profile.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">{initial}</span>
              )}
              <div className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-bold text-foreground">{dash?.profile.businessName || dash?.profile.displayName || user.email || user.phone}</p>
                  {typeof dash?.profile.trustScore === 'number' && <TrustScore score={dash.profile.trustScore} size="sm" href="/trust" />}
                </span>
                {dash?.profile.email && <p className="truncate text-xs text-ink-4">{dash.profile.email}</p>}
              </div>
            </>
          ) : (
            <>
              <IconButton size="sm" onClick={() => setView('root')} aria-label={tr('Back', 'Quay lại')} className="text-ink-4 transition-colors hover:bg-muted hover:text-foreground">
                <ChevronLeft className="h-4 w-4" />
              </IconButton>
              <p className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">{active?.label}</p>
            </>
          )}
          <IconButton onClick={onClose} aria-label={tr('Close', 'Đóng')} size="sm" className="text-ink-4 transition-colors hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </IconButton>
        </div>

        {/* Sliding layers: root parks left, sections slide in right→left. */}
        <div className="relative flex-1 overflow-hidden">
          <div
            className={cn(
              'absolute inset-0 overflow-y-auto p-3 transition-transform duration-300 motion-reduce:transition-none',
              view === 'root' ? 'translate-x-0' : 'pointer-events-none -translate-x-1/4 opacity-50',
            )}
            style={{ transitionTimingFunction: 'var(--ease-spring)' }}
          >
            {/* Quick stats — Views/Leads drill into Listings; Unread/refresh navigate. */}
            {stats && (
              <div className="mb-3 grid grid-cols-2 gap-2">
                <StatTile icon={<MessageSquareText className="h-4 w-4" />} value={stats.unreadMessages} label={tr('Unread', 'Chưa đọc')} href="/messages" accent={stats.unreadMessages > 0} />
                <StatTile icon={<CalendarCheck className="h-4 w-4" />} value={stats.staleCount} label={tr('Need refresh', 'Cần làm mới')} href="/dashboard/availability" accent={stats.staleCount > 0} />
                <StatTile icon={<Eye className="h-4 w-4" />} value={stats.totalViews} label={tr('Views', 'Lượt xem')} onClick={() => setView('listings')} />
                <StatTile icon={<Store className="h-4 w-4" />} value={stats.totalLeads} label={tr('Leads', 'Liên hệ')} onClick={() => setView('listings')} />
              </div>
            )}

            <div className="space-y-0.5">
              {SECTIONS.map((s) => (
                <button key={s.key} onClick={() => setView(s.key)} className={cn(item, 'justify-between')}>
                  <span className="flex items-center gap-2.5"><s.icon className="h-4 w-4 text-accent-foreground" /> {s.label}</span>
                  <ChevronRight className="h-4 w-4 text-ink-4" />
                </button>
              ))}
            </div>

            {/* Heavy flows keep their pages; everything else lives in here. */}
            <Link href="/post" className={cn(item, 'mt-2 bg-accent font-semibold text-accent-foreground hover:bg-brand/15')}>
              <LayoutDashboard className="h-4 w-4" /> {tr('Post a listing', 'Đăng tin')}
            </Link>
            {dash?.seller && (
              <a href={dash.seller.handle ? `/${dash.seller.handle}` : `/sellers/${dash.seller.id}`} className={item}>
                <Store className="h-4 w-4 text-accent-foreground" /> {tr('View storefront', 'Xem gian hàng')}
              </a>
            )}

            {/* Language + theme — device prefs, available at root. */}
            <div className="mt-2 border-t border-border px-1.5 pb-1 pt-3">
              <PreferencesInline compact />
            </div>
          </div>

          <div
            className={cn(
              'absolute inset-0 overflow-y-auto bg-background transition-transform duration-300 motion-reduce:transition-none',
              view === 'root' ? 'pointer-events-none translate-x-full' : 'translate-x-0',
            )}
            style={{ transitionTimingFunction: 'var(--ease-spring)' }}
          >
            {view === 'listings' && (
              <div className="space-y-2.5 p-3">
                {!dash ? (
                  <div className="space-y-2.5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-2xl" />)}</div>
                ) : dash.listings.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">{tr('No listings yet — post your first one.', 'Chưa có tin nào — đăng tin đầu tiên.')}</p>
                ) : (
                  dash.listings.map((l) => <DashboardListingRow key={l.id} listing={l} onChanged={refresh} />)
                )}
              </div>
            )}

            {view === 'settings' && dash && (
              <div className="space-y-7 p-4">
                <section>
                  <h3 className="text-sm font-bold text-foreground">{isBusiness ? tr('Business profile', 'Hồ sơ doanh nghiệp') : tr('Your profile', 'Hồ sơ của bạn')}</h3>
                  <div className="mt-3">
                    {isBusiness && dash.seller
                      ? <BusinessProfileEditor seller={dash.seller} repName={dash.profile.displayName} onSaved={refresh} />
                      : <ProfileEditor profile={dash.profile} onSaved={refresh} />}
                  </div>
                </section>
                <section>
                  <h3 className="text-sm font-bold text-foreground">{tr('Handle', 'Tên định danh')}</h3>
                  <div className="mt-3"><HandleSettings /></div>
                </section>
                <section>
                  <h3 className="text-sm font-bold text-foreground">{tr('Email', 'Email')}</h3>
                  <div className="mt-3"><ChangeEmailForm currentEmail={dash.profile.email} /></div>
                </section>
                <section>
                  <h3 className="text-sm font-bold text-foreground">{tr('Account type', 'Loại tài khoản')}</h3>
                  <div className="mt-3"><AccountTypeSwitcher isBusiness={isBusiness} businessName={dash.profile.businessName} onSaved={refresh} /></div>
                </section>
                <section>
                  <h3 className="text-sm font-bold text-foreground">{tr('Reminders', 'Nhắc nhở')}</h3>
                  <div className="mt-3"><ReminderSettings /></div>
                </section>
                <section>
                  <h3 className="text-sm font-bold text-destructive">{tr('Danger zone', 'Vùng nguy hiểm')}</h3>
                  <div className="mt-3"><DeleteAccount /></div>
                </section>
              </div>
            )}

            {view === 'disputes' && <div className="p-3"><DisputesPanel compact /></div>}
            {view === 'dev' && <div className="p-3"><DevelopersPanel /></div>}
            {view === 'bulk' && <div className="p-4"><BulkUploadPanel onDone={() => setView('listings')} /></div>}
            {view === 'help' && <div className="p-3"><HelpCenter /></div>}
          </div>
        </div>

        <div className="border-t border-border p-3">
          <button onClick={() => { onClose(); signOut() }} className={`${item} hover:bg-destructive/10 hover:text-destructive`}>
            <LogOut className="h-4 w-4" /> {tr('Sign out', 'Đăng xuất')}
          </button>
        </div>
      </aside>
    </>
  )
}

function StatTile({ icon, value, label, href, onClick, accent }: { icon: React.ReactNode; value: number; label: string; href?: string; onClick?: () => void; accent?: boolean }) {
  const inner = (
    <>
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tint', accent ? 'text-accent-foreground' : 'text-ink-4')}>{icon}</span>
      <span className="min-w-0 leading-tight">
        <span className={cn('block text-sm font-bold', accent ? 'text-accent-foreground' : 'text-foreground')}>{value}</span>
        <span className="block truncate text-2xs text-muted-foreground">{label}</span>
      </span>
    </>
  )
  const cls = 'flex items-center gap-2.5 rounded-xl border border-border bg-card p-2.5 text-left transition-colors hover:bg-muted cursor-pointer'
  return href
    ? <Link href={href} className={cls}>{inner}</Link>
    : <button onClick={onClick} className={cls}>{inner}</button>
}
