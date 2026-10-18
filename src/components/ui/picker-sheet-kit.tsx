'use client'

import * as React from 'react'
import type { BaseUIEvent } from '@base-ui/react/types'
import { useIsPhone } from '@/hooks/use-is-phone'
import { useBackToClose, whenLayerPopSettles } from '@/lib/back-to-close'
import type { PickerSheetProps } from './picker-sheet'

/**
 * ── ON A PHONE EVERY PICKER AND MENU OPENS AS A BOTTOM SHEET (owner, 2026-10-18: "also mobile all dropdowns should be
 * bottom up card style like the filter card") ────────────────────────────────────────────────────────────────────────
 *
 * The LIGHT half of the phone sheet: what CustomSelect, ui/dropdown-menu, ui/popover (`mobileSheet`) and ui/combobox
 * import eagerly. The sheet itself (ui/picker-sheet — the filter card's shell on ui/drawer) is loaded only when a
 * phone first opens one: these primitives are on every page (the footer's language picker, the header's bell), and a
 * static Drawer import would put Base UI Drawer in every route's first load.
 *
 * ⛔ THE TRIGGER IS NEVER CHOSEN BY VIEWPORT. A primitive renders the same trigger on the server, on the hydrating
 * render and on a phone; only what OPENS differs. `useIsPhone` is false on the server snapshot, so swapping the
 * trigger on it would replace the button's DOM node after hydration — under a finger already on its way down.
 */

export type PickerSurface = 'popover' | 'sheet'

/**
 * WHERE A PICKER OPENS, decided on the render where it opens — whoever opened it (a tap, a key, a caller's own state) —
 * and kept until the next open: rotating a phone mid-open never swaps the tree, and the sheet keeps its exit animation.
 * The gate is `useIsPhone` (below `sm`, 640px), the same one the explorer's filter card has used since 2026-09-29.
 * `enabled = false` keeps a primitive's popover at every width (admin menus, a popover without `mobileSheet`).
 */
export function useSheetSurface(open: boolean, enabled = true): { isPhone: boolean; surface: PickerSurface } {
  const isPhone = useIsPhone() && enabled
  const [latch, setLatch] = React.useState<{ open: boolean; surface: PickerSurface }>({ open: false, surface: 'popover' })
  let surface = latch.surface
  if (open !== latch.open) {
    // Derived state (React's "storing information from previous renders"): the value is used in THIS render, so the
    // popover never paints for a frame on a phone before the latch catches up.
    surface = open ? (isPhone ? 'sheet' : 'popover') : latch.surface
    setLatch({ open, surface })
  }
  return { isPhone, surface }
}

/**
 * ⛔ BACK CLOSES THE SHEET (UX3 NAV-1, src/lib/back-to-close.ts — widened to picker sheets by the owner's 2026-10-18
 * request, "like the filter card"). `useBackToClose` plus one ordering rule for a pick:
 *
 * `afterClose(fn)` runs `fn` once the closing sheet's own history entry is gone. A pick COMMITS AFTER THE POP, never
 * before it: a commit that navigates (a language change reloads the page, language-context.tsx `setLang`) would
 * otherwise race the sheet's `history.back()`, and a commit that writes the URL (an explorer facet) lands as a fresh
 * step Back can undo, exactly as a filter-card tap does. The effect is declared AFTER `useBackToClose`'s, so the pop is
 * already on its way when the microtask asks `whenLayerPopSettles`; with no entry (no user activation) it runs at once.
 *
 * `release()` is the module's contract for a close that may navigate (a menu row that routes, a link in a panel): the
 * entry is left for the navigation to replace, never popped under it.
 */
export function useSheetHistory(open: boolean, close: () => void, id: string): { release: () => void; afterClose: (fn: () => void) => void } {
  const { release } = useBackToClose(open, close, id)
  const after = React.useRef<(() => void) | null>(null)
  React.useEffect(() => {
    if (open) return
    const fn = after.current
    after.current = null
    if (fn) queueMicrotask(() => whenLayerPopSettles(fn))
  }, [open])
  const afterClose = React.useCallback((fn: () => void) => { after.current = fn }, [])
  return { release, afterClose }
}

type TriggerHandlers = {
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void
  onMouseDown?: (e: BaseUIEvent<React.MouseEvent<HTMLElement>>) => void
  onClick?: (e: BaseUIEvent<React.MouseEvent<HTMLElement>>) => void
  onKeyDown?: (e: BaseUIEvent<React.KeyboardEvent<HTMLElement>>) => void
}

/**
 * THE PHONE TRIGGER: the sheet opens on the CLICK that ends a tap — never on the press.
 *
 * Base UI opens Select, Combobox and Menu on `mousedown`. A modal sheet opened there would be on screen before the
 * press ends, and the click that follows (dispatched to the common ancestor of press and release once the sheet's scrim
 * is under the finger) is an outside press: the sheet would dismiss itself. So on a phone the primitive's own press and
 * key handlers are skipped (`preventBaseUIHandler` — they would also open the popover we are replacing) and the click
 * opens the sheet. Enter / Space reach it through the button's native click; the arrow keys open it directly, as they
 * open a select. `keyboard` tells the sheet where to put focus (see PickerSheet `initialFocus`).
 *
 * Handlers go on the Base UI trigger part, which merges them to the RIGHT of its own — so they run first, and a
 * caller's own handler on the same part still runs (`chainHandlers`).
 */
export function sheetTriggerHandlers(
  open: (e: React.SyntheticEvent<HTMLElement>, keyboard: boolean) => void,
  preload: () => void = preloadPickerSheet,
): TriggerHandlers {
  return {
    onPointerDown: () => preload(),
    onMouseDown: (e) => { e.preventBaseUIHandler?.() },
    onClick: (e) => {
      e.preventBaseUIHandler?.()
      preload() // a keyboard or screen-reader open has no press before it; idempotent after one
      // `detail === 0`: a click no pointer made — Enter, Space, or a screen reader's activate.
      open(e, e.detail === 0)
    },
    onKeyDown: (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventBaseUIHandler?.()
        e.preventDefault()
        preload()
        open(e, true)
      } else if (e.key === 'Enter' || e.key === ' ') {
        // The native button turns these into the click above; Base UI's own key handler would open its popup.
        e.preventBaseUIHandler?.()
      }
    },
  }
}

/** A caller's handler and ours on one prop — the caller's first, so it still runs when ours skips Base UI's. */
export function chainHandlers<T extends Record<string, unknown>>(theirs: T, ours: TriggerHandlers | null): T {
  if (!ours) return theirs
  const out: Record<string, unknown> = { ...theirs }
  for (const [name, mine] of Object.entries(ours)) {
    const their = theirs[name] as ((e: unknown) => void) | undefined
    out[name] = their ? (e: unknown) => { their(e); (mine as (e: unknown) => void)(e) } : mine
  }
  return out as T
}

/**
 * The `eventDetails` a Base UI `onOpenChange` callback expects, for an open or close the sheet makes itself (Base UI
 * never saw it). Same shape as Base UI's own: a caller may `cancel()` it, as the bell does for a signed-out tap.
 */
export function sheetChangeDetails<D>(reason: string, event?: Event, trigger?: HTMLElement): D {
  let canceled = false
  let propagate = false
  return {
    reason,
    event: event ?? new Event('base-ui'),
    trigger,
    cancel() { canceled = true },
    allowPropagation() { propagate = true },
    get isCanceled() { return canceled },
    get isPropagationAllowed() { return propagate },
  } as unknown as D
}

/**
 * The words a trigger is known by — its aria-label, the text its aria-labelledby points at, its <label>s, then its own
 * text — collapsed to one line. The fallback title of a sheet whose caller named none (an icon-only "…" button says
 * "More actions"), so the dialog is never nameless.
 */
export function accessibleNameOf(el: Element | null | undefined): string {
  if (!el) return ''
  const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
  const aria = squash(el.getAttribute('aria-label'))
  if (aria) return aria
  const ids = el.getAttribute('aria-labelledby')
  if (ids) {
    const text = squash(ids.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '').join(' '))
    if (text) return text
  }
  const labels = (el as HTMLInputElement).labels
  if (labels && labels.length) {
    const text = squash(Array.from(labels).map((l) => l.textContent ?? '').join(' '))
    if (text) return text
  }
  return squash(el.textContent) || squash((el as HTMLInputElement).placeholder)
}

/** The first thing a keyboard user lands on when a sheet opens from a key: a search field, a listbox, a row. */
export function firstFocusable(root: HTMLElement | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>('input:not([disabled]), [role="listbox"][tabindex="0"], button:not([disabled]), a[href], [tabindex="0"]') ?? null
}

/* ── the shared look: the filter card's recipe, plus the rows it never needed ─────────────────────────────────────── */

/**
 * The option list inside a sheet. `-mx-3` lets a row's press highlight bleed 12px into the 16px gutter while its text
 * stays on the title's 16px line (rows are px-3). No dividers between options: the filter card has none, and the
 * canon keeps hairline rows for in-flow content (ui/rows) — a floating list uses a highlight row.
 * A listbox that takes focus itself (a short list opened from a key) shows a ring until the first arrow key puts the
 * highlight on a row — Base UI starts with no active option, and focus must never be invisible (WCAG 2.4.7).
 */
export const SHEET_LIST =
  '-mx-3 flex flex-col rounded-xl outline-none [&:focus-visible:not([aria-activedescendant])]:ring-2 [&:focus-visible:not([aria-activedescendant])]:ring-ring/40'
/**
 * A 48px full-width row (the guest Account sheet's height; ≥ the house 44px floor). `data-highlighted` is the keyboard
 * cursor of a Base UI listbox and must paint like the press, or arrow keys move an invisible cursor. No press-scale:
 * the row sits inside a scroller.
 */
export const SHEET_ROW =
  'flex min-h-12 w-full cursor-pointer select-none items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm outline-none active:bg-muted data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-50'
export const SHEET_ROW_ON = 'font-semibold text-accent-foreground'
export const SHEET_ROW_OFF = 'font-medium text-body'
/**
 * An action row (a menu item in an action sheet): the same box, a 20px icon, a real button. `focus-visible:bg-muted`
 * is the keyboard cursor here — these rows take real focus.
 */
export const SHEET_ACTION_ROW =
  'flex min-h-12 w-full cursor-pointer select-none items-center justify-start gap-3 whitespace-normal rounded-xl px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted active:scale-100 active:bg-muted focus-visible:bg-muted disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-5'
/**
 * The leading icon of an ordinary action row in the list-lead ink (the guest Account sheet's rows). Only the FIRST
 * child, and only an icon that names no colour of its own — a trailing ✓ keeps the row's ink. Not on a destructive
 * row, whose icon is red with its words.
 */
export const SHEET_LEAD_ICON = '[&>svg:first-child:not([class*=\'text-\'])]:text-ink-4'
/** A group heading — the same quiet uppercase label CustomSelect and the Filter panel put over their groups. */
export const SHEET_GROUP_LABEL = 'px-3 pb-1 pt-2.5 text-2xs font-bold uppercase tracking-wider text-muted-foreground'
export const SHEET_SEPARATOR = 'mx-3 my-1 h-px shrink-0 bg-border'
/** The search field pinned at the top of a long list — the house filled-input idiom (tint, soft ring). */
export const SHEET_SEARCH =
  'flex min-h-11 items-center gap-2 rounded-xl bg-tint px-3 focus-within:ring-2 focus-within:ring-ring/30'
/** 14px like every field; globals.css lifts it to 16px on a coarse pointer, so iOS never zooms on focus. */
export const SHEET_SEARCH_INPUT = 'min-w-0 flex-1 bg-transparent py-2.5 text-sm text-foreground outline-none placeholder:text-ink-4'
/** ⚠️ `empty:hidden`: Base UI keeps the Empty region mounted (it is the role="status" live region) and only fills it. */
export const SHEET_EMPTY = 'px-3 py-8 text-center text-sm text-body empty:hidden'

/* ── the lazy shell ───────────────────────────────────────────────────────────────────────────────────────────────── */

const loadSheet = () => import('./picker-sheet')
let sheetLoading: Promise<unknown> | null = null
/** Warm the sheet's chunk — on the trigger's press, so the first phone tap does not wait on the network. */
export function preloadPickerSheet(): void {
  PickerSheetLazy.retry()
  sheetLoading ??= loadSheet().catch(() => { sheetLoading = null })
}

/**
 * React.lazy, except that a failed load is not for ever.
 * ⚠️ A FAILED LOAD CLOSES THE PICKER RATHER THAN THROWING: React.lazy rethrows a rejected import into the nearest error
 * boundary — offline, that would take the page down to open a dropdown — so a failure resolves to `Unavailable`, which
 * closes it. ⛔ BUT React.lazy SETTLES ONCE (opus, gate 2026-10-18): resolved to the fallback, the fallback WAS the
 * component for the rest of the page life — one offline first tap and every picker on the page stayed dead until a
 * reload, with no message. So a failure is remembered, and the visitor's NEXT TAP builds a fresh lazy (`retry`, from
 * the trigger's preload): this open closes, the next one asks the network again (the bundler forgets a chunk that
 * failed to load, so the retry is real).
 */
export type RetryingLazy<P> = React.ComponentType<P> & {
  /** A new tap: if the last load failed, the next render asks the network again. Called by the trigger's preload. */
  retry: () => void
}
export function retryingLazy<P extends object>(load: () => Promise<React.ComponentType<P>>, Unavailable: React.ComponentType<P>): RetryingLazy<P> {
  let failed = false
  const make = () =>
    React.lazy<React.ComponentType<P>>(() =>
      load().then(
        (C) => ({ default: C }),
        () => {
          failed = true
          return { default: Unavailable }
        },
      ),
    )
  let current = make()
  const Component = (props: P) => {
    const C = current
    return <C {...props} />
  }
  // ⛔ THE RETRY RIDES THE VISITOR'S TAP, NEVER A RENDER (codex + opus, gate round 2): a render-driven retry either
  // looped while offline (a sheet that suspends on mount keeps no ref to tell a re-render from a new open) or missed a
  // DIFFERENT picker's first tap (it mounts already open). Every trigger warms its sheet on the press — that is when
  // a failed load gets its fresh lazy, for every picker of the kind at once.
  return Object.assign(Component, {
    retry: () => {
      if (!failed) return
      failed = false
      current = make()
    },
  })
}

function SheetUnavailable({ open, onOpenChange }: PickerSheetProps) {
  React.useEffect(() => { if (open) onOpenChange(false) }, [open, onOpenChange])
  return null
}
const PickerSheetLazy = retryingLazy<PickerSheetProps>(() => loadSheet().then((m) => m.PickerSheet), SheetUnavailable)

/** ui/picker-sheet, loaded on first use. Same props; renders nothing until its chunk has arrived. */
export function LazyPickerSheet(props: PickerSheetProps) {
  return (
    <React.Suspense fallback={null}>
      <PickerSheetLazy {...props} />
    </React.Suspense>
  )
}
