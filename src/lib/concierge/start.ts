import 'server-only'
import { spatiusConfig } from '@/lib/classroom/spatius'
import { speakLine } from '@/lib/classroom/session-voice'
import { localSpeechConfig, synthesizeStream } from '@/lib/classroom/speech-local'
import type { Speaker } from '@/lib/classroom/turn-stream'
import { NATURAL_VOICE } from '@/lib/classroom/pace'
import { LIBRARY_AVATARS } from '@/lib/classroom/library-avatars'
import { logWarn } from '@/lib/log'
import type { FaceConfig } from '@/components/classroom/session/avatar-stage'

/**
 * The concierge's one face and one voice (plan §3): a library avatar and a Phonon voice — eno's guide, not a teacher.
 * The face is Spatius's (animation only; it receives the avatar's voice, never the person's).
 */
export const CONCIERGE_VOICE = 'Zoey'
const CONCIERGE_AVATAR = LIBRARY_AVATARS.find((a) => a.label.en === 'Sophie') ?? LIBRARY_AVATARS[0]

export const OPENING_LINE = "Hi! I'm eno's guide. Tell me what you're looking for, and I'll show you."

/**
 * The guide's voice for one turn's sentences, streamed (the classroom's speech server). ⛔ ONE ATTEMPT on a busy server
 * (PLAN §10): its four slots are the classroom's paid lessons too — a full server leaves the guide in words (its captions).
 * Null when the speech server is not configured.
 */
export function conciergeSpeaker(): Speaker | null {
  const cfg = localSpeechConfig()
  if (!cfg) return null
  return (text, signal) => synthesizeStream(cfg, text, CONCIERGE_VOICE, NATURAL_VOICE, signal, fetch, { busyRetry: false })
}

/** The face the window draws — ids only (no token, nothing billed); null = voice-only. */
export function conciergeFace(): FaceConfig | null {
  const cfg = spatiusConfig()
  return cfg ? { avatarId: CONCIERGE_AVATAR.id, appId: cfg.appId, region: cfg.region } : null
}

/**
 * The opening line's voice, made ONCE per process (it never changes) — base64 MP3, or null when the speech server is
 * down or full (the caption still shows it). ⛔ One attempt, as for every concierge sentence (PLAN §10; commit review,
 * opus: speakLine's busy retry would have queued it against a paid lesson). A failure is retried by the next start, never
 * cached.
 */
let opening: Promise<string | null> | null = null
export function openingAudio(): Promise<string | null> {
  if (!opening) {
    opening = speakLine(OPENING_LINE, CONCIERGE_VOICE, NATURAL_VOICE, { busyRetry: false }).catch((e) => {
      logWarn('[concierge] opening voice failed', { status: (e as { status?: number }).status ?? null })
      opening = null
      return null
    })
  }
  return opening
}
