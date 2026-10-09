'use client'

// ── THE CLOSED-LIST COMBOBOX (teacher form, 2026-10-08) ──────────────────────────────────────────────────────────────
// A long list a person searches on a phone, whose answer is always ONE OF ITS ROWS — never typed text: the nationality
// (country-combobox.tsx), the province, the HCMC district, a language. One copy of the rules the nationality picker
// earned over several review rounds (gate reviews, 2026-10-08):
//   · typing only FILTERS — nothing is highlighted until the person moves to a row with the arrow keys or points at
//     one (no autoHighlight), so Enter commits only a row they chose. Three rounds of letting Enter infer a choice each
//     found a new way to save an answer nobody picked ("austr" saved Australia over Austria);
//   · Enter with no row highlighted KEEPS THE LIST OPEN, the matches in view to tap;
//   · ONLY THE CLEAR BUTTON CLEARS: deleting the text, or Escape over a closed field, keeps the saved answer, whose
//     name comes back when the person leaves the field;
//   · `id` lands on the <input> (Base UI hands the root's id down), so a `<label htmlFor>` names and focuses it, and
//     inside a ui/field a refused Next reaches it through the Field's data-invalid.
// An ADDER (`adder`): every pick is handed to `onChange` and the field empties again — the value lives in the
// caller's list (the languages a teacher speaks), shown beside it as removable chips.

import { useCallback, useState } from 'react'
import {
  Combobox, ComboboxClear, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxInputGroup, ComboboxItem, ComboboxList,
  ComboboxTrigger,
} from '@/components/ui/combobox'
import { fold } from '@/lib/fold'

/** Folded (case, accents, đ — src/lib/fold.ts) and cut into words at anything that is not a letter, mark or digit. */
const words = (s: string) => fold(s).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean)
/** A query as the search reads it: its words run together — "new zea" is "newzea", "quy nhon" is "quynhon". */
export const searchKey = (s: string) => words(s).join('')
/**
 * ⛔ A QUERY MATCHES AT THE START OF A WORD, never inside one (gate review, 2026-10-08). Each name yields one key per
 * word, running from that word to the name's end: "Côte d’Ivoire" → cotedivoire, divoire, ivoire. As a plain
 * substring "ca" found the US (Ameri·ca) and "in" the Philippines (Filip·in·o).
 */
export const wordStarts = (s: string) => {
  const w = words(s)
  return w.map((_, i) => w.slice(i).join(''))
}
/** The word-start keys of every name a row answers to, for `matches`. */
export const startsOf = (names: readonly string[]): readonly string[] => [...new Set(names.flatMap(wordStarts))]
/** A row matches when one of its keys starts with the query; a query of punctuation alone lists everything. */
export const matchesStarts = (starts: readonly string[] | undefined, query: string): boolean => {
  const q = searchKey(query)
  return !q || (starts?.some((s) => s.startsWith(q)) ?? false)
}

export function ClosedCombobox({
  id, items, value, onChange, labelOf, matches, itemContent, placeholder, emptyText, clearLabel, triggerLabel, adder = false,
  disabled = false,
}: {
  /** Lands on the <input> — a `<label htmlFor>` both names and focuses it. */
  id?: string
  items: readonly string[]
  /** The chosen row's key, or '' for none (an adder's is always ''). */
  value: string
  onChange: (key: string) => void
  /** What the FIELD shows for the chosen row (and what Base UI reads as the row's text). */
  labelOf: (key: string) => string
  /** Base UI only calls this with a non-empty query. */
  matches: (key: string, query: string) => boolean
  /** What a ROW shows, when it says more than the field does (a town alias names its province). */
  itemContent?: (key: string) => React.ReactNode
  placeholder: string
  emptyText: string
  /** The Clear button's name. Not used by an adder, which has nothing to clear. */
  clearLabel?: string
  triggerLabel: string
  adder?: boolean
  /** Nothing can be picked right now (an adder at its limit) — the placeholder says why. */
  disabled?: boolean
}) {
  const labelFor = useCallback((key: string) => (key ? labelOf(key) : ''), [labelOf])
  // What the person is typing; null while the field shows the saved answer's name. Held here rather than left to Base
  // UI so that leaving the field — by closing the list, or by blurring it closed — always puts that name back.
  const [draft, setDraft] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  return (
    <Combobox
      id={id}
      items={items as string[]}
      value={value || null}
      onValueChange={(next, details) => {
        // ⛔ ONLY THE CLEAR BUTTON CLEARS. Base UI also clears when the text is deleted and on Escape over a closed
        // list; here both keep the saved answer, whose name comes back when the person leaves.
        if (next === null && details.reason !== 'clear-press') { details.cancel(); return }
        onChange(next ?? '')
      }}
      inputValue={draft ?? labelFor(value)}
      onInputValueChange={(text, details) => setDraft(details.reason === 'input-change' ? text : null)}
      open={open}
      onOpenChange={(next, details) => {
        // Enter with no row highlighted keeps the list open (Base UI closes it with reason 'none', and the closed field
        // then went back to the saved name: Enter looked like it did nothing and threw the query away).
        if (!next && details.reason === 'none' && details.event instanceof KeyboardEvent && details.event.key === 'Enter') {
          details.cancel()
          return
        }
        setOpen(next)
        if (!next) setDraft(null)
      }}
      itemToStringLabel={labelFor}
      filter={matches}
      // ⛔ NO autoHighlight — typing only filters; Enter commits only a row the person moved to.
      autoHighlight={false}
      disabled={disabled}
    >
      {/* The form's filled-input idiom (ui/input `filled`): tint, no border, the soft focus ring; ui/input's 44px box,
          growing when the OS enlarges text. */}
      <ComboboxInputGroup className="h-auto min-h-11 border-0 bg-tint">
        <ComboboxInput
          autoComplete="off"
          placeholder={placeholder}
          className="h-auto px-4 py-3 placeholder:text-ink-4"
          // Left with the list closed — emptying the field never opens it — so no close puts the name back: this does.
          onBlur={() => { if (!open) setDraft(null) }}
        />
        {!adder && clearLabel ? <ComboboxClear aria-label={clearLabel} /> : null}
        {/* `aria-labelledby={undefined}`: inside a Field, Base UI names the trigger with the FIELD's label, which beats
            aria-label (measured on the post wizard's Brand field). Unset, it says what it does. */}
        <ComboboxTrigger aria-label={triggerLabel} aria-labelledby={undefined} />
      </ComboboxInputGroup>
      <ComboboxContent>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList>
          {(key: string) => <ComboboxItem key={key} value={key}>{itemContent ? itemContent(key) : labelOf(key)}</ComboboxItem>}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
