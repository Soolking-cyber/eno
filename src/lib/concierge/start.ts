import 'server-only'
import { speakLine, speakerFor, warmLine } from '@/lib/classroom/session-voice'
import type { Speaker } from '@/lib/classroom/turn-stream'
import { NATURAL_VOICE } from '@/lib/classroom/pace'
import { logWarn } from '@/lib/log'
import { GUIDE_FACE, type GuideFaceConfig } from '@/lib/concierge/guide-assets'

/**
 * The concierge's one face and one voice (plan §3): eno's own guide, drawn in the visitor's browser (guide-assets.ts —
 * TalkingHead, in an eno shirt; owner, 2026-10-28), and a picker voice (voices.ts Zoey: Soniox's Sloane, the box's own
 * Zoey when Soniox cannot) — eno's guide, not a teacher. No vendor sees the face: it was Spatius's until 2026-10-28.
 */
export const CONCIERGE_VOICE = 'Zoey'

export const OPENING_LINE = "Hi! I'm eno's guide. Tell me what you're looking for, and I'll show you."

/**
 * The guide's voice for one turn's sentences, streamed — the classroom's: Soniox first, eno's own speech server when Soniox
 * cannot (session-voice.ts; owner, 2026-10-27: "soniox voice turn on", "box tts as fallback"). ⛔ ONE ATTEMPT on a busy
 * box (PLAN §10): its four slots are the classroom's paid lessons too — a full box leaves the guide in words (its captions).
 * Null when neither is set up.
 */
export function conciergeSpeaker(): Speaker | null {
  return speakerFor(CONCIERGE_VOICE, () => NATURAL_VOICE, { busyRetry: false })
}

/** The face the window draws — static files of eno's own (nothing billed, no token). */
export function conciergeFace(): GuideFaceConfig {
  return GUIDE_FACE
}

/** How long a Start waits for the opening's voice before the box says it (the classroom's OPENING_WAIT_MS). */
const OPENING_WAIT_MS = 2_500

/** Start making the opening's voice now — the window's config read (its ✨ shows) comes well before a Start. Never throws. */
export function warmOpening(): void {
  warmLine(OPENING_LINE, CONCIERGE_VOICE, NATURAL_VOICE)
}

/**
 * The opening line's voice — base64 audio, or null when none could be made in time (the caption still shows it). Soniox
 * makes speech at about real time, so its line is made ahead (warmOpening) and kept 10 minutes (session-voice.ts); a Start
 * waits OPENING_WAIT_MS for it, then the box says it — one attempt (commit review, opus: a busy retry would queue it
 * against a paid lesson). Nothing is kept here: a line the box said is not the guide's voice for the next Start.
 */
export async function openingAudio(): Promise<string | null> {
  return speakLine(OPENING_LINE, CONCIERGE_VOICE, NATURAL_VOICE, OPENING_WAIT_MS, { busyRetry: false }).catch((e) => {
    logWarn('[concierge] opening voice failed', { status: (e as { status?: number }).status ?? null })
    return null
  })
}
