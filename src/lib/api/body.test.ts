import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/api-error'
import { JSON_BODY_CAP, bodyTooLarge, readBytesCapped, readJsonCapped } from '@/lib/api/body'

/**
 * THE CAPPED BODY READERS (appsec-02). Every first-party JSON body now goes through readJsonCapped — route()'s `body:`
 * and the public handlers that parse before their limiter — so what is pinned here is what every one of them answers:
 * a body past the cap is refused before a byte of it is parsed, whether its length is declared or not, and anything
 * under it reads exactly as `req.json()` read it.
 */

const URL_ = 'https://eno.vn/api/x'
const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request(URL_, { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } })

/** A body with NO content-length (a chunked upload), streamed in pieces, recording how much was pulled and whether it was cancelled. */
function streamed(total: number, headers: Record<string, string> = {}, chunk = 4096) {
  const seen = { pulled: 0, cancelled: false }
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (seen.pulled >= total) return c.close()
      const n = Math.min(chunk, total - seen.pulled)
      seen.pulled += n
      c.enqueue(new Uint8Array(n).fill(0x20)) // spaces: valid JSON whitespace, so only the cap can refuse it
    },
    cancel() { seen.cancelled = true },
  }, { highWaterMark: 0 }) // pulled only when read, so `pulled` is what the reader asked for
  const req = new Request(URL_, { method: 'POST', body: stream, headers, duplex: 'half' } as RequestInit)
  return { req, seen }
}

/** A JSON object of exactly `n` bytes. */
const jsonOfBytes = (n: number) => {
  const shell = JSON.stringify({ pad: '' })
  return JSON.stringify({ pad: 'a'.repeat(n - shell.length) })
}

async function refusal(p: Promise<unknown>): Promise<{ code: string; status: number }> {
  try { await p } catch (e) {
    expect(e).toBeInstanceOf(ApiError)
    return { code: (e as ApiError).code, status: (e as ApiError).status }
  }
  throw new Error('expected a refusal')
}

describe('readJsonCapped', () => {
  it('the default cap is 64 KB', () => {
    expect(JSON_BODY_CAP).toBe(65_536)
  })

  it('reads a body of exactly the cap, and refuses one byte more with 413 payload_too_large', async () => {
    const at = jsonOfBytes(JSON_BODY_CAP)
    expect(Buffer.byteLength(at)).toBe(JSON_BODY_CAP)
    expect(await readJsonCapped(post(at))).toEqual(JSON.parse(at))
    expect(await refusal(readJsonCapped(post(jsonOfBytes(JSON_BODY_CAP + 1))))).toEqual({ code: 'payload_too_large', status: 413 })
  })

  it('honours a route’s own cap', async () => {
    const body = jsonOfBytes(100 * 1024)
    expect(await readJsonCapped(post(body), 128 * 1024)).toEqual(JSON.parse(body))
    expect(await refusal(readJsonCapped(post(jsonOfBytes(128 * 1024 + 1)), 128 * 1024))).toEqual({ code: 'payload_too_large', status: 413 })
  })

  it('a declared length past the cap is refused before ANY of the body is read', async () => {
    const { req, seen } = streamed(10, { 'content-length': String(JSON_BODY_CAP + 1) })
    expect(await refusal(readJsonCapped(req))).toEqual({ code: 'payload_too_large', status: 413 })
    expect(seen.pulled).toBe(0)
  })

  it('an UNLABELLED body is counted as it streams: refused once past the cap, the rest never pulled, the stream cancelled', async () => {
    const { req, seen } = streamed(10 * 1024 * 1024) // what the proxy hands a route today
    expect(await refusal(readJsonCapped(req))).toEqual({ code: 'payload_too_large', status: 413 })
    expect(seen.pulled).toBeLessThanOrEqual(JSON_BODY_CAP + 4096)
    expect(seen.cancelled).toBe(true)
  })

  it('counts BYTES, not characters: 30,000 Vietnamese/CJK characters are ~90 KB and over the cap', async () => {
    const text = JSON.stringify({ t: 'ế'.repeat(30_000) })
    expect(text.length).toBeLessThan(JSON_BODY_CAP)
    expect(Buffer.byteLength(text)).toBeGreaterThan(JSON_BODY_CAP)
    expect(await refusal(readJsonCapped(post(text)))).toEqual({ code: 'payload_too_large', status: 413 })
  })

  it('anything that is not JSON, and a missing body, is 400 bad_request', async () => {
    expect(await refusal(readJsonCapped(post('{"a":')))).toEqual({ code: 'bad_request', status: 400 })
    expect(await refusal(readJsonCapped(post('')))).toEqual({ code: 'bad_request', status: 400 })
    expect(await refusal(readJsonCapped(new Request(URL_, { method: 'POST' })))).toEqual({ code: 'bad_request', status: 400 })
  })

  it('returns what req.json() returns: null, arrays, numbers, non-ASCII, a leading byte-order mark dropped', async () => {
    for (const body of ['null', '[1,2]', '5', '"x"', '{"t":"Hồ Chí Minh 東京"}', '﻿{"a":1}']) {
      expect(await readJsonCapped(post(body))).toEqual(await post(body).json())
    }
  })
})

describe('readBytesCapped', () => {
  it('returns the exact bytes under the cap, for the HMAC and multipart readers', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252])
    expect([...(await readBytesCapped(post(bytes), 6))]).toEqual([...bytes])
    expect(await refusal(readBytesCapped(post(bytes), 5))).toEqual({ code: 'payload_too_large', status: 413 })
  })
})

describe('bodyTooLarge', () => {
  it('is the 413 {"error":"payload_too_large"} for the size refusal, and null for anything else', async () => {
    const res = bodyTooLarge(new ApiError('payload_too_large', 413))
    expect(res?.status).toBe(413)
    expect(await res?.json()).toEqual({ error: 'payload_too_large' })
    expect(bodyTooLarge(new ApiError('bad_request', 400))).toBeNull()
    expect(bodyTooLarge(new SyntaxError('Unexpected end of JSON input'))).toBeNull()
    expect(bodyTooLarge(null)).toBeNull()
  })

  it('carries the headers a route passes (its no-store), and none it does not', () => {
    const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache' }
    const res = bodyTooLarge(new ApiError('payload_too_large', 413), NO_STORE)
    expect(res?.headers.get('cache-control')).toBe('no-store, no-cache, must-revalidate')
    expect(res?.headers.get('pragma')).toBe('no-cache')
    expect(bodyTooLarge(new ApiError('payload_too_large', 413))?.headers.get('cache-control')).toBeNull()
    expect(bodyTooLarge(new ApiError('bad_request', 400), NO_STORE)).toBeNull()
  })

  it('a reader whose cancel fails still refuses (the failure is logged, not thrown)', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(c) { c.enqueue(new Uint8Array(70_000)) },
      cancel() { throw new Error('boom') },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const req = new Request(URL_, { method: 'POST', body: stream, duplex: 'half' } as RequestInit)
      expect(await refusal(readJsonCapped(req))).toEqual({ code: 'payload_too_large', status: 413 })
    } finally {
      warn.mockRestore()
    }
  })

  it('a reader whose cancel never settles still refuses at once (commit-gate review: the 413 must not wait for it)', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(c) { c.enqueue(new Uint8Array(70_000)) },
      cancel() { return new Promise<void>(() => {}) }, // e.g. a tee'd stream whose other branch is still being read
    })
    const req = new Request(URL_, { method: 'POST', body: stream, duplex: 'half' } as RequestInit)
    const answer = await Promise.race([
      refusal(readJsonCapped(req)),
      new Promise((resolve) => setTimeout(() => resolve('still waiting on cancel'), 500)),
    ])
    expect(answer).toEqual({ code: 'payload_too_large', status: 413 })
  })
})
