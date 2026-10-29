import 'server-only'
import { speakLine, speakerFor, warmLine } from '@/lib/classroom/session-voice'
import type { Speaker } from '@/lib/classroom/turn-stream'
import { NATURAL_VOICE, type VoiceStyle } from '@/lib/classroom/pace'
import { logWarn } from '@/lib/log'
import { GUIDE_FACE, type GuideFaceConfig } from '@/lib/concierge/guide-assets'
import { EN_LINES, linesFor, type SpokenLanguage } from '@/lib/concierge/i18n'

/**
 * The concierge's one face and one voice (plan §3): eno's own guide, drawn in the visitor's browser (guide-assets.ts —
 * TalkingHead, in an eno shirt; owner, 2026-10-28), and a picker voice (voices.ts Zoey: in English the box's own Zoey FIRST,
 * Soniox's Sloane when the box cannot; Soniox's Sloane in every other language — owner, 2026-10-29: "priority english and
 * vietnamese rest use soniox") — eno's guide, not a teacher. No vendor sees the face: it was Spatius's until 2026-10-28.
 */
export const CONCIERGE_VOICE = 'Zoey'

export const OPENING_LINE = EN_LINES.opening
/** The guide's voice in `lang` (Soniox's language for the line; only English has the box — the box speaks it first). */
const styleFor = (lang: SpokenLanguage): VoiceStyle => (lang === 'en' ? NATURAL_VOICE : { ...NATURAL_VOICE, language: lang })
/** The opening line in the language the guide speaks. */
export const openingLine = (lang: SpokenLanguage = 'en'): string => linesFor(lang).opening

/**
 * How the guide asks for its voice (session-voice.ts BoxOpts): `first` — its English on eno's own speech server FIRST, Soniox
 * for what the box cannot say (owner, 2026-10-29: "priority english and vietnamese rest use soniox"; Vietnamese has no
 * open voice that passed its licence and the box's CPU yet). ⛔ ONE ATTEMPT on the box (PLAN §10), as a GUIDE line: the
 * server answers busy at once and lends the guide only its share of the voices — the rest are the classroom's paid lessons'.
 */
const GUIDE_VOICE = { busyRetry: false, first: true } as const

/**
 * The guide's voice for one turn's sentences, streamed (session-voice.ts guideSpeaker): English on the box, a reply the box
 * cannot take moving to Soniox for its remaining sentences; every other language on Soniox, as the classroom's. Null when
 * neither is set up.
 */
export function conciergeSpeaker(lang: SpokenLanguage = 'en'): Speaker | null {
  return speakerFor(CONCIERGE_VOICE, () => styleFor(lang), GUIDE_VOICE)
}

/** The face the window draws — static files of eno's own (nothing billed, no token). */
export function conciergeFace(): GuideFaceConfig {
  return GUIDE_FACE
}

/** How long a Start waits for the opening's voice (the classroom's OPENING_WAIT_MS). */
const OPENING_WAIT_MS = 2_500

/** Start making the opening's voice now — the window's config read (its ✨ shows) comes well before a Start. Never throws. */
export function warmOpening(lang: SpokenLanguage = 'en'): void {
  warmLine(openingLine(lang), CONCIERGE_VOICE, styleFor(lang), GUIDE_VOICE)
}

/**
 * The opening line's voice — base64 audio, or null when none could be made in time (the caption still shows it). It is
 * made ahead (warmOpening): in English on the box, and KEPT there (session-voice.ts guideLine — the same words for every
 * visitor), so a Start finds it at once; Soniox makes it only when the box cannot. In the other languages Soniox makes it
 * ahead and keeps it 10 minutes. A Start waits OPENING_WAIT_MS at most.
 */
export async function openingAudio(lang: SpokenLanguage = 'en'): Promise<string | null> {
  return speakLine(openingLine(lang), CONCIERGE_VOICE, styleFor(lang), OPENING_WAIT_MS, GUIDE_VOICE).catch((e) => {
    logWarn('[concierge] opening voice failed', { status: (e as { status?: number }).status ?? null })
    return null
  })
}
