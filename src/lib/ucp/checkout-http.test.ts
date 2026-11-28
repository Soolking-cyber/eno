import { describe, expect, it, vi } from 'vitest'

// eno.vn's edition: the door answers 404 on any other build.
vi.hoisted(() => { process.env.NEXT_PUBLIC_ENO_EDITION = 'marketplace' })

vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 1 }), kv: { get: async () => null, set: async () => 'OK', del: async () => {} } }))
vi.mock('./agent', async (orig) => ({ ...(await orig<typeof import('./agent')>()), checkAgent: async (req: Request) => (req.headers.get('ucp-agent') ? { ok: true, profile: 'https://a.example/ucp' } : { ok: false, code: 'invalid_request', status: 400, content: 'UCP-Agent required' }) }))
vi.mock('./checkout', () => ({ CheckoutError: class extends Error {} }))
const { ucpCheckout } = await import('./checkout-http')

const post = (headers: Record<string, string>, body = '{}') => new Request('https://eno.vn/api/ucp/checkout-sessions', { method: 'POST', headers, body })

describe('the checkout door', () => {
  it('refuses a call without UCP-Agent, and a state change without Idempotency-Key, before running anything', async () => {
    const run = vi.fn(async () => ({ id: 'chk_1' }))
    expect((await ucpCheckout(post({}), { mutates: true, run })).status).toBe(400)
    const noKey = await ucpCheckout(post({ 'UCP-Agent': 'profile="https://a.example/ucp"' }), { mutates: true, run })
    expect(noKey.status).toBe(400)
    expect(await noKey.json()).toMatchObject({ ucp: { status: 'error' }, messages: [{ code: 'invalid_request' }] })
    expect(run).not.toHaveBeenCalled()
    const ok = await ucpCheckout(post({ 'UCP-Agent': 'profile="https://a.example/ucp"', 'Idempotency-Key': 'k1', 'Request-Id': 'r1' }), { mutates: true, run })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('request-id')).toBe('r1')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('complete needs no Idempotency-Key and always answers the live state', async () => {
    let n = 0
    const run = vi.fn(async () => ({ status: ++n }))
    const done = () => ucpCheckout(post({ 'UCP-Agent': 'profile="https://a.example/ucp"', 'Idempotency-Key': 'same' }), { mutates: true, replay: false, run })
    expect(await (await done()).json()).toEqual({ status: 1 })
    expect(await (await done()).json()).toEqual({ status: 2 })
  })

  it('an unknown session is 404 with a UCP error body', async () => {
    const res = await ucpCheckout(new Request('https://eno.vn/api/ucp/checkout-sessions/x', { headers: { 'UCP-Agent': 'profile="https://a.example/ucp"' } }), { mutates: false, run: async () => null })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ messages: [{ code: 'not_found' }] })
  })
})
