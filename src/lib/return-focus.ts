import type { RefObject } from 'react'

/**
 * A TRIGGERLESS dialog's `finalFocus` — a dialog, alert dialog or drawer the caller opens through `open` / `onOpenChange`,
 * most often from a menu row marked `opensLayer` (ui/dropdown-menu): focus goes back to the caller's control (the menu's
 * trigger) while it is on the page, to Base UI's own choice when it is gone, and NOWHERE for a close that hands over to
 * another layer that returns focus itself (`handingOff` — the sign-in card, report-button.tsx).
 * ⚠️ WHY: a controlled dialog has no trigger of its own. Base UI then returns focus to whatever held it when the dialog
 * opened — a menu row that has since unmounted — and where a press never focused anything (iPhone Safari taps, Safari
 * mouse clicks) the close dropped focus on <body> (measured 2026-11-17, the storefront ⋯; WCAG 2.4.3).
 * A function, so it is read when the close completes: a control that left the page meanwhile is not focused.
 */
export function returnFocusTo(control: RefObject<HTMLElement | null> | undefined, handingOff?: RefObject<boolean>) {
  if (!control) return undefined
  return () => (handingOff?.current ? false : control.current?.isConnected ? control.current : true)
}
