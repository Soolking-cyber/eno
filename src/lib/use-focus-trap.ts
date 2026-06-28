import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** ARIA Dialog focus management for our hand-rolled modals (Help sheet, Area filter):
 *  on open, move focus into the dialog; loop Tab / Shift+Tab so focus can't escape to
 *  the page behind; on close, return focus to whatever opened it. Attach the returned
 *  ref to the dialog's content element. */
export function useFocusTrap<T extends HTMLElement>(active = true) {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!active) return
    const node = ref.current
    if (!node) return
    const prevFocused = document.activeElement as HTMLElement | null

    const focusables = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )

    // Focus the first focusable child (or the container itself) on open — unless the
    // dialog already moved focus inside (e.g. an autoFocus'd field).
    if (!node.contains(document.activeElement)) {
      ;(focusables()[0] ?? node).focus?.()
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const els = focusables()
      if (els.length === 0) { e.preventDefault(); return }
      const first = els[0]
      const last = els[els.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    node.addEventListener('keydown', onKey)
    return () => {
      node.removeEventListener('keydown', onKey)
      // Restore focus to the trigger so keyboard/SR users aren't dropped at <body>.
      prevFocused?.focus?.()
    }
  }, [active])
  return ref
}
