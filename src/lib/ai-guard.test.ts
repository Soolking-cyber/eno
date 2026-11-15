import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Security review 2026-10-22, item 19: one shared 2,000/day AI pool let a few accounts switch every AI feature off for
 * everyone. Now: a per-account daily cap per feature, a per-feature share of the shared pool, and a reserve for teacher
 * onboarding — with the total ceiling unchanged (1,500 shared + 500 reserved).
 */

const h = vi.hoisted(() => ({
  deny: new Set<string>(),
  calls: [] as Array<[string, string, number]>,
  kv: new Map<string, number>(),
  kvDown: false,
}))

vi.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }) } }))
vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => 'p1' }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (name: string, key: string, limit: number) => { h.calls.push([name, key, limit]); return { success: !h.deny.has(name) } },
  kv: {
    incrby: async (k: string, by: number) => { if (h.kvDown) throw new Error('kv'); h.kv.set(k, (h.kv.get(k) ?? 0) + by); return h.kv.get(k)! },
    get: async (k: string) => h.kv.get(k) ?? null,
  },
}))

const {
  aiGuard, chargeAiGlobal, chargeAiTeacherReserve, chargeAiPhotoCheck, chargeAccountPhotoCheck, photoLaneOpen,
  AI_GLOBAL_DAILY_LIMIT, AI_TEACHER_RESERVE_DAILY, AI_FEATURE_DAILY_SHARE, AI_ACCOUNT_DAILY_LIMIT, AI_LISTING_PHOTO_LANES, AI_LISTING_PHOTO_DAILY,
  AI_LISTING_PHOTO_ACCOUNT,
} = await import('./ai-guard')

beforeEach(() => { h.deny.clear(); h.calls = []; h.kv.clear(); h.kvDown = false })

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

describe('listing photo check budget (owner, 2026-11-15)', () => {
  it('is its own 16,000-a-day ceiling, in three lanes, outside the 2,000 authoring one', () => {
    expect(AI_LISTING_PHOTO_LANES).toEqual({ upload: 3000, pass: 3000, sweep: 10000 })
    expect(AI_LISTING_PHOTO_DAILY).toBe(16000)
  })

  it('charges only its own lane, never the shared pool or a feature share', async () => {
    expect(await chargeAiPhotoCheck('sweep')).toBe(true)
    expect(h.calls).toEqual([])
    expect([...h.kv.values()]).toEqual([1])
  })

  it('a spent lane refuses without touching the others — and a refusal is not counted, so the lane reopens', async () => {
    const key = `ai-global-listing-photos-upload:${new Date().toISOString().slice(0, 10)}`
    h.kv.set(key, AI_LISTING_PHOTO_LANES.upload)
    expect(await photoLaneOpen('upload')).toBe(false)
    for (let i = 0; i < 5; i++) expect(await chargeAiPhotoCheck('upload')).toBe(false)
    expect(h.kv.get(key)).toBe(AI_LISTING_PHOTO_LANES.upload)
    expect(await chargeAiPhotoCheck('pass')).toBe(true)
    expect(await photoLaneOpen('pass')).toBe(true)
  })

  it('an unreachable counter refuses (strict)', async () => {
    h.kvDown = true
    expect(await chargeAiPhotoCheck('sweep')).toBe(false)
  })

  it('a member is capped per photo, hour first, then day — and an hour spent never touches the day', async () => {
    expect(AI_LISTING_PHOTO_ACCOUNT).toEqual({ hour: 40, day: 120 })
    expect(await chargeAccountPhotoCheck('p1')).toBe(true)
    expect(h.calls).toEqual([['ai-listing-photos-account-h', 'p1', 40], ['ai-listing-photos-account-d', 'p1', 120]])
    h.calls = []
    h.deny.add('ai-listing-photos-account-h')
    expect(await chargeAccountPhotoCheck('p1')).toBe(false)
    expect(h.calls).toEqual([['ai-listing-photos-account-h', 'p1', 40]])
  })
})
