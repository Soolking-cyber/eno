'use client'

// ── NATIONALITY PICKER (owner, 2026-10-08) ──────────────────────────────────────────────────────────────────────────
// "make the dropdowns in teacher.eno.vn searchable like other multi selection dropdowns": Nationality was a ui/select
// over ~240 countries with no search, and Tunisia sat at row 220, reached by thumb. It is now the house combobox for a
// long list typed on a phone (visa-cards' CheckpointCombobox, the post wizard's Brand field), with one difference: this
// list is CLOSED — the standard closed-list combobox. The value is always an ISO code from it, never typed text: typing
// only filters, and a country is chosen by tapping its row, or by moving to it with the arrow keys and pressing Enter.
// Only the Clear button empties it — a query that picked nothing, an emptied field included, gives way to the saved
// country's name when the person leaves.

import { useCallback, useMemo, useState } from 'react'
import { useLanguage } from '@/context/language-context'
import {
  Combobox, ComboboxClear, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxInputGroup, ComboboxItem, ComboboxList,
  ComboboxTrigger,
} from '@/components/ui/combobox'
import { ALL_COUNTRY_CODES, COMMON_TEACHER_NATIONALITIES, countryName } from '@/lib/teachers/countries'
import { fold } from '@/lib/fold'

const COMMON: readonly string[] = COMMON_TEACHER_NATIONALITIES
const OTHERS = ALL_COUNTRY_CODES.filter((c) => !COMMON.includes(c))

/** Folded (case, accents, đ — src/lib/fold.ts) and cut into words at anything that is not a letter, mark or digit. */
const words = (s: string) => fold(s).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean)
/** A query as the search reads it: its words run together — "new zea" is "newzea", "cote d'iv" is "cotediv". */
const searchKey = (s: string) => words(s).join('')
/**
 * ⛔ A QUERY MATCHES AT THE START OF A WORD, never inside one (gate review, 2026-10-08). Each name yields one key per
 * word, running from that word to the name's end: "Côte d’Ivoire" → cotedivoire, divoire, ivoire. As a plain substring
 * "ca" found the US (Ameri·ca) and "in" the Philippines (Filip·in·o).
 */
const wordStarts = (s: string) => { const w = words(s); return w.map((_, i) => w.slice(i).join('')) }

/**
 * What people type for the nationalities most teachers hold that no country name contains: the demonym (the field is
 * "Nationality") or the everyday short name — without these "uk" found only Ukraine. Searched, never shown; only the
 * common block, where nearly every teacher is. English, so searchable in every language, like the English names.
 */
const ALIASES: Partial<Record<string, readonly string[]>> = {
  US: ['USA', 'America', 'American'],
  GB: ['UK', 'Britain', 'British', 'England', 'English', 'Scotland', 'Scottish', 'Wales', 'Welsh'],
  CA: ['Canadian'], AU: ['Australian'], NZ: ['New Zealander'], IE: ['Irish'], ZA: ['South African'],
  PH: ['Filipino', 'Filipina'], VN: ['Vietnamese'], IN: ['Indian'], FR: ['French'], KR: ['Korean'], JP: ['Japanese'],
  CN: ['Chinese'],
}
/**
 * ⚠️ VIETNAMESE ONLY (gate review, 2026-10-08): "Mỹ" is what Vietnamese call the US (its name there is "Hoa Kỳ"), but it
 * folds to "my" — searched in English it put the US above Myanmar for "my".
 */
const ALIASES_VI: Partial<Record<string, readonly string[]>> = { US: ['Mỹ'] }

/**
 * The list in `lang`: the common nationalities first, as before, then every other country A–Z by its name in that
 * language (it was ISO-code order — "Andorra, United Arab Emirates, Afghanistan…"). Each country is searchable by that
 * name, by its English name in any other language (a Vietnamese page still finds "Germany"), and by its aliases.
 */
function countryList(lang: string) {
  const labels: Record<string, string> = {}
  const starts: Record<string, readonly string[]> = {}
  for (const c of ALL_COUNTRY_CODES) {
    labels[c] = countryName(c, lang)
    const names = [
      labels[c], ...(lang === 'en' ? [] : [countryName(c, 'en')]), ...(ALIASES[c] ?? []),
      ...(lang === 'vi' ? ALIASES_VI[c] ?? [] : []),
    ]
    starts[c] = [...new Set(names.flatMap(wordStarts))]
  }
  const byName = new Intl.Collator(lang).compare
  return { labels, starts, items: [...COMMON, ...OTHERS.slice().sort((a, b) => byName(labels[a], labels[b]))] }
}

export function CountryCombobox({ id, value, onChange }: {
  /** Lands on the <input> — Base UI hands the root's id down to it — so a `<label htmlFor>` both names and focuses it. */
  id?: string
  /** An ISO 3166-1 alpha-2 code, or '' for none. */
  value: string
  onChange: (code: string) => void
}) {
  const { tr, lang } = useLanguage()
  const { labels, starts, items } = useMemo(() => countryList(lang), [lang])
  const labelOf = useCallback((code: string) => labels[code] ?? code, [labels])
  // Base UI only calls this with a non-empty query — and, while the field still shows the saved country unchanged, not
  // at all, so opening a filled field lists every country rather than just that one. A query of punctuation alone ("-")
  // has an empty key and lists everything, as an empty one does.
  const matches = useCallback((code: string, query: string) => {
    const q = searchKey(query)
    return !q || (starts[code]?.some((s) => s.startsWith(q)) ?? false)
  }, [starts])
  // What the person is typing; null while the field shows the saved country's name. Held here rather than left to Base
  // UI so that leaving the field — by closing the list, or by blurring it closed — always puts that name back.
  const [draft, setDraft] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  return (
    <Combobox
      id={id}
      items={items}
      value={value || null}
      onValueChange={(next, details) => {
        // ⛔ ONLY THE CLEAR BUTTON CLEARS (gate review, 2026-10-08). Base UI also clears when the text is deleted and on
        // Escape over a closed list; here both keep the saved country, whose name comes back when the person leaves.
        if (next === null && details.reason !== 'clear-press') { details.cancel(); return }
        onChange(next ?? '')
      }}
      inputValue={draft ?? labelOf(value)}
      onInputValueChange={(text, details) => setDraft(details.reason === 'input-change' ? text : null)}
      open={open}
      onOpenChange={(next, details) => {
        // Enter with no row highlighted KEEPS THE LIST OPEN (gate review, 2026-10-08), so the matches stay in view to
        // tap. Base UI closes it — its only close with reason 'none' — and the closed field then went back to the saved
        // name: Enter looked like it did nothing and threw the query away.
        if (!next && details.reason === 'none' && details.event instanceof KeyboardEvent && details.event.key === 'Enter') {
          details.cancel()
          return
        }
        setOpen(next)
        if (!next) setDraft(null)
      }}
      itemToStringLabel={labelOf}
      filter={matches}
      // ⛔ NO autoHighlight (gate review, 2026-10-08). Typing only filters; nothing is highlighted until the person moves to
      // a row with the arrow keys or points at one, so Enter commits only a row they chose. Three rounds of letting Enter
      // infer a choice — the first match, then the one match — each found a new way to save a country nobody picked:
      // "austr" saved Australia over Austria, "ir" Ireland over Iran, a lone "-" the US.
      autoHighlight={false}
    >
      {/* The form's filled-input idiom (ui/input `filled`, as on the post wizard's Brand field): tint, no border, the
          soft focus ring. `min-h-11` instead of the group's fixed h-11, and the input's own py-3, so the field is
          ui/input's exact 44px box beside "Full name" and still grows when the OS enlarges text. */}
      <ComboboxInputGroup className="h-auto min-h-11 border-0 bg-tint">
        <ComboboxInput
          autoComplete="off"
          placeholder={tr('Type or choose a country', 'Nhập hoặc chọn quốc gia')}
          className="h-auto px-4 py-3 placeholder:text-ink-4"
          // Left with the list closed — emptying the field never opens it — so no close puts the name back: this does.
          // (While it is open, the close does it; a blur into the open list itself must not reset the query.)
          onBlur={() => { if (!open) setDraft(null) }}
        />
        <ComboboxClear aria-label={tr('Clear nationality', 'Xoá quốc tịch')} />
        {/* `aria-labelledby={undefined}`: inside a Field with a FieldLabel, Base UI names the trigger with the FIELD's
            label, which beats aria-label (measured on the post wizard's Brand field). Unset, it says what it does. */}
        <ComboboxTrigger aria-label={tr('Open the country list', 'Mở danh sách quốc gia')} aria-labelledby={undefined} />
      </ComboboxInputGroup>
      <ComboboxContent>
        <ComboboxEmpty>{tr('No country matches.', 'Không có quốc gia phù hợp.')}</ComboboxEmpty>
        <ComboboxList>
          {(code: string) => <ComboboxItem key={code} value={code}>{labels[code] ?? code}</ComboboxItem>}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
