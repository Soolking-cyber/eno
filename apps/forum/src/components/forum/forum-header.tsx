'use client'

import Link from 'next/link'
import { Check, Languages, Plus, Search, UserRound } from 'lucide-react'
import { LANGUAGES, useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { useEnoAccountShell } from '@/components/dashboard/eno-account-shell'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'

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
  const { user, loading, openSignIn } = useAuth()
  const { openAccount } = useEnoAccountShell()
  const searchEnabled = typeof query === 'string' && Boolean(onQueryChange)

  return (
    <header id="app-header" className="sticky top-0 z-40 bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 border-b border-border/60 px-3 sm:gap-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" aria-label={tr('eno.forum home', 'Trang chủ eno.forum')}>
          <img src="/logo.svg" alt="eno" width={1200} height={300} className="h-8 w-auto" />
        </Link>

        {searchEnabled ? (
          <div className="mx-auto hidden min-w-0 max-w-xl flex-1 sm:block">
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
          <DropdownMenu>
            <DropdownMenuTrigger render={
              <Button
                type="button"
                variant="bare"
                size="sm"
                className="h-11 gap-1.5 px-2.5 text-body hover:bg-tint hover:text-foreground"
                aria-label={tr('Choose language', 'Chọn ngôn ngữ')}
              >
                <Languages className="h-5 w-5" />
                <span className="text-xs font-bold">{LANGUAGES.find((item) => item.code === lang)?.label}</span>
              </Button>
            } />
            <DropdownMenuContent align="end" className="w-56">
              {LANGUAGES.map((language) => (
                <DropdownMenuItem key={language.code} onClick={() => setLang(language.code)}>
                  <span className="w-7 text-xs font-bold text-ink-4">{language.label}</span>
                  <span className="min-w-0 flex-1 truncate">{language.native}</span>
                  {lang === language.code && <Check className="ml-auto h-4 w-4 text-accent-foreground" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {!loading && (user ? (
            <Button type="button" variant="outline" size="sm" className="h-10 gap-2 px-2 sm:px-3" aria-label={tr('Open eno dashboard', 'Mở bảng điều khiển eno')} onClick={openAccount}>
              <Avatar name={user.user_metadata?.full_name || user.email || 'eno member'} url={user.user_metadata?.avatar_url} size="sm" className="h-6 w-6 text-3xs" />
              <span className="hidden max-w-24 truncate sm:inline">{user.user_metadata?.full_name || user.email?.split('@')[0] || tr('Account', 'Tài khoản')}</span>
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" className="h-10 px-2 sm:px-3" onClick={openSignIn} aria-label={tr('Sign in to eno', 'Đăng nhập eno')}>
              <UserRound className="h-4 w-4" />
              <span className="hidden sm:inline">{tr('Sign in', 'Đăng nhập')}</span>
            </Button>
          ))}

          {onCreatePost && (
            <Button data-testid="forum-create" type="button" variant="cta" size="sm" onClick={onCreatePost} className="hidden sm:inline-flex">
              <Plus className="h-4 w-4" />
              {tr('Start a post', 'Tạo bài viết')}
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
