import type { GoogleGenAI } from '@google/genai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
/** The OpenAI brain, scripted per test: its config (null = no key) and the deltas each request streams. */
const llm = vi.hoisted(() => ({ openAiConfig: vi.fn(), streamJson: vi.fn() }))
vi.mock('@/lib/classroom/llm-openai', () => ({ openAiConfig: llm.openAiConfig, streamJson: llm.streamJson, partialString: () => null }))

import { PRIMARY_MODEL, ThinkingLevel } from '@/lib/classroom/ai'
import { CONCIERGE_JSON_SCHEMA, GEMINI_CONCIERGE_SCHEMA, conciergeInstructions } from './brief'
import { conciergeTurnStream, eventsOf, parseAction, warmConciergeBrain, type BrainError, type ConciergeEvent } from './brain'
import { NO_ACTION, type ConciergeAction } from './types'

/**
 * THE CONCIERGE'S BRAIN (PLAN §3, §10): one strict-JSON answer per turn, read while it is written — the action the moment
 * its object closes, then each sentence of `say` through the REAL speech guards (nothing mocked but the OpenAI client),
 * `spoken`, and the chips once the answer is whole. ⛔ No sentence before the action (Gemini's key order is best-effort);
 * ⛔ a second brain only while nothing went out.
 */
beforeEach(() => {
  llm.openAiConfig.mockReset()
  llm.streamJson.mockReset()
})

type Step = typeof eventsOf extends (...a: never[]) => AsyncGenerator<infer S> ? S : never

const ACTION: ConciergeAction = { kind: 'browse', mode: 'refine', category: 'teachers', subcategory: '', filters: [{ key: 'workIn', value: 'd1' }], search: '', target: '' }
const SAY = 'Showing teachers who can teach in District 1. Native speaker, or is fluent English fine?'
const S1 = 'Showing teachers who can teach in District 1.'
const S2 = 'Native speaker, or is fluent English fine?'
const CHIPS = ['Native', 'Fluent is fine']
/** The owner's example as OpenAI writes it — the schema's order (PLAN §1, §10). */
const SAMPLE = '{"action":{"kind":"browse","mode":"refine","category":"teachers","subcategory":"","filters":[{"key":"workIn","value":"d1"}],"search":"","target":""},"say":"Showing teachers who can teach in District 1. Native speaker, or is fluent English fine?","chips":["Native","Fluent is fine"]}'
/** The same answer as Gemini may write it: `say` first. */
const GEMINI_ORDER = JSON.stringify({ say: SAY, action: ACTION, chips: CHIPS })
const NONE = { kind: 'none', mode: 'refine', category: '', subcategory: '', filters: [], search: '', target: '' }
/** An answer with no action and these words. */
const answer = (say: string, chips: unknown = []) => JSON.stringify({ action: NONE, say, chips })

/** `json` as deltas of `size` characters; `fed()` = how much of it the reader has pulled so far. */
function deltas(json: string, size: number) {
  let fed = 0
  const it = (async function* () {
    for (let i = 0; i < json.length; i += size) {
      fed = Math.min(json.length, i + size)
      yield json.slice(i, i + size)
    }
  })()
  return { it, fed: () => fed }
}
/** The steps of one answer, each with how much of the answer had been read when it came out, and how it ended. */
async function read(json: string, o: { size?: number; teacherTurn?: boolean } = {}) {
  const d = deltas(json, o.size ?? Math.max(1, json.length))
  const steps: { step: Step; at: number }[] = []
  try {
    for await (const step of eventsOf(d.it, o.teacherTurn ?? false)) steps.push({ step, at: d.fed() })
    return { steps, error: null as unknown }
  } catch (e) {
    return { steps, error: e }
  }
}
const stepsOf = async (json: string, o: { size?: number; teacherTurn?: boolean } = {}) => (await read(json, o)).steps.map((s) => s.step)
const saidOf = (steps: Step[]) => steps.flatMap((s) => (s.kind === 'say' ? [s.text] : []))
const doneOf = (steps: Step[]) => steps.find((s): s is Extract<Step, { kind: 'done' }> => s.kind === 'done')
/** The first chunk boundary at or after `offset` when `json` is fed `size` characters at a time. */
const chunkEnd = (json: string, offset: number, size: number) => Math.min(json.length, Math.ceil(offset / size) * size)

describe('eventsOf — the order: action → say(s) → spoken → done', () => {
  const ACTION_END = SAMPLE.indexOf(',"say":')
  /** The first sentence ends once the space after "District 1." is in. */
  const FIRST_AT = SAMPLE.indexOf('District 1. ') + 'District 1. '.length
  const SAY_END = SAMPLE.indexOf(',"chips":')

  for (const size of [1, 2, 3, 4, 5, 6, 7]) {
    it(`${size}-character deltas: the action at the delta that closes it, each sentence the moment it ends, chips at the end`, async () => {
      const r = await read(SAMPLE, { size, teacherTurn: true })
      expect(r.error).toBeNull()
      expect(r.steps).toEqual([
        { step: { kind: 'action', action: ACTION }, at: chunkEnd(SAMPLE, ACTION_END, size) },
        { step: { kind: 'say', text: S1 }, at: chunkEnd(SAMPLE, FIRST_AT, size) },
        { step: { kind: 'say', text: S2 }, at: chunkEnd(SAMPLE, SAY_END, size) },
        { step: { kind: 'spoken' }, at: chunkEnd(SAMPLE, SAY_END, size) },
        { step: { kind: 'done', said: SAY, chips: CHIPS }, at: SAMPLE.length },
      ])
    })
  }

  it('the whole answer in one delta: the same steps', async () => {
    expect(await stepsOf(SAMPLE, { teacherTurn: true })).toEqual([
      { kind: 'action', action: ACTION }, { kind: 'say', text: S1 }, { kind: 'say', text: S2 }, { kind: 'spoken' }, { kind: 'done', said: SAY, chips: CHIPS },
    ])
  })
})

describe('eventsOf — ⛔ no sentence before the action (PLAN §10: Gemini writing `say` first)', () => {
  const ACTION_END = GEMINI_ORDER.indexOf(',"chips":')

  for (const size of [1, 2, 3, 4, 5, 6, 7]) {
    it(`${size}-character deltas: every sentence is HELD until the action closes, then follows it at once`, async () => {
      const r = await read(GEMINI_ORDER, { size, teacherTurn: true })
      const at = chunkEnd(GEMINI_ORDER, ACTION_END, size)
      expect(r.steps).toEqual([
        { step: { kind: 'action', action: ACTION }, at },
        { step: { kind: 'say', text: S1 }, at },
        { step: { kind: 'say', text: S2 }, at },
        { step: { kind: 'spoken' }, at },
        { step: { kind: 'done', said: SAY, chips: CHIPS }, at: GEMINI_ORDER.length },
      ])
    })
  }

  it('chips written between say and action: still action first', async () => {
    const json = JSON.stringify({ say: SAY, chips: CHIPS, action: ACTION })
    for (const size of [1, 4, 7]) expect((await stepsOf(json, { size })).map((s) => s.kind)).toEqual(['action', 'say', 'say', 'spoken', 'done'])
  })

  it('an answer that never writes an action: no action, then the held sentences — at the end, still in that order', async () => {
    const json = JSON.stringify({ say: 'Happy to help. What are you looking for?', chips: [] })
    expect(await stepsOf(json, { size: 3 })).toEqual([
      { kind: 'action', action: NO_ACTION },
      { kind: 'say', text: 'Happy to help.' },
      { kind: 'say', text: 'What are you looking for?' },
      { kind: 'spoken' },
      { kind: 'done', said: 'Happy to help. What are you looking for?', chips: [] },
    ])
  })

  it('an answer with no say: the action, spoken, done', async () => {
    expect(await stepsOf(JSON.stringify({ action: ACTION, chips: [] }), { size: 5 })).toEqual([
      { kind: 'action', action: ACTION }, { kind: 'spoken' }, { kind: 'done', said: '', chips: [] },
    ])
  })
})

describe('eventsOf — sentences', () => {
  it('split at . ! ? … (with a closing quote or bracket) followed by whitespace; the last piece when say closes', async () => {
    const steps = await stepsOf(answer('Sure! Is it for a child? Or an adult… "Fine." (Noted.)\nCosts 1.5 million. Done'), { size: 4 })
    expect(saidOf(steps)).toEqual(['Sure!', 'Is it for a child?', 'Or an adult…', '"Fine."', '(Noted.)', 'Costs 1.5 million.', 'Done'])
  })

  it('markdown and stray symbols are stripped, whitespace folded', async () => {
    expect(saidOf(await stepsOf(answer('**Showing**  `teachers` in _District 1_. # Next?'), { size: 2 }))).toEqual(['Showing teachers in District 1.', 'Next?'])
  })

  it('a sentence is never spoken half-written: no say step until its end has arrived', async () => {
    const json = answer('Showing rooms in District 7. Want a balcony?')
    const r = await read(json, { size: 1 })
    const first = r.steps.find((s) => s.step.kind === 'say')!
    expect(first.step).toEqual({ kind: 'say', text: 'Showing rooms in District 7.' })
    expect(first.at).toBe(json.indexOf('District 7. ') + 'District 7. '.length)
  })
})

describe('eventsOf — the speech guards (real, nothing mocked)', () => {
  it('a sentence with a phone number, an email or a visa word is dropped; the others are said', async () => {
    const say = 'Showing rooms in District 7. Call 0901 234 567 for a viewing. Write to an.nguyen@gmail.com today. We can sort out your visa too. Anything else?'
    const steps = await stepsOf(answer(say), { size: 5 })
    expect(saidOf(steps)).toEqual(['Showing rooms in District 7.', 'Anything else?'])
    expect(doneOf(steps)?.said).toBe('Showing rooms in District 7. Anything else?')
  })

  it("the teachers' counsel words are out on a teacher turn only", async () => {
    const json = answer('Showing foreign teachers in District 1. Native or fluent?')
    expect(saidOf(await stepsOf(json, { teacherTurn: true }))).toEqual(['Native or fluent?'])
    expect(saidOf(await stepsOf(json, { teacherTurn: false }))).toEqual(['Showing foreign teachers in District 1.', 'Native or fluent?'])
  })

  it('a number spread over sentences: the piece that completes it is dropped, and the whole number is never said', async () => {
    const steps = await stepsOf(answer('Call 0901. 234. 567. Anything else?'), { size: 3 })
    expect(saidOf(steps)).not.toContain('567.')
    expect(saidOf(steps)).toContain('Anything else?')
    expect((doneOf(steps)?.said ?? '').replace(/\D/g, '')).not.toContain('0901234567')
  })

  // Regression (found here 2026-10-27, fixed) — it was: brain.ts:114 checks each sentence together with what was ALREADY said, so a number spread over sentences is
  // caught only at its LAST piece: "Call 0901." and "234." are voiced before "567." exists (7 of 10 digits out). The
  // classroom found exactly this on 2026-10-26 (tutor-ai.ts sentencesOf: "the first pieces of a number are out before its
  // last piece exists") and holds a sentence with a digit until the whole reply has passed; the concierge does not.
  it('no piece of a number spread over sentences is voiced', async () => {
    const said = saidOf(await stepsOf(answer('Call 0901. 234. 567. Anything else?'), { size: 3 }))
    expect(said.join(' ')).not.toMatch(/0901|234/)
  })

  // Regression (found here 2026-10-27, fixed) — it was: guards.ts carriesPhone joins digits only across spaces, dots and dashes, and brain.ts:114 re-checks the joined
  // sentences with that same rule — so one word between the pieces ("Call 0901 234. Then dial 567.") passes alone AND
  // joined, and the whole ten-digit number is voiced. The classroom's contact-gate.ts caps a reply's digits for exactly
  // this ("a model can spread [a number] over sentences, words and punctuation that the pattern gates do not join").
  it('a phone number split by a word across two sentences is not voiced whole', async () => {
    const said = (doneOf(await stepsOf(answer('Call 0901 234. Then dial 567. Anything else?'), { size: 3 }))?.said ?? '')
    expect(said.replace(/\D/g, '')).not.toContain('0901234567')
  })
})

describe('eventsOf — commit review, round 1', () => {
  it('a teachers action makes it a teacher turn before anything is said (opus: "someone to teach my son" names no teacher)', async () => {
    const json = JSON.stringify({ action: ACTION, say: 'Showing foreign teachers in District 1. Which subject?', chips: ['Foreign only', 'Any'] })
    const { steps } = await read(json, { teacherTurn: false })
    const said = steps.flatMap(({ step }) => (step.kind === 'say' ? [step.text] : []))
    expect(said).toEqual(['Which subject?'])
    expect(steps.at(-1)?.step).toMatchObject({ kind: 'done', chips: ['Any'] })
  })

  it('chips that spell a number TOGETHER are not shown (codex: "Call 0901" · "234" · "567")', async () => {
    const { steps } = await read(answer('Want me to call?', ['Call 0901', '234', '567', 'No thanks']))
    expect(steps.at(-1)?.step).toMatchObject({ kind: 'done', chips: ['No thanks'] })
  })

  it('a chip with a digit or two that spells nothing stays ("2 bedrooms")', async () => {
    const { steps } = await read(answer('How many bedrooms?', ['1 bedroom', '2 bedrooms', '3 or more']))
    expect(steps.at(-1)?.step).toMatchObject({ kind: 'done', chips: ['1 bedroom', '2 bedrooms', '3 or more'] })
  })
})

describe('eventsOf — the word cap (70 words a turn)', () => {
  // (Not "one two three …": ten number words in a row are a phone number spelled out, and the guards drop them.)
  const TEN = 'Alpha bravo charlie delta echo foxtrot golf hotel india juliet.'

  it('once 70 words were said, no further sentence is', async () => {
    const steps = await stepsOf(answer(Array.from({ length: 10 }, () => TEN).join(' ')), { size: 6 })
    expect(saidOf(steps)).toHaveLength(7)
    expect(doneOf(steps)?.said.split(' ')).toHaveLength(70)
  })

  it('the cap counts held sentences too (say before action)', async () => {
    const json = JSON.stringify({ say: Array.from({ length: 9 }, () => TEN).join(' '), action: ACTION, chips: [] })
    expect(saidOf(await stepsOf(json, { size: 6 }))).toHaveLength(7)
  })

  // Regression (found here 2026-10-27, fixed) — it was: brain.ts:111 tests the cap BEFORE adding the sentence (`words >= MAX_WORDS`), so the sentence that crosses 70 is
  // voiced whole: one 100-word sentence is all spoken, though MAX_WORDS is "what the voice says at most per turn" (the
  // tutor stops when the words said + the next sentence would pass its limit).
  it('the voice never says more than 70 words in a turn', async () => {
    const long = `${Array.from({ length: 100 }, (_, n) => `word${n}`).join(' ')}.`
    const said = doneOf(await stepsOf(answer(long), { size: 6 }))?.said ?? ''
    expect(said ? said.split(' ').length : 0).toBeLessThanOrEqual(70)
  })
})

describe('eventsOf — chips', () => {
  it('strings only, trimmed, at most 28 characters, at most four', async () => {
    const chips = ['  Native  ', '', '   ', 'x'.repeat(29), 7, null, { a: 1 }, 'Fluent is fine', 'x'.repeat(28), 'Either', 'Child', 'Adult']
    expect(doneOf(await stepsOf(answer('Native or fluent?', chips)))?.chips).toEqual(['Native', 'Fluent is fine', 'x'.repeat(28), 'Either'])
  })

  it('no array, no chips', async () => {
    expect(doneOf(await stepsOf(answer('Okay.', 'Native')))?.chips).toEqual([])
    expect(doneOf(await stepsOf(JSON.stringify({ action: NONE, say: 'Okay.' })))?.chips).toEqual([])
  })

  // Regression (found here 2026-10-27, fixed) — it was: brain.ts:192 chipsOf checks only type and length, never speakable(). A chip is eno.vn's own text on screen (and the
  // next turn's words when tapped), so "Visa help", "Zalo 0901234567" or an email would show, though PLAN §5 keeps visa
  // words and contact details out of the OUTPUT — the guards exist because "a model can be steered by the very listing
  // text it reads" (guards.ts), and the chips come from that same model.
  it('a chip that could not be spoken is not shown either', async () => {
    const chips = ['Native', 'Visa help', 'Zalo 0901234567', 'Mail an@gmail.com']
    expect(doneOf(await stepsOf(answer('Native or fluent?', chips)))?.chips).toEqual(['Native'])
  })
})

describe('eventsOf — a cut answer', () => {
  it('cut after the say closed: everything said comes out, then it throws (the caller decides: hand over or fail)', async () => {
    const r = await read(SAMPLE.slice(0, -1), { size: 7, teacherTurn: true })
    expect(r.steps.map((s) => s.step.kind)).toEqual(['action', 'say', 'say', 'spoken'])
    expect(r.error).toBeInstanceOf(SyntaxError)
  })

  it('cut mid-say: the finished sentence only, then it throws — the half sentence is never said', async () => {
    const r = await read(SAMPLE.slice(0, SAMPLE.indexOf('Native speaker') + 9), { size: 4, teacherTurn: true })
    expect(r.steps.map((s) => s.step)).toEqual([{ kind: 'action', action: ACTION }, { kind: 'say', text: S1 }])
    expect(r.error).toBeInstanceOf(SyntaxError)
  })

  it('cut before the action closed, or nothing written: no step at all, then it throws', async () => {
    for (const json of [SAMPLE.slice(0, 60), GEMINI_ORDER.slice(0, GEMINI_ORDER.indexOf('"action"') + 20), '']) {
      const r = await read(json, { size: 5 })
      expect(r.steps).toEqual([])
      expect(r.error).toBeInstanceOf(SyntaxError)
    }
  })
})

describe('parseAction — the action shape-checked (its meaning is actions.ts\'s)', () => {
  it('the sample action, as written', () => {
    expect(parseAction(JSON.stringify(ACTION))).toEqual(ACTION)
  })

  it('anything malformed is no action', () => {
    for (const raw of ['', 'not json', '{"kind":"browse"', 'null', '42', 'true', '"browse"', '[]', '[{"kind":"browse"}]']) expect(parseAction(raw), raw).toEqual(NO_ACTION)
  })

  it('a find keeps its fields (turn.ts reads its view, then asks again)', () => {
    expect(parseAction(JSON.stringify({ ...ACTION, kind: 'find' }))).toEqual({ ...ACTION, kind: 'find' })
  })

  it('kind none, a missing kind or one outside the five is no action — whatever else it carries', () => {
    for (const kind of ['none', undefined, 'navigate', 'BROWSE', ' browse', 'FIND', 'search', 1, null]) {
      expect(parseAction(JSON.stringify({ kind, mode: 'replace', category: 'teachers', filters: [{ key: 'district', value: 'd1' }] })), String(kind)).toEqual(NO_ACTION)
    }
  })

  it('every text field is a trimmed string with a length cap; anything else is empty', () => {
    const a = parseAction(JSON.stringify({ kind: 'listing', mode: 'replace', category: `  ${'t'.repeat(50)}  `, subcategory: 7, filters: 'district=d1', search: `  ${'s'.repeat(80)}  `, target: ` ${'c'.repeat(70)} ` }))
    expect(a).toEqual({ kind: 'listing', mode: 'replace', category: 't'.repeat(40), subcategory: '', filters: [], search: 's'.repeat(60), target: 'c'.repeat(60) })
  })

  it('filters: at most eight, each key and value trimmed and capped; an entry without both is dropped', () => {
    const ten = Array.from({ length: 10 }, (_, n) => ({ key: ` k${n} `, value: ` v${n} ` }))
    expect(parseAction(JSON.stringify({ kind: 'browse', filters: ten })).filters).toEqual(Array.from({ length: 8 }, (_, n) => ({ key: `k${n}`, value: `v${n}` })))
    const odd = [{ key: 'district', value: 'd1' }, null, 'native', { key: '', value: 'x' }, { key: 'x', value: '   ' }, { key: 'native', value: 5 }, { value: 'x' }, { key: 'k'.repeat(50), value: 'v'.repeat(130) }]
    expect(parseAction(JSON.stringify({ kind: 'browse', filters: odd })).filters).toEqual([{ key: 'district', value: 'd1' }, { key: 'k'.repeat(40), value: 'v'.repeat(120) }])
  })

  it('mode defaults to refine; only "replace" replaces', () => {
    for (const mode of [undefined, 'refine', 'REPLACE', 'merge', '', null, true]) expect(parseAction(JSON.stringify({ kind: 'browse', mode })).mode, String(mode)).toBe('refine')
    expect(parseAction(JSON.stringify({ kind: 'page', mode: 'replace', target: 'help' }))).toEqual({ ...NO_ACTION, kind: 'page', mode: 'replace', target: 'help' })
  })
})

/* ── conciergeTurnStream: OpenAI first, Gemini second, a hand-over only while nothing went out ──────────────────────── */

const CFG = { key: `sk-${'a'.repeat(40)}`, model: 'gpt-6-luna', url: 'https://api.openai.com', firstTokenMs: 4_000, tier: 'priority' }
const INPUT = 'PAGE …\n\nWHAT THE PERSON JUST SAID: I need a teacher in District 1'

/** OpenAI's stream: `text` in 7-character deltas, then `fail` (thrown) if given. */
function openAiSays(text: string, fail?: Error) {
  llm.openAiConfig.mockReturnValue(CFG)
  llm.streamJson.mockImplementation(() => (async function* () {
    for (let i = 0; i < text.length; i += 7) yield text.slice(i, i + 7)
    if (fail) throw fail
  })())
}
/** A Gemini client whose streamed answer is `text` in 6-character chunks (or that fails / stops at its token cap). */
function gemini(text: string, o: { fail?: Error; maxTokens?: boolean } = {}) {
  const generateContentStream = vi.fn(async (_req: unknown) => {
    if (o.fail) throw o.fail
    return (async function* () {
      if (o.maxTokens) { yield { text: text.slice(0, 6), candidates: [{ finishReason: 'MAX_TOKENS' }] }; return }
      for (let i = 0; i < text.length; i += 6) yield { text: text.slice(i, i + 6), candidates: [{}] }
    })()
  })
  return { ai: { models: { generateContentStream } } as unknown as GoogleGenAI, generateContentStream }
}
async function turn(ai: GoogleGenAI | null, o: { teacherTurn?: boolean; signal?: AbortSignal } = {}) {
  const events: ConciergeEvent[] = []
  try {
    for await (const e of conciergeTurnStream(ai, { input: INPUT, teacherTurn: o.teacherTurn ?? true }, o.signal)) events.push(e)
    return { events, error: null as BrainError | null }
  } catch (e) {
    return { events, error: e as BrainError }
  }
}
const kinds = (ev: ConciergeEvent[]) => ev.map((e) => e.kind)
const finalOf = (ev: ConciergeEvent[]) => ev.find((e): e is Extract<ConciergeEvent, { kind: 'final' }> => e.kind === 'final')

describe('conciergeTurnStream — OpenAI first', () => {
  it('OpenAI answers: its events, one call, the final names its model — Gemini is never asked', async () => {
    openAiSays(SAMPLE)
    const g = gemini(SAMPLE)
    const ac = new AbortController()
    const r = await turn(g.ai, { signal: ac.signal })
    expect(r.error).toBeNull()
    expect(r.events).toEqual([
      { kind: 'action', action: ACTION }, { kind: 'say', text: S1 }, { kind: 'say', text: S2 }, { kind: 'spoken' },
      { kind: 'final', said: SAY, chips: CHIPS, model: 'gpt-6-luna', calls: 1 },
    ])
    expect(g.generateContentStream).not.toHaveBeenCalled()
    expect(llm.streamJson).toHaveBeenCalledTimes(1)
    const [cfg, req] = llm.streamJson.mock.calls[0]
    expect(cfg).toBe(CFG)
    expect(req).toMatchObject({ instructions: conciergeInstructions(), input: INPUT, schema: CONCIERGE_JSON_SCHEMA, schemaName: 'concierge_turn', maxOutputTokens: 400, firstTokenMs: 2_500 })
    expect(req.signal).toBe(ac.signal)
  })

  it('the teacher-turn flag reaches the speech guards', async () => {
    const json = answer('Showing foreign teachers. Native or fluent?')
    openAiSays(json)
    expect(finalOf((await turn(null, { teacherTurn: true })).events)?.said).toBe('Native or fluent?')
    openAiSays(json)
    expect(finalOf((await turn(null, { teacherTurn: false })).events)?.said).toBe('Showing foreign teachers. Native or fluent?')
  })
})

describe('conciergeTurnStream — ⛔ a hand-over only BEFORE any output', () => {
  it('OpenAI fails before writing: Gemini answers (its model, two calls)', async () => {
    openAiSays('', Object.assign(new Error('openai 503'), { status: 503 }))
    const g = gemini(GEMINI_ORDER)
    const r = await turn(g.ai)
    expect(r.error).toBeNull()
    expect(kinds(r.events)).toEqual(['action', 'say', 'say', 'spoken', 'final'])
    expect(finalOf(r.events)).toEqual({ kind: 'final', said: SAY, chips: CHIPS, model: PRIMARY_MODEL, calls: 2 })
    expect(g.generateContentStream).toHaveBeenCalled()
  })

  it('OpenAI fails with half an action written: nothing went out, so Gemini answers', async () => {
    openAiSays(SAMPLE.slice(0, 50), new Error('connection reset'))
    const r = await turn(gemini(SAMPLE).ai)
    expect(r.error).toBeNull()
    expect(finalOf(r.events)).toMatchObject({ model: PRIMARY_MODEL, calls: 2, said: SAY })
  })

  it('OpenAI ends its stream with the action unfinished (a cut answer): Gemini answers', async () => {
    openAiSays(SAMPLE.slice(0, 80))
    const r = await turn(gemini(SAMPLE).ai)
    expect(r.error).toBeNull()
    expect(finalOf(r.events)).toMatchObject({ model: PRIMARY_MODEL, calls: 2 })
  })

  it('OpenAI HELD a sentence (say first) and failed before its action closed: held words are not output — never voiced; Gemini answers', async () => {
    openAiSays('{"say":"Showing tutors in District 3. Native or', new Error('connection reset'))
    const r = await turn(gemini(SAMPLE).ai)
    expect(r.error).toBeNull()
    expect(saidOf(r.events as Step[])).toEqual([S1, S2])
    expect(JSON.stringify(r.events)).not.toContain('District 3')
  })

  it('OpenAI fails AFTER its action went out: no second brain — the turn throws with emitted: true', async () => {
    const ACTION_END = SAMPLE.indexOf(',"say":')
    openAiSays(SAMPLE.slice(0, ACTION_END), new Error('connection reset'))
    const g = gemini(SAMPLE)
    const r = await turn(g.ai)
    expect(r.events).toEqual([{ kind: 'action', action: ACTION }])
    expect(r.error).toBeInstanceOf(Error)
    expect(r.error).toMatchObject({ message: 'connection reset', emitted: true, calls: 1 })
    expect(g.generateContentStream).not.toHaveBeenCalled()
  })

  it('OpenAI fails after a sentence was said: no second brain either', async () => {
    openAiSays(SAMPLE.slice(0, SAMPLE.indexOf('Native speaker')), new Error('connection reset'))
    const g = gemini(SAMPLE)
    const r = await turn(g.ai)
    expect(r.events).toEqual([{ kind: 'action', action: ACTION }, { kind: 'say', text: S1 }])
    expect(r.error).toMatchObject({ emitted: true, calls: 1 })
    expect(g.generateContentStream).not.toHaveBeenCalled()
  })

  it('OpenAI cut AFTER everything was said (the answer never closed): throws with emitted: true, no second brain', async () => {
    openAiSays(SAMPLE.slice(0, -1))
    const g = gemini(SAMPLE)
    const r = await turn(g.ai)
    expect(kinds(r.events)).toEqual(['action', 'say', 'say', 'spoken'])
    expect(r.error).toBeInstanceOf(SyntaxError)
    expect(r.error).toMatchObject({ emitted: true, calls: 1 })
    expect(g.generateContentStream).not.toHaveBeenCalled()
  })

  it('the turn was cancelled: no hand-over even though nothing went out', async () => {
    const ac = new AbortController()
    ac.abort()
    openAiSays('', Object.assign(new Error('aborted'), { status: 504 }))
    const g = gemini(SAMPLE)
    const r = await turn(g.ai, { signal: ac.signal })
    expect(r.events).toEqual([])
    expect(r.error).toMatchObject({ message: 'aborted', emitted: false, calls: 1 })
    expect(g.generateContentStream).not.toHaveBeenCalled()
  })
})

describe('conciergeTurnStream — no brain', () => {
  it('no OpenAI key and no Gemini client: throws concierge_brain_unavailable, nothing emitted, no call', async () => {
    llm.openAiConfig.mockReturnValue(null)
    const r = await turn(null)
    expect(r.events).toEqual([])
    expect(r.error).toBeInstanceOf(Error)
    expect(r.error).toMatchObject({ message: 'concierge_brain_unavailable', emitted: false, calls: 0 })
    expect(llm.streamJson).not.toHaveBeenCalled()
  })

  it('every brain fails before writing: concierge_brain_unavailable after both were asked', async () => {
    openAiSays('', new Error('openai down'))
    const g = gemini('', { fail: new Error('vertex down') })
    const r = await turn(g.ai)
    expect(r.events).toEqual([])
    expect(r.error).toMatchObject({ message: 'concierge_brain_unavailable', emitted: false, calls: 2 })
    expect(g.generateContentStream).toHaveBeenCalled()
  })

  it('Gemini stopped at its token cap before writing anything: nothing to hand over to — unavailable', async () => {
    llm.openAiConfig.mockReturnValue(null)
    const r = await turn(gemini(SAMPLE, { maxTokens: true }).ai)
    expect(r.events).toEqual([])
    expect(r.error).toMatchObject({ message: 'concierge_brain_unavailable', emitted: false, calls: 1 })
  })
})

describe('conciergeTurnStream — Gemini alone (no OpenAI key)', () => {
  it("answers with one call; the request carries the concierge's instructions and schema, thinking LOW (never MINIMAL)", async () => {
    llm.openAiConfig.mockReturnValue(null)
    const g = gemini(GEMINI_ORDER)
    const r = await turn(g.ai)
    expect(r.error).toBeNull()
    expect(finalOf(r.events)).toEqual({ kind: 'final', said: SAY, chips: CHIPS, model: PRIMARY_MODEL, calls: 1 })
    const req = g.generateContentStream.mock.calls[0][0] as { model: string; contents: unknown; config: Record<string, unknown> & { thinkingConfig: { thinkingLevel: unknown }; abortSignal: unknown } }
    expect(req.model).toBe(PRIMARY_MODEL)
    expect(req.contents).toEqual([{ role: 'user', parts: [{ text: INPUT }] }])
    expect(req.config).toMatchObject({ systemInstruction: conciergeInstructions(), responseMimeType: 'application/json', responseJsonSchema: GEMINI_CONCIERGE_SCHEMA })
    expect(req.config.thinkingConfig.thinkingLevel).toBe(ThinkingLevel.LOW)
    expect(req.config.abortSignal).toBeInstanceOf(AbortSignal)
  })
})

describe('warmConciergeBrain', () => {
  it('no OpenAI key: nothing is asked', () => {
    llm.openAiConfig.mockReturnValue(null)
    warmConciergeBrain()
    expect(llm.streamJson).not.toHaveBeenCalled()
  })

  it('one tiny request with the SAME instructions and schema (the cached prefix), read to its end', async () => {
    llm.openAiConfig.mockReturnValue(CFG)
    const seen = { pulled: 0, ended: false }
    llm.streamJson.mockImplementation(() => (async function* () {
      for (const d of ['{"action":{"kind":"none"', ',"mode":"refine"}', ',"say":"","chips":[]}']) { seen.pulled++; yield d }
      seen.ended = true
    })())
    warmConciergeBrain()
    await vi.waitFor(() => expect(seen.ended).toBe(true))
    expect(seen.pulled).toBe(3)
    expect(llm.streamJson).toHaveBeenCalledWith(CFG, expect.objectContaining({ instructions: conciergeInstructions(), schema: CONCIERGE_JSON_SCHEMA, schemaName: 'concierge_turn', maxOutputTokens: 60 }))
  })

  it('a failed warm-up is swallowed', async () => {
    llm.openAiConfig.mockReturnValue(CFG)
    let threw = false
    llm.streamJson.mockImplementation(() => (async function* () { threw = true; yield* []; throw new Error('openai down') })())
    expect(() => warmConciergeBrain()).not.toThrow()
    await vi.waitFor(() => expect(threw).toBe(true))
    await new Promise((r) => setTimeout(r, 5))
  })
})
