import 'server-only'
import type { GoogleGenAI } from '@google/genai'
import { openAiConfig, streamJson } from '@/lib/classroom/llm-openai'
import { hedgedDeltas, HEDGE_FIRST_MS } from '@/lib/classroom/tutor-ai'
import { AnswerTooLong, PRIMARY_MODEL, ThinkingLevel } from '@/lib/classroom/ai'
import { CONCIERGE_JSON_SCHEMA, GEMINI_CONCIERGE_SCHEMA, conciergeInstructions } from './brief'
import { PHONE_DIGITS, bareDigits, speakable } from './guards'
import { topLevelMembers, partialText } from './json-stream'
import { NO_ACTION, type ConciergeAction } from './types'

/**
 * THE CONCIERGE'S BRAIN — one strict-JSON answer per turn, `{action, say, chips}` IN THAT ORDER (plan v2; llm.md design B,
 * measured 2026-10-27 on gpt-6-luna: the action closes 0.2–0.3 s after the first word, the first sentence right behind it).
 * One request, two jobs: the action moves the app while the first sentence is voiced. The model never writes a URL — the
 * action is validated and turned into one by the caller (actions.ts).
 *
 * Brains, in order: OpenAI (the classroom's kept-open client, priority tier) → Gemini 3.8 Flash STREAMED with the 2.5 s
 * first-word hedge. ⛔ HAND-OVER ONLY BEFORE ANY OUTPUT: once an action or a sentence went out, a second brain could move the
 * app somewhere else or contradict what was said — the turn fails instead, and the caller says one canned line.
 * ⛔ NO SENTENCE BEFORE THE ACTION: Gemini's key order is best-effort, so a `say` written first is HELD until the action has
 * closed — the caller validates the action before any word is spoken, and a refused action is never announced.
 */
export type ConciergeEvent =
  | { kind: 'action'; action: ConciergeAction }
  | { kind: 'say'; text: string }
  | { kind: 'spoken' }
  | { kind: 'final'; said: string; chips: string[]; model: string; calls: number }

/** A sentence ends at . ! ? or … (with any closing quote or bracket) followed by whitespace — the tutor's rule. */
const SENTENCE_END = /[.!?…]["'”’)\]]*\s+/g
/** What the voice says at most per turn (the prompt asks for two short sentences). */
const MAX_WORDS = 70
/** Bare digits a turn may voice before its sentences with digits wait for the whole answer (no phone number has 3). */
const EARLY_DIGITS = 3
const MAX_CHIPS = 4
const CHIP_CHARS = 28
/** OpenAI's first word normally comes in ~1 s (measured); past this the turn hands over to Gemini. */
const FIRST_TOKEN_MS = 2_500
const MAX_OUTPUT_TOKENS = 400

export type BrainError = Error & { emitted: boolean; calls: number }

export async function* conciergeTurnStream(ai: GoogleGenAI | null, c: { input: string; teacherTurn: boolean }, signal?: AbortSignal): AsyncGenerator<ConciergeEvent> {
  const cfg = openAiConfig()
  const brains: { model: string; deltas: () => AsyncGenerator<string> }[] = []
  if (cfg) {
    brains.push({ model: cfg.model, deltas: () => streamJson(cfg, { instructions: conciergeInstructions(), input: c.input, schema: CONCIERGE_JSON_SCHEMA, schemaName: 'concierge_turn', maxOutputTokens: MAX_OUTPUT_TOKENS, signal, firstTokenMs: FIRST_TOKEN_MS }) })
  }
  if (ai) brains.push({ model: PRIMARY_MODEL, deltas: () => hedgedDeltas((s) => geminiDeltas(ai, c.input, s), HEDGE_FIRST_MS, signal) })
  let calls = 0
  for (const brain of brains) {
    calls += 1
    let emitted = false
    try {
      for await (const ev of eventsOf(brain.deltas(), c.teacherTurn)) {
        if (ev.kind === 'done') { yield { kind: 'final', said: ev.said, chips: ev.chips, model: brain.model, calls }; return }
        // An action of kind none moves nothing and says nothing: the next brain may still take the turn (test review).
        if (!(ev.kind === 'action' && ev.action.kind === 'none')) emitted = true
        yield ev
      }
      return
    } catch (e) {
      if (emitted || signal?.aborted) throw brainError(e, emitted, calls)
    }
  }
  throw brainError(new Error('concierge_brain_unavailable'), false, calls)
}

const brainError = (e: unknown, emitted: boolean, calls: number): BrainError =>
  Object.assign(e instanceof Error ? e : new Error(String(e)), { emitted, calls })

/** One Gemini answer as text deltas (the tutor's streamed request, with the concierge's JSON Schema). */
async function* geminiDeltas(ai: GoogleGenAI, input: string, signal: AbortSignal): AsyncGenerator<string> {
  const stream = await ai.models.generateContentStream({
    model: PRIMARY_MODEL,
    contents: [{ role: 'user', parts: [{ text: input }] }],
    config: {
      systemInstruction: conciergeInstructions(),
      responseMimeType: 'application/json',
      responseJsonSchema: GEMINI_CONCIERGE_SCHEMA,
      maxOutputTokens: 1_024,
      // ⛔ Never MINIMAL on 3.8 Flash (Vertex answers 400 — ai.ts).
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      httpOptions: { timeout: 15_000, retryOptions: { attempts: 1 } },
      abortSignal: signal,
    },
  })
  for await (const chunk of stream) {
    if (chunk.candidates?.[0]?.finishReason === 'MAX_TOKENS') throw new AnswerTooLong()
    const t = chunk.text
    if (t) yield t
  }
}

type Step = Exclude<ConciergeEvent, { kind: 'final' }> | { kind: 'done'; said: string; chips: string[] }

/**
 * Deltas of one answer → its events: `action` the moment its object closes, then each spoken sentence of `say` (through the
 * speech guards and the word cap), `spoken` when `say` is complete, and `done` with the chips once the answer is whole.
 * Exported for tests.
 */
export async function* eventsOf(deltas: AsyncIterable<string>, teacherTurnAtStart: boolean): AsyncGenerator<Step> {
  /** A turn about teachers — the counsel-pending words are out. ⛔ Also when the ACTION opens the teachers shelf (commit
   *  review, opus: "someone to teach my son IELTS" names no teacher): the action closes before any sentence is released. */
  let teacherTurn = teacherTurnAtStart
  let json = ''
  let actionOut = false
  let sayDone = false
  let spokenOut = false
  let consumed = 0
  let words = 0
  /** Finished sentences not yet spoken, in order: waiting for the action, or behind a sentence with a digit. */
  const pending: string[] = []
  const said: string[] = []
  /** Decided once, when `say` is complete: may this turn's sentences with digits be spoken at all? */
  let digitsOk: boolean | null = null
  const cut = (text: string, complete: boolean) => {
    for (;;) {
      SENTENCE_END.lastIndex = consumed
      const hit = SENTENCE_END.exec(text)
      const end = hit ? hit.index + hit[0].length : complete && consumed < text.length ? text.length : -1
      if (end < 0) return
      const sentence = text.slice(consumed, end).replace(/[*_#`~<>[\]{}]/g, '').replace(/\s+/g, ' ').trim()
      consumed = end
      if (sentence) pending.push(sentence)
    }
  }
  /** The word cap: a later sentence past it is dropped; a FIRST sentence past it is cut to it (something is said). */
  const capped = (sentence: string): string | null => {
    const w = sentence.split(' ')
    if (words + w.length <= MAX_WORDS) return sentence
    return said.length ? null : `${w.slice(0, MAX_WORDS).join(' ').replace(/[,;:]+$/, '')}.`
  }
  /**
   * What may be spoken NOW, in order. ⛔ NOTHING BEFORE THE ACTION (a refused action is never announced). ⛔ THE DIGIT HOLD
   * (the classroom tutor's rule, test review 2026-10-27): once the turn's bare digits (prices and year spans masked) pass
   * EARLY_DIGITS, the sentence carrying them — and everything after it — waits until `say` is complete, and the turn's
   * digits are judged together: a phone number spread over sentences or split by words ("Call 0901 234. Then dial 567.")
   * is never voiced in parts. "District 1" or "2 bedrooms" (a digit or two) is said at once — no delay on the common turn.
   */
  function* release(): Generator<string> {
    while (pending.length && actionOut) {
      const next = pending[0]
      const digit = /\d/.test(next)
      if (digit && !sayDone && bareDigits([...said, next].join(' ')) > EARLY_DIGITS) return
      pending.shift()
      if (digit && sayDone) {
        digitsOk ??= bareDigits([...said, next, ...pending].join(' ')) < PHONE_DIGITS
        if (!digitsOk) continue
      }
      const sentence = capped(next)
      if (!sentence) continue
      // With what was already said this turn too (guards.ts): a number spread over sentences is caught only together.
      if (!speakable(sentence, { teacherTurn }) || !speakable([...said, sentence].join(' '), { teacherTurn })) continue
      words += sentence.split(' ').length
      said.push(sentence)
      yield sentence
    }
  }
  for await (const d of deltas) {
    json += d
    const members = topLevelMembers(json)
    const a = members.find((m) => m.key === 'action')
    if (!actionOut && a?.complete) {
      actionOut = true
      const action = parseAction(a.raw)
      if (action.category === 'teachers') teacherTurn = true
      yield { kind: 'action', action }
    }
    const s = members.find((m) => m.key === 'say')
    if (s && !sayDone) {
      cut(partialText(s.raw), s.complete)
      if (s.complete) sayDone = true
    }
    for (const sentence of release()) yield { kind: 'say', text: sentence }
    if (sayDone && actionOut && !pending.length && !spokenOut) { spokenOut = true; yield { kind: 'spoken' } }
  }
  // A cut answer throws here: the caller hands over (nothing emitted) or fails the turn.
  const whole = JSON.parse(json) as { action?: unknown; say?: unknown; chips?: unknown }
  if (!actionOut) {
    actionOut = true
    const action = parseAction(JSON.stringify(whole.action ?? null))
    if (action.category === 'teachers') teacherTurn = true
    yield { kind: 'action', action }
  }
  if (!sayDone) {
    if (typeof whole.say === 'string') cut(whole.say, true)
    sayDone = true
  }
  for (const sentence of release()) yield { kind: 'say', text: sentence }
  if (!spokenOut) yield { kind: 'spoken' }
  yield { kind: 'done', said: said.join(' '), chips: chipsOf(whole.chips, teacherTurn, said) }
}

/** The model's action, shape-checked (its MEANING is checked by actions.ts). Anything malformed is no action. Pure. */
export function parseAction(raw: string): ConciergeAction {
  let v: unknown
  try { v = JSON.parse(raw) } catch { return NO_ACTION }
  if (!v || typeof v !== 'object') return NO_ACTION
  const o = v as Record<string, unknown>
  const kind = o.kind === 'browse' || o.kind === 'listing' || o.kind === 'page' ? o.kind : 'none'
  if (kind === 'none') return NO_ACTION
  const s = (x: unknown, max: number) => (typeof x === 'string' ? x.trim().slice(0, max) : '')
  const filters = Array.isArray(o.filters)
    ? o.filters.slice(0, 8).flatMap((f) => {
      if (!f || typeof f !== 'object') return []
      const key = s((f as Record<string, unknown>).key, 40)
      const value = s((f as Record<string, unknown>).value, 120)
      return key && value ? [{ key, value }] : []
    })
    : []
  return {
    kind,
    mode: o.mode === 'replace' ? 'replace' : 'refine',
    category: s(o.category, 40),
    subcategory: s(o.subcategory, 40),
    filters,
    search: s(o.search, 60),
    target: s(o.target, 60),
  }
}

/** Quick replies: short strings, under the SAME guards as speech (test review: a chip is on screen — "Visa help" or a phone
 *  number must never be one). Pure. */
function chipsOf(v: unknown, teacherTurn: boolean, said: readonly string[]): string[] {
  if (!Array.isArray(v)) return []
  const chips = v.flatMap((c) => {
    const chip = typeof c === 'string' ? c.trim() : ''
    return chip && chip.length <= CHIP_CHARS && speakable(chip, { teacherTurn }) ? [chip] : []
  }).slice(0, MAX_CHIPS)
  // Together too, with what was said (commit review, codex): "Call 0901" · "234" · "567" is a number on screen.
  return bareDigits([...said, ...chips].join(' ')) < PHONE_DIGITS ? chips : chips.filter((c) => !/\d/.test(c))
}

/**
 * WARM THE BRAIN AT THE START TAP (the tutor's warmTutorBrain, measured 2026-10-26: a cold first answer took 2.5 s to its
 * first word, warm ones ~1.2 s): one tiny request with the SAME instructions and schema opens the kept-open connection and
 * writes the instructions into OpenAI's prompt cache (measured 2026-10-27: 1,392 of 1,467 input tokens cached from the next
 * call on). ⛔ Read to its end — a cancelled stream takes its connection with it. Fire and forget.
 */
export function warmConciergeBrain(): void {
  const cfg = openAiConfig()
  if (!cfg) return
  void (async () => {
    try {
      const input = 'Session starting: nothing was said yet. Reply with action kind "none", an empty say and no chips.'
      for await (const _ of streamJson(cfg, { instructions: conciergeInstructions(), input, schema: CONCIERGE_JSON_SCHEMA, schemaName: 'concierge_turn', maxOutputTokens: 60, signal: AbortSignal.timeout(15_000) })) {
        // its words are not used: the request opens the connection and fills the cache
      }
    } catch {
      // a warm-up: nothing to do
    }
  })()
}
