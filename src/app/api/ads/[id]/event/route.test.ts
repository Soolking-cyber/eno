import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * POST /api/ads/[id]/event (owner 2026-11-25: figures to industry standard): what reaches the counter (src/lib/ads/stats.ts)
 * and as what — always a 204, nothing written per event.
 */
vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ state: 'running' as 'running' | 'known' | 'unknown', events: [] as Record<string, unknown>[] }))
vi.mock('@/lib/ads/serve', () => ({ adEventState: async () => h.state }))
vi.mock('@/lib/ads/stats', () => ({ recordAdEvent: (e: Record<string, unknown>) => { h.events.push(e); return 'valid' } }))
vi.mock('@/lib/client-ip', () => ({ clientIp: (req: Request) => req.headers.get('x-test-ip') || '1.2.3.4' }))

const { POST } = await import('./route')
const SID = 'a'.repeat(32)
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const send = (body: unknown, headers: Record<string, string> = {}, id = 'cmad0000001') =>
  POST(new NextRequest(`https://eno.vn/api/ads/${id}/event`, { method: 'POST', headers: { 'user-agent': UA, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }), { params: Promise.resolve({ id }) })

beforeEach(() => { h.state = 'running'; h.events = [] })

describe('POST /api/ads/[id]/event', () => {
  it('a viewable impression and a click from a person, with the session id', async () => {
    expect((await send({ t: 'i', s: SID })).status).toBe(204)
    expect((await send({ t: 'c', s: SID })).status).toBe(204)
    expect(h.events).toEqual([
      { adId: 'cmad0000001', kind: 'i', sid: SID, ip: '1.2.3.4', givt: false, running: true },
      { adId: 'cmad0000001', kind: 'c', sid: SID, ip: '1.2.3.4', givt: false, running: true },
    ])
  })

  it('GIVT: a known bot or a prefetch is reported as invalid traffic; an ad not running now too', async () => {
    await send({ t: 'i', s: SID }, { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' })
    await send({ t: 'i', s: SID }, { 'sec-purpose': 'prefetch;prerender' })
    await send({ t: 'i', s: SID }, { purpose: 'prefetch' })
    h.state = 'known'
    await send({ t: 'c', s: SID })
    expect(h.events.map((e) => [e.givt, e.running])).toEqual([[true, true], [true, true], [true, true], [false, false]])
  })

  it('an id that is no ad, a bad id, a bad kind or a body that is not JSON → nothing counted, still 204', async () => {
    h.state = 'unknown'
    expect((await send({ t: 'i', s: SID })).status).toBe(204)
    h.state = 'running'
    expect((await send({ t: 'i' }, {}, 'bad!')).status).toBe(204)
    expect((await send({ t: 'x', s: SID })).status).toBe(204)
    expect((await send('not json')).status).toBe(204)
    expect(h.events).toEqual([])
  })

  it('a malformed session id is dropped (the address stands in); IPv6 is keyed by its /64', async () => {
    await send({ t: 'i', s: 'short' }, { 'x-test-ip': '2405:4803:c7fd:1::9' })
    expect(h.events[0]).toMatchObject({ sid: null, ip: 'v6:2405:4803:c7fd:1' })
  })
})
