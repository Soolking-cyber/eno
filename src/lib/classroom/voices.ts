/**
 * The avatar's voice — Gradium Phonon catalogue voices, spoken by eno's own speech server on the VN box
 * (infra/vn-node/classroom-speech, src/lib/classroom/speech-local.ts). Client-safe: the picker shows this list, and the
 * API refuses any id that is not on it.
 *
 * ⛔ AN ALLOWLIST, NOT A FREE TEXT FIELD, AND IT IS THE SERVER'S LIST TOO: the speech server refuses any voice outside its
 * own `VOICES` (server.py) and its image carries only those (fetch_models.py) — voices.test.ts reads all three and fails
 * when they disagree. Adding a voice is all three files plus a rebuilt image.
 * ⚠️ US and UK only (owner, 2026-10-26: "dirt cheap", self-hosted). Azure had eight accents; the open voices that run on
 * the box's CPU have two. A teacher from elsewhere starts on the nearer of the two (below) and picks their own in the
 * wizard — no voice is labelled as anyone's own accent but its own.
 * The voices are Gradium's designed catalogue voices (Apache-2.0) — none is cloned from a real person.
 */
export type Accent = 'US' | 'UK'

export type Voice = { id: string; name: string; accent: Accent; gender: 'f' | 'm'; note?: 'young-learners' }

export const VOICES: readonly Voice[] = [
  { id: 'Harper', name: 'Harper', accent: 'US', gender: 'f' },
  { id: 'Hadley', name: 'Hadley', accent: 'US', gender: 'f' },
  { id: 'Trevor', name: 'Trevor', accent: 'US', gender: 'm' },
  { id: 'Preston', name: 'Preston', accent: 'US', gender: 'm' },
  { id: 'Zoey', name: 'Zoey', accent: 'US', gender: 'f', note: 'young-learners' },
  { id: 'Imogen', name: 'Imogen', accent: 'UK', gender: 'f' },
  { id: 'Maeve', name: 'Maeve', accent: 'UK', gender: 'f' },
  { id: 'Spencer', name: 'Spencer', accent: 'UK', gender: 'm' },
  { id: 'Toby', name: 'Toby', accent: 'UK', gender: 'm' },
]

export const ACCENT_LABEL: Record<Accent, { en: string; vi: string }> = {
  US: { en: 'American', vi: 'Mỹ' },
  UK: { en: 'British', vi: 'Anh' },
}

/** ISO-3166 alpha-2 (TeacherProfile.nationality) → the accent the picker starts on: British for the Commonwealth
 *  accents nearer to it, American for the rest. Only a starting point — the teacher picks. */
const ACCENT_BY_COUNTRY: Readonly<Record<string, Accent>> = {
  US: 'US', CA: 'US', PH: 'US',
  GB: 'UK', IE: 'UK', AU: 'UK', NZ: 'UK', ZA: 'UK',
}

export function voiceById(id: unknown): Voice | null {
  return typeof id === 'string' ? VOICES.find((v) => v.id === id) ?? null : null
}

/**
 * The Azure voices an avatar could be saved with before 2026-10-26 → the voice of the same gender and accent group
 * (ACCENT_BY_COUNTRY's grouping). Read-side only: what a SAVED avatar speaks with until the teacher next saves — a saved
 * "Ryan" never starts speaking as Harper (codex + opus, commit review). The API still accepts nothing but VOICES ids.
 */
const LEGACY_AZURE: Readonly<Record<string, string>> = {
  'en-US-AvaMultilingualNeural': 'Harper', 'en-US-AndrewMultilingualNeural': 'Trevor',
  'en-CA-ClaraNeural': 'Hadley', 'en-CA-LiamNeural': 'Preston',
  'en-PH-RosaNeural': 'Harper', 'en-PH-JamesNeural': 'Trevor',
  'en-GB-SoniaNeural': 'Imogen', 'en-GB-RyanNeural': 'Spencer',
  'en-IE-EmilyNeural': 'Maeve', 'en-IE-ConnorNeural': 'Toby',
  'en-AU-NatashaNeural': 'Imogen', 'en-AU-WilliamNeural': 'Spencer',
  'en-NZ-MollyNeural': 'Maeve', 'en-NZ-MitchellNeural': 'Toby',
  'en-ZA-LeahNeural': 'Imogen', 'en-ZA-LukeNeural': 'Spencer',
}

/** The voice a SAVED id speaks with: itself, else its pre-2026-10-26 Azure voice's counterpart, else null. */
export function voiceFor(id: unknown): Voice | null {
  return voiceById(id) ?? (typeof id === 'string' && Object.hasOwn(LEGACY_AZURE, id) ? voiceById(LEGACY_AZURE[id]) : null)
}

/** The voice the picker starts on: the accent above, else American. The teacher can change it. */
export function defaultVoice(nationality: string | null | undefined): Voice {
  const accent = ACCENT_BY_COUNTRY[(nationality ?? '').toUpperCase()] ?? 'US'
  return VOICES.find((v) => v.accent === accent) ?? VOICES[0]
}
