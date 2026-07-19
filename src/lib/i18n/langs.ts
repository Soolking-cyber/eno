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
