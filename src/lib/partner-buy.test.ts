import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: { listing: { findFirst: async () => null } } }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: Record<string, unknown>) => w }))

import { ENO_RUN_PARTNERS } from './eno-run-partners'
import { partnerBuyUrl, partnerBuyUrlOf, type PartnerBuyRow } from './partner-buy'

// The "Buy now" link (owner 2026-11-23): an eno-run partner's live listing, an AccessTrade link over https — nothing else.
const SD = ENO_RUN_PARTNERS.find((p) => p.name === 'ShopDunk')!
const LINK = 'https://go.isclix.com/deep_link/7053736680188167797/6800497735607325103?url=https%3A%2F%2Fshopdunk.com%2Fx'
const row = (over: Partial<PartnerBuyRow> = {}): PartnerBuyRow => ({
  status: 'active', verified: true, sellerId: SD.sellerId,
  seller: { ownerId: SD.ownerProfileId, officialPartner: true },
  purchaseLink: { url: LINK },
  ...over,
})

describe('partnerBuyUrlOf', () => {
  it('a pinned partner\'s live listing with its AccessTrade link → the link', () => {
    expect(partnerBuyUrlOf(row())).toBe(LINK)
  })
  it.each([
    ['sold', row({ status: 'sold' })],
    ['hidden', row({ status: 'hidden' })],
    ['unverified', row({ verified: false })],
    ['no link', row({ purchaseLink: null })],
    ['not an AccessTrade host', row({ purchaseLink: { url: 'https://shopdunk.com/x' } })],
    ['plain http', row({ purchaseLink: { url: LINK.replace('https:', 'http:') } })],
    ['a stranger now owns the storefront (pair broken)', row({ seller: { ownerId: '00000000-0000-4000-8000-000000000000', officialPartner: true } })],
    ['not an official partner', row({ seller: { ownerId: SD.ownerProfileId, officialPartner: false } })],
    ['another storefront', row({ sellerId: 'cmzzzzzzzzzzzzzzzzzzzzzzz' })],
  ])('%s → null', (_, r) => expect(partnerBuyUrlOf(r)).toBeNull())
  it('no row → null', () => expect(partnerBuyUrlOf(null)).toBeNull())
})

describe('partnerBuyUrl', () => {
  it('no listing id → null without a read', async () => {
    expect(await partnerBuyUrl(null)).toBeNull()
    expect(await partnerBuyUrl('missing')).toBeNull()
  })
})
