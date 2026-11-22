import { afterEach, describe, expect, it, vi } from 'vitest'
import { PHASE_PRODUCTION_BUILD } from 'next/constants'

/**
 * The Facebook-import ad landing's listings (owner 2026-11-22 "go": listings first, sign-in on the tap). ⛔ A failed read keeps the
 * last good page (commit gate, codex + opus): at runtime the error is thrown so ISR serves the last good page; only a build may
 * render the page without listings.
 */
const h = vi.hoisted(() => ({ rail: vi.fn(), localize: vi.fn(async (rows: unknown[]) => rows) }))
vi.mock('@/lib/core/trending-rail', () => ({ trendingRailListings: h.rail }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: h.localize }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/components/marketplace/header', () => ({ Header: () => null }))
vi.mock('@/components/marketplace/footer', () => ({ Footer: () => null }))
vi.mock('@/components/marketplace/facebook-import-landing', () => ({ FacebookImportLanding: () => null }))
vi.mock('@/components/marketplace/facebook-landing-listings', () => ({ FacebookLandingListings: () => null }))

const { default: Page, revalidate } = await import('./page')
const params = Promise.resolve({ lang: 'vi' })
/** The listings the page hands to its listings block. */
const listingsOf = (el: Awaited<ReturnType<typeof Page>>) => {
  const main = (el.props as { children: unknown[] }).children[1] as { props: { children: Array<{ props: { listings?: unknown } }> } }
  return main.props.children[1].props.listings
}

afterEach(() => { vi.unstubAllEnvs(); h.rail.mockReset(); h.localize.mockClear() })

describe('/post/facebook — the ad landing\'s listings', () => {
  it('six of the home page\'s trending rail, titles in the page\'s language, refreshed every 5 minutes', async () => {
    h.rail.mockResolvedValue(Array.from({ length: 9 }, (_, i) => ({ id: `l${i}`, title: `t${i}` })))
    const listings = listingsOf(await Page({ params })) as Array<{ id: string }>
    expect(listings.map((l) => l.id)).toEqual(['l0', 'l1', 'l2', 'l3', 'l4', 'l5'])
    expect(h.localize).toHaveBeenCalledWith(expect.any(Array), 'vi')
    expect(revalidate).toBe(300)
  })

  it('⛔ a failed read at runtime throws, so ISR keeps the last good page instead of caching one without listings', async () => {
    h.rail.mockRejectedValue(new Error('db blip'))
    await expect(Page({ params })).rejects.toThrow('db blip')
  })

  it('only a build renders it without listings (a build must not fail on a database blip)', async () => {
    vi.stubEnv('NEXT_PHASE', PHASE_PRODUCTION_BUILD)
    h.rail.mockRejectedValue(new Error('db down at build'))
    expect(listingsOf(await Page({ params }))).toEqual([])
  })
})
