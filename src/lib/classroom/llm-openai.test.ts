import { afterEach, describe, expect, it, vi } from 'vitest'
import { LlmError, openAiConfig, partialString, streamJson } from './llm-openai'
import { tutorTurnStream, type TutorEvent } from './tutor-ai'

vi.mock('server-only', () => ({}))
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
