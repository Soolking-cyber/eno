import { beforeEach, describe, expect, it, vi } from 'vitest'

// The resume route makes ONE case the active one in the buyer↔desk thread and brings its form
// down. It became necessary the moment applying for a different visa type started minting its
// own case: one conversation, several drafts, and a live pointer that names exactly one.
//
// What must hold here: no guest and no non-owner can move a binding; the BIND is what has to
// succeed (a refused card is reported, not disguised); and a resume whose pointer was stolen
// between the bind and the card says so instead of claiming a card the thread will ignore.

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  state: {
    userId: 'buyer-1' as string | null,
    rateOk: true,
    rateCalls: [] as Row[],
    bindResult: { ok: true, conversationId: 'convo-1', created: false } as Row,
    bindCalls: [] as Row[],
    resendResult: { ok: true, messageId: 'msg-1', step: 2 } as Row,
    resendCalls: [] as Row[],
    /** What findVisaThread reports AFTER the resend — null = another case took the pointer. */
    stillBound: { conversationId: 'convo-1' } as Row | null,
  },
}))

vi.mock('@/lib/admin', () => ({ getCurrentProfileId: () => Promise.resolve(h.state.userId) }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: (name: string, key: string, limit: number, window: string, opts?: Row) => {
    h.state.rateCalls.push({ name, key, limit, window, opts })
    return Promise.resolve({ success: h.state.rateOk, remaining: 0 })
  },
}))
vi.mock('@/lib/visa/dm-thread', () => ({
  bindVisaThread: (input: Row) => { h.state.bindCalls.push(input); return Promise.resolve(h.state.bindResult) },
  findVisaThread: () => Promise.resolve(h.state.stillBound),
}))
vi.mock('@/lib/visa/dm-flow', () => ({
  resendVisaDmCard: (input: Row) => { h.state.resendCalls.push(input); return Promise.resolve(h.state.resendResult) },
  visaDmFailureFor: () => ({ error: 'internal_error', status: 500 }),
}))

import { POST } from './route'

const APP_ID = '33333333-3333-4333-8333-333333333333'

async function post(id = APP_ID): Promise<{ status: number; json: Row }> {
  const req = new Request(`http://test/api/visa/applications/${id}/resume`, { method: 'POST' })
  const res = await POST(req, { params: Promise.resolve({ id }) })
  return { status: res.status, json: (await res.json()) as Row }
}

beforeEach(() => {
  h.state.userId = 'buyer-1'
  h.state.rateOk = true
  h.state.rateCalls = []
  h.state.bindResult = { ok: true, conversationId: 'convo-1', created: false }
  h.state.bindCalls = []
  h.state.resendResult = { ok: true, messageId: 'msg-1', step: 2 }
  h.state.resendCalls = []
  h.state.stillBound = { conversationId: 'convo-1' }
})

describe('visa resume — who may move a binding', () => {
  it('refuses a guest before touching anything', async () => {
    h.state.userId = null
    expect((await post()).status).toBe(401)
    expect(h.state.bindCalls).toHaveLength(0)
  })

  it('404s a non-uuid id without reaching the flow', async () => {
    expect((await post('not-a-uuid')).status).toBe(404)
    expect(h.state.bindCalls).toHaveLength(0)
  })

  it('binds as the SESSION user — never a client-supplied buyer', async () => {
    await post()
    expect(h.state.bindCalls[0]).toEqual({ applicationId: APP_ID, buyerProfileId: 'buyer-1' })
  })

  it('403s somebody else’s case, and posts no card', async () => {
    h.state.bindResult = { ok: false, error: 'not_owner' }
    const { status } = await post()
    expect(status).toBe(403)
    expect(h.state.resendCalls).toHaveLength(0)
  })

  it('maps the other bind refusals to their own statuses', async () => {
    for (const [error, expected] of [['thread_conflict', 409], ['shop_unavailable', 503], ['listing_unavailable', 503]] as const) {
      h.state.bindResult = { ok: false, error }
      expect((await post()).status, error).toBe(expected)
    }
  })

  it('rate limits STRICTLY, before any binding', async () => {
    h.state.rateOk = false
    expect((await post()).status).toBe(429)
    expect(h.state.rateCalls[0]).toMatchObject({ name: 'visa-dm-resume', key: `buyer-1:${APP_ID}`, opts: { strict: true } })
    expect(h.state.bindCalls).toHaveLength(0)
  })
})

describe('visa resume — honest outcomes', () => {
  it('rebinds and brings the form down', async () => {
    const { status, json } = await post()
    expect(status).toBe(200)
    expect(json).toMatchObject({ conversationId: 'convo-1', cardPosted: true })
    expect(json.superseded).toBeUndefined()
    expect(h.state.resendCalls[0]).toEqual({ applicationId: APP_ID, actorId: 'buyer-1' })
  })

  it('a refused CARD still succeeds — the binding is what mattered', async () => {
    // The thread is correctly bound either way; the chip can post the form. Failing the whole
    // resume here would strand the applicant on a case they are entitled to open.
    h.state.resendResult = { ok: false, error: 'too_many', status: 429 }
    const { status, json } = await post()
    expect(status).toBe(200)
    expect(json).toMatchObject({ conversationId: 'convo-1', cardPosted: false, cardError: 'too_many' })
  })

  it('reports `superseded` when another resume stole the pointer mid-flight', async () => {
    // Two tabs. Last action wins is fine; claiming success for a card the thread will treat as
    // inert history is not, so the client can say what happened.
    h.state.stillBound = null
    const { status, json } = await post()
    expect(status).toBe(200)
    expect(json.superseded).toBe(true)
  })
})
