// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TurnResult } from './session-turn'
import type { SavedReply, TurnLine } from './turn-stream'

/**
 * POST /api/classroom/sessions/<id>/turns, AS THE CLIENT READS IT (owner 2026-10-26: "delayless"): a refusal is the usual
 * `{ error }`; an answer is JSON lines, each written the moment turn-stream.ts has it — and a client that goes away
 * mid-answer stops it without an unhandled error. The lines themselves are turn-stream.test.ts's; processTurn's rows are
 * flows.pg.test.ts's, against a real Postgres.
 */
const h = vi.hoisted(() => ({ result: null as unknown, error: null as unknown, calls: [] as unknown[][], logs: [] as unknown[][] }))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => ({ id: 'p1' }), getCurrentProfileId: async () => 'p1', getAdmin: async () => null }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.7' }))
vi.mock('@/lib/log', () => ({ logWarn: (...a: unknown[]) => { h.logs.push(a) }, logError: (...a: unknown[]) => { h.logs.push(a) }, logInfo: () => {} }))
vi.mock('@/lib/classroom/session-turn', () => ({
  processTurn: async (...args: unknown[]) => {
    h.calls.push(args)
    if (h.error) throw h.error
    return h.result
  },
}))

const { POST } = await import('@/app/api/classroom/sessions/[id]/turns/route')
const { ApiError } = await import('@/lib/api/handler')

afterEach(() => {
  h.result = null
  h.error = null
  h.calls.length = 0
  h.logs.length = 0
})

const SAVED: SavedReply = {
  seq: 3, learnerText: 'I go to school yesterday', reply: 'Nice! You went to school yesterday. What did you learn there today?', hint: 'I learned maths.',
  hintVi: 'Em đã học toán.', expect: null, heardAs: [{ heard: 'go', meant: 'went' }], secondsLeft: 412,
}
/** An answer whose lines come from `gen`; `stopped` records the route's stop(). */
const answer = (gen: AsyncGenerator<TurnLine, void, undefined>, stopped: { n: number } = { n: 0 }): TurnResult => ({ kind: 'answer', lines: gen, stop: () => { stopped.n += 1 }, done: Promise.resolve() })
async function* of(...l: TurnLine[]): AsyncGenerator<TurnLine, void, undefined> { yield* l }
const send = () => POST(
  new Request('http://localhost/api/classroom/sessions/s1/turns', { method: 'POST', headers: { 'content-type': 'audio/wav', 'x-turn-id': 'turn-abcdefgh' }, body: new Uint8Array(64) }),
  { params: Promise.resolve({ id: 's1' }) },
)
const decoder = new TextDecoder()
/** The body as the client parses it: every line ended by "\n", each one JSON. */
async function lines(res: Response) {
  const text = await res.text()
  expect(text.endsWith('\n')).toBe(true)
  return text.slice(0, -1).split('\n').map((l) => JSON.parse(l) as Record<string, unknown>)
}
const settle = () => new Promise((r) => setTimeout(r, 20))

describe('the turn route’s answer, line by line', () => {
  it('silence: one line, and the stream ends', async () => {
    h.result = { kind: 'silence' }
    const res = await send()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.text()).toBe('{"kind":"silence"}\n')
    expect(h.calls).toEqual([['s1', 'p1', 'turn-abcdefgh', Buffer.alloc(64)]])
  })

  it('an answer: every line as turn-stream.ts wrote it, in order, each ended by a line break; nginx told not to buffer', async () => {
    const all: TurnLine[] = [
      { kind: 'heard', learnerText: 'I go to school yesterday' },
      { kind: 'say', part: 0, text: 'Nice!' },
      { kind: 'pcm', part: 0, rate: 24_000, data: 'QUJD' },
      { kind: 'part-end', part: 0, last: false },
      { kind: 'reply', ...SAVED },
      { kind: 'part-end', part: 0, last: true },
      { kind: 'end' },
    ]
    h.result = answer(of(...all))
    const res = await send()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('x-accel-buffering')).toBe('no')
    expect(await lines(res)).toEqual(all)
  })

  it('⛔ each line goes out the moment it exists — the first sentence never waits for the rest', async () => {
    const gate = Promise.withResolvers<void>()
    async function* gen(): AsyncGenerator<TurnLine, void, undefined> {
      yield { kind: 'heard', learnerText: 'hi' }
      yield { kind: 'say', part: 0, text: 'Hello!' }
      await gate.promise
      yield { kind: 'end' }
    }
    h.result = answer(gen())
    const reader = (await send()).body!.getReader()
    expect(JSON.parse(decoder.decode((await reader.read()).value))).toEqual({ kind: 'heard', learnerText: 'hi' })
    expect(JSON.parse(decoder.decode((await reader.read()).value))).toEqual({ kind: 'say', part: 0, text: 'Hello!' })
    const pending = reader.read()
    gate.resolve()
    expect(JSON.parse(decoder.decode((await pending).value))).toEqual({ kind: 'end' })
    expect(await reader.read()).toEqual({ done: true, value: undefined })
  })

  it('⛔ a client that goes away mid-answer: the turn is told (stop), nothing is written after, nothing is unhandled', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (e: unknown) => { unhandled.push(e) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const gate = Promise.withResolvers<void>()
      const stopped = { n: 0 }
      async function* gen(): AsyncGenerator<TurnLine, void, undefined> {
        yield { kind: 'heard', learnerText: 'hi' }
        await gate.promise // the next line is being made when the client leaves
        yield { kind: 'say', part: 0, text: 'Too late.' }
      }
      h.result = answer(gen(), stopped)
      const reader = (await send()).body!.getReader()
      await reader.read() // heard
      const pending = reader.read()
      await settle()
      await reader.cancel(new Error('the client went away'))
      expect(await pending).toEqual({ done: true, value: undefined })
      expect(stopped.n).toBe(1)
      gate.resolve()
      await settle()
      expect(unhandled).toEqual([])
      expect(h.logs).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('lines that throw (a bug — turn-stream.ts never does) end the answer without "end", logged quietly, nothing unhandled', async () => {
    async function* gen(): AsyncGenerator<TurnLine, void, undefined> {
      yield { kind: 'heard', learnerText: 'I go to school yesterday' }
      throw new Error('boom: I go to school yesterday')
    }
    h.result = answer(gen())
    expect(await lines(await send())).toEqual([{ kind: 'heard', learnerText: 'I go to school yesterday' }])
    expect(h.logs).toHaveLength(1)
    expect(h.logs[0][1]).toEqual({ op: 'classroom.turn.lines' })
    expect(JSON.stringify(h.logs) + String((h.logs[0][0] as Error).message)).not.toMatch(/school/) // quietError: the kind of error, never its text
  })

  it('a refusal decided before the reply is the usual JSON error with its status — never a stream', async () => {
    h.error = new ApiError('turn_in_progress', 409)
    const res = await send()
    expect(res.status).toBe(409)
    expect(res.headers.get('content-type')).toMatch(/^application\/json/)
    expect(await res.json()).toEqual({ error: 'turn_in_progress' })
    h.error = new ApiError('speech_unavailable', 503)
    const res2 = await send()
    expect(res2.status).toBe(503)
    expect(await res2.json()).toEqual({ error: 'speech_unavailable' })
  })
})
