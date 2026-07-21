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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { hapticTap } from '@/lib/haptics'

// One uniform lucide stroke across the whole bar. A slightly thicker, identical weight on
// every icon reads softer and keeps all five tabs at the same visual weight (symmetry).
const STROKE = 2.25

// Spring release (bouncy settle) instead of a linear snap; touch-action kills the tap delay.
const TAB = 'flex flex-1 cursor-pointer transition-transform duration-[240ms] [transition-timing-function:var(--ease-spring-snappy)] active:scale-90 active:duration-[60ms] [touch-action:manipulation]'

// PREFETCH (2026-07-21): every tab used to carry `prefetch={false}`, so the five most-travelled
// destinations in the app were the only ones that paid a full cold round-trip on tap — the
// opposite of what a bottom bar is for. They now use Next's DEFAULT (auto) prefetch, deliberately
// NOT `prefetch={true}`:
//   · auto warms the route's static shell / loading boundary, so the tap paints instantly, while
//     dynamic data is still fetched fresh on navigation (staleTimes.dynamic = 0). On a marketplace
//     that difference is a correctness one — `prefetch={true}` would park the payload under
//     staleTimes.static (5 min), and a 5-minute-old inbox or price is a bug, not a cache hit.
//   · the bar is on every mobile page and always in the viewport, so `true` would also fire five
//     full RSC renders per page view at the server.
// Back/forward navigation is instant regardless (Next restores those from the Router Cache).

// The icon + micro-label stack, centred in the bar. The label (text-3xs — the canon's
// micro-label size, §1) makes every tab unmistakable ("Post", "Saved") without turning the
// bar into a text row. No colour of its own, so it INHERITS the tab's state colour and the
// whole stack lights up together when active — one legible unit a child can read.
function TabStack({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <>
      <span className="relative">{icon}</span>
      {/* ⚠️ NO overflow-hidden / truncate on this label, ever. Vietnamese stacks diacritics
          ABOVE the cap height and descenders below ("Đăng tin"), and leading-none makes the
          line box exactly the font size — clipping it would cut the marks off the letters,
          which is the mid-word-truncation failure that killed the hand-built native apps.
          At an enlarged text size the label is allowed to WRAP and the bar grows with it
          (min-h-16 below); nothing is ever cut. */}
      <span className="text-3xs font-medium leading-none text-center">{label}</span>
    </>
  )
}

// gap-0.5 (not gap-1) so the taller Post chip + its label sit as one tight unit.
const STACK = 'relative flex h-full w-full flex-col items-center justify-center gap-0.5 transition-colors'

// The Post tab only. Its chip is the tallest thing in the bar, and centring it left the
// chip's top edge FLUSH with the bar's top border — exactly where the active/pending
// indicator draws its 2px line, so the two merged into one smudge on tap (owner report,
// 2026-07-21). Bottom-weighting the stack pushes the whole tab DOWN, which parks all of
// the bar's slack above the chip and gives the indicator its own clear band.
const STACK_POST = 'relative flex h-full w-full flex-col items-center justify-end gap-0.5 pb-0.5 transition-colors'

/** Content of a navigating tab: the icon + micro-label stack. Active = the whole stack turns
 *  brand + a short bar sits at the top of the bar. Lives INSIDE <Link> so useLinkStatus lights
 *  it the instant it's tapped — feedback before the destination loads. */
function TabBody({ active, icon, label, stack = STACK }: { active: boolean; icon: React.ReactNode; label: string; stack?: string }) {
  const { pending } = useLinkStatus()
  const on = active || pending
  return (
    <span className={cn(stack, on ? 'text-accent-foreground' : 'text-body')}>
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
function GatedTab({ href, active, icon, label, gate, onClick, prefetch, stack }: { href: string; active: boolean; icon: React.ReactNode; label: string; gate: boolean; onClick: (e: React.MouseEvent<HTMLAnchorElement>) => void; prefetch?: false; stack?: string }) {
  const { openSignIn } = useAuth()
  if (gate) {
    return (
      <Button type="button" variant="bare" size="none" onClick={() => openSignIn()} aria-label={label} className={TAB}>
        <span className={cn(stack ?? STACK, 'text-body')}>
          <TabStack icon={icon} label={label} />
        </span>
      </Button>
    )
  }
  // The <Link> performs the ACTUAL navigation (see the note on the bar below); onClick only
  // handles the taps that are NOT a navigation, and preventDefault()s those.
  return (
    <Link href={href} prefetch={prefetch} aria-label={label} aria-current={active ? 'page' : undefined} className={TAB} onClick={onClick}>
      <TabBody active={active} icon={icon} label={label} stack={stack} />
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

  // ⚠️ The <Link> does the navigating. Every tab used to preventDefault() its own Link and
  // router.push() instead — which silently killed the useLinkStatus() pending highlight the
  // bar is built around (a Link that never navigates never reports `pending`), so a tap gave
  // NO feedback until the next page painted. That indirection existed for a directional slide
  // transition that was reverted, so it bought nothing. This handler now only intercepts the
  // taps that are genuinely NOT a navigation, and cancels the Link for exactly those.
  const onTabClick = (e: React.MouseEvent, isActive: boolean) => {
    // Native staple: re-tapping the tab you're already on scrolls that view to the top (with a
    // haptic tick) instead of a no-op navigation — iOS/Android users reach for this reflexively.
    if (isActive && typeof window !== 'undefined' && window.scrollY > 0) {
      e.preventDefault()
      hapticTap()
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    // If the account launcher is open, close it — a page tab must revert to its page even when
    // the route doesn't change (tapping Explore while already on home with the launcher up: the
    // panel's route-driven close can't fire, so it would otherwise stay open — the reported bug).
    if (accountOpen) window.dispatchEvent(new CustomEvent('eno:open-account', { detail: false }))
  }

  // Hidden only on the full-screen sign-in page. (The PDP used to hide it and show its own fixed
  // Chat / Make-offer bar instead; owner reverted that 2026-07-18 — the tab-nav stays on the PDP and
  // buyers use the in-page contact composer.) In a chat thread the nav stays put when the keyboard is
  // CLOSED (composer sits right above it, no gap — the existing good state); when the keyboard
  // OPENS it's hidden reliably by `html.kb-open .mobile-nav` (globals.css), driven by the
  // frame-accurate kb-open class — not the old laggy React boolean that let it wedge above it.
  if (pathname?.startsWith('/signin')) return null

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
      {/* 64px tab row, but min-h — NOT a hard h-16. The Post chip alone is h-12 (48px) and the
          micro-label sits under it, so the row already ran within ~4px of the old fixed height:
          the moment the OS text size is enlarged (native-text-zoom scales TEXT only, so the
          chip stays 48px while the label grows) the stack overflowed the bar and spilled over
          the page. min-h-16 keeps today's exact geometry at the default text size and lets the
          bar grow instead of clipping when the label needs the room.
          The safe-area padding sits BELOW the row (filled) so the home-indicator inset never
          compresses the icons out of the bar. */}
      <div className="flex min-h-[4.5rem] items-stretch">
      <Link href="/" aria-label={tr('Explore', 'Khám phá')} aria-current={at('/') ? 'page' : undefined} className={TAB} onClick={(e) => onTabClick(e, at('/'))}>
        <TabBody active={at('/')} label={tr('Explore', 'Khám phá')} icon={<Compass className="h-7 w-7" strokeWidth={STROKE} />} />
      </Link>

      {/* Saved is public — favorites are stored device-local (localStorage), so a
          logged-out visitor can save and review listings without an account. */}
      <Link href="/saved" aria-label={tr('Saved', 'Đã lưu')} aria-current={at('/saved') ? 'page' : undefined} className={TAB} onClick={(e) => onTabClick(e, at('/saved'))}>
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
        onClick={(e) => onTabClick(e, false)}
        label={tr('Post', 'Đăng tin')}
        // Emphasised but FLAT: a soft tinted chip (canon chip = rounded-full + tint, §2) with a
        // brand-blue plus — no shadow, no FAB lift, no heavy solid fill. It reads as the primary
        // action while staying part of the same flat canvas as the other tabs.
        stack={STACK_POST}
        icon={
          <span className="flex size-13 items-center justify-center rounded-full bg-tint text-brand">
            <Plus className="h-7 w-7" strokeWidth={STROKE} />
          </span>
        }
      />

      <GatedTab
        href="/messages"
        active={atPrefix('/messages')}
        gate={gate}
        // Scroll-to-top only on the inbox itself (pathname === '/messages'), never inside a
        // thread — the tab is "active" for every /messages/* route, but from a thread the tap
        // must navigate back OUT to the inbox.
        onClick={(e) => onTabClick(e, pathname === '/messages')}
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
        // The ONE tab that keeps prefetch off: for a signed-in user this Link never navigates
        // (it opens the rail overlay), so prefetching /dashboard on every mobile page view
        // would be a pure wasted RSC render.
        prefetch={false}
        label={tr('Account', 'Tài khoản')}
        // Logged in → open the rail INSTEAD of navigating (so this is the one tab that always
        // cancels its Link). Still resolving auth (user not yet known) → let the Link go to
        // /dashboard, which gates correctly once auth lands, rather than popping an empty rail.
        // (Logged-out is already handled by `gate` → openSignIn.)
        // TOGGLE (owner 2026-07-18): the launcher has no Close button — re-tapping Account
        // closes it (CustomEvent detail:false), any other tab still closes it on navigate.
        onClick={(e) => {
          if (!user) return
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('eno:open-account', { detail: !accountOpen }))
        }}
        icon={<User className="h-7 w-7" strokeWidth={STROKE} />}
      />
      </div>
    </nav>
  )
}
