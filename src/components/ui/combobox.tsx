"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { CheckIcon, ChevronDownIcon, Search, XIcon } from "@/components/ui/icons"
import {
  LazyPickerSheet,
  SHEET_LIST,
  SHEET_SEARCH,
  SHEET_SEARCH_INPUT,
  accessibleNameOf,
  chainHandlers,
  sheetChangeDetails,
  sheetTriggerHandlers,
  useSheetHistory,
  useSheetSurface,
  type PickerSurface,
} from "@/components/ui/picker-sheet-kit"

import { cn } from "@/lib/utils"

type ComboboxChangeDetails = ComboboxPrimitive.Root.ChangeEventDetails

/**
 * ── ON A PHONE THE LIST OPENS AS A BOTTOM SHEET, ITS SEARCH FIELD ON TOP (owner, 2026-10-18: "also mobile all dropdowns
 * should be bottom up card style like the filter card") ──────────────────────────────────────────────────────────────
 *
 * A list anchored under a field you type in sat under the phone's own keyboard. Below `sm`, when the combobox has rows
 * to offer, the page field becomes a TAP TARGET (`readOnly`, same element, same id — a `<label htmlFor>` and a Field's
 * data-invalid still reach it) and the list opens in the filter card: the search field pinned at the TOP of the sheet,
 * the rows scrolling under it. Inside, it is Base UI's documented "Combobox.Root > Dialog" composition — an `inline`
 * root mirroring this one's list props (items, value, inputValue, filter, labels…), so the caller's rules hold
 * unchanged: what typing does, what a pick commits, and what its own `onOpenChange` refuses (the teacher form's
 * closed-list "Enter with no row highlighted keeps the list open" cancels the close here too). Call sites do not change.
 *
 *   · No rows (the post wizard's Model field before its brand has suggestions), and the field stays a plain field you
 *     type in. A field already being typed in when rows arrive stays typeable until it is left — it never turns
 *     read-only under the keyboard.
 *   · ⚠️ The sheet's input owns the QUERY the way the desktop popup's field did, with one guard: Base UI clears an
 *     inline input as the sheet finishes closing (`input-clear`), and for a field whose typed text IS its value (the
 *     post wizard's Brand: "we will use the name you typed") that clear would erase the answer. It is not forwarded.
 *   · ⛔ Back closes the sheet (useSheetHistory).
 *   · `sheet={false}` keeps the anchored popup at every width.
 */
type ComboboxSheet = {
  /** A phone, and this combobox has rows to offer: the page field is a tap target and the list opens in the sheet. */
  isPhone: boolean
  surface: PickerSurface
  sheetOpen: boolean
  keyboard: boolean
  title: string
  placeholder: string
  /** The page field — the sheet's title is its label, and focus returns to it. */
  inputRef: React.RefObject<HTMLInputElement | null>
  /** The root's list props, mirrored into the sheet's inline root. */
  listProps: Record<string, unknown>
  openFrom: (e: React.SyntheticEvent<HTMLElement>, keyboard: boolean) => void
  setOpen: (next: boolean, details: ComboboxChangeDetails) => void
  close: (event?: Event) => void
  release: () => void
}
const ComboboxSheetContext = React.createContext<ComboboxSheet | null>(null)
/** True for the parts drawn INSIDE the phone sheet (the list, its rows, its empty state). */
const InComboboxSheetContext = React.createContext(false)

function Combobox<Value, Multiple extends boolean | undefined = false>({
  open,
  defaultOpen,
  onOpenChange,
  sheet: sheetEnabled = true,
  ...props
}: ComboboxPrimitive.Root.Props<Value, Multiple> & {
  /** Open the list as a bottom sheet below `sm` (the default) — see the note above. */
  sheet?: boolean
}) {
  // ONE open state for both surfaces (controlled or not); the page root only ever sees the popup half.
  const [localOpen, setLocalOpen] = React.useState(defaultOpen ?? false)
  const isOpen = open ?? localOpen
  const hasRows = Array.isArray(props.items) && props.items.length > 0
  const { isPhone, surface } = useSheetSurface(isOpen, sheetEnabled && hasRows)
  const setOpen = React.useCallback((next: boolean, details: ComboboxChangeDetails) => {
    onOpenChange?.(next, details)
    if (details.isCanceled) return
    setLocalOpen(next)
  }, [onOpenChange])
  const sheetOpen = isOpen && surface === "sheet"
  const close = React.useCallback((event?: Event) => setOpen(false, sheetChangeDetails<ComboboxChangeDetails>("close-press", event)), [setOpen])
  const { release } = useSheetHistory(sheetOpen, close, "picker")
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [opened, setOpened] = React.useState({ keyboard: false, title: "", placeholder: "" })
  // Everything that describes the LIST, for the sheet's inline root — never the field's identity (its id, name and
  // form wiring stay on the page field: a second id would duplicate it) and never the open state (the sheet owns it).
  const { id: _id, name: _name, form: _form, required: _required, inputRef: _inputRef, actionsRef: _actionsRef, onOpenChangeComplete: _complete, inline: _inline, modal: _modal, children: _children, ...listProps } = props
  const ctx = React.useMemo<ComboboxSheet>(() => ({
    isPhone,
    surface,
    sheetOpen,
    keyboard: opened.keyboard,
    title: opened.title,
    placeholder: opened.placeholder,
    inputRef,
    listProps: listProps as Record<string, unknown>,
    setOpen,
    close,
    release,
    openFrom: (e, keyboard) => {
      const field = inputRef.current
      setOpened({ keyboard, title: accessibleNameOf(field ?? e.currentTarget), placeholder: field?.placeholder ?? "" })
      setOpen(true, sheetChangeDetails<ComboboxChangeDetails>("trigger-press", e.nativeEvent, e.currentTarget))
    },
  }), [isPhone, surface, sheetOpen, opened, setOpen, close, release, props])

  return (
    <ComboboxSheetContext.Provider value={ctx}>
      <ComboboxPrimitive.Root
        {...(props as ComboboxPrimitive.Root.Props<Value, Multiple>)}
        open={isOpen && surface === "popover"}
        onOpenChange={(next, details) => {
          // Phone (with rows): the field's tap opens the sheet; Base UI's own opens (a press, typing) are not obeyed,
          // and a close the closed page root reports while the sheet is up is not the sheet's to obey.
          if (next ? isPhone : surface === "sheet") return
          setOpen(next, details)
        }}
      />
    </ComboboxSheetContext.Provider>
  )
}

function ComboboxInputGroup({ className, ...props }: ComboboxPrimitive.InputGroup.Props) {
  return (
    <ComboboxPrimitive.InputGroup
      data-slot="combobox-input-group"
      className={cn(
        // ⛔ RAISED ABOVE THE SCRIM WHILE OPEN — `relative` + the overlay tier (z-overlay = 50, the
        // ladder in globals.css) under the popup-open variant. `ComboboxContent`
        // paints an `overlay-scrim` backdrop at z-40 over the whole page, and the input group is
        // ordinary page content, so the field a user is actively TYPING IN was being dimmed and
        // blurred by its own dropdown. Owner, 2026-08-31: "input should be on dropdown not behind
        // the blur". z-50 needs `relative` to apply at all — z-index is inert on a static element,
        // which is the silent half of this bug.
        // ⚠️ z-overlay TIES THE POSITIONER'S OWN z-overlay AND THE POPUP STILL WINS, because the portal is
        // appended after this subtree and a tie breaks on DOM order. Raising it further (z-[60])
        // would put the field OVER its own list.
        // ⚠️ ONLY WHILE OPEN. A permanently-positioned z-50 input group would sit above the sticky
        // facet bar (z-30) and the header on every page that renders one.
        // ⚠️ `data-popup-open:`, NOT `data-open:` — Base UI marks the INPUT GROUP `data-popup-open`
        // (ComboboxInputGroupDataAttributes); `data-open` is the popup's own attribute and never lands
        // here. Keyed on `data-open`, this lift matched nothing and the field sat under its own scrim,
        // blurred — measured on the post wizard's Brand field, 2026-09-29.
        "flex h-11 w-full items-center rounded-xl border border-line-strong bg-card transition-[border-color,box-shadow,background-color] duration-150 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 data-popup-open:relative data-popup-open:z-overlay data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}

function ComboboxInput({ className, ref, ...props }: ComboboxPrimitive.Input.Props) {
  const sheet = React.useContext(ComboboxSheetContext)
  // A field already being typed in when the sheet becomes possible (rows arrived mid-typing) stays typeable until it
  // is left: it must never turn read-only under the keyboard.
  const [typing, setTyping] = React.useState(false)
  const tapTarget = !!sheet?.isPhone && !typing
  const setRef = React.useCallback((el: HTMLInputElement | null) => {
    if (sheet) sheet.inputRef.current = el
    if (typeof ref === "function") ref(el)
    else if (ref) (ref as React.RefObject<HTMLInputElement | null>).current = el
  }, [sheet, ref])
  const handlers = tapTarget && sheet
    ? {
        ...sheetTriggerHandlers(sheet.openFrom),
        // A read-only field has no click on Enter or Space (only a button does): open from the key itself.
        onKeyDown: (e: React.KeyboardEvent<HTMLElement> & { preventBaseUIHandler?: () => void }) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
            e.preventBaseUIHandler?.()
            e.preventDefault()
            sheet.openFrom(e, true)
          }
        },
      }
    : null
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      ref={setRef}
      className={cn(
        "h-full min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed",
        // The tap target reads as the field it is — the pointer, not the text caret.
        tapTarget && "cursor-pointer",
        className,
      )}
      {...chainHandlers(
        {
          ...props,
          onFocus: (e: React.FocusEvent<HTMLInputElement>) => { if (!sheet?.isPhone) setTyping(true); props.onFocus?.(e as never) },
          onBlur: (e: React.FocusEvent<HTMLInputElement>) => { setTyping(false); props.onBlur?.(e as never) },
        },
        handlers,
      )}
      {...(tapTarget ? { readOnly: true } : {})}
      {...(sheet?.sheetOpen ? { "aria-expanded": true } : {})}
    />
  )
}

function ComboboxClear({ className, children, ...props }: ComboboxPrimitive.Clear.Props) {
  // Enters/leaves from scale-90, not 75: nothing should grow from further than the 0.9 floor, and
  // this one appears and disappears as the person TYPES, so its travel stays small.
  return (
    <ComboboxPrimitive.Clear
      data-slot="combobox-clear"
      className={cn(
        "flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-body outline-none transition-[color,background-color,opacity,scale] duration-150 ease-out hover:bg-tint hover:text-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring/40 data-starting-style:scale-90 data-starting-style:opacity-0 data-ending-style:scale-90 data-ending-style:opacity-0",
        className,
      )}
      {...props}
    >
      {children ?? <XIcon className="size-4" />}
    </ComboboxPrimitive.Clear>
  )
}

function ComboboxTrigger({ className, children, ...props }: ComboboxPrimitive.Trigger.Props) {
  const sheet = React.useContext(ComboboxSheetContext)
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn(
        // `scale`, not `transform` — `active:scale-[0.96]` writes the standalone `scale` property
        // in Tailwind v4, so naming `transform` subscribed to a property nothing sets and the press
        // snapped instead of tweening. Same fix as its sibling trigger above.
        "group flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-body outline-none transition-[color,background-color,scale] duration-150 ease-spring-snappy hover:bg-tint hover:text-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
      // Phone sheet: the chevron opens the sheet too (picker-sheet-kit `sheetTriggerHandlers`).
      {...chainHandlers(props, sheet?.isPhone ? sheetTriggerHandlers(sheet.openFrom) : null)}
    >
      {children ?? <ChevronDownIcon className="size-4 transition-transform duration-200 ease-spring-snappy group-data-popup-open:rotate-180" />}
    </ComboboxPrimitive.Trigger>
  )
}

/**
 * The phone sheet: the filter card with an inline root mirroring the page one, its search field pinned on top and the
 * caller's own list (ComboboxEmpty + ComboboxList and its rows) in the body.
 */
function ComboboxSheetBody({ sheet, title, children }: { sheet: ComboboxSheet; title?: React.ReactNode; children?: React.ReactNode }) {
  const searchRef = React.useRef<HTMLInputElement>(null)
  const { onInputValueChange, ...listProps } = sheet.listProps as { onInputValueChange?: (value: string, details: ComboboxChangeDetails) => void }
  const name = title ?? sheet.title
  return (
    <InComboboxSheetContext.Provider value>
      <LazyPickerSheet
        open={sheet.sheetOpen}
        onOpenChange={(next) => { if (!next) sheet.close() }}
        title={name}
        finalFocus={sheet.inputRef}
        initialFocus={sheet.keyboard ? searchRef : undefined}
        onNavigate={sheet.release}
        // The inline root wraps the search field AND the list, inside the drawer — its hidden form input too.
        contentWrapper={(inner) => (
          <ComboboxPrimitive.Root
            {...(listProps as ComboboxPrimitive.Root.Props<unknown, false>)}
            inline
            open={sheet.sheetOpen}
            onOpenChange={(next, details) => { if (!next) sheet.setOpen(false, details) }}
            onInputValueChange={(value, details) => {
              // Base UI's end-of-close clear of an inline field — never the person's own edit (see the note above).
              if (details.reason === "input-clear") return
              onInputValueChange?.(value, details)
            }}
          >
            {inner}
          </ComboboxPrimitive.Root>
        )}
        search={
          <label className={SHEET_SEARCH}>
            <Search className="h-4 w-4 shrink-0 text-ink-4" aria-hidden="true" />
            <ComboboxPrimitive.Input
              ref={searchRef}
              placeholder={sheet.placeholder}
              aria-label={typeof name === "string" ? name : undefined}
              autoComplete="off"
              enterKeyHint="search"
              // The saved answer is in the field; a tap selects it, so typing replaces it as a search.
              onFocus={(e) => e.currentTarget.select()}
              className={SHEET_SEARCH_INPUT}
            />
          </label>
        }
      >
        {children}
      </LazyPickerSheet>
    </InComboboxSheetContext.Provider>
  )
}

function ComboboxContent({
  className,
  children,
  side = "bottom",
  sideOffset = 6,
  align = "start",
  sheetTitle,
  ...props
}: ComboboxPrimitive.Popup.Props & Pick<ComboboxPrimitive.Positioner.Props, "align" | "side" | "sideOffset"> & {
  /** The phone sheet's title. Omitted: the page field's label. */
  sheetTitle?: React.ReactNode
}) {
  const sheet = React.useContext(ComboboxSheetContext)
  if (sheet && sheet.surface === "sheet") return <ComboboxSheetBody sheet={sheet} title={sheetTitle}>{children as React.ReactNode}</ComboboxSheetBody>
  return (
    <ComboboxPrimitive.Portal>
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
      {/* `--scrim-exit` = the list's 75ms exit, or the scrim is cut mid-fade when the popup unmounts it. */}
      <ComboboxPrimitive.Backdrop className="overlay-scrim pointer-events-none fixed inset-0 z-40 [--scrim-exit:75ms_var(--ease-out-strong)]" />
      <ComboboxPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} className="isolate z-overlay">
        {/* `shadow-pop` — the ELEVATION TOKEN, not one of Tailwind's stock t-shirt shadow
            utilities (what this carried until 2026-08-11). The combobox list is the same kind of
            floating layer as ui/select and ui/dropdown-menu, so it takes the same token: the
            tokens are what make those three read as one light source, and what deepens them in
            dark mode (0.08 → 0.45 alpha) where a stock light-mode rgba disappears.
            ⚠️ Do NOT name a stock shadow utility in this comment — Tailwind scans raw TEXT, so
            spelling one here re-emits it into the bundle (see the same warning in select.tsx). */}
        {/* ⚠️ THE `ease-out` HERE CHANGES THE OPEN, NOT ONLY THE CLOSE — deliberately.
            This popup shipped with NO named curve on either side, so it ran Tailwind's
            default while its three siblings (dropdown-menu, popover, select) all ran
            `ease-out`: four identical-looking menus, one of them subtly off. Scoping it
            to `data-open:` would have kept combobox the odd one out in a different way.
            The close half (`duration-75`) is what the dismissal pass added — the SHORTER duration,
            not a different curve. It carried `ease-in` until the easing pass measured it. */}
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            "relative z-overlay max-h-(--available-height) w-(--anchor-width) min-w-64 origin-(--transform-origin) overflow-hidden rounded-2xl bg-popover text-popover-foreground shadow-pop ring-1 ring-foreground/10 duration-100 ease-out-strong data-closed:duration-75 data-closed:ease-out-strong data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
            className,
          )}
          {...props}
        >
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  // In the phone sheet the sheet's body is the scroller: no box of its own, rows on the sheet's gutter.
  const inSheet = React.useContext(InComboboxSheetContext)
  return <ComboboxPrimitive.List data-slot="combobox-list" className={cn(inSheet ? SHEET_LIST : "max-h-72 overflow-y-auto p-1.5", className)} {...props} />
}

function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
  return <ComboboxPrimitive.Group data-slot="combobox-group" className={cn("scroll-my-1", className)} {...props} />
}

function ComboboxGroupLabel({ className, ...props }: ComboboxPrimitive.GroupLabel.Props) {
  return <ComboboxPrimitive.GroupLabel data-slot="combobox-group-label" className={cn("px-3 py-2 text-xs font-semibold text-muted-foreground", className)} {...props} />
}

function ComboboxItem({ className, children, ...props }: ComboboxPrimitive.Item.Props) {
  const inSheet = React.useContext(InComboboxSheetContext)
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        // No transition: the highlight moves on arrow keys, and a keyboard-driven change never animates.
        "relative flex min-h-11 cursor-pointer items-center rounded-xl py-2.5 pr-10 pl-3 text-sm leading-5 outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
        // The sheet's row: the 48px box and the press / keyboard highlight of every other sheet list.
        inSheet && "min-h-12 active:bg-muted data-highlighted:bg-muted data-highlighted:text-foreground data-selected:font-semibold data-selected:text-accent-foreground",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <ComboboxPrimitive.ItemIndicator className="absolute right-3 flex size-4 items-center justify-center data-starting-style:scale-50 data-starting-style:opacity-0">
        <CheckIcon className="size-4" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  // `empty:p-0`: Base UI renders this element ALWAYS (it is the list's role="status" live region) and
  // only fills it when nothing matches — so its padding put a blank 32px band at the top of every
  // list that DID have matches. Zero padding while empty, not `hidden`: a live region switched in from
  // display:none is not reliably announced.
  return <ComboboxPrimitive.Empty data-slot="combobox-empty" className={cn("px-3 py-4 text-center text-sm text-body empty:p-0", className)} {...props} />
}

export {
  Combobox,
  ComboboxClear,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
}
