'use client'

import * as React from 'react'
import { Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { CloseButton } from '@/components/ui/close-button'
import { cn } from '@/lib/utils'

type DrawerContentProps = React.ComponentProps<typeof DrawerContent>

export interface PickerSheetProps {
  open: boolean
  /** Called with `false` by the ✕, the scrim, a swipe down and Escape. The sheet never asks to open itself. */
  onOpenChange: (open: boolean) => void
  /** The visible header AND the dialog's accessible name (Base UI wires DrawerTitle → aria-labelledby). */
  title: React.ReactNode
  /** Header extras before the ✕ (the bell's "Mark all read") — muted, never a second title. */
  meta?: React.ReactNode
  /** A row pinned between the header and the scroller: the search field of a long list. The list scrolls under it. */
  search?: React.ReactNode
  /** The filter card's action row (Clear / Apply). Omitted for pick-and-close lists — a tap selects and closes. */
  footer?: React.ReactNode
  initialFocus?: DrawerContentProps['initialFocus']
  /** The trigger, so focus goes back where it came from. */
  finalFocus?: DrawerContentProps['finalFocus']
  /** A click inside landed on a link: the history owner releases its entry first (useSheetHistory `release`). */
  onNavigate?: () => void
  bodyClassName?: string
  /**
   * Wraps the sheet's whole inside (header, search, body, footer) INSIDE the drawer — for a provider both the search
   * field and the list must sit under, such as an inline Base UI Combobox root, whose hidden form input then lands in
   * the sheet instead of in the caller's layout.
   */
  contentWrapper?: (inner: React.ReactNode) => React.ReactNode
  children?: React.ReactNode
}

/**
 * ── THE FILTER CARD, AS A PRIMITIVE (owner, 2026-10-18: "also mobile all dropdowns should be bottom up card style like
 * the filter card") ─────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * The explorer's phone Filter / Price / Area sheets (facet-bar.tsx, price-range-filter.tsx, area-filter.tsx) were three
 * hand-made copies of one recipe; every phone picker and menu now opens in this one, so "like the filter card" is a
 * property of the code rather than a fourth copy that drifts. It is ui/drawer (Base UI Drawer) unchanged:
 *   · rounded-t-2xl, full width below `sm`, height to content capped at 100dvh − 6rem, swipe down to close, the shared
 *     `.overlay-scrim`, focus trap + return, Escape, a scrim tap — and the keyboard lift (`--kb-h`) when a field inside
 *     takes focus;
 *   · header row: the title (16px bold, truncating — a long Vietnamese title must not push the ✕ off) and CloseButton
 *     `2xs` (a 24px box with the 44px hit area);
 *   · a scrolling body (`min-h-0 flex-1 overflow-y-auto overscroll-contain`) that carries the safe-area bottom padding
 *     when there is no footer, and the footer's own padding when there is (ui/drawer DrawerFooter);
 *   · NO swipe handle — the filter card has none, and swipe-to-close works from anywhere while the list is at its top.
 *
 * ⛔ MODAL, ALWAYS. The scrim is also what stands the FAB and the cookie bar aside (back-to-top.tsx, cookie-consent.tsx
 * watch `.overlay-scrim`); a non-modal sheet would leave the cookie bar painted over its bottom rows.
 *
 * NESTING IS BASE UI'S: a sheet opened from inside another (a select inside the Filter, Area or guest Account sheet)
 * is a nested drawer — the parent steps back (scale 0.95, a 1rem peek, its content faded) and comes forward again when
 * the child closes; Escape and Back close only the top one; focus returns to the field inside the parent.
 *
 * Primitives load this through `LazyPickerSheet` (picker-sheet-kit.tsx) so it is not in every route's first load.
 */
export function PickerSheet({
  open, onOpenChange, title, meta, search, footer, initialFocus, finalFocus, onNavigate, bodyClassName, contentWrapper, children,
}: PickerSheetProps) {
  // ⚠️ A SHEET WHOSE FIRST RENDER IS ALREADY OPEN STILL ENTERS. Base UI starts a drawer mounted open at rest — no
  // `data-starting-style`, so no slide-up — and the lazy chunk (or the first phone open of a picker) mounts this with
  // `open` already true. One closed render first, then the real value.
  const [entered, setEntered] = React.useState(false)
  React.useEffect(() => { setEntered(true) }, [])

  const inner = (
    <>
      <DrawerHeader className="flex-row items-center justify-between gap-3 pb-1 text-left">
        <DrawerTitle className="min-w-0 truncate text-base font-bold">{title}</DrawerTitle>
        {meta ? <div className="ml-auto flex shrink-0 items-center gap-3">{meta}</div> : null}
        {/* The 24px box the header row was laid out for — CloseButton's `2xs` (D-CLOSE), as on the filter card. */}
        <CloseButton size="2xs" onClick={() => onOpenChange(false)} className="-mr-1 shrink-0 hover:bg-muted" />
      </DrawerHeader>
      {search ? <div className="shrink-0 px-4 pt-3">{search}</div> : null}
      <div
        data-slot="picker-sheet-body"
        className={cn(
          'min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 scroll-thin',
          // No footer: the body is the bottom edge, so it clears the home indicator — the Android WebView <140 var
          // fallback too, as the guest Account sheet does — and gives that inset back while the keyboard is up (the
          // sheet's bottom then sits ON the keyboard; ui/drawer DrawerFooter's own rule).
          footer ? 'pb-4' : 'pb-[max(1rem,env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px))] group-data-kb-open/drawer-popup:pb-4',
          bodyClassName,
        )}
      >
        {children}
      </div>
      {footer ? <DrawerFooter className="flex-row gap-3 border-t border-border pt-3">{footer}</DrawerFooter> : null}
    </>
  )

  return (
    <Drawer open={open && entered} onOpenChange={(next) => { if (!next) onOpenChange(false) }}>
      <DrawerContent
        initialFocus={initialFocus}
        finalFocus={finalFocus}
        onClickCapture={onNavigate ? (e) => { if ((e.target as Element | null)?.closest?.('a[href]')) onNavigate() } : undefined}
      >
        {contentWrapper ? contentWrapper(inner) : inner}
      </DrawerContent>
    </Drawer>
  )
}
