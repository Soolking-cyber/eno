import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The public offer's word on creative ads (GET /api/v1/ads/offer, MCP get_ad_offer): `creative_ads.status` is 'testing'
 * while the private test runs (src/lib/ads/creative-gate.ts, ADS_CREATIVE_OPEN unset), with one sentence saying sales open
 * after it, and 'open' with no sentence once the switch says '1'.
 */
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({
  db: { listing: { groupBy: async () => [] }, category: { findMany: async () => [] }, listingAd: { count: async () => 0 } },
}))
vi.mock('@/app/api/listings/feed-query', () => ({ buildFeedFilters: async () => ({ where: {} }) }))

const { adOffer } = await import('./offer')
afterEach(() => vi.unstubAllEnvs())

describe('adOffer — creative_ads.status', () => {
  it('unset (the private test): "testing", and one sentence that says sales open after the test', async () => {
    vi.stubEnv('ADS_CREATIVE_OPEN', '')
    const { creative_ads } = await adOffer(null)
    expect(creative_ads.status).toBe('testing')
    expect(creative_ads.note).toMatch(/private test.*sales open.*after/)
    expect(creative_ads.note!.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length).toBe(1)
    // Not on sale at all here (no payment config): the sentence must not say listing ads are.
    expect(creative_ads.note).not.toMatch(/listing/)
  })

  it('ADS_CREATIVE_OPEN=1: "open", no sentence', async () => {
    vi.stubEnv('ADS_CREATIVE_OPEN', '1')
    const { creative_ads } = await adOffer(null)
    expect(creative_ads).toMatchObject({ status: 'open', note: null })
  })
})
