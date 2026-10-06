import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Report this seller" ON EVERY PATH STOREFRONT (App Store Guideline 1.2; audit 1.5, 2026-10-06). The identity
 * row rendered only when the shop had a handle, an owner or a chat target, so a handle-less, ownerless shop
 * with nothing to chat about — an imported linked shop at /sellers/<id> — lost Report with the row. Block
 * stays on a shop a person runs. The body is CALLED and its element tree walked, never rendered.
 */
const h = vi.hoisted(() => ({ seller: null as null | Record<string, unknown> }))

vi.mock('@/lib/db', () => ({
  db: {
    seller: { findUnique: async () => h.seller },
    review: { findMany: async () => [] },
    conversation: { count: async () => 0 },
    // The marketplace count, and the chat anchor: no listing here that chat works for.
    listing: { count: async () => 10, findFirst: async () => null },
  },
}))
vi.mock('@/lib/edition-scope', () => ({ isSellerHiddenHere: async () => false, scopedListingWhere: async (w: object) => w }))
vi.mock('@/lib/storefront-gone', async (orig) => ({ ...(await orig<typeof import('@/lib/storefront-gone')>()), isStorefrontGone: async () => false }))
vi.mock('@/lib/feed-window', async (orig) => ({ ...(await orig<typeof import('@/lib/feed-window')>()), diverseFeedWindow: async () => [] }))
vi.mock('@/lib/translate', async (orig) => ({ ...(await orig<typeof import('@/lib/translate')>()), localizeListingTitles: async (rows: unknown[]) => rows }))
vi.mock('@/lib/serialize', async (orig) => ({ ...(await orig<typeof import('@/lib/serialize')>()), serializeListing: (r: unknown) => r }))
vi.mock('@/lib/visa-shop', async (orig) => ({ ...(await orig<typeof import('@/lib/visa-shop')>()), getVisaShopSeller: async () => null }))
vi.mock('@/lib/enforcement', async (orig) => ({ ...(await orig<typeof import('@/lib/enforcement')>()), getEnforcement: async () => null }))
vi.mock('@/lib/storefront', async (orig) => ({ ...(await orig<typeof import('@/lib/storefront')>()), shopShareUrl: async (handle: string) => `https://${handle}.eno.vn` }))

import { SellerStorefront } from './seller-storefront'
import { ReportButton } from './report-button'
import { BlockUserButton } from './block-user-button'

type El = { type: unknown; props: Record<string, unknown> }
const isEl = (n: unknown): n is El => typeof n === 'object' && n !== null && 'type' in n && 'props' in n
/** Every element under `node`, each with the element whose children hold it. */
function elements(node: unknown, parent: El | null = null, out: { el: El; parent: El | null }[] = []) {
  if (Array.isArray(node)) for (const n of node) elements(n, parent, out)
  else if (isEl(node)) {
    out.push({ el: node, parent })
    elements(node.props.children, node, out)
  }
  return out
}
const render = async (id: string) => elements(await SellerStorefront({ id }))
const find = (all: Awaited<ReturnType<typeof render>>, type: unknown) => all.filter(({ el }) => el.type === type)

/** An ownerless, handle-less import shop whose one live row links out — the shape the old guard hid. */
const shop = (over: Record<string, unknown> = {}) => ({
  id: 'cm-tiki', name: 'Tiki', avatarColor: null, avatarUrl: null, bannerUrl: null, bannerMobileUrl: null, bio: null,
  officialPartner: false, ownerId: null, owner: null, handle: null,
  memberSince: new Date('2026-01-01'), reviewCount: 0, rating: 0, trustScore: 100, trustTier: 'trusted',
  responseRate: null, responseTime: null, responseMetricAt: null,
  listings: [{ id: 'l0', affiliateUrl: 'https://tiki.vn/p/1', listingType: 'sell' }],
  _count: { listings: 1 },
  ...over,
})

beforeEach(() => {
  h.seller = shop()
})

describe('SellerStorefront — Report on every storefront, Block on a shop a person runs', () => {
  it('a handle-less, ownerless linked shop with nothing to chat about still shows "Report this seller", and no Block', async () => {
    const all = await render('cm-tiki')
    expect(find(all, ReportButton).map(({ el }) => el.props)).toEqual([{ sellerId: 'cm-tiki' }])
    expect(find(all, BlockUserButton)).toEqual([])
  })

  it('a shop a person runs: Report, then Block, together at the end of the row', async () => {
    h.seller = shop({
      id: 'cm-lan', name: "Lan's shop", ownerId: 'owner-1', owner: { accountType: 'personal', lastSeenAt: null },
      handle: { handle: 'lan_shop' }, listings: [{ id: 'l0', affiliateUrl: null, listingType: 'sell' }],
    })
    const all = await render('cm-lan')
    const [report] = find(all, ReportButton)
    const [block] = find(all, BlockUserButton)
    expect(report.el.props).toEqual({ sellerId: 'cm-lan' })
    expect(block.el.props).toEqual({ sellerId: 'cm-lan', name: "Lan's shop" })
    expect(block.parent).toBe(report.parent)
    expect((report.parent!.props.children as unknown[]).filter(isEl).map((e) => e.type)).toEqual([ReportButton, BlockUserButton])
  })
})
