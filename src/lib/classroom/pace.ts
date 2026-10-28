import type { AgeBand } from './limits'

/**
 * THE AVATAR'S SPEAKING PACE (owner, 2026-10-26: "it also needs variable pace so if it talks to kids very loud clear and
 * slowly adults may adjust pace by saying talk more slowly etc"). Four steps of eno's own voice — Phonon's
 * `duration_delta`, MEASURED on the speech server 2026-10-26 (three seeds; every take checked by the server's own
 * recogniser): slowest 0.6 ≈ 18% slower (Phonon's floor — past 0.45 it gets no slower), gentle 0.15 ≈ 9% slower, natural,
 * quick −0.2 ≈ 12% faster; all of them stayed intelligible. infra/vn-node/classroom-speech/server.py maps the NAMES (a test
 * reads both lists) — never a number: the voice engine takes NaN without a word.
 *
 * A child hears the slowest voice, louder, with longer pauses between sentences, and never faster than 'gentle'; a teen or
 * an adult starts natural (gentle for a beginner, or when the teacher chose "Slow & simple") and moves one step each time
 * they ask ("talk more slowly", "nói chậm thôi" — the tutor's `pace`, tutor-ai.ts). The learner's choice is kept for their
 * next sessions (ClassroomLearner.voicePace), read back inside these bounds.
 */
export const VOICE_PACES = ['slowest', 'gentle', 'natural', 'quick'] as const
export type VoicePace = (typeof VOICE_PACES)[number]
/** What the tutor heard the learner ask for (tutor-ai.ts `pace`). */
export type PaceChange = 'slower' | 'faster'

const isChild = (b: AgeBand) => b === 'child-young' || b === 'child'
const isPace = (p: unknown): p is VoicePace => (VOICE_PACES as readonly unknown[]).includes(p)

/** The paces a learner may have, slowest first: a child never faster than 'gentle'; a teen or an adult any. */
export function paceRange(band: AgeBand): readonly VoicePace[] {
  return isChild(band) ? ['slowest', 'gentle'] : VOICE_PACES
}

/** Where a learner starts with no choice of their own: a child the slowest; a beginner (A1–A2), or a teacher's "Slow &
 *  simple" avatar, gentle; anyone else natural. */
export function defaultPace(band: AgeBand, level: string, teacherPace?: unknown): VoicePace {
  if (isChild(band)) return 'slowest'
  return level === 'A1' || level === 'A2' || teacherPace === 'slow' ? 'gentle' : 'natural'
}

/** A saved pace — or anything else — inside the learner's range: an unknown one is `fallback`; one past the range its edge. */
export function clampPace(pace: unknown, band: AgeBand, fallback: VoicePace): VoicePace {
  const range = paceRange(band)
  const p = isPace(pace) ? pace : fallback
  if (range.includes(p)) return p
  return VOICE_PACES.indexOf(p) < VOICE_PACES.indexOf(range[0]) ? range[0] : range[range.length - 1]
}

/** One step slower or faster inside the range — the same pace when there is no room that way. */
export function stepPace(pace: VoicePace, change: PaceChange, band: AgeBand): VoicePace {
  const range = paceRange(band)
  const i = range.indexOf(clampPace(pace, band, pace))
  return range[Math.max(0, Math.min(range.length - 1, change === 'slower' ? i - 1 : i + 1))]
}

/**
 * How the avatar's voice is made for this learner (the speech server's request): the pace; `loud` — a child's voice
 * louder, through the server's limiter (its headroom is only 1.6–8 dB, measured); the pause between the sentences of one
 * line (`gapMs` — 120 ms is the server's own), and BEFORE each streamed sentence after a reply's first (`pauseMs`,
 * turn-stream.ts — never after its last: that would only hold up the learner's turn). Phonon cannot go slower than ~18%:
 * for the young the pauses do the rest ("clear and slowly").
 * ⚡ Since 2026-10-27 the speech server trims Phonon's own ~0.7 s of silence at each sentence's edges to ~0.2 s
 * (server.py TRIM_*; owner: "need super fast response"): these pauses are now most of the breath between sentences —
 * ~0.25–0.4 s for a teen or an adult by pace, ~0.6–0.7 s for a child (it was ~0.85 s and ~1.0–1.1 s).
 */
/** `language`: what Soniox speaks the line in (an ISO code it takes) — absent = English, the classroom's. Only English has the
 *  box behind it (its voices are English): any other language is Soniox's or the words alone (session-voice.ts). */
export type VoiceStyle = { pace: VoicePace; loud: boolean; gapMs: number; pauseMs: number; language?: string }

const PAUSE_MS: Record<VoicePace, number> = { slowest: 200, gentle: 150, natural: 80, quick: 40 }

export function voiceStyle(band: AgeBand, pace: VoicePace): VoiceStyle {
  if (band === 'child-young') return { pace, loud: true, gapMs: 450, pauseMs: 500 }
  if (band === 'child') return { pace, loud: true, gapMs: 350, pauseMs: 400 }
  return { pace, loud: false, gapMs: 120, pauseMs: PAUSE_MS[pace] }
}

/** The natural voice for ONE line (a voice sample on the wizard): no streamed sentences, so no pause between them. */
export const NATURAL_VOICE: VoiceStyle = { pace: 'natural', loud: false, gapMs: 120, pauseMs: 0 }

/** For the tutor: the pace now, and which way it may still go (tutor-ai.ts). */
export function paceOptions(pace: VoicePace, band: AgeBand): { now: VoicePace; slower: boolean; faster: boolean } {
  return { now: pace, slower: stepPace(pace, 'slower', band) !== pace, faster: stepPace(pace, 'faster', band) !== pace }
}
