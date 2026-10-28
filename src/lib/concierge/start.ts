import 'server-only'
import { spatiusConfig } from '@/lib/classroom/spatius'
import { speakLine, speakerFor, warmLine } from '@/lib/classroom/session-voice'
import type { Speaker } from '@/lib/classroom/turn-stream'
import { NATURAL_VOICE } from '@/lib/classroom/pace'
import { LIBRARY_AVATARS } from '@/lib/classroom/library-avatars'
import { logWarn } from '@/lib/log'
import type { FaceConfig } from '@/components/classroom/session/avatar-stage'

/**
 * The concierge's one face and one voice (plan §3): a library avatar and a picker voice (voices.ts Zoey: Soniox's Sloane,
 * the box's own Zoey when Soniox cannot) — eno's guide, not a teacher.
 * The face is Spatius's (animation only; it receives the avatar's voice, never the person's).
 */
export const CONCIERGE_VOICE = 'Zoey'
const CONCIERGE_AVATAR = LIBRARY_AVATARS.find((a) => a.label.en === 'Sophie') ?? LIBRARY_AVATARS[0]

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

/** The face the window draws — ids only (no token, nothing billed); null = voice-only. */
export function conciergeFace(): FaceConfig | null {
  const cfg = spatiusConfig()
  return cfg ? { avatarId: CONCIERGE_AVATAR.id, appId: cfg.appId, region: cfg.region } : null
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
