'use client'

import { Fragment, useEffect, useRef } from 'react'
import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import { Check, Search } from '@/components/ui/icons'
import { PickerSheet } from '@/components/ui/picker-sheet'
import {
  SHEET_EMPTY, SHEET_LIST, SHEET_ROW, SHEET_ROW_OFF, SHEET_ROW_ON, SHEET_SEARCH, SHEET_SEARCH_INPUT,
} from '@/components/ui/picker-sheet-kit'
import { useLanguage } from '@/context/language-context'
import { cn } from '@/lib/utils'
import { GROUP_LABEL, OptionLabel, fold, groupRuns, type OptionGroup, type SelectOption } from './custom-select'

/**
 * ── CustomSelect ON A PHONE: the filter card with a listbox in it (owner, 2026-10-18) ─────────────────────────────────
 *
 * Loaded on the first phone open (custom-select.tsx `LazyOptionSheet`). The list is Base UI COMBOBOX in `inline` mode
 * — its documented "Combobox.Root > Dialog" composition — for BOTH variants, because Select has no inline mode: the
 * same role="listbox" / role="option" / aria-selected the desktop popup announces, the same groups (role="group" named
 * by their GroupLabel), and for a long list the same type-to-filter, now with the search field pinned at the TOP of
 * the sheet and the list scrolling under it.
 *
 *   · A tap picks and closes (single choice: no footer, the Material / iOS norm). Re-tapping the current row only
 *     closes. The pick is handed back through `onPick`, which commits after the sheet's history entry is gone
 *     (picker-sheet-kit.tsx `useSheetHistory`).
 *   · Opened by a tap, focus stays on the sheet itself: no keyboard springs up over a list the person has not asked to
 *     search (iOS would refuse a programmatic focus outside the gesture anyway). Opened by a key, focus goes to the
 *     search field, or to the listbox itself (`tabIndex={0}`), where the arrow keys move `aria-activedescendant` and
 *     Enter picks — Base UI's floating list navigation, wired onto the list when nothing typeable owns it.
 *   · The current row is scrolled to the middle of the sheet on open — a ward list runs past 100 rows.
 *   · ⚠️ Rows are DIVs, never ui/button: the combobox drives the list with virtual focus (see the same note on the
 *     desktop popup in custom-select.tsx).
 */
export interface OptionSheetProps {
  open: boolean
  onClose: () => void
  title: string
  options: SelectOption[]
  value: string
  searchable: boolean
  onPick: (value: string) => void
  /** Opened from a key: focus goes into the list (or its search field) instead of resting on the sheet. */
  keyboard: boolean
  finalFocus: React.RefObject<HTMLElement | null>
}

export function OptionSheet({ open, onClose, title, options, value, searchable, onPick, keyboard, finalFocus }: OptionSheetProps) {
  const { tr } = useLanguage()
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedOption = options.find((o) => o.value === value) ?? null
  const groups = groupRuns(options)
  // The desktop popup's rule (custom-select.tsx): Base UI's own accent-blind collator, unless a row carries a
  // description it would never search.
  const searchesDescription = options.some((o) => o.description)

  useEffect(() => {
    if (!open) return
    // The popup mounts on the frame the drawer opens (PickerSheet enters on its second render), so look for the row
    // over a few frames rather than once.
    let frames = 0
    let id = 0
    const centre = () => {
      const row = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
      const body = row?.closest<HTMLElement>('[data-slot="picker-sheet-body"]')
      if (!row || !body) {
        if (frames++ < 6) id = requestAnimationFrame(centre)
        return
      }
      // Relative rects, not offsetTop: the popup is mid-slide (transformed), and both move with it.
      const r = row.getBoundingClientRect()
      const b = body.getBoundingClientRect()
      body.scrollTop += r.top - b.top - (b.height - r.height) / 2
    }
    id = requestAnimationFrame(centre)
    return () => cancelAnimationFrame(id)
  }, [open])

  const renderItem = (item: SelectOption) => {
    const isActive = item.value === value
    return (
      <ComboboxPrimitive.Item key={item.value} value={item} className={cn(SHEET_ROW, isActive ? SHEET_ROW_ON : SHEET_ROW_OFF)}>
        <OptionLabel label={item.label} description={item.description} count={item.count} />
        {/* Decorative: the row's state is its aria-selected, which the forced-colors rule paints too (canon §3b). */}
        {isActive && <Check className="h-4 w-4 shrink-0" />}
      </ComboboxPrimitive.Item>
    )
  }

  return (
    // Rendered inside CustomSelect's sizing wrapper: the Root emits a hidden <input> as a SIBLING of its children, and
    // it must not land in a caller's `space-y-*` column (the trap documented on the desktop variants).
    <ComboboxPrimitive.Root
      inline
      // Bound to the sheet, as Base UI asks of an inline list inside a dialog: the query and the highlight reset when
      // the sheet has finished closing (the list finds the drawer popup as its closest [role=dialog]).
      open={open}
      onOpenChange={(next) => { if (!next) onClose() }}
      items={groups ?? options}
      value={selectedOption}
      onValueChange={(v) => { if (v && typeof v === 'object' && 'value' in v) onPick((v as SelectOption).value) }}
      filter={
        searchable && searchesDescription
          ? (item: SelectOption, query: string) => fold(`${item.label} ${item.description ?? ''}`).includes(fold(query.trim()))
          : undefined
      }
      // As on desktop: the best match is highlighted as you type, so Enter picks the obvious thing.
      autoHighlight={searchable}
    >
      <PickerSheet
        open={open}
        onOpenChange={(next) => { if (!next) onClose() }}
        title={title}
        initialFocus={keyboard ? (searchable ? inputRef : listRef) : undefined}
        finalFocus={finalFocus}
        search={searchable ? (
          <label className={SHEET_SEARCH}>
            <Search className="h-4 w-4 shrink-0 text-ink-4" aria-hidden="true" />
            <ComboboxPrimitive.Input
              ref={inputRef}
              placeholder={tr('Search', 'Tìm kiếm')}
              // The field is the list's control once focused, so it carries the picker's name too.
              aria-label={title}
              enterKeyHint="search"
              className={SHEET_SEARCH_INPUT}
            />
          </label>
        ) : undefined}
      >
        <ComboboxPrimitive.Empty className={SHEET_EMPTY}>{tr('No matches', 'Không có kết quả')}</ComboboxPrimitive.Empty>
        <ComboboxPrimitive.List
          ref={listRef}
          // A short list has no field to type in, so the listbox itself takes focus for the arrow keys.
          tabIndex={searchable ? -1 : 0}
          aria-label={title}
          className={SHEET_LIST}
        >
          {groups
            ? (group: OptionGroup) => (group.label ? (
                <ComboboxPrimitive.Group key={group.label} items={group.items}>
                  <ComboboxPrimitive.GroupLabel className={GROUP_LABEL}>{group.label}</ComboboxPrimitive.GroupLabel>
                  {group.items.map(renderItem)}
                </ComboboxPrimitive.Group>
              ) : (
                <Fragment key={`\u0000${group.items[0]?.value ?? ''}`}>{group.items.map(renderItem)}</Fragment>
              ))
            : renderItem}
        </ComboboxPrimitive.List>
      </PickerSheet>
    </ComboboxPrimitive.Root>
  )
}
