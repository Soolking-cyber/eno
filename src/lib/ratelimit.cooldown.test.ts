import { beforeEach, describe, expect, it, vi } from 'vitest'

// The atomic semantics (audit P2 #14's one-winner claim, escalation steps,
// sliding-window math) moved INTO Postgres with the Upstash→Postgres migration
// (2026-07-20): rl_cooldown_claim / rl_check are row-lock-serialized SECURITY
// DEFINER functions — see scripts/rate-limit-pg.mjs, live-verified with a
// 5-connection concurrency probe at migration time (exactly 1 of 5 admitted).
// What remains testable HERE is the TS boundary: row→result mapping, window
// parsing, and the fail-open (lenient) vs fail-closed (strict + cooldown)
// stances when the backend errors — the property that a backend outage can
// never reopen a paid-delivery or billing-drain vector.

const queryRaw = vi.fn()
vi.mock('@/lib/db', () => ({
  db: { $queryRaw: (...args: unknown[]) => queryRaw(...args) },
}))
vi.mock('server-only', () => ({}))

import { rateLimit, escalatingCooldown, windowSeconds, kv } from './ratelimit'

beforeEach(() => {
  queryRaw.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('windowSeconds', () => {
  it('parses every unit the routes use', () => {
    expect(windowSeconds('20 s')).toBe(20)
    expect(windowSeconds('1 m')).toBe(60)
    expect(windowSeconds('10 m')).toBe(600)
    expect(windowSeconds('1 h')).toBe(3600)
    expect(windowSeconds('24 h')).toBe(86400)
    expect(windowSeconds('1 d')).toBe(86400)
  })
})

describe('rateLimit', () => {
  it('maps the rl_check row to { success, remaining, limit, resetSec, windowSec }', async () => {
    // ⚠️ THE ROWS BELOW DELIBERATELY OMIT `reset_sec`, AND THAT IS THE INTERESTING HALF.
    // `resetSec` is published verbatim as the `reset=` field of the RFC rate-limit header, where an
    // `undefined` renders as the literal string "undefined" rather than throwing. A row without the
    // column — an older `rl_check`, a mid-migration database — must therefore degrade to a full
    // window, not to undefined. `1 m` -> 60.
    queryRaw.mockResolvedValueOnce([{ success: true, remaining: 4 }])
    await expect(rateLimit('msg:send', 'u1', 20, '1 m')).resolves.toEqual({
      success: true, remaining: 4, limit: 20, resetSec: 60, windowSec: 60,
    })
    queryRaw.mockResolvedValueOnce([{ success: false, remaining: 0 }])
    await expect(rateLimit('msg:send', 'u1', 20, '1 m')).resolves.toEqual({
      success: false, remaining: 0, limit: 20, resetSec: 60, windowSec: 60,
    })
    // And when the column IS present it wins, because it is the database's own view of the slot.
    queryRaw.mockResolvedValueOnce([{ success: true, remaining: 9, reset_sec: 17 }])
    await expect(rateLimit('msg:send', 'u1', 20, '1 m')).resolves.toEqual({
      success: true, remaining: 9, limit: 20, resetSec: 17, windowSec: 60,
    })
  })

  it('fails OPEN on backend error for lenient limits', async () => {
    queryRaw.mockRejectedValueOnce(new Error('db down'))
    const r = await rateLimit('msg:send', 'u1', 20, '1 m')
    expect(r.success).toBe(true)
  })

  it('fails CLOSED on backend error for strict limits', async () => {
    queryRaw.mockRejectedValueOnce(new Error('db down'))
    const r = await rateLimit('contact-reveal', 'u1', 5, '1 h', { strict: true })
    expect(r.success).toBe(false)
    expect(r.remaining).toBe(0)
  })

  it('treats an empty result as a backend error (strict still denies)', async () => {
    queryRaw.mockResolvedValueOnce([])
    const r = await rateLimit('contact-reveal', 'u1', 5, '1 h', { strict: true })
    expect(r.success).toBe(false)
  })
})

describe('escalatingCooldown', () => {
  it('maps the claim row to { allowed, retryAfterSec }', async () => {
    queryRaw.mockResolvedValueOnce([{ allowed: true, retry_after_sec: 0 }])
    await expect(escalatingCooldown('otp', 'u1', [60, 300])).resolves.toEqual({ allowed: true, retryAfterSec: 0 })
    queryRaw.mockResolvedValueOnce([{ allowed: false, retry_after_sec: 287 }])
    await expect(escalatingCooldown('otp', 'u1', [60, 300])).resolves.toEqual({ allowed: false, retryAfterSec: 287 })
  })

  it('fails CLOSED on backend error — paid delivery is denied, honest retry-after', async () => {
    queryRaw.mockRejectedValueOnce(new Error('db down'))
    const r = await escalatingCooldown('otp', 'u1', [60, 300, 900])
    expect(r.allowed).toBe(false)
    expect(r.retryAfterSec).toBe(60)
  })
})

describe('kv', () => {
  it('set returns OK when the write won and null when NX lost', async () => {
    queryRaw.mockResolvedValueOnce([{ won: true }])
    await expect(kv.set('k', 'v', { nx: true, ex: 60 })).resolves.toBe('OK')
    queryRaw.mockResolvedValueOnce([{ won: false }])
    await expect(kv.set('k', 'v', { nx: true, ex: 60 })).resolves.toBeNull()
  })

  it('incrby coerces the SQL bigint to a JS number', async () => {
    queryRaw.mockResolvedValueOnce([{ v: BigInt(7) }])
    await expect(kv.incrby('k', 1, 60)).resolves.toBe(7)
  })

  it('get returns the stored JSON value or null', async () => {
    queryRaw.mockResolvedValueOnce([{ v: { a: 1 } }])
    await expect(kv.get('k')).resolves.toEqual({ a: 1 })
    queryRaw.mockResolvedValueOnce([{ v: null }])
    await expect(kv.get('k')).resolves.toBeNull()
  })
})
