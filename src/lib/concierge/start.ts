import 'server-only'
import { speakLine, speakerFor, warmLine } from '@/lib/classroom/session-voice'
import type { Speaker } from '@/lib/classroom/turn-stream'
import { NATURAL_VOICE, type VoiceStyle } from '@/lib/classroom/pace'
import { logWarn } from '@/lib/log'
import { GUIDE_FACE, type GuideFaceConfig } from '@/lib/concierge/guide-assets'
import { EN_LINES, linesFor, type SpokenLanguage } from '@/lib/concierge/i18n'

/**
 * The concierge's one face and one voice (plan §3): eno's own guide, drawn in the visitor's browser (guide-assets.ts —
 * TalkingHead, in an eno shirt; owner, 2026-10-28), and a picker voice (voices.ts Zoey: Soniox's Sloane, the box's own
 * Zoey when Soniox cannot) — eno's guide, not a teacher. No vendor sees the face: it was Spatius's until 2026-10-28.
 */
export const CONCIERGE_VOICE = 'Zoey'

export const OPENING_LINE = EN_LINES.opening
/** The guide's voice in `lang` (Soniox's language for the line; only English has the box behind it). */
const styleFor = (lang: SpokenLanguage): VoiceStyle => (lang === 'en' ? NATURAL_VOICE : { ...NATURAL_VOICE, language: lang })
/** The opening line in the language the guide speaks. */
export const openingLine = (lang: SpokenLanguage = 'en'): string => linesFor(lang).opening

/**
 * The guide's voice for one turn's sentences, streamed — the classroom's: Soniox first, eno's own speech server when Soniox
 * cannot (session-voice.ts; owner, 2026-10-27: "soniox voice turn on", "box tts as fallback"). ⛔ ONE ATTEMPT on a busy
 * box (PLAN §10): its four slots are the classroom's paid lessons too — a full box leaves the guide in words (its captions).
 * Null when neither is set up.
 */
export function conciergeSpeaker(lang: SpokenLanguage = 'en'): Speaker | null {
  return speakerFor(CONCIERGE_VOICE, () => styleFor(lang), { busyRetry: false })
}

/** The face the window draws — static files of eno's own (nothing billed, no token). */
export function conciergeFace(): GuideFaceConfig {
  return GUIDE_FACE
}

/** How long a Start waits for the opening's voice before the box says it (the classroom's OPENING_WAIT_MS). */
const OPENING_WAIT_MS = 2_500

/** Start making the opening's voice now — the window's config read (its ✨ shows) comes well before a Start. Never throws. */
export function warmOpening(lang: SpokenLanguage = 'en'): void {
  warmLine(openingLine(lang), CONCIERGE_VOICE, styleFor(lang))
}

/**
 * The opening line's voice — base64 audio, or null when none could be made in time (the caption still shows it). Soniox
 * makes speech at about real time, so its line is made ahead (warmOpening) and kept 10 minutes (session-voice.ts); a Start
 * waits OPENING_WAIT_MS for it, then the box says it — one attempt (commit review, opus: a busy retry would queue it
 * against a paid lesson). Nothing is kept here: a line the box said is not the guide's voice for the next Start.
 */
export async function openingAudio(lang: SpokenLanguage = 'en'): Promise<string | null> {
  return speakLine(openingLine(lang), CONCIERGE_VOICE, styleFor(lang), OPENING_WAIT_MS, { busyRetry: false }).catch((e) => {
    logWarn('[concierge] opening voice failed', { status: (e as { status?: number }).status ?? null })
    return null
  })
}
