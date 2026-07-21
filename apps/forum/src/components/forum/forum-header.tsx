'use client'

import Link from 'next/link'
import { LogIn, Plus, Search } from 'lucide-react'
import { useAuth } from '@/context/auth-context'
import { useLanguage } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Minimal forum header: logo, search, the create action on the forum home, and — for a
 * SIGNED-OUT visitor only — a way to log in.
 *
 * Account, language, and dashboard controls still live in the ONE eno dashboard on eno.vn
 * and never here; the e2e spec that guards that runs SIGNED IN, and this control renders
 * only when signed out, so the "no duplicate dashboard rail" contract is untouched.
 *
 * WHY IT HAD TO EXIST (owner 2026-07-21: "eno.forum no login place"). The forum has a
 * complete SignInDialog, but nothing ever opened it except ATTEMPTING a gated action —
 * starting a post, saving an itinerary. A visitor had to guess. That was survivable while
 * the forum was a side surface; it stopped being survivable when the forum became the SEO
 * landing surface, because organic traffic arrives on a post permalink with no idea that
 * "Start a post" is also the login.
 *
 * ⚠️ It opens the FORUM's own dialog, not eno.vn's. Sessions are per-origin cookies: signing
 * in on eno.vn does NOT sign you in here, so sending a signed-out visitor to eno.vn/dashboard
 * would walk them through a login and return them still signed out.
 *
 * OPT-IN per surface (`allowSignIn`), and off by default. /itinerary and /visa keep their
 * deliberate zero-chrome header — they are focused task flows that already prompt for auth at
 * the moment you act, and an e2e spec pins them at zero header buttons. The control belongs on
 * the surfaces where someone ARRIVES cold: the feed and the post permalinks that organic search
 * lands on.
 */
export function ForumHeader({
  query,
  onQueryChange,
  onCreatePost,
  allowSignIn = false,
}: {
  query?: string
  onQueryChange?: (value: string) => void
  onCreatePost?: () => void
  /** Show the signed-out "Log in" control. Off by default — see the note above. */
  allowSignIn?: boolean
}) {
  const { tr } = useLanguage()
  const { user, loading, openSignIn } = useAuth()
  const searchEnabled = typeof query === 'string' && Boolean(onQueryChange)
  // Render nothing until auth resolves — flashing "Log in" at someone who IS logged in is
  // worse than a beat of nothing.
  const showSignIn = allowSignIn && !loading && !user

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

        <div className="ml-auto flex items-center gap-2">
          {onCreatePost && (
            <Button data-testid="forum-create" type="button" variant="cta" size="sm" onClick={onCreatePost} className="hidden sm:inline-flex">
              <Plus className="h-4 w-4" />
              {tr('Start a post', 'Tạo bài viết')}
            </Button>
          )}
          {showSignIn && (
            <Button data-testid="forum-signin" type="button" variant="outline" size="sm" onClick={openSignIn}>
              <LogIn className="h-4 w-4" />
              {tr('Log in', 'Đăng nhập')}
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
