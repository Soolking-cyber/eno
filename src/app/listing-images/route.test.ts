import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://proj.supabase.co')
const { GET } = await import('./route')
const mockFetch = vi.fn<typeof fetch>()
const request = (query = '?key=affiliate/product.webp') => new Request('http://localhost/listing-images' + query, {
  headers: { cookie: 'session=private', authorization: 'Bearer private', 'x-eno-edge': 'private' },
})
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  vi.stubEnv('LISTING_IMAGES_INTERNAL', 'true')
  mockFetch.mockReset()
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

describe('public listing image original route', () => {
  it('reads only the fixed internal public bucket without forwarding credentials', async () => {
    mockFetch.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/webp' } }))
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer)
    expect(mockFetch).toHaveBeenCalledWith('http://supabase-envoy:8000/storage/v1/object/public/listings/affiliate/product.webp', {
      redirect: 'manual', cache: 'no-store', signal: expect.any(AbortSignal),
    })
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-disposition')).toBe('attachment')
  })
  it('uses the public origin in local previews when internal routing is disabled', async () => {
    vi.stubEnv('LISTING_IMAGES_INTERNAL', '')
    mockFetch.mockResolvedValue(new Response('image', { headers: { 'content-type': 'image/png' } }))
    const response = await GET(request())
    expect(response.status).toBe(200)
    await response.body?.cancel()
    expect(mockFetch.mock.calls[0][0]).toBe('https://proj.supabase.co/storage/v1/object/public/listings/affiliate/product.webp')
  })
  it.each(['', '?url=http://127.0.0.1', '?key=', '?key=../private/a.webp', '?key=a/../b.webp',
    '?key=%2e%2e/a.webp', '?key=a%252Fb.webp', '?key=a.webp&key=b.webp', '?key=a.webp&url=http://localhost',
    '?key=//evil/a.webp', '?key=a\\b.webp', '?key=a.svg', '?key=a.mp4', '?key=.hidden.webp',
    '?key=http://localhost/a.webp', '?key=a.webp%0a', '?key=' + 'a'.repeat(2049) + '.webp'])('rejects noncanonical input %s', async query => {
    const result = await GET(request(query))
    expect(result.status).toBe(400)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(mockFetch).not.toHaveBeenCalled()
  })
  it('accepts Next-normalized query encoding without changing the canonical storage key', async () => {
    mockFetch.mockResolvedValue(new Response('image', { headers: { 'content-type': 'image/webp' } }))
    const response = await GET(request('?key=affiliate%2Fproduct.webp'))
    expect(response.status).toBe(200)
    expect(mockFetch.mock.calls[0][0]).toBe('http://supabase-envoy:8000/storage/v1/object/public/listings/affiliate/product.webp')
    await response.body?.cancel()
  })
  it.each([301, 302, 307, 404, 403, 500])('does not follow or cache upstream %s', async status => {
    mockFetch.mockResolvedValue(new Response('error', { status, headers: { location: 'http://169.254.169.254/', 'set-cookie': 'x=y' } }))
    const result = await GET(request())
    expect(result.status).toBe(status === 404 ? 404 : 502)
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(result.headers.get('set-cookie')).toBeNull()
    expect(await result.text()).toBe('')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
  it.each(['text/html', 'image/svg+xml', 'application/octet-stream'])('rejects content type %s', async type => {
    mockFetch.mockResolvedValue(new Response('bad', { headers: { 'content-type': type } }))
    expect((await GET(request())).status).toBe(502)
  })
  it('rejects an empty body', async () => {
    mockFetch.mockResolvedValue(new Response('', { headers: { 'content-type': 'image/webp' } }))
    expect((await GET(request())).status).toBe(502)
  })
  it('rejects oversized advertised lengths', async () => {
    mockFetch.mockResolvedValue(new Response('small', { headers: { 'content-type': 'image/webp', 'content-length': '50000001' } }))
    expect((await GET(request())).status).toBe(502)
  })
  it.each([undefined, '1'])('bounds streamed bytes with Content-Length=%s', async length => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(10_000_000)) }, cancel,
    })
    mockFetch.mockResolvedValue(new Response(stream, { headers: {
      'content-type': 'image/webp', ...(length ? { 'content-length': length } : {}),
    } }))
    const response = await GET(request())
    await expect(response.arrayBuffer()).rejects.toThrow('size limit')
    expect(cancel).toHaveBeenCalled()
  })
  it('streams with backpressure and cancels storage when the consumer disconnects', async () => {
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => controller.enqueue(new Uint8Array(1024)))
    const cancel = vi.fn()
    mockFetch.mockResolvedValue(new Response(new ReadableStream({ pull, cancel }), { headers: { 'content-type': 'image/webp' } }))
    const response = await GET(request())
    expect(pull.mock.calls.length).toBeLessThanOrEqual(3)
    await response.body?.cancel()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })
  it('returns an uncached 504 on its bounded upstream deadline', async () => {
    vi.useFakeTimers()
    mockFetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const pending = GET(request())
    await vi.advanceTimersByTimeAsync(5000)
    const result = await pending
    expect(result.status).toBe(504)
    expect(result.headers.get('cache-control')).toBe('no-store')
  })
  /** ⛔ REGRESSION: the deadline used to abort the BODY, not just the handshake. It was armed
   *  before `fetch` and cleared only in `cleanup()` (EOF/error/cancel), so a transfer still running
   *  at 5.000s died mid-stream — after a 200 had flushed, so the client got a truncated image and
   *  no error, and MAX_BYTES was unreachable. The existing 504 test passes either way because it
   *  covers a response that never STARTS; this one covers a body that started and keeps going. */
  it('keeps streaming a body that makes progress long past the connect deadline', async () => {
    vi.useFakeTimers()
    let release!: (value: { done: boolean; value?: Uint8Array }) => void
    const next = () => new Promise<{ done: boolean; value?: Uint8Array }>(resolve => { release = resolve })
    mockFetch.mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'image/webp' }),
      body: { getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: new Uint8Array([1]) })
          .mockImplementation(next),
        cancel: vi.fn(),
      }) },
    } as unknown as Response)
    const response = await GET(request())
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    expect((await reader.read()).value).toEqual(new Uint8Array([1]))
    // Three chunks, each arriving inside the idle window but the total far beyond CONNECT_MS.
    for (const byte of [2, 3, 4]) {
      const pending = reader.read()
      await vi.advanceTimersByTimeAsync(10_000)
      release({ done: false, value: new Uint8Array([byte]) })
      expect((await pending).value).toEqual(new Uint8Array([byte]))
      expect(mockFetch.mock.calls[0][1]?.signal?.aborted).toBe(false)
    }
  })
  /** The other half of the two-clock design: progress survives, SILENCE does not. Asserted on the
   *  upstream signal rather than on a rejected read — the route aborts, and what that abort does to
   *  an in-flight reader is the runtime's business, not this route's contract. */
  it('aborts the upstream when the body goes quiet for longer than the idle window', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    mockFetch.mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'image/webp' }),
      body: { getReader: () => ({
        read: vi.fn()
          .mockResolvedValueOnce({ done: false, value: new Uint8Array([1]) })
          .mockImplementation(() => new Promise(() => {})), // upstream stops sending, never settles
        cancel,
      }) },
    } as unknown as Response)
    const response = await GET(request())
    const reader = response.body!.getReader()
    expect((await reader.read()).value).toEqual(new Uint8Array([1]))
    void reader.read() // pull arms the idle watchdog, then waits on a read that never comes
    expect(mockFetch.mock.calls[0][1]?.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(mockFetch.mock.calls[0][1]?.signal?.aborted).toBe(true)
  })
  it('maps connection failures to uncached 502', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))
    expect((await GET(request())).status).toBe(502)
  })
})
