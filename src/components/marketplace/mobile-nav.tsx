'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link, { useLinkStatus } from 'next/link'
import { useFavorites } from '@/context/favorites-context'
import { useLanguage } from '@/context/language-context'
import { preloadSignIn, useAuth } from '@/context/auth-context'
import { useChat } from '@/context/chat-context'
import { useVirtualKeyboard } from '@/hooks/use-virtual-keyboard'
import { useHideOnScroll } from '@/hooks/use-hide-on-scroll'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { hapticTap } from '@/lib/haptics'
import { Compass, Heart, Plus, User, MessageSquare } from '@/components/ui/icons'
import { STROKE_NAV } from '@/lib/icon-tokens'
// ⚠️ FROM category-glyph, NOT category-icons — importing the renderer from the registry file
// drags its 99-icon map into this route's chunk (see category-glyph.tsx's header).
import { CategoryGlyphArt } from './category-glyph'
import { scrollBehavior } from '@/lib/reduced-motion'

/**
 * ⛔ SOLAR v2 GLYPHS AGAIN, NOT THE 3D ART — owner, 2026-09-14: "on mobile bottom navbar icons move back to solar v2
 * version". The five `NavArt` rasters (793d05d2, 2026-08-28) are gone from this bar; the glyphs are the ones it drew
 * before them (Outline at rest, Bold + brand when the link is `aria-current`, via the sprite's .i-rest/.i-on layers).
 * `nav-art.tsx` and `/icons/nav/*` stay: the iOS app's tab bar still paints that artwork (ae94af3b).
 * ⚠️ WHAT THE 3D ERA DECIDED AND THIS KEEPS: colour means "you are here" and nothing else (owner, 2026-08-28, 05eb62fe).
 * The pre-art glyphs filled the Heart when anything was saved and the bubble on unread; those fills are NOT restored —
 * the count badges carry that signal.
 * One uniform stroke across the bar (STROKE_NAV, docs/icon-language.md §2, shared with the header) keeps all five
 * tabs at one visual weight.
 *
 * ⛔ A FLOATING, ICON-ONLY PILL — owner, 2026-09-26: "remove these [the micro-labels] on mobile make sure the bottom
 * navbar is minimal and sleek pill shaped according to our design language". What that changed, and what it did not:
 *   · NO VISIBLE LABELS. Every tab still carries its accessible name as `aria-label` (and the active one
 *     `aria-current="page"`), so screen readers, `getByLabelText` and `getByRole(…, { name })` are unchanged.
 *   · THE BAR FLOATS: `rounded-full` (canon §2, pills), inset 12px from the sides and max(12px, safe area) from the
 *     bottom, so it sits above the home indicator rather than painting over it.
 *   · IT IS A FLOATING SURFACE, SO IT WEARS THE FLOATING TIER (canon §3b: "elevation must mean something … those use
 *     `popover`, not `card`"): bg-popover at 95% + the `material` blur, `shadow-pop`, and a 1px
 *     `border-foreground/10` edge. The EDGE is what separates it — the shadow falls 8px downward, so almost none of
 *     it reaches the top edge that content scrolls under, and on the dark canvas it says nothing at all.
 *     ⛔ A `border`, NOT ui/popover's `ring-1`: `.shadow-pop` (globals.css) sets `box-shadow` unlayered, and a
 *     Tailwind ring IS a box-shadow, so the ring was silently overwritten — measured, the computed box-shadow was the
 *     pop shadow alone in both themes, and the pill met the light canvas at ~1.03:1 with no line.
 *   · "YOU ARE HERE" IS A TINTED CAPSULE (`bg-accent`, the brand-50 tint) behind the brand glyph, concentric with the
 *     pill. It replaced the 2px top bar, which only made sense on a flush, full-width bar. The Post tab is the one
 *     exception: its coin already fills solid when active, so a capsule round it would stack three shapes.
 *   · ⚠️ THE FOOTPRINT DID NOT MOVE: 56px pill + 12px gap = 68px, inside the 4.5rem (72px) that <BottomNavSpacer/>,
 *     the `html.native` spacer rule, the sticky action bars, the install hint, the offline banner and the
 *     back-to-top / rental-check cluster all reserve. The pill's top edge is ALWAYS at or below that line — with a
 *     home-indicator inset S it sits at S+56 against the spacer's S+72 — so nothing that clears the old bar by
 *     the same inset is covered by the new one, and none of those files had to learn a new number. (Where a
 *     surface clears only env() — Android WebView < 140 hands Capacitor's inset over as a CSS var — it still
 *     falls short by the var, as it did under the old bar, by less.)
 */
const STROKE = STROKE_NAV

// Spring release (bouncy settle) instead of a linear snap; touch-action kills the tap delay.
// `rounded-full`: the keyboard focus ring (globals.css draws it as an `outline`, which follows the radius) is a
// capsule, not a rectangle poking out of the pill's rounded ends. ⚠️ Its INSET lives in globals.css
// (`.mobile-nav :is(a,button):focus-visible`, offset -4px): the global focus rule is unlayered, and on the guest
// <Button> tabs its `[tabindex]` branch is (0,6,0), so no utility here can pull the ring inside the pill.
// ⚠️ `relative` + the `after:` strip: THE TAP AREA RUNS DOWN TO THE SCREEN EDGE. The old docked bar caught
// every tap in the bottom 72px + inset; the pill leaves max(12px, safe area) open under it — on an iPhone
// 34px of the busiest thumb zone — so a thumb landing just under Explore opened whatever listing was
// scrolling past instead. Each tab's invisible strip (the same max() as the pill's `bottom`, +1px for the pill's
// border, which the tab sits inside — measured, without it the last device row still went to the page) takes those
// taps back for the tab above them. The 12px side gutters stay open to the page, like any floating bar.
// `pointer-events: none` on the retracted <nav> is inherited, so the strips go dead with it.
const TAB = 'relative flex flex-1 cursor-pointer rounded-full after:absolute after:inset-x-0 after:top-full after:h-[calc(max(0.75rem,env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px))+1px)] transition-transform duration-[240ms] [transition-timing-function:var(--ease-spring-snappy)] active:scale-[0.96] active:duration-[60ms] [touch-action:manipulation]'

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

// ⛔ NO LABEL SLOT ANY MORE (owner, 2026-09-26 — see the note at the top). The micro-label
// stack that lived here bottom-anchored a `text-3xs` label under each glyph so five labels
// shared one baseline beside the taller Post coin; with the labels gone the glyph simply
// centres in the tab, and the Post coin (40px) and the 28px glyphs share one centre line.
// The accessible name never lived in that label — it is the tab's `aria-label` — so nothing
// a screen reader or a test reads changed with it.
// ⚠️ The glyph's wrapper stays `relative`: it is the anchor the count badges hang off, and it
// has to paint ABOVE the active capsule, which is an earlier positioned sibling.
function TabGlyph({ icon }: { icon: React.ReactNode }) {
  return <span className="relative flex items-center justify-center">{icon}</span>
}

const STACK = 'relative flex h-full w-full items-center justify-center transition-colors'

type TabIcon = React.ReactNode | ((on: boolean) => React.ReactNode)

/** What a tab PAINTS: the glyph, centred; when `on`, brand ink + wash + the tinted capsule.
 *  Presentational only, so the navigating tab (TabBody) and the sign-in-gated button share it. */
function TabFace({ on, icon, capsule = true, stack = STACK }: { on: boolean; icon: TabIcon; capsule?: boolean; stack?: string }) {
  // Location-active = soft duotone (icon-language §5): the ink turns brand AND the glyph fills
  // its whole body with brand-100 — the same rule the category tiles and the dashboard rail
  // follow, so one selection language runs across every nav surface. The
  // `:not([class*=fill-])` guard skips any icon already carrying an explicit fill-* class, so a
  // user-state fill always wins over mere location.
  // THE CAPSULE: `bg-accent` (brand-50 in light, the deep blue tint in dark), `inset-1` inside a tab
  // that itself sits inside the pill's 1px border — 5px in from the pill's outer edge, so its 23px
  // radius is concentric with the pill's 28px one. It grows from its centre with `bar-in`
  // (globals.css — the snappy spring, 200ms) in the same window the wash fades up, so the two read
  // as ONE move. Both are added by the class flip, so they run once per activation, and
  // `useLinkStatus`'s `pending` means they start on the TAP, before the destination has loaded.
  // ⚠️ THE POST-HYDRATION LIGHT-UP ANIMATES TOO, ON PURPOSE. A timer that zeroed it for "the first
  // 400ms" was tried and deleted (2026-09-27): every review round found a new hole in it — a tap
  // near its end replayed the grow mid-way, a guest's auth-driven remount landed after it, and an
  // auth that never settled froze every transition in the bar. The capsule arriving once on a cold
  // load is the same "you are here" statement a tap makes; there is no second mechanism to keep true.
  // ⚠️ THE SPRING IS SAFE HERE, where it was not on the old flush bar: the capsule rests inside
  // the pill, so its 3% overshoot has room to go and never opens a gap on an edge.
  return (
    <span className={cn(stack, on ? cn('text-accent-foreground', '[&_svg:not([class*=fill-])]:fill-brand-100', 'wash-in', '[--tab-surface:var(--color-accent)]') : 'text-body')}>
      {on && capsule && <span aria-hidden className="bar-in absolute inset-1 rounded-full bg-accent" />}
      <TabGlyph icon={typeof icon === 'function' ? icon(on) : icon} />
    </span>
  )
}

/** Content of a navigating tab. Lives INSIDE <Link> so useLinkStatus lights it the instant it's
 *  tapped — feedback before the destination loads. */
function TabBody({ active, ...face }: { active: boolean; icon: TabIcon; capsule?: boolean; stack?: string }) {
  const { pending } = useLinkStatus()
  return <TabFace on={active || pending} {...face} />
}

/** A tab that needs sign-in (Messages / Account — Post left this list 2026-09-25, see the Post tab
 *  below: the wizard is draft-first, so a guest belongs IN it). When auth has resolved to
 *  logged-out, tapping opens the standardized sign-in modal instead of navigating
 *  to a page that would gate inconsistently — so every gated action on mobile
 *  meets the SAME card. While auth is still resolving (or signed in) it's a normal
 *  Link, so a logged-in user is never wrongly shown the modal. */
function GatedTab({ href, active, onHref, icon, label, gate, onClick, prefetch, stack }: { href: string; active: boolean; onHref?: boolean; icon: TabIcon; label: string; gate: boolean; onClick: (e: React.MouseEvent<HTMLAnchorElement>) => void; prefetch?: false; stack?: string }) {
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
      // onPointerDown={preloadSignIn}: the dialog's chunk starts downloading on the finger's
      // DOWN, ~100ms before the click that opens it — see preloadSignIn in auth-context.tsx.
      // `focus-visible:ring-0`: ui/button's base adds a 3px `ring-ring/50` halo on top of the global
      // outline, so these two tabs showed a different focus style from the three links beside them.
      // ⚠️ IT STILL SHOWS LOCATION. A guest can stand on /messages (the page renders its own sign-in
      // prompt), and with no labels in the bar an idle glyph there left nothing saying where they
      // were. The capsule + brand ink + `aria-current` come back; the tap still opens the card.
      <Button type="button" variant="bare" size="none" onPointerDown={preloadSignIn} onClick={() => openSignIn()} aria-label={label} aria-current={active ? 'page' : undefined} className={cn(TAB, 'focus-visible:ring-0')}>
        <TabFace on={active} icon={icon} stack={stack} />
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
      <TabBody active={active} icon={icon} stack={stack} />
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
      window.scrollTo({ top: 0, behavior: scrollBehavior() })
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
  // are device-local), and Post is draft-first (sign-in at Publish), so none of those
  // three is ever gated.
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
        // ⛔ A FLOATING PILL, NOT A DOCKED BAR (owner, 2026-09-26 — the note at the top of this file).
        // GEOMETRY: `inset-x-3` + `max-w-sm mx-auto` = 12px from each side on a phone, centred and
        // capped at 384px on anything wider, so five icon-only tabs never stretch into a strip.
        // `bottom: max(12px, safe area)`: on a phone with a home indicator the inset itself is the
        // gap and the pill rests just above it; with no inset it floats 12px up. 56px tall (`h-14`),
        // so its top edge is at most 68px + inset — inside the 4.5rem + inset every dependant clears.
        // ⚠️ `html.native .mobile-nav` (globals.css) restates `bottom` with the Capacitor
        // `--safe-area-inset-bottom` fallback; it used to add that inset as padding-bottom instead,
        // which on a pill would have made the capsule 34px taller rather than lifting it.
        // SURFACE: the floating tier (canon §3b) — bg-popover/95 + `material` + backdrop-blur-md, the
        // same material the sticky action bars wear (`.material` is what makes reduce-transparency
        // and prefers-contrast take it solid), `shadow-pop` (one light source, from above), and a
        // 1px `border-foreground/10` edge — the separation that holds on the top edge and in dark
        // mode, where the shadow does not. ⛔ NOT `ring-1`: the unlayered `.shadow-pop` rule
        // overwrites a ring's box-shadow (the note at the top of this file). The border takes 1px a
        // side out of the tabs (54px tall, still past the 48px floor); the capsule accounts for it.
        // The old `hairline-t` is gone with the edge it drew.
        // ⚠️ THE PILL IS THE <nav> ITSELF, not a pill inside a full-width fixed strip. A transparent
        // strip would either swallow taps on the page beside the pill or need pointer-events split
        // across two elements, and the retract below (pointer-events-none while hidden, focus-within
        // bringing it back, `inert` while typing) would have to be taught to reach through it.
        // ⚠️ BOTH `translate` AND `transform`, AND THE PAIR IS NOT REDUNDANT — the bar is moved by
        // two different mechanisms. Tailwind's `translate-y-*` compile to the standalone `translate`
        // property in v4 (see the note on #app-header), so naming only `transform` made the bar
        // teleport in a single frame on every scroll reversal while its opacity faded over 250ms.
        // But `html.kb-open .mobile-nav` in globals.css retracts it with a real `transform` (the same
        // height-plus-gap travel as below) when the keyboard opens, so dropping `transform` here would
        // trade one snap for another. Listing both is what makes every route into and out of this
        // bar continuous. `ease-out`, not the house spring: a retracting bar travels to a resting
        // place, and an overshoot there reads as a wobble (globals.css, the motion contract).
        'mobile-nav lg:hidden fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px))] z-40 [--tab-surface:var(--color-popover)] mx-auto h-14 max-w-sm rounded-full border border-foreground/10 bg-popover/95 shadow-pop backdrop-blur-md material transition-[translate,transform,opacity] duration-[250ms] ease-out [will-change:translate,transform,opacity] motion-reduce:transition-none',
        // Reveal-on-focus: if a keyboard user tabs into the (scroll-hidden) bar, :focus-within
        // out-specificities the retract below and slides it back into view — never an invisible,
        // focused control. (Harmless while docked; a no-op when inert during keyboard-up.)
        'focus-within:translate-y-0 focus-within:opacity-100 focus-within:pointer-events-auto',
        // Slides DOWN off-screen + fades while scrolling down to browse (returns on scroll-up /
        // near the top) and while the on-screen keyboard is open (so a chat composer sits flush
        // above it); docked and visible otherwise.
        // ⚠️ `100%` IS NO LONGER ENOUGH: the pill floats, so its own height leaves it short of the
        // screen edge by the gap below it. The travel is its height PLUS that gap (the same max()
        // as `bottom`, Capacitor's fallback inset included), so it leaves the screen entirely
        // rather than hanging half-faded over the home indicator.
        off ? 'translate-y-[calc(100%+max(0.75rem,env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px)))] opacity-0 pointer-events-none' : 'translate-y-0 opacity-100',
      )}
    >
      {/* Five equal tabs, each the FULL height inside the pill's border (54px) — the tap target is the whole
          tab, never just the glyph, so there is no dead band along the pill's top or bottom. No
          text lives in the bar, so the enlarged-text growth the old `min-h` allowed for is moot. */}
      <div className="flex h-full items-stretch">
      <Link href="/" prefetch={at('/') ? false : undefined} aria-label={tr('Explore', 'Khám phá')} aria-current={at('/') ? 'page' : undefined} className={TAB} onClick={(e) => onTabClick(e, at('/'))}>
        {/* ⚠️ COMPASS RENDERS AS THE TWO-LAYER DUOTONE, not a single filled svg. The glyph draws
            the needle FIRST and the outer circle SECOND, so a fill applied to the whole svg
            paints the circle over the needle and the glyph collapses into a solid disc (owner,
            2026-08-07: "mobile explore icon when filled inside disappears"). CategoryGlyphArt
            paints the tint UNDERNEATH an untouched ink layer, so the needle survives the fill —
            the same reason the category tiles never had this problem. The other three tabs
            (Heart, MessageSquare, User) have no self-covering child and stay single-svg. */}
        <TabBody
          active={at('/')}
          icon={(on) => <CategoryGlyphArt Icon={Compass} selected={on} stroke={STROKE} className="h-7 w-7" />}
        />
      </Link>

      {/* Saved is public — favorites are stored device-local (localStorage), so a
          logged-out visitor can save and review listings without an account. */}
      <Link href="/saved" prefetch={at('/saved') ? false : undefined} aria-label={tr('Saved', 'Đã lưu')} aria-current={at('/saved') ? 'page' : undefined} className={TAB} onClick={(e) => onTabClick(e, at('/saved'))}>
        <TabBody
          active={at('/saved')}
          icon={(
            <>
              {/* ⛔ COLOUR MEANS "YOU ARE HERE", AND NOTHING ELSE — owner, 2026-08-28: "only blue if button
                  is pressed not when has noticification or saved counter increases". The pre-2026-08-28
                  glyph carried `count > 0 && 'fill-brand text-brand'`; it is not restored with the glyph.
                  The COUNT BADGE says there is something to see. Location comes from TabBody's wash and the
                  link's aria-current (Solar Bold). */}
              <Heart className="h-7 w-7" strokeWidth={STROKE} />
              {/* `ring-(--tab-surface)` — a 2px cut-out in the colour of whatever is directly under the badge: the
                  pill (set on the <nav>), or the capsule while this tab is active (set by TabFace). A fixed
                  `ring-popover` drew a pill-coloured halo on the tinted capsule — a white hole in light mode. */}
              {count > 0 && (
                <Badge variant="counter" size="count" className="absolute -right-2 -top-1 ring-2 ring-(--tab-surface)">
                  {count}
                </Badge>
              )}
            </>
          )}
        />
      </Link>

      {/* ⛔ POST IS NOT A GATED TAB — owner, 2026-09-25: "Draft first, sign in at Publish". A guest's
          tap goes straight into the wizard, exactly as the desktop header's Post button and /post
          itself already did; the wizard keeps the draft and asks for sign-in at Publish, after the
          sunk cost. Before this, the phone — where this coin is THE way in — was the one entry
          that met guests with the sign-in modal instead (measured on eno.vn: the URL stayed on /
          and the dialog opened).
          ⚠️ A PLAIN <Link>, NOT <GatedTab gate={false}>. GatedTab swallows a tap made while auth
          is still resolving and REPLAYS it afterwards as `user ? push(href) : openSignIn()`, so a
          guest's first tap — most first taps land in that window — would still have opened the
          modal. /post is the same page for a guest and a member, so there is nothing to wait for.
          PREFETCH: off during that window for the reason GatedTab gives (it is the slowest part of a
          cold mobile load); after it, a guest now gets the same auto prefetch a member always had —
          deliberately. Before, a resolved guest's coin was a <button> and prefetched nothing, because
          it went nowhere; now it goes to /post, and auto warms only the route's shell (post/loading.tsx
          is the boundary), which is what makes the tap paint at once. Same rule as Explore and Saved.
          Only this link's own props changed hands: GatedTab's `onHref` fed nothing but this prefetch
          rule, the pending highlight (useLinkStatus) lives in TabBody, and its only haptic belonged
          to the swallowed boot-window tap that no longer exists here.
          Re-tapping never scrolls to top (`false`), as before. */}
      <Link
        href="/post"
        prefetch={at('/post') || loading ? false : undefined}
        aria-label={tr('Post', 'Đăng tin')}
        aria-current={at('/post') ? 'page' : undefined}
        className={TAB}
        onClick={(e) => onTabClick(e, false)}
      >
        <TabBody
          active={at('/post')}
          // Emphasised but FLAT: a soft tinted chip (canon chip = rounded-full + tint, §2) with a
          // brand-blue plus — no shadow, no FAB lift, no heavy solid fill. It reads as the primary
          // action while staying part of the same flat canvas as the other tabs. Its plate is the
          // commerce tint (`bg-cta-50` — canon: orange belongs to price, Post and commerce badges);
          // the history of that choice is on the coin below.
          stack={STACK}
          // ⛔ NO CAPSULE ON THIS TAB, AND NO PLATE WHILE IT IS ACTIVE. On /post the capsule wrapped the
          // 40px coin and the coin's glyph went solid over its orange plate, which left ~1px of the plate
          // as a rim: three nested shapes (pale capsule, peach rim, blue disc — navy/brown/light-blue in
          // dark). The solid brand disc IS the "you are here" mark, so the capsule is skipped and the
          // plate drops away under it; at rest the tab is the orange-plated coin exactly as before.
          capsule={false}
          icon={
            // ⚠️ THE MARK FILLS THE COIN — same treatment as the floating support control, owner
            // 2026-08-26. The bold sprite layer's ink is 0.896 of its box (21.5 of 24 units), so the
            // box is 42px to paint 37.6px of ink inside the 40px coin: ~1.2px of visible gap. A
            // `size-10` glyph would have painted 35.8px and read as a small plus in a big disc.
            // ⚠️ THE RADIUS ALREADY MATCHES THE GLYPH and needs no change: this icon is Solar's
            // `add-circle` — a plus inside a CIRCLE — and the coin is `rounded-full`. Concentric by
            // construction, which is the whole reason the fill reads as deliberate.
            /* ⛔ BLUE MARK ON THE ORANGE PLATE, and the pair was swapped twice before it landed (owner,
               2026-09-18: "pos icon orange plate button itself blue", then "inverse — button icon
               itself blue, the backplate color is orange"). So the disc carries the commerce tint and
               the plus carries the brand — which also keeps the ink the strongest thing in the coin:
               measured, brand blue on --cta-50 is 4.80:1, where the reverse pairing put the lighter
               orange on a tint. Every other tab in this bar is flat blue, so this one still reads as
               the action. */
            // ⚠️ THE PLATE LEAVES ON `aria-current`, NOT ON `on`. The solid disc is the Solar BOLD layer, which
            // globals.css swaps in on the link's `aria-current` — set only once the route has changed. Keyed
            // on `on` (active || pending) the plate dropped at the TAP, so on a slow network the coin sat as a
            // bare outlined plus until /post arrived. Same selector, same 130ms as the bold layer's own swap,
            // so plate-out and disc-in are one crossfade whatever the network does.
            <span className="flex size-10 items-center justify-center rounded-full bg-cta-50 text-brand transition-colors duration-[130ms] [[aria-current=page]_&]:bg-transparent">
              <Plus className="h-[42px] w-[42px] shrink-0" strokeWidth={STROKE} />
            </span>
          }
        />
      </Link>

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
        icon={(
          <>
            {/* Same rule as Saved: colour is location only — the pre-2026-08-28 unread fill is not restored;
                unread is the badge's job. */}
            <MessageSquare className="h-7 w-7" strokeWidth={STROKE} />
            {user && unread > 0 && (
              <Badge variant="counter" size="count" className="absolute -right-2 -top-1 ring-2 ring-(--tab-surface)">
                {unread > 9 ? '9+' : unread}
              </Badge>
            )}
          </>
        )}
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
