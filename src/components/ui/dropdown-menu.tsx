"use client"

import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"

import { cn } from "@/lib/utils"
import { ChevronRightIcon, CheckIcon } from "@/components/ui/icons"
import { useScrollDismissedRoot } from "@/components/ui/use-dismiss-on-user-scroll"

/**
 * `closeOnScroll` matters most on the one call site that opts out of modality: `more-overflow.tsx`
 * passes `modal={false}` for the "…" menu on the category and brand rails, and that menu DOES ride
 * the page as it scrolls. Wiring the primitive rather than that call site means the next
 * `modal={false}` menu is fixed before it is written.
 *
 * ⛔ IT APPLIES ONLY WHEN `modal` IS EXPLICITLY FALSE, AND THE ROUTE TO THAT RULE IS WORTH KEEPING.
 * The first version wired every menu, on the theory that a modal menu locks page scroll and so
 * would never see a gesture. A reviewer refuted the theory — scroll locking does not stop `wheel`
 * or `touchmove` from reaching the document — which meant every modal menu in the app (the account
 * menu, the dashboard row menus) had quietly changed behaviour, with no test touching any of them.
 * A second reviewer then named the consequence: a small wheel over a short modal menu would close
 * it, where it used to do nothing.
 *
 * Gating on `modal === false` collapses that blast radius to the one call site that actually has
 * the bug — `more-overflow.tsx`, whose "…" rail menu opts out of modality and does ride the page —
 * while leaving every other menu byte-identical to before. A locked page cannot scroll, so there is
 * nothing to dismiss for; that is now enforced rather than assumed.
 *
 * See use-dismiss-on-user-scroll.ts, and the `actionsRef` note in ui/popover.tsx — including why it
 * must be destructured at runtime and not merely omitted from the type. Both apply here identically.
 */
function DropdownMenu({
  closeOnScroll = true,
  open,
  defaultOpen,
  onOpenChange,
  modal,
  actionsRef: _ownedInternally,
  ...props
}: Omit<MenuPrimitive.Root.Props, "actionsRef"> & {
  closeOnScroll?: boolean
  /** Never passed — declared only so the runtime destructure above can strip it. @deprecated */
  actionsRef?: never
}) {
  const { actionsRef, handleOpenChange } = useScrollDismissedRoot<
    MenuPrimitive.Root.Actions,
    MenuPrimitive.Root.ChangeEventDetails
  >({ closeOnScroll: closeOnScroll && modal === false, open, defaultOpen, onOpenChange })

  return (
    <MenuPrimitive.Root
      data-slot="dropdown-menu"
      actionsRef={actionsRef}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={handleOpenChange}
      /* ⚠️ FORWARDED BACK DELIBERATELY. `modal` is destructured above so the gate can read it, which
         also removes it from `...props` — leaving this line out would drop `more-overflow`'s
         `modal={false}` on the floor and turn a deliberately non-modal rail menu into a
         scroll-locking one. Undefined here is not the same as absent: Base UI applies its own
         `modal = true` default for undefined, which is the pre-existing behaviour. */
      modal={modal}
      {...props}
    />
  )
}

function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  className,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <MenuPrimitive.Portal>
      {/* ⚠️ THE SCRIM IS PART OF THE FLOATING LAYER, NOT DECORATION ON THE MODAL ONES ONLY.
          Owner, 2026-08-13: dropdowns and popups must read the same as the dialogs. `.overlay-scrim`
          is the single definition all five overlay primitives share — see globals.css for why it is
          a class and not four copies, and why tooltips are excluded.
          ⚠️ pointer-events-none, AND THAT IS THE DIFFERENCE BETWEEN A SCRIM AND A MODAL. These
          three primitives had NO backdrop before, so adding a `fixed inset-0` element put a
          hit-testing surface over the whole page: measured with Playwright, clicking any other
          control while a menu was open TIMED OUT because the backdrop covered it — every dropdown
          would have started behaving like a modal, needing a dismiss tap before the page responded
          again. Base UI does outside-press dismissal with its own listeners rather than through
          this element, so making it pointer-transparent keeps the paint and drops the trap.
          (ui/popover is deliberately NOT given this: its backdrop pre-dates this change and its
          own comment records that absorbing the dismissing tap is its whole job.)
          z-40: under the Positioner's own z-50 popup, above the sticky facet bar (z-30). */}
      <MenuPrimitive.Backdrop className="overlay-scrim pointer-events-none fixed inset-0 z-40" />
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        {/* `shadow-pop` — the ELEVATION TOKEN, not one of Tailwind's stock t-shirt shadow
            utilities (what this carried until 2026-08-11). A menu is a floating layer, and this
            app's elevation is tokenised in globals.css (--shadow-pop / --shadow-card /
            --shadow-overlay / --shadow-onmedia / --shadow-thumb). A stock shadow is a fixed
            light-mode rgba: it neither deepens in dark (the token goes 0.08 → 0.45 alpha, because
            a soft shadow is invisible on the dark canvas) nor shares the one-light-source
            geometry every other floating surface agrees on.
            ⚠️ Do NOT name a stock shadow utility in this comment — Tailwind scans raw TEXT, so
            spelling one here re-emits it into the bundle (see the same warning in select.tsx). */}
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn("z-50 max-h-(--available-height) w-(--anchor-width) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-2xl bg-popover p-1 text-popover-foreground shadow-pop ring-1 ring-foreground/10 duration-100 ease-out outline-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[side=bottom]:data-closed:slide-out-to-top-2 data-[side=inline-end]:data-closed:slide-out-to-left-2 data-[side=inline-start]:data-closed:slide-out-to-right-2 data-[side=left]:data-closed:slide-out-to-right-2 data-[side=right]:data-closed:slide-out-to-left-2 data-[side=top]:data-closed:slide-out-to-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:ease-in data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95", className )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset ? "" : undefined}
      className={cn(
        "px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset ? "" : undefined}
      data-variant={variant}
      className={cn(
        "group/dropdown-menu-item relative flex cursor-default items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean
}) {
  return (
    // MenuSubmenuTrigger emits ONLY data-popup-open / data-highlighted / data-disabled
    // (see MenuSubmenuTriggerDataAttributes). data-open belongs to the Popup+Positioner,
    // never to the trigger — the `data-open:*` pair that used to sit here matched nothing.
    // data-popup-open is the live one that actually keeps the trigger highlighted.
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset ? "" : undefined}
      className={cn(
        "flex cursor-default items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-7 data-popup-open:bg-accent data-popup-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  align = "start",
  alignOffset = -3,
  side = "right",
  sideOffset = 0,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  // ⚠️ NO SHADOW CLASS HERE ON PURPOSE — it INHERITS the parent menu's `shadow-pop`.
  // This renders DropdownMenuContent and its className is twMerge'd on top, so until 2026-08-11
  // the list below named a stock Tailwind t-shirt shadow one step HEAVIER than the parent's, which
  // beat it in the merge: a submenu was more elevated than the menu that opened it, though it sits
  // at the same depth. Naming the token here again would fix the value and re-create the real
  // defect — two places to keep in sync, one of which nobody would think to look at. Deleting it
  // makes "same elevation as its parent" structural instead of duplicated.
  // ⚠️ Do NOT spell a stock shadow utility in this comment — Tailwind scans raw TEXT and would
  // re-emit it into the bundle (see the same warning in select.tsx).
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      className={cn("w-auto min-w-[96px] rounded-lg bg-popover p-1 text-popover-foreground ring-1 ring-foreground/10 duration-100 ease-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[side=bottom]:data-closed:slide-out-to-top-2 data-[side=left]:data-closed:slide-out-to-right-2 data-[side=right]:data-closed:slide-out-to-left-2 data-[side=top]:data-closed:slide-out-to-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:ease-in data-closed:fade-out-0 data-closed:zoom-out-95", className )}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: MenuPrimitive.CheckboxItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset ? "" : undefined}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-lg py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon
          />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return (
    <MenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: MenuPrimitive.RadioItem.Props & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset ? "" : undefined}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-lg py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <MenuPrimitive.RadioItemIndicator>
          <CheckIcon
          />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground group-focus/dropdown-menu-item:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
