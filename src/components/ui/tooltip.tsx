"use client"

import * as React from "react"
import type { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

/** THE tooltip (Base UI's popup). Replaces the native `title=` on icon-only controls: `title=` has no keyboard-focus reveal, no touch reveal
 *  and inconsistent screen-reader exposure.
 *
 *  ## Usage: wrap the control, pass the hint:
 *      <Tooltip content={tr('Chat with seller', 'Nhắn người bán')}>
 *        <IconButton aria-label={tr('Chat with seller','Nhắn người bán')}>…</IconButton>
 *      </Tooltip>
 *
 *  ALWAYS keep the control's own `aria-label`: the tooltip is the VISIBLE hint, not the accessible name, and it never opens on touch. For
 *  touch-ESSENTIAL explanations use ui/popover (a real dismissible surface), not this.
 *
 *  ⛔ THE CONTROL IS NEVER WRAPPED AND NEVER REMOUNTED (speed audit, 2026-11-03). This used to swap the bare child for a Root + Trigger + Portal +
 *  Positioner tree the moment a `useSyncExternalStore` read of the pointer flipped after hydration: a synchronous pass that threw away and rebuilt
 *  every control on a desktop page (88 tooltips, 749 components, ~400 elements) inside the longest task of the load, replacing the photos' <a> and
 *  buttons under the reader's pointer. Now the control only gains listeners, and the popup is a sibling, loaded on first use and anchored to the
 *  control's element. Hovering opens one popup; nothing else on the page renders.
 *  The listeners are props on the child, the same requirement Base UI's `render` had: a custom child must spread what it is given. */

const OPEN_DELAY_MS = 600
/** Moving along a toolbar: a tooltip that closed this recently hands over with no wait, as Base UI's Provider group did. */
const HANDOVER_MS = 400
/** The gap between control and popup: long enough to cross it, so a hint can be hovered (WCAG 1.4.13), short enough not to linger. */
const LEAVE_GRACE_MS = 100

/** A focus counts only where a hint can be reached by hovering too. A tapped text field is :focus-visible, and on a phone nothing would ever close the hint. */
const canHover = () => typeof window.matchMedia !== 'function' || window.matchMedia('(any-hover: hover) and (any-pointer: fine)').matches

let lastClosedAt = 0
/** Hints showing now. Crossing to a neighbour reaches it before LEAVE_GRACE_MS has closed this one: that is a handover too. */
let openHints = 0
type Popup = typeof import("./tooltip-popup").TooltipPopup
let popup: Popup | null = null
let popupLoad: Promise<Popup | null> | null = null
/** A failed chunk means no hint, and another try on the next hover. Never an error: the control's accessible name is its own. */
function loadPopup(): Promise<Popup | null> {
  popupLoad ??= import("./tooltip-popup").then(
    (m) => (popup = m.TooltipPopup),
    () => { popupLoad = null; return null },
  )
  return popupLoad
}

type Hint = { anchor: Element; open: boolean; instant: boolean }
type ChildListeners = {
  onPointerEnter?: (e: React.PointerEvent<Element>) => void
  onPointerLeave?: (e: React.PointerEvent<Element>) => void
  onPointerDown?: (e: React.PointerEvent<Element>) => void
  onFocus?: (e: React.FocusEvent<Element>) => void
  onBlur?: (e: React.FocusEvent<Element>) => void
}

export function Tooltip({
  content,
  children,
  side = "top",
  sideOffset = 6,
  align = "center",
  className,
}: {
  /** The hint text (or node). If falsy, the child renders with no listeners. */
  content: React.ReactNode
  children: React.ReactElement
  side?: TooltipPrimitive.Positioner.Props["side"]
  sideOffset?: number
  align?: TooltipPrimitive.Positioner.Props["align"]
  className?: string
}) {
  // ⚠️ ABOVE THE `content` CHECK, AND THE RETURN KEEPS ONE SHAPE: account-panel-body.tsx toggles `content` on a MOUNTED component.
  const [hint, setHint] = React.useState<Hint | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const wanted = React.useRef(false)
  const counted = React.useRef(false)
  React.useEffect(() => () => {
    wanted.current = false
    clearTimeout(timer.current)
    if (counted.current) { counted.current = false; openHints-- }
  }, [])

  const show = (anchor: Element, instant: boolean) => {
    wanted.current = true
    void loadPopup().then((loaded) => {
      if (!loaded || !wanted.current) return
      setHint({ anchor, open: true, instant })
      if (!counted.current) { counted.current = true; openHints++ }
    })
  }
  const hide = React.useCallback(() => {
    wanted.current = false
    clearTimeout(timer.current)
    if (counted.current) { counted.current = false; openHints--; lastClosedAt = Date.now() }
    setHint((h) => (h?.open ? { ...h, open: false } : h))
  }, [])
  // A hint can go away on a mounted control: nothing may be left pending for a popup that no longer renders.
  React.useEffect(() => { if (!content) { hide(); setHint(null) } }, [content, hide])
  const keep = () => { wanted.current = true; clearTimeout(timer.current) }
  const hideSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(hide, LEAVE_GRACE_MS) }

  if (!content) return <>{children}</>

  const own = children.props as ChildListeners
  const control = React.cloneElement(children as React.ReactElement<ChildListeners>, {
    onPointerEnter: (e) => {
      own.onPointerEnter?.(e)
      if (e.pointerType === "touch") return
      clearTimeout(timer.current)
      const anchor = e.currentTarget
      const handover = openHints > 0 || Date.now() - lastClosedAt < HANDOVER_MS
      if (handover) { show(anchor, true); return }
      wanted.current = true
      void loadPopup()
      timer.current = setTimeout(() => show(anchor, false), OPEN_DELAY_MS)
    },
    onPointerLeave: (e) => { own.onPointerLeave?.(e); if (e.pointerType !== "touch") hideSoon() },
    onPointerDown: (e) => { own.onPointerDown?.(e); hide() },
    onFocus: (e) => { own.onFocus?.(e); if (e.currentTarget.matches(":focus-visible") && canHover()) { clearTimeout(timer.current); show(e.currentTarget, true) } },
    onBlur: (e) => { own.onBlur?.(e); hide() },
  })
  const Popup = popup
  return (
    <>
      {control}
      {hint && Popup && (
        <Popup
          anchor={hint.anchor}
          open={hint.open}
          instant={hint.instant}
          side={side}
          sideOffset={sideOffset}
          align={align}
          className={className}
          onDismiss={hide}
          onClosed={() => setHint(null)}
          onPointerEnter={keep}
          onPointerLeave={hideSoon}
        >
          {content}
        </Popup>
      )}
    </>
  )
}
