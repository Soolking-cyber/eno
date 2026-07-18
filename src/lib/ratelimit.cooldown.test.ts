import { beforeEach, describe, expect, it, vi } from 'vitest'

// Characterization (audit Phase 0 / P2 #14): escalatingCooldown guards PAID delivery
// (OTP SMS/ZNS). The old ttl-check → set sequence was a race: N concurrent requests
// all read ttl<=0 and were ALL admitted — N paid sends. The fix claims with SET NX
// (one winner). This fake reproduces Upstash's per-command atomicity exactly: each
// command is one synchronous step; concurrency interleaves BETWEEN awaits, which is
// what made the old implementation admit everyone.

type Entry = { value: string; expiresAt: number }

function fakeRedis() {
  const store = new Map<string, Entry>()
  const now = () => Date.now()
  const alive = (k: string) => {
    const e = store.get(k)
    if (!e) return null
    if (e.expiresAt <= now()) { store.delete(k); return null }
    return e
  }
  return {
    async set(key: string, value: string, opts?: { nx?: boolean; ex?: number }) {
      if (opts?.nx && alive(key)) return null
      store.set(key, { value, expiresAt: opts?.ex ? now() + opts.ex * 1000 : Number.MAX_SAFE_INTEGER })
      return 'OK'
    },
    async ttl(key: string) {
      const e = alive(key)
      return e ? Math.ceil((e.expiresAt - now()) / 1000) : -2
    },
    async incr(key: string) {
      const e = alive(key)
      const n = (e ? Number(e.value) : 0) + 1
      store.set(key, { value: String(n), expiresAt: e?.expiresAt ?? Number.MAX_SAFE_INTEGER })
      return n
    },
    async expire(key: string, seconds: number) {
      const e = alive(key)
      if (e) e.expiresAt = now() + seconds * 1000
      return e ? 1 : 0
    },
  }
}

vi.mock('@upstash/redis', () => ({
  Redis: class { constructor() { return fakeRedis() as unknown as object } },
}))
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow() { return {} }
    async limit() { return { success: true, limit: 1, remaining: 1, reset: 0 } }
  },
}))

describe('escalatingCooldown', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fake.upstash.io')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'fake')
  })

  it('admits exactly ONE of 5 concurrent requests', async () => {
    const { escalatingCooldown } = await import('./ratelimit')
    const results = await Promise.all(
      Array.from({ length: 5 }, () => escalatingCooldown('otp', 'user-1', [60, 300, 900])),
    )
    const allowed = results.filter((r) => r.allowed)
    expect(allowed).toHaveLength(1)
    for (const r of results.filter((x) => !x.allowed)) {
      expect(r.retryAfterSec).toBeGreaterThan(0)
    }
  })

  it('sequential attempts escalate through the steps', async () => {
    vi.useFakeTimers()
    try {
      const { escalatingCooldown } = await import('./ratelimit')
      const first = await escalatingCooldown('otp', 'user-2', [60, 300])
      expect(first.allowed).toBe(true)
      // Immediately again → blocked with a positive retry-after.
      const blocked = await escalatingCooldown('otp', 'user-2', [60, 300])
      expect(blocked.allowed).toBe(false)
      expect(blocked.retryAfterSec).toBeGreaterThan(0)
      // After the first step expires → allowed again, and the SECOND step (300s) applies.
      vi.advanceTimersByTime(61_000)
      const second = await escalatingCooldown('otp', 'user-2', [60, 300])
      expect(second.allowed).toBe(true)
      const blocked2 = await escalatingCooldown('otp', 'user-2', [60, 300])
      expect(blocked2.allowed).toBe(false)
      expect(blocked2.retryAfterSec).toBeGreaterThan(60)
    } finally {
      vi.useRealTimers()
    }
  })
})
