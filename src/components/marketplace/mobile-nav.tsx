'use client'

import { usePathname } from 'next/navigation'
import Link, { useLinkStatus } from 'next/link'
import { Compass, Heart, Plus, User, MessageSquare } from 'lucide-react'
import { useFavorites } from '@/context/favorites-context'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { useChat } from '@/context/chat-context'
import { useHideOnScroll } from '@/hooks/use-hide-on-scroll'
import { useSlideRouter } from './page-transitions'
import { cn } from '@/lib/utils'

const TAB = 'flex flex-1 cursor-pointer transition-transform active:scale-90'

// Tab order drives the slide direction: tapping a tab to the RIGHT slides forward
// (new from the right), to the LEFT slides back (new from the left).
const TAB_ORDER = ['/', '/saved', '/post', '/messages', '/dashboard']
function tabIndex(path: string): number {
  if (path === '/') return 0
  const i = TAB_ORDER.findIndex((t) => t !== '/' && path.startsWith(t))
  return i === -1 ? 0 : i
}

/** Content of a navigating tab. Facebook-style: a big, clear, label-LESS icon (the
 *  accessible name lives on the parent <Link>'s aria-label). Active = blue icon + a
 *  short bar at the top of the bar. Lives INSIDE <Link> so useLinkStatus can light it
 *  blue the instant it's tapped — instant feedback before the destination loads. */
function TabBody({ active, icon }: { active: boolean; icon: React.ReactNode }) {
  const { pending } = useLinkStatus()
  const on = active || pending
  return (
    <span className={cn('relative flex h-full w-full items-center justify-center transition-colors', on ? 'text-accent-foreground' : 'text-body')}>
      {on && <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-full bg-accent-foreground" />}
      <span className="relative">{icon}</span>
    </span>
  )
}

/** A tab that needs sign-in (Post / Messages / Account). When auth has resolved to
 *  logged-out, tapping opens the standardized sign-in modal instead of navigating
 *  to a page that would gate inconsistently — so every gated action on mobile
 *  meets the SAME card. While auth is still resolving (or signed in) it's a normal
 *  Link, so a logged-in user is never wrongly shown the modal. */
function GatedTab({ href, active, icon, label, gate, onNavigate }: { href: string; active: boolean; icon: React.ReactNode; label: string; gate: boolean; onNavigate: () => void }) {
  const { openSignIn } = useAuth()
  if (gate) {
    return (
      <button type="button" onClick={openSignIn} aria-label={label} className={TAB}>
        <span className="flex h-full w-full items-center justify-center text-body transition-colors">
          <span className="relative">{icon}</span>
        </span>
      </button>
    )
  }
  // Keep the <Link> (prefetch + a11y) but drive the actual nav through the slide
  // router so it animates directionally.
  return (
    <Link href={href} aria-label={label} className={TAB} onClick={(e) => { e.preventDefault(); onNavigate() }}>
      <TabBody active={active} icon={icon} />
    </Link>
  )
}

/** Mobile-only bottom tab bar (Airbnb pattern). Hidden on listing detail
 *  pages, which show their own sticky contact CTA instead. */
export function MobileNav() {
  const pathname = usePathname()
  const { count } = useFavorites()
  const { tr } = useLanguage()
  const { user, loading } = useAuth()
  const { unread } = useChat()
  const { navigate } = useSlideRouter()
  // Slide the bar down out of view on scroll-down, back up on scroll-up.
  const hidden = useHideOnScroll()

  // Navigate with an FB-style directional slide: right if the target tab is further
  // right than the current one, left otherwise.
  const go = (href: string) => {
    const from = tabIndex(pathname || '/')
    const to = TAB_ORDER.indexOf(href)
    navigate(href, to >= from ? 'forward' : 'back')
  }

  // Hidden on listing detail (own sticky CTA), chat threads (full-screen composer),
  // and the full-screen sign-in page.
  if (pathname?.startsWith('/listings/') || pathname?.startsWith('/signin')) return null

  // Gate auth-only tabs once auth has resolved logged-out. During the brief boot
  // window (loading) leave them as Links so a logged-in user is never flashed the
  // modal; the destination page is a backstop. Saved/Explore are public (favorites
  // are device-local), so they're never gated.
  const gate = !loading && !user

  return (
    <nav
      className={cn(
        'lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] transition-[transform,opacity] duration-[250ms] ease-out [will-change:transform,opacity] motion-reduce:transition-none',
        // Facebook-style: slide DOWN off-screen + fade out at the same rate on scroll-down;
        // slide up + fade in on scroll-up.
        hidden ? 'translate-y-full opacity-0' : 'translate-y-0 opacity-100',
      )}
    >
      {/* Fixed 64px tab row; the safe-area padding sits BELOW it (filled white) so
          the home-indicator inset never compresses the icons out of the bar. */}
      <div className="flex h-16 items-stretch">
      <Link href="/" aria-label={tr('Explore', 'Khám phá')} className={TAB} onClick={(e) => { e.preventDefault(); go('/') }}>
        <TabBody active={pathname === '/'} icon={<Compass className="h-7 w-7" />} />
      </Link>

      {/* Saved is public — favorites are stored device-local (localStorage), so a
          logged-out visitor can save and review listings without an account. */}
      <Link href="/saved" aria-label={tr('Saved', 'Đã lưu')} className={TAB} onClick={(e) => { e.preventDefault(); go('/saved') }}>
        <TabBody
          active={pathname === '/saved'}
          icon={
            <>
              <Heart className={cn('h-7 w-7', count > 0 && 'fill-[#0a66c2] text-[#0a66c2]')} />
              {count > 0 && (
                <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0a66c2] px-1 text-[10px] font-bold text-white">
                  {count}
                </span>
              )}
            </>
          }
        />
      </Link>

      <GatedTab
        href="/post"
        active={pathname === '/post'}
        gate={gate}
        onNavigate={() => go('/post')}
        icon={
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0a66c2] text-white shadow-sm">
            <Plus className="h-6 w-6" />
          </span>
        }
        label={tr('Post', 'Đăng tin')}
      />

      <GatedTab
        href="/messages"
        active={pathname?.startsWith('/messages') ?? false}
        gate={gate}
        onNavigate={() => go('/messages')}
        icon={
          <>
            <MessageSquare className="h-7 w-7" />
            {user && unread > 0 && (
              <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#0a66c2] px-1 text-[10px] font-bold text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </>
        }
        label={tr('Messages', 'Tin nhắn')}
      />

      <GatedTab
        href="/dashboard"
        active={pathname === '/dashboard'}
        gate={gate}
        onNavigate={() => go('/dashboard')}
        icon={<User className="h-7 w-7" />}
        label={tr('Account', 'Tài khoản')}
      />
      </div>
    </nav>
  )
}
