import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * PATCH /api/profile — a person's photo is their shop's picture on their listing pages (src/lib/storefront-avatar.ts,
 * owner 2026-10-15), and those pages are ISR for 30 days: a changed or removed photo refreshes them; anything else does
 * not.
 */
const FACE = 'https://lh3.googleusercontent.com/a/face'
const h = vi.hoisted(() => ({ avatarUrl: null as string | null, refreshes: [] as unknown[][], updates: [] as Record<string, unknown>[] }))

vi.mock('@/lib/admin', () => ({
  getCurrentProfile: async () => ({ id: 'p1', accountType: 'individual', avatarUrl: h.avatarUrl, displayName: 'Lan', phone: null, email: 'lan@example.com' }),
  getCurrentProfileId: async () => 'p1',
  getAdmin: async () => null,
  getVerifiedPhone: async () => null,
}))
vi.mock('@/lib/db', () => ({
  db: { profile: { update: async ({ data }: { data: Record<string, unknown> }) => { h.updates.push(data); return {} } } },
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, remaining: 9, resetSec: 0 }) }))
vi.mock('@/lib/seller-pdp-refresh', () => ({ refreshShopPicturePdps: async (...a: unknown[]) => { h.refreshes.push(a) } }))

const { PATCH } = await import('./route')

const patch = (body: Record<string, unknown>) => PATCH(new Request('https://eno.vn/api/profile', {
  method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
}))

beforeEach(() => { h.avatarUrl = null; h.refreshes = []; h.updates = [] })

describe('PATCH /api/profile — the photo refreshes the listing pages that show it', () => {
  it('a removed photo refreshes them, with the profile as it was', async () => {
    h.avatarUrl = FACE
    expect((await patch({ avatarUrl: null })).status).toBe(200)
    expect(h.updates).toEqual([{ avatarUrl: null }])
    expect(h.refreshes).toEqual([['p1', { avatarUrl: FACE, accountType: 'individual' }, 'profile.photo']])
  })

  it('an unchanged photo, or a save without one, refreshes nothing', async () => {
    expect((await patch({ avatarUrl: null })).status).toBe(200)
    expect((await patch({ displayName: 'Lan Anh' })).status).toBe(200)
    expect(h.refreshes).toEqual([])
  })
})
