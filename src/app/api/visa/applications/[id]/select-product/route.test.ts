import { beforeEach, describe, expect, it, vi } from 'vitest'

// The route is the ENTITLEMENT + CONTRACT layer over selectVisaDmProduct (whose money/CAS/
// idempotence behavior is proven in src/lib/visa/dm-flow.test.ts — 8 suites). What must
// hold HERE: no unauthenticated caller reaches the flow, a malformed body or id never
// reaches it either, the rate limiter is consulted BEFORE any work, a flow refusal maps to
// its own status + code, and a selection that LANDED is a 200 even when the chained
// advance could not post a card (an error there would push the client into a retry loop
// against an already-converged operation).

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  state: {
    userId: 'user-1' as string | null,
    rateOk: true,
    rateCalls: [] as Row[],
    selectCalls: [] as Row[],
    selectResult: null as Row | null,
  },
}))

vi.mock('@/lib/admin', () => ({ getCurrentProfileId: () => Promise.resolve(h.state.userId) }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: (name: string, key: string, limit: number, window: string) => {
    h.state.rateCalls.push({ name, key, limit, window })
    return Promise.resolve({ success: h.state.rateOk })
  },
}))
vi.mock('@/lib/visa/dm-flow', () => ({
  selectVisaDmProduct: (input: Row) => {
    h.state.selectCalls.push(input)
    return Promise.resolve(h.state.selectResult)
  },
  visaDmFailureFor: () => ({ ok: false, error: 'internal_error', status: 500 }),
}))

import { POST } from './route'

const APP_ID = '11111111-1111-4111-8111-111111111111'

async function post(body: unknown, id = APP_ID): Promise<{ status: number; json: Row }> {
  const req = new Request(`http://test/api/visa/applications/${id}/select-product`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const res = await POST(req, { params: Promise.resolve({ id }) })
  return { status: res.status, json: (await res.json()) as Row }
}

beforeEach(() => {
  h.state.userId = 'user-1'
  h.state.rateOk = true
  h.state.rateCalls = []
  h.state.selectCalls = []
  h.state.selectResult = { ok: true, changed: true, advance: { ok: true, step: 1, messageId: 'msg-1', complete: false } }
})

describe('select-product route', () => {
  it('refuses a guest before any work', async () => {
    h.state.userId = null
    const { status } = await post({ listingId: 'listing-1' })
    expect(status).toBe(401)
    expect(h.state.rateCalls).toEqual([])
    expect(h.state.selectCalls).toEqual([])
  })

  it('404s a non-uuid id and 400s a malformed body, without reaching the flow', async () => {
    expect((await post({ listingId: 'listing-1' }, 'not-a-uuid')).status).toBe(404)
    expect((await post({})).status).toBe(400)
    expect((await post({ listingId: 'listing-1', amountUsd: 1 })).status).toBe(400) // .strict()
    expect(h.state.selectCalls).toEqual([])
  })

  it('rate-limits per (actor, application) and stops before the flow', async () => {
    h.state.rateOk = false
    const { status, json } = await post({ listingId: 'listing-1' })
    expect(status).toBe(429)
    expect(json.error).toBe('rate_limited')
    expect(h.state.rateCalls[0]).toMatchObject({ name: 'visa-select-product', key: `user-1:${APP_ID}` })
    expect(h.state.selectCalls).toEqual([])
  })

  it('carries the session id and the body listing into the flow, and shapes the 200', async () => {
    const { status, json } = await post({ listingId: 'listing-1' })
    expect(status).toBe(200)
    expect(h.state.selectCalls[0]).toEqual({ applicationId: APP_ID, userId: 'user-1', listingId: 'listing-1' })
    expect(json).toEqual({ changed: true, step: 1, nextMessageId: 'msg-1', complete: false })
  })

  it('maps a flow refusal to its own status + code', async () => {
    h.state.selectResult = { ok: false, error: 'application_locked', status: 409 }
    const { status, json } = await post({ listingId: 'listing-1' })
    expect(status).toBe(409)
    expect(json.error).toBe('application_locked')
  })

  it('a landed selection whose chained advance failed is STILL a 200 (no retry-bait)', async () => {
    h.state.selectResult = { ok: true, changed: true, advance: { ok: false, error: 'step_card_refused', status: 503 } }
    const { status, json } = await post({ listingId: 'listing-1' })
    expect(status).toBe(200)
    expect(json).toEqual({ changed: true, step: null, nextMessageId: null, complete: false })
  })
})
