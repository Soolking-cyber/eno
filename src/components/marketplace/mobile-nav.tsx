'use client'

import { usePathname } from 'next/navigation'
import Link, { useLinkStatus } from 'next/link'
import { Compass, Heart, Plus, User, MessageSquare, Loader2 } from 'lucide-react'
import { useFavorites } from '@/context/favorites-context'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { useChat } from '@/context/chat-context'
import { cn } from '@/lib/utils'

const TAB = 'flex flex-1 cursor-pointer transition-transform active:scale-90'
const BTN = 'flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold text-[#64748b] cursor-pointer transition-transform active:scale-90'

/** Content of a navigating tab. Lives INSIDE <Link> so useLinkStatus can light
 *  the tab + overlay a spinner the instant it's tapped — instant feedback during
 *  the gap before the destination's loading.tsx skeleton swaps in. */
function TabBody({ active, icon, label }: { active: boolean; icon: React.ReactNode; label: string }) {
  const { pending } = useLinkStatus()
  const on = active || pending
  return (
    <span className={cn('flex h-full w-full flex-col items-center justify-center gap-0.5 text-[10px] font-semibold transition-colors', on ? 'text-[#0a66c2]' : 'text-[#64748b]')}>
      <span className="relative">
        {icon}
        {/* Top-LEFT so it never collides with the top-right count badges. */}
        {pending && <Loader2 className="absolute -left-2 -top-1.5 h-3 w-3 animate-spin text-[#0a66c2]" />}
      </span>
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
  const { user, loading, openSignIn } = useAuth()
  const { unread, openInbox } = useChat()

  // Hidden on listing detail (own sticky CTA), chat threads (full-screen composer),
  // and the full-screen sign-in page.
  if (pathname?.startsWith('/listings/') || pathname?.startsWith('/messages/') || pathname?.startsWith('/signin')) return null

  return (
    <nav className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
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

      <button onClick={() => ((user || loading) ? openInbox() : openSignIn())} className={BTN}>
        <span className="relative">
          <MessageSquare className="h-5 w-5" />
          {user && unread > 0 && (
            <span className="absolute -right-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#0a66c2] px-1 text-[9px] font-bold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </span>
        <span>{tr('Messages', 'Tin nhắn')}</span>
      </button>

      {/* Always a link — /account handles both states (cache-first when signed in,
          sign-in prompt when not), so it works even before auth resolves. */}
      <Link href="/account" className={TAB}>
        <TabBody active={pathname === '/account'} icon={<User className="h-5 w-5" />} label={tr('Account', 'Tài khoản')} />
      </Link>
      </div>
    </nav>
  )
}
