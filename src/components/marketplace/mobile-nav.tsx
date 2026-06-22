'use client'

import { usePathname } from 'next/navigation'
import Link, { useLinkStatus } from 'next/link'
import { Compass, Heart, Plus, User, MessageSquare } from 'lucide-react'
import { useFavorites } from '@/context/favorites-context'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { useChat } from '@/context/chat-context'
import { useHideOnScroll } from '@/hooks/use-hide-on-scroll'
import { cn } from '@/lib/utils'

const TAB = 'flex flex-1 cursor-pointer transition-transform active:scale-90'

/** Content of a navigating tab. Lives INSIDE <Link> so useLinkStatus can light
 *  the tab blue the instant it's tapped — instant feedback before the destination
 *  loads (no spinner). */
function TabBody({ active, icon, label }: { active: boolean; icon: React.ReactNode; label: string }) {
  const { pending } = useLinkStatus()
  const on = active || pending
  return (
    <span className={cn('flex h-full w-full flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors', on ? 'text-accent-foreground' : 'text-muted-foreground')}>
      <span className="relative">{icon}</span>
      <span>{label}</span>
    </span>
  )
}

/** Mobile-only bottom tab bar (Airbnb pattern). Hidden on listing detail
 *  pages, which show their own sticky contact CTA instead. */
export function MobileNav() {
  const pathname = usePathname()
  const { count } = useFavorites()
  const { tr } = useLanguage()
  const { user } = useAuth()
  const { unread } = useChat()
  // Slide the bar down out of view on scroll-down, back up on scroll-up.
  const hidden = useHideOnScroll()

  // Hidden on listing detail (own sticky CTA), chat threads (full-screen composer),
  // and the full-screen sign-in page.
  if (pathname?.startsWith('/listings/') || pathname?.startsWith('/signin')) return null

  return (
    <nav
      className={cn(
        'lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] transition-transform duration-300 ease-out will-change-transform motion-reduce:transition-none',
        hidden ? 'translate-y-full' : 'translate-y-0',
      )}
    >
      {/* Fixed 64px tab row; the safe-area padding sits BELOW it (filled white) so
          the home-indicator inset never compresses the icons out of the bar. */}
      <div className="flex h-16 items-stretch">
      <Link href="/" className={TAB}>
        <TabBody active={pathname === '/'} icon={<Compass className="h-5 w-5" />} label={tr('Explore', 'Khám phá')} />
      </Link>

      <Link href="/saved" className={TAB}>
        <TabBody
          active={pathname === '/saved'}
          icon={
            <>
              <Heart className={cn('h-5 w-5', count > 0 && 'fill-[#0a66c2] text-[#0a66c2]')} />
              {count > 0 && (
                <span className="absolute -right-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#0a66c2] px-1 text-[9px] font-bold text-white">
                  {count}
                </span>
              )}
            </>
          }
          label={tr('Saved', 'Đã lưu')}
        />
      </Link>

      <Link href="/post" className={TAB}>
        <TabBody
          active={pathname === '/post'}
          icon={
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0a66c2] text-white">
              <Plus className="h-4 w-4" />
            </span>
          }
          label={tr('Post', 'Đăng tin')}
        />
      </Link>

      {/* Full-page route like the other tabs (was an overlay) so switching between
          bottom-nav tabs is a seamless page transition. /messages handles the
          signed-out state itself. */}
      <Link href="/messages" className={TAB}>
        <TabBody
          active={pathname?.startsWith('/messages') ?? false}
          icon={
            <>
              <MessageSquare className="h-5 w-5" />
              {user && unread > 0 && (
                <span className="absolute -right-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#0a66c2] px-1 text-[9px] font-bold text-white">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </>
          }
          label={tr('Messages', 'Tin nhắn')}
        />
      </Link>

      {/* Always a link — /account handles both states (cache-first when signed in,
          sign-in prompt when not), so it works even before auth resolves. */}
      <Link href="/account" className={TAB}>
        <TabBody active={pathname === '/account'} icon={<User className="h-5 w-5" />} label={tr('Account', 'Tài khoản')} />
      </Link>
      </div>
    </nav>
  )
}
