import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * inbox-11: the dashboard's "Unread messages" tile is the SAME number as the header Messages badge — it
 * comes from `conversationUnread()` with the options /api/notifications passes, not from its old
 * seller-side-only aggregate (which missed buyer-side unread and counted threads the inbox hides).
 * The admin verdict is the CALLER's: this core stays decoupled from the session.
 */

const h = vi.hoisted(() => ({ calls: [] as { profileId: string; opts: unknown }[] }))

vi.mock('@/lib/db', () => ({
  // No `conversation` model on purpose: a revived per-row aggregate would throw here.
  db: { seller: { findUnique: async () => null } },
}))
vi.mock('@/lib/unread', () => ({
  conversationUnread: async (profileId: string, opts: unknown) => { h.calls.push({ profileId, opts }); return 7 },
}))

const { dashboardStatsCore } = await import('./dashboard')

const profile = { id: 'p1', accountType: 'individual', displayName: 'An' } as never

beforeEach(() => { h.calls = [] })

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
