import { afterEach, describe, expect, it, vi } from 'vitest'
import { LlmError, openAiConfig, partialString, streamJson } from './llm-openai'
import { tutorTurnStream, type TutorEvent } from './tutor-ai'

vi.mock('server-only', () => ({}))
/** streamJson's default: undici's own fetch on ONE kept-open pool — here recorded, then answered by the stubbed global fetch. */
const undici = vi.hoisted(() => ({ agents: [] as unknown[], dispatchers: [] as unknown[] }))
vi.mock('undici', () => ({
  Agent: class { constructor(opts: unknown) { undici.agents.push(opts) } },
  fetch: (u: string, init: RequestInit & { dispatcher?: unknown }) => { undici.dispatchers.push(init.dispatcher); return globalThis.fetch(u, init) },
}))
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const KEY = `sk-${'a'.repeat(40)}`

/** An SSE body that sends `deltas` as response.output_text.delta events, then response.completed. */
function sse(deltas: string[], end: 'completed' | 'incomplete' | 'none' = 'completed'): Response {
  const enc = new TextEncoder()
  const events = [
    ...deltas.map((d) => `event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta: d })}\n\n`),
    ...(end === 'completed' ? [`data: ${JSON.stringify({ type: 'response.completed' })}\n\n`] : []),
    ...(end === 'incomplete' ? [`data: ${JSON.stringify({ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } })}\n\n`] : []),
  ]
  return new Response(new ReadableStream({ start(c) { for (const e of events) c.enqueue(enc.encode(e)); c.close() } }), { headers: { 'content-type': 'text/event-stream' } })
}

describe('openAiConfig', () => {
  it('needs a real-looking key; the model defaults to gpt-6-luna', () => {
    expect(openAiConfig()).toBeNull()
    vi.stubEnv('OPENAI_API_KEY', 'nope')
    expect(openAiConfig()).toBeNull()
    vi.stubEnv('OPENAI_API_KEY', KEY)
    expect(openAiConfig()).toEqual({ key: KEY, model: 'gpt-6-luna', url: 'https://api.openai.com', firstTokenMs: 4_000, tier: 'priority' })
    vi.stubEnv('CLASSROOM_OPENAI_TIER', 'default')
    expect(openAiConfig()).toMatchObject({ tier: 'default' })
  })
  it('⛔ a local stand-in is THIS machine or nothing — the key never goes anywhere else', () => {
    vi.stubEnv('OPENAI_API_KEY', KEY)
    vi.stubEnv('CLASSROOM_TUTOR_STANDIN_URL', 'http://localhost:8787')
    expect(openAiConfig()).toMatchObject({ url: 'http://127.0.0.1:8787', firstTokenMs: 30_000 })
    for (const bad of ['https://evil.example', 'http://127.0.0.1.evil.example:80', 'http://10.0.0.5:8787', 'http://localhost:8787/x', 'http://user@localhost:8787']) {
      vi.stubEnv('CLASSROOM_TUTOR_STANDIN_URL', bad)
      expect(openAiConfig()).toBeNull()
    }
  })
})

describe('partialString', () => {
  it('reads a string field from JSON still being written, escapes included', () => {
    expect(partialString('{"safety":"no', 'safety')).toEqual({ text: 'no', complete: false })
    expect(partialString('{"safety":"none","reply":"Hi! \\"Tom\\" said\\n hi', 'reply')).toEqual({ text: 'Hi! "Tom" said\n hi', complete: false })
    expect(partialString('{"reply":"Done.","hint":"x"}', 'reply')).toEqual({ text: 'Done.', complete: true })
    expect(partialString('{"reply":"caf\\u00e9 ok"', 'reply')?.text).toBe('café ok')
    expect(partialString('{"reply":"cut \\', 'reply')).toEqual({ text: 'cut ', complete: false })
    expect(partialString('{"hint":"x"}', 'reply')).toBeNull()
  })
})

describe('streamJson', () => {
  it('posts the Responses API request (reasoning none, strict schema, not stored) and yields the deltas', async () => {
    const calls: RequestInit[] = []
    const urls: string[] = []
    const f = vi.fn(async (u: string | URL | Request, init?: RequestInit) => { urls.push(String(u)); calls.push(init!); return sse(['{"a":', '"b"}']) }) as unknown as typeof fetch
    const out: string[] = []
    for await (const d of streamJson({ key: KEY, model: 'gpt-6-luna', url: 'https://api.openai.com', firstTokenMs: 4_000, tier: 'priority' }, { instructions: 'i', input: 'x', schema: { type: 'object' }, schemaName: 's', maxOutputTokens: 10 }, f)) out.push(d)
    expect(out.join('')).toBe('{"a":"b"}')
    const body = JSON.parse(String(calls[0].body))
    expect(body).toMatchObject({ model: 'gpt-6-luna', reasoning: { effort: 'none' }, service_tier: 'priority', store: false, stream: true, text: { format: { type: 'json_schema', strict: true, name: 's' } } })
    expect(new Headers(calls[0].headers).get('authorization')).toBe(`Bearer ${KEY}`)
    expect(urls).toEqual(['https://api.openai.com/v1/responses'])
  })
  it('⛔ a budget already spent sends nothing (review, codex): no request leaves', async () => {
    const f = vi.fn(async () => sse(['{}'])) as unknown as typeof fetch
    const spent = AbortSignal.abort()
    const run = async () => { for await (const _ of streamJson({ key: KEY, model: 'm', url: 'https://api.openai.com', firstTokenMs: 4_000, tier: 'priority' }, { instructions: 'i', input: 'x', schema: {}, schemaName: 's', maxOutputTokens: 10, signal: spent }, f)) void _ }
    await expect(run()).rejects.toMatchObject({ status: 504 })
    expect(f).not.toHaveBeenCalled()
  })
  it('a refusal, a cut-off answer or a dropped connection is an LlmError', async () => {
    const run = async (r: Response | Error) => {
      const f = vi.fn(async () => { if (r instanceof Error) throw r; return r }) as unknown as typeof fetch
      for await (const _ of streamJson({ key: KEY, model: 'm', url: 'https://api.openai.com', firstTokenMs: 4_000, tier: 'priority' }, { instructions: 'i', input: 'x', schema: {}, schemaName: 's', maxOutputTokens: 10 }, f)) void _
    }
    await expect(run(new Response('{}', { status: 429 }))).rejects.toMatchObject({ status: 429 })
    await expect(run(sse(['{"a"'], 'incomplete'))).rejects.toMatchObject({ status: 413 })
    await expect(run(new TypeError('fetch failed'))).rejects.toBeInstanceOf(LlmError)
  })
})

describe('streamJson — one kept-open connection (owner, 2026-10-27: "need super fast response")', () => {
  const CFG = { key: KEY, model: 'm', url: 'https://api.openai.com', firstTokenMs: 4_000, tier: 'priority' }
  const REQ = { instructions: 'i', input: 'x', schema: {}, schemaName: 's', maxOutputTokens: 10 }
  const drainAll = async (g: AsyncGenerator<string>) => { const out: string[] = []; for await (const d of g) out.push(d); return out }
  /** An SSE body with `after` more bytes once the answer is complete — and whether it was read to its end or cancelled. */
  function tracked(after = ': keep-alive\n\n') {
    const enc = new TextEncoder()
    const chunks = [
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '{"a":1}' })}\n\n`,
      `data: ${JSON.stringify({ type: 'response.completed' })}\n\n`,
      after,
    ]
    const state = { pulled: 0, cancelled: false }
    const res = new Response(new ReadableStream({
      pull(c) { if (state.pulled < chunks.length) c.enqueue(enc.encode(chunks[state.pulled++])); else c.close() },
      cancel() { state.cancelled = true },
    }), { headers: { 'content-type': 'text/event-stream' } })
    return { res, state }
  }

  it('by default it asks through ONE pool kept open for 2 minutes — the same for every answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => tracked().res))
    await drainAll(streamJson(CFG, REQ))
    await drainAll(streamJson(CFG, REQ))
    expect(undici.agents).toEqual([{ keepAliveTimeout: 120_000, keepAliveMaxTimeout: 120_000 }])
    expect(undici.dispatchers).toHaveLength(2)
    expect(undici.dispatchers[0]).toBe(undici.dispatchers[1])
  })
  it('⚡ a finished answer is READ TO ITS END, never cancelled — its connection goes back to the pool', async () => {
    const t = tracked()
    const f = vi.fn(async () => t.res) as unknown as typeof fetch
    expect(await drainAll(streamJson(CFG, REQ, f))).toEqual(['{"a":1}'])
    await vi.waitFor(() => expect(t.state.pulled).toBe(3))
    await new Promise((r) => setTimeout(r, 10))
    expect(t.state.cancelled).toBe(false)
  })
  it('an answer the SERVER ended (incomplete: a cap) is an LlmError — and still read to its end, its connection kept', async () => {
    const enc = new TextEncoder()
    const chunks = [
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '{"a":' })}\n\n`,
      `data: ${JSON.stringify({ type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } })}\n\n`,
      ': end\n\n',
    ]
    const state = { pulled: 0, cancelled: false }
    const res = new Response(new ReadableStream({
      pull(c) { if (state.pulled < chunks.length) c.enqueue(enc.encode(chunks[state.pulled++])); else c.close() },
      cancel() { state.cancelled = true },
    }), { headers: { 'content-type': 'text/event-stream' } })
    await expect(drainAll(streamJson(CFG, REQ, vi.fn(async () => res) as unknown as typeof fetch))).rejects.toMatchObject({ status: 413 })
    await vi.waitFor(() => expect(state.pulled).toBe(3))
    await new Promise((r) => setTimeout(r, 10))
    expect(state.cancelled).toBe(false)
  })
  it('an answer left early (a caller that stops reading) is cancelled — never left half-read on the pool', async () => {
    const t = tracked()
    const f = vi.fn(async () => t.res) as unknown as typeof fetch
    for await (const _ of streamJson(CFG, REQ, f)) break
    await vi.waitFor(() => expect(t.state.cancelled).toBe(true))
  })
  it('a connection the server had closed ("other side closed") is tried ONCE more; any other failure or an abort never is', async () => {
    const stale = () => Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } })
    let n = 0
    const flaky = vi.fn(async () => { n += 1; if (n === 1) throw stale(); return tracked().res }) as unknown as typeof fetch
    expect(await drainAll(streamJson(CFG, REQ, flaky))).toEqual(['{"a":1}'])
    expect(flaky).toHaveBeenCalledTimes(2)
    const dead = vi.fn(async () => { throw stale() }) as unknown as typeof fetch
    await expect(drainAll(streamJson(CFG, REQ, dead))).rejects.toBeInstanceOf(LlmError)
    expect(dead).toHaveBeenCalledTimes(2) // once more, never a third time
    const refused = vi.fn(async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }) }) as unknown as typeof fetch
    await expect(drainAll(streamJson(CFG, REQ, refused))).rejects.toBeInstanceOf(LlmError)
    expect(refused).toHaveBeenCalledTimes(1)
    const stop = new AbortController()
    const hanging = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch
    const run = drainAll(streamJson(CFG, { ...REQ, signal: stop.signal }, hanging))
    stop.abort()
    await expect(run).rejects.toBeInstanceOf(LlmError)
    expect(hanging).toHaveBeenCalledTimes(1)
  })
})

describe('tutorTurnStream (OpenAI)', () => {
  const ctx = {
    avatarName: 'Anna', persona: '', level: 'A2', band: 'adult' as const, strictness: 'balanced' as const, focusNote: '',
    plan: { brief: '', focus: { goals: [], focusWords: [], recycle: [], drill: [] } as never }, workingOn: [], history: [],
    learnerText: 'I go market yesterday.', secondsLeft: 300, drillLeft: [], pace: { now: 'natural' as const, slower: true, faster: true },
  }
  const run = async (json: string, chunk = 7): Promise<TutorEvent[]> => {
    vi.stubEnv('OPENAI_API_KEY', KEY)
    const deltas: string[] = []
    for (let i = 0; i < json.length; i += chunk) deltas.push(json.slice(i, i + chunk))
    vi.stubGlobal('fetch', vi.fn(async () => sse(deltas)))
    const out: TutorEvent[] = []
    for await (const e of tutorTurnStream(null, ctx)) out.push(e)
    return out
  }
  const answer = (o: Record<string, unknown>) => JSON.stringify({ safety: 'none', reply: '', hint: 'I went to the market.', hintVi: 'Tôi đã đi chợ.', expect: '', heardAs: [], ...o })

  it('the harm flag first, then each sentence as soon as it is complete, then the saved reply = what was said', async () => {
    const ev = await run(answer({ reply: 'Nice! We say: I went to the market. What did you buy?' }))
    expect(ev[0]).toEqual({ kind: 'safety', harm: false })
    expect(ev.filter((e) => e.kind === 'say').map((e) => (e as { text: string }).text)).toEqual(['Nice!', 'We say: I went to the market.', 'What did you buy?'])
    const final = ev.at(-1) as Extract<TutorEvent, { kind: 'final' }>
    expect(final.kind).toBe('final')
    expect(final.reply.reply).toBe('Nice! We say: I went to the market. What did you buy?')
    expect(final.reply.hint).toBe('I went to the market.')
  })
  it('harm: not one of the model\'s words is spoken', async () => {
    const ev = await run(answer({ safety: 'harm', reply: 'Something the caller replaces.' }))
    expect(ev.filter((e) => e.kind === 'say')).toEqual([])
    expect(ev[0]).toEqual({ kind: 'safety', harm: true })
  })
  it('never speaks a sentence carrying a contact, nor past the word cap', async () => {
    const ev = await run(answer({ reply: 'Great job today. Call me on 0901 234 567 tomorrow. Bye now.' }))
    expect(ev.filter((e) => e.kind === 'say').map((e) => (e as { text: string }).text)).toEqual(['Great job today.'])
    const long = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} is here.`).join(' ')
    const ev2 = await run(answer({ reply: long }))
    const spoken = ev2.filter((e) => e.kind === 'say').map((e) => (e as { text: string }).text).join(' ')
    expect(spoken.split(/\s+/).length).toBeLessThanOrEqual(45 + 15)
  })
  it('a drill the reply does not ask for out loud is requested last, and saved as said', async () => {
    const ev = await run(answer({ reply: 'Good try. Let us practise the th sound.', expect: 'I think so.' }))
    const says = ev.filter((e) => e.kind === 'say').map((e) => (e as { text: string }).text)
    expect(says.at(-1)).toBe('Please say after me: I think so.')
    const final = ev.at(-1) as Extract<TutorEvent, { kind: 'final' }>
    expect(final.reply.reply).toBe('Good try. Let us practise the th sound. Please say after me: I think so.')
    expect(final.reply.expect).toBe('I think so.')
  })
})
