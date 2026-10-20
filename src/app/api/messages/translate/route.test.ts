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
    // Strings that fail one by one because nothing answered for them (their server was down) — failedTexts only.
    outage: new Set<string>(),
    // Strings the box model answered and its gate refused — failedTexts AND refusedTexts, the way translateBatch
    // reports a refusal (src/lib/translate.ts, ChunkResult.refused).
    refused: new Set<string>(),
    admin: null as string | null,
    writerLocales: [] as string[],
    afterWork: [] as Array<() => unknown>,
  },
}))

vi.mock('@/lib/admin', () => ({
  getCurrentProfileId: () => Promise.resolve(h.state.userId),
  getAdmin: () => Promise.resolve(h.state.admin),
}))
vi.mock('@/lib/support-thread', () => ({ SUPPORT_SELLER_ID: 'eno-support-desk' }))

vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: () => Promise.resolve(h.state.convo) },
    profile: {
      findMany: (args: Row) => Promise.resolve((args.where.id.in as string[]).map((id, i) => ({ id, locale: h.state.writerLocales[i] ?? null }))),
    },
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
  LANGS: ['en', 'vi', 'ko', 'ja', 'fr'],
  translateBatch: (texts: string[], target: string, opts?: Row) => {
    h.state.translateCalls.push({ texts, target, opts })
    if (h.state.providerDown && opts?.stats) opts.stats.providerFailed = true
    const failed = (t: string) => h.state.outage.has(t) || h.state.refused.has(t)
    for (const t of texts) {
      if (!failed(t) || !opts?.stats) continue
      opts.stats.providerFailed = true
      opts.stats.failedTexts?.add(t)
      if (h.state.refused.has(t)) opts.stats.refusedTexts?.add(t)
    }
    // A failed string comes back as itself — translateBatch's source fallback.
    const result = () => texts.map((t) => (failed(t) ? t : h.state.dictionary[t] ?? t))
    if (h.state.hang) {
      // Never wins the race, but DOES eventually resolve — that is the case where the
      // route must still bank the paid result instead of discarding it.
      return new Promise<string[]>((r) => setTimeout(() => r(result()), 30_000))
    }
    return Promise.resolve(result())
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

// Per conversation: every test thread is 'c1'.
const key = (target: string, body: string, conversationId = 'c1') =>
  `chat-tr:${target}:${conversationId}:${crypto.createHash('sha1').update(body).digest('hex')}`

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
  h.state.rows = [{ id: 'm1', body: 'see you at the school gate' }]
  h.state.messageWhere = null
  h.state.rateOk = true
  h.state.rateCalls = []
  h.state.kvHits = new Map()
  h.state.kvWrites = []
  h.state.kvCounters = { day: 0, user: 0 }
  h.state.kvThrows = false
  h.state.translateCalls = []
  h.state.dictionary = { 'see you at the school gate': 'xin chào' }
  h.state.hang = false
  h.state.providerDown = false
  h.state.outage = new Set()
  h.state.refused = new Set()
  h.state.admin = null
  h.state.writerLocales = []
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
      deletedAt: null, // a message taken back never comes back as a translation
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
    h.state.kvHits.set(key('vi', 'see you at the school gate'), 'xin chào')
    const { json } = await post(OK)
    expect(json.items).toEqual([{ id: 'm1', text: 'xin chào', translated: true }])
    expect(h.state.translateCalls).toHaveLength(0)
    expect(h.state.rateCalls).toHaveLength(0)
    expect(h.state.kvCounters).toEqual({ day: 0, user: 0 })
  })

  it('charges only the MISSES, then caches the result for next time', async () => {
    h.state.rows = [{ id: 'm1', body: 'see you at the school gate' }, { id: 'm2', body: 'the kitchen is quite small' }]
    h.state.kvHits.set(key('vi', 'see you at the school gate'), 'xin chào')
    h.state.dictionary = { 'the kitchen is quite small': 'tạm biệt' }
    const { json } = await post({ ...OK, messageIds: ['m1', 'm2'] })
    expect(h.state.translateCalls[0].texts).toEqual(['the kitchen is quite small']) // NOT the cached one
    expect(h.state.kvCounters).toEqual({ day: 26, user: 26 }) // 'the kitchen is quite small'.length
    expect(h.state.kvWrites).toEqual([[key('vi', 'the kitchen is quite small'), 'tạm biệt']])
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
    h.state.rows = [{ id: 'm1', body: 'see you at the school gate' }, { id: 'm2', body: 'the kitchen is quite small' }]
    h.state.kvHits.set(key('vi', 'see you at the school gate'), 'xin chào')
    const { status, json } = await post({ ...OK, messageIds: ['m1', 'm2'] })
    expect(status).toBe(200)
    expect(h.state.translateCalls).toHaveLength(0) // no paid call
    expect(json.items).toEqual([
      { id: 'm1', text: 'xin chào', translated: true }, // the free hit still serves
      { id: 'm2', text: 'the kitchen is quite small', translated: false },     // honest: not a translation
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
    expect(h.state.kvWrites).toEqual([[key('vi', 'see you at the school gate'), 'xin chào']])
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
    h.state.rows = [{ id: 'm1', body: 'see you at the school gate' }, { id: 'm2', body: 'see you at the school gate' }]
    const { json } = await post({ ...OK, messageIds: ['m1', 'm2'] })
    expect(h.state.translateCalls[0].texts).toEqual(['see you at the school gate'])
    expect(json.items).toEqual([
      { id: 'm1', text: 'xin chào', translated: true },
      { id: 'm2', text: 'xin chào', translated: true },
    ])
  })
})

describe('chat translate — the support desk', () => {
  // Both support seller rows are unowned: sellerProfileId is null, so an operator is neither party.
  const SUPPORT = { buyerProfileId: 'writer', sellerProfileId: null, sellerId: 'eno-support-desk' }

  it('an admin translates a support thread it can read (the GET route\'s iAmSupport grant)', async () => {
    h.state.userId = 'operator'
    h.state.admin = 'ops@eno.vn'
    h.state.convo = SUPPORT
    const { status, json } = await post(OK)
    expect(status).toBe(200)
    expect(json.items).toEqual([{ id: 'm1', text: 'xin chào', translated: true }])
    expect(h.state.messageWhere).toMatchObject({ senderProfileId: { not: 'operator' } })
  })

  it('a non-admin who is not a party is still refused on a support thread', async () => {
    h.state.userId = 'stranger'
    h.state.convo = SUPPORT
    expect((await post(OK)).status).toBe(403)
    expect(h.state.translateCalls).toHaveLength(0)
  })

  it('an admin gains nothing on an ORDINARY buyer-seller thread', async () => {
    h.state.userId = 'operator'
    h.state.admin = 'ops@eno.vn'
    h.state.convo = { buyerProfileId: 'a', sellerProfileId: 'b', sellerId: 'shop-1' }
    expect((await post(OK)).status).toBe(403)
    expect(h.state.messageWhere).toBeNull()
  })
})

describe('chat translate — a failure is per message, not per batch', () => {
  it('answers what translated and marks only the one nothing answered for retryable', async () => {
    h.state.rows = [{ id: 'm1', body: 'see you at the school gate' }, { id: 'm2', body: 'Daikin FTKB25' }]
    h.state.outage = new Set(['Daikin FTKB25'])
    const { status, json } = await post({ ...OK, messageIds: ['m1', 'm2'], v: 2 })
    expect(status).toBe(200)
    expect(json.items).toEqual([
      { id: 'm1', text: 'xin chào', translated: true },
      { id: 'm2', text: 'Daikin FTKB25', translated: false, retry: true },
    ])
    // only the real translation is banked; the failed one stays a miss for the retry
    expect(h.state.kvWrites).toEqual([[key('vi', 'see you at the school gate'), 'xin chào']])
  })

  it('still 503s when EVERY string failed — the provider is down, not picky', async () => {
    h.state.rows = [{ id: 'm1', body: 'see you at the school gate' }]
    h.state.outage = new Set(['see you at the school gate'])
    const { status, json } = await post(OK)
    expect(status).toBe(503)
    expect(json.items).toBeUndefined()
  })
})

describe('chat translate — a refusal is final, an outage is retried', () => {
  // 2026-10-21, the owner's "hey": the box model answered "hhhhhhhhhhhhhhhhhhhhhhhhhh", the gate refused it, and the
  // route 503'd it as if the provider were down — asked for six times in 90s, each re-running the model; never shown.
  const TWO = { ...OK, messageIds: ['m1', 'm2'], v: 2 }
  beforeEach(() => {
    h.state.rows = [{ id: 'm1', body: 'see you at the school gate' }, { id: 'm2', body: 'the kitchen is quite small' }]
    h.state.dictionary = {
      'see you at the school gate': 'hẹn gặp ở cổng trường', 'the kitchen is quite small': 'bếp khá nhỏ',
    }
  })

  it('every miss refused: a 200 of the originals — final, no retry flag, nothing banked', async () => {
    h.state.refused = new Set(['see you at the school gate', 'the kitchen is quite small'])
    const { status, json } = await post(TWO)
    expect(status).toBe(200)
    expect(json.items).toEqual([
      { id: 'm1', text: 'see you at the school gate', translated: false },
      { id: 'm2', text: 'the kitchen is quite small', translated: false },
    ])
    expect(h.state.kvWrites).toHaveLength(0)
  })

  it('a refusal beside a translation: the translation is answered and banked, the refusal is final', async () => {
    h.state.refused = new Set(['see you at the school gate'])
    const { status, json } = await post(TWO)
    expect(status).toBe(200)
    expect(json.items).toEqual([
      { id: 'm1', text: 'see you at the school gate', translated: false },
      { id: 'm2', text: 'bếp khá nhỏ', translated: true },
    ])
    expect(h.state.kvWrites).toEqual([[key('vi', 'the kitchen is quite small'), 'bếp khá nhỏ']])
  })

  it('a refusal beside an outage: the refusal is final, only the outage is retried', async () => {
    h.state.refused = new Set(['see you at the school gate'])
    h.state.outage = new Set(['the kitchen is quite small'])
    const { status, json } = await post(TWO)
    expect(status).toBe(200)
    expect(json.items).toEqual([
      { id: 'm1', text: 'see you at the school gate', translated: false },
      { id: 'm2', text: 'the kitchen is quite small', translated: false, retry: true },
    ])
    expect(h.state.kvWrites).toHaveLength(0)
  })

  it('unaccented Vietnamese refused: shown as written, not as the mark-restored text that was sent', async () => {
    h.state.rows = [{ id: 'm1', body: 'phong co may lanh khong' }]
    h.state.refused = new Set(['phòng có máy lạnh không'])
    const { status, json } = await post({ ...OK, target: 'en', v: 2 })
    expect(status).toBe(200)
    expect(h.state.translateCalls[0].texts).toEqual(['phòng có máy lạnh không'])
    expect(json.items).toEqual([{ id: 'm1', text: 'phong co may lanh khong', translated: false }])
    expect(h.state.kvWrites).toHaveLength(0)
  })

  it('an older client (no v: 2) whose every miss was refused gets the originals too — a 200, not a 503', async () => {
    h.state.rows = [{ id: 'm1', body: 'see you at the school gate' }]
    h.state.refused = new Set(['see you at the school gate'])
    const { status, json } = await post(OK)
    expect(status).toBe(200)
    expect(json.items).toEqual([{ id: 'm1', text: 'see you at the school gate', translated: false }])
  })

  it('an older client still gets the whole-batch 503 when an outage sits beside the refusal', async () => {
    h.state.refused = new Set(['see you at the school gate'])
    h.state.outage = new Set(['the kitchen is quite small'])
    expect((await post({ ...OK, messageIds: ['m1', 'm2'] })).status).toBe(503)
  })

  it('a real outage is still a 503 for a v: 2 client — every miss down', async () => {
    h.state.outage = new Set(['see you at the school gate', 'the kitchen is quite small'])
    const { status, json } = await post(TWO)
    expect(status).toBe(503)
    expect(json.items).toBeUndefined()
  })

  it('a refusal is logged as counts, never as the words', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.state.refused = new Set(['see you at the school gate'])
    await post(TWO)
    const lines = warn.mock.calls.map((c) => c.join(' '))
    warn.mockRestore()
    expect(lines).toContain('[chat-tr] {"reason":"refused","strings":2,"refused":1}')
    expect(lines.join('\n')).not.toContain('school gate')
  })
})

describe('chat translate — the route decides what each line needs', () => {
  it('unaccented Vietnamese for an English reader: marks restored, sent as Vietnamese', async () => {
    h.state.rows = [{ id: 'm1', body: 'phong co may lanh khong' }]
    h.state.dictionary = { 'phòng có máy lạnh không': 'The room has air conditioning' }
    const { status, json } = await post({ ...OK, target: 'en' })
    expect(status).toBe(200)
    expect(h.state.translateCalls[0].texts).toEqual(['phòng có máy lạnh không'])
    expect(h.state.translateCalls[0].opts.sourceHint.get('phòng có máy lạnh không')).toBe('vi')
    expect(json.items).toEqual([{ id: 'm1', text: 'The room has air conditioning', translated: true }])
    // banked under the ORIGINAL body, so the next read of the same line is a free hit
    expect(h.state.kvWrites).toEqual([[key('en', 'phong co may lanh khong'), 'The room has air conditioning']])
  })

  it('the owner\'s line \'xin chao\' is answered from the phrasebook', async () => {
    h.state.rows = [{ id: 'm1', body: 'xin chao' }]
    const { json } = await post({ ...OK, target: 'en' })
    expect(json.items).toEqual([{ id: 'm1', text: 'Hello', translated: true }])
    expect(h.state.translateCalls).toHaveLength(0)
  })

  it('a line already in the reader\'s language, or a greeting both know, costs nothing at all', async () => {
    h.state.rows = [{ id: 'm1', body: 'hi' }, { id: 'm2', body: 'good morning everyone' }]
    const { status, json } = await post({ ...OK, messageIds: ['m1', 'm2'], target: 'en' })
    expect(status).toBe(200)
    expect(h.state.translateCalls).toHaveLength(0)
    expect(h.state.rateCalls).toHaveLength(0)
    expect(h.state.kvCounters).toEqual({ day: 0, user: 0 })
    expect(json.items).toEqual([
      { id: 'm1', text: 'hi', translated: false },
      { id: 'm2', text: 'good morning everyone', translated: false },
    ])
  })

  it('English for a Vietnamese reader is sent as English', async () => {
    const { json } = await post(OK)
    expect(h.state.translateCalls[0].opts.sourceHint.get('see you at the school gate')).toBe('en')
    expect(json.items).toEqual([{ id: 'm1', text: 'xin chào', translated: true }])
  })

  it('a change of case alone is not a translation', async () => {
    h.state.dictionary = { 'see you at the school gate': 'See you at the school gate.' }
    const { json } = await post(OK)
    // not a translation — and the reader sees the sender's own words, not a re-cased copy
    expect(json.items).toEqual([{ id: 'm1', text: 'see you at the school gate', translated: false }])
  })
})

describe('chat translate — the phrasebook and questions', () => {
  it('a common line is looked up: no limiter, no budget, no provider', async () => {
    h.state.rows = [{ id: 'm1', body: 'Bạn khỏe không' }]
    const { json } = await post({ ...OK, target: 'en' })
    expect(json.items).toEqual([{ id: 'm1', text: 'How are you?', translated: true }])
    expect(h.state.translateCalls).toHaveLength(0)
    expect(h.state.rateCalls).toHaveLength(0)
  })


})

describe('chat translate — older tabs and added contact details', () => {
  it('a client without v:2 gets the whole-batch 503 it understands, never a partial 200 it would bank as final', async () => {
    h.state.rows = [{ id: 'm1', body: 'see you at the school gate' }, { id: 'm2', body: 'Daikin FTKB25' }]
    h.state.outage = new Set(['Daikin FTKB25'])
    expect((await post({ ...OK, messageIds: ['m1', 'm2'] })).status).toBe(503)
  })



  it('a number the original already had is fine', async () => {
    h.state.rows = [{ id: 'm1', body: 'call me on 0909 123 456 after lunch' }]
    h.state.dictionary = { 'call me on 0909 123 456 after lunch': 'gọi tôi số 0909 123 456 sau bữa trưa' }
    const { json } = await post(OK)
    expect(json.items).toEqual([{ id: 'm1', text: 'gọi tôi số 0909 123 456 sau bữa trưa', translated: true }])
  })

  it("tidies the model's Vietnamese: no list dash, no archaic 'ngươi'", async () => {
    h.state.rows = [{ id: 'm1', body: 'where are you staying this week' }]
    h.state.dictionary = { 'where are you staying this week': '- Ngươi ở đâu tuần này' }
    const { json } = await post(OK)
    expect(json.items[0].text).toBe('Bạn ở đâu tuần này')
  })
})

describe('chat translate — French, Malay, times and prices', () => {
  it('a French line for an English reader is sent as French when the writer\'s stored language is French', async () => {
    h.state.rows = [{ id: 'm1', body: 'Bonjour, merci beaucoup' }]
    h.state.writerLocales = ['fr']
    h.state.dictionary = { 'Bonjour, merci beaucoup': 'Hello, thank you very much' }
    const { json } = await post({ ...OK, target: 'en' })
    expect(h.state.translateCalls[0].opts.sourceHint.get('Bonjour, merci beaucoup')).toBe('fr')
    expect(json.items[0]).toMatchObject({ translated: true })
  })

  it('a time written another way is not "an added contact"', async () => {
    h.state.rows = [{ id: 'm1', body: 'lop hoc tu 8h30 - 9h30 gia 5tr' }]
    h.state.dictionary = { 'lớp học từ 8h30 - 9h30 giá 5tr': 'Class from 8.30 - 9.30, price 5 million' }
    const { json } = await post({ ...OK, target: 'en' })
    expect(json.items[0]).toMatchObject({ translated: true })
  })


})

describe('chat translate — second review round', () => {
  it('a body of literal null is a 400, not a 500', async () => {
    const res = await POST(new Request('http://test/api/messages/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'null' }))
    expect(res.status).toBe(400)
  })








  it('the restored line coming back unchanged is no translation — never shown or cached as the English', async () => {
    h.state.rows = [{ id: 'm1', body: 'phong co may lanh khong' }]
    h.state.dictionary = {} // the provider hands back exactly what it was sent: 'phòng có máy lạnh không'
    const { json } = await post({ ...OK, target: 'en' })
    expect(json.items).toEqual([{ id: 'm1', text: 'phong co may lanh khong', translated: false }])
    expect(h.state.kvWrites).toHaveLength(0)
  })
})

describe('chat translate — the private cache is per conversation', () => {
  it('a line cached in another thread is not a free hit here', async () => {
    h.state.kvHits.set(key('vi', 'see you at the school gate', 'other-thread'), 'xin chào')
    await post(OK)
    expect(h.state.translateCalls).toHaveLength(1) // paid again: nothing learned about the other thread
    expect(h.state.kvWrites[0][0]).toBe(key('vi', 'see you at the school gate', 'c1'))
  })
})

describe('chat translate — contact details are the bubble\'s job, not the route\'s', () => {
  it('a translation is returned as the model wrote it; the tappable chips come from the original (MessageBubble chipsFrom)', async () => {
    h.state.rows = [{ id: 'm1', body: 'hen gap luc 10h30 sang mai' }]
    h.state.dictionary = { 'hẹn gặp lúc 10h30 sáng mai': 'See you at 10:30 tomorrow morning' }
    const { json } = await post({ ...OK, target: 'en' })
    expect(json.items).toEqual([{ id: 'm1', text: 'See you at 10:30 tomorrow morning', translated: true }])
  })

  it('an English line with uncommon words is not sent as French just because the writer\'s stored language is French', async () => {
    h.state.rows = [{ id: 'm1', body: 'Kindly revert regarding the aircon' }]
    h.state.writerLocales = ['fr']
    await post({ ...OK, target: 'vi' })
    const hint = h.state.translateCalls[0]?.opts.sourceHint.get('Kindly revert regarding the aircon')
    expect(hint).toBe('en')
  })
})

describe('chat translate — an echo dressed up is still an echo', () => {
  it('the restored line coming back with a full stop or a capital is no translation', async () => {
    h.state.rows = [{ id: 'm1', body: 'phong co may lanh khong' }]
    h.state.dictionary = { 'phòng có máy lạnh không': 'Phòng có máy lạnh không.' }
    const { json } = await post({ ...OK, target: 'en' })
    expect(json.items).toEqual([{ id: 'm1', text: 'phong co may lanh khong', translated: false }])
    expect(h.state.kvWrites).toHaveLength(0)
  })
})
