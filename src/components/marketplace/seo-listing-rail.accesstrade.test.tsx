/**
 * The AccessTrade phone shelf on the buying guides and the iPhone 18 hub (PR #12 review, 2026-11-27):
 * - an EMPTY shelf renders nothing — the guide reads as before, no heading or disclosure over no products;
 * - every purchase link the shelf admits (seo-landing-where.ts `commissionUrlPrefixes`) is one the shop chat's "Buy now"
 *   hands out for that same listing (partner-buy.ts), and a unit sold after the guide visit gets no button at all.
 * The outbound link is a fixture: nothing here opens an AccessTrade URL.
 */
import { describe, expect, it, vi } from 'vitest'

const findMany = vi.fn(async () => [] as unknown[])
vi.mock('@/lib/db', () => ({ db: { listing: { findMany: (...a: unknown[]) => findMany(...(a as [])) } } }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (x: unknown) => x }))

import { commissionUrlPrefixes } from '@/lib/affiliate-commission'
import { ENO_RUN_PARTNERS } from '@/lib/eno-run-partners'
import { partnerBuyUrlOf, type PartnerBuyRow } from '@/lib/partner-buy'
import { phoneGuideRail } from '@/lib/phone-guides-rail'
import { seoLandingWhere } from './seo-landing-where'

const { SeoListingRail } = await import('./seo-listing-rail')

describe('the AccessTrade phone shelf', () => {
  it.each(['best-place-to-buy-iphone-vietnam', 'mua-iphone-o-dau-uy-tin', 'phones-under-10-million-vietnam', 'dien-thoai-duoi-10-trieu'])(
    'with no eligible product, %s renders no shelf at all', async (slug) => {
      findMany.mockClear()
      const rail = phoneGuideRail(slug)!
      expect(rail.target.accessTradePhones).toBe(true)
      expect(await SeoListingRail({ ...rail, cta: rail.cta ?? '' })).toBeNull()
      expect(findMany).toHaveBeenCalled()
    },
  )

  it('every link the shelf admits is the one the shop chat\'s Buy now gives for that listing; sold after the visit → no Buy now', () => {
    // The shelf's own filter admits exactly these link prefixes (and only pinned partners), so checking each one covers it.
    const admitted = (seoLandingWhere(phoneGuideRail('best-place-to-buy-iphone-vietnam')!.target).AND as Record<string, unknown>[])
      .find((n) => 'purchaseLink' in n) as { purchaseLink: { is: { OR: { url: { startsWith: string } }[] } } }
    expect(admitted.purchaseLink.is.OR.map((o) => o.url.startsWith)).toEqual(commissionUrlPrefixes)
    const p = ENO_RUN_PARTNERS[0]
    for (const prefix of commissionUrlPrefixes) {
      const url = `${prefix}deep_link/1/2?url=https%3A%2F%2Fexample.test%2Fphone`
      const row: PartnerBuyRow = {
        status: 'active', verified: true, sellerId: p.sellerId,
        seller: { ownerId: p.ownerProfileId, officialPartner: true }, purchaseLink: { url },
      }
      expect(partnerBuyUrlOf(row), prefix).toBe(url)
      expect(partnerBuyUrlOf({ ...row, status: 'sold' }), `${prefix} sold`).toBeNull()
    }
  })
})
