import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from '@/lib/api/client'

/**
 * `apiFetch` — the cases every hand-rolled call site gets wrong.
 *
 * The 176 raw `fetch('/api/…')` sites this replaces each re-implement the same four steps, and the
 * bugs are always in the same three places: a body-less 204 that `res.json()` throws on, a network
 * rejection nobody catches, and an error code compared as a bare string. Each has a test here.
 */

const origFetch = globalThis.fetch

function respond(status: number, body?: unknown, opts: { text?: string } = {}) {
  const payload = opts.text !== undefined ? opts.text : body === undefined ? '' : JSON.stringify(body)
  globalThis.fetch = vi.fn(async () =>
    new Response(status === 204 ? null : payload, { status, headers: { 'content-type': 'application/json' } }),
  ) as typeof fetch
}

beforeEach(() => { globalThis.fetch = origFetch })
afterEach(() => { globalThis.fetch = origFetch; vi.restoreAllMocks() })

describe('success', () => {
  it('returns the parsed body', async () => {
    respond(200, { id: 'c1' })
    const r = await apiFetch<{ id: string }>('/api/conversations')
    expect(r).toMatchObject({ ok: true, status: 200 })
    if (r.ok) expect(r.data.id).toBe('c1')
  })

  it('a 204 does not throw — the classic hand-rolled bug', async () => {
    // `await res.json()` on an empty body throws SyntaxError. Call sites that forget it turn a
    // successful delete into an error toast.
    respond(204)
    const r = await apiFetch('/api/saved/x', { method: 'DELETE' })
    expect(r.ok).toBe(true)
  })

  it('sets the JSON content-type and stringifies, so call sites stop repeating it', async () => {
    const spy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 }))
    globalThis.fetch = spy as unknown as typeof fetch
    await apiFetch('/api/conversations', { method: 'POST', json: { listingId: 'l1' } })
    const init = spy.mock.calls[0][1] as RequestInit
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
    expect(init.body).toBe('{"listingId":"l1"}')
  })

  it.each([
    ['a Headers instance', new Headers({ authorization: 'Bearer t', 'x-idem': 'k1' })],
    ['an array of pairs', [['authorization', 'Bearer t'], ['x-idem', 'k1']] as [string, string][]],
    ['a plain object', { authorization: 'Bearer t', 'x-idem': 'k1' }],
  ])('preserves caller headers passed as %s', async (_label, headers) => {
    // ⚠️ THE REGRESSION THIS PINS. The first version merged with `{ 'content-type': …, ...headers }`,
    // which only works for a plain object: spreading a `Headers` gives `{}` and spreading an array
    // gives `{ "0": [...] }`. An Authorization or Idempotency-Key header would have vanished from
    // the wire with no error at all. Caught in review before any call site existed.
    const spy = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 }))
    globalThis.fetch = spy as unknown as typeof fetch
    await apiFetch('/api/x', { method: 'POST', json: { a: 1 }, headers })
    const sent = new Headers((spy.mock.calls[0][1] as RequestInit).headers)
    expect(sent.get('authorization')).toBe('Bearer t')
    expect(sent.get('x-idem')).toBe('k1')
    expect(sent.get('content-type')).toBe('application/json')
  })

  it('an explicit content-type wins over the JSON default', async () => {
    const spy = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 }))
    globalThis.fetch = spy as unknown as typeof fetch
    await apiFetch('/api/x', { method: 'POST', json: { a: 1 }, headers: { 'content-type': 'application/merge-patch+json' } })
    expect(new Headers((spy.mock.calls[0][1] as RequestInit).headers).get('content-type'))
      .toBe('application/merge-patch+json')
  })
})

describe('failure', () => {
  it('narrows a known error code', async () => {
    respond(403, { error: 'reply_required' })
    const r = await apiFetch('/api/listings/l1/contact', { method: 'POST' })
    expect(r).toMatchObject({ ok: false, code: 'reply_required', status: 403 })
  })

  it('code is null for an UNRECOGNISED error string, not the raw string', async () => {
    // Returning the unknown string would let a caller believe it type-checked something the union
    // never described. Null forces the "I do not know what this is" branch to exist.
    respond(400, { error: 'code_from_the_future' })
    const r = await apiFetch('/api/x')
    expect(r).toMatchObject({ ok: false, code: null })
  })

  it('code is null for an HTML error page from the edge', async () => {
    // A 502 from Cloudflare is not JSON. Hand-rolled sites hit a SyntaxError here.
    respond(502, undefined, { text: '<html>Bad gateway</html>' })
    const r = await apiFetch('/api/x')
    expect(r).toMatchObject({ ok: false, code: null, status: 502 })
    if (!r.ok) expect(r.body).toContain('Bad gateway')
  })

  it('a network drop is a RESULT, not an exception', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') }) as typeof fetch
    const r = await apiFetch('/api/x')
    expect(r).toMatchObject({ ok: false, code: null, status: 0 })
  })

  it.each([
    ['a DOMException', () => new DOMException('aborted', 'AbortError')],
    // Some polyfills and older runtimes reject with a plain Error carrying the same name, which an
    // `instanceof DOMException` check would miss — turning a cancelled navigation into an error
    // toast. Raised in review; matched by NAME now.
    ['a plain Error named AbortError', () => Object.assign(new Error('aborted'), { name: 'AbortError' })],
  ])('an AbortError still THROWS when it is %s', async (_label, make) => {
    globalThis.fetch = vi.fn(async () => { throw make() }) as typeof fetch
    await expect(apiFetch('/api/x')).rejects.toThrow(/abort/i)
  })
})
