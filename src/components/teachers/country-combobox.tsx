'use client'

// ── NATIONALITY PICKER (owner, 2026-10-08) ──────────────────────────────────────────────────────────────────────────
// "make the dropdowns in teacher.eno.vn searchable like other multi selection dropdowns": Nationality was a ui/select
// over ~240 countries with no search, and Tunisia sat at row 220, reached by thumb. It is now the house combobox for a
// long list typed on a phone (visa-cards' CheckpointCombobox, the post wizard's Brand field), with one difference: this
// list is CLOSED — the standard closed-list combobox. The value is always an ISO code from it, never typed text: typing
// only filters, and a country is chosen by tapping its row, or by moving to it with the arrow keys and pressing Enter.
// Only the Clear button empties it — a query that picked nothing, an emptied field included, gives way to the saved
// country's name when the person leaves.

import { useCallback, useMemo } from 'react'
import { useLanguage } from '@/context/language-context'
import { ALL_COUNTRY_CODES, COMMON_TEACHER_NATIONALITIES, countryName } from '@/lib/teachers/countries'
import { ClosedCombobox, matchesStarts, wordStarts } from '@/components/teachers/closed-combobox'

const COMMON: readonly string[] = COMMON_TEACHER_NATIONALITIES
const OTHERS = ALL_COUNTRY_CODES.filter((c) => !COMMON.includes(c))

// The word-start search (a query matches at the START of a word, never inside one — "ca" is not Ameri·ca) is
// closed-combobox.tsx's: wordStarts / matchesStarts.

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
  const matches = useCallback((code: string, query: string) => matchesStarts(starts[code], query), [starts])
  // The closed-list rules — typing only filters, Enter commits only a row the person moved to, only Clear clears — are
  // closed-combobox.tsx's, shared with the province, district and language pickers.
  return (
    <ClosedCombobox
      id={id}
      items={items}
      value={value}
      onChange={onChange}
      labelOf={labelOf}
      matches={matches}
      placeholder={tr('Type or choose a country', 'Nhập hoặc chọn quốc gia')}
      emptyText={tr('No country matches.', 'Không có quốc gia phù hợp.')}
      clearLabel={tr('Clear nationality', 'Xoá quốc tịch')}
      triggerLabel={tr('Open the country list', 'Mở danh sách quốc gia')}
    />
  )
}
