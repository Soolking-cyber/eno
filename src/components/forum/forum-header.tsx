'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Languages, LogOut, Plus, Route, Search, Store, UserRound } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { Button, buttonVariants } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const MARKETPLACE_URL = process.env.NEXT_PUBLIC_MARKETPLACE_URL || 'https://eno.vn'

export function ForumHeader({
  query,
  onQueryChange,
  onCreatePost,
}: {
  query?: string
  onQueryChange?: (value: string) => void
  onCreatePost?: () => void
}) {
  const { tr, lang, setLang } = useLanguage()
  const { user, loading, openSignIn, signOut } = useAuth()
  const pathname = usePathname()
  const searchEnabled = typeof query === 'string' && Boolean(onQueryChange)
  const itineraryActive = pathname === '/itinerary'

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 px-3 sm:gap-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" aria-label={tr('eno.forum home', 'Trang chủ eno.forum')}>
          <img src="/logo-mark.svg" alt="" width={44} height={44} className="h-11 w-11" />
          <span className="hidden leading-none min-[390px]:block">
            <span className="block text-lg font-bold tracking-tight text-foreground">{tr('eno.forum', 'eno.forum')}</span>
            <span className="mt-1 block text-3xs font-semibold uppercase tracking-wider text-body">{tr('by eno.vn', 'bởi eno.vn')}</span>
          </span>
        </Link>

        {searchEnabled ? (
          <div className="mx-auto hidden max-w-xl flex-1 sm:block">
            <div className="flex items-center rounded-2xl bg-tint transition-all focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/30">
              <Search className="ml-4 h-5 w-5 shrink-0 text-ink-4" />
              <Input
                variant="unstyled"
                type="search"
                value={query}
                onChange={(event) => onQueryChange?.(event.target.value)}
                placeholder={tr('Search questions, places, and experiences', 'Tìm câu hỏi, địa điểm và kinh nghiệm')}
                aria-label={tr('Search the forum', 'Tìm kiếm trên diễn đàn')}
                className="min-w-0 flex-1 px-3 py-3 text-sm"
              />
            </div>
          </div>
        ) : <div className="flex-1" />}

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <IconButton
            size="lg"
            className="text-body hover:bg-tint hover:text-foreground"
            aria-label={lang === 'en' ? 'Chuyển sang tiếng Việt' : 'Switch to English'}
            onClick={() => setLang(lang === 'en' ? 'vi' : 'en')}
          >
            <Languages className="h-5 w-5" />
          </IconButton>

          <Link
            href="/itinerary"
            className={cn(buttonVariants({ variant: 'soft', size: 'icon' }), 'text-body', itineraryActive && 'bg-accent text-accent-foreground')}
            aria-label={tr('Plan a Vietnam itinerary', 'Lập lịch trình Việt Nam')}
            title={tr('Plan a Vietnam itinerary', 'Lập lịch trình Việt Nam')}
            aria-current={itineraryActive ? 'page' : undefined}
          >
            <Route className="h-5 w-5" />
          </Link>

          <a href={MARKETPLACE_URL} className={cn(buttonVariants({ variant: 'soft', size: 'sm' }), 'hidden text-body lg:inline-flex')}>
            <Store className="h-4 w-4" />
            {tr('Marketplace', 'Chợ mua bán')}
          </a>

          <a
            href={MARKETPLACE_URL}
            className={cn(buttonVariants({ variant: 'soft', size: 'icon' }), 'text-body sm:hidden')}
            aria-label={tr('Open the eno.vn marketplace', 'Mở chợ eno.vn')}
          >
            <Store className="h-5 w-5" />
          </a>

          {!loading && (user ? (
            <DropdownMenu>
              <DropdownMenuTrigger render={
                <Button type="button" variant="outline" size="sm" className="hidden gap-2 sm:inline-flex">
                  <Avatar name={user.user_metadata?.full_name || user.email || 'eno member'} url={user.user_metadata?.avatar_url} size="sm" className="h-6 w-6 text-3xs" />
                  <span className="max-w-24 truncate">{user.user_metadata?.full_name || user.email?.split('@')[0] || tr('Account', 'Tài khoản')}</span>
                </Button>
              } />
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void signOut()}>
                  <LogOut className="h-4 w-4" />
                  {tr('Sign out', 'Đăng xuất')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button type="button" variant="outline" size="sm" className="hidden sm:inline-flex" onClick={openSignIn}>
              <UserRound className="h-4 w-4" />
              {tr('Sign in', 'Đăng nhập')}
            </Button>
          ))}

          {onCreatePost && (
            <>
              <Button data-testid="forum-create" type="button" variant="cta" size="sm" onClick={onCreatePost} className="hidden sm:inline-flex">
                <Plus className="h-4 w-4" />
                {tr('Start a post', 'Tạo bài viết')}
              </Button>

              <IconButton
                data-testid="forum-create"
                size="lg"
                className="bg-primary text-white shadow-sm sm:hidden"
                aria-label={tr('Start a post', 'Tạo bài viết')}
                onClick={onCreatePost}
              >
                <Plus className="h-5 w-5" />
              </IconButton>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
