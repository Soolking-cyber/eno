import { beforeEach, describe, expect, it, vi } from 'vitest'

// This route is the ENTITLEMENT + SPEND layer over translateBatch. What must hold here:
// no guest and no non-participant reaches a message, the SERVER (not the client) decides
// what is translatable, private text never rides into the shared translation cache, the
// paid provider is never called without the limiter and the budget agreeing first, and a
// slow provider answers RETRYABLY instead of poisoning the client's attempted-set.

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  state: {
    userId: 'me' as string | null,
    convo: { buyerProfileId: 'me', sellerProfileId: 'them' } as Row | null,
    rows: [] as Array<{ id: string; body: string }>,
    messageWhere: null as Row | null,
    rateOk: true,
    rateCalls: [] as Row[],
    kvHits: new Map<string, string>(),
    kvWrites: [] as Array<[string, unknown]>,
    kvCounters: { day: 0, user: 0 } as Row,
    kvThrows: false,
    translateCalls: [] as Row[],
    // source -> translated; anything absent comes back unchanged (provider passthrough).
    dictionary: {} as Record<string, string>,
    hang: false,
    providerDown: false,
    afterWork: [] as Array<() => unknown>,
  },
}))

vi.mock('@/lib/admin', () => ({ getCurrentProfileId: () => Promise.resolve(h.state.userId) }))

vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: () => Promise.resolve(h.state.convo) },
    message: {
      findMany: (args: Row) => {
        h.state.messageWhere = args.where
        return Promise.resolve(h.state.rows)
      },
    },
  },
}))

vi.mock('next/server', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  // Run after() work inline so a test can observe what the route defers.
  after: (fn: () => unknown) => { h.state.afterWork.push(fn) },
}))

vi.mock('@/lib/translate', () => ({
  LANGS: ['en', 'vi', 'ko', 'ja'],
  translateBatch: (texts: string[], target: string, opts?: Row) => {
    h.state.translateCalls.push({ texts, target, opts })
    if (h.state.providerDown && opts?.stats) opts.stats.providerFailed = true
    if (h.state.hang) {
      // Never wins the race, but DOES eventually resolve — that is the case where the
      // route must still bank the paid result instead of discarding it.
      return new Promise<string[]>((r) => setTimeout(() => r(texts.map((t) => h.state.dictionary[t] ?? t)), 30_000))
    }
    return Promise.resolve(texts.map((t) => h.state.dictionary[t] ?? t))
  },
}))

vi.mock('@/lib/ratelimit', () => ({
  rateLimit: (name: string, key: string, limit: number, window: string, opts?: Row) => {
    h.state.rateCalls.push({ name, key, limit, window, opts })
    return Promise.resolve({ success: h.state.rateOk, remaining: 0 })
  },
  kv: {
    mget: (keys: string[]) => {
      if (h.state.kvThrows) return Promise.reject(new Error('kv down'))
      const out = new Map<string, string>()
      for (const k of keys) { const v = h.state.kvHits.get(k); if (v != null) out.set(k, v) }
      return Promise.resolve(out)
    },
    mset: (entries: Array<[string, unknown]>) => { h.state.kvWrites.push(...entries); return Promise.resolve() },
    incrby: (key: string, by: number) => {
      const which = key.startsWith('chat-tr:u:') ? 'user' : 'day'
      h.state.kvCounters[which] += by
      return Promise.resolve(h.state.kvCounters[which])
    },
  },
}))

import { POST } from './route'
import crypto from 'crypto'

const key = (target: string, body: string) =>
  `chat-tr:${target}:${crypto.createHash('sha1').update(body).digest('hex')}`

async function post(body: unknown): Promise<{ status: number; json: Row }> {
  const req = new Request('http://test/api/messages/translate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const res = await POST(req)
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Row }
}

const OK = { conversationId: 'c1', messageIds: ['m1'], target: 'vi' }

beforeEach(() => {
  h.state.userId = 'me'
  h.state.convo = { buyerProfileId: 'me', sellerProfileId: 'them' }
  h.state.rows = [{ id: 'm1', body: 'hello' }]
  h.state.messageWhere = null
  h.state.rateOk = true
  h.state.rateCalls = []
  h.state.kvHits = new Map()
  h.state.kvWrites = []
  h.state.kvCounters = { day: 0, user: 0 }
  h.state.kvThrows = false
  h.state.translateCalls = []
  h.state.dictionary = { hello: 'xin chào' }
  h.state.hang = false
  h.state.providerDown = false
  h.state.afterWork = []
})

describe('chat translate — who may ask', () => {
  it('refuses a guest before touching the conversation', async () => {
    h.state.userId = null
    const { status } = await post(OK)
    expect(status).toBe(401)
    expect(h.state.messageWhere).toBeNull()
  })

  it('refuses a non-participant — the id is real, the caller is not in the thread', async () => {
    h.state.userId = 'stranger'
    const { status } = await post(OK)
    expect(status).toBe(403)
    expect(h.state.messageWhere).toBeNull()
    expect(h.state.translateCalls).toHaveLength(0)
  })

  it('404s an unknown conversation', async () => {
    h.state.convo = null
    expect((await post(OK)).status).toBe(404)
  })

  it.each([
    ['no conversation id', { ...OK, conversationId: '' }],
    ['unsupported target', { ...OK, target: 'xx' }],
    ['no ids', { ...OK, messageIds: [] }],
    ['over the id cap', { ...OK, messageIds: Array.from({ length: 51 }, (_, i) => `m${i}`) }],
    ['ids not strings', { ...OK, messageIds: [1, 2] }],
  ])('400s on %s', async (_label, body) => {
    expect((await post(body)).status).toBe(400)
  })

  it('413s a payload over the per-request char cap', async () => {
    h.state.rows = [{ id: 'm1', body: 'x'.repeat(5001) }]
    expect((await post(OK)).status).toBe(413)
    expect(h.state.translateCalls).toHaveLength(0)
  })
})

describe('chat translate — the server decides what is translatable', () => {
  it('queries ONLY incoming plain-text rows scoped to this conversation', async () => {
    await post({ ...OK, messageIds: ['m1', 'm2'] })
    expect(h.state.messageWhere).toEqual({
      id: { in: ['m1', 'm2'] },
      conversationId: 'c1',
      kind: 'text',
      senderProfileId: { not: 'me' },
    })
  })

  it('returns nothing (and pays nothing) when no id resolves to an eligible message', async () => {
    h.state.rows = []
    const { status, json } = await post(OK)
    expect(status).toBe(200)
    expect(json.items).toEqual([])
    expect(h.state.translateCalls).toHaveLength(0)
    expect(h.state.rateCalls).toHaveLength(0)
  })
})

describe('chat translate — spend', () => {
  it('never writes private chat text to the shared translation cache', async () => {
    await post(OK)
    expect(h.state.translateCalls[0].opts).toMatchObject({ skipWrite: true })
  })

  it('an ephemeral cache hit is free: no limiter, no budget, no provider', async () => {
    h.state.kvHits.set(key('vi', 'hello'), 'xin chào')
    const { json } = await post(OK)
    expect(json.items).toEqual([{ id: 'm1', text: 'xin chào', translated: true }])
    expect(h.state.translateCalls).toHaveLength(0)
    expect(h.state.rateCalls).toHaveLength(0)
    expect(h.state.kvCounters).toEqual({ day: 0, user: 0 })
  })

  it('charges only the MISSES, then caches the result for next time', async () => {
    h.state.rows = [{ id: 'm1', body: 'hello' }, { id: 'm2', body: 'bye' }]
    h.state.kvHits.set(key('vi', 'hello'), 'xin chào')
    h.state.dictionary = { bye: 'tạm biệt' }
    const { json } = await post({ ...OK, messageIds: ['m1', 'm2'] })
    expect(h.state.translateCalls[0].texts).toEqual(['bye']) // NOT the cached one
    expect(h.state.kvCounters).toEqual({ day: 3, user: 3 }) // 'bye'.length
    expect(h.state.kvWrites).toEqual([[key('vi', 'bye'), 'tạm biệt']])
    expect(json.items).toEqual([
      { id: 'm1', text: 'xin chào', translated: true },
      { id: 'm2', text: 'tạm biệt', translated: true },
    ])
  })

  it('rate limits STRICTLY and 429s before any provider call', async () => {
    h.state.rateOk = false
    const { status } = await post(OK)
    expect(status).toBe(429)
    expect(h.state.rateCalls[0]).toMatchObject({ name: 'chat-translate', key: 'me', opts: { strict: true } })
    expect(h.state.translateCalls).toHaveLength(0)
  })

  it('degrades to cache-only when the daily budget is spent — thins out, does not die', async () => {
    h.state.kvCounters = { day: 999_999, user: 0 }
    h.state.rows = [{ id: 'm1', body: 'hello' }, { id: 'm2', body: 'bye' }]
    h.state.kvHits.set(key('vi', 'hello'), 'xin chào')
    const { status, json } = await post({ ...OK, messageIds: ['m1', 'm2'] })
    expect(status).toBe(200)
    expect(h.state.translateCalls).toHaveLength(0) // no paid call
    expect(json.items).toEqual([
      { id: 'm1', text: 'xin chào', translated: true }, // the free hit still serves
      { id: 'm2', text: 'bye', translated: false },     // honest: not a translation
    ])
  })

  it('503s (not 200) when the accounting backend is down — a blip must stay retryable', async () => {
    // A 200 here would make the client mark these ids permanently attempted, so a momentary
    // KV error would kill translation for the thread for the rest of the session.
    h.state.kvCounters = null as never // incrby throws
    const { status, json } = await post(OK)
    expect(status).toBe(503)
    expect(json.items).toBeUndefined()
    expect(h.state.translateCalls).toHaveLength(0) // no accounting ⇒ no paid call
  })

  it('503s when the cache is unreadable AND the budget is spent — that is ignorance, not "no translation"', async () => {
    h.state.kvThrows = true
    h.state.kvCounters = { day: 999_999, user: 0 }
    const { status } = await post(OK)
    expect(status).toBe(503)
  })

  it('still translates when the cache read fails — the cache is an optimisation, not a gate', async () => {
    h.state.kvThrows = true
    const { json } = await post(OK)
    expect(h.state.translateCalls).toHaveLength(1)
    expect(json.items[0]).toMatchObject({ translated: true })
  })
})

describe('chat translate — honest answers', () => {
  it('a slow provider is 503 (retryable), NEVER a 200 of originals', async () => {
    // A 200 makes the client mark every id permanently attempted, so answering a timeout
    // with passthrough text would silently kill translation for those messages.
    vi.useFakeTimers()
    h.state.hang = true
    const res = post(OK)
    await vi.advanceTimersByTimeAsync(8_000)
    const { status, json } = await res
    expect(status).toBe(503)
    expect(json.items).toBeUndefined()
    vi.useRealTimers()
  })

  it('banks the slow result after responding, so the retry is free instead of paid twice', async () => {
    vi.useFakeTimers()
    h.state.hang = true
    const res = post(OK)
    await vi.advanceTimersByTimeAsync(8_000)
    expect((await res).status).toBe(503)
    expect(h.state.kvWrites).toHaveLength(0) // nothing banked yet — the call is still running
    // The work we already paid for lands in the ephemeral cache once it finishes.
    const deferred = h.state.afterWork.map((fn) => fn())
    await vi.advanceTimersByTimeAsync(30_000)
    await Promise.all(deferred)
    expect(h.state.kvWrites).toEqual([[key('vi', 'hello'), 'xin chào']])
    vi.useRealTimers()
  })

  it('503s when the provider is DOWN — source fallback is never sold as a translation', async () => {
    h.state.providerDown = true
    const { status } = await post(OK)
    expect(status).toBe(503)
  })

  it('does NOT 503 merely because text translates to itself (same-language thread)', async () => {
    // The distinction the stats out-param exists for: identical output is not a failure.
    h.state.rows = [{ id: 'm1', body: 'OK' }]
    h.state.dictionary = {}
    const { status, json } = await post(OK)
    expect(status).toBe(200)
    expect(json.items).toEqual([{ id: 'm1', text: 'OK', translated: false }])
  })

  it('reports translated:false when the text came back unchanged', async () => {
    h.state.rows = [{ id: 'm1', body: 'https://eno.vn' }]
    h.state.dictionary = {}
    const { json } = await post(OK)
    expect(json.items).toEqual([{ id: 'm1', text: 'https://eno.vn', translated: false }])
    expect(h.state.kvWrites).toHaveLength(0) // nothing worth caching
  })

  it('two messages with identical bodies both resolve — one provider item, two items out', async () => {
    h.state.rows = [{ id: 'm1', body: 'hello' }, { id: 'm2', body: 'hello' }]
    const { json } = await post({ ...OK, messageIds: ['m1', 'm2'] })
    expect(h.state.translateCalls[0].texts).toEqual(['hello'])
    expect(json.items).toEqual([
      { id: 'm1', text: 'xin chào', translated: true },
      { id: 'm2', text: 'xin chào', translated: true },
    ])
  })
})
