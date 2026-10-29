import 'server-only'
import { logWarn } from '@/lib/log'
import { SpeechError } from './azure-speech'
import { localSpeechConfig, synthesize, synthesizeStream, type LocalSpeechConfig } from './speech-local'
import { sonioxConfig } from './soniox'
import { sonioxSpeakLine, sonioxSpeakStream } from './soniox-tts'
import type { Speaker, VoiceStream } from './turn-stream'
import { VOICES, voiceFor, type Voice } from './voices'
import type { VoiceStyle } from './pace'

/**
 * THE AVATAR'S VOICE: SONIOX FIRST, THE BOX STANDS BY (owner, 2026-10-27: "soniox voice turn on", "box tts as fallback").
 * Each line goes to Soniox (soniox-tts.ts) in the voice's Soniox voice (voices.ts `soniox`); when Soniox cannot start it —
 * not set up, refused, out of credit, or no first sound in time — eno's own speech server on the VN box speaks it in the
 * voice's own Phonon voice (speech-local.ts). A Soniox failure sends EVERY line to the box for SONIOX_REST_MS (a dead
 * Soniox must not cost each sentence its wait), then Soniox is tried again. A line that fails part-way through is not
 * re-spoken by the box (turn-stream.ts marks that part audio-failed; the captions carry it).
 *
 * ⛔ THE VOICE GUIDE TURNS IT ROUND (`first` — src/lib/concierge/start.ts only; owner, 2026-10-29: "priority english and
 * vietnamese rest use soniox"): its English goes to the BOX first, Soniox takes what the box cannot (guideSpeaker below).
 * Its Vietnamese too, on the server's own /vi/ routes (Bảo Trang, ZeroTTS int8; owner: "bao tran go") — a server without
 * them answers 404 and the line goes to Soniox. A lesson never sends Vietnamese to the box.
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
const sonioxKey = (text: string, v: Voice, style: VoiceStyle) => `${v.soniox}|${style.pace}|${style.loud ? 1 : 0}|${style.language ?? 'en'}|${text}`
function sonioxLine(text: string, v: Voice, style: VoiceStyle): Promise<Buffer> {
  const key = sonioxKey(text, v, style)
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

/** A whole line Soniox has made, or is making, for this text — never a new make (the guide's opening: guideLine). */
function keptSonioxLine(text: string, v: Voice, style: VoiceStyle): Promise<Buffer> | null {
  const kept = madeLines.get(sonioxKey(text, v, style))
  return kept && Date.now() - kept.at < LINE_KEEP_MS ? kept.made : null
}

/** Start making a whole line now, for an ask that is about to come (session-start.ts warmOpening). Never throws. The
 *  guide's (`first`): made on the box and kept — Soniox makes it ahead instead only when the box cannot. */
export function warmLine(text: string, voice: string, style: VoiceStyle, boxOpts: BoxOpts = {}): void {
  if (!text) return
  const v = voiceOf(voice)
  const box = boxFor(style, boxOpts.first)
  const ahead = () => sonioxLine(text, v, style).catch((e) => logWarn('[classroom] soniox line made ahead failed', { status: (e as { status?: number }).status ?? null }))
  if (boxOpts.first && box && boxUp(langOf(style))) {
    guideBoxWhole(box, text, v, style).catch(() => { if (sonioxUp()) void ahead() })
    return
  }
  if (sonioxUp()) void ahead()
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
/** eno's own speech server for a line in this language: English for every speaker; Vietnamese for the voice guide only
 *  (`first` — the server's /vi/ routes are the guide's: Bảo Trang, owner 2026-10-29). Nothing else ever goes there. */
const boxFor = (style: VoiceStyle, first = false) => {
  const lang = style.language ?? 'en'
  return lang === 'en' || (first && lang === 'vi') ? localSpeechConfig() : null
}
const langOf = (style: VoiceStyle) => style.language ?? 'en'
/** `busyRetry: false` — the voice concierge (src/lib/concierge/start.ts): on a full box it answers in words rather than
 *  queue a second try against the classroom's paid lessons (PLAN §10). `first` — the voice guide's: the box FIRST for a
 *  line it can say, Soniox for the rest (guideSpeaker). */
type BoxOpts = { busyRetry?: boolean; first?: boolean }

/**
 * One line in the avatar's voice → base64 audio for the page — MP3, or WAV for a child's louder voice (soniox-tts.ts); the
 * page decodes either (voice.ts decodeLine) for AvatarKit, or plays it in voice-only mode —
 * in the learner's voice style (pace.ts). Throws when neither Soniox nor the box can speak it — the caller then sends the
 * words without the voice (the captions still show them), never a broken session. A voice saved before 2026-10-26 speaks
 * as its counterpart (voices.ts voiceFor); an unknown one in the first voice, rather than failing.
 */
export async function speakLine(text: string, voice: string, style: VoiceStyle, waitMs = LINE_MAKE_MS, boxOpts: BoxOpts = {}): Promise<string> {
  const v = voiceOf(voice)
  const box = boxFor(style, boxOpts.first)
  if (boxOpts.first && box) return guideLine(text, v, style, box, waitMs)
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
  // ⛔ The box speaks English (and, for the guide alone, Vietnamese on its own route): a speaker in any other language has
  // NO box — no short first-sound budget that hands a slow line to it, no `o.box` turn, a Soniox failure leaves the words
  // (plan review, opus: an English box reading Vietnamese, or a slow line cut for a box that is not there).
  const box = boxFor(style(), boxOpts.first)
  if (!sonioxConfig() && !box) return null
  if (boxOpts.first && box) return guideSpeaker(v, style, box)
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

/*
 * THE VOICE GUIDE: THE BOX FIRST, SONIOX THE OVERFLOW (`first`; owner, 2026-10-29). Each line the box can say (English)
 * goes to it as a GUIDE line (speech-local.ts `guide`: the server answers busy AT ONCE rather than queue it ahead of a
 * lesson, and lends the guide at most GUIDE_TTS_MAX voices). A miss — busy, no first sound in BOX_FIRST_SOUND_MS, down —
 * sends that line to Soniox, and the REST OF THE REPLY with it: one voice an answer, not Phonon's Zoey and Soniox's Sloane
 * in turn (plan review, codex + opus). The next reply (a new speaker — turn/route.ts makes one a turn) tries the box again.
 * Nothing here is read by the classroom: a resting guide box never moves a lesson off it.
 */

/** A free voice on the box sounds in ~0.1 s (Phonon, measured 2026-10-26): silence past this is a slow or stuck box. */
export const BOX_FIRST_SOUND_MS = 1_500
/** After the box fails — down, a server fault, two slow lines in a row — guide lines go straight to Soniox this long. */
export const BOX_REST_MS = 60_000
/** Rests and runs of slow lines are kept PER LANGUAGE: the box's English (Phonon) and its Vietnamese (ZeroTTS) are
 *  separate voices, and one failing never sends the other to Soniox (opus, commit review). */
const restUntil = new Map<string, number>()
const boxSlow = new Map<string, number>()
/** For the tests: the guide's box tried again at once, nothing kept. */
export function resetBoxRest() { restUntil.clear(); boxSlow.clear(); guideLines.clear() }
const boxUp = (lang = 'en') => Date.now() >= (restUntil.get(lang) ?? 0)

type BoxMiss = 'busy' | 'refused' | 'slow' | 'down' | 'unsupported'
/** What a box refusal's status says: busy (503) — the box is fine, only full; refused — this line alone (a 4xx but the
 *  key's 401/403); down — unreachable (502, also a timeout — speech-local.ts), a server fault, the key refused. */
const missOf = (status: number | undefined): BoxMiss =>
  status === 404 ? 'unsupported' : status === 503 ? 'busy' : status !== undefined && status >= 400 && status < 500 && status !== 401 && status !== 403 ? 'refused' : 'down'
/** One guide line missed, in `lang`: busy and refused rest nothing; a slow or silent line counts — two in a row rest
 *  that language, like Soniox's slow lines; down, or a language the box does not speak (404 — a server without its /vi/
 *  routes, or with them off), rests it for every guide speaker for BOX_REST_MS: one quick round trip a minute, not one a
 *  reply (plan review, opus: the deadline is OUR timer, never read from a status — an abort reaches us as a 502). */
function boxMissed(kind: BoxMiss, what: string, lang = 'en') {
  const slow = kind === 'slow' ? (boxSlow.get(lang) ?? 0) + 1 : 0
  boxSlow.set(lang, slow)
  const rest = kind === 'down' || kind === 'unsupported' || slow >= 2
  if (rest) { restUntil.set(lang, Date.now() + BOX_REST_MS); boxSlow.set(lang, 0) }
  logWarn(rest ? '[concierge] the box failed — Soniox speaks for a minute' : '[concierge] the box missed a line — Soniox says it', { what, kind, lang })
}

/**
 * One guide line on the box with its FIRST SOUND read here, within BOX_FIRST_SOUND_MS — synthesizeStream returns at the
 * headers, before any sound (plan review, codex + opus) — and handed on with the rest; null on a miss (Soniox's turn).
 * Throws only when the visitor talked over it: no one waits for any voice then, and nothing is rested.
 */
async function guideBoxLine(box: LocalSpeechConfig, text: string, v: Voice, style: VoiceStyle, signal: AbortSignal): Promise<VoiceStream | null> {
  if (signal.aborted) throw new SpeechError(499, 'tts') // talked over before its turn: the box is never asked (codex)
  const own = new AbortController()
  let late = false
  const timer = setTimeout(() => { late = true; own.abort() }, BOX_FIRST_SOUND_MS)
  try {
    const made = await synthesizeStream(box, text, v.id, style, AbortSignal.any([signal, own.signal]), fetch, { busyRetry: false, guide: true })
    const it = made.chunks[Symbol.asyncIterator]()
    const first = await it.next()
    clearTimeout(timer)
    if (signal.aborted || late || first.done) {
      // Talked over, no sound in time, or none at all: let the stream go (its reader too) — a miss counts as slow.
      void it.return?.(undefined)
      if (signal.aborted) throw new SpeechError(499, 'tts')
      boxMissed('slow', 'stream', langOf(style))
      return null
    }
    boxSlow.set(langOf(style), 0)
    return { rate: made.rate, pauseMs: made.pauseMs, chunks: withFirst(first.value, it) }
  } catch (e) {
    clearTimeout(timer)
    // Talked over while the request was still on its way: a 499 like the rest (opus, commit review — it reached here as 502).
    if (signal.aborted) throw new SpeechError(499, 'tts')
    boxMissed(late ? 'slow' : missOf((e as { status?: number }).status), 'stream', langOf(style))
    return null
  }
}

/** The first chunk, already read, then the rest. Closing it lets the box's stream go — even before its first read (codex,
 *  commit review: an async generator closed before its first next() never runs its `finally`). */
function withFirst(first: Uint8Array, it: AsyncIterator<Uint8Array>): AsyncIterableIterator<Uint8Array> {
  let given = false
  const self: AsyncIterableIterator<Uint8Array> = {
    next: async () => {
      if (given) return it.next()
      given = true
      return { value: first, done: false }
    },
    return: async (value?: unknown) => {
      await it.return?.(value)
      return { value: undefined, done: true }
    },
    [Symbol.asyncIterator]: () => self,
  }
  return self
}

/** The guide's speaker for one reply (speakerFor with `first`, for a language the box speaks). */
function guideSpeaker(v: Voice, style: () => VoiceStyle, box: LocalSpeechConfig): Speaker {
  /** The reply's language — fixed for a speaker (the guide's turn route makes one a turn, in one language). */
  const lang = langOf(style())
  /** The reply moved to Soniox: its next lines stay there, made ahead as Soniox's are. */
  let onSoniox = false
  const soniox = async (text: string, signal: AbortSignal, firstSoundMs?: number): Promise<VoiceStream> => {
    const voiced = await sonioxSpeakStream(text, v.soniox, style(), signal, firstSoundMs)
    slowLines = 0
    return voiced
  }
  const speak: Speaker = async (text, signal, o) => {
    if (o?.ahead) {
      // Asked ahead only while the reply is on Soniox (ahead() below) — the box makes one line at a time, in its turn.
      if (!sonioxUp()) throw new SpeechError(503, 'tts')
      try {
        return await soniox(text, signal)
      } catch (e) {
        // An ahead line's slowness counts toward nothing; its other failures do (as speakerFor's).
        if (!signal.aborted && (e as { status?: number }).status !== 504) sonioxFailed(e, 'stream')
        throw e
      }
    }
    // The line in its turn: the box while the reply is on it — and for a line whose voice made ahead on Soniox failed or
    // was slow (o.box): the box answers at once or not at all, the quickest voice for a line already late (opus).
    let triedBox = false
    if ((!onSoniox || o?.box) && boxUp(lang)) {
      triedBox = true
      const voiced = await guideBoxLine(box, text, v, style(), signal)
      if (voiced) return voiced
    }
    onSoniox = true
    if (sonioxUp()) {
      const budget = boxUp(lang) ? SONIOX_FIRST_SOUND_MS : undefined
      try {
        // Soniox's first sound within SONIOX_FIRST_SOUND_MS while the box can still take the line (as speakerFor's — opus,
        // commit review: a stalled Soniox held the sentence its whole 10 s).
        return await soniox(text, signal, budget)
      } catch (e) {
        if (signal.aborted) throw e
        // Missing THAT short wait says nothing about Soniox for the lessons (opus, round 3: two slow first sounds rested
        // Soniox for every lesson while the box was full); any other failure counts as it always did.
        if (!(budget && (e as { status?: number }).status === 504)) sonioxFailed(e, 'stream')
        // Soniox refused it (three streams at once is its default, an outage) or stayed silent: the box once more — it
        // answers at once or not at all, and a line late already takes the quickest voice.
        if (boxUp(lang)) {
          const voiced = await guideBoxLine(box, text, v, style(), signal)
          if (voiced) return voiced
        }
        throw e
      }
    }
    if (!triedBox && boxUp(lang)) {
      const voiced = await guideBoxLine(box, text, v, style(), signal)
      if (voiced) return voiced
    }
    throw new SpeechError(503, 'tts') // neither can say it: the words go without the voice (the captions carry them)
  }
  speak.ahead = () => (onSoniox && sonioxUp() ? SONIOX_AHEAD : 0)
  // Only lines made ahead wait on it, and those are Soniox's (opus: it is a property, set it).
  speak.turnMs = SONIOX_FIRST_SOUND_MS
  return speak
}

/**
 * The guide's own lines made on the box, KEPT: its opening, the same words for every visitor in a language — no visitor's
 * words ever come through here (src/lib/concierge/start.ts). The key holds everything that shapes the audio (codex);
 * a failed line is not kept. GUIDE_KEEP_MS bounds a line made by an older voice after the speech server is rebuilt.
 */
const GUIDE_KEEP_MS = 24 * 3_600_000
const GUIDE_KEEP_MAX = 20
const guideLines = new Map<string, { at: number; made: Promise<Buffer> }>()
const guideKey = (text: string, v: Voice, style: VoiceStyle) => `${v.id}|${style.pace}|${style.loud ? 1 : 0}|${style.gapMs}|${style.language ?? 'en'}|${text}`
/** The box's line kept for this text — never a new make. */
function keptGuideLine(text: string, v: Voice, style: VoiceStyle): Promise<Buffer> | null {
  const kept = guideLines.get(guideKey(text, v, style))
  return kept && Date.now() - kept.at < GUIDE_KEEP_MS ? kept.made : null
}
function guideBoxWhole(box: LocalSpeechConfig, text: string, v: Voice, style: VoiceStyle): Promise<Buffer> {
  const key = guideKey(text, v, style)
  const now = Date.now()
  const kept = guideLines.get(key)
  if (kept && now - kept.at < GUIDE_KEEP_MS) return kept.made
  const made = synthesize(box, text, v.id, style, fetch, { busyRetry: false, guide: true })
  guideLines.set(key, { at: now, made })
  made.then(
    // A line made is the box answering: it ends a run of slow lines as a streamed line does (codex, commit review).
    () => { boxSlow.set(langOf(style), 0) },
    (e) => {
      if (guideLines.get(key)?.made === made) guideLines.delete(key)
      boxMissed(missOf((e as { status?: number }).status), 'line', langOf(style))
    },
  )
  if (guideLines.size > GUIDE_KEEP_MAX) guideLines.delete(guideLines.keys().next().value!)
  return made
}

/**
 * The guide's whole line (its opening): the box's — kept, and made ahead by warmLine — within waitMs. Soniox's only when
 * the box FAILED it or is resting (one made ahead then is found at once). A box line merely SLOW is not made twice (codex:
 * a second, billed make for a line the box is about to finish): the words show without a voice this once, and the line
 * is kept for the next Start.
 */
async function guideLine(text: string, v: Voice, style: VoiceStyle, box: LocalSpeechConfig, waitMs: number): Promise<string> {
  const deadline = Date.now() + waitMs
  // A Soniox line made ahead when the box could not (warmLine) plays if it is ready first — never a new make here (opus,
  // commit review: a slow box left the opening silent while Soniox's sat ready).
  const ready = keptSonioxLine(text, v, style)
  // A resting box makes nothing new — but a line it made already still plays (codex, round 3).
  const boxLine = boxUp(langOf(style)) ? guideBoxWhole(box, text, v, style) : keptGuideLine(text, v, style)
  if (boxLine) {
    let failed = false
    const made = boxLine.catch(() => { failed = true; return null })
    const audio = await firstAudio(ready ? [made, ready] : [made], waitMs)
    if (audio) return audio.toString('base64')
    if (!failed) throw new SpeechError(504, 'tts')
  }
  if (!sonioxUp()) throw new SpeechError(503, 'tts')
  let audio: Buffer | null
  try {
    audio = await Promise.race([sonioxLine(text, v, style), new Promise<null>((r) => setTimeout(() => r(null), Math.max(0, deadline - Date.now())))])
  } catch (e) {
    sonioxFailed(e, 'line')
    throw e
  }
  if (audio) return audio.toString('base64')
  throw new SpeechError(504, 'tts') // slow, not failed: Soniox goes on making it, kept for the next Start
}

/** The first of these lines to give audio within `ms` — or null: none did in time, or every one failed first. */
function firstAudio(lines: Promise<Buffer | null>[], ms: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let pending = lines.length
    const timer = setTimeout(() => resolve(null), ms)
    const settle = (audio: Buffer | null) => {
      if (audio) { clearTimeout(timer); resolve(audio) } else if (--pending === 0) { clearTimeout(timer); resolve(null) }
    }
    for (const line of lines) line.then(settle, () => settle(null))
  })
}
