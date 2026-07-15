'use client'

import Link from 'next/link'
import { Bell, Plus, Search, Store, UserRound } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { useAccountPanel } from '@/components/marketplace/account-panel'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'

export function ForumHeader({
  query,
  onQueryChange,
  onCreatePost,
}: {
  query: string
  onQueryChange: (value: string) => void
  onCreatePost: () => void
}) {
  const { tr } = useLanguage()
  const { user, loading, openSignIn } = useAuth()
  const { openTo } = useAccountPanel()
  const displayName = String(user?.user_metadata?.full_name || user?.email || tr('Your profile', 'Hồ sơ của bạn'))

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-card/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 px-3 sm:gap-4 sm:px-6 lg:px-8">
        <Link href="/forum" className="flex shrink-0 items-center gap-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-xl" aria-label={tr('eno.forum home', 'Trang chủ eno.forum')}>
          <img src="/logo-mark.svg" alt="" width={44} height={44} className="h-11 w-11" />
          <span className="hidden leading-none min-[390px]:block">
            <span className="block text-lg font-bold tracking-tight text-foreground">{tr('eno.forum', 'eno.forum')}</span>
            <span className="mt-1 block text-3xs font-semibold uppercase tracking-wider text-body">{tr('by eno.vn', 'bởi eno.vn')}</span>
          </span>
        </Link>

        <div className="mx-auto hidden max-w-xl flex-1 sm:block">
          <div className="flex items-center rounded-2xl bg-tint transition-all focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/30">
            <Search className="ml-4 h-5 w-5 shrink-0 text-ink-4" />
            <Input
              variant="unstyled"
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={tr('Search questions, places, and experiences', 'Tìm câu hỏi, địa điểm và kinh nghiệm')}
              aria-label={tr('Search the forum', 'Tìm kiếm trên diễn đàn')}
              className="min-w-0 flex-1 px-3 py-3 text-sm"
            />
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <Button variant="soft" size="sm" asChild className="hidden text-body lg:inline-flex">
            <Link href="/">
              <Store className="h-4 w-4" />
              {tr('Marketplace', 'Chợ mua bán')}
            </Link>
          </Button>

          <IconButton
            size="lg"
            className="hidden text-body transition-colors hover:bg-tint hover:text-foreground sm:flex"
            aria-label={tr('Notifications', 'Thông báo')}
            onClick={() => toast.message(tr('You are all caught up.', 'Bạn đã xem hết thông báo.'))}
          >
            <Bell className="h-5 w-5" />
          </IconButton>

          {!loading && user ? (
            <Button
              type="button"
              variant="bare"
              size="none"
              className="rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onClick={() => openTo('root')}
              aria-label={tr('Open your profile', 'Mở hồ sơ của bạn')}
            >
              <Avatar name={displayName} url={user.user_metadata?.avatar_url} size="sm" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="hidden sm:inline-flex"
              onClick={() => openSignIn()}
            >
              <UserRound className="h-4 w-4" />
              {tr('Sign in', 'Đăng nhập')}
            </Button>
          )}

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
        </div>
      </div>
    </header>
  )
}
