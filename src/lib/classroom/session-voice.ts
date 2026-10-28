import 'server-only'
import { logWarn } from '@/lib/log'
import { SpeechError } from './azure-speech'
import { localSpeechConfig, synthesize, synthesizeStream } from './speech-local'
import { sonioxConfig } from './soniox'
import { sonioxSpeakLine, sonioxSpeakStream } from './soniox-tts'
import type { Speaker } from './turn-stream'
import { VOICES, voiceFor, type Voice } from './voices'
import type { VoiceStyle } from './pace'

/**
 * THE AVATAR'S VOICE: SONIOX FIRST, THE BOX STANDS BY (owner, 2026-10-27: "soniox voice turn on", "box tts as fallback").
 * Each line goes to Soniox (soniox-tts.ts) in the voice's Soniox voice (voices.ts `soniox`); when Soniox cannot start it —
 * not set up, refused, out of credit, or no first sound in time — eno's own speech server on the VN box speaks it in the
 * voice's own Phonon voice (speech-local.ts). A Soniox failure sends EVERY line to the box for SONIOX_REST_MS (a dead
 * Soniox must not cost each sentence its wait), then Soniox is tried again. A line that fails part-way through is not
 * re-spoken by the box (turn-stream.ts marks that part audio-failed; the captions carry it).
 */

/** How long a voice line may wait for Soniox's first sound before the box takes it, when the box can — Soniox's warm first
 *  sound measured 0.55–0.8 s from Vietnam (US host, 2026-10-27), a cold socket's 1.3–1.9 s. */
export const SONIOX_FIRST_SOUND_MS = 3_000
/**
 * A WHOLE line (the opening, a voice sample) — Soniox makes speech at about real time (measured 2026-10-27: a 176-character,
 * 10-second line took 8.1–8.7 s to finish), so a whole line is made AHEAD where it can be (warmLine: the session's opening,
 * while the intro is up) and kept LINE_KEEP_MS. `waitMs`: how long a caller waits for it before the box says it instead —
 * slow is not failed: the line goes on being made for next time, and Soniox is not rested for it.
 */
const LINE_MAKE_MS = 30_000
const LINE_KEEP_MS = 10 * 60_000
const LINE_KEEP_MAX = 200
const madeLines = new Map<string, { at: number; made: Promise<Buffer> }>()
function sonioxLine(text: string, v: Voice, style: VoiceStyle): Promise<Buffer> {
  const key = `${v.soniox}|${style.pace}|${style.loud ? 1 : 0}|${text}`
  const now = Date.now()
  // Kept LINE_KEEP_MS and no longer (review, codex): an opening can carry what a learner said — expired lines are let go.
  for (const [k, e] of madeLines) if (now - e.at >= LINE_KEEP_MS) madeLines.delete(k)
  const kept = madeLines.get(key)
  if (kept && now - kept.at < LINE_KEEP_MS) return kept.made
  const made = sonioxSpeakLine(text, v.soniox, style, LINE_MAKE_MS)
  madeLines.set(key, { at: now, made })
  // Let go at LINE_KEEP_MS whether or not anything asks again (review, codex): unref'd — it never holds the process open.
  setTimeout(() => { if (madeLines.get(key)?.made === made) madeLines.delete(key) }, LINE_KEEP_MS).unref?.()
  // A line that failed is not kept — the next ask tries again.
  made.catch(() => { if (madeLines.get(key)?.made === made) madeLines.delete(key) })
  if (madeLines.size > LINE_KEEP_MAX) madeLines.delete(madeLines.keys().next().value!)
  return made
}

/** Start making a whole line now, for an ask that is about to come (session-start.ts warmOpening). Never throws. */
export function warmLine(text: string, voice: string, style: VoiceStyle): void {
  if (!sonioxUp() || !text) return
  sonioxLine(text, voiceOf(voice), style).catch((e) => logWarn('[classroom] soniox line made ahead failed', { status: (e as { status?: number }).status ?? null }))
}

/** For the tests: nothing made ahead. */
export function forgetLines() { madeLines.clear() }
/** After a Soniox failure, the box speaks for this long before Soniox is tried again. */
export const SONIOX_REST_MS = 60_000
let sonioxRestUntil = 0

/** For the tests: Soniox tried again at once. */
export function resetSonioxRest() { sonioxRestUntil = 0; slowLines = 0 }

function sonioxUp(): boolean {
  return !!sonioxConfig() && Date.now() >= sonioxRestUntil
}
/**
 * A failure that says Soniox itself is in trouble — the key or credit refused (401/402/403), its server (5xx), the socket
 * (502) or no sound in time (504) — rests it for everyone; one line refused on its own (a 400, a passing 429) falls back
 * for that line only (review, codex + opus: one refused line moved every session to the box voice for a minute).
 */
function sonioxFailed(e: unknown, what: string) {
  const status = (e as { status?: number }).status ?? 502
  // One SLOW line (504: no first sound in time) is not an outage — two in a row are (review, opus: a cold socket's one slow
  // line moved every session to the box voice).
  slowLines = status === 504 ? slowLines + 1 : 0
  const rest = status === 401 || status === 402 || status === 403 || (status >= 500 && status !== 504) || slowLines >= 2
  if (rest) { sonioxRestUntil = Date.now() + SONIOX_REST_MS; slowLines = 0 }
  logWarn(rest ? '[classroom] soniox voice failed — the box speaks for a minute' : '[classroom] soniox missed a line — the box says it', { what, status })
}
let slowLines = 0
const voiceOf = (voice: string): Voice => voiceFor(voice) ?? VOICES[0]
/** `busyRetry: false` — the voice concierge (src/lib/concierge/start.ts): on a full box it answers in words rather than
 *  queue a second try against the classroom's paid lessons (PLAN §10). */
type BoxOpts = { busyRetry?: boolean }

/**
 * One line in the avatar's voice → base64 audio for the page — MP3, or WAV for a child's louder voice (soniox-tts.ts); the
 * page decodes either (voice.ts decodeLine) for AvatarKit, or plays it in voice-only mode —
 * in the learner's voice style (pace.ts). Throws when neither Soniox nor the box can speak it — the caller then sends the
 * words without the voice (the captions still show them), never a broken session. A voice saved before 2026-10-26 speaks
 * as its counterpart (voices.ts voiceFor); an unknown one in the first voice, rather than failing.
 */
export async function speakLine(text: string, voice: string, style: VoiceStyle, waitMs = LINE_MAKE_MS, boxOpts: BoxOpts = {}): Promise<string> {
  const v = voiceOf(voice)
  const box = localSpeechConfig()
  if (sonioxUp()) {
    let audio: Buffer | null = null
    try {
      const made = sonioxLine(text, v, style)
      // The wait holds with or without the box (review, opus): a start never waits on a slow line past waitMs.
      audio = await Promise.race([made, new Promise<null>((r) => setTimeout(() => r(null), waitMs))])
    } catch (e) {
      sonioxFailed(e, 'line')
      if (!box) throw e
    }
    if (audio) return audio.toString('base64')
    // SLOW, not failed — never a rest for it (review, codex + opus): the line goes on being made for next time.
    if (!box) throw new SpeechError(504, 'tts') // no voice in time: the words go without it (the captions carry them)
    logWarn('[classroom] soniox line not ready in time — the box says this one', { waitMs })
  }
  if (!box) throw new SpeechError(503, 'tts')
  return (await synthesize(box, text, v.id, style, fetch, boxOpts)).toString('base64')
}

/**
 * The avatar's voice for one turn's sentences, STREAMED as it is made (turn-stream.ts; owner, 2026-10-26: "delayless").
 * `style` is read for EACH sentence: a learner who asks for a slower voice hears the reply's own sentences at the new pace
 * (the tutor's `pace` comes before its first sentence — session-turn.ts). Null when neither Soniox nor the box is set up:
 * the words still reach the screen.
 */
export function speakerFor(voice: string, style: () => VoiceStyle, boxOpts: BoxOpts = {}): Speaker | null {
  const v = voiceOf(voice)
  const box = localSpeechConfig()
  if (!sonioxConfig() && !box) return null
  const speak: Speaker = async (text, signal, o) => {
    // Its turn came after a voice made ahead failed: the box says it at once when there is one (review, opus).
    if (o?.box && box) return synthesizeStream(box, text, v.id, style(), signal, fetch, boxOpts)
    if (sonioxUp()) {
      try {
        // A line asked AHEAD is not waited for yet — a longer first-sound budget, so queueing behind the line being heard
        // is never read as Soniox being slow (review, opus).
        const voiced = await sonioxSpeakStream(text, v.soniox, style(), signal, box && !o?.ahead ? SONIOX_FIRST_SOUND_MS : undefined)
        slowLines = 0
        return voiced
      } catch (e) {
        if (signal.aborted) throw e // talked over: no one is waiting for this line
        // An ahead line's slowness counts toward nothing; its other failures do.
        if (!(o?.ahead && (e as { status?: number }).status === 504)) sonioxFailed(e, 'stream')
        // A line asked for AHEAD never goes to the box: it is asked for again in its turn (turn-stream.ts), so the box
        // only ever makes the line being heard — one at a time.
        if (!box || o?.ahead) throw e
      }
    }
    if (o?.ahead) throw new SpeechError(503, 'tts') // Soniox resting: the box says it in its turn
    if (!box) throw new SpeechError(503, 'tts')
    return synthesizeStream(box, text, v.id, style(), signal, fetch, boxOpts)
  }
  // Soniox makes speech at about real time: the reply's next sentences are voiced AHEAD (turn-stream.ts) — never on the box.
  speak.ahead = () => (sonioxUp() ? SONIOX_AHEAD : 0)
  // A line made ahead keeps its turn waiting no longer than one asked for now, when the box can take it.
  if (box) speak.turnMs = SONIOX_FIRST_SOUND_MS
  return speak
}

/** Sentences voiced ahead of the one being heard, on Soniox (≤ its 5 streams a socket with room to spare). */
export const SONIOX_AHEAD = 2
