import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Security review 2026-10-22, item 19: one shared 2,000/day AI pool let a few accounts switch every AI feature off for
 * everyone. Now: a per-account daily cap per feature, a per-feature share of the shared pool, and a reserve for teacher
 * onboarding — with the total ceiling unchanged (1,500 shared + 500 reserved).
 */

const h = vi.hoisted(() => ({
  deny: new Set<string>(),
  calls: [] as Array<[string, string, number]>,
}))

vi.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) } }))
vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => 'p1' }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (name: string, key: string, limit: number) => { h.calls.push([name, key, limit]); return { success: !h.deny.has(name) } },
}))

const { aiGuard, chargeAiGlobal, chargeAiTeacherReserve, AI_GLOBAL_DAILY_LIMIT, AI_TEACHER_RESERVE_DAILY, AI_FEATURE_DAILY_SHARE, AI_ACCOUNT_DAILY_LIMIT } = await import('./ai-guard')

beforeEach(() => { h.deny.clear(); h.calls = [] })

describe('ai-guard budgets (item 19)', () => {
  it('keeps the total daily ceiling at 2,000: 1,500 shared + 500 reserved for teachers', () => {
    expect(AI_GLOBAL_DAILY_LIMIT + AI_TEACHER_RESERVE_DAILY).toBe(2000)
    expect(AI_FEATURE_DAILY_SHARE).toBeLessThan(AI_GLOBAL_DAILY_LIMIT)
  })

  it('charges the account hour, the account day, the feature share, then the shared pool — in that order', async () => {
    const g = await aiGuard('classify', 40)
    expect(g.ok).toBe(true)
    expect(h.calls).toEqual([
      ['ai-classify', 'p1', 40],
      ['ai-classify-day', 'p1', AI_ACCOUNT_DAILY_LIMIT],
      ['ai-global-classify', 'global', AI_FEATURE_DAILY_SHARE],
      ['ai-global', 'global', AI_GLOBAL_DAILY_LIMIT],
    ])
  })

  it('a capped account never consumes a feature share or the pool', async () => {
    h.deny.add('ai-classify-day')
    const g = await aiGuard('classify', 40)
    expect(g.ok).toBe(false)
    expect(h.calls.map(([n]) => n)).toEqual(['ai-classify', 'ai-classify-day'])
  })

  it('a feature that used its share is refused WITHOUT touching the shared pool (it cannot starve the rest)', async () => {
    h.deny.add('ai-global-rephrase')
    expect(await chargeAiGlobal('rephrase')).toBe(false)
    expect(h.calls.map(([n]) => n)).toEqual(['ai-global-rephrase'])
  })

  it('teacher onboarding draws on its own reserve, never the shared pool', async () => {
    expect(await chargeAiTeacherReserve()).toBe(true)
    expect(h.calls).toEqual([['ai-global-teachers', 'global', AI_TEACHER_RESERVE_DAILY]])
  })
})
