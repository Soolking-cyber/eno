import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * REPORT AND BLOCK ON THE STOREFRONT A HANDLE REACHES (App Store Guideline 1.2; audit 1.5, 2026-10-06).
 * eno.vn/<handle> renders this page in place, so it is where a /sellers/<id> link lands — and it drew the
 * seller card and Share with no Report and no Block.
 * ⛔ SINCE 2026-11-16 (owner, hub Q21) THEY ARE IN THE ⋯ — REACHABLE, NEVER REMOVED. Pinned here: under the identity the card's
 * row is [Chat][Share][⋯] (StorefrontSellerCard `actions`: Share as Chat's equal, then StorefrontMoreMenu with the shop's id,
 * name and who a Block reaches), drawn at every width with nothing hiding it, on the canonical host (its `www` alias too); an
 * imported shop's ⋯ blocks it as a shop; neither on the shop's own host, where proxy.ts refuses the write (the reason chat is a
 * cross-host link there). What the ⋯ holds and opens: storefront-more-menu.test.tsx.
 * The page is CALLED and the element tree it returns is walked, never rendered: the data are stubs, and
 * every UI stub carries its export's name, so an element says which component it is.
 */
const h = vi.hoisted(() => ({ host: 'eno.vn', ownerId: 'owner-1' as string | null, market: 3, lastSeenDay: null as string | null, chat: null as string | null }))

vi.mock('@/lib/db', () => ({
  db: {
    // The shop's count (its `where` names the seller) and the marketplace's; equal by default, so there is no "More from other
    // sellers" grid.
    listing: { findMany: async () => [], count: async ({ where }: { where: Record<string, unknown> }) => ('sellerId' in where ? 3 : h.market), groupBy: async () => [] },
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
  storefrontCard: () => ({ cardSeller: {}, metrics: { lastSeenDay: h.lastSeenDay }, sellerInfo: null }),
  storefrontChatListingId: async () => h.chat,
  storefrontMetaDescription: async () => null,
  OTHER_LISTINGS: 24,
}))
vi.mock('@/lib/visa-shop', () => ({ getVisaShopSeller: async () => null }))
// Who a Block reaches (the dialog's words only): the shop itself when nobody blockable runs it.
vi.mock('@/lib/user-blocks', () => ({ isShopOnlyBlock: async (ownerId: string | null) => !ownerId }))
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
  '@/components/marketplace/storefront-more-menu': ['StorefrontMoreMenu'],
  '@/components/ui/empty-state': ['EmptyState'],
  '@/components/ui/button': ['Button'],
  '@/context/language-context': ['Tr'],
})) vi.doMock(path, () => Object.fromEntries(names.map((n) => [n, Object.assign(() => null, { displayName: n })])))

const { default: Storefront } = await import('./page')

type El = { type: unknown; props: Record<string, unknown> }
const isEl = (n: unknown): n is El => typeof n === 'object' && n !== null && 'type' in n && 'props' in n
/** Every element under `node`, each with the element whose children (or `actions`, the card's row slot) hold it. */
function elements(node: unknown, parent: El | null = null, out: { el: El; parent: El | null }[] = []) {
  if (Array.isArray(node)) for (const n of node) elements(n, parent, out)
  else if (isEl(node)) {
    out.push({ el: node, parent })
    elements(node.props.children, node, out)
    elements(node.props.actions, node, out)
  }
  return out
}
const nameOf = (el: El) => (el.type as { displayName?: string } | null)?.displayName
const render = async (query?: Record<string, string>) =>
  elements(await Storefront({ params: Promise.resolve({ handle: 'vinwonders' }), searchParams: query && Promise.resolve(query) }))
const find = (all: Awaited<ReturnType<typeof render>>, name: string) => all.filter(({ el }) => nameOf(el) === name)

beforeEach(() => {
  h.host = 'eno.vn'
  h.ownerId = 'owner-1'
  h.market = 3
  h.lastSeenDay = null
  h.chat = null
})

const tokens = (el: El) => String(el.props.className ?? '').split(/\s+/)
/** The element and every element above it in the page's tree. */
function lineage(all: Awaited<ReturnType<typeof render>>, el: El) {
  const parentOf = new Map(all.map(({ el: e, parent }) => [e, parent]))
  const out: El[] = []
  for (let at: El | null | undefined = el; at; at = parentOf.get(at)) out.push(at)
  return out
}
/** The card's row slot (`actions`, one fragment): its controls, in order. */
const rowOf = (card: El) => ([] as unknown[]).concat((card.props.actions as El).props.children).filter(isEl)
const HIDING = ['hidden', 'sr-only', 'invisible', 'max-sm:hidden', 'max-sm:sr-only', 'sm:hidden', 'md:hidden', 'max-md:hidden']

describe('/s/<handle> — the r12 storefront build (UI climb r12, cook store-r12c; owner, 2026-11-16)', () => {
  it('⛔ Report and Block are REACHABLE FROM THE ⋯, NEVER REMOVED: the ⋯ is drawn at every width, nothing above it hides it', async () => {
    const all = await render()
    const [more] = find(all, 'StorefrontMoreMenu')
    expect(more.el.props).toEqual({ sellerId: 'seller-1', shopOnly: false, name: 'VinWonders' })
    for (const up of lineage(all, more.el)) expect(tokens(up).filter((t) => HIDING.includes(t))).toEqual([])
    // No second way in, no stray pill: the old column is gone.
    expect(all.some(({ el }) => tokens(el).join(' ') === 'flex shrink-0 flex-col items-end gap-2 md:flex-row md:items-center')).toBe(false)
  })

  it('S2: under the identity, the card\'s row — Share as Chat\'s equal (`pair`), then the ⋯; the identity at the column\'s width', async () => {
    const all = await render()
    const [card] = find(all, 'StorefrontSellerCard')
    const actions = rowOf(card.el)
    expect(actions.map(nameOf)).toEqual(['ShareButton', 'StorefrontMoreMenu'])
    expect(actions[0].props).toMatchObject({ url: 'https://vinwonders.eno.vn', title: 'VinWonders', shape: 'pair' })
    // No chat target here (the stub's anchor is null): Share is drawn alone, at its own width (review, 2026-11-16).
    expect(actions[0].props.alone).toBe(true)
    // The card's own column, and no right-hand column beside it any more.
    const column = card.parent!
    expect(tokens(column)).toEqual(['min-w-0', 'max-w-md'])
    const block = all.find(({ el }) => el === column)!.parent!
    expect(([] as unknown[]).concat(block.props.children).filter(isEl)).toEqual([column])
  })

  it('the phone facts line\'s reserve is decided here, at request time: presence in the last 30 days, else none (a dormant shop)', async () => {
    const day = (ago: number) => new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10)
    h.lastSeenDay = day(0)
    expect(find(await render(), 'StorefrontSellerCard')[0].el.props.presenceDue).toBe(true)
    h.lastSeenDay = day(40)
    expect(find(await render(), 'StorefrontSellerCard')[0].el.props.presenceDue).toBe(false)
    h.lastSeenDay = null
    expect(find(await render(), 'StorefrontSellerCard')[0].el.props.presenceDue).toBe(false)
  })

  it('S3: a directed link (`?q=`, `?category=`, `?view=map`) tells the explorer, so its phone results row is drawn from the first frame', async () => {
    h.market = 3
    const explorer = async (q?: Record<string, string>) => find(await render(q), 'ListingsExplorer')[0].el.props.serverDirected
    expect(await explorer()).toBe(false)
    expect(await explorer({ q: 'duplex' })).toBe(true)
    expect(await explorer({ category: 'rentals' })).toBe(true)
    expect(await explorer({ view: 'map' })).toBe(true)
    // An order alone does not direct the shop (explorer-url.ts isDirected).
    expect(await explorer({ sort: 'price-low' })).toBe(false)
  })

  it('S7: "More from other sellers" sits 24 / 24 on a phone (48 / 32 from sm) and its count sentence is announced, not printed', async () => {
    h.market = 100
    const all = await render()
    const [grid] = find(all, 'SellerListings')
    expect(grid.el.props.quietCount).toBe(true)
    expect(grid.el.props.serverScope).toMatchObject({ params: { excludeSeller: 'seller-1' }, total: 97 })
    const section = grid.parent!
    expect(section.type).toBe('section')
    expect(tokens(section)).toEqual(expect.arrayContaining(['mt-6', 'pt-6', 'sm:mt-12', 'sm:pt-8', 'border-t', 'border-border']))
  })
})

describe('/s/<handle> (eno.vn/<handle> in place) — Report and Block in the ⋯ after Share', () => {
  it.each(['eno.vn', 'www.eno.vn'])('on the canonical host (%s): Share, then the ⋯ (Report, Block) — in that order', async (host) => {
    h.host = host
    const all = await render()
    const [card] = find(all, 'StorefrontSellerCard')
    expect(find(all, 'StorefrontMoreMenu').map(({ el }) => el.props)).toEqual([{ sellerId: 'seller-1', shopOnly: false, name: 'VinWonders' }])
    expect(find(all, 'ShareButton')).toHaveLength(1)
    expect(rowOf(card.el).map(nameOf)).toEqual(['ShareButton', 'StorefrontMoreMenu'])
  })

  it('⛔ an ownerless (imported) shop: the ⋯ blocks it as a shop (App Store 1.2 rejection, 2026-10-28)', async () => {
    h.ownerId = null
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    const all = await render()
    expect(find(all, 'StorefrontMoreMenu').map(({ el }) => el.props)).toEqual([{ sellerId: 'seller-1', shopOnly: true, name: 'VinWonders' }])
    vi.unstubAllEnvs()
  })

  it("on the shop's own host: Share only — a write from there is refused (proxy.ts)", async () => {
    h.host = 'vinwonders.eno.vn'
    const all = await render()
    expect(find(all, 'ShareButton')).toHaveLength(1)
    expect(find(all, 'StorefrontMoreMenu')).toEqual([])
  })
})

describe('/s/<handle> — ⛔ Share is Chat\'s equal only when Chat is drawn (review, 2026-11-16)', () => {
  it.each(['eno.vn', 'vinwonders.eno.vn'])('on %s: with a chat target the pair; without one (affiliate-only, the visa desk) Share alone', async (host) => {
    h.host = host
    h.chat = 'l1'
    const share = async () => find(await render(), 'ShareButton')[0].el.props
    expect(await share()).toMatchObject({ shape: 'pair', alone: false })
    expect(find(await render(), 'StorefrontSellerCard')[0].el.props.chatListingId).toBe('l1')
    h.chat = null
    expect(await share()).toMatchObject({ shape: 'pair', alone: true })
  })
})
