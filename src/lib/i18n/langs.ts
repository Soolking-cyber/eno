// Single isomorphic source of truth for the supported-language roster — safe to
// import from client components, server code, and API routes alike (no React,
// no 'server-only'). Previously triplicated across language-context.tsx,
// lib/translate.ts, and api/profile/locale/route.ts, which drifted by hand.
//
// English (default/source) + Vietnamese (home market) + the top inbound-tourist
// languages to Vietnam by 2025 arrivals (GSO): China→Simplified (single Chinese
// option, covers the #1 market; Taiwan/HK visitors are routed here too), then
// Korea, Japan, Russia, Cambodia, Malaysia, Thailand, France, with Hindi held
// for India (which otherwise skews English).
export type Language =
  | 'en' | 'vi' | 'zh-Hans' | 'ko' | 'ja' | 'ru' | 'km' | 'ms' | 'th' | 'fr' | 'hi'

// Server-side alias (lib/translate.ts historically named the type `Lang`).
export type Lang = Language

// Language-picker labels are proper nouns/native names, not translatable copy.
export const LANGUAGES: { code: Language; label: string; native: string }[] = [
  { code: 'en', label: 'EN', native: 'English' },
  { code: 'vi', label: 'VI', native: 'Tiếng Việt' },
  { code: 'zh-Hans', label: 'ZH', native: '中文' },
  { code: 'ko', label: 'KO', native: '한국어' },
  { code: 'ja', label: 'JA', native: '日本語' },
  { code: 'ru', label: 'RU', native: 'Русский' },
  { code: 'km', label: 'KM', native: 'ភាសាខ្មែរ' },
  { code: 'ms', label: 'MS', native: 'Bahasa Melayu' },
  { code: 'th', label: 'TH', native: 'ไทย' },
  { code: 'fr', label: 'FR', native: 'Français' },
  { code: 'hi', label: 'HI', native: 'हिन्दी' },
]

// Flat code list, derived so it can never drift from the roster above.
export const LANGS: Lang[] = LANGUAGES.map((l) => l.code)

/**
 * The Intl locale for DATES and RELATIVE TIMES in a UI language — month names and "ago" are words, and
 * a hardcoded `lang === 'vi' ? 'vi-VN' : 'en-US'` printed them in English for all nine
 * machine-translated languages.
 *
 * ⚠️ EN AND VI ARE PASSED IN, NOT DECIDED HERE: call sites already disagree on English (`en-US` in
 * some, `en-GB` in others) and that output is shipped and tested, so each keeps its own. This map only
 * decides the nine others. (Thai prints the Buddhist-era year — 2569 — which is what a Thai reader
 * expects.) Number grouping is NOT routed through this on purpose: digits are not words, and the
 * money format is owned by src/lib/vnd.ts.
 */
const INTL_LOCALE: Record<string, string> = {
  'zh-Hans': 'zh-CN', ko: 'ko-KR', ja: 'ja-JP', ru: 'ru-RU', km: 'km-KH', ms: 'ms-MY', th: 'th-TH', fr: 'fr-FR', hi: 'hi-IN',
}
export function intlLocale(lang: string | null | undefined, en = 'en-US', vi = 'vi-VN'): string {
  if (lang === 'vi') return vi
  return (lang && INTL_LOCALE[lang]) || en
}
