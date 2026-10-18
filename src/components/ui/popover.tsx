"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"
import { useScrollDismissedRoot } from "@/components/ui/use-dismiss-on-user-scroll"
import {
  LazyPickerSheet,
  accessibleNameOf,
  chainHandlers,
  firstFocusable,
  sheetChangeDetails,
  sheetTriggerHandlers,
  useSheetHistory,
  useSheetSurface,
  type PickerSurface,
} from "@/components/ui/picker-sheet-kit"

type PopoverChangeDetails = PopoverPrimitive.Root.ChangeEventDetails

/**
 * ── `mobileSheet`: A PANEL A PHONE GETS AS THE FILTER CARD (owner, 2026-10-18: "also mobile all dropdowns should be
 * bottom up card style like the filter card") ───────────────────────────────────────────────────────────────────────
 *
 * Opt-in, unlike ui/dropdown-menu, because popovers vary too much to switch all of them: the chat reaction bar is a
 * toolbar pinned to a message, and the explorer's Filter / Price panels already branch to their own sheets. A panel
 * that IS a dropdown (the bell, Share, Get the app) passes `mobileSheet` + a `sheetTitle` on its content, and below
 * `sm` the same trigger opens its content inside ui/picker-sheet instead of the anchored card:
 *   · the sheet draws its own header (title + ✕), so a `PopoverHeader` / `PopoverTitle` inside the content is dropped
 *     there — wrap the popover's own heading in them and it is never shown twice; `sheetMeta` puts header actions
 *     (the bell's "Mark all read") beside the title;
 *   · ⛔ Back closes it (useSheetHistory), and a link inside releases that entry first so the sheet's own
 *     `history.back()` never races the navigation (PickerSheet `onNavigate`).
 */
type PopoverSheet = {
  isPhone: boolean
  surface: PickerSurface
  sheetOpen: boolean
  keyboard: boolean
  title: string
  triggerRef: React.RefObject<HTMLElement | null>
  openFrom: (e: React.SyntheticEvent<HTMLElement>, keyboard: boolean) => void
  close: (event?: Event) => void
  release: () => void
}
const PopoverSheetContext = React.createContext<PopoverSheet | null>(null)
/** True for content drawn INSIDE a popover's phone sheet. */
const InPopoverSheetContext = React.createContext(false)

/** Is this content being drawn inside its popover's phone sheet (`mobileSheet`)? — to drop a scroller the sheet
 *  replaces, or a heading the sheet already shows. */
function useInPopoverSheet(): boolean {
  return React.useContext(InPopoverSheetContext)
}

/**
 * ⚠️ THIS IS THE PRIMITIVE THE "STUCK DROPDOWN" REPORT WAS ABOUT. Popover is the one floating layer
 * we use that defaults to `modal = false`, so the page scrolls freely underneath it while Base UI's
 * Positioner merely re-anchors the popup — measured at /?category=vehicles, the Price panel stayed
 * mounted through a 450px scroll. `closeOnScroll` (default ON) dismisses it on a user scroll
 * gesture; see use-dismiss-on-user-scroll.ts for why the trigger is `wheel`/`touchmove` and not
 * `scroll`, and why Select and Combobox are deliberately not given the same treatment.
 *
 * ⚠️ `actionsRef` IS OWNED BY THIS WRAPPER and omitted from the public props on purpose — closing
 * imperatively is how the dismissal keeps controlled call sites in sync, and a caller-supplied ref
 * would silently replace it. No call site passes one (swept 2026-08-16); a future one that needs
 * `unmount()` should extend this wrapper rather than route around it, and will get a tsc error
 * here rather than a dropdown that stopped closing.
 *
 * ⛔ AND IT IS DESTRUCTURED AWAY AT RUNTIME, NOT JUST OMITTED FROM THE TYPE. Both reviewers landed
 * on this independently: `Omit<…, "actionsRef">` is erased at compile time, so a caller reaching
 * through `any`, plain JS, or a spread of a wider object would still put `actionsRef` into
 * `...props` — and because the spread trails the explicit prop, it would win and silently detach
 * the close mechanism. Pulling it out of the object is the only thing that actually stops that.
 */
function Popover({
  closeOnScroll = true,
  open,
  defaultOpen,
  onOpenChange,
  modal,
  mobileSheet = false,
  actionsRef: _ownedInternally,
  ...props
}: Omit<PopoverPrimitive.Root.Props, "actionsRef"> & {
  closeOnScroll?: boolean
  /** Below `sm`, open the content as a bottom sheet (ui/picker-sheet) — see the note on `PopoverSheet`. */
  mobileSheet?: boolean
  /** Never passed — declared only so the runtime destructure above can strip it. @deprecated */
  actionsRef?: never
}) {
  // ONE open state for both surfaces (controlled or not), so the sheet can be closed from inside; Base UI's root only
  // sees the popover half. Without `mobileSheet` the surface is always the popover and nothing else changes.
  const [localOpen, setLocalOpen] = React.useState(defaultOpen ?? false)
  const isOpen = open ?? localOpen
  const { isPhone, surface } = useSheetSurface(isOpen, mobileSheet)
  const setOpen = React.useCallback((next: boolean, details: PopoverChangeDetails) => {
    onOpenChange?.(next, details)
    if (details.isCanceled) return
    setLocalOpen(next)
  }, [onOpenChange])
  const sheetOpen = isOpen && surface === "sheet"
  const close = React.useCallback((event?: Event) => setOpen(false, sheetChangeDetails<PopoverChangeDetails>("close-press", event)), [setOpen])
  const { release } = useSheetHistory(sheetOpen, close, "panel")
  const triggerRef = React.useRef<HTMLElement | null>(null)
  const [opened, setOpened] = React.useState({ keyboard: false, title: "" })
  const sheet = React.useMemo<PopoverSheet>(() => ({
    isPhone,
    surface,
    sheetOpen,
    keyboard: opened.keyboard,
    title: opened.title,
    triggerRef,
    close,
    release,
    openFrom: (e, keyboard) => {
      triggerRef.current = e.currentTarget
      setOpened({ keyboard, title: accessibleNameOf(e.currentTarget) })
      setOpen(true, sheetChangeDetails<PopoverChangeDetails>("trigger-press", e.nativeEvent, e.currentTarget))
    },
  }), [isPhone, surface, sheetOpen, opened, close, release, setOpen])

  /**
   * ⚠️ `modal !== true`, THE MIRROR OF ui/dropdown-menu's `modal === false` — and the asymmetry is
   * the defaults, not an inconsistency. Popover's `modal` defaults to FALSE, which is precisely the
   * scrollable case this exists for, so the gate must let `undefined` through; Menu's defaults to
   * TRUE, so its gate must not. Both express one rule: dismiss only when the page can actually
   * scroll. No call site passes `modal` to a Popover today (swept 2026-08-16), so this changes
   * nothing now and stops a future `<Popover modal>` inheriting a behaviour that makes no sense
   * behind a locked page.
   */
  const { actionsRef, handleOpenChange } = useScrollDismissedRoot<
    PopoverPrimitive.Root.Actions,
    PopoverChangeDetails
  >({ closeOnScroll: closeOnScroll && modal !== true, open: isOpen && surface === "popover", defaultOpen: undefined, onOpenChange: setOpen })

  return (
    <PopoverSheetContext.Provider value={sheet}>
      <PopoverPrimitive.Root
        data-slot="popover"
        actionsRef={actionsRef}
        open={isOpen && surface === "popover"}
        onOpenChange={(next, details) => {
          // Phone (mobileSheet): the trigger's click opens the sheet; a close the closed root reports while the sheet
          // is up is not the sheet's to obey.
          if (next ? isPhone : surface === "sheet") return
          handleOpenChange(next, details)
        }}
        /* Forwarded back: destructuring `modal` for the gate above also removed it from `...props`,
           and dropping it would silently change modality for any call site that sets it. Same trap,
           and same fix, as ui/dropdown-menu. */
        modal={modal}
        {...props}
      />
    </PopoverSheetContext.Provider>
  )
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  const sheet = React.useContext(PopoverSheetContext)
  return (
    <PopoverPrimitive.Trigger
      data-slot="popover-trigger"
      {...chainHandlers(props, sheet?.isPhone ? sheetTriggerHandlers(sheet.openFrom) : null)}
      // Base UI's own popup is closed behind a phone sheet, so it would report `false` here.
      {...(sheet?.sheetOpen ? { "aria-expanded": true } : {})}
    />
  )
}

/** The phone sheet holding a `mobileSheet` popover's content. */
function PopoverSheetBody({ sheet, title, meta, bodyClassName, children }: {
  sheet: PopoverSheet; title?: React.ReactNode; meta?: React.ReactNode; bodyClassName?: string; children?: React.ReactNode
}) {
  const contentRef = React.useRef<HTMLDivElement>(null)
  return (
    <InPopoverSheetContext.Provider value>
      <LazyPickerSheet
        open={sheet.sheetOpen}
        onOpenChange={(next) => { if (!next) sheet.close() }}
        title={title ?? sheet.title}
        meta={meta}
        bodyClassName={bodyClassName}
        finalFocus={sheet.triggerRef}
        initialFocus={sheet.keyboard ? () => firstFocusable(contentRef.current) ?? true : undefined}
        onNavigate={sheet.release}
      >
        {/* `contents`: a handle for the keyboard's first stop that adds no box of its own. */}
        <div ref={contentRef} className="contents">{children}</div>
      </LazyPickerSheet>
    </InPopoverSheetContext.Provider>
  )
}

function PopoverContent({
  className,
  align = "center",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  /**
   * ⚠️ POSITIONER PROPS, AND THEY HAVE TO BE NAMED HERE TO REACH IT. Everything not destructured
   * falls into `...props` and lands on the POPUP, which silently ignores it — so a call site that
   * passed `collisionPadding` got no error, no warning, and no collision handling. Two more from
   * the same family, added 2026-08-17 for the chat reaction bar:
   *
   * · `collisionPadding` — keep the popup inside the viewport by this many px. This is the reason
   *   the primitive is being used at all there: a floating bar anchored to a mark near the screen
   *   edge cannot be kept on screen by any CSS anchor, because a mid-width bubble has neither the
   *   bar's width to its left nor to its right. Measured three times before reaching for this.
   * · `anchor` — position against an element that is NOT the trigger. The reaction bar's trigger is
   *   a long press on the message; what it must hang off is the small react mark at the bubble's
   *   corner. Without this the two would have to be the same element, and making the mark the
   *   trigger swallows its own one-tap action.
   */
  collisionPadding,
  anchor,
  backdrop = false,
  backdropClassName,
  positionerClassName,
  sheetTitle,
  sheetMeta,
  sheetBodyClassName,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "collisionPadding" | "anchor"
  > & {
    /**
     * Render a transparent full-screen Backdrop that ABSORBS the outside tap which dismisses the
     * popover, so that tap does NOT fall through and activate whatever sits beneath it. Base UI's
     * Popover is non-modal by default — an outside press both closes the popover AND clicks the
     * element under the pointer. In the facet bar that means dismissing the price panel by tapping a
     * listing card ALSO navigates to that card's PDP. Opt-in, because a menu opened off a toolbar
     * usually WANTS the click-through; a filter dropdown floating over a grid does not. (The sibling
     * area-filter and every ui/select keep exactly such a backdrop for the same reason.)
     */
    backdrop?: boolean
    backdropClassName?: string
    /**
     * ⚠️ FOR THE LAYER, NOT THE LOOK — the Positioner is where `z-index` lives, and the popup's own
     * `className` cannot reach it. Added for the first-run tour, which paints a blurred mask over
     * the page to block clicks everywhere except the control it is pointing at: that mask has to
     * sit ABOVE app chrome (the header and its neighbours run z-[60] to z-[130]) and the tour's own
     * popover has to sit above the mask, which the hard-coded `z-50` made impossible.
     * ⛔ Reach for this only to restack a whole popover. Anything about the CARD — padding, width,
     * colour — belongs on `className`, which lands on the popup where tailwind-merge can resolve it.
     */
    positionerClassName?: string
    /** `mobileSheet` only: the phone sheet's title (its dialog name). Omitted: the trigger's own name. */
    sheetTitle?: React.ReactNode
    /** `mobileSheet` only: header actions beside the sheet's title. */
    sheetMeta?: React.ReactNode
    /** `mobileSheet` only: the sheet body's box (`px-0` for a panel whose rows carry their own gutter). */
    sheetBodyClassName?: string
  }) {
  const sheet = React.useContext(PopoverSheetContext)
  if (sheet && sheet.surface === "sheet") {
    return (
      <PopoverSheetBody sheet={sheet} title={sheetTitle} meta={sheetMeta} bodyClassName={sheetBodyClassName}>
        {props.children as React.ReactNode}
      </PopoverSheetBody>
    )
  }
  return (
    <PopoverPrimitive.Portal>
      {backdrop && (
        // z-40: above the sticky facet bar (z-30) and the grid, below the Positioner's popup (z-50).
        // `--scrim-exit` = the popup's 75ms exit: Base UI unmounts the backdrop when the POPUP finishes,
        // so the default 150ms scrim was cut mid-fade (0.38 opacity, measured) on every close.
        <PopoverPrimitive.Backdrop className={cn("overlay-scrim fixed inset-0 z-40 [--scrim-exit:75ms_var(--ease-out-strong)]", backdropClassName)} />
      )}
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        anchor={anchor}
        className={cn("isolate z-overlay", positionerClassName)}
      >
        {/* `shadow-pop` — the ELEVATION TOKEN, not one of Tailwind's stock t-shirt shadow
            utilities, which is what this was until 2026-08-11. The scale is tokenised in
            globals.css (--shadow-pop / --shadow-card / --shadow-overlay) precisely so every
            floating layer shares one light source AND deepens in dark mode (0.08 → 0.45 alpha).
            A stock shadow does neither: it is a fixed light-mode rgba, so this popover rendered
            flatter than the menu beside it on the dark canvas.

            ⚠️ THE OVERRIDE CONTRACT CHANGED WITH IT, AND IT COST SOMETHING. `cn()` is a bare
            twMerge (src/lib/utils.ts), and the elevation tokens are hand-written classes in
            globals.css, NOT theme keys — so twMerge does not file them in its `shadow` group and
            cannot dedupe one against a stock utility. Measured: token + stock both survive the
            merge, and the token then WINS anyway because globals.css emits it unlayered while
            Tailwind's utilities sit in `@layer utilities`. Practical consequence: a call site can
            no longer switch this shadow off by passing the stock "no shadow" utility — it merges
            to nothing. Token-vs-token DOES still dedupe (measured: the two land in the same
            twMerge group and the last one wins), so overriding this with `shadow-overlay` works.
            Swept before shipping: across the whole app, ZERO call sites of PopoverContent,
            SheetContent, SelectContent, ComboboxContent or DropdownMenuContent pass any shadow
            class at all, and no `shadow-<color>` class exists anywhere — so nothing regressed
            today. The real fix is an `extendTailwindMerge` classGroup in src/lib/utils.ts, which
            would also cover sheet, select, combobox and dropdown-menu in one place.

            ⚠️ Do NOT name a stock shadow utility in this comment — Tailwind scans raw TEXT, so
            spelling one here re-emits it into the bundle (see the same warning in select.tsx). */}
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "z-overlay flex w-72 origin-(--transform-origin) flex-col gap-2.5 rounded-2xl bg-popover p-2.5 text-sm text-popover-foreground shadow-pop ring-1 ring-foreground/10 outline-hidden duration-100 ease-out-strong data-closed:duration-75 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[side=bottom]:data-closed:slide-out-to-top-2 data-[side=inline-end]:data-closed:slide-out-to-left-2 data-[side=inline-start]:data-closed:slide-out-to-right-2 data-[side=left]:data-closed:slide-out-to-right-2 data-[side=right]:data-closed:slide-out-to-left-2 data-[side=top]:data-closed:slide-out-to-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:ease-out-strong data-closed:fade-out-0 data-closed:zoom-out-95",
            // Keyboard-opened / Escape-closed (Base UI's data-instant): no motion — see ui/tooltip.tsx.
            "data-instant:duration-0!",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

// The sheet draws its own header row (title + ✕): a popover's own heading is dropped there, never shown twice.
function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  if (React.useContext(InPopoverSheetContext)) return null
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  if (React.useContext(InPopoverSheetContext)) return null
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function PopoverDescription({
  className,
  ...props
}: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  useInPopoverSheet,
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
