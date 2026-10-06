import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REPORT AND BLOCK ON THE STOREFRONT A HANDLE REACHES (App Store Guideline 1.2; audit 1.5, 2026-10-06).
 * eno.vn/<handle> renders this page in place, so it is where a /sellers/<id> link lands — and it drew the
 * seller card and Share with no Report and no Block. Pinned: both sit in Share's column on the canonical
 * host (its `www` alias too); Block only on a shop a person runs; neither on the shop's own host, where
 * proxy.ts refuses the write (the reason chat is a cross-host link there).
 * The page is CALLED and the element tree it returns is walked, never rendered: the data are stubs, and
 * every UI stub carries its export's name, so an element says which component it is.
 */
const h = vi.hoisted(() => ({ host: 'eno.vn', ownerId: 'owner-1' as string | null }))

vi.mock('@/lib/db', () => ({
  db: {
    // The shop's count and the marketplace's are equal, so there is no "More from other sellers" grid.
    listing: { findMany: async () => [], count: async () => 3, groupBy: async () => [] },
    conversation: { count: async () => 0 },
  },
}))
vi.mock('@/lib/edition-scope', () => ({ isSellerHiddenHere: async () => false, scopedListingWhere: async (w: object) => w }))
vi.mock('@/lib/storefront', () => ({
  // The base host the proxy hangs storefronts off; `storefrontHandleFromHost` is the real one.
  canonicalAppHost: () => 'eno.vn',
  storefrontByLabel: async (label: string) => ({ sellerId: 'seller-1', handle: label, name: 'VinWonders', bannerUrl: null, bannerMobileUrl: null }),
  storefrontCanonical: async (handle: string) => `https://${handle}.eno.vn`,
}))
vi.mock('@/components/marketplace/seller-storefront', () => ({
  loadSeller: async (id: string) => ({ id, name: 'VinWonders', ownerId: h.ownerId }),
  storefrontCard: () => ({ cardSeller: {}, metrics: {}, sellerInfo: null }),
  storefrontChatListingId: async () => null,
  storefrontMetaDescription: async () => null,
  OTHER_LISTINGS: 24,
}))
vi.mock('@/lib/visa-shop', () => ({ getVisaShopSeller: async () => null }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: h.host }) }))
vi.mock('@/lib/serialize', () => ({ serializeListingCard: (r: unknown) => r, safeParse: () => [], LISTING_CARD_SELECT: {} }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (rows: unknown[]) => rows }))
vi.mock('@/lib/categories', () => ({ getCategoriesByDemand: async () => [] }))
vi.mock('@/lib/feed-window', () => ({ diverseFeedWindow: async () => [] }))
vi.mock('@/lib/feed-diversity', () => ({ diversifyBySeller: (rows: unknown[]) => rows }))

// The page's UI, each export a stub named after it.
for (const [path, names] of Object.entries({
  '@/components/marketplace/header': ['Header'],
  '@/components/marketplace/footer': ['Footer'],
  '@/components/marketplace/listings-explorer': ['ListingsExplorer'],
  '@/components/marketplace/seller-listings': ['SellerListings'],
  '@/components/marketplace/storefront-seller-card': ['StorefrontSellerCard'],
  '@/components/marketplace/seller-info': ['SellerInfo'],
  '@/components/marketplace/bilingual': ['Bilingual'],
  '@/components/marketplace/storefront-banner': ['StorefrontBanner'],
  '@/components/marketplace/share-button': ['ShareButton'],
  '@/components/marketplace/report-button': ['ReportButton'],
  '@/components/marketplace/block-user-button': ['BlockUserButton'],
  '@/components/ui/empty-state': ['EmptyState'],
  '@/components/ui/button': ['Button'],
  '@/context/language-context': ['Tr'],
})) vi.doMock(path, () => Object.fromEntries(names.map((n) => [n, Object.assign(() => null, { displayName: n })])))

const { default: Storefront } = await import('./page')

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
const nameOf = (el: El) => (el.type as { displayName?: string } | null)?.displayName
const render = async () => elements(await Storefront({ params: Promise.resolve({ handle: 'vinwonders' }) }))
const find = (all: Awaited<ReturnType<typeof render>>, name: string) => all.filter(({ el }) => nameOf(el) === name)

beforeEach(() => {
  h.host = 'eno.vn'
  h.ownerId = 'owner-1'
})

describe('/s/<handle> (eno.vn/<handle> in place) — Report and Block beside Share', () => {
  it.each(['eno.vn', 'www.eno.vn'])('on the canonical host (%s): Share, Report, Block — one column, in that order', async (host) => {
    h.host = host
    const all = await render()
    const [share] = find(all, 'ShareButton')
    const reports = find(all, 'ReportButton')
    const blocks = find(all, 'BlockUserButton')
    expect(reports.map(({ el }) => el.props)).toEqual([{ sellerId: 'seller-1' }])
    expect(blocks.map(({ el }) => el.props)).toEqual([{ sellerId: 'seller-1', name: 'VinWonders' }])
    const column = share.parent!
    expect(reports[0].parent).toBe(column)
    expect(blocks[0].parent).toBe(column)
    expect((column.props.children as unknown[]).filter(isEl).map(nameOf)).toEqual(['ShareButton', 'ReportButton', 'BlockUserButton'])
  })

  it('an ownerless (imported) shop: Report, and no Block — there is nobody to block', async () => {
    h.ownerId = null
    const all = await render()
    expect(find(all, 'ReportButton').map(({ el }) => el.props)).toEqual([{ sellerId: 'seller-1' }])
    expect(find(all, 'BlockUserButton')).toEqual([])
  })

  it("on the shop's own host: Share only — a write from there is refused (proxy.ts)", async () => {
    h.host = 'vinwonders.eno.vn'
    const all = await render()
    expect(find(all, 'ShareButton')).toHaveLength(1)
    expect(find(all, 'ReportButton')).toEqual([])
    expect(find(all, 'BlockUserButton')).toEqual([])
  })
})
