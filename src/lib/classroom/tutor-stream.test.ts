import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GoogleGenAI } from '@google/genai'
import { HEDGE_FIRST_MS, hedgedDeltas, tutorTurnStream, type TutorEvent } from './tutor-ai'

vi.mock('server-only', () => ({}))
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
  learnerText: 'I go market yesterday.', secondsLeft: 300, drillLeft: [],
}
const answer = (o: Record<string, unknown>) => JSON.stringify({ safety: 'none', reply: '', hint: 'I went to the market.', hintVi: 'Tôi đã đi chợ.', expect: '', heardAs: [], ...o })
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
