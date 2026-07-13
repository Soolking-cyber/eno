'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  X, Store, Settings, Scale, CircleHelp, LogOut, LayoutDashboard,
  MessageSquareText, CalendarCheck, Eye,
} from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { TrustScore } from './trust-score'
import { PreferencesInline } from './preferences-inline'
import { cn } from '@/lib/utils'

// Right-side account/dashboard panel (user decision 2026-07-13): the header
// avatar toggles a panel that slides in right→left and SQUEEZES the marketplace
// on desktop (margin transition on the app wrapper) instead of opening a
// dropdown. Mobile gets an overlay sheet (there's no room to squeeze 390px).
// The panel outlives route changes (it sits outside PageTransitions' subtree
// swap) but closes on navigation so a tapped link shows its destination.

const PANEL_W = 400

const Ctx = createContext<{ open: boolean; setOpen: (o: boolean) => void }>({ open: false, setOpen: () => {} })
export const useAccountPanel = () => useContext(Ctx)

type Me = { displayName: string | null; email: string | null; avatarUrl: string | null; avatarColor: string; sellerId: string | null }
type CachedStats = { unreadMessages: number; staleCount: number; totalViews: number; totalLeads: number } | null

export function AccountPanelShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  // Lazy-mount: guests and signed-in users who never open the panel pay zero
  // render cost for it (same principle as the lazy providers).
  const [mounted, setMounted] = useState(false)
  if (open && !mounted) setMounted(true)

  return (
    <Ctx.Provider value={{ open, setOpen }}>
      <div
        className={cn('transition-[margin] duration-300 motion-reduce:transition-none', open && 'lg:mr-[400px]')}
        style={{ transitionTimingFunction: 'var(--ease-spring)' }}
      >
        {children}
      </div>
      {mounted && <AccountPanel open={open} onClose={() => setOpen(false)} />}
    </Ctx.Provider>
  )
}

function AccountPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, signOut } = useAuth()
  const { tr } = useLanguage()
  const pathname = usePathname()
  const [me, setMe] = useState<Me | null>(null)
  const [stats, setStats] = useState<CachedStats>(null)
  const firstPath = useRef(pathname)

  // Close on navigation — a tapped link should reveal its destination.
  useEffect(() => {
    if (pathname !== firstPath.current) { firstPath.current = pathname; onClose() }
  }, [pathname, onClose])

  // Esc closes (desktop).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Identity + stats: instant paint from the cached dashboard (same pattern the
  // old dropdown used), then revalidate identity from /api/me.
  useEffect(() => {
    if (!user || !open) return
    try {
      const c = JSON.parse(localStorage.getItem('eno-dashboard') || 'null')
      if (c?.userId === user.id && c.dashboard?.profile) {
        const p = c.dashboard.profile
        setMe({ displayName: p.displayName, email: p.email, avatarUrl: p.avatarUrl, avatarColor: p.avatarColor, sellerId: c.dashboard.seller?.id ?? null })
        if (c.dashboard.stats) {
          const s = c.dashboard.stats
          setStats({ unreadMessages: s.unreadMessages ?? 0, staleCount: s.staleCount ?? 0, totalViews: s.totalViews ?? 0, totalLeads: s.totalLeads ?? 0 })
        }
      }
    } catch {}
    fetch('/api/me').then((r) => r.json()).then((d) => { if (d.user) setMe(d.user) }).catch(() => {})
  }, [user, open])

  if (!user) return null
  const initial = (user.email || user.phone || '?').charAt(0).toUpperCase()
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer'

  return (
    <>
      {/* Mobile scrim — desktop squeezes instead of dimming. */}
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <aside
        role="dialog"
        aria-label={tr('Account', 'Tài khoản')}
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-[85vw] flex-col border-l border-border bg-card shadow-overlay transition-transform duration-300 motion-reduce:transition-none',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{ maxWidth: PANEL_W, transitionTimingFunction: 'var(--ease-spring)' }}
      >
        {/* Identity header */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-4">
          {me?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={me.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-bold text-white">{initial}</span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-foreground">{me?.displayName || user.email || user.phone}</p>
            {me?.email && <p className="truncate text-xs text-ink-4">{me.email}</p>}
          </div>
          <button onClick={onClose} aria-label={tr('Close', 'Đóng')} className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-muted hover:text-foreground tap-44 relative">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {/* Quick stats — cache-first from the dashboard payload; hidden until known. */}
          {stats && (
            <div className="mb-3 grid grid-cols-2 gap-2">
              <StatTile icon={<MessageSquareText className="h-4 w-4" />} value={stats.unreadMessages} label={tr('Unread', 'Chưa đọc')} href="/messages" accent={stats.unreadMessages > 0} />
              <StatTile icon={<CalendarCheck className="h-4 w-4" />} value={stats.staleCount} label={tr('Need refresh', 'Cần làm mới')} href="/dashboard/availability" accent={stats.staleCount > 0} />
              <StatTile icon={<Eye className="h-4 w-4" />} value={stats.totalViews} label={tr('Views', 'Lượt xem')} href="/dashboard?tab=listings" />
              <StatTile icon={<Store className="h-4 w-4" />} value={stats.totalLeads} label={tr('Leads', 'Liên hệ')} href="/dashboard?tab=listings" />
            </div>
          )}

          <Link href="/dashboard?tab=listings" className={cn(item, 'bg-accent font-semibold text-accent-foreground hover:bg-brand/15')}>
            <LayoutDashboard className="h-4 w-4" /> {tr('Open dashboard', 'Mở trang quản lý')}
          </Link>
          <div className="mt-1 space-y-0.5">
            <Link href="/dashboard?tab=listings" className={item}>
              <Store className="h-4 w-4 text-accent-foreground" /> {tr('Listings', 'Tin đăng')}
            </Link>
            <Link href="/dashboard?tab=account" className={item}>
              <Settings className="h-4 w-4 text-accent-foreground" /> {tr('Settings', 'Cài đặt')}
            </Link>
            <Link href="/disputes" className={item}>
              <Scale className="h-4 w-4 text-accent-foreground" /> {tr('Disputes', 'Khiếu nại')}
            </Link>
            <Link href="/help" className={item}>
              <CircleHelp className="h-4 w-4 text-accent-foreground" /> {tr('Help', 'Trợ giúp')}
            </Link>
          </div>

          {/* Language + theme — same compact control the dropdown carried. */}
          <div className="mt-2 border-t border-border px-1.5 pb-1 pt-3">
            <PreferencesInline compact />
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

function StatTile({ icon, value, label, href, accent }: { icon: React.ReactNode; value: number; label: string; href: string; accent?: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-2.5 transition-colors hover:bg-muted">
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tint', accent ? 'text-accent-foreground' : 'text-ink-4')}>{icon}</span>
      <span className="min-w-0 leading-tight">
        <span className={cn('block text-sm font-bold', accent ? 'text-accent-foreground' : 'text-foreground')}>{value}</span>
        <span className="block truncate text-2xs text-muted-foreground">{label}</span>
      </span>
    </Link>
  )
}
