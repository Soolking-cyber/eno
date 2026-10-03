import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CRAWLER_UAS, PERSON_UAS } from '@/lib/__fixtures__/user-agents'

/**
 * POST /api/site-stats — A CRAWLER NEVER REACHES THE PRESENCE TABLE, NOR THE LIMITER IN FRONT OF IT.
 *
 * recordAndRead() has returned zeros for a crawler since 2026-09-17, but only after rl_check had
 * INSERTed its row — one database write per heartbeat from a renderer that was 58% of visitor traffic
 * on 2026-10-02. The route now stops a crawler first, with the same 200 and zeros a throttled visitor
 * gets (the footer renders nothing for a zero). A person, in any browser, is recorded as before.
 */

const ZEROS = { visits: 0, now: 0, members: 0, sellers: 0 }
const LIVE = { visits: 120, now: 3, members: 40, sellers: 9 }

const h = vi.hoisted(() => ({
  limiterCalls: 0,
  recorded: [] as Array<[string, string]>,
}))

vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async () => { h.limiterCalls++; return { success: true } },
}))
vi.mock('@/lib/site-stats', () => ({
  HEARTBEAT_MS: 60_000,
  recordAndRead: async (ip: string, ua: string) => { h.recorded.push([ip, ua]); return LIVE },
}))

const { POST } = await import('./route')

async function heartbeat(ua: string | null) {
  const headers: Record<string, string> = { host: 'eno.vn', origin: 'https://eno.vn', 'cf-connecting-ip': '203.0.113.7' }
  if (ua !== null) headers['user-agent'] = ua
  const res = await POST(new Request('https://eno.vn/api/site-stats', { method: 'POST', headers }) as never)
  return { status: res.status, body: await res.json(), cache: res.headers.get('cache-control') }
}

beforeEach(() => {
  h.limiterCalls = 0
  h.recorded = []
})

describe('a crawler gets zeros and writes nothing', () => {
  for (const [name, ua] of Object.entries(CRAWLER_UAS)) {
    it(name, async () => {
      expect(await heartbeat(ua)).toEqual({ status: 200, body: ZEROS, cache: 'no-store' })
      expect(h.recorded).toEqual([])
      expect(h.limiterCalls).toBe(0)
    })
  }

  it('no user-agent header at all', async () => {
    expect((await heartbeat(null)).body).toEqual(ZEROS)
    expect(h.recorded).toEqual([])
  })
})

describe('a person is recorded and sees the numbers', () => {
  for (const [name, ua] of Object.entries(PERSON_UAS)) {
    it(name, async () => {
      expect(await heartbeat(ua)).toEqual({ status: 200, body: LIVE, cache: 'no-store' })
      expect(h.recorded).toHaveLength(1)
      expect(h.recorded[0][1]).toBe(ua)
    })
  }
})
