'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * STICKY ACTION BAR — one secondary + one primary action, pinned to the bottom edge, never
 * scrolled away. For surfaces whose whole purpose is a single decision (contact this seller,
 * publish this listing, apply these filters).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ⚠️⚠️ THE CALLER MUST RESERVE SPACE. A fixed bar covers the bottom of the page, so the last
 * row of content is unreachable unless something in the flow stands in for the bar. THIS
 * PRIMITIVE CANNOT DO IT — it does not own the page. Render <StickyActionBarSpacer /> as the
 * last element of the page's scrolling content, or the bottom of every surface that mounts
 * this bar is quietly broken. The spacer sizes itself from the bar (see its own note); it is
 * one import and one tag, and it is not optional.
 *
 * ⚠️⚠️ AND WHATEVER DECIDES WHETHER THE BAR EXISTS MUST DECIDE THE SPACER IDENTICALLY. One rule,
 * two shapes, both found by reviewers reading this doc against its own spacer:
 *   · A BREAKPOINT. `lg:hidden` on the bar needs `lg:hidden` on the spacer — the same pairing
 *     <MobileNav> and <BottomNavSpacer> have, where both carry their own copy. Without it a
 *     desktop visitor reserves 72px on first paint for a bar that is not there; it collapses
 *     once the hidden bar measures 0, i.e. a layout shift at the bottom of the page, and it
 *     never collapses at all with JavaScript off.
 *   · A CONDITION. `{canContact && <StickyActionBar/>}` needs `{canContact && <Spacer/>}`. This
 *     one CANNOT be repaired at runtime: if the bar never mounts, nothing ever measures, and the
 *     spacer holds its static fallback forever — 72px of dead space for, say, a seller looking
 *     at their own listing. (The reverse, a bar that mounts and later unmounts, IS handled: it
 *     publishes 0px on the way out.)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ THE BOTTOM EDGE IS ALREADY TAKEN ON MOBILE, AND THE OBVIOUS ANSWER IS THE ONE THE OWNER
 * ALREADY REJECTED. <MobileNav> is `fixed inset-x-0 bottom-0 z-40`, mounted unconditionally
 * from app/providers.tsx, and it is 72px tall (`min-h-[4.5rem]`; the file's own note records
 * it dropping 73→72 when the top border became a hairline pseudo-element). Three options
 * existed:
 *
 *   (a) REPLACE the tab bar on surfaces that use this one. THIS IS WHAT `PdpMobileBar` DID and
 *       it was deleted on 2026-07-18 (cd9127a7, "PDP mobile: restore the bottom tab-nav, drop
 *       the Chat/Make-offer bar") — the PDP hid <MobileNav> for `/listings/`, and the owner
 *       reverted it: buyers lost the app's navigation on the page they spend the most time on.
 *       mobile-nav.tsx still carries the note. Rebuilding this would be repeating a decision
 *       that has already been made against, so it is not on the table.
 *   (b) ONLY EXIST WHERE THE TAB BAR DOES NOT — i.e. `lg:` and up. That deletes the bar from
 *       the only viewport where a sticky CTA earns anything.
 *   (c) SIT ABOVE IT. ← chosen. The bar pads its own bottom by the tab bar's height, so its
 *       CONTENT clears the tabs while its BACKGROUND still runs to `bottom: 0`. The background
 *       matters: <MobileNav> auto-hides on scroll-down (useHideOnScroll), and a bar that ended
 *       at the tabs' top edge would tear open a 72px window onto the scrolling page every time
 *       they retract. This is the same shape post-wizard.tsx's publish bar already ships.
 *
 * ⚠️ THE OFFSET IS THE CALLER'S NUMBER, NOT OURS. `offsetBottom` is a CSS length, default
 * `'0px'`. Nothing here knows or names the tab bar's height — a primitive that hard-codes
 * another component's geometry is a second, silent declaration of it, and this repo already
 * has two of those to keep in sync (bottom-nav-spacer.tsx and its `html.native` rule in
 * globals.css, both spelling 4.5rem, flagged in native-text-zoom.ts). Pass `'4.5rem'` on a
 * mobile surface where <MobileNav> is mounted; leave it off where it is not. Omitting the prop
 * also lets an ancestor set `--sticky-action-bar-offset` and have every bar below inherit it.
 *
 * ⚠️ SAFE-AREA AND KEYBOARD COME FROM `.kb-bottom`, THE APP-WIDE CONTRACT (globals.css,
 * "KEYBOARD-AWARE SURFACES"), NOT FROM A SECOND env() HERE. One declaration reserves the home
 * indicator at rest and grows onto the on-screen keyboard while typing — which this bar needs
 * because the native app runs `Keyboard: { resize: None }`, so a bottom-pinned control sits
 * BEHIND the keyboard without it. Two consequences worth knowing:
 *   · There is no way to double-count the inset. `.kb-bottom` is UNLAYERED css, so it beats
 *     every Tailwind padding utility no matter who writes one — including a caller's own
 *     bottom-padding class passed through `className`, which is silently ignored rather than
 *     added. Express extra resting padding on the panel, not on the root.
 *   · The tab-bar offset COLLAPSES while the keyboard is up, because `html.kb-open .mobile-nav`
 *     hides the tab bar — leaving the offset in would float this bar 72px above the keyboard.
 *     That is the `html.kb-open` variant on the root; it out-specifies the resting declaration
 *     (two classes vs one) rather than racing it.
 *
 * ⚠️ `data-fab-clear` IS LOAD-BEARING. back-to-top.tsx measures every element carrying it and
 * lifts its z-[60] cluster above the tallest one; without the attribute the floating chevron
 * lands on top of this bar's primary CTA. It is baked in here so no call site can forget it.
 * It goes on the ROOT, not the panel, and a reviewer read that as a bug: the root is
 * `.kb-bottom`, so while the keyboard is up its height grows by the keyboard and the chevron
 * gets lifted by that much. REFUTED — it is the correct number, and the arithmetic is the
 * proof. back-to-top computes `innerHeight - rect.top`, which for a bottom-pinned element is
 * its full height however that height is made up. While the keyboard is up this bar's CONTENT
 * has itself risen onto the keyboard, so the chevron has to clear panel + keyboard to be
 * visible at all; landing it any lower would put it behind the keyboard. Measuring the panel
 * instead would give the identical figure anyway, since `innerHeight - panelTop` still spans
 * the root's padding below it.
 *
 * BASE UI: THE CONTROLS COME FROM A PRIMITIVE, THE CONTAINER DELIBERATELY DOES NOT.
 * Both actions are ui/button (itself Base UI's Button), which is where the interactive
 * behaviour lives. For the container, `@base-ui/react/toolbar` does exist in this version and
 * was ruled out on purpose: Toolbar.Root is a COMPOSITE — role="toolbar" plus roving tabindex,
 * so the pair becomes ONE tab stop and reaching the other action needs an arrow key. That is
 * the right trade for a dense cluster of small controls (a formatting bar, which is what the
 * ARIA pattern is aimed at) and the wrong one for two full-width buttons where the whole point
 * is that the primary is one Tab away. It would also force each action through Toolbar.Button
 * to register with the composite, wrapping ui/button in a second layer for no behaviour we
 * want. Every other bar in this app (mobile-nav, the post-wizard footer) is plain tab order
 * too. So the container is a bare <div> that adds nothing but geometry.
 *
 * TAB ORDER: the bar is `fixed`, so where it sits in the DOM is free. Mount it EARLY in the
 * page (before the long content), not last — otherwise a keyboard user tabs through the whole
 * page to reach the action the page exists for.
 *
 * CONTAINING BLOCK: `position: fixed` resolves against the viewport unless an ancestor has a
 * transform/filter/containment. Do not mount this inside one.
 *
 * HOW THE CSS BELOW WAS VERIFIED, because a test in jsdom can only prove that a class STRING is
 * emitted, never that Tailwind compiles it or what it compiles to. Every arbitrary utility and
 * variant here was fed through this repo's own tailwindcss 4.3.3 (`compile()` from
 * tailwindcss/dist/lib.mjs, base = the worktree) and the output read. What that measurement
 * settled, and could not have been settled by reading:
 *   · the ancestor variant emits `html.kb-open .<class>` — TWO classes, so it beats the resting
 *     one-class declaration on specificity alone, in the same layer, with no ordering to rely on;
 *   · the starting variant emits a real `@starting-style` block;
 *   · and the one that changed the code: a translate utility compiles to the STANDALONE
 *     `translate` property, not to `transform`, so the transition list names `translate`.
 * Re-run it before changing any of these strings.
 */

/** The custom property the bar reads for its clearance above whatever owns the bottom edge. */
const OFFSET_VAR = '--sticky-action-bar-offset'

/**
 * The measured height of the bar's PANEL — the part that is not the offset and not the
 * safe-area inset. Published on <html> so <StickyActionBarSpacer /> can size itself without a
 * shared React context, mirroring how `--kb-h` is published (use-virtual-keyboard.ts).
 */
const HEIGHT_VAR = '--sticky-action-bar-h'

/** One action. Exactly two of these ever appear: one secondary, one primary. */
export interface StickyActionBarAction {
  /** Visible label. Already translated by the caller — this primitive holds no copy. */
  label: React.ReactNode
  /** Optional leading glyph. ui/button sizes it to 16px unless it carries its own size class. */
  icon?: React.ReactNode
  /** Fired on activation. Applied to `render`'s element too when both are given. */
  onClick?: React.MouseEventHandler<HTMLElement>
  /**
   * Render the action as something else — a `<Link href=… />`, an `<a>`. Keeps this primitive
   * free of a router dependency, like the rest of ui/*. The element is cloned: it keeps its own
   * href/ref/handlers, and RECEIVES THE LABEL + ICON AS ITS CHILDREN, so any children it already
   * had are replaced. An `onClick` it already carries is composed with `onClick` above (child
   * first), not overwritten.
   * ⚠️ Ignored ENTIRELY when `disabled` is set — a link has no disabled state, so a disabled
   * action renders as a real, disabled button and EVERY prop on your element goes with it: the
   * href, any data-testid, onMouseEnter prefetching, all of it. Toggling `disabled` therefore
   * swaps the element type and remounts it, dropping focus and any transition in flight. Fine
   * for a state decided once; for an action whose disabled flips while the user watches (a
   * publish gate), use the plain path.
   * ⚠️ `type` is filled in only for a LITERAL `<button>` child. A component that happens to
   * render a button (`render={<SubmitButton />}`) is opaque here and owns its own type.
   * ⚠️ A reviewer claimed the `defaultPrevented` guard on `onClick` breaks next/link, on the
   * theory that Link preventDefaults every SPA navigation before the action handler is reached.
   * REFUTED, measured in node_modules/next/dist/client/app-dir/link.js — Link's own handler
   * calls the caller's `onClick(e)` FIRST, then checks `e.defaultPrevented` and only navigates
   * if it is false. So this handler runs strictly before any preventDefault Link performs.
   */
  render?: React.ReactElement<Record<string, unknown>>
  disabled?: boolean
  /** Accessible name, when the visible label is not one (an icon-led or truncated label). */
  ariaLabel?: string
  /** Native button type. Defaults to `'button'` so a bar inside a <form> never submits it. */
  type?: 'button' | 'submit'
}

export interface StickyActionBarProps {
  /** The one thing the page is for. Rendered as `variant="cta"`, the single brand CTA. */
  primary: StickyActionBarAction
  /** The alternative. Omit it and the primary fills the bar. */
  secondary?: StickyActionBarAction
  /**
   * CSS length of whatever already owns the bottom edge on this surface, e.g. `'4.5rem'` for
   * <MobileNav>.
   *
   * ⚠️ OMITTING IT IS NOT THE SAME AS PASSING `'0px'`, AND AN EARLIER VERSION OF THIS LINE SAID
   * IT WAS. Omitted, the bar sets no inline value and INHERITS `--sticky-action-bar-offset` from
   * any ancestor — the deliberate escape hatch for a layout that wants to set the clearance for
   * everything below it, but also a way for an unrelated wrapper to lift a bar it knows nothing
   * about. Pass `'0px'` (or `''`, which is normalised to it) to pin the bar to the bottom edge
   * whatever an ancestor says. With nothing set anywhere the effective value is 0px.
   */
  offsetBottom?: string
  /** Accessible name for the bar itself. Given one, the bar becomes a labelled group. */
  label?: string
  /**
   * Merged onto the ROOT via cn(). Put `lg:hidden` here when the surface has a desktop CTA —
   * and pass the SAME class to <StickyActionBarSpacer />. See the second ⚠️⚠️ at the top.
   */
  className?: string
}

/** How many bars are mounted — see the dev warning in the effect below. */
let mountedBars = 0

function BarAction({
  action,
  variant,
  marker,
}: {
  action: StickyActionBarAction
  variant: 'cta' | 'outline'
  marker: 'primary' | 'secondary'
}) {
  const content = (
    <>
      {action.icon}
      {action.label}
    </>
  )

  // ⚠️ min-h-12 (48px), NOT h-12, AND NOT A tap-* PSEUDO.
  // · min- because -webkit-text-size-adjust scales the line box with the OS text-size setting
  //   (see the size note in ui/button.tsx); a hard height clips the label mid-glyph, which is
  //   the failure that shelved the hand-built native apps. The deleted PdpMobileBar used h-12.
  // · no pseudo hit area, because globals.css says so in as many words: "PREFER NOT NEEDING IT.
  //   If the control is already ≥44px … do NOT add the utility at all". These are full-width
  //   flex-1 controls at 48px — the visual box IS the tap target, so there is nothing invisible
  //   to overflow onto a neighbour, and none of the tap-stealing trap applies. ui/button does
  //   not bake `relative`, which is the other half of that trap.
  // size="lg" supplies the rounded-xl control radius (design-language §2) and the horizontal
  // padding; min-h-12 wins over its min-h-10 through tailwind-merge.
  const className = 'min-h-12 flex-1 gap-1.5'

  if (action.render && !action.disabled) {
    // ui/button's asChild clones the child and does NOT compose handlers, so onClick has to go
    // on the child element — which is exactly what this clone does. Everything else the caller
    // put on their element (href, ref, prefetch) survives.
    const childProps = action.render.props
    // ⚠️ COMPOSE THE HANDLER, DO NOT REPLACE IT. All three reviewers flagged the first version,
    // which passed `onClick: action.onClick` straight into cloneElement: a caller writing
    // `render={<Link href=… onClick={track} />}` alongside an `onClick` on the action lost their
    // own handler silently — no error, no warning, the analytics ping just never fires. React
    // props are replaced, not merged. The child's handler runs first (it is the more specific
    // statement about that element), then the action's.
    // ⚠️ AND STOP IF THE CHILD CANCELLED. The first composed version ran both unconditionally,
    // which is a worse bug than the one it fixed — and the test that came with it asserted the
    // wrong behaviour, so it was pinned in place rather than caught. Concretely:
    // `render={<Link onClick={e => { if (!signedIn) { e.preventDefault(); openSignIn() } }} />}`
    // with `onClick: logContactReveal` cancels the navigation for a guest and STILL logs a
    // contact reveal that never happened — on a marketplace where that number feeds trust.
    // `preventDefault()` is the child saying "this activation is off"; the action handler is part
    // of that activation. Same guard Base UI and Radix put in composeEventHandlers.
    const childClick = childProps.onClick as React.MouseEventHandler<HTMLElement> | undefined
    const onClick =
      childClick && action.onClick
        ? (e: React.MouseEvent<HTMLElement>) => {
            childClick(e)
            if (!e.defaultPrevented) action.onClick?.(e)
          }
        : (action.onClick ?? childClick)
    // ⚠️ `type` IS FILLED IN ONLY FOR A BARE <button> CHILD. `render` is meant for a NAVIGATION
    // element, but nothing stops a caller passing a button — and HTML's default for one inside a
    // <form> is `submit`, which is the exact accident `type` exists to prevent on the ordinary
    // path. Filling it in only when the child is a <button> that declares none keeps a caller's
    // explicit `type="submit"` intact and never puts a bogus `type` attribute on an <a>.
    const fillType = action.render.type === 'button' && childProps.type === undefined
    const child = React.cloneElement(
      action.render,
      {
        ...(onClick ? { onClick } : {}),
        ...(action.ariaLabel ? { 'aria-label': action.ariaLabel } : {}),
        ...(fillType ? { type: action.type ?? 'button' } : {}),
      },
      content,
    )
    return (
      <Button asChild variant={variant} size="lg" className={className} data-action={marker}>
        {child}
      </Button>
    )
  }

  return (
    <Button
      type={action.type ?? 'button'}
      variant={variant}
      size="lg"
      className={className}
      disabled={action.disabled}
      aria-label={action.ariaLabel}
      onClick={action.onClick}
      data-action={marker}
    >
      {content}
    </Button>
  )
}

export function StickyActionBar({
  primary,
  secondary,
  offsetBottom,
  label,
  className,
}: StickyActionBarProps) {
  const panelRef = React.useRef<HTMLDivElement>(null)

  const write = React.useCallback(() => {
    if (panelRef.current) {
      document.documentElement.style.setProperty(HEIGHT_VAR, `${panelRef.current.offsetHeight}px`)
    }
  }, [])

  // ⚠️ NO DEPENDENCY ARRAY — THIS RE-MEASURES AFTER EVERY RENDER, AND THAT IS THE POINT.
  // The observers below cover the panel changing size on its own (viewport, font swap). What
  // they do NOT cover on an engine without ResizeObserver is the panel changing size because
  // its CONTENT changed — and that is the case that actually happens: a visitor switches EN→VI,
  // "Message seller" becomes a label that wraps to two lines, the panel grows past 72px, and no
  // resize, orientationchange or font event fires at all. Two reviewers found it from opposite
  // ends after the observer branch was added, which is fair: the earlier comment enumerated
  // every cause except the one under this component's own control. A render is exactly the
  // signal for it, and the bar renders rarely enough that one offsetHeight read per render is
  // not a cost worth optimising.
  //
  // ⚠️ IT IS DELIBERATELY NOT GATED ON "no ResizeObserver", THOUGH IT COULD BE. Gating removes a
  // forced reflow per render on modern engines — a reviewer's fair objection — but it also
  // removes the only self-repair the two-bar window has: when a route transition briefly mounts
  // two bars and the one that measured last unmounts first, the survivor is left holding a
  // height it never wrote, and a plain re-render is the cheapest thing that fixes it. One
  // offsetHeight on a two-button bar, inside a layout effect where layout is being computed
  // anyway, is the price for that. If this ever shows up in a profile, gate it and accept the
  // stale window instead — but measure first.
  React.useLayoutEffect(write)

  // ⚠️ useLayoutEffect, NOT useEffect, AND THE DIFFERENCE IS THE BUG THIS COMPONENT EXISTS FOR.
  // A passive effect is flushed AFTER paint, so the first frame reserves the spacer's static
  // fallback (72px) and the measured value lands one frame later. At the default text size with
  // a one-line label those are the same number and nothing moves — which is exactly why an
  // earlier draft's "the measurement changes nothing visible" survived review. It is false on a
  // 320px screen with a wrapping Vietnamese label, or at an enlarged OS text size: the panel is
  // taller than the fallback, so the page paints once with the last row under the CTA and then
  // jumps. Measuring inside the same commit removes the frame. Same reasoning, same words, as
  // listings-explorer.tsx's own layout effects; the repo already runs these on its most-SSR'd
  // route, so the server-render caveat is one it has already accepted.
  React.useLayoutEffect(() => {
    // ⚠️ ONE BAR PER SURFACE. The published height is a single global, so two mounted bars
    // overwrite each other's measurement and the spacer reserves whichever wrote last — and if
    // the second one then unmounts first, its height is what stays behind (the survivor has no
    // reason to re-measure). That is not defended against beyond this warning: a registry would
    // be machinery for a case that is already a misuse, and the warning is louder than a silent
    // repair would be. Mount one.
    // ⚠️ IT CAN CRY WOLF ON A ROUTE CHANGE. The App Router keeps the outgoing tree mounted while
    // the incoming one commits, so PDP→PDP logs this once even though the app is correct. Dev
    // only, and a false positive here is cheaper than the silent wrong height it is watching for.
    mountedBars += 1
    if (process.env.NODE_ENV !== 'production' && mountedBars > 1) {
      console.warn(
        `[StickyActionBar] ${mountedBars} bars mounted at once. Only one can publish ${HEIGHT_VAR}, so <StickyActionBarSpacer /> will reserve the wrong height.`,
      )
    }

    const panel = panelRef.current
    const root = document.documentElement

    // ResizeObserver is guarded, not assumed: this app still runs inside old Android WebViews
    // and the Zalo / Facebook in-app browsers (the same reason mobile-nav.tsx reasons about
    // engines without `inert`), and jsdom does not implement it either.
    //
    // ⚠️ THE NO-RO BRANCH NEEDS ITS OWN TRIGGERS, IT IS NOT "MEASURE ONCE AND HOPE". Two
    // reviewers landed on the same hole from opposite ends: the panel is `lg:hidden` on any
    // caller that has a desktop CTA, so a tablet loading at ≥1024px publishes 0px — correct
    // while the bar is hidden — and a rotation to portrait then brings the bar back with the
    // spacer still holding that 0px, i.e. the last row of the page stranded under the CTA.
    // resize + orientationchange close that one.
    //
    // ⚠️ AND A THIRD TRIGGER, BECAUSE resize DOES NOT COVER WHAT AN EARLIER VERSION OF THIS
    // COMMENT CLAIMED IT DID. It said the listener also caught "a late font swap". It does not:
    // a font finishing load reflows the page but dispatches no `resize` — the event fires for
    // viewport changes only. On a no-RO engine a swap that makes a Vietnamese label wrap would
    // have grown the panel with the spacer stuck on its fallback, permanently, until the device
    // was rotated. `document.fonts.ready` is the signal that actually fires for it. It is
    // one-shot and already resolved after a client-side navigation, so it only ever does work on
    // a cold load — which is the only time a swap happens. Optional-chained because the
    // FontFaceSet API is absent in the same old engines this branch exists for.
    //
    // The fourth cause — the panel growing because its LABEL changed — is not an event at all,
    // and is handled by the dependency-free layout effect above rather than here.
    //
    // Registered ONLY when there is no ResizeObserver — RO already fires for every one of these
    // cases, and a second path would just double the layout reads.
    //
    // rAF-coalesced: `write()` reads offsetHeight, which forces layout, and resize fires in
    // bursts while a window is dragged. Same shape as use-hide-on-scroll.ts and back-to-top.tsx.
    let ro: ResizeObserver | undefined
    let onResize: (() => void) | undefined
    let live = true
    if (panel && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(write)
      ro.observe(panel)
    } else if (typeof window !== 'undefined') {
      let ticking = false
      onResize = () => {
        if (ticking) return
        ticking = true
        requestAnimationFrame(() => {
          ticking = false
          write()
        })
      }
      window.addEventListener('resize', onResize, { passive: true })
      window.addEventListener('orientationchange', onResize, { passive: true })
      void document.fonts?.ready.then(() => {
        if (live) write()
      })
    }
    return () => {
      // ⚠️ CLAMPED AT ZERO. Fast Refresh re-evaluates this module while a bar is mounted, which
      // resets the counter to 0 — the surviving bar's cleanup would then drive it to −1, the
      // `=== 0` test below would never hold again, and the published height would be left on
      // <html> for the next spacer to read. Dev-only, and one Math.max.
      mountedBars = Math.max(0, mountedBars - 1)
      live = false
      ro?.disconnect()
      if (onResize) {
        window.removeEventListener('resize', onResize)
        window.removeEventListener('orientationchange', onResize)
      }
      // ⚠️ ZERO, NOT REMOVED — the difference is 72px of dead space on a real screen. Removing
      // the property lets `var(--sticky-action-bar-h, 4.5rem)` fall back, and the fallback means
      // "no bar has measured yet", not "no bar exists". A caller writing
      // `{canContact && <StickyActionBar/>}` beside an unconditional spacer would get exactly
      // the wrong reading: a seller viewing their own listing has no bar, and the spacer would
      // reserve 72px for it. Publishing 0px says what is true — a bar ran and it takes no room —
      // and leaves the fallback for the one window it is for, before any bar has mounted.
      // ⚠️ THIS ONLY REACHES THE CASE WHERE A BAR MOUNTED AND WENT AWAY. If the condition is
      // false on the FIRST render the bar never mounts, nothing writes, and the spacer holds its
      // fallback forever — which is why the spacer must carry the same condition as the bar (the
      // second ⚠️⚠️ at the top of this file). No unmount hook can fix a mount that never happened.
      if (mountedBars === 0) root.style.setProperty(HEIGHT_VAR, '0px')
    }
  }, [])

  return (
    <div
      // `data-fab-clear` is read by back-to-top.tsx — see the note at the top of this file.
      data-fab-clear
      data-slot="sticky-action-bar"
      role={label ? 'group' : undefined}
      aria-label={label}
      // The offset is a custom property rather than an inline paddingBottom on purpose: an
      // inline padding would beat `.kb-bottom` (inline style outranks every stylesheet rule,
      // layered or not) and take the safe-area and keyboard handling down with it.
      // ⚠️ `''` IS NORMALISED TO `'0px'`, AND `!== undefined` ALONE WAS NOT ENOUGH — MEASURED.
      // A caller writing `offsetBottom={showTabs ? '4.5rem' : ''}` means "no clearance", but the
      // empty string made the bar INHERIT an ancestor's `--sticky-action-bar-offset` and float
      // above an edge nothing owns. Swapping the truthiness test for `!== undefined` looked like
      // the fix and is not: React drops a style entry whose value is the empty string, emitting
      // no style attribute at all (the test written for this failed and said so). Only an
      // explicit value reaches the DOM. Omitting the prop entirely is still the way to inherit.
      style={
        offsetBottom !== undefined
          ? ({ [OFFSET_VAR]: offsetBottom === '' ? '0px' : offsetBottom } as React.CSSProperties)
          : undefined
      }
      className={cn(
        'fixed inset-x-0 bottom-0 z-30',
        // z-30 sits UNDER <MobileNav> (z-40) deliberately: the two overlap by design — this
        // bar's background runs beneath the tabs — and the tabs must paint on top. It is also
        // under every ui/* overlay (dialog/sheet at z-50) and under back-to-top's z-[60].
        // A hairline top edge, not a shadow: the flat language separates with a line, and this
        // is the same treatment <MobileNav> gives the app's other bottom edge. `hairline-t`
        // needs a positioned host and `fixed` is one.
        'hairline-t bg-background/95 backdrop-blur-md',
        // Safe area + keyboard, once. See the `.kb-bottom` note at the top of this file.
        'kb-bottom [--kb-bottom-extra:var(--sticky-action-bar-offset,0px)]',
        '[html.kb-open_&]:[--kb-bottom-extra:0px]',
        // It ARRIVES: rises from below the fold and fades up, once, on first render.
        // @starting-style (Tailwind v4's `starting:` variant) rather than a mount flag, so the
        // bar is fully visible in the SSR HTML and never depends on JS to appear — a CTA that
        // needs hydration to exist is not a CTA. Engines without @starting-style skip straight
        // to the resting state.
        // ⚠️ `translate`, NOT `transform`: Tailwind v4 emits translate utilities as the
        // standalone `translate` property, so a transition naming only transform would animate
        // nothing (the same omission ui/button.tsx documents in its property list).
        // Reduced motion kills it twice over — the explicit variant here, and the global
        // switch at the bottom of globals.css that collapses every duration to 0.01ms.
        'translate-y-0 opacity-100 transition-[translate,opacity] duration-[260ms] ease-[var(--ease-spring)]',
        'starting:translate-y-full starting:opacity-0 motion-reduce:transition-none',
        className,
      )}
    >
      {/*
        THE MEASURED PANEL. Its height is what the spacer reserves, which is why the resting
        vertical padding lives HERE and not on the root: the root's padding is the offset plus
        the safe-area inset, and both of those are already reserved by whatever owns the bottom
        edge (<BottomNavSpacer /> on mobile) or are zero. Measuring the panel alone means the
        spacer never has to subtract anything and never has to know the offset.
        Gutters follow the canonical page width so the actions line up with the content above.
      */}
      <div
        ref={panelRef}
        data-slot="sticky-action-bar-panel"
        className="mx-auto flex w-full max-w-7xl items-center gap-2 px-3 py-3 sm:px-6 lg:px-8"
      >
        {secondary ? <BarAction action={secondary} variant="outline" marker="secondary" /> : null}
        <BarAction action={primary} variant="cta" marker="primary" />
      </div>
    </div>
  )
}

/**
 * The space <StickyActionBar> takes out of the page. Render it as the LAST element of the
 * page's scrolling content on every surface that mounts the bar.
 *
 * ⚠️ GIVE IT THE SAME VISIBILITY CLASS THE BAR HAS. `className` is merged through cn() for
 * exactly that: a bar with `lg:hidden` needs a spacer with `lg:hidden`, the way <MobileNav> and
 * <BottomNavSpacer> each carry their own. Without it a desktop visitor reserves the static
 * fallback on first paint for a bar that is not there.
 *
 * It reserves the bar's measured PANEL height plus the bottom safe-area inset, and nothing
 * else — the tab-bar offset is deliberately absent, because on the surfaces that pass one the
 * app-wide <BottomNavSpacer /> has already reserved exactly that. When no offset is in play
 * the sum is exact; when one is, this over-reserves by the safe-area inset (~34px on a notched
 * iPhone, 0 elsewhere). Over is the harmless direction: the surplus sits BEHIND the bar where
 * nothing is drawn, whereas under-reserving is the bug this component exists to prevent.
 *
 * ⚠️ IT DOES NOT COLLAPSE WHEN THE KEYBOARD OPENS, AND THE FIRST VERSION DID. Copying
 * `html.kb-open .bottom-nav-spacer { display: none }` from globals.css looked like following
 * house style and was a straight bug — a reviewer caught it. That rule is right for the tab bar
 * because the tab bar HIDES while the keyboard is up (`html.kb-open .mobile-nav` translates it
 * off-screen), so its reservation is genuinely dead. This bar does the opposite: it stays on
 * screen and rides up onto the keyboard, still occupying its panel height. Collapsing the
 * spacer would have deleted that clearance from the flow at the exact moment a user is typing
 * into the field it covers. Nothing needs collapsing anyway — what is published is the PANEL
 * height, which excludes the keyboard padding, so this height never tracks the keyboard at all.
 * (That was true only after the measurement moved to the panel; the class outlived its reason.)
 *
 * The height is a plain static class — identical on the server and the client — so there is no
 * hydration mismatch to gate. The `4.5rem` fallback in it is the panel's natural height at the
 * default text size (12px padding + a 48px control + 12px padding = 72px), so the
 * pre-measurement paint already reserves the right amount and the measurement that follows
 * changes nothing visible.
 * ⚠️ That 4.5rem is coupled to the panel's `py-3` + the actions' `min-h-12` above. It is a
 * fallback, not the truth — the measurement is — so it degrades rather than breaking, but if
 * either of those changes, change it here too. It is also the ONLY number available with
 * JavaScript disabled, where an enlarged OS text size can grow the panel past it; that is the
 * one configuration in which this under-reserves, and no static value can fix it.
 */
export function StickyActionBarSpacer({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      data-slot="sticky-action-bar-spacer"
      className={cn(
        // max(env, var) rather than bare env(): on Android WebView < 140 Capacitor injects
        // --safe-area-inset-* instead of forwarding env(), and the two are equal wherever both
        // exist — see the Android safe-area note in globals.css.
        // ⚠️ A REVIEWER CALLED THIS INVALID CSS — "env() without a fallback invalidates the whole
        // declaration, so the spacer renders 0px on Android WebView < 140". REFUTED, twice over.
        // The rule applies to an UNRECOGNISED env variable; `safe-area-inset-*` has been
        // recognised by Chromium since 69 and, on Capacitor's padded path, simply evaluates to 0
        // — which is precisely why globals.css pairs it with the injected var and says so. And
        // the identical expression already ships in three places (both `html.native` rules and
        // back-to-top.tsx's lift); if it invalidated the declaration the floating chevron would
        // be sitting in the wrong place on every one of those devices today. Left matching the
        // house pattern deliberately: a lone `env(…, 0px)` here would imply the other three are
        // wrong without fixing them.
        //
        // ⚠️ A LATER REVIEWER CALLED IT FATAL FOR A SECOND REASON — "calc() requires whitespace
        // around `+`, this class has none, so every browser drops the height and the spacer is
        // 0px". REFUTED, and this one is worth knowing because it is the difference between
        // reading a class NAME and reading the CSS. Tailwind normalises arbitrary value maths;
        // fed through this repo's own compiler the declaration comes out as
        //   height: calc(var(--sticky-action-bar-h,4.5rem) + max(env(...), var(...,0px)));
        // — spaces present, measured on the emitted string, not inferred. Underscores are only
        // needed where a space must survive into a value the compiler does not parse as maths.
        'h-[calc(var(--sticky-action-bar-h,4.5rem)+max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px)))]',
        className,
      )}
    />
  )
}

/**
 * The two custom properties this pair speaks. Exported so a caller can set the offset from CSS
 * instead of the prop, or read the published height, without re-typing a string that only this
 * file defines.
 */
export const STICKY_ACTION_BAR_VARS = {
  /** Set by the caller (prop or ancestor): clearance above whatever owns the bottom edge. */
  offset: OFFSET_VAR,
  /** Written by the bar onto <html>: the measured panel height in px. Read-only. */
  height: HEIGHT_VAR,
} as const
