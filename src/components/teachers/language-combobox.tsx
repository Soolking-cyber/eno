'use client'

// ── LANGUAGE PICKER (teacher onboarding redesign, 2026-10-08) ────────────────────────────────────────────────────────
// "Which language?" under Other language, and "Other languages you speak": a searchable CLOSED list (language-list.ts)
// that ADDS each pick to the teacher's list, shown beside it as removable chips with a visible count ("2/8"). The old
// box was free text split at commas — "Korean, korean,Korea" were three languages and a typo was a fourth.
// ⚠️ An ADDER, not Base UI's multiple-selection mode: the pick goes through the one closed-list combobox
// (closed-combobox.tsx — typing only filters, Enter commits only a row the person moved to), and the chosen languages
// live in the form's list, never in the field. A stored name the list does not hold (the old free text) is kept and
// shown as typed, so nothing a teacher wrote disappears on load — they remove it themselves.

import { useCallback, useMemo } from 'react'
import { useLanguage } from '@/context/language-context'
import { RemovableBadge } from '@/components/ui/badge'
import { ClosedCombobox, matchesStarts, startsOf } from '@/components/teachers/closed-combobox'
import {
  COMMON_LANGUAGE_CODES, LANGUAGES, languageCodeOf, languageLabel, languageSearchNames, languageStoredName,
  storedLanguageLabel,
} from '@/components/teachers/language-list'

const NONE: readonly string[] = []

/** Inside a ui/field: its label names the search field and its FieldDescription / FieldError describe it. */
export function LanguagePicker({ id, value, onChange, max, exclude = NONE }: {
  /** Lands on the search field's <input> — a `<label htmlFor>` names and focuses it. */
  id: string
  /** The stored names (English), in the order added. */
  value: readonly string[]
  onChange: (next: string[]) => void
  max: number
  /** Codes not offered here (English under "Other language"; the taught languages under "languages you speak"). */
  exclude?: readonly string[]
}) {
  const { tr, lang } = useLanguage()
  const chosen = useMemo(() => new Set(value.map((v) => languageCodeOf(v)).filter((c): c is string => !!c)), [value])
  const { items, starts } = useMemo(() => {
    const skip = new Set([...exclude, ...chosen])
    const byName = new Intl.Collator(lang).compare
    const common = COMMON_LANGUAGE_CODES.filter((c) => !skip.has(c))
    const others = LANGUAGES.map((l) => l.code).filter((c) => !skip.has(c) && !COMMON_LANGUAGE_CODES.includes(c))
      .sort((a, b) => byName(languageLabel(a, lang), languageLabel(b, lang)))
    const s: Record<string, readonly string[]> = {}
    for (const c of [...common, ...others]) s[c] = startsOf(languageSearchNames(c, lang))
    return { items: [...common, ...others], starts: s }
  }, [exclude, chosen, lang])
  const labelOf = useCallback((code: string) => languageLabel(code, lang), [lang])
  const matches = useCallback((code: string, query: string) => matchesStarts(starts[code], query), [starts])
  const full = value.length >= max

  return (
    <div className="space-y-3">
      <ClosedCombobox
        id={id}
        adder
        items={items}
        value=""
        onChange={(code) => { if (code && !full) onChange([...value, languageStoredName(code)]) }}
        labelOf={labelOf}
        matches={matches}
        placeholder={full ? tr('That is the most you can add — remove one to add another', 'Đã đạt số lượng tối đa — xoá một ngôn ngữ để thêm') : tr('Type or choose a language', 'Nhập hoặc chọn ngôn ngữ')}
        emptyText={tr('No language matches.', 'Không có ngôn ngữ phù hợp.')}
        triggerLabel={tr('Open the language list', 'Mở danh sách ngôn ngữ')}
        disabled={full}
      />
      {value.length > 0 && (
        // gap-y-5: each ✕ reaches 10px above and below its chip (RemovableBadge), so wrapped rows keep 20px apart.
        <ul className="flex flex-wrap items-center gap-x-1.5 gap-y-5" aria-label={tr('Chosen languages', 'Ngôn ngữ đã chọn')}>
          {value.map((v) => {
            const label = storedLanguageLabel(v, lang)
            return (
              <li key={v}>
                <RemovableBadge
                  label={label}
                  removeLabel={`${tr('Remove', 'Xoá')} ${label}`}
                  onRemove={() => onChange(value.filter((x) => x !== v))}
                />
              </li>
            )
          })}
        </ul>
      )}
      {/* The visible count: a limit read only when it is hit is a limit met by surprise. */}
      <p className="text-xs text-muted-foreground" aria-live="polite">{value.length}/{max}</p>
    </div>
  )
}
