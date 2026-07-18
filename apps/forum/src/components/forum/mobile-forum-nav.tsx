'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Bookmark, Flame, Home, Plus, Store, UserRound } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { ENO_DASHBOARD_URL } from '@/lib/eno-dashboard'
import { useVirtualKeyboard } from '@/hooks/use-virtual-keyboard'
import { isEnoApp } from '@/components/native/forum-native-bridge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const MARKETPLACE_URL = (process.env.NEXT_PUBLIC_MARKETPLACE_URL || 'https://eno.vn').replace(/\/$/, '')

type ForumNavMode = 'all' | 'saved'
type ForumNavSort = 'best' | 'latest' | 'top'

export function MobileForumNav({
  mode,
  sort,
  savedCount,
  onHome,
  onPopular,
  onCreate,
  onSaved,
}: {
  mode: ForumNavMode
  sort: ForumNavSort
  savedCount: number
  onHome: () => void
  onPopular: () => void
  onCreate: () => void
  onSaved: () => void
}) {
  const { tr } = useLanguage()
  const { open: keyboardOpen } = useVirtualKeyboard()
  // App-mode is decided after mount (UA/bridge globals are client-only) so the
  // server markup — and therefore the web experience — stays the 5-tab nav.
  const [app, setApp] = useState(false)
  useEffect(() => { setApp(isEnoApp()) }, [])
  const itemClass = 'relative flex h-full flex-1 flex-col items-center justify-center gap-1 text-3xs font-semibold'

  return (
    <nav
      inert={keyboardOpen}
      className={cn(
        'mobile-nav fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] transition-[transform,opacity] duration-[250ms] lg:hidden',
        keyboardOpen && 'pointer-events-none translate-y-full opacity-0',
      )}
      aria-label={tr('Forum mobile navigation', 'Điều hướng diễn đàn trên di động')}
    >
      <div className="flex h-16 items-stretch">
        <Button type="button" variant="bare" size="none" aria-pressed={mode === 'all' && sort === 'best'} className={cn(itemClass, mode === 'all' && sort === 'best' ? 'text-accent-foreground' : 'text-body')} onClick={onHome}>
          <Home className="h-5 w-5" />
          <span>{tr('Home', 'Trang chủ')}</span>
        </Button>
        <Button type="button" variant="bare" size="none" aria-pressed={mode === 'all' && sort === 'top'} className={cn(itemClass, mode === 'all' && sort === 'top' ? 'text-accent-foreground' : 'text-body')} onClick={onPopular}>
          <Flame className="h-5 w-5" />
          <span>{tr('Popular', 'Phổ biến')}</span>
        </Button>
        <Button type="button" variant="bare" size="none" className={itemClass} onClick={onCreate} aria-label={tr('Start a post', 'Tạo bài viết')}>
          <span className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-card">
            <Plus className="h-6 w-6" />
          </span>
          <span className="-mt-0.5 text-body">{tr('Post', 'Đăng')}</span>
        </Button>
        {app && (
          /* Plain link on purpose: inside the one native app the WebView keeps
             eno.vn in-app (allowNavigation) and the eno.vn side owns reverse-SSO. */
          <a href={MARKETPLACE_URL} className={cn(itemClass, 'text-body')}>
            <Store className="h-5 w-5" />
            <span>{tr('Market', 'Chợ')}</span>
          </a>
        )}
        <Button type="button" variant="bare" size="none" aria-pressed={mode === 'saved'} className={cn(itemClass, mode === 'saved' ? 'text-accent-foreground' : 'text-body')} onClick={onSaved}>
          <span className="relative">
            <Bookmark className={cn('h-5 w-5', mode === 'saved' && 'fill-current')} />
            {savedCount > 0 && <Badge variant="counter-brand" size="count" className="absolute -right-3 -top-2">{savedCount}</Badge>}
          </span>
          <span>{tr('Saved', 'Đã lưu')}</span>
        </Button>
        {/* Plain external link on purpose: the ONE eno dashboard lives on eno.vn.
            Inside the native app the WebView keeps eno.vn in-app (allowNavigation)
            and the eno.vn side owns reverse-SSO. */}
        <a href={ENO_DASHBOARD_URL} className={cn(itemClass, 'text-body')}>
          <UserRound className="h-5 w-5" />
          <span>{tr('Account', 'Tài khoản')}</span>
        </a>
      </div>
    </nav>
  )
}

/**
 * App-mode-only global mount (layout.tsx): inside the native app every main surface
 * (itinerary, visa, dashboard, …) carries the bottom nav so the two domains feel like
 * one app. On the web this renders nothing — the nav stays a forum-home feature owned
 * by ForumClient, which also owns '/' in app-mode (its mount has the live feed state).
 */
export function AppForumNav() {
  const router = useRouter()
  const pathname = usePathname()
  const { tr } = useLanguage()
  const { open: keyboardOpen } = useVirtualKeyboard()
  const [app, setApp] = useState(false)
  useEffect(() => { setApp(isEnoApp()) }, [])
  if (!app || pathname === '/' || pathname.startsWith('/admin') || pathname.startsWith('/auth')) return null
  // Away from the home feed, Popular/Post/Saved can't perform their actions (that state
  // lives inside ForumClient on '/'), so this bar carries ONLY tabs that do what they
  // say: Home, Market, Account. The full feed bar appears on '/', owned by ForumClient.
  const itemClass = 'relative flex h-full flex-1 flex-col items-center justify-center gap-1 text-3xs font-semibold'
  return (
    <>
      <div aria-hidden className="bottom-nav-spacer h-16 lg:hidden" />
      <nav
        inert={keyboardOpen}
        className={cn(
          'mobile-nav fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] transition-[transform,opacity] duration-[250ms] lg:hidden',
          keyboardOpen && 'pointer-events-none translate-y-full opacity-0',
        )}
        aria-label={tr('App navigation', 'Điều hướng ứng dụng')}
      >
        <div className="flex h-16 items-stretch">
          <Button type="button" variant="bare" size="none" className={cn(itemClass, 'text-body')} onClick={() => router.push('/')}>
            <Home className="h-5 w-5" />
            <span>{tr('Forum', 'Diễn đàn')}</span>
          </Button>
          {/* Plain link on purpose: inside the one native app the WebView keeps
              eno.vn in-app (allowNavigation) and the eno.vn side owns reverse-SSO. */}
          <a href={MARKETPLACE_URL} className={cn(itemClass, 'text-body')}>
            <Store className="h-5 w-5" />
            <span>{tr('Market', 'Chợ')}</span>
          </a>
          {/* Plain external link on purpose: the ONE eno dashboard lives on eno.vn. */}
          <a href={ENO_DASHBOARD_URL} className={cn(itemClass, 'text-body')}>
            <UserRound className="h-5 w-5" />
            <span>{tr('Account', 'Tài khoản')}</span>
          </a>
        </div>
      </nav>
    </>
  )
}
