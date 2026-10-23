import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * safeFetch FOLLOWS A REDIRECT THE WAY THE FETCH STANDARD DOES (refute review, 2026-10-23). The loop used to replay the
 * original request verbatim at every hop: a webhook's signed POST body and headers went on to whatever host the
 * Location named, and a 303 after a POST was re-POSTed. Pinned here, against a scripted undici:
 *   · 301/302 after a POST, and 303 after anything but GET/HEAD, continue as a body-less GET without the body headers;
 *   · 307/308 keep the method and the body;
 *   · a hop to another origin drops Authorization, Cookie and Proxy-Authorization;
 *   · `followRedirects: false` hands the 3xx back and makes no second request;
 *   · every hop is still re-validated (scheme and address).
 */

type Sent = { url: string; method: string; headers: Record<string, string>; body?: string }
const h = vi.hoisted(() => ({ sent: [] as Sent[], script: [] as Array<{ status: number; location?: string }> }))

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }))
vi.mock('undici', () => ({
  Agent: class {},
  fetch: async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    h.sent.push({ url, method: init.method, headers: { ...init.headers }, body: init.body })
    const next = h.script.shift() ?? { status: 200 }
    const headers = new Headers(next.location ? { location: next.location } : {})
    return new Response(next.status === 204 || next.status >= 300 ? null : 'ok', { status: next.status, headers })
  },
}))

const { safeFetch } = await import('@/lib/ssrf')

const SIGNED = { 'Content-Type': 'application/json', 'webhook-signature': 'v1,abc', Authorization: 'Bearer t', 'X-Trace': '1' }
const post = (extra: Partial<Parameters<typeof safeFetch>[1]> = {}) =>
  safeFetch('https://hooks.example/in', { timeoutMs: 1000, method: 'POST', headers: SIGNED, body: '{"a":1}', ...extra })

beforeEach(() => { h.sent = []; h.script = [] })

describe('method and body across a redirect', () => {
  it.each([301, 302])('⛔ %s after a POST continues as a GET with no body and no body headers', async (status) => {
    h.script = [{ status, location: '/moved' }]
    await post()
    expect(h.sent[1]).toMatchObject({ url: 'https://hooks.example/moved', method: 'GET', body: undefined })
    expect(h.sent[1].headers['content-type']).toBeUndefined()
    expect(h.sent[1].headers['x-trace']).toBe('1') // an unrelated header survives a same-origin hop
  })

  it('⛔ 303 after a PUT continues as a GET', async () => {
    h.script = [{ status: 303, location: '/done' }]
    await safeFetch('https://hooks.example/in', { timeoutMs: 1000, method: 'PUT', body: 'x' })
    expect(h.sent[1]).toMatchObject({ method: 'GET', body: undefined })
  })

  it.each([307, 308])('%s keeps the method and the body, as the standard says', async (status) => {
    h.script = [{ status, location: '/again' }]
    await post()
    expect(h.sent[1]).toMatchObject({ method: 'POST', body: '{"a":1}' })
  })
})

describe('credentials never cross origins', () => {
  it('⛔ a hop to another origin drops Authorization (and Cookie, Proxy-Authorization)', async () => {
    h.script = [{ status: 307, location: 'https://elsewhere.example/x' }]
    await safeFetch('https://hooks.example/in', { timeoutMs: 1000, headers: { Authorization: 'Bearer t', Cookie: 'a=b', 'Proxy-Authorization': 'p', 'X-Trace': '1' } })
    expect(h.sent[1].headers).toEqual({ 'x-trace': '1' })
  })

  it('a same-origin hop keeps them', async () => {
    h.script = [{ status: 307, location: '/x' }]
    await safeFetch('https://hooks.example/in', { timeoutMs: 1000, headers: { Authorization: 'Bearer t' } })
    expect(h.sent[1].headers).toEqual({ authorization: 'Bearer t' })
  })
})

describe('followRedirects: false', () => {
  it('⛔ hands the 3xx back and never makes the second request (webhook delivery)', async () => {
    h.script = [{ status: 302, location: 'https://elsewhere.example/steal' }]
    const res = await post({ followRedirects: false })
    expect(res.status).toBe(302)
    expect(h.sent).toHaveLength(1)
  })
})

describe('every hop is re-validated', () => {
  it('a redirect to plaintext http is refused', async () => {
    h.script = [{ status: 302, location: 'http://hooks.example/x' }]
    await expect(post()).rejects.toThrow('ssrf:scheme')
  })

  it('a redirect to the metadata service is refused before it is requested', async () => {
    h.script = [{ status: 302, location: 'https://169.254.169.254/latest/meta-data/' }]
    await expect(post()).rejects.toThrow('ssrf:private_host')
    expect(h.sent).toHaveLength(1)
  })

  it('a chain longer than maxHops is refused', async () => {
    h.script = [{ status: 302, location: '/1' }, { status: 302, location: '/2' }]
    await expect(safeFetch('https://hooks.example/in', { timeoutMs: 1000, maxHops: 1 })).rejects.toThrow('ssrf:too_many_redirects')
  })
})
