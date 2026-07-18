'use client'

import Link from 'next/link'
import { Plus, Search } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Minimal forum header: logo, search, and the create action on the forum home.
 * Account, language, and dashboard controls live in the ONE eno dashboard on
 * eno.vn (and in the forum's own left rail for entry) — never here. The e2e
 * spec asserts #app-header carries ZERO buttons on /itinerary and /visa.
 */
export function ForumHeader({
  query,
  onQueryChange,
  onCreatePost,
}: {
  query?: string
  onQueryChange?: (value: string) => void
  onCreatePost?: () => void
}) {
  const { tr } = useLanguage()
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

        {onCreatePost && (
          <div className="ml-auto flex items-center">
            <Button data-testid="forum-create" type="button" variant="cta" size="sm" onClick={onCreatePost} className="hidden sm:inline-flex">
              <Plus className="h-4 w-4" />
              {tr('Start a post', 'Tạo bài viết')}
            </Button>
          </div>
        )}
      </div>
    </header>
  )
}
