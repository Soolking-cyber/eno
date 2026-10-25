/**
 * The avatar's voice — Azure neural voices (src/lib/classroom/azure-speech.ts speaks with them). Client-safe: the picker
 * shows this list, and the API refuses any id that is not on it.
 *
 * ⛔ AN ALLOWLIST, NOT A FREE TEXT FIELD: the id goes into SSML on the server, so only these exact strings ever reach it.
 * The accents follow the teachers eno has (owner's teacher list, 2026-10: US, UK, Ireland, Canada, Australia, New Zealand,
 * South Africa, the Philippines) — a teacher's avatar can sound like them. Two per accent, a woman's and a man's.
 * ⚠️ Azure retires voices now and then: Phase 0 checked every id against the region's /voices/list, and
 * azure-speech.test.ts keeps the shape of the ids honest; a retired voice fails TTS loudly (never silently).
 */
export type Accent = 'US' | 'UK' | 'IE' | 'CA' | 'AU' | 'NZ' | 'ZA' | 'PH'

export type Voice = { id: string; name: string; accent: Accent; gender: 'f' | 'm' }

export const VOICES: readonly Voice[] = [
  { id: 'en-US-AvaMultilingualNeural', name: 'Ava', accent: 'US', gender: 'f' },
  { id: 'en-US-AndrewMultilingualNeural', name: 'Andrew', accent: 'US', gender: 'm' },
  { id: 'en-GB-SoniaNeural', name: 'Sonia', accent: 'UK', gender: 'f' },
  { id: 'en-GB-RyanNeural', name: 'Ryan', accent: 'UK', gender: 'm' },
  { id: 'en-IE-EmilyNeural', name: 'Emily', accent: 'IE', gender: 'f' },
  { id: 'en-IE-ConnorNeural', name: 'Connor', accent: 'IE', gender: 'm' },
  { id: 'en-CA-ClaraNeural', name: 'Clara', accent: 'CA', gender: 'f' },
  { id: 'en-CA-LiamNeural', name: 'Liam', accent: 'CA', gender: 'm' },
  { id: 'en-AU-NatashaNeural', name: 'Natasha', accent: 'AU', gender: 'f' },
  { id: 'en-AU-WilliamNeural', name: 'William', accent: 'AU', gender: 'm' },
  { id: 'en-NZ-MollyNeural', name: 'Molly', accent: 'NZ', gender: 'f' },
  { id: 'en-NZ-MitchellNeural', name: 'Mitchell', accent: 'NZ', gender: 'm' },
  { id: 'en-ZA-LeahNeural', name: 'Leah', accent: 'ZA', gender: 'f' },
  { id: 'en-ZA-LukeNeural', name: 'Luke', accent: 'ZA', gender: 'm' },
  { id: 'en-PH-RosaNeural', name: 'Rosa', accent: 'PH', gender: 'f' },
  { id: 'en-PH-JamesNeural', name: 'James', accent: 'PH', gender: 'm' },
]

export const ACCENT_LABEL: Record<Accent, { en: string; vi: string }> = {
  US: { en: 'American', vi: 'Mỹ' },
  UK: { en: 'British', vi: 'Anh' },
  IE: { en: 'Irish', vi: 'Ireland' },
  CA: { en: 'Canadian', vi: 'Canada' },
  AU: { en: 'Australian', vi: 'Úc' },
  NZ: { en: 'New Zealand', vi: 'New Zealand' },
  ZA: { en: 'South African', vi: 'Nam Phi' },
  PH: { en: 'Filipino', vi: 'Philippines' },
}

/** ISO-3166 alpha-2 (TeacherProfile.nationality) → the accent the avatar starts with. */
const ACCENT_BY_COUNTRY: Readonly<Record<string, Accent>> = {
  US: 'US', GB: 'UK', IE: 'IE', CA: 'CA', AU: 'AU', NZ: 'NZ', ZA: 'ZA', PH: 'PH',
}

export function voiceById(id: unknown): Voice | null {
  return typeof id === 'string' ? VOICES.find((v) => v.id === id) ?? null : null
}

/** The voice the picker starts on: the teacher's own accent where we have one, else American. The teacher can change it. */
export function defaultVoice(nationality: string | null | undefined): Voice {
  const accent = ACCENT_BY_COUNTRY[(nationality ?? '').toUpperCase()] ?? 'US'
  return VOICES.find((v) => v.accent === accent) ?? VOICES[0]
}

/** The voice's BCP-47 locale ('en-GB') — SSML's xml:lang. */
export function voiceLocale(voice: Voice): string {
  return voice.id.split('-').slice(0, 2).join('-')
}
