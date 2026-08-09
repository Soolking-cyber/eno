'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
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
import { STROKE_NAV } from '@/lib/icon-tokens'
import { CategoryGlyphArt } from './category-icons'

// One uniform lucide stroke across the whole bar. A slightly thicker, identical weight on
// every icon reads softer and keeps all five tabs at the same visual weight (symmetry).
// STROKE_NAV is the platform weight (docs/icon-language.md §2) — shared with the header.
const STROKE = STROKE_NAV

// Spring release (bouncy settle) instead of a linear snap; touch-action kills the tap delay.
const TAB = 'flex flex-1 cursor-pointer transition-transform duration-[240ms] [transition-timing-function:var(--ease-spring-snappy)] active:scale-[0.96] active:duration-[60ms] [touch-action:manipulation]'

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
//
// REFINEMENT (2026-07-25): a tab carries `prefetch={false}` only when the current route IS that
// tab's href. That does not walk back the above — every other tab still gets auto prefetch, which
// is the whole point of the bar. It drops the one prefetch that cannot pay off: warming the shell
// of the page already on screen, once per mobile page view, from a bar that is always in viewport.
// ⚠️ Keyed on an EXACT href match (`onHref`), NOT on `active`. Two tabs are active by PREFIX while
// pointing somewhere else — Messages is active across /messages/* but hrefs /messages, and Account
// is active across /dashboard/* but hrefs /dashboard/account. For those, "active" taps are real
// navigations to a different route, so using `active` here would have killed a prefetch that DOES
// pay off. (codex caught exactly that; Gemini's pass confirmed the diff and missed it.)

// The icon + micro-label stack, centred in the bar. The label (text-3xs — the canon's
// micro-label size, §1) makes every tab unmistakable ("Post", "Saved") without turning the
// bar into a text row. No colour of its own, so it INHERITS the tab's state colour and the
// whole stack lights up together when active — one legible unit a child can read.
function TabStack({ icon, label }: { icon: React.ReactNode; label: string }) {
  // ⚠️ THE LABEL OWNS A FIXED SLOT AT THE BOTTOM; THE GLYPH CENTRES IN WHAT IS LEFT.
  // This is the only structure that keeps all five labels on ONE baseline while the Post chip
  // stays taller than the other four icons. With a plain centred stack the label position is a
  // function of glyph height — measured, labelTop = 32 + glyphHeight/2 — so a 44px chip beside
  // 28px icons puts its label 8px low, and the ONLY centred solution is to make every glyph the
  // same size, which would delete the Post chip's prominence. Bottom-anchoring the label removes
  // glyph height from the equation entirely.
  return (
    <>
      <span className="flex flex-1 items-center justify-center"><span className="relative">{icon}</span></span>
      {/* ⚠️ NO overflow-hidden / truncate on this label, ever. Vietnamese stacks diacritics
          ABOVE the cap height and descenders below ("Đăng tin"), and leading-none makes the
          line box exactly the font size — clipping it would cut the marks off the letters,
          which is the mid-word-truncation failure that killed the hand-built native apps.
          At an enlarged text size the label is allowed to WRAP and the bar grows with it
          (min-h-16 below); nothing is ever cut. */}
      <span className="pb-1.5 text-3xs font-medium leading-none text-center">{label}</span>
    </>
  )
}

// gap-0.5 (not gap-1) so the taller Post chip + its label sit as one tight unit.
const STACK = 'relative flex h-full w-full flex-col items-center gap-0.5 transition-colors'

// ⛔ STACK_POST IS GONE — the Post tab uses STACK like every other tab (2026-08-09).
//
// It existed because the Post chip is the tallest thing in the bar, and centring it left the
// chip's top edge FLUSH with where the active/pending indicator draws its 2px line, so the two
// merged into one smudge on tap (owner report, 2026-07-21). `justify-end pb-0.5` pushed the
// whole tab down and parked the bar's slack above the chip.
//
// That fixed a real bug by breaking a different one: bottom-weighting moved the Post LABEL off
// the row. Measured — Explore/Saved/Messages/Account labels all sat at y=818 and Post at y=832,
// a 14px break across the app's most-looked-at 73px, on the one tab in the middle where the eye
// compares hardest.
//
// The clearance is now bought where it was actually missing — the chip is 40px (`size-10`)
// instead of 52px, and the indicator is inset 2px from the top edge. Both make room WITHOUT
// moving the type. Measured after: all five labels at 56px from the bar's top, and the chip
// clears the indicator band by 3px.
// ⚠️ 40px, NOT 44px — an earlier revision of this note claimed 44 and a reviewer caught the
// mismatch with `size-10`. 40 is what the geometry allows: the label slot is 16px and the gap
// 2px, leaving 54px, and a 44px chip in that space closes the indicator gap to 1px. The 44px
// TAP floor is unaffected either way, because the tap target is the full-height <Link>, not the
// coin — measured at 72px tall.

/** Content of a navigating tab: the icon + micro-label stack. Active = the whole stack turns
 *  brand + a short bar sits at the top of the bar. Lives INSIDE <Link> so useLinkStatus lights
 *  it the instant it's tapped — feedback before the destination loads. */
function TabBody({ active, icon, label, stack = STACK }: { active: boolean; icon: React.ReactNode | ((on: boolean) => React.ReactNode); label: string; stack?: string }) {
  const { pending } = useLinkStatus()
  const on = active || pending
  // Location-active = soft duotone (icon-language §5): the stack's ink turns brand AND the
  // glyph fills its whole body with brand-100 — the same rule the category tiles and the
  // dashboard rail follow, so one selection language runs across every nav surface. The
  // `:not([class*=fill-])` guard skips any icon already carrying an
  // explicit fill-* class, so a user-state fill (the solid saved heart / unread bubble)
  // always wins over mere location.
  // Motion (icon-language §8): the wash ARRIVES rather than blinking on — `wash-in` fades the
  // duotone interior up over 180ms while the ink flips instantly, and the indicator bar grows
  // from its centre in the same window. Both are added by the class flip, so they run exactly
  // once per activation, and `useLinkStatus`'s `pending` means they start on the TAP — before
  // the destination has loaded. Neither can repeat while the tab stays active.
  return (
    <span className={cn(stack, on ? cn('text-accent-foreground', '[&_svg:not([class*=fill-])]:fill-brand-100', 'wash-in') : 'text-body')}>
      {on && <span aria-hidden className="bar-in absolute top-0.5 h-0.5 w-8 rounded-full bg-accent-foreground" />}
      <TabStack icon={typeof icon === 'function' ? icon(on) : icon} label={label} />
    </span>
  )
}

/** A tab that needs sign-in (Post / Messages / Account). When auth has resolved to
 *  logged-out, tapping opens the standardized sign-in modal instead of navigating
 *  to a page that would gate inconsistently — so every gated action on mobile
 *  meets the SAME card. While auth is still resolving (or signed in) it's a normal
 *  Link, so a logged-in user is never wrongly shown the modal. */
function GatedTab({ href, active, onHref, icon, label, gate, onClick, prefetch, stack }: { href: string; active: boolean; onHref?: boolean; icon: React.ReactNode | ((on: boolean) => React.ReactNode); label: string; gate: boolean; onClick: (e: React.MouseEvent<HTMLAnchorElement>) => void; prefetch?: false; stack?: string }) {
  const { openSignIn, user, loading } = useAuth()
  const router = useRouter()
  // ⚠️ THE BOOT WINDOW WAS A DOUBLE REDIRECT TO A SECOND LOGIN PAGE (owner, 2026-08-03: "mobile
  // login issue with 2 redirects … user can log/signup in directly from popup").
  // `gate` is `!loading && !user`, so while auth is still resolving this tab is a plain <Link>. A
  // guest who taps in that window — which is most first taps, the bar paints long before Supabase
  // answers — navigated, and the destination's own guard bounced them onward:
  //     /  →  /dashboard/account  →  /signin?next=/dashboard/account      (measured on :3100)
  // They landed on the full sign-in PAGE, never seeing the popup, having burned two navigations.
  // Simply gating on `loading` too would show a LOGGED-IN user the sign-in modal during boot, which
  // is the failure the original Link was there to avoid — so instead the tap is DEFERRED: swallow it,
  // remember it, and once auth resolves either navigate (member) or open the popup in place (guest).
  // Nobody leaves the page to find out whether they are signed in.
  // ⚠️ A DEFERRED TAP EXPIRES, AND IT IS BOUND TO WHERE IT WAS MADE. codex, agy and qwen all three
  // independently flagged the naive boolean, which is about as strong a signal as this stack gives.
  // The failure: tap Account during boot, immediately tap Explore and navigate away — the bottom nav
  // never unmounts, so when auth resolves the stale intent fires and YANKS the user back to Account
  // from wherever they went. A tap is a statement about a moment, so it has to carry that moment:
  // replay only if they are still on the page where they tapped, and only if it is still recent.
  // Without the age check a tap could also sit indefinitely if auth never resolves, then fire on a
  // much later reconnect.
  const [deferred, setDeferred] = useState<{ at: number; path: string } | null>(null)
  const pathname = usePathname()
  useEffect(() => {
    if (!deferred || loading) return
    setDeferred(null)
    if (deferred.path !== pathname) return          // they moved on — the intent is stale
    if (Date.now() - deferred.at > 10_000) return   // too old to still be what they meant
    if (user) router.push(href)
    else openSignIn()
  }, [deferred, loading, user, href, router, openSignIn, pathname])
  if (gate) {
    return (
      <Button type="button" variant="bare" size="none" onClick={() => openSignIn()} aria-label={label} className={TAB}>
        <span className={cn(stack ?? STACK, 'text-body')}>
          {/* The sign-in gate is never the active tab, so the icon renders in its idle form. */}
          <TabStack icon={typeof icon === 'function' ? icon(false) : icon} label={label} />
        </span>
      </Button>
    )
  }
  // The <Link> performs the ACTUAL navigation (see the note on the bar below); onClick only
  // handles the taps that are NOT a navigation, and preventDefault()s those.
  return (
    <Link
      href={href}
      // ⚠️ `loading` GATES THE PREFETCH, not just the tap. While auth is unresolved the tap handler
      // below already swallows the tap and replays it — so during that exact window the tab is not
      // a navigation at all, yet Next was still prefetching /post, /messages and /dashboard/account.
      // Three RSC payloads fetched on the slowest part of a cold mobile load, for destinations the
      // user cannot reach yet and which may resolve to a different route once auth lands. The
      // prefetch resumes by itself the moment `loading` flips.
      prefetch={onHref || loading ? false : prefetch}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={TAB}
      onClick={(e) => {
        // Auth unresolved: swallow this tap and replay it once we know who they are (see above).
        if (loading) { e.preventDefault(); hapticTap(); setDeferred({ at: Date.now(), path: pathname ?? "" }); return }
        onClick(e)
      }}
    >
      <TabBody active={active} icon={icon} label={label} stack={stack} />
    </Link>
  )
}

/** Mobile-only bottom tab bar (Airbnb pattern). Rendered UNCONDITIONALLY from
 *  app/providers.tsx — including on listing detail pages. (It used to be hidden
 *  there, behind a sticky contact CTA; that bar was deleted and the tab bar came
 *  back, so any layout that still reserves its own clearance on a PDP is stale.) */
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

  // ⚠️ NO MORE OVERLAY STATE. The Account tab used to open a full-screen rail that never
  // changed the route, so this component had to track that surface through a CustomEvent pair
  // just to know which tab to light. Account is a real page now (/dashboard/account), so every
  // tab's active state comes from the ONE source it should: the pathname.
  const at = (p: string) => mounted && pathname === p
  const atPrefix = (p: string) => mounted && (pathname?.startsWith(p) ?? false)
  // Account owns the whole /dashboard/** subtree, so it stays lit while you are inside any
  // section you reached from it (codex, plan review).
  const accountActive = mounted && (pathname?.startsWith('/dashboard') ?? false)

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
        // A hairline top divider. The flat pass (design-language §3b) collapsed --card INTO
        // --background, so a bare bg-card bar is now the SAME colour as the page and blended
        // invisibly into the content scrolling beneath it — the old "no top border, the fill
        // carries it" choice broke the moment the fill stopped differing from the canvas. The
        // border-t is the "line, not box" separation the flat language uses.
        // `hairline-t` instead of `border-t border-border`: the same line at ONE device pixel
        // instead of two (dpr 2) or three (dpr 3) — see the note in globals.css. This is the
        // app's most-looked-at edge, so it is the one worth getting to native weight.
        // ⚠️ THE BAR IS 1px SHORTER: 73px → 72px, measured. A border is part of the border box
        // and a pseudo-element is not, so the line no longer reserves its own row — it paints
        // over row 0 instead, which is also why the active indicator moved to `top-0.5`. An
        // earlier version of this comment claimed the height was unchanged; a reviewer caught
        // it. 1px is within the slack of everything that clears this bar (the `.kb-*` contract
        // and `--nav-h` both use 4.5rem = 72px), but if something ever measures the bar at
        // runtime, it is now 72.
        'mobile-nav lg:hidden fixed inset-x-0 bottom-0 z-40 hairline-t bg-card pb-[env(safe-area-inset-bottom)] transition-[transform,opacity] duration-[250ms] ease-out [will-change:transform,opacity] motion-reduce:transition-none',
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
      <Link href="/" prefetch={at('/') ? false : undefined} aria-label={tr('Explore', 'Khám phá')} aria-current={at('/') ? 'page' : undefined} className={TAB} onClick={(e) => onTabClick(e, at('/'))}>
        {/* ⚠️ COMPASS RENDERS AS THE TWO-LAYER DUOTONE, not a single filled svg. lucide draws
            the needle FIRST and the outer circle SECOND, so a fill applied to the whole svg
            paints the circle over the needle and the glyph collapses into a solid disc (owner,
            2026-08-07: "mobile explore icon when filled inside disappears"). CategoryGlyphArt
            paints the tint UNDERNEATH an untouched ink layer, so the needle survives the fill —
            the same reason the category tiles never had this problem. The other three tabs
            (Heart, MessageSquare, User) have no self-covering child and stay single-svg. */}
        <TabBody
          active={at('/')}
          label={tr('Explore', 'Khám phá')}
          icon={(on) => <CategoryGlyphArt Icon={Compass} selected={on} stroke={STROKE} className="h-7 w-7" />}
        />
      </Link>

      {/* Saved is public — favorites are stored device-local (localStorage), so a
          logged-out visitor can save and review listings without an account. */}
      <Link href="/saved" prefetch={at('/saved') ? false : undefined} aria-label={tr('Saved', 'Đã lưu')} aria-current={at('/saved') ? 'page' : undefined} className={TAB} onClick={(e) => onTabClick(e, at('/saved'))}>
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
        onHref={at('/post')}
        gate={gate}
        onClick={(e) => onTabClick(e, false)}
        label={tr('Post', 'Đăng tin')}
        // Emphasised but FLAT: a soft tinted chip (canon chip = rounded-full + tint, §2) with a
        // brand-blue plus — no shadow, no FAB lift, no heavy solid fill. It reads as the primary
        // action while staying part of the same flat canvas as the other tabs.
        // bg-brand-50, not bg-tint (icon-language §6): the Post coin is the one chrome coin in
        // the bar, and the brand-tinted disc ties it to the category-glyph wash — same blue
        // family, still flat.
        stack={STACK}
        icon={
          <span className="flex size-10 items-center justify-center rounded-full bg-brand-50 text-brand">
            <Plus className="h-7 w-7" strokeWidth={STROKE} />
          </span>
        }
      />

      <GatedTab
        href="/messages"
        active={atPrefix('/messages')}
        // EXACT, not the prefix `active`: inside a thread (/messages/<id>) this tab is still
        // "active", but its href is a DIFFERENT route and the tap is a real navigation out to
        // the inbox — so that prefetch is the opposite of dead and must stay on.
        onHref={at('/messages')}
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
      {/* ⚠️ AN ORDINARY TAB AGAIN (owner 2026-07-24, dashboard native-feel). This used to
          preventDefault its own Link and dispatch `eno:open-account`, opening a body-locked,
          focus-trapped full-screen overlay that re-tapping dismissed. Because the route never
          changed, Android hardware-back and browser-back could not close it, the URL never said
          where you were, and nothing was linkable. /dashboard/account is a real page, so all of
          that comes free and this tab behaves exactly like the other four. */}
      <GatedTab
        href="/dashboard/account"
        active={accountActive}
        // Same trap as Messages: accountActive is startsWith('/dashboard'), so on
        // /dashboard/listings this tab is active while its href is another route.
        onHref={at('/dashboard/account')}
        gate={gate}
        // Same handler as every other tab now: re-tapping Account while already inside the
        // dashboard scrolls to top, exactly like the other four.
        onClick={(e) => onTabClick(e, accountActive)}
        label={tr('Account', 'Tài khoản')}
        icon={<User className="h-7 w-7" strokeWidth={STROKE} />}
      />
      </div>
    </nav>
  )
}
