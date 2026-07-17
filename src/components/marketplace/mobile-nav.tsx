'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link, { useLinkStatus } from 'next/link'
import { Compass, Heart, Plus, User, MessageSquare } from 'lucide-react'
import { useFavorites } from '@/context/favorites-context'
import { useLanguage } from '@/context/language-context'
import { useAuth } from '@/context/auth-context'
import { useChat } from '@/context/chat-context'
import { useVirtualKeyboard } from '@/hooks/use-virtual-keyboard'
import { useHideOnScroll } from '@/hooks/use-hide-on-scroll'
import { useSlideRouter } from './page-transitions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { hapticTap } from '@/lib/haptics'

// One uniform lucide stroke across the whole bar. A slightly thicker, identical weight on
// every icon reads softer and keeps all five tabs at the same visual weight (symmetry).
const STROKE = 2.25

// Spring release (bouncy settle) instead of a linear snap; touch-action kills the tap delay.
const TAB = 'flex flex-1 cursor-pointer transition-transform duration-[240ms] [transition-timing-function:var(--ease-spring-snappy)] active:scale-90 active:duration-[60ms] [touch-action:manipulation]'

// Tab order drives the slide direction: tapping a tab to the RIGHT slides forward
// (new from the right), to the LEFT slides back (new from the left).
const TAB_ORDER = ['/', '/saved', '/post', '/messages', '/dashboard']
function tabIndex(path: string): number {
  if (path === '/') return 0
  const i = TAB_ORDER.findIndex((t) => t !== '/' && path.startsWith(t))
  return i === -1 ? 0 : i
}

// The icon + micro-label stack, centred in the bar. The label (text-3xs — the canon's
// micro-label size, §1) makes every tab unmistakable ("Post", "Saved") without turning the
// bar into a text row. No colour of its own, so it INHERITS the tab's state colour and the
// whole stack lights up together when active — one legible unit a child can read.
function TabStack({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <>
      <span className="relative">{icon}</span>
      {/* leading-none keeps the label box at ~10px so the icon + label + the taller Post chip
          all clear the 64px bar with headroom (even under OS font-scaling). */}
      <span className="text-3xs font-medium leading-none">{label}</span>
    </>
  )
}

// gap-0.5 (not gap-1) so the taller Post chip (h-12) + its label still clear the 64px bar.
const STACK = 'relative flex h-full w-full flex-col items-center justify-center gap-0.5 transition-colors'

/** Content of a navigating tab: the icon + micro-label stack. Active = the whole stack turns
 *  brand + a short bar sits at the top of the bar. Lives INSIDE <Link> so useLinkStatus lights
 *  it the instant it's tapped — feedback before the destination loads. */
function TabBody({ active, icon, label }: { active: boolean; icon: React.ReactNode; label: string }) {
  const { pending } = useLinkStatus()
  const on = active || pending
  return (
    <span className={cn(STACK, on ? 'text-accent-foreground' : 'text-body')}>
      {on && <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-full bg-accent-foreground" />}
      <TabStack icon={icon} label={label} />
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
      <Button type="button" variant="bare" size="none" onClick={() => openSignIn()} aria-label={label} className={TAB}>
        <span className={cn(STACK, 'text-body')}>
          <TabStack icon={icon} label={label} />
        </span>
      </Button>
    )
  }
  // Keep the <Link> (prefetch + a11y) but drive the actual nav through the slide
  // router so it animates directionally.
  return (
    <Link href={href} aria-label={label} aria-current={active ? 'page' : undefined} className={TAB} onClick={(e) => { e.preventDefault(); onNavigate() }}>
      <TabBody active={active} icon={icon} label={label} />
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
  // The bar auto-hides on scroll like a native app (owner 2026-07-16, reversing the earlier
  // "permanent anchor"): it retracts DOWN off-screen while the user scrolls down to browse and
  // slides back on any scroll-up / near the top — the same useHideOnScroll signal the top header
  // uses, so the two chrome bars move together. It ALSO steps aside whenever the on-screen keyboard
  // is up (iOS lifts a fixed bottom bar ABOVE the keyboard, so it would wedge between a chat
  // composer and the keyboard; a typing user doesn't need the tabs).
  const { open: keyboardOpen } = useVirtualKeyboard()
  const scrolledAway = useHideOnScroll()

  // Don't apply the active-tab state until after mount. On a STATICALLY prerendered
  // page (the home feed), usePathname() in the build-time render can differ from the
  // client's, so the active tab's colour + indicator <span> would mismatch → React #418
  // hydration error. Rendering every tab inactive on the server + first client paint
  // keeps them identical; the active tab lights up a frame later (imperceptible).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // The account rail opens as a full-screen OVERLAY on mobile (via the eno:open-account event),
  // so tapping Account never changes the route — the tab could never light up. The shell
  // broadcasts its open state on eno:account-open-change; while the rail is open it IS the active
  // surface, so the Account tab shows the indicator and the page tabs dim (one active tab that
  // follows the current surface, matching every other tab's feel).
  const [accountOpen, setAccountOpen] = useState(false)
  useEffect(() => {
    const onChange = (e: Event) => setAccountOpen((e as CustomEvent).detail === true)
    window.addEventListener('eno:account-open-change', onChange)
    return () => window.removeEventListener('eno:account-open-change', onChange)
  }, [])

  const at = (p: string) => mounted && pathname === p && !accountOpen
  const atPrefix = (p: string) => mounted && (pathname?.startsWith(p) ?? false) && !accountOpen
  // The Account tab is active while the rail is open OR on any /dashboard/* page (rail closed
  // after a section nav). Independent of the !accountOpen dimming the other tabs get.
  const accountActive = accountOpen || (mounted && (pathname?.startsWith('/dashboard') ?? false))

  // Navigate with an FB-style directional slide: right if the target tab is further
  // right than the current one, left otherwise.
  const go = (href: string) => {
    // If the account launcher is open, close it first — a page tab must revert to its page even when
    // the route doesn't change (tapping Explore while already on home with the launcher up: the
    // panel's route-driven close can't fire, so it would otherwise stay open — the reported bug).
    if (accountOpen) window.dispatchEvent(new CustomEvent('eno:open-account', { detail: false }))
    const from = tabIndex(pathname || '/')
    const to = TAB_ORDER.indexOf(href)
    navigate(href, to >= from ? 'forward' : 'back')
  }

  // Native staple: re-tapping the tab you're already on scrolls that view to the top (with a
  // haptic tick) instead of a no-op navigation — iOS/Android users reach for this reflexively.
  const scrollTopOrGo = (href: string, isActive: boolean) => {
    if (isActive && typeof window !== 'undefined' && window.scrollY > 0) {
      hapticTap()
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    go(href)
  }

  // Hidden on the full-screen sign-in page, and on the listing detail page — the PDP shows
  // its OWN fixed bottom action bar (Chat / Make offer via <PdpMobileBar>), and two stacked
  // fixed bottom bars would collide. In a chat thread the nav stays put when the keyboard is
  // CLOSED (composer sits right above it, no gap — the existing good state); when the keyboard
  // OPENS it's hidden reliably by `html.kb-open .mobile-nav` (globals.css), driven by the
  // frame-accurate kb-open class — not the old laggy React boolean that let it wedge above it.
  if (pathname?.startsWith('/signin') || pathname?.startsWith('/listings/')) return null

  // Gate auth-only tabs once auth has resolved logged-out. During the brief boot
  // window (loading) leave them as Links so a logged-in user is never flashed the
  // modal; the destination page is a backstop. Saved/Explore are public (favorites
  // are device-local), so they're never gated.
  const gate = !loading && !user

  // translate-y-full + opacity-0 + pointer-events-none slide the bar out of SIGHT, but not out of
  // the TAB ORDER or the accessibility tree — a keyboard user could tab straight into five invisible,
  // off-screen tabs. `inert` removes the whole subtree from focus, pointer and a11y in one go, and it
  // has to sit on the <nav>, not the tabs, because the focusable elements are the descendants.
  //
  // ⚠️ NO aria-hidden HERE, and that is deliberate — it is NOT a safe fallback for engines without
  // `inert`. aria-hidden removes a subtree from the accessibility tree but does NOT remove anything
  // from the tab order. So on an engine without inert (older Android WebView, the Zalo and Facebook
  // in-app browsers — a real slice of VN traffic), the seven links stay tabbable AND become invisible
  // to AT: the user lands focus on a control that announces nothing. That is strictly worse than the
  // bug it was meant to patch, and it is the aria-hidden-focus violation by definition. Where `inert`
  // IS supported it already hides the subtree from AT, so aria-hidden buys nothing there either.
  // (back-to-top.tsx can pair aria-hidden with tabIndex={-1} because it is a SINGLE button; here the
  // focusable nodes are descendants, so there is no one element to make untabbable.)
  //
  // `off` = the VISUAL retract (scroll-down OR keyboard). `inert` is applied for the KEYBOARD case
  // ONLY: a keyboard user tabbing down the page makes the browser auto-scroll, which trips
  // scrolledAway — inert-ing the nav mid-scroll would drop it out of the tab order right as they
  // try to reach it. So while merely scroll-hidden it stays reachable, and `focus-within:` (in the
  // className) instantly un-retracts it the moment focus lands on a tab — so a keyboard user never
  // focuses an invisible off-screen control (the :focus-within pseudo out-specificities the `off`
  // transform, so no JS state is needed). When the keyboard is up the tabs are genuinely not a
  // destination (you're typing), so inert there is correct and focus can't enter anyway.
  const off = keyboardOpen || scrolledAway

  return (
    <nav
      inert={keyboardOpen}
      className={cn(
        // No top border — the bar is a pure bg-card layer that blends into the canvas; the
        // spatial split + the active-tab colour carry the hierarchy, not a divider line.
        'mobile-nav lg:hidden fixed inset-x-0 bottom-0 z-40 bg-card pb-[env(safe-area-inset-bottom)] transition-[transform,opacity] duration-[250ms] ease-out [will-change:transform,opacity] motion-reduce:transition-none',
        // Reveal-on-focus: if a keyboard user tabs into the (scroll-hidden) bar, :focus-within
        // out-specificities the retract below and slides it back into view — never an invisible,
        // focused control. (Harmless while docked; a no-op when inert during keyboard-up.)
        'focus-within:translate-y-0 focus-within:opacity-100 focus-within:pointer-events-auto',
        // Slides DOWN off-screen + fades while scrolling down to browse (returns on scroll-up /
        // near the top) and while the on-screen keyboard is open (so a chat composer sits flush
        // above it); docked and visible otherwise.
        off ? 'translate-y-full opacity-0 pointer-events-none' : 'translate-y-0 opacity-100',
      )}
    >
      {/* Fixed 64px tab row; the safe-area padding sits BELOW it (filled white) so
          the home-indicator inset never compresses the icons out of the bar. */}
      <div className="flex h-16 items-stretch">
      <Link href="/" aria-label={tr('Explore', 'Khám phá')} aria-current={at('/') ? 'page' : undefined} className={TAB} onClick={(e) => { e.preventDefault(); scrollTopOrGo('/', at('/')) }}>
        <TabBody active={at('/')} label={tr('Explore', 'Khám phá')} icon={<Compass className="h-7 w-7" strokeWidth={STROKE} />} />
      </Link>

      {/* Saved is public — favorites are stored device-local (localStorage), so a
          logged-out visitor can save and review listings without an account. */}
      <Link href="/saved" aria-label={tr('Saved', 'Đã lưu')} aria-current={at('/saved') ? 'page' : undefined} className={TAB} onClick={(e) => { e.preventDefault(); scrollTopOrGo('/saved', at('/saved')) }}>
        <TabBody
          active={at('/saved')}
          label={tr('Saved', 'Đã lưu')}
          icon={
            <>
              <Heart className={cn('h-7 w-7', count > 0 && 'fill-brand text-brand')} strokeWidth={STROKE} />
              {count > 0 && (
                <Badge variant="counter" size="count" className="absolute -right-2 -top-1">
                  {count}
                </Badge>
              )}
            </>
          }
        />
      </Link>

      <GatedTab
        href="/post"
        active={at('/post')}
        gate={gate}
        onNavigate={() => go('/post')}
        label={tr('Post', 'Đăng tin')}
        // Emphasised but FLAT: a soft tinted chip (canon chip = rounded-full + tint, §2) with a
        // brand-blue plus — no shadow, no FAB lift, no heavy solid fill. It reads as the primary
        // action while staying part of the same flat canvas as the other tabs.
        icon={
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-tint text-brand">
            <Plus className="h-6 w-6" strokeWidth={STROKE} />
          </span>
        }
      />

      <GatedTab
        href="/messages"
        active={atPrefix('/messages')}
        gate={gate}
        onNavigate={() => scrollTopOrGo('/messages', pathname === '/messages')}
        label={tr('Messages', 'Tin nhắn')}
        icon={
          <>
            <MessageSquare className={cn('h-7 w-7', user && unread > 0 && 'fill-brand text-brand')} strokeWidth={STROKE} />
            {user && unread > 0 && (
              <Badge variant="counter" size="count" className="absolute -right-2 -top-1">
                {unread > 9 ? '9+' : unread}
              </Badge>
            )}
          </>
        }
      />

      {/* Account = the dashboard nav rail. On mobile the rail is a launcher: tapping this OPENS
          it (full-screen menu) via a window event the shell listens for, then picking a section
          navigates to its /dashboard/* page and the rail closes. Active on any dashboard page. */}
      <GatedTab
        href="/dashboard"
        active={accountActive}
        gate={gate}
        label={tr('Account', 'Tài khoản')}
        // Logged in → open the rail. Still resolving auth (user not yet known) → fall back to
        // navigating /dashboard, which gates correctly once auth lands, rather than popping an
        // empty rail. (Logged-out is already handled by `gate` → openSignIn.)
        onNavigate={() => user ? window.dispatchEvent(new Event('eno:open-account')) : go('/dashboard')}
        icon={<User className="h-7 w-7" strokeWidth={STROKE} />}
      />
      </div>
    </nav>
  )
}
