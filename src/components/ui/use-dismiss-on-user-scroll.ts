"use client"

import * as React from "react"

/**
 * CLOSE AN OPEN FLOATING LAYER WHEN THE USER SCROLLS THE PAGE UNDER IT.
 *
 * Owner, 2026-08-16: "when i open dropdown and scroll up dropdown persists and not autocloses in
 * some dropdowns". Base UI's Positioner RE-POSITIONS a popup on scroll, it never dismisses it — so
 * a non-modal popup rides the page down and reads as stuck. Measured before writing this, on a
 * production build at /?category=vehicles: opening the facet bar's Price popover and wheeling 450px
 * left `[data-slot=popover-content]` mounted with `window.scrollY` at 450.
 *
 * ⚠️ "SOME dropdowns" IS EXACT, AND IT IS THE `modal` DEFAULT THAT DECIDES WHICH. Base UI 1.6 ships
 * Menu and Select with `modal = true` — those LOCK page scroll, so there is no scroll to react to
 * and they were never part of the complaint. Popover and Combobox default to `modal = false`, and
 * `more-overflow.tsx` opts its Menu out with `modal={false}`. Those three are the whole bug.
 *
 * ⛔ IT LISTENS FOR `wheel` AND `touchmove`, **NOT** FOR `scroll`, AND THAT CHOICE IS THE DESIGN.
 * The first cut of this used `scroll` and needed three guards to be safe; a reviewer took all three
 * apart, and switching the event deleted the need for every one of them:
 *
 *   · `scroll` DOES NOT BUBBLE, so it can only be caught in the capture phase, and the only way to
 *     tell a page scroll from a popup's own list scroll is then to compare `event.target` against
 *     the document. That test assumes the document is the page's scroller — true here today
 *     (measured: `document.scrollingElement` is HTML and a sweep for overflow-y auto/scroll
 *     elements taller than their box found ZERO inner scrollers) but it is one `overflow-y-auto`
 *     wrapper away from silently never firing again. `wheel` and `touchmove` BUBBLE, so the target
 *     is the element under the gesture and the scroller's identity never enters into it.
 *
 *   · `scroll` fires for PROGRAMMATIC scrolling too, so opening a popup near the fold — where the
 *     browser scrolls the trigger into view — would have closed it in the same tick. That is what
 *     the 150ms arming delay in the first draft was for, and a timing heuristic is exactly the kind
 *     of thing that holds on a fast laptop and fails on a cold phone. `wheel`/`touchmove` are
 *     user-initiated only, so there is nothing to arm against.
 *
 *   · On iOS the software keyboard scrolls the document when a field takes focus. Under `scroll`
 *     that shut the price popover the instant you tapped its min-price input, so the draft carried
 *     an "ignore while an editable element has focus" guard — which the reviewer showed would
 *     ALSO have disabled the fix across the facet panels, because their checkboxes and radios are
 *     `<input>` elements too. The keyboard fires neither wheel nor touchmove, so the guard goes.
 *
 * ⚠️ THE GESTURES THIS DELIBERATELY DOES NOT CATCH, named by a reviewer and accepted rather than
 * fixed: dragging the scrollbar thumb, keyboard scrolling (Space / PageUp / PageDown), and
 * middle-click autoscroll. All three produce `scroll` and none produces `wheel` or `touchmove`.
 * None is reachable on the phone this was reported from; a keydown listener was considered and
 * dropped because the keys that scroll a page are the same keys that navigate an open menu, so it
 * would have traded a rare missed dismissal for a common wrong one. If a scrollbar drag ever needs
 * covering, add a SECOND `scroll` listener carrying the document-target test — do not swap this one
 * back, or all three guards above come back with it.
 *
 * ⚠️ AND THE CONVERSE, ALSO REVIEWER-NAMED: a wheel or touchmove is an INTENT to scroll, not proof
 * that the page moved. Wheeling against the top of an already-scrolled-to-top page dismisses even
 * though nothing shifted, and so does a horizontal swipe over a card rail. Both are the user
 * gesturing at the page behind the popup, which is the same thing an outside press means, so they
 * are left as dismissals on purpose. `Ctrl`+wheel is the one that is NOT a scroll — it is
 * pinch-zoom, including trackpad pinch, which browsers report as a wheel with `ctrlKey` — and it is
 * filtered out below.
 *
 * ⚠️ A MOMENTUM TAIL CAN STILL DISMISS. If a trackpad fling is still coasting when you click a
 * trigger, those wheel events belong to a gesture that started before the popup existed, and this
 * cannot tell them from a fresh scroll. WHEEL_SLOP removes the resting-drift half of the problem;
 * the coasting half would need an arm delay, which was tried and removed for good reasons recorded
 * above. Accepted as the rarer failure: a menu that closes when you open it mid-fling is annoying,
 * a menu that ignores your first real scroll is the bug being fixed.
 *
 * ⚠️ ONE KNOWN GAP LEFT ON THE TABLE, reviewer-named and accepted: a popup whose list IS scrollable
 * but is already at its top or bottom edge chains the remaining scroll to the page, so the page
 * moves while the popup stays open. Closing it would mean comparing `scrollTop` against the gesture
 * direction on every event, and getting that wrong dismisses a menu mid-scroll — a far more
 * annoying failure than the one it fixes. Revisit only if it is actually reported.
 */

/**
 * Anything portalled into the floating layer — where a gesture must START before it can even be
 * considered the user working the popup rather than scrolling the page. Containment is necessary
 * but NOT sufficient; canConsumeScroll below is the half that decides.
 *
 * ⚠️ Matched with `closest()`, so it catches a gesture on any DESCENDANT too, which is the point:
 * the wheel lands on a menu item or a text node's parent, never on the popup root. Portals put
 * these under <body>, outside the trigger's DOM subtree, so a containment test against the trigger
 * would miss every one of them.
 *
 * ⛔ ENUMERATED, NEVER `[data-slot$="-content"]`. That wildcard is what this held first, and all
 * three reviewers refuted it independently. Measured: the suffix also matches `card-content`,
 * `carousel-content` and `tabs-content` — ordinary page containers, and the carousel is a scroller.
 * So wheeling over any rail on the home page found a "floating layer" that could consume the
 * gesture, and the open dropdown did not dismiss: the reported bug, reinstated by the fix for it, on
 * the busiest page in the app. A closed list of the roots we actually govern cannot drift that way.
 *
 * ⚠️ THE BACKDROP IS NOT IN THIS LIST, AND MUST NOT BE ADDED. `ui/popover`'s opt-in backdrop is a
 * `fixed inset-0` scrim that covers the whole viewport, so treating it as part of the popup would
 * make EVERY gesture anywhere on the page count as "inside", and the dismissal would never fire.
 * Measured: a touch drag on the page at (20,250) reports the scrim as its target and correctly
 * dismisses.
 *
 * ⛔ DIALOG, SHEET AND DRAWER CONTENT ARE NOT HERE, AND REMOVING THEM WAS A FIX. They were listed
 * for one round; a reviewer showed the consequence: a Popover opened INSIDE a scrollable sheet — a
 * tall mobile filter panel, any modal form — would find the sheet as its enclosing layer, the sheet
 * overflows and therefore "consumes", and the popup rides it exactly as reported. Dragging a
 * sheet's body while something floats above it IS a page scroll from that popup's point of view.
 * `[role="dialog"]` is absent for a related reason: Base UI puts that role on the Popover popup
 * itself, so it added nothing the slot list does not cover while widening the net.
 */
const FLOATING_LAYER = [
  '[data-slot="popover-content"]',
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="dropdown-menu-sub-content"]',
  '[data-slot="select-content"]',
  '[data-slot="combobox-content"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="tooltip"]',
].join(",")

/**
 * Does the gesture have somewhere to go INSIDE the popup — i.e. is anything between `target` and
 * the popup root actually scrollable right now?
 *
 * ⛔ "IS THE GESTURE INSIDE A POPUP" WAS NOT ENOUGH, AND THE DIFFERENCE IS THE WHOLE BUG. Measured
 * on a phone viewport with a real CDP touch drag: dragging INSIDE the facet bar's price popover —
 * which is 136px tall and holds nothing scrollable — scrolled the PAGE 227px through normal scroll
 * chaining while the popover sat there open. That is precisely the report ("scroll up dropdown
 * persists"), reached from inside the popup instead of beside it, and a containment test alone
 * cannot see it. A reviewer predicted this case from the code before it was measured.
 *
 * So the question is not "where did the gesture start" but "can the popup consume it". A long menu
 * whose list scrolls keeps its gesture and stays open; a short popup that cannot scroll lets the
 * page move underneath, which means the user is scrolling the page and the popup should go.
 *
 * ⚠️ `scrollHeight > clientHeight` IS CHECKED TOGETHER WITH `overflow-y`, NOT INSTEAD OF IT. Our
 * popup roots carry `overflow-y-auto` unconditionally (see ui/dropdown-menu and ui/select), so
 * overflow alone says "scrollable" for a two-item menu that plainly is not. Only the pair is true.
 *
 * ⚠️ VERTICAL ONLY, AND THAT IS NOT AN OVERSIGHT — a reviewer read it as one. Nothing horizontal
 * reaches here: `isVerticalScrollGesture` has already dropped sideways wheels and sideways drags, so
 * a horizontal chip rail inside a panel keeps its gesture without this function being consulted.
 * Adding an `overflow-x` branch here would only let a horizontally-scrollable element suppress a
 * VERTICAL dismissal, which is the opposite of what was asked for.
 */
export function canConsumeScroll(target: Element, layer: Element): boolean {
  let el: Element | null = target
  while (el) {
    // ⚠️ `> 1`, NOT `> 0` — reviewer-caught. Chrome rounds scrollHeight and clientHeight
    // independently, so an element with a fractional height reports a phantom 1px of overflow and
    // would be judged scrollable. That is not academic: it would have silently re-broken the very
    // inside-the-popup case this function was added for, on whichever viewport rounds badly.
    if (el.scrollHeight - el.clientHeight > 1) {
      const overflowY = getComputedStyle(el).overflowY
      if (overflowY === "auto" || overflowY === "scroll") return true
    }
    if (el === layer) return false
    el = el.parentElement
  }
  return false
}

/**
 * @param active Attach only while the popup is open. Passing `false` removes the listeners.
 * @param close  Invoked once per dismissing gesture. Need NOT be stable — it is read through a ref
 *               so that a caller re-rendering does not tear the listener down and build it again.
 */
/**
 * When the last wheel event anywhere on the page arrived. Module scope, because it must be known
 * BEFORE any popup opens — that is the whole point.
 *
 * ⛔ THIS EXISTS BECAUSE OF THE MACOS FLING, which a reviewer argued is the common path rather than
 * an edge case, and the argument is good: scrolling down to the facet bar and clicking a filter is
 * exactly how these popovers get opened, and a trackpad keeps emitting wheel events for roughly half
 * a second after the fingers lift. Those events belong to a gesture that finished before the popup
 * existed, so treating them as "the user scrolled" makes the panel close the instant it opens.
 * ⚠️ Registered ONCE at module load, not per popup: it has to be recording while nothing is open.
 */
let lastWheelAt = 0
if (typeof document !== "undefined") {
  document.addEventListener("wheel", () => { lastWheelAt = Date.now() }, { passive: true, capture: true })
}
/** A wheel stream with no gap longer than this is one continuous gesture, tail included. */
const FLING_GAP_MS = 200

export function useDismissOnUserScroll(active: boolean, close: () => void) {
  // The effect must not re-subscribe every time a parent re-renders and hands us a new closure,
  // so the callback is read through a ref and only `active` drives the subscription.
  const closeRef = React.useRef(close)
  React.useEffect(() => {
    closeRef.current = close
  }, [close])

  React.useEffect(() => {
    if (!active) return

    /**
     * Was a wheel gesture already in flight when this popup opened? If so, every wheel event that
     * follows without a FLING_GAP_MS pause is the tail of that same gesture, and must not dismiss.
     * Cleared the moment a real gap appears, so the user's NEXT scroll works normally.
     */
    let ridingFling = Date.now() - lastWheelAt < FLING_GAP_MS
    let previousWheelAt = lastWheelAt

    /**
     * ⛔ A `touchmove` IS NOT YET A SCROLL, AND ASSUMING IT WAS BROKE THE PRICE FILTER. Reviewers
     * caught it and the call site confirms it: price-range-filter.tsx puts a dual-thumb
     * `RangeSlider` INSIDE the popover. Dragging a thumb on a phone fires touchmove over an element
     * with nothing to scroll, so the popover closed on the first pixel of the drag — a worse defect
     * than the one being fixed, and invisible to a spec that clicks rather than drags.
     *
     * So a touch gesture must LOOK like a page scroll before it dismisses: it must have travelled
     * far enough to beat the slop of an ordinary tap, and it must be predominantly VERTICAL. That
     * one test covers the slider drag, a horizontal chip rail inside a panel, and iOS WebKit's
     * habit of emitting sub-slop moves for a slightly wobbly tap.
     */
    const TOUCH_SLOP = 10
    /** Below this a wheel is trackpad drift or a stray tick, not an attempt to scroll. */
    const WHEEL_SLOP = 4
    let touchOrigin: { x: number; y: number } | null = null

    /**
     * ⚠️ EVERY PATH THAT ENDS A GESTURE MUST CLEAR THIS, and two reviewer-named bugs come from
     * forgetting one. A stale origin left over from an earlier tap makes the NEXT touchmove measure
     * its delta against wherever the last finger happened to be, which clears TOUCH_SLOP instantly
     * and dismisses for no reason. The pinch case is the sharp one: lifting one finger at the end of
     * a two-finger zoom drops `touches.length` back to 1, and the survivor is nowhere near the
     * original origin — so a zoom would end by closing whatever was open.
     */
    function forgetTouch() {
      touchOrigin = null
    }

    function onTouchStart(event: TouchEvent) {
      // A gesture that begins with more than one finger is a pinch, never a scroll.
      const touch = event.touches.length === 1 ? event.touches[0] : null
      touchOrigin = touch ? { x: touch.clientX, y: touch.clientY } : null
    }

    /** True only for a gesture that is genuinely a vertical drag of the page. */
    function isVerticalScrollGesture(event: Event): boolean {
      if ("deltaY" in event) {
        const wheel = event as WheelEvent
        /**
         * ⛔ `deltaMode` MUST BE NORMALISED OR THIS NEVER FIRES IN FIREFOX. Reviewer-caught, and it
         * is the sharpest bug in the round: Firefox reports a wheel notch in LINES (deltaMode 1,
         * deltaY ≈ 3), not pixels, so a raw `>= 4` comparison is false for every ordinary scroll and
         * the whole feature would have been silently dead in that browser. Pages (deltaMode 2) are
         * rarer but fail the same way.
         */
        // ⚠️ BOTH AXES GET THE SAME FACTOR. Normalising deltaY alone — which this did for one round,
        // reviewer-caught — compares 16x-scaled pixels against a raw line count, so a Firefox
        // horizontal gesture (deltaX 3 lines, deltaY 1 line) reads as 16 >= 3 and dismisses as if it
        // were a vertical scroll. Scaling one side of a comparison is worse than scaling neither.
        const scale = wheel.deltaMode === 1 ? 16 : wheel.deltaMode === 2 ? 800 : 1
        const pixels = wheel.deltaY * scale
        const sideways = Math.abs(wheel.deltaX * scale)
        // ⚠️ `shiftKey` IS CHECKED EXPLICITLY, not inferred from deltaX. macOS converts Shift+wheel
        // into a deltaX at the OS level, so the axis comparison below happens to catch it there —
        // but Windows and Linux report it as deltaY with the modifier set, and the comparison then
        // reads a deliberate HORIZONTAL scroll as a vertical one. A reviewer noticed the comment
        // claimed this was handled when only the macOS half was.
        if (wheel.shiftKey) return false
        // Trackpad sideways scrolling is not a page scroll in the sense meant here. WHEEL_SLOP
        // additionally drops the sub-pixel drift a resting trackpad emits, which a reviewer flagged
        // as enough to dismiss a menu the instant it opened.
        return Math.abs(pixels) >= WHEEL_SLOP && Math.abs(pixels) >= sideways
      }
      const touch = (event as TouchEvent).touches[0]
      if (!touch || !touchOrigin) return false
      const dx = touch.clientX - touchOrigin.x
      const dy = touch.clientY - touchOrigin.y
      return Math.abs(dy) >= TOUCH_SLOP && Math.abs(dy) > Math.abs(dx)
    }

    function onUserScroll(event: Event) {
      // ⚠️ ZOOM IS NOT SCROLL, AND IT ARRIVES TWO DIFFERENT WAYS. A trackpad pinch is delivered as
      // a wheel with `ctrlKey` set; a phone pinch is a touchmove with TWO touches. Both were
      // reviewer-caught — the first draft filtered only the wheel, which left pinch-to-zoom on a
      // product photo closing whatever was open behind it.
      if (event instanceof WheelEvent && event.ctrlKey) return
      if ("deltaY" in event) {
        const now = Date.now()
        // A gap in the wheel stream ends the previous gesture — including a fling this popup opened
        // in the middle of. Anything after the gap is a fresh, deliberate scroll.
        if (now - previousWheelAt >= FLING_GAP_MS) ridingFling = false
        previousWheelAt = now
        if (ridingFling) return
      }
      // ⛔ FEATURE-TESTED WITH `in`, NEVER `instanceof TouchEvent`. Safari on macOS does not
      // implement touch events at all, so the global `TouchEvent` is undefined there and an
      // `instanceof` against it throws a ReferenceError — inside a document-level wheel listener,
      // i.e. on every scroll of every page, for every desktop Safari visitor. `WheelEvent` above is
      // safe because it is universal; this one is not.
      if ("touches" in event && (event as TouchEvent).touches.length > 1) {
        forgetTouch()
        return
      }
      if (!isVerticalScrollGesture(event)) return
      // ⚠️ A NON-ELEMENT TARGET RESOLVES UPWARD, IT DOES NOT FALL THROUGH TO close(). The previous
      // shape treated "not an Element" as "not inside a popup" and dismissed — so any target this
      // code did not anticipate would close the popup rather than leave it alone. Failing safe here
      // costs nothing: the worst case is a dismissal that does not happen.
      const node = event.target
      const target =
        node instanceof Element ? node : node instanceof Node ? node.parentElement : null
      if (!target) return
      /**
       * ⛔ A DRAG ON A SLIDER IS NEVER A SCROLL, WHATEVER ITS ANGLE. The direction test alone is a
       * heuristic, and a reviewer showed where it breaks: grabbing a thumb with a fat or angled
       * finger can travel 10px more vertically than horizontally before the drag settles, which
       * passes the test and closes the panel mid-adjustment. price-range-filter.tsx puts a
       * dual-thumb RangeSlider inside the price popover, so this is the live surface, not a
       * hypothetical. The control claims the gesture the moment the finger lands on it.
       */
      if (target.closest('[role="slider"]')) return
      const layer = target.closest(FLOATING_LAYER)
      // The gesture belongs to the popup only if the popup can actually absorb it. See
      // canConsumeScroll — a popup with nothing to scroll lets the page move instead, and then
      // this IS a page scroll no matter where the finger landed.
      if (layer && canConsumeScroll(target, layer)) return
      closeRef.current()
    }

    // passive: these only ever read the event, and a non-passive wheel listener on the document
    // forces the browser to wait for JS before it may scroll — the one thing that would make
    // scrolling this marketplace feel worse than leaving the popup open.
    const options: AddEventListenerOptions = { passive: true }
    // ⚠️ `touchstart` LISTENS IN THE CAPTURE PHASE while the rest bubble. A widget that calls
    // stopPropagation on touchstart — sliders and carousels do — would otherwise hide the gesture's
    // ORIGIN from us while its touchmoves still arrived, and every delta would then be measured
    // from a stale point. Capture runs before anything can stop it.
    const capture: AddEventListenerOptions = { passive: true, capture: true }
    document.addEventListener("wheel", onUserScroll, options)
    document.addEventListener("touchstart", onTouchStart, capture)
    document.addEventListener("touchmove", onUserScroll, options)
    document.addEventListener("touchend", forgetTouch, capture)
    document.addEventListener("touchcancel", forgetTouch, capture)
    return () => {
      document.removeEventListener("wheel", onUserScroll, options)
      document.removeEventListener("touchstart", onTouchStart, capture)
      document.removeEventListener("touchmove", onUserScroll, options)
      document.removeEventListener("touchend", forgetTouch, capture)
      document.removeEventListener("touchcancel", forgetTouch, capture)
    }
  }, [active])
}

/**
 * The wiring every scroll-dismissed Root wrapper repeats: own an `actionsRef`, know whether the
 * popup is open, and close it imperatively.
 *
 * ⚠️ IT CLOSES THROUGH `actionsRef.close()` RATHER THAN BY FORCING `open={false}`, and that is what
 * keeps a controlled call site correct. Read in Base UI 1.6 (PopoverRoot.js:68, MenuRoot.js:259),
 * `close()` is `store.setOpen(false, createChangeEventDetails(REASONS.imperativeAction))` — the
 * same pipeline every other close goes through — so `onOpenChange` fires and `facet-bar`'s
 * `setAdvOpen(false)` runs exactly as if the user had pressed Escape. Taking over the `open` prop
 * instead would have left those call sites believing their panel was still open.
 *
 * ⚠️ ONLY Menu AND Popover CAN USE THIS. Base UI 1.6 gives Select and Combobox an `actionsRef` with
 * `unmount()` and NO `close()` — verified in SelectRoot.d.ts:144 and AriaCombobox.d.ts:252 — so
 * there is no imperative close to call. Neither needs one: Select is `modal = true` and locks page
 * scroll, and Combobox's only call site is a text field being typed into.
 *
 * ⚠️ `localOpen` is a MIRROR, never the source of truth — `open ?? localOpen` means a controlled
 * caller is always believed. If it ever did go stale at `true`, the worst outcome is a `close()` on
 * an already-closed popup, which is a `setOpen(false)` no-op; it cannot force a popup open.
 *
 * ⚠️ THE ONE WAY IT CAN GO STALE THE OTHER WAY, reviewer-named: Base UI hands `onOpenChange` an
 * `eventDetails` carrying `cancel()`, and an uncontrolled caller that cancels a close leaves this
 * mirror at `false` while the popup is still open — so the listener detaches and THAT popup stops
 * dismissing on scroll until it is reopened. Degraded, not broken, and no call site cancels an
 * open-change today (swept 2026-08-16). Anyone adding one should control `open` as well.
 */
export function useScrollDismissedRoot<A extends { close: () => void }, D>(params: {
  closeOnScroll: boolean
  open: boolean | undefined
  defaultOpen: boolean | undefined
  onOpenChange: ((open: boolean, eventDetails: D) => void) | undefined
}) {
  const { closeOnScroll, open, defaultOpen, onOpenChange } = params
  const actionsRef = React.useRef<A | null>(null)
  const [localOpen, setLocalOpen] = React.useState(defaultOpen ?? false)

  const handleOpenChange = React.useCallback(
    (next: boolean, eventDetails: D) => {
      setLocalOpen(next)
      onOpenChange?.(next, eventDetails)
    },
    [onOpenChange],
  )

  useDismissOnUserScroll(
    closeOnScroll && (open ?? localOpen),
    React.useCallback(() => {
      actionsRef.current?.close()
    }, []),
  )

  return { actionsRef, handleOpenChange }
}
