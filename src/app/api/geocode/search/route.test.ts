import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ rateOk: true }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/api/handler', () => ({ route: (_o: unknown, fn: (c: { req: Request }) => Promise<Response>) => (req: Request) => fn({ req }) }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: h.rateOk }) }))

const { GET } = await import('./route')
const get = (q: string, lang = 'vi') => GET(new Request(`https://eno.vn/api/geocode/search?q=${encodeURIComponent(q)}&lang=${lang}`))

beforeEach(() => { h.rateOk = true })
afterEach(() => vi.unstubAllGlobals())

// Owner, 2026-11-07: type an address, find the place (OpenStreetMap, on Enter).
describe('address search', () => {
  it('asks Nominatim for Vietnam only, five at most, in the page language, and answers label + point', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify([
      { display_name: 'Song Hành, Phường An Khánh, Thành phố Hồ Chí Minh, Việt Nam', lat: '10.8016', lon: '106.7371' },
      { display_name: 'Somewhere else', lat: '48.85', lon: '2.35' },
    ])))
    vi.stubGlobal('fetch', f)
    const r = await (await get('Song Hành An Khánh')).json()
    const u = new URL(String((f.mock.calls[0] as unknown[])[0]))
    expect(u.origin + u.pathname).toBe('https://nominatim.openstreetmap.org/search')
    expect(u.searchParams.get('countrycodes')).toBe('vn')
    expect(u.searchParams.get('limit')).toBe('5')
    expect(u.searchParams.get('accept-language')).toBe('vi')
    // ⛔ Only the text, no caller details: a fixed User-Agent and nothing else.
    expect((f.mock.calls[0] as unknown[])[1]).toMatchObject({ headers: { 'User-Agent': 'eno.vn Marketplace/1.0 (https://eno.vn)' } })
    expect(r).toEqual({ results: [{ label: 'Song Hành, Phường An Khánh, Thành phố Hồ Chí Minh', lat: 10.8016, lng: 106.7371 }] })
  })
  it('under three letters asks nothing; the shared budget spent is a 429; a repeat is answered from memory', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify([{ display_name: 'Quận 7, Hồ Chí Minh', lat: '10.73', lon: '106.72' }])))
    vi.stubGlobal('fetch', f)
    expect(await (await get('Q7')).json()).toEqual({ results: [] })
    expect(f).not.toHaveBeenCalled()
    await get('Quận 7 cache test')
    h.rateOk = false
    expect((await get('Quận 7 cache test')).status).toBe(200)
    expect(f).toHaveBeenCalledTimes(1)
    expect((await get('Somewhere new')).status).toBe(429)
  })
})
