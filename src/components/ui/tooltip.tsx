"use client"

import * as React from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"

/** THE tooltip primitive (Base UI Tooltip). Reintroduced 2026-07-15 to replace the native
 *  `title=` attribute on icon-only controls — `title=` has no keyboard-focus reveal, no touch
 *  reveal, and inconsistent screen-reader exposure.
 *
 *  ## Usage — wrap the control, pass the hint:
 *      <Tooltip content={tr('Chat with seller', 'Nhắn người bán')}>
 *        <IconButton aria-label={tr('Chat with seller','Nhắn người bán')}>…</IconButton>
 *      </Tooltip>
 *
 *  The child is the trigger (composed via Base UI's `render`, not asChild). ALWAYS keep the
 *  control's own `aria-label` — the tooltip is the VISIBLE hint, not the accessible name, and Base
 *  UI Tooltip deliberately does not open on touch, so a touch user must still get the name from
 *  aria-label. For touch-ESSENTIAL explanations use ui/popover (a real dismissible surface), not this.
 *
 *  Mount <TooltipProvider> once high in the tree so hovers share one open-delay group (moving
 *  between adjacent tooltips then feels instant); it is optional — a bare <Tooltip> still works.
 */
export function TooltipProvider({
  delay = 600,
  closeDelay = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delay={delay} closeDelay={closeDelay} {...props} />
}

/**
 * ⚠️ ONE SHARED MediaQueryList FOR THE WHOLE APP, RESOLVED AT MODULE SCOPE.
 * The mobile homepage renders 73 tooltips (3 per listing card + the trust badge). Giving each one
 * its own `matchMedia` call and its own `useEffect` would trade a hydration cost for 73 extra
 * post-hydration commits on desktop — paying twice to fix paying once. One MQL, one snapshot
 * function, and `useSyncExternalStore` so React handles the SSR/hydration handshake instead of us.
 */
let hoverMql: MediaQueryList | null | undefined
function hoverQuery(): MediaQueryList | null {
  if (hoverMql === undefined) {
    hoverMql = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      // ⚠️ `any-hover`/`any-pointer`, NOT `hover`/`pointer`. The unprefixed queries describe only
      // the PRIMARY pointer, so a touch-primary hybrid — an iPad with a trackpad, an Android
      // tablet with a mouse, a phone docked to a keyboard — reports `hover: none` while having an
      // input that can hover and focus perfectly well. Gating on the primary pointer would have
      // denied those users every tooltip. `any-*` asks the question we actually mean: can ANY
      // attached input hover with a fine pointer? Phones answer no, hybrids answer yes.
      ? window.matchMedia('(any-hover: hover) and (any-pointer: fine)')
      : null
  }
  return hoverMql
}
// Stable identities — a new function per render would resubscribe on every commit.
const subscribeHover = (onChange: () => void) => {
  const mql = hoverQuery()
  if (!mql) return () => {}
  // ⚠️ Safari 13 and earlier expose MediaQueryList WITHOUT addEventListener — only the legacy
  // addListener. Calling the modern API there throws inside React's subscription and takes the
  // whole tree down. The fallback is two lines; the alternative is a white screen on an old
  // iPhone, which is exactly the device least able to tell us about it.
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }
  mql.addListener(onChange)
  return () => mql.removeListener(onChange)
}
const getHoverSnapshot = () => hoverQuery()?.matches ?? false
// ⚠️ FALSE ON THE SERVER, ALWAYS. The server cannot know the pointer, and guessing `true` would
// server-render 73 Base UI trees and then throw them away — the exact cost this removes. Guessing
// false renders the bare child on both server and first client render, so hydration matches.
const getHoverServerSnapshot = () => false

export function Tooltip({
  content,
  children,
  side = "top",
  sideOffset = 6,
  align = "center",
  className,
}: {
  /** The hint text (or node). If falsy, the child renders WITHOUT a tooltip wrapper. */
  content: React.ReactNode
  children: React.ReactElement
  side?: TooltipPrimitive.Positioner.Props["side"]
  sideOffset?: number
  align?: TooltipPrimitive.Positioner.Props["align"]
  className?: string
}) {
  // ⚠️ THIS HOOK MUST STAY ABOVE EVERY EARLY RETURN. `content` is not static at all call sites —
  // account-panel-body.tsx toggles it between undefined and a string on a MOUNTED component, so a
  // hook placed after the `!content` return would change the hook order between renders and crash.
  const hoverable = React.useSyncExternalStore(subscribeHover, getHoverSnapshot, getHoverServerSnapshot)

  // No content → don't pay for a tooltip; render the control as-is.
  if (!content) return children

  // ⚠️ NO TOOLTIP TREE ON A TOUCH DEVICE, AND THAT REMOVES NOTHING A TOUCH USER HAD.
  // Base UI's Tooltip deliberately never opens on touch (see the note above), so on a phone all
  // 73 of these were pure cost: a Root + Trigger + Portal + Positioner per control, hydrated,
  // with a mouseenter listener each, for a popup that can never appear. Measured on the mobile
  // homepage against a real production build with a 4x CPU throttle: script evaluation fell from
  // a 2624 ms median to 2059 ms across 11 interleaved A/B runs (permutation p = 0.0067).
  // The accessible name is unaffected — every call site carries its own aria-label, which the
  // doc comment above already requires precisely because the tooltip is not the name.
  if (!hoverable) return children

  // Open/close delay is grouped by <TooltipProvider> (delay=600ms). Base UI's Tooltip.Root
  // takes no per-instance delay in this version — the Provider owns it.
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} className="z-[70]">
          <TooltipPrimitive.Popup
            className={cn(
              "origin-(--transform-origin) rounded-lg bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md select-none",
              // Anchored motion mirroring ui/popover, at tooltip scale: a quick fade + subtle zoom
              // and a 1px slide FROM the anchor on open, reversed TO the anchor on close.
              "duration-100 ease-[var(--ease-out-strong)] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
              "data-closed:duration-75 data-closed:ease-[var(--ease-out-strong)] data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
              "data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1",
              "data-[side=bottom]:data-closed:slide-out-to-top-1 data-[side=top]:data-closed:slide-out-to-bottom-1 data-[side=left]:data-closed:slide-out-to-right-1 data-[side=right]:data-closed:slide-out-to-left-1",
              /**
               * ⛔ `data-instant` KILLS THE ANIMATION WHEN THE TOOLTIP WAS ALREADY GOING TO BE
               * INSTANT, and Base UI has been emitting it unread. It is set in three cases and all
               * three want no motion:
               *   · `delay` — the <TooltipProvider> above groups the 600ms open delay, so moving
               *     along a toolbar opens each neighbour with no wait. Playing a 100ms zoom on
               *     something that appeared instantly is the mismatch: the delay is skipped and
               *     the animation is not, so the row still feels like it lags.
               *   · `focus` — a tooltip opened by TABBING. Keyboard actions are repeated all day
               *     and animating them makes the interface feel disconnected from the key press.
               *   · `dismiss` — reopening straight after an Escape.
               * ⛔ `!` BECAUSE CLASS ORDER DOES NOT DECIDE THIS, AND THE FIRST VERSION SAID IT DID.
               * Two reviewers refuted the stated mechanism: tailwind-merge only drops conflicts
               * within the SAME variant set, so `data-instant:` and `data-closed:` both survive
               * `cn()` — and they have identical specificity, which leaves STYLESHEET order to
               * decide. It happened to fall the right way in the built chunk (instant emitted
               * after closed), but that is an accident of Tailwind's variant sort, not a contract,
               * and Base UI sets `data-closed` and `data-instant` together on an Escape dismissal.
               * `!important` makes it true by construction instead of by luck.
               * ⚠️ IT ZEROES THE DURATION RATHER THAN CHANGING THE EASING because `animate-in`
               * reads `var(--tw-animation-duration, var(--tw-duration, .15s))` — verified in the
               * built CSS — so a duration utility does reach a keyframe animation here.
               */
              "data-instant:duration-0!",
              className,
            )}
          >
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
