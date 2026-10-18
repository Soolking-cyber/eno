"use client"

import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"

import { cn } from "@/lib/utils"
import { ChevronRightIcon, CheckIcon } from "@/components/ui/icons"
import { Button } from "@/components/ui/button"
import { useScrollDismissedRoot } from "@/components/ui/use-dismiss-on-user-scroll"
import {
  LazyPickerSheet,
  SHEET_ACTION_ROW,
  SHEET_GROUP_LABEL,
  SHEET_LEAD_ICON,
  SHEET_LIST,
  SHEET_SEPARATOR,
  accessibleNameOf,
  chainHandlers,
  firstFocusable,
  sheetChangeDetails,
  sheetTriggerHandlers,
  useSheetHistory,
  useSheetSurface,
  type PickerSurface,
} from "@/components/ui/picker-sheet-kit"
import { useLanguage } from "@/context/language-context"

type MenuChangeDetails = MenuPrimitive.Root.ChangeEventDetails

/**
 * ── ON A PHONE A MENU IS AN ACTION SHEET (owner, 2026-10-18: "also mobile all dropdowns should be bottom up card
 * style like the filter card") ───────────────────────────────────────────────────────────────────────────────────────
 *
 * Below `sm` every consumer menu opens as the filter card (ui/picker-sheet) holding a column of 48px action rows —
 * Base UI's own Drawer action-sheet demo, and iOS: a dialog with a list of buttons, never role="menu" inside it.
 * Items are JSX children, not data, and a Base UI Menu.Item cannot render outside a Menu popup, so each part reads
 * whether it is drawn inside this menu's sheet (`InMenuSheetContext`) and renders its sheet form there. Call sites do
 * not change; the trigger is the same element at every width (see picker-sheet-kit.tsx).
 *
 *   · A row runs its `onClick` and closes the sheet (`closeOnClick={false}` keeps it open), destructive rows stay red,
 *     a separator is a hairline, a label is the quiet group heading — and it never throws outside a Group the way
 *     Base UI's GroupLabel does (trip-cards.tsx records that throw).
 *   · ⛔ BACK CLOSES IT (useSheetHistory). A row that LEAVES the page must release the sheet's history entry first or
 *     the sheet's own `history.back()` would race the navigation: links do it automatically, an `onClick` that
 *     routes says so with `navigates`.
 *   · `sheet={false}` keeps the anchored popover at every width — admin (EN-only, desktop-first, and the moderation
 *     queue uses a submenu, which a sheet does not do).
 */
type MenuSheet = {
  isPhone: boolean
  surface: PickerSurface
  sheetOpen: boolean
  /** Opened from a key: focus goes to the first row rather than resting on the sheet. */
  keyboard: boolean
  /** The trigger's name — the sheet's title unless the content names one (`sheetTitle`). */
  title: string
  triggerRef: React.RefObject<HTMLElement | null>
  openFrom: (e: React.SyntheticEvent<HTMLElement>, keyboard: boolean) => void
  close: (event?: Event) => void
  release: () => void
}
const MenuSheetContext = React.createContext<MenuSheet | null>(null)
/** True for the parts drawn INSIDE a menu's sheet: they render as action rows, not as Base UI menu parts. */
const InMenuSheetContext = React.createContext(false)
const SheetRadioContext = React.createContext<{ value: unknown; onValueChange?: (value: unknown, details: never) => void } | null>(null)

/**
 * Is this part being drawn inside a menu's phone action sheet? For a call site that renders raw Base UI menu parts in
 * the popup (more-overflow.tsx) and must route them through the wrapper in the sheet.
 */
function useInMenuSheet(): boolean {
  return React.useContext(InMenuSheetContext)
}

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
  sheet = true,
  actionsRef: _ownedInternally,
  ...props
}: Omit<MenuPrimitive.Root.Props, "actionsRef"> & {
  closeOnScroll?: boolean
  /** Open as an action sheet below `sm` (the default). `false` keeps the popover at every width — admin only. */
  sheet?: boolean
  /** Never passed — declared only so the runtime destructure above can strip it. @deprecated */
  actionsRef?: never
}) {
  // ONE open state for both surfaces, held here (controlled or not) so the sheet's rows can close it. Base UI's root
  // only ever sees the popover half: on a phone it stays closed, so its popup and scroll lock never run.
  const [localOpen, setLocalOpen] = React.useState(defaultOpen ?? false)
  const isOpen = open ?? localOpen
  const { isPhone, surface } = useSheetSurface(isOpen, sheet)
  const setOpen = React.useCallback((next: boolean, details: MenuChangeDetails) => {
    onOpenChange?.(next, details)
    if (details.isCanceled) return
    setLocalOpen(next)
  }, [onOpenChange])
  const { actionsRef, handleOpenChange } = useScrollDismissedRoot<
    MenuPrimitive.Root.Actions,
    MenuChangeDetails
  >({ closeOnScroll: closeOnScroll && modal === false, open: isOpen && surface === "popover", defaultOpen: undefined, onOpenChange: setOpen })

  const sheetOpen = isOpen && surface === "sheet"
  const close = React.useCallback((event?: Event) => setOpen(false, sheetChangeDetails<MenuChangeDetails>("close-press", event)), [setOpen])
  const { release } = useSheetHistory(sheetOpen, close, "menu")
  const triggerRef = React.useRef<HTMLElement | null>(null)
  const [opened, setOpened] = React.useState({ keyboard: false, title: "" })
  const ctx = React.useMemo<MenuSheet>(() => ({
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
      setOpen(true, sheetChangeDetails<MenuChangeDetails>("trigger-press", e.nativeEvent, e.currentTarget))
    },
  }), [isPhone, surface, sheetOpen, opened, close, release, setOpen])

  return (
    <MenuSheetContext.Provider value={ctx}>
      <MenuPrimitive.Root
        data-slot="dropdown-menu"
        actionsRef={actionsRef}
        open={isOpen && surface === "popover"}
        onOpenChange={(next, details) => {
          // Phone: the trigger's CLICK opens the sheet (picker-sheet-kit `sheetTriggerHandlers`); a hover never does.
          // And a close the closed root reports while the sheet is up is not the sheet's to obey.
          if (next ? isPhone : surface === "sheet") return
          handleOpenChange(next, details)
        }}
        /* ⚠️ FORWARDED BACK DELIBERATELY. `modal` is destructured above so the gate can read it, which
           also removes it from `...props` — leaving this line out would drop `more-overflow`'s
           `modal={false}` on the floor and turn a deliberately non-modal rail menu into a
           scroll-locking one. Undefined here is not the same as absent: Base UI applies its own
           `modal = true` default for undefined, which is the pre-existing behaviour. */
        modal={modal}
        {...props}
      />
    </MenuSheetContext.Provider>
  )
}

function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  if (React.useContext(InMenuSheetContext)) return <>{props.children}</>
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  const sheet = React.useContext(MenuSheetContext)
  return (
    <MenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...chainHandlers(props, sheet?.isPhone ? sheetTriggerHandlers(sheet.openFrom) : null)}
      // Base UI's own popup is closed behind a phone sheet, so it would report `false` here.
      {...(sheet?.sheetOpen ? { "aria-expanded": true } : {})}
    />
  )
}

/** The action sheet: the filter card holding the menu's rows (see the note on `MenuSheet`). */
function MenuSheetBody({ sheet, title, children }: { sheet: MenuSheet; title?: React.ReactNode; children?: React.ReactNode }) {
  const { tr } = useLanguage()
  const listRef = React.useRef<HTMLDivElement>(null)
  return (
    <InMenuSheetContext.Provider value>
      <LazyPickerSheet
        open={sheet.sheetOpen}
        onOpenChange={(next) => { if (!next) sheet.close() }}
        title={title ?? (sheet.title || tr("More actions", "Thêm thao tác"))}
        finalFocus={sheet.triggerRef}
        initialFocus={sheet.keyboard ? () => firstFocusable(listRef.current) ?? true : undefined}
        onNavigate={sheet.release}
      >
        <div ref={listRef} className={SHEET_LIST}>{children}</div>
      </LazyPickerSheet>
    </InMenuSheetContext.Provider>
  )
}

function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  className,
  sheetTitle,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  > & {
    /** The phone sheet's title. Omitted: the trigger's own name (its aria-label or text). */
    sheetTitle?: React.ReactNode
  }) {
  const sheet = React.useContext(MenuSheetContext)
  if (sheet && sheet.surface === "sheet") return <MenuSheetBody sheet={sheet} title={sheetTitle}>{props.children as React.ReactNode}</MenuSheetBody>
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
      {/* `--scrim-exit` = the menu's 75ms exit, or the scrim is cut mid-fade when the popup unmounts it. */}
      <MenuPrimitive.Backdrop className="overlay-scrim pointer-events-none fixed inset-0 z-40 [--scrim-exit:75ms_var(--ease-out-strong)]" />
      <MenuPrimitive.Positioner
        className="isolate z-overlay outline-none"
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
          // `data-instant:duration-0!` — Base UI sets data-instant when the menu opens or closes from the
          // KEYBOARD (or on Escape), and a keyboard-initiated change never animates; ui/tooltip.tsx has
          // the full note, including why the `!` is required rather than relying on class order.
          // `transition-none`: enter and exit are KEYFRAMES; with no list the popup transitioned `all`,
          // and the focus outline an Escape keystroke changes on this (focused) popup became a 100ms
          // transition Base UI waited out — a pointer-opened menu closed by Escape sat on screen
          // 160–220ms (measured). Keyboard-initiated, so it should go at once.
          className={cn("z-overlay max-h-(--available-height) w-(--anchor-width) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-2xl bg-popover p-1 text-popover-foreground shadow-pop ring-1 ring-foreground/10 duration-100 ease-out-strong data-closed:duration-75 outline-none transition-none data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[side=bottom]:data-closed:slide-out-to-top-2 data-[side=inline-end]:data-closed:slide-out-to-left-2 data-[side=inline-start]:data-closed:slide-out-to-right-2 data-[side=left]:data-closed:slide-out-to-right-2 data-[side=right]:data-closed:slide-out-to-left-2 data-[side=top]:data-closed:slide-out-to-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:ease-out-strong data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95 data-instant:duration-0!", className )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

/** A Base UI part's className, which may be a state function, as a plain string for a sheet row. */
const sheetClass = (className: unknown): string | undefined => (typeof className === "string" ? className : undefined)

function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  if (React.useContext(InMenuSheetContext)) return <div data-slot="dropdown-menu-group" className={sheetClass(props.className)}>{props.children}</div>
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean
}) {
  if (React.useContext(InMenuSheetContext)) {
    return <div data-slot="dropdown-menu-label" className={cn(SHEET_GROUP_LABEL, sheetClass(className))}>{props.children}</div>
  }
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

type SheetRowProps = {
  className?: unknown
  disabled?: boolean
  onClick?: (event: React.MouseEvent<HTMLElement>) => void
  render?: unknown
  children?: React.ReactNode
  id?: string
}

/**
 * One action row of the sheet. Honours the item's `render` (a <Link>, a caller's own <Button>): the row's props are
 * merged onto that element, its own onClick still runs. Releases the sheet's history entry before an action that
 * leaves the page — a link, or an item marked `navigates` — so the sheet's close never races the navigation.
 */
function SheetRow({
  sheet, row, closeOnClick, navigates, pressed, trailing, onActivate,
}: {
  sheet: MenuSheet
  row: SheetRowProps
  closeOnClick: boolean
  navigates?: boolean
  pressed?: boolean
  trailing?: React.ReactNode
  onActivate?: () => void
}) {
  const { className, disabled, onClick, render, children, id } = row
  const run = (e: React.MouseEvent<HTMLElement>, theirs?: (e: React.MouseEvent<HTMLElement>) => void) => {
    // A rendered element (a <Link>) has no native `disabled` to stop the click: refuse it here.
    if (disabled) { e.preventDefault(); return }
    if (navigates || (e.currentTarget as Element).closest("a[href]")) sheet.release()
    theirs?.(e)
    onClick?.(e)
    onActivate?.()
    if (closeOnClick) sheet.close(e.nativeEvent)
  }
  const cls = cn(SHEET_ACTION_ROW, sheetClass(className))
  const body = trailing ? <>{children}{trailing}</> : children
  if (React.isValidElement(render)) {
    const el = render as React.ReactElement<{ className?: string; onClick?: (e: React.MouseEvent<HTMLElement>) => void; children?: React.ReactNode }>
    return React.cloneElement(el, {
      id,
      className: cn(cls, el.props.className),
      onClick: (e: React.MouseEvent<HTMLElement>) => run(e, el.props.onClick),
      children: el.props.children ?? body,
      ...(pressed !== undefined ? { "aria-pressed": pressed } : {}),
      ...(disabled ? { "aria-disabled": true, disabled: true } : {}),
    } as Record<string, unknown>)
  }
  return (
    <Button type="button" variant="bare" size="none" id={id} disabled={disabled} aria-pressed={pressed} onClick={(e) => run(e)} className={cls}>
      {body}
    </Button>
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  navigates,
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean
  variant?: "default" | "destructive"
  /**
   * The row's `onClick` LEAVES the page (a router.push). In a phone sheet it releases the sheet's history entry first,
   * so the sheet's own `history.back()` cannot undo the navigation (src/lib/back-to-close.ts). Links need no flag.
   */
  navigates?: boolean
}) {
  const sheet = React.useContext(MenuSheetContext)
  if (React.useContext(InMenuSheetContext) && sheet) {
    return (
      <SheetRow
        sheet={sheet}
        navigates={navigates}
        closeOnClick={props.closeOnClick !== false}
        row={{
          ...(props as SheetRowProps),
          className: cn(variant === "destructive" ? "text-destructive [&_svg]:text-destructive" : SHEET_LEAD_ICON, sheetClass(className)),
        }}
      />
    )
  }
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

// A sheet has no submenus: inside one, a submenu's trigger becomes a heading and its items join the list (no consumer
// sheet menu has one — the admin moderation menu that does keeps `sheet={false}`).
function DropdownMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  if (React.useContext(InMenuSheetContext)) return <>{props.children}</>
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
  if (React.useContext(InMenuSheetContext)) return <div className={SHEET_GROUP_LABEL}>{children}</div>
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
  if (React.useContext(InMenuSheetContext)) return <>{props.children as React.ReactNode}</>
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
      className={cn("w-auto min-w-[96px] rounded-lg bg-popover p-1 text-popover-foreground ring-1 ring-foreground/10 duration-100 ease-out-strong data-closed:duration-75 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[side=bottom]:data-closed:slide-out-to-top-2 data-[side=left]:data-closed:slide-out-to-right-2 data-[side=right]:data-closed:slide-out-to-left-2 data-[side=top]:data-closed:slide-out-to-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:ease-out-strong data-closed:fade-out-0 data-closed:zoom-out-95 data-instant:duration-0!", className )}
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
  const sheet = React.useContext(MenuSheetContext)
  if (React.useContext(InMenuSheetContext) && sheet) {
    // A toggle row: aria-pressed carries the state (the ✓ is decoration), and it stays open, as Base UI's does.
    return (
      <SheetRow
        sheet={sheet}
        closeOnClick={props.closeOnClick === true}
        pressed={!!checked}
        trailing={checked ? <CheckIcon className="ml-auto size-4" /> : null}
        onActivate={() => props.onCheckedChange?.(!checked, sheetChangeDetails<MenuPrimitive.CheckboxItem.ChangeEventDetails>("item-press"))}
        row={{ ...(props as SheetRowProps), className: cn(SHEET_LEAD_ICON, sheetClass(className)), children }}
      />
    )
  }
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
  if (React.useContext(InMenuSheetContext)) {
    return (
      <SheetRadioContext.Provider value={{ value: props.value, onValueChange: props.onValueChange as never }}>
        <div role="group" className={sheetClass(props.className)}>{props.children}</div>
      </SheetRadioContext.Provider>
    )
  }
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
  const sheet = React.useContext(MenuSheetContext)
  const radio = React.useContext(SheetRadioContext)
  if (React.useContext(InMenuSheetContext) && sheet) {
    const on = radio?.value === props.value
    return (
      <SheetRow
        sheet={sheet}
        closeOnClick={props.closeOnClick === true}
        pressed={on}
        trailing={on ? <CheckIcon className="ml-auto size-4" /> : null}
        onActivate={() => radio?.onValueChange?.(props.value, sheetChangeDetails<never>("item-press"))}
        row={{ ...(props as SheetRowProps), className: cn(SHEET_LEAD_ICON, sheetClass(className)), children }}
      />
    )
  }
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
  if (React.useContext(InMenuSheetContext)) return <div role="separator" data-slot="dropdown-menu-separator" className={cn(SHEET_SEPARATOR, sheetClass(className))} />
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
  // A key hint means nothing on a touch sheet.
  if (React.useContext(InMenuSheetContext)) return null
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
  useInMenuSheet,
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
