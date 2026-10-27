import { logError, logWarn } from '@/lib/log'
import { quietError } from './quiet-error'
import { replyParts } from './reply-parts'
import { mayBeSpoken } from './contact-gate'
import type { TutorEvent, TutorReply } from './tutor-ai'
import type { PaceChange } from './pace'

/**
 * ONE TURN'S ANSWER, STREAMED (owner, 2026-10-26: "mvp should work flawless delayless"). The turn route answers with JSON
 * lines (application/x-ndjson), each written the moment it exists:
 *
 *   heard         the learner's words (the transcript) — on screen while the avatar thinks
 *   say           one sentence of the reply, as soon as the brain has written it (tutor-ai.ts tutorTurnStream) …
 *   pcm           … then its voice as it is made: raw PCM16 mono at `rate` Hz, base64 (eno's speech server, /tts/stream)
 *   part-end      that sentence's voice is complete; `last`: the whole reply's is — ⚡ sent the moment the reply's last
 *                 sentence is voiced, BEFORE the save (owner, 2026-10-27: "need super fast response"): the face closes the
 *                 reply at once (Spatius animates a reply's last part only once it is closed) and the learner's turn
 *                 comes back as soon as the voice ends. Nothing is voiced after it.
 *   drill         right before `part-end last`, when the reply asked for a repeat-after-me sentence: the page sends the
 *                 next turn's clip for it (an answer may come before `reply` does)
 *   audio-failed  a sentence whose voice could not be made (its words were on screen; the next one is still tried)
 *   reply         the turn as SAVED — hints, the drill, the time left — once the brain has finished (the voice may still
 *                 be playing)
 *   error         the turn could not be answered and nothing was said: the page says "try again" (then end)
 *   no-drill      the saved reply's drill is withdrawn (a sentence's voice failed or the page left mid-voice): the next
 *                 turn is not a repeat-after-me
 *   end           the answer is complete — a stream that stops before it was cut off
 *
 * So the avatar starts talking about a second after the learner stops, not after the whole reply and then its whole voice
 * (measured 2026-10-26 before this: 7-13 s).
 * ⛔ THE TURN DOES NOT DEPEND ON ITS READER: the brain runs to its end and the turn is saved even when the page goes away
 * mid-answer (talked over, closed) — only the voice stops. ⛔ Nothing is stored but the saved turn; no words are logged.
 */
export type TurnLine =
  | { kind: 'heard'; learnerText: string }
  | { kind: 'say'; part: number; text: string }
  | { kind: 'pcm'; part: number; rate: number; data: string }
  | { kind: 'part-end'; part: number; last: boolean }
  | { kind: 'drill'; expect: string }
  | { kind: 'audio-failed'; part: number }
  | ({ kind: 'reply' } & SavedReply)
  | { kind: 'error'; error: 'tutor_unavailable' }
  | { kind: 'no-drill' }
  | { kind: 'end' }

/** The turn as saved — what the `reply` line carries. */
export type SavedReply = {
  seq: number
  learnerText: string
  reply: string
  hint: string
  hintVi: string
  expect: string | null
  heardAs: { heard: string; meant: string }[]
  secondsLeft: number
}

/** One line in the avatar's voice, as it is made (speech-local.ts synthesizeStream); `pauseMs` of silence goes BEFORE it
 *  when it follows another sentence of the same reply (pace.ts pauseMs) — never after a reply's last sentence. */
export type VoiceStream = { rate: number; chunks: AsyncIterable<Uint8Array>; pauseMs?: number }
export type Speaker = (text: string, signal: AbortSignal) => Promise<VoiceStream>

/** The brain's whole answer, as tutor-ai.ts's `final` event gives it. */
export type Answer = { reply: TutorReply; model: string; calls: number }

/** A turn being answered: its lines for the route, `stop` when the route's client has gone, `done` when all is over. */
export type TurnStream = { lines: AsyncGenerator<TurnLine, void, undefined>; stop: () => void; done: Promise<void> }

/** Voice per `pcm` line after the first: ~100 ms at 24 kHz. The FIRST frames go alone, at once — the sound starts. */
export const PCM_LINE_BYTES = 4_800

export function streamTurn(t: {
  learnerText: string
  /** The brain's events (tutor-ai.ts tutorTurnStream). */
  events: AsyncIterable<TutorEvent>
  /** The avatar's voice; null = none (the words still reach the screen). */
  speak: Speaker | null
  /** Saves the answered turn and returns the `reply` line; throws when it could not (having given the row back, or kept
   *  a harm flag, itself). `clientGone()`: has the page left NOW — read at the moment work is scheduled "after the
   *  response" (2026-10-26 review round 2, opus: a value read before the save's awaits could be stale). */
  save: (a: Answer, ctx: { clientGone: () => boolean }) => Promise<SavedReply>
  /** No answer at all: gives the reserved turn back. Never throws. */
  giveUp: (e: unknown) => Promise<void>
  /** eno's own kind words for a turn the brain flagged for harm but whose reply could not be used (safety.ts). */
  safetyLine: string
  /** Ends the brain: the page has gone (talked over, closed) — what was said by then is the reply. */
  stopBrain?: () => void
  /** The saved turn sets no drill after all (a sentence's voice failed). Never throws (it retries once, then logs). */
  dropDrill?: () => Promise<void>
  /** The learner asked for a slower or faster voice (the tutor's `pace`, before its first sentence): the speaker's next
   *  sentences use the new pace. Never for a flagged turn. */
  onPace?: (change: PaceChange) => void
}): TurnStream {
  const q = lineQueue<TurnLine>()
  const gone = new AbortController()
  /** The sentences whose voice had started (or, with no voice, whose words were shown) — what the learner heard. */
  const voiced: string[] = []
  const voice = voiceOf(q, t.speak, gone.signal, (text) => voiced.push(text))
  const done = (async () => {
    q.push({ kind: 'heard', learnerText: t.learnerText })
    const said: string[] = []
    let answer: Answer | null = null
    let harm = false
    /** The brain said `spoken`: the reply's voice is closed — nothing after it is said or saved. */
    let closed = false
    try {
      for await (const ev of t.events) {
        // ⛔ A TALKED-OVER REPLY ENDS WHERE THE LEARNER STOPPED HEARING IT (2026-10-26 review, opus): sentences written
        // after the page left are never said, never saved — the history holds only what the learner heard.
        if (ev.kind === 'say') { if (!gone.signal.aborted && !closed) { said.push(ev.text); voice.say(ev.text) } }
        else if (ev.kind === 'safety') harm ||= ev.harm
        else if (ev.kind === 'pace') { if (!harm) t.onPace?.(ev.change) }
        // Nothing more will be said: the reply's voice closes once its queued sentences are out (a flagged reply never
        // gets here — tutor-ai.ts never says `spoken` for one).
        else if (ev.kind === 'spoken') { if (!gone.signal.aborted && !harm) { closed = true; voice.close(ev.expect) } }
        else answer = { reply: ev.reply, model: ev.model, calls: ev.calls }
      }
      if (!answer) throw new Error('classroom_no_answer')
      // A flag the brain raised is the turn's, whatever its final answer says (defence in depth: they come from one JSON).
      if (harm && !answer.reply.safety) throw Object.assign(new Error('classroom_flag_mismatch'), { safety: true, calls: answer.calls })
    } catch (e) {
      const calls = (e as { calls?: number } | null)?.calls ?? 1
      // ⛔ A HARM FLAG RAISED BEFORE THE BRAIN FAILED IS KEPT (2026-10-26 review, codex P1).
      if ((e as { safety?: boolean } | null)?.safety || harm) {
        // ⛔ A HARM FLAG IS NEVER LOST WITH ITS REPLY (2a round 5, opus): the model flagged the turn but its words could not
        // be used — eno's own kind words, saved flagged, and a person is alerted (save).
        answer = { reply: { reply: t.safetyLine, hint: '', hintVi: '', expect: null, heardAs: [], safety: true, pace: null }, model: 'eno-safety', calls }
      } else if (said.length) {
        // The brain broke off — or the page left — after some of the reply was said: what the learner heard IS the reply.
        // Every sentence passed the gate with all before it (contact-gate.ts); checked once more as the saved text.
        if (!gone.signal.aborted) logWarn('[classroom] reply cut off mid-stream', { status: (e as { status?: number } | null)?.status ?? null })
        const text = said.join(' ')
        answer = { reply: { reply: mayBeSpoken([], text) ? text : '', hint: '', hintVi: '', expect: null, heardAs: [], safety: false, pace: null }, model: 'cut-off', calls }
      } else {
        await t.giveUp(e)
        q.push({ kind: 'error', error: 'tutor_unavailable' })
        q.push({ kind: 'end' })
        q.close()
        return
      }
    }
    // ⚡ EVERY VOICE IS OUT BEFORE THE SAVE (2026-10-27 plan review, codex + opus): the learner's turn may now come back
    // before the save (the reply's voice closes first) — so what was HEARD is settled first, and the row says exactly that.
    await voice.done()
    const flat = (x: string) => x.replace(/\s+/g, ' ').trim()
    // ⛔ THE PAGE LEFT (talked over, closed) BEFORE THE REPLY WAS ALL VOICED: the reply is what WAS voiced — sentences
    // written but still queued for their voice were never heard, and a drill among them would score the next turn against
    // a sentence nobody asked for (2026-10-26 review round 2, codex + opus). A flag is kept whatever the page did.
    if (gone.signal.aborted && !answer.reply.safety && flat(voiced.join(' ')) !== flat(answer.reply.reply)) {
      const text = voiced.join(' ')
      if (!text) {
        await t.giveUp(new Error('classroom_unheard'))
        q.close()
        return
      }
      answer = { reply: { reply: mayBeSpoken([], text) ? text : '', hint: '', hintVi: '', expect: null, heardAs: [], safety: false, pace: null }, model: 'cut-off', calls: answer.calls }
    } else if (gone.signal.aborted) {
      // Every sentence had begun to sound — but a sentence counts from its FIRST sound, so the last one (the drill's
      // "say after me…") may have been cut mid-way (review round 2, codex): never a drill from a reply the page left.
      answer = { ...answer, reply: { ...answer.reply, expect: null } }
    } else if (closed && !answer.reply.safety && flat(said.join(' ')) !== flat(answer.reply.reply)) {
      // Closed, the reply is what was said (tutor-ai.ts says exactly that) — defence in depth: never a word saved that was not.
      logWarn('[classroom] a closed reply differs from what was said — saved as said')
      answer = { reply: { reply: said.join(' '), hint: '', hintVi: '', expect: null, heardAs: [], safety: false, pace: null }, model: 'cut-off', calls: answer.calls }
    }
    // A flagged turn never sets a drill (2a round 10, opus): nothing after a disclosure is scored as a repeat of anything.
    if (answer.reply.safety) answer = { ...answer, reply: { ...answer.reply, expect: null } }
    // A sentence whose voice failed may have carried the drill's "say after me…": withdrawn BEFORE the row is written — a
    // next turn reserved right after the save is never scored against a request nobody heard.
    if (answer.reply.expect && voice.failed() > 0) answer = { ...answer, reply: { ...answer.reply, expect: null } }
    let saved: SavedReply | null = null
    try {
      saved = await t.save(answer, { clientGone: () => gone.signal.aborted })
    } catch {
      // save() gave the row back (or kept the flag) and logged it. A learner who has heard nothing hears "try again".
      if (!said.length && !answer.reply.safety) {
        q.push({ kind: 'error', error: 'tutor_unavailable' })
        q.push({ kind: 'end' })
        q.close()
        return
      }
      // The page was told the reply's drill with its end (`drill`, before the save): the row was not written, so the
      // history holds no such drill — the page drops it, and no clip is scored against a drill nobody saved (2026-10-27
      // review, codex).
      if (voice.drilled()) q.push({ kind: 'no-drill' })
    }
    // ⛔ A FLAGGED REPLY IS SPOKEN ONLY NOW — whole, checked by acceptTutorReply and saved first (tutor-ai.ts never hands
    // over a sentence of it): the model's kind words, or eno's own.
    if (answer.reply.safety) for (const p of replyParts(answer.reply.reply)) voice.say(p)
    if (saved) q.push({ kind: 'reply', ...saved })
    await voice.done()
    // A page that left after the save may not have heard the drill's instruction play out: the next turn is not scored
    // against it (review round 2, codex: a cancel after the save could not revise it). Withdrawn BEFORE the answer ends —
    // the page cannot send its next turn against the old drill — and the page is told (review of that fix, codex + opus).
    // (A failed voice withdrew it before the save, above.)
    if (saved?.expect && (voice.failed() > 0 || gone.signal.aborted)) {
      await t.dropDrill?.()
      q.push({ kind: 'no-drill' })
    }
    voice.end()
    q.close()
  })().catch((e) => {
    logError(quietError(e), { op: 'classroom.turn.stream' })
    q.close()
  })
  return { lines: q.lines(), stop: () => { gone.abort(); t.stopBrain?.(); q.close() }, done }
}

/**
 * A retried upload of a turn already answered: the same answer again (session-turn.ts decides whose voice is made again —
 * `speak` null answers with the words alone).
 */
export function replayTurn(saved: SavedReply, speak: Speaker | null): TurnStream {
  const q = lineQueue<TurnLine>()
  const gone = new AbortController()
  const voice = voiceOf(q, speak, gone.signal)
  const done = (async () => {
    if (saved.learnerText) q.push({ kind: 'heard', learnerText: saved.learnerText })
    if (speak) for (const p of replyParts(saved.reply)) voice.say(p)
    q.push({ kind: 'reply', ...saved })
    await voice.finish()
    q.close()
  })().catch((e) => {
    logError(quietError(e), { op: 'classroom.turn.replay' })
    q.close()
  })
  return { lines: q.lines(), stop: () => { gone.abort(); q.close() }, done }
}

/**
 * The reply's voice: its sentences said in order, one at a time (eno's speech server makes one line per voice at a time
 * anyway) — each `say` first, then its frames; a sentence after the first is preceded by its pause (pace.ts pauseMs —
 * between sentences only, never after the last). ⛔ NOT ONE AHEAD (measured 2026-10-27 on the owner's Mac): asking for the
 * next sentence's voice while one streams made BOTH slower — two lines at once share the speech server's 4 CPUs — and the
 * face's first 2 s of audio came later (1.07–1.28 s → 1.48–1.81 s). A sentence whose voice fails is 'audio-failed' and the
 * next one is still made. close(): nothing more will be said — the last part-end goes out (after a `drill` line, when the
 * reply asked for one and every voice was made) the moment the queued sentences' voices are out; a sentence after that is
 * never voiced: the page has closed the face's reply (another send would start a new one over it). finish(): when every
 * sentence's voice is done, the last part-end (unless close() sent it) and end.
 */
export function voiceOf(q: Pick<LineQueue<TurnLine>, 'push'>, speak: Speaker | null, gone: AbortSignal, onVoiced?: (text: string) => void) {
  let parts = 0
  let failed = 0
  let closed = false
  let drilled = false
  let chain: Promise<void> = Promise.resolve()
  const one = async (part: number, text: string) => {
    if (gone.aborted) return
    q.push({ kind: 'say', part, text })
    // A sentence counts as VOICED once its first sound went out — or, with no voice at all, once its words were shown
    // (2026-10-26 review, codex: counted at `say`, a sentence still waiting for its voice was saved as heard).
    if (!speak) { onVoiced?.(text); return }
    try {
      const v = await speak(text, gone)
      // The breath before a sentence that follows another — its own pcm line, so the pause is never counted as the
      // sentence being heard.
      if (part > 0 && v.pauseMs && !gone.aborted) q.push({ kind: 'pcm', part, rate: v.rate, data: Buffer.alloc(Math.round((v.rate * v.pauseMs) / 1000) * 2).toString('base64') })
      let held: Uint8Array[] = []
      let size = 0
      let first = true
      const send = () => {
        if (first && !gone.aborted) onVoiced?.(text)
        q.push({ kind: 'pcm', part, rate: v.rate, data: Buffer.concat(held).toString('base64') })
        held = []
        size = 0
        first = false
      }
      for await (const chunk of v.chunks) {
        if (gone.aborted) return
        held.push(chunk)
        size += chunk.length
        if (first || size >= PCM_LINE_BYTES) send()
      }
      if (gone.aborted) return
      if (size) send()
      // A voice that never sent a sound (stalled before its first frame, cut at once) is a failed voice, not a spoken one
      // (2026-10-26 review round 2, codex).
      if (first) throw Object.assign(new Error('tts_empty'), { status: 502 })
      q.push({ kind: 'part-end', part, last: false })
    } catch (e) {
      failed += 1
      logWarn('[classroom] reply TTS failed', { part, status: (e as { status?: number } | null)?.status ?? null })
      q.push({ kind: 'audio-failed', part })
      // Its words were on the screen: seen, if not heard.
      if (!gone.aborted) onVoiced?.(text)
    }
  }
  /** The last part-end (unless close() sent it) and end — after every sentence's voice is done. */
  const end = () => {
    if (parts && !closed) q.push({ kind: 'part-end', part: parts - 1, last: true })
    q.push({ kind: 'end' })
  }
  return {
    say(text: string) {
      // ⛔ NOTHING IS VOICED AFTER THE REPLY CLOSED (2026-10-27 plan review, codex + opus).
      if (closed) { logWarn('[classroom] a sentence after the reply closed — not voiced'); return }
      const part = parts++
      chain = chain.then(() => one(part, text))
    },
    /** Nothing more will be said: once the queued sentences' voices are out, the reply's drill (when every voice was
     *  made) and its last part-end. Once only. */
    close(expect: string | null) {
      if (closed) return
      closed = true
      chain = chain.then(() => {
        if (gone.aborted || !parts) return
        if (expect && !failed) { drilled = true; q.push({ kind: 'drill', expect }) }
        q.push({ kind: 'part-end', part: parts - 1, last: true })
      })
    },
    /** Every sentence's voice is done (made, failed or stopped). */
    async done() {
      await chain
    },
    end,
    async finish() {
      await chain
      end()
    },
    /** How many sentences' voices failed or were cut. */
    failed: () => failed,
    /** The page was told the reply's drill (a `drill` line). */
    drilled: () => drilled,
  }
}

export type LineQueue<T> = { push: (item: T) => void; close: () => void; lines: () => AsyncGenerator<T, void, undefined> }

/** One writer, one reader. After close() nothing more is taken; what was queued is still read. (The voice concierge —
 *  src/lib/concierge/turn.ts — speaks through the same voiceOf over its own queue of lines.) */
export function lineQueue<T>(): LineQueue<T> {
  const items: T[] = []
  let closed = false
  let wake: (() => void) | null = null
  const nudge = () => { const w = wake; wake = null; w?.() }
  return {
    push(item) {
      if (closed) return
      items.push(item)
      nudge()
    },
    close() {
      closed = true
      nudge()
    },
    async *lines() {
      for (;;) {
        if (items.length) { yield items.shift() as T; continue }
        if (closed) return
        await new Promise<void>((resolve) => { wake = resolve })
      }
    },
  }
}
