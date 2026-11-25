import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The creative ads' private test (creative-gate.ts, owner 2026-11-25: "let me test locally ads before publishing to
 * everyone"): ADS_CREATIVE_OPEN=1 opens them to every shop; anything else, unset included, lets only an admin's credential
 * (Profile.email in ADMIN_EMAILS) buy one.
 */
vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ profiles: {} as Record<string, { email: string | null }>, reads: 0 }))
vi.mock('@/lib/db', () => ({
  db: { profile: { findUnique: async ({ where }: { where: { id: string } }) => { h.reads++; return h.profiles[where.id] ?? null } } },
}))

const { creativeAdsAllowed, creativeAdsOpen, CREATIVE_ADS_NOT_OPEN } = await import('./creative-gate')
// The REAL admin check (ADMIN_EMAILS), which creative-gate.ts loads on first use: loaded here, outside any test's time limit.
beforeAll(async () => { await import('@/lib/admin') }, 60_000)

beforeEach(() => {
  h.profiles = { p_admin: { email: 'Owner@Eno.vn' }, p_shop: { email: 'shop@example.com' }, p_none: { email: null } }
  h.reads = 0
  vi.stubEnv('ADMIN_EMAILS', 'owner@eno.vn, ops@eno.vn')
  vi.stubEnv('ADS_CREATIVE_OPEN', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('the switch', () => {
  it('open only for exactly "1"; unset, empty, "0", "true" and "yes" are the private test', () => {
    for (const v of ['', '0', 'true', 'yes', 'open']) {
      vi.stubEnv('ADS_CREATIVE_OPEN', v)
      expect(creativeAdsOpen(), v).toBe(false)
    }
    vi.stubEnv('ADS_CREATIVE_OPEN', '1')
    expect(creativeAdsOpen()).toBe(true)
    delete process.env.ADS_CREATIVE_OPEN
    expect(creativeAdsOpen()).toBe(false)
  })

  it('the refusal is a stable 403 code with a short English message', () => {
    expect(CREATIVE_ADS_NOT_OPEN).toMatchObject({ status: 403, code: 'creative_ads_not_open' })
    expect(CREATIVE_ADS_NOT_OPEN.message.length).toBeLessThan(80)
  })
})

describe('creativeAdsAllowed', () => {
  it('⛔ closed: an admin\'s profile only (the email compared case-insensitively); anyone else, or no profile, is refused', async () => {
    expect(await creativeAdsAllowed('p_admin')).toBe(true)
    expect(await creativeAdsAllowed('p_shop')).toBe(false)
    expect(await creativeAdsAllowed('p_none')).toBe(false)
    expect(await creativeAdsAllowed('p_gone')).toBe(false)
    const reads = h.reads
    expect(await creativeAdsAllowed('')).toBe(false)
    expect(await creativeAdsAllowed(undefined)).toBe(false)
    expect(h.reads).toBe(reads)
  })

  it('closed with no ADMIN_EMAILS at all: nobody', async () => {
    vi.stubEnv('ADMIN_EMAILS', '')
    expect(await creativeAdsAllowed('p_admin')).toBe(false)
  })

  it('open: everyone, without reading the profile', async () => {
    vi.stubEnv('ADS_CREATIVE_OPEN', '1')
    expect(await creativeAdsAllowed('p_shop')).toBe(true)
    expect(await creativeAdsAllowed(undefined)).toBe(true)
    expect(h.reads).toBe(0)
  })
})
