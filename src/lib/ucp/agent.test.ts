import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ kv: new Map<string, unknown>(), fetch: vi.fn(), limit: { success: true, resetSec: 1 }, limitCalls: 0 }))
vi.mock('@/lib/ratelimit', () => ({
  kv: { get: async (k: string) => h.kv.get(k) ?? null, set: async (k: string, v: unknown) => { h.kv.set(k, v); return 'OK' } },
  rateLimit: async () => { h.limitCalls++; return h.limit },
}))
vi.mock('@/lib/ssrf', () => ({ safeFetch: h.fetch }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))

const { agentProfileUrl, supportsCheckout, checkAgent } = await import('./agent')

const PROFILE = { ucp: { version: '2026-08-25', capabilities: { 'dev.ucp.shopping.checkout': [{ version: '2026-08-25' }] } } }
const req = (agent?: string) => new Request('https://eno.vn/api/ucp/checkout-sessions', { method: 'POST', headers: agent ? { 'UCP-Agent': agent } : {} })

beforeEach(() => { h.kv.clear(); h.fetch.mockReset(); h.limit = { success: true, resetSec: 1 }; h.limitCalls = 0 })

describe('UCP-Agent', () => {
  it('reads profile="https://…" (an RFC 8941 dictionary) and refuses anything else', () => {
    expect(agentProfileUrl('profile="https://agent.example/.well-known/ucp"')).toBe('https://agent.example/.well-known/ucp')
    expect(agentProfileUrl('x=1, profile="https://a.example/p"')).toBe('https://a.example/p')
    expect(agentProfileUrl('profile="http://a.example/p"')).toBeNull()
    expect(agentProfileUrl('profile="https://user:pw@a.example/p"')).toBeNull()
    expect(agentProfileUrl(null)).toBeNull()
  })

  it('a profile supports checkout only at eno.vn\'s version', () => {
    expect(supportsCheckout(PROFILE)).toBe(true)
    expect(supportsCheckout({ ucp: { capabilities: { 'dev.ucp.shopping.checkout': [{ version: '2026-01-11' }] } } })).toBe(false)
    expect(supportsCheckout({})).toBe(false)
  })

  it('missing header → 400; a profile that supports checkout → ok, fetched once (no redirects) then cached', async () => {
    expect(await checkAgent(req(), '1.1.1.1')).toMatchObject({ ok: false, status: 400 })
    h.fetch.mockResolvedValue(new Response(JSON.stringify(PROFILE), { status: 200 }))
    expect(await checkAgent(req('profile="https://agent.example/.well-known/ucp"'), '1.1.1.1')).toEqual({ ok: true, profile: 'https://agent.example/.well-known/ucp' })
    expect(await checkAgent(req('profile="https://agent.example/.well-known/ucp"'), '1.1.1.1')).toMatchObject({ ok: true })
    expect(h.fetch).toHaveBeenCalledTimes(1)
    expect(h.fetch.mock.calls[0][1]).toMatchObject({ followRedirects: false })
  })

  it('a redirect, a failure or a profile without checkout → capabilities_incompatible at 200, and the failure is cached too', async () => {
    h.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://x.example' } }))
    const out = await checkAgent(req('profile="https://bad.example/ucp"'), '1.1.1.1')
    expect(out).toMatchObject({ ok: false, code: 'capabilities_incompatible', status: 200 })
    await checkAgent(req('profile="https://bad.example/ucp"'), '1.1.1.1')
    expect(h.fetch).toHaveBeenCalledTimes(1)
    h.fetch.mockRejectedValue(new Error('refused: private address'))
    expect(await checkAgent(req('profile="https://10.example/ucp"'), '1.1.1.1')).toMatchObject({ ok: false, code: 'capabilities_incompatible' })
  })

  it('one address cannot make the server fetch new profiles without bound', async () => {
    h.limit = { success: false, resetSec: 30 }
    expect(await checkAgent(req('profile="https://new.example/ucp"'), '9.9.9.9')).toMatchObject({ ok: false, code: 'rate_limited', status: 429 })
    expect(h.fetch).not.toHaveBeenCalled()
  })
})
