import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * An identity edit or an account-type switch purges the seller's ISR listing pages (30-day window), so a
 * removed address or a business-to-individual switch does not stay on the PDP for a month (review,
 * 2026-10-01). Bounded like refreshListingSurfaces, and it never throws into a save that succeeded.
 */
const findMany = vi.fn()
const sellerFindUnique = vi.fn()
const revalidatePublicPath = vi.fn()
const logError = vi.fn()
const sw = vi.hoisted(() => ({ since: '2026-10-08T00:00:00+07:00' as string | null }))
vi.mock('@/lib/db', () => ({
  db: { listing: { findMany: (...a: unknown[]) => findMany(...a) }, seller: { findUnique: (...a: unknown[]) => sellerFindUnique(...a) } },
}))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: (...a: unknown[]) => revalidatePublicPath(...a) }))
vi.mock('@/lib/listing-surfaces', () => ({ REVALIDATE_CAP: 3 }))
vi.mock('@/lib/log', () => ({ logError: (...a: unknown[]) => logError(...a) }))
vi.mock('@/lib/seller-info', () => ({ get SELLER_INFO_NOTICE_SINCE() { return sw.since } }))

import { refreshSellerPdps, refreshShopPicturePdps } from './seller-pdp-refresh'

beforeEach(() => { findMany.mockReset(); sellerFindUnique.mockReset(); revalidatePublicPath.mockReset(); logError.mockReset(); sw.since = '2026-10-08T00:00:00+07:00' })

describe('refreshSellerPdps', () => {
  it('⛔ does nothing while the Seller information display is OFF — no read, no purge (no cache cold-start)', async () => {
    sw.since = null
    findMany.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ id: `x${i}` })))
    await refreshSellerPdps('s1')
    expect(findMany).not.toHaveBeenCalled()
    expect(revalidatePublicPath).not.toHaveBeenCalled()
  })

  it("purges each of the seller's ACTIVE listing pages", async () => {
    findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    await refreshSellerPdps('s1')
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { sellerId: 's1', status: 'active' }, take: 4 })
    expect(revalidatePublicPath.mock.calls).toEqual([['/listings/a'], ['/listings/b']])
  })

  it('past the cap, purges the route once instead of a silent top-N', async () => {
    findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])
    await refreshSellerPdps('s1')
    expect(revalidatePublicPath.mock.calls).toEqual([['/listings/[id]', 'layout']])
  })

  it('never throws: a failed purge is logged once and the rest still run; a failed query is logged', async () => {
    findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    revalidatePublicPath.mockImplementation(() => { throw new Error('no request scope') })
    await expect(refreshSellerPdps('s1')).resolves.toBeUndefined()
    expect(revalidatePublicPath).toHaveBeenCalledTimes(2)
    expect(logError).toHaveBeenCalledTimes(1)
    findMany.mockRejectedValue(new Error('db down'))
    await expect(refreshSellerPdps('s1')).resolves.toBeUndefined()
    expect(logError).toHaveBeenCalledTimes(2)
  })
})

// Owner, 2026-10-15: a person's shop shows their profile photo (src/lib/storefront-avatar.ts) — on listing pages cached
// for 30 days, so a removed photo or a switch to business must purge them, whatever the Seller-information switch says.
describe('refreshShopPicturePdps', () => {
  const FACE = 'https://lh3.googleusercontent.com/a/face'
  const shop = (avatarUrl: string | null, owner: { avatarUrl: string | null; accountType: string | null }) =>
    sellerFindUnique.mockResolvedValue({ id: 's1', avatarUrl, owner })
  beforeEach(() => findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]))

  it('purges when a person removes their photo — even with the Seller information display OFF', async () => {
    sw.since = null
    shop(null, { avatarUrl: null, accountType: 'individual' })
    await refreshShopPicturePdps('p1', { avatarUrl: FACE, accountType: 'individual' })
    expect(sellerFindUnique.mock.calls[0][0]).toMatchObject({ where: { ownerId: 'p1' } })
    expect(revalidatePublicPath.mock.calls).toEqual([['/listings/a'], ['/listings/b']])
  })

  it('purges when a person switches to business (the face leaves) or back (it returns)', async () => {
    shop(null, { avatarUrl: FACE, accountType: 'business' })
    await refreshShopPicturePdps('p1', { avatarUrl: FACE, accountType: 'individual' })
    expect(revalidatePublicPath).toHaveBeenCalledTimes(2)
    revalidatePublicPath.mockReset()
    shop(null, { avatarUrl: FACE, accountType: 'individual' })
    await refreshShopPicturePdps('p1', { avatarUrl: FACE, accountType: 'business' })
    expect(revalidatePublicPath).toHaveBeenCalledTimes(2)
  })

  it('purges nothing when the shown picture did not change', async () => {
    // The shop has its own picture: the owner's photo was never shown.
    shop('https://sb.eno.vn/logo.webp', { avatarUrl: null, accountType: 'individual' })
    await refreshShopPicturePdps('p1', { avatarUrl: FACE, accountType: 'individual' })
    // A business changing its holder's photo: never shown either.
    shop(null, { avatarUrl: null, accountType: 'business' })
    await refreshShopPicturePdps('p1', { avatarUrl: FACE, accountType: 'business' })
    // No storefront at all.
    sellerFindUnique.mockResolvedValue(null)
    await refreshShopPicturePdps('p1', { avatarUrl: FACE, accountType: 'individual' })
    expect(findMany).not.toHaveBeenCalled()
    expect(revalidatePublicPath).not.toHaveBeenCalled()
  })

  it('never throws: a failed read is logged', async () => {
    sellerFindUnique.mockRejectedValue(new Error('db down'))
    await expect(refreshShopPicturePdps('p1', { avatarUrl: FACE, accountType: 'individual' }, 'profile.photo')).resolves.toBeUndefined()
    expect(logError).toHaveBeenCalledWith(expect.any(Error), { op: 'profile.photo', profileId: 'p1' })
  })
})
