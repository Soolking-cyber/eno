import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('next/server', () => ({ after: () => {} }))
const { pageLimitArg } = await import('./tools')
const { parsePageParams } = await import('@/lib/api/pagination')
const pager = (v: unknown) => { const sp = new URLSearchParams(); const l = pageLimitArg(v); if (l) sp.set('limit', l); return parsePageParams(sp).limit }

// `limit` carries no bounds in its schema (Manufact's judge flags bounded limits), so the pager must read any number right.
describe('MCP `limit` reaches the pager as the number the agent meant', () => {
  it('a huge or tiny number is not misread through its exponent form (parseInt("1e+21") is 1)', () => {
    expect(pager(1e21)).toBe(100)
    expect(pager(1e-7)).toBe(1)
  })
  it('a fraction is truncated; zero and negatives clamp to one; left out is the default', () => {
    expect(pager(20.9)).toBe(20)
    expect(pager(0)).toBe(1)
    expect(pager(-5)).toBe(1)
    expect(pager(undefined)).toBe(50)
  })
})
