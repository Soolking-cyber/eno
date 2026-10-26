import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GoogleGenAI } from '@google/genai'
import { HEDGE_FIRST_MS, hedgedDeltas, TUTOR_JSON_SCHEMA, tutorAsk, tutorTurnStream, type TutorEvent } from './tutor-ai'

vi.mock('server-only', () => ({}))
// streamJson asks OpenAI through undici's own fetch (its kept-open pool — llm-openai.ts): here, the stubbed global one.
vi.mock('undici', () => ({ Agent: class {}, fetch: (u: string, init: RequestInit) => globalThis.fetch(u, init) }))
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers() })

/**
 * THE LIVE TURN'S BRAINS (owner, 2026-10-26: "delayless"): Gemini streamed with a hedge on its first word, OpenAI first
 * when configured, a brain that fails before a word was said handing over — and a harm flag never handed over.
 */
type Stream = { at: number; deltas: string[]; fail?: boolean }
/** A fake stream: after `at` ms its first delta (or its failure), then the rest; records whether it was stopped. */
function fakeStream(s: Stream, signal: AbortSignal, log: string[], name: string): AsyncGenerator<string> {
  return (async function* () {
    log.push(`${name} opened`)
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => { clearTimeout(t); log.push(`${name} stopped`); reject(new Error('aborted')) }
      const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, s.at)
      signal.addEventListener('abort', onAbort, { once: true })
    })
    if (s.fail) throw Object.assign(new Error(`${name} failed`), { status: 503 })
    for (const d of s.deltas) yield d
  })()
}
async function run(a: Stream, b: Stream) {
  const log: string[] = []
  let n = 0
  const out: string[] = []
  try {
    for await (const d of hedgedDeltas((sig) => fakeStream(n++ === 0 ? a : b, sig, log, n === 1 ? 'A' : 'B'), 50)) out.push(d)
  } catch (e) {
    out.push(`threw ${(e as Error).message}`)
  }
  return { out, log }
}

describe('hedgedDeltas — a second request when the first writes nothing in time', () => {
  it('the first writes in time: it alone is asked', async () => {
    expect(await run({ at: 5, deltas: ['a', 'b'] }, { at: 0, deltas: ['x'] })).toEqual({ out: ['a', 'b'], log: ['A opened'] })
  })
  it('the first is slow: the second is asked; whichever writes first wins and the other is stopped', async () => {
    const r = await run({ at: 200, deltas: ['a'] }, { at: 10, deltas: ['x', 'y'] })
    expect(r.out).toEqual(['x', 'y'])
    expect(r.log).toEqual(['A opened', 'B opened', 'A stopped'])
  })
  it('the first fails at once: the second is asked at once', async () => {
    expect((await run({ at: 1, deltas: [], fail: true }, { at: 5, deltas: ['x'] })).out).toEqual(['x'])
  })
  it('⛔ the second fails first while the first is still on its way: the first is waited for', async () => {
    expect((await run({ at: 150, deltas: ['a'] }, { at: 5, deltas: [], fail: true })).out).toEqual(['a'])
  })
  it('both fail: the turn hands over (throws)', async () => {
    expect((await run({ at: 1, deltas: [], fail: true }, { at: 1, deltas: [], fail: true })).out[0]).toMatch(/^threw/)
  })
  it('the hedge waits a little longer than Gemini usually takes to write (its p90 is ~10 s)', () => {
    expect(HEDGE_FIRST_MS).toBeGreaterThanOrEqual(2_000)
    expect(HEDGE_FIRST_MS).toBeLessThanOrEqual(4_000)
  })
})

const ctx = {
  avatarName: 'Anna', persona: '', level: 'A2', band: 'adult' as const, strictness: 'balanced' as const, focusNote: '',
  plan: { brief: '', focus: { goals: [], focusWords: [], recycle: [], drill: [] } as never }, workingOn: [], history: [],
  learnerText: 'I go market yesterday.', secondsLeft: 300, drillLeft: [], pace: { now: 'natural' as const, slower: true, faster: true },
}
const answer = (o: Record<string, unknown>) => JSON.stringify({ safety: 'none', pace: 'same', reply: '', expect: '', hint: 'I went to the market.', hintVi: 'Tôi đã đi chợ.', heardAs: [], ...o })
/** A Gemini client whose streamed answer is `json`, cut in 6-character chunks. */
const gemini = (json: string, calls: { n: number } = { n: 0 }) => ({
  models: {
    generateContentStream: async () => {
      calls.n += 1
      return (async function* () { for (let i = 0; i < json.length; i += 6) yield { text: json.slice(i, i + 6), candidates: [{}] } })()
    },
  },
}) as unknown as GoogleGenAI
async function events(ai: GoogleGenAI | null) { const out: TutorEvent[] = []; for await (const e of tutorTurnStream(ai, ctx)) out.push(e); return out }
const said = (ev: TutorEvent[]) => ev.flatMap((e) => (e.kind === 'say' ? [e.text] : []))

describe('tutorTurnStream — the voice pace (owner, 2026-10-26: "adults may adjust pace by saying talk more slowly")', () => {
  it('the schema writes the pace after safety and BEFORE the reply — OpenAI and Gemini alike', () => {
    expect(Object.keys(TUTOR_JSON_SCHEMA.properties).slice(0, 3)).toEqual(['safety', 'pace', 'reply'])
    expect(TUTOR_JSON_SCHEMA.required).toContain('pace')
    expect(tutorAsk(ctx).schema.propertyOrdering?.slice(0, 3)).toEqual(['safety', 'pace', 'reply'])
  })
  it('"slower" comes BEFORE the first sentence (the acknowledgement already sounds slower); "same" is no event', async () => {
    const ev = await events(gemini(answer({ pace: 'slower', reply: 'Sure, I will speak more slowly. How was your day?' })))
    expect(ev.map((e) => e.kind)).toEqual(['safety', 'pace', 'say', 'say', 'spoken', 'final'])
    expect(ev[1]).toEqual({ kind: 'pace', change: 'slower' })
    expect(ev.at(-1)).toMatchObject({ kind: 'final', reply: { pace: 'slower' } })
    const same = await events(gemini(answer({ reply: 'Nice! Tell me more.' })))
    expect(same.some((e) => e.kind === 'pace')).toBe(false)
  })
  it('a pace written AFTER the reply (Gemini orders properties as best it can) still counts — before the final', async () => {
    const late = JSON.stringify({ safety: 'none', reply: 'Okay. Faster now.', hint: '', hintVi: '', expect: '', heardAs: [], pace: 'faster' })
    const ev = await events(gemini(late))
    expect(ev.map((e) => e.kind)).toEqual(['safety', 'say', 'say', 'spoken', 'pace', 'final'])
  })
  it('the tutor is told the pace now and which way it may still go', () => {
    const text = (c: typeof ctx) => tutorAsk(c).contents[0].parts.map((p) => p.text).join('\n')
    expect(text({ ...ctx, pace: { now: 'slowest', slower: false, faster: true } } as never)).toContain('VOICE PACE: your voice is the slowest. Possible: "faster".')
    expect(text({ ...ctx, pace: { now: 'gentle', slower: true, faster: false } } as never)).toContain('Possible: "slower".')
    expect(text({ ...ctx, pace: { now: 'slowest', slower: false, faster: false } } as never)).toContain('Possible: neither — keep "same".')
  })
  it('⛔ ONE step a turn: a brain that wrote its pace and failed before a sentence hands over — the next one\'s pace is not a second step', async () => {
    vi.stubEnv('OPENAI_API_KEY', `sk-${'a'.repeat(40)}`)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '{"safety":"none","pace":"slower","reply":"Sure' })}\n\n`))
        setTimeout(() => c.error(new Error('connection reset')), 20)
      },
    }))))
    const ev = await events(gemini(answer({ pace: 'slower', reply: 'Sure. Slower now.' })))
    expect(ev.filter((e) => e.kind === 'pace')).toEqual([{ kind: 'pace', change: 'slower' }])
    expect(said(ev)).toEqual(['Sure.', 'Slower now.'])
  })
  it('⛔ a harm flag: no pace event', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const ev = await events(gemini(answer({ safety: 'harm', pace: 'slower', reply: 'Please tell a trusted adult.' })))
    expect(ev.some((e) => e.kind === 'pace')).toBe(false)
  })
})

describe('tutorTurnStream — Gemini streamed, sentence by sentence', () => {
  it('no OpenAI: Gemini’s sentences are handed over as they are written; the final reply is what was said', async () => {
    const ev = await events(gemini(answer({ reply: 'Good job! We say: I went to the market. What did you buy?' })))
    expect(ev[0]).toEqual({ kind: 'safety', harm: false })
    expect(said(ev)).toEqual(['Good job!', 'We say: I went to the market.', 'What did you buy?'])
    expect(ev.at(-1)).toMatchObject({ kind: 'final', model: 'gemini-3.8-flash', reply: { reply: 'Good job! We say: I went to the market. What did you buy?' } })
  })
  it('OpenAI fails before a word: Gemini takes the turn, and the calls count both', async () => {
    vi.stubEnv('OPENAI_API_KEY', `sk-${'a'.repeat(40)}`)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    const ev = await events(gemini(answer({ reply: 'Nice! Tell me more.' })))
    expect(said(ev)).toEqual(['Nice!', 'Tell me more.'])
    expect(ev.at(-1)).toMatchObject({ kind: 'final', calls: 2 })
  })
  it('⛔ a harm flag raised before the stream BREAKS is kept — never handed to another brain (review, codex P1)', async () => {
    vi.stubEnv('OPENAI_API_KEY', `sk-${'a'.repeat(40)}`)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '{"safety":"harm","reply":"I am so' })}\n\n`))
        setTimeout(() => c.error(new Error('connection reset')), 20) // after the flag was read (error() drops what is queued)
      },
    }))))
    const calls = { n: 0 }
    await expect(events(gemini(answer({ reply: 'Fine.' }), calls))).rejects.toMatchObject({ safety: true })
    expect(calls.n).toBe(0)
  })
  it('⛔ a phone number spread over sentences is never spoken (review, opus): the gate sees everything said so far', async () => {
    const ev = await events(gemini(answer({ reply: 'Great work today. Call 0901. 234. 567. Bye!' })))
    expect(said(ev)).toEqual(['Great work today.']) // not one digit of it
    expect(ev.at(-1)).toMatchObject({ kind: 'final', reply: { reply: 'Great work today.' } })
    // …while a reply whose numbers are harmless says them, once the whole reply has passed
    const ok = await events(gemini(answer({ reply: 'Nice! In 2024 you started English. That is two years now.' })))
    expect(said(ok)).toEqual(['Nice!', 'In 2024 you started English.', 'That is two years now.'])
  })
  it('⛔ a harm flag whose reply cannot be used is never handed to another brain', async () => {
    vi.stubEnv('OPENAI_API_KEY', `sk-${'a'.repeat(40)}`)
    const json = answer({ safety: 'harm', reply: 'Please call 0901 234 567 now.' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(c) {
        const enc = new TextEncoder()
        c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: json })}\n\n`))
        c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'response.completed' })}\n\n`))
        c.close()
      },
    }))))
    const calls = { n: 0 }
    await expect(events(gemini(answer({ reply: 'Fine.' }), calls))).rejects.toMatchObject({ safety: true })
    expect(calls.n).toBe(0) // Gemini was never asked
  })
})

/** An OpenAI answer streamed as server-sent events — `json` in `chunk`-character deltas, each delta after `gate()` when given. */
function openAiStream(json: string, chunk = 5, gate?: (sent: string) => Promise<void>) {
  vi.stubEnv('OPENAI_API_KEY', `sk-${'a'.repeat(40)}`)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
    async start(c) {
      const enc = new TextEncoder()
      for (let i = 0; i < json.length; i += chunk) {
        if (gate) await gate(json.slice(0, i))
        c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: json.slice(i, i + chunk) })}\n\n`))
      }
      c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'response.completed' })}\n\n`))
      c.close()
    },
  }))))
}

describe('tutorTurnStream — the reply\'s voice closes at its last sentence (owner, 2026-10-27: "need super fast response")', () => {
  it('the schema writes `expect` right after `reply` — OpenAI and Gemini alike', () => {
    expect(Object.keys(TUTOR_JSON_SCHEMA.properties).slice(0, 4)).toEqual(['safety', 'pace', 'reply', 'expect'])
    expect(TUTOR_JSON_SCHEMA.required.slice(0, 4)).toEqual(['safety', 'pace', 'reply', 'expect'])
    expect(tutorAsk(ctx).schema.propertyOrdering?.slice(0, 4)).toEqual(['safety', 'pace', 'reply', 'expect'])
  })
  it('⚡ no drill: `spoken` the moment `expect` is written empty — BEFORE the hint and its Vietnamese exist', async () => {
    const hintWritten = Promise.withResolvers<void>()
    let waited = false
    const json = answer({ reply: 'Nice! What did you buy?' })
    const cut = json.indexOf('"hint"')
    openAiStream(json, 5, async (sent) => { if (sent.length >= cut && !waited) { waited = true; await hintWritten.promise } })
    const ev: TutorEvent[] = []
    for await (const e of tutorTurnStream(null, ctx)) {
      ev.push(e)
      if (e.kind === 'spoken') hintWritten.resolve() // the rest of the answer is let through only now
    }
    expect(ev.map((e) => e.kind)).toEqual(['safety', 'say', 'say', 'spoken', 'final'])
    expect(ev[3]).toEqual({ kind: 'spoken', expect: null })
    expect(ev.at(-1)).toMatchObject({ kind: 'final', reply: { reply: 'Nice! What did you buy?', expect: null, hint: 'I went to the market.' } })
  })
  it('a drill: no early close — its request is said at the end, then `spoken` WITH the drill, then the final', async () => {
    openAiStream(answer({ reply: 'Good try. Let us practise the th sound.', expect: 'I think so.' }))
    const ev: TutorEvent[] = []
    for await (const e of tutorTurnStream(null, ctx)) ev.push(e)
    expect(ev.map((e) => e.kind)).toEqual(['safety', 'say', 'say', 'say', 'spoken', 'final'])
    expect(said(ev).at(-1)).toBe('Please say after me: I think so.')
    expect(ev[4]).toEqual({ kind: 'spoken', expect: 'I think so.' })
    expect(ev.at(-1)).toMatchObject({ kind: 'final', reply: { reply: 'Good try. Let us practise the th sound. Please say after me: I think so.', expect: 'I think so.' } })
  })
  it('⛔ a sentence held for the digit check: no early close — it is said once the whole reply passed, THEN `spoken`', async () => {
    openAiStream(answer({ reply: 'Nice! In 2024 you started English.' }))
    const ev: TutorEvent[] = []
    for await (const e of tutorTurnStream(null, ctx)) ev.push(e)
    expect(ev.map((e) => e.kind)).toEqual(['safety', 'say', 'say', 'spoken', 'final'])
    expect(said(ev)).toEqual(['Nice!', 'In 2024 you started English.'])
  })
  it('⛔ nothing said (an empty reply): no `spoken` — the brain hands over as before', async () => {
    openAiStream(answer({ reply: '' }))
    const calls = { n: 0 }
    const ev = await events(gemini(answer({ reply: 'Nice! Tell me more.' }), calls))
    expect(calls.n).toBe(1)
    expect(ev.filter((e) => e.kind === 'spoken')).toHaveLength(1) // Gemini's own, after its sentences
    expect(said(ev)).toEqual(['Nice!', 'Tell me more.'])
  })
  it('⛔ a harm flag: never `spoken` (its kind words are spoken by the caller after the save)', async () => {
    openAiStream(answer({ safety: 'harm', reply: 'Please tell a trusted adult.' }))
    const ev: TutorEvent[] = []
    for await (const e of tutorTurnStream(null, ctx)) ev.push(e)
    expect(ev.some((e) => e.kind === 'spoken' || e.kind === 'say')).toBe(false)
  })
  it('a brain that writes `expect` late (Gemini, best effort): `spoken` when it is written; nothing said after it', async () => {
    const late = JSON.stringify({ safety: 'none', pace: 'same', reply: 'Okay. Tell me more.', hint: 'h', hintVi: 'hv', expect: '', heardAs: [] })
    const ev = await events(gemini(late))
    expect(ev.map((e) => e.kind)).toEqual(['safety', 'say', 'say', 'spoken', 'final'])
    expect(ev.at(-1)).toMatchObject({ kind: 'final', reply: { reply: 'Okay. Tell me more.', expect: null } })
  })
})
