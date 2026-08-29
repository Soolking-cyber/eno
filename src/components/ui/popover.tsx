"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"
import { useScrollDismissedRoot } from "@/components/ui/use-dismiss-on-user-scroll"

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
  actionsRef: _ownedInternally,
  ...props
}: Omit<PopoverPrimitive.Root.Props, "actionsRef"> & {
  closeOnScroll?: boolean
  /** Never passed — declared only so the runtime destructure above can strip it. @deprecated */
  actionsRef?: never
}) {
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
    PopoverPrimitive.Root.ChangeEventDetails
  >({ closeOnScroll: closeOnScroll && modal !== true, open, defaultOpen, onOpenChange })

  return (
    <PopoverPrimitive.Root
      data-slot="popover"
      actionsRef={actionsRef}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={handleOpenChange}
      /* Forwarded back: destructuring `modal` for the gate above also removed it from `...props`,
         and dropping it would silently change modality for any call site that sets it. Same trap,
         and same fix, as ui/dropdown-menu. */
      modal={modal}
      {...props}
    />
  )
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
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
  }) {
  return (
    <PopoverPrimitive.Portal>
      {backdrop && (
        // z-40: above the sticky facet bar (z-30) and the grid, below the Positioner's popup (z-50).
        <PopoverPrimitive.Backdrop className={cn("overlay-scrim fixed inset-0 z-40", backdropClassName)} />
      )}
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        anchor={anchor}
        className={cn("isolate z-50", positionerClassName)}
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
            "z-50 flex w-72 origin-(--transform-origin) flex-col gap-2.5 rounded-2xl bg-popover p-2.5 text-sm text-popover-foreground shadow-pop ring-1 ring-foreground/10 outline-hidden duration-100 ease-[var(--ease-out-strong)] data-closed:duration-75 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[side=bottom]:data-closed:slide-out-to-top-2 data-[side=inline-end]:data-closed:slide-out-to-left-2 data-[side=inline-start]:data-closed:slide-out-to-right-2 data-[side=left]:data-closed:slide-out-to-right-2 data-[side=right]:data-closed:slide-out-to-left-2 data-[side=top]:data-closed:slide-out-to-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:ease-[var(--ease-out-strong)] data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="popover-header"
      className={cn("flex flex-col gap-0.5 text-sm", className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
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
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
