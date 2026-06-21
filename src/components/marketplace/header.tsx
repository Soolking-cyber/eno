'use client'

import Link from 'next/link'
import { Plus, User } from 'lucide-react'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { useHideOnScroll } from '@/hooks/use-hide-on-scroll'
import { cn } from '@/lib/utils'
import { AccountMenu } from './account-menu'

export function Header() {
  const { t, tr } = useLanguage()
  const { user } = useAuth()
  // Roll the bar up on scroll-down, back down on scroll-up (mobile only — the
  // desktop header stays pinned via lg:translate-y-0).
  const hidden = useHideOnScroll()

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b border-slate-200/60 bg-card pt-[env(safe-area-inset-top)] transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none',
        hidden ? '-translate-y-full lg:translate-y-0' : 'translate-y-0',
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center">
          <img src="/logo-mark.svg" alt="ENO" width={40} height={40} className="h-10 w-10" />
        </Link>

        {/* Actions — Saved, Messages and Language now live in the bottom nav +
            profile preferences, so the header stays clean (no heart/notif). */}
        <div className="flex items-center gap-2">
          {user ? (
            <div className="hidden sm:block"><AccountMenu /></div>
          ) : (
            <Link
              href="/signin"
              className="hidden sm:flex items-center gap-1.5 rounded-full px-2.5 h-9 text-sm font-semibold text-[#1a202c] transition-colors hover:bg-[#e8f1fb] hover:text-[#0a66c2] cursor-pointer"
              aria-label={tr('Sign in', 'Đăng nhập')}
            >
              <User className="h-5 w-5" />
              <span className="hidden lg:inline">{tr('Log in', 'Đăng nhập')}</span>
            </Link>
          )}

          <Link
            href="/post"
            className="hidden items-center gap-1.5 rounded-full bg-[#0a66c2] px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-[#004182] sm:flex cursor-pointer"
          >
            <Plus className="h-4 w-4" /> {t('header.postBtn')}
          </Link>
        </div>
      </div>
    </header>
  )
}
