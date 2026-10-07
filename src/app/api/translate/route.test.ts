import { beforeEach, describe, expect, it, vi } from 'vitest'

// /api/translate's answer when the PROVIDER fails (gate review, 2026-10-07): source text for the misses, flagged
// `partial` — so the dictionary loader does not persist it and mt-client retries it rather than giving it up as a
// string that translates to itself.
const h = vi.hoisted(() => ({ providerDown: false, uncached: 0 }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }), kv: { incrby: async () => 1 } }))
vi.mock('@/lib/translate', () => ({
  LANGS: ['en', 'vi', 'ko'],
  uncachedStats: async () => ({ count: h.uncached, chars: h.uncached * 10 }),
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
