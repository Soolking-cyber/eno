import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * An identity edit or an account-type switch purges the seller's ISR listing pages (30-day window), so a
 * removed address or a business-to-individual switch does not stay on the PDP for a month (review,
 * 2026-10-01). Bounded like refreshListingSurfaces, and it never throws into a save that succeeded.
 */
const findMany = vi.fn()
const revalidatePublicPath = vi.fn()
const logError = vi.fn()
const sw = vi.hoisted(() => ({ since: '2026-10-08T00:00:00+07:00' as string | null }))
vi.mock('@/lib/db', () => ({ db: { listing: { findMany: (...a: unknown[]) => findMany(...a) } } }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: (...a: unknown[]) => revalidatePublicPath(...a) }))
vi.mock('@/lib/listing-surfaces', () => ({ REVALIDATE_CAP: 3 }))
vi.mock('@/lib/log', () => ({ logError: (...a: unknown[]) => logError(...a) }))
vi.mock('@/lib/seller-info', () => ({ get SELLER_INFO_NOTICE_SINCE() { return sw.since } }))

import { refreshSellerPdps } from './seller-pdp-refresh'

beforeEach(() => { findMany.mockReset(); revalidatePublicPath.mockReset(); logError.mockReset(); sw.since = '2026-10-08T00:00:00+07:00' })

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
