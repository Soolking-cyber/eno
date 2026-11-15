import { describe, expect, it, vi } from 'vitest'

// listing-photo-desk.ts: eno's own e-Visa / trip desk, exempt from the photo check (pending the owner's call), resolved by
// owner email and cached; a failed read is not cached.
const h = vi.hoisted(() => ({ asked: [] as unknown[], fail: false }))
vi.mock('@/lib/edition-scope', () => ({ HIDDEN_DESK_OWNER_EMAILS: ['support@eno.forum'] }))
vi.mock('@/lib/visa-shop', () => ({ VISA_SHOP_OWNER_EMAILS: ['support@eno.forum', 'visa@eno.forum'] }))
vi.mock('@/lib/trips/dm-thread', () => ({ TRIP_DESK_OWNER_EMAILS: ['trips@eno.forum'] }))
vi.mock('@/lib/db', () => ({
  db: { seller: { findMany: async (a: { where: unknown }) => { h.asked.push(a.where); if (h.fail) throw new Error('db'); return [{ id: 'desk' }] } } },
}))
const { isPhotoDeskSeller } = await import('./listing-photo-desk')

describe('isPhotoDeskSeller', () => {
  it('⛔ O2: the desk storefronts, by every desk owner email, read once and cached; a failed read throws and is retried', async () => {
    h.fail = true
    await expect(isPhotoDeskSeller('desk')).rejects.toThrow('db')
    h.fail = false
    expect(await isPhotoDeskSeller('desk')).toBe(true)
    expect(await isPhotoDeskSeller('s1')).toBe(false)
    expect(await isPhotoDeskSeller('')).toBe(false)
    expect(h.asked).toHaveLength(2)
    expect(h.asked[1]).toEqual({ owner: { email: { in: ['support@eno.forum', 'visa@eno.forum', 'trips@eno.forum'] } } })
  })
})
