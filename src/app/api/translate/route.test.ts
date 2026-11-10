import { beforeEach, describe, expect, it, vi } from 'vitest'

// /api/translate's answer when the PROVIDER fails (gate review, 2026-10-07): source text for the misses, flagged
// `partial` — so the dictionary loader does not persist it and mt-client retries it rather than giving it up as a
// string that translates to itself.
const h = vi.hoisted(() => ({ providerDown: false, uncached: 0, priced: 0 }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }), kv: { incrby: async () => 1 } }))
vi.mock('@/lib/translate', () => ({
  LANGS: ['en', 'vi', 'ko'],
  uncachedStats: async () => { h.priced++; return { count: h.uncached, chars: h.uncached * 10 } },
  translateBatch: async (texts: string[], _t: string, opts?: { stats?: { providerFailed: boolean } }) => {
    if (h.providerDown && opts?.stats) opts.stats.providerFailed = true
    return h.providerDown ? texts : texts.map((t) => `ko:${t}`)
  },
}))

const { POST } = await import('./route')
const ask = async (texts: string[]) =>
  (await POST(new Request('https://eno.vn/api/translate', { method: 'POST', body: JSON.stringify({ texts, target: 'ko' }) }))).json()

beforeEach(() => { h.providerDown = false; h.uncached = 1 })

describe('/api/translate', () => {
  it('a provider failure answers source text flagged partial', async () => {
    h.providerDown = true
    expect(await ask(['Cover lessons'])).toEqual({ translations: ['Cover lessons'], partial: true })
  })
  it('a normal answer carries no flag', async () => {
    expect(await ask(['Cover lessons'])).toEqual({ translations: ['ko:Cover lessons'] })
  })
})

describe('/api/translate — the body cap (appsec-02): 1 MB, read before it is parsed or priced', () => {
  it('the route\'s own ceiling, 1,500 strings, at ~170 bytes each (4× fits under the cap) is answered', async () => {
    h.uncached = 0
    const texts = Array.from({ length: 1_500 }, (_, i) => `${i} Căn hộ 2 phòng ngủ Quận 7 — view sông, full nội thất, gần Lotte Mart`.padEnd(120, '.'))
    const body = JSON.stringify({ texts, target: 'ko' })
    expect(Buffer.byteLength(body) * 4).toBeLessThanOrEqual(1024 * 1024)
    expect((await ask(texts)).translations).toHaveLength(1_500)
  })

  it('⛔ one byte past 1 MB is 413 payload_too_large: never parsed, never priced, never sent to the provider', async () => {
    h.priced = 0
    const shell = JSON.stringify({ texts: ['x'], target: 'ko', pad: '' })
    const body = JSON.stringify({ texts: ['x'], target: 'ko', pad: 'a'.repeat(1024 * 1024 + 1 - shell.length) })
    const res = await POST(new Request('https://eno.vn/api/translate', { method: 'POST', body }))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'payload_too_large' })
    expect(h.priced).toBe(0)
  })
})
