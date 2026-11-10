import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * inbox-11: the dashboard's "Unread messages" tile is the SAME number as the header Messages badge — it
 * comes from `conversationUnread()` with the options /api/notifications passes, not from its old
 * seller-side-only aggregate (which missed buyer-side unread and counted threads the inbox hides).
 * The admin verdict is the CALLER's: this core stays decoupled from the session.
 */

const h = vi.hoisted(() => ({ calls: [] as { profileId: string; opts: unknown }[], sellerArgs: [] as unknown[], seller: null as unknown }))

vi.mock('@/lib/db', () => ({
  // No `conversation` model on purpose: a revived per-row aggregate would throw here.
  db: { seller: { findUnique: async (args: unknown) => { h.sellerArgs.push(args); return h.seller } } },
}))
vi.mock('@/lib/unread', () => ({
  conversationUnread: async (profileId: string, opts: unknown) => { h.calls.push({ profileId, opts }); return 7 },
}))

const { dashboardStatsCore, dashboardSummaryCore } = await import('./dashboard')

const profile = { id: 'p1', accountType: 'individual', displayName: 'An' } as never

beforeEach(() => { h.calls = []; h.sellerArgs = []; h.seller = null })

describe('dashboardStatsCore — unread tile = the badge', () => {
  it('counts through conversationUnread, support desk excluded by default', async () => {
    const d = await dashboardStatsCore(profile)
    expect(d.stats.unreadMessages).toBe(7)
    expect(h.calls).toEqual([{ profileId: 'p1', opts: { includeSupportDesk: false } }])
  })

  it('passes the caller\'s admin verdict through', async () => {
    await dashboardStatsCore(profile, { includeSupportDesk: true })
    expect(h.calls).toEqual([{ profileId: 'p1', opts: { includeSupportDesk: true } }])
  })
})

/**
 * The summary (speed plan R13): the account the rail and the explorer read, without the listings — one account's full
 * answer was 16.5 MB. It must describe the account exactly as the full answer does.
 */
describe('dashboardSummaryCore', () => {
  const seller = {
    id: 's1', name: 'Shop', handle: { handle: 'shop' }, verifiedSeller: false, officialPartner: true, trustScore: 4, trustTier: 'new',
    responseRate: 90, bio: null, location: null, phone: null, avatarUrl: null, bannerUrl: null, legalName: null, legalAddress: null,
    idNumber: null, taxCode: null, taxCheckedAt: null, taxRegisteredName: null, taxActive: null, listings: [],
  }

  it('asks for no listing and counts no unread', async () => {
    h.seller = seller
    await dashboardSummaryCore(profile)
    expect(h.sellerArgs).toHaveLength(1)
    expect(JSON.stringify(h.sellerArgs[0])).not.toContain('listings')
    expect(h.calls).toEqual([])
  })

  it('the same tier, profile and seller as the full answer, and nothing else', async () => {
    h.seller = seller
    const summary = await dashboardSummaryCore(profile)
    const { stats, listings, ...full } = await dashboardStatsCore(profile)
    expect(summary).toEqual(full)
    expect(summary.seller).toMatchObject({ id: 's1', handle: 'shop', officialPartner: true })
  })

  it('no shop → seller null', async () => {
    expect((await dashboardSummaryCore(profile)).seller).toBeNull()
  })
})
