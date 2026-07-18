export type Language =
  | 'en'
  | 'vi'
  | 'zh-Hans'
  | 'ko'
  | 'ja'
  | 'ru'
  | 'km'
  | 'ms'
  | 'th'
  | 'fr'
  | 'hi'

export const LANGUAGES: ReadonlyArray<{ code: Language; label: string; native: string; name: string; locale: string }> = [
  { code: 'en', label: 'EN', native: 'English', name: 'English', locale: 'en-GB' },
  { code: 'vi', label: 'VI', native: 'Tiếng Việt', name: 'Vietnamese', locale: 'vi-VN' },
  { code: 'zh-Hans', label: 'ZH', native: '中文', name: 'Simplified Chinese', locale: 'zh-Hans-CN' },
  { code: 'ko', label: 'KO', native: '한국어', name: 'Korean', locale: 'ko-KR' },
  { code: 'ja', label: 'JA', native: '日本語', name: 'Japanese', locale: 'ja-JP' },
  { code: 'ru', label: 'RU', native: 'Русский', name: 'Russian', locale: 'ru-RU' },
  { code: 'km', label: 'KM', native: 'ភាសាខ្មែរ', name: 'Khmer', locale: 'km-KH' },
  { code: 'ms', label: 'MS', native: 'Bahasa Melayu', name: 'Malay', locale: 'ms-MY' },
  { code: 'th', label: 'TH', native: 'ไทย', name: 'Thai', locale: 'th-TH' },
  { code: 'fr', label: 'FR', native: 'Français', name: 'French', locale: 'fr-FR' },
  { code: 'hi', label: 'HI', native: 'हिन्दी', name: 'Hindi', locale: 'hi-IN' },
]

export const LANGUAGE_CODES = LANGUAGES.map(({ code }) => code) as Language[]

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && LANGUAGE_CODES.includes(value as Language)
}

export function languageName(language: Language): string {
  return LANGUAGES.find(({ code }) => code === language)?.name || 'English'
}

export function localeForLanguage(language: Language): string {
  return LANGUAGES.find(({ code }) => code === language)?.locale || 'en-GB'
}

export function matchDeviceLanguage(raw: string): Language | null {
  const normalized = raw.trim().toLowerCase()
  if (!normalized) return null
  if (normalized.startsWith('zh')) return 'zh-Hans'
  const primary = normalized.split('-')[0]
  return LANGUAGES.find(({ code }) => !code.startsWith('zh') && code === primary)?.code || null
}
