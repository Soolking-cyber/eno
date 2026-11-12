import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/api/handler', () => ({ route: (_o: unknown, fn: (c: { req: Request }) => Promise<Response>) => (req: Request) => fn({ req }) }))

const load = async () => { vi.resetModules(); return (await import('./route')).GET }
const get = (GET: (r: Request) => Promise<Response>, q: string, extra = '') => GET(new Request(`https://eno.vn/api/geocode/suggest?q=${encodeURIComponent(q)}&lang=en${extra}`))
const FEATURE = { geometry: { coordinates: [106.74157, 10.80244] }, properties: { name: "McDonald's", housenumber: '159-161', street: 'Đường Võ Nguyên Giáp', district: 'An Khánh', state: 'Thành phố Hồ Chí Minh' } }

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

// Owner, 2026-11-12: suggestions while typing, from OpenStreetMap on eno's own server (src/lib/geo-suggest.ts).
describe('places as you type', () => {
  it("asks eno-photon on the box's network and answers the picker's rows", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ features: [FEATURE] })))
    vi.stubGlobal('fetch', f)
    const GET = await load()
    const r = await (await get(GET, 'mcdonalds thao dien', '&lat=10.8&lng=106.74')).json()
    const u = new URL(String((f.mock.calls[0] as unknown[])[0]))
    expect(u.origin).toBe('http://eno-photon:2322')
    expect(u.searchParams.get('lat')).toBe('10.8000')
    expect(r).toEqual({ available: true, results: [{ title: "McDonald's", detail: '159-161 Đường Võ Nguyên Giáp, An Khánh, Thành phố Hồ Chí Minh', lat: 10.80244, lng: 106.74157 }] })
  })
  it('under three letters asks nothing; a repeat is answered from memory', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ features: [FEATURE] })))
    vi.stubGlobal('fetch', f)
    const GET = await load()
    expect(await (await get(GET, 'Mc')).json()).toEqual({ results: [], available: true })
    await get(GET, 'mcdonalds')
    await get(GET, 'McDonalds')
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('⛔ a server that is missing says "not available" (the picker falls back to Enter); twice in a row, it is not asked again for half a minute', async () => {
    const f = vi.fn(async () => { throw new TypeError('fetch failed') })
    vi.stubGlobal('fetch', f)
    const GET = await load()
    expect(await (await get(GET, 'thao dien')).json()).toEqual({ results: [], available: false })
    expect(await (await get(GET, 'an phu')).json()).toEqual({ results: [], available: false })
    expect(await (await get(GET, 'binh thanh')).json()).toEqual({ results: [], available: false })
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('one slow answer is not "down" for everyone: the next keystroke asks again', async () => {
    let n = 0
    const f = vi.fn(async () => { if (n++ === 0) throw new DOMException('timed out', 'TimeoutError'); return new Response(JSON.stringify({ features: [FEATURE] })) })
    vi.stubGlobal('fetch', f)
    const GET = await load()
    expect((await (await get(GET, 'mcdonalds')).json()).available).toBe(false)
    expect((await (await get(GET, 'mcdonalds thao')).json()).results).toHaveLength(1)
  })
  it('an empty answer is not kept (the server may still be warming up): the same words ask again', async () => {
    let n = 0
    const f = vi.fn(async () => new Response(JSON.stringify({ features: n++ === 0 ? [] : [FEATURE] })))
    vi.stubGlobal('fetch', f)
    const GET = await load()
    expect((await (await get(GET, 'mcdonalds')).json()).results).toEqual([])
    expect((await (await get(GET, 'mcdonalds')).json()).results).toHaveLength(1)
  })
  it('a bias point needs both halves: a lone lat is no bias (never longitude 0)', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ features: [] })))
    vi.stubGlobal('fetch', f)
    const GET = await load()
    await get(GET, 'thao dien', '&lat=10.8')
    expect(new URL(String((f.mock.calls[0] as unknown[])[0])).searchParams.get('lon')).toBe('106.7009')
  })
  it('a 404 (a wrong path or version) is the server being wrong: "not available"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })))
    const GET = await load()
    expect(await (await get(GET, 'thao dien')).json()).toEqual({ results: [], available: false })
  })
  it('a query Photon refuses is "nothing found", not "server down"', async () => {
    const f = vi.fn(async () => new Response('bad request', { status: 400 }))
    vi.stubGlobal('fetch', f)
    const GET = await load()
    expect(await (await get(GET, '%%%')).json()).toEqual({ results: [], available: true })
    await get(GET, 'thao dien')
    expect(f).toHaveBeenCalledTimes(2)
  })
})
