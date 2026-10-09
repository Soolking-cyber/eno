/**
 * THE LANGUAGES A TEACHER CAN PICK — what they teach under "Other language" and the other languages they speak
 * (teacher onboarding redesign, 2026-10-08). A CLOSED list, searched (language-combobox.tsx), so "Korean", "korean",
 * "Korea" and "한국어" become one answer schools can search, instead of free text split at commas.
 *
 * ⛔ STORED AS THE ENGLISH NAME, NEVER A CODE (plan review D8: "the languages column keeps readable names, no ISO-code
 * column in v1"): `languages` / `teachLanguages` hold "Korean", exactly what the old free-text box held, so the public
 * profile, the search text and the external matcher read what they always read. The English names are AUTHORED here —
 * not taken from Intl.DisplayNames('en'), whose wording moves between ICU versions ("Bengali" → "Bangla") and would
 * change what gets stored. The name SHOWN is the reader's own language, from Intl (languageLabel).
 * ⚠️ Not a `{ en, vi }` table on purpose: scripts/gen-ui-strings.mjs harvests such pairs into the machine-translation
 * catalogue, and a language's name comes from Intl in every UI language, never from MT.
 */
export type LanguageEntry = { code: string; name: string; also?: readonly string[] }

/** The languages most teachers in Vietnam teach or speak — listed first, in this order. */
const COMMON: readonly LanguageEntry[] = [
  { code: 'vi', name: 'Vietnamese', also: ['Tieng Viet'] },
  { code: 'en', name: 'English' },
  { code: 'zh', name: 'Chinese', also: ['Mandarin', 'Putonghua'] },
  { code: 'ko', name: 'Korean' },
  { code: 'ja', name: 'Japanese' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'es', name: 'Spanish', also: ['Castilian'] },
  { code: 'ru', name: 'Russian' },
  { code: 'th', name: 'Thai' },
]

/** Every other language, A–Z in English (the picker sorts them in the reader's language). */
const OTHERS: readonly LanguageEntry[] = [
  { code: 'af', name: 'Afrikaans' }, { code: 'sq', name: 'Albanian' }, { code: 'am', name: 'Amharic' },
  { code: 'ar', name: 'Arabic' }, { code: 'hy', name: 'Armenian' }, { code: 'az', name: 'Azerbaijani' },
  { code: 'eu', name: 'Basque' }, { code: 'be', name: 'Belarusian' }, { code: 'bn', name: 'Bengali', also: ['Bangla'] },
  { code: 'bs', name: 'Bosnian' }, { code: 'bg', name: 'Bulgarian' }, { code: 'my', name: 'Burmese', also: ['Myanmar'] },
  { code: 'yue', name: 'Cantonese' }, { code: 'ca', name: 'Catalan' }, { code: 'hr', name: 'Croatian' },
  { code: 'cs', name: 'Czech' }, { code: 'da', name: 'Danish' }, { code: 'nl', name: 'Dutch', also: ['Flemish'] },
  { code: 'et', name: 'Estonian' }, { code: 'fil', name: 'Filipino', also: ['Tagalog'] }, { code: 'fi', name: 'Finnish' },
  { code: 'ka', name: 'Georgian' }, { code: 'el', name: 'Greek' }, { code: 'gu', name: 'Gujarati' },
  { code: 'ha', name: 'Hausa' }, { code: 'he', name: 'Hebrew' }, { code: 'hi', name: 'Hindi' },
  { code: 'hu', name: 'Hungarian' }, { code: 'is', name: 'Icelandic' }, { code: 'ig', name: 'Igbo' },
  { code: 'id', name: 'Indonesian', also: ['Bahasa Indonesia'] }, { code: 'ga', name: 'Irish', also: ['Gaelic'] },
  { code: 'it', name: 'Italian' }, { code: 'kn', name: 'Kannada' }, { code: 'kk', name: 'Kazakh' },
  { code: 'km', name: 'Khmer', also: ['Cambodian'] }, { code: 'lo', name: 'Lao', also: ['Laotian'] },
  { code: 'lv', name: 'Latvian' }, { code: 'lt', name: 'Lithuanian' }, { code: 'mk', name: 'Macedonian' },
  { code: 'ms', name: 'Malay', also: ['Bahasa Melayu'] }, { code: 'ml', name: 'Malayalam' }, { code: 'mr', name: 'Marathi' },
  { code: 'mn', name: 'Mongolian' }, { code: 'ne', name: 'Nepali' }, { code: 'no', name: 'Norwegian' },
  { code: 'ps', name: 'Pashto' }, { code: 'fa', name: 'Persian', also: ['Farsi'] }, { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese' }, { code: 'pa', name: 'Punjabi' }, { code: 'ro', name: 'Romanian' },
  { code: 'sr', name: 'Serbian' }, { code: 'si', name: 'Sinhala', also: ['Sinhalese'] }, { code: 'sk', name: 'Slovak' },
  { code: 'sl', name: 'Slovenian' }, { code: 'so', name: 'Somali' }, { code: 'sw', name: 'Swahili' },
  { code: 'sv', name: 'Swedish' }, { code: 'ta', name: 'Tamil' }, { code: 'te', name: 'Telugu' },
  { code: 'tr', name: 'Turkish' }, { code: 'uk', name: 'Ukrainian' }, { code: 'ur', name: 'Urdu' },
  { code: 'uz', name: 'Uzbek' }, { code: 'cy', name: 'Welsh' }, { code: 'xh', name: 'Xhosa' },
  { code: 'yo', name: 'Yoruba' }, { code: 'zu', name: 'Zulu' },
]

export const LANGUAGES: readonly LanguageEntry[] = [...COMMON, ...OTHERS]
export const COMMON_LANGUAGE_CODES: readonly string[] = COMMON.map((l) => l.code)
const BY_CODE: ReadonlyMap<string, LanguageEntry> = new Map(LANGUAGES.map((l) => [l.code, l]))
const BY_NAME: ReadonlyMap<string, LanguageEntry> = new Map(LANGUAGES.map((l) => [l.name.toLowerCase(), l]))

/** The stored (English) name of a code. */
export const languageStoredName = (code: string): string => BY_CODE.get(code)?.name ?? code
/** The code a stored name stands for — "korean" and "Korean" both — or null for a name the list does not hold. */
export const languageCodeOf = (stored: string): string | null => BY_NAME.get(stored.trim().toLowerCase())?.code ?? null
export const languageEntry = (code: string): LanguageEntry | undefined => BY_CODE.get(code)

const upperFirst = (s: string, lang: string) => (s ? s.charAt(0).toLocaleUpperCase(lang) + s.slice(1) : s)

/** A language's name in the reader's language (Intl), capitalised; the English name when Intl has none. */
export function languageLabel(code: string, lang: string): string {
  try {
    const name = new Intl.DisplayNames([lang || 'en'], { type: 'language' }).of(code)
    if (name && name !== code) return upperFirst(name, lang)
  } catch { /* an engine with no display names: the English name below */ }
  return languageStoredName(code)
}

/** A STORED value as the reader sees it: a listed language in their language, anything else (old free text) as typed. */
export function storedLanguageLabel(stored: string, lang: string): string {
  const code = languageCodeOf(stored)
  return code ? languageLabel(code, lang) : stored
}

/** Every name a language answers to in a search: the reader's, the English name, its own (autonym) and the aliases. */
export function languageSearchNames(code: string, lang: string): string[] {
  const e = BY_CODE.get(code)
  if (!e) return [code]
  let autonym = ''
  try { autonym = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? '' } catch { /* none */ }
  return [...new Set([languageLabel(code, lang), e.name, autonym, ...(e.also ?? [])].filter(Boolean))]
}
