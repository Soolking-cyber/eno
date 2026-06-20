'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Compass, Heart, Plus, User } from 'lucide-react'
import { useFavorites } from '@/context/favorites-context'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { cn } from '@/lib/utils'

/** Mobile-only bottom tab bar (Airbnb pattern). Hidden on listing detail
 *  pages, which show their own sticky contact CTA instead. */
export function MobileNav() {
  const pathname = usePathname()
  const { count } = useFavorites()
  const { tr } = useLanguage()
  const { user, openSignIn } = useAuth()

  // Hidden on listing detail (own sticky CTA) and chat threads (full-screen composer).
  if (pathname?.startsWith('/listings/') || pathname?.startsWith('/messages/')) return null

  const itemCls = (active: boolean) =>
    cn(
      'flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors cursor-pointer',
      active ? 'text-[#0a66c2]' : 'text-[#64748b]',
    )

  return (
    <nav className="lg:hidden fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-slate-200 bg-white/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
      <Link href="/" className={itemCls(pathname === '/')}>
        <Compass className="h-5 w-5" />
        <span>{tr('Explore', 'Khám phá')}</span>
      </Link>
      <Link href="/saved" className={itemCls(pathname === '/saved')}>
        <span className="relative">
          <Heart className={cn('h-5 w-5', count > 0 && 'fill-[#0a66c2] text-[#0a66c2]')} />
          {count > 0 && (
            <span className="absolute -right-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#0a66c2] px-1 text-[9px] font-bold text-white">
              {count}
            </span>
          )}
        </span>
        <span>{tr('Saved', 'Đã lưu')}</span>
      </Link>
      <Link href="/post" className={itemCls(pathname === '/post')}>
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0a66c2] text-white">
          <Plus className="h-4 w-4" />
        </span>
        <span>{tr('Post', 'Đăng tin')}</span>
      </Link>
      {user ? (
        <Link href="/account" className={itemCls(pathname === '/account')}>
          <User className="h-5 w-5" />
          <span>{tr('Account', 'Tài khoản')}</span>
        </Link>
      ) : (
        <button onClick={() => openSignIn()} className={itemCls(false)}>
          <User className="h-5 w-5" />
          <span>{tr('Account', 'Tài khoản')}</span>
        </button>
      )}
    </nav>
  )
}
