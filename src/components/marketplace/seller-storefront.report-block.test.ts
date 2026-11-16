import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Report this seller" ON EVERY PATH STOREFRONT (App Store Guideline 1.2; audit 1.5, 2026-10-06). The identity
 * row rendered only when the shop had a handle, an owner or a chat target, so a handle-less, ownerless shop
 * with nothing to chat about — an imported linked shop at /sellers/<id> — lost Report with the row.
 * ⛔ SINCE 2026-11-16 (owner, hub Q21) REPORT AND BLOCK ARE IN THE ⋯ — REACHABLE, NEVER REMOVED: the row leads with
 * [Chat][Share][⋯] (store-pair.ts), and the ⋯ (StorefrontMoreMenu) is on EVERY path storefront, an imported shop's included,
 * with nothing hiding it at any width. Block is its row wherever the pill rendered (storefront-more-menu.test.tsx pins the
 * rows, the dialogs and the words). The body is CALLED and its element tree walked, never rendered.
 */
const h = vi.hoisted(() => ({ seller: null as null | Record<string, unknown>, chat: null as null | { id: string }, sellerQuery: null as unknown }))

vi.mock('@/lib/db', () => ({
  db: {
    seller: { findUnique: async (q: unknown) => { h.sellerQuery = q; return h.seller } },
    review: { findMany: async () => [] },
    conversation: { count: async () => 0 },
    // The marketplace count, and the chat anchor: no listing here that chat works for.
    // findMany: the storefront's teacher section (loadStorefrontTeachers) — none here.
    listing: { count: async () => 10, findFirst: async () => h.chat, findMany: async () => [] },
  },
}))
vi.mock('@/lib/edition-scope', () => ({ isSellerHiddenHere: async () => false, scopedListingWhere: async (w: object) => w }))
vi.mock('@/lib/storefront-gone', async (orig) => ({ ...(await orig<typeof import('@/lib/storefront-gone')>()), isStorefrontGone: async () => false }))
vi.mock('@/lib/feed-window', async (orig) => ({ ...(await orig<typeof import('@/lib/feed-window')>()), diverseFeedWindow: async () => [] }))
vi.mock('@/lib/translate', async (orig) => ({ ...(await orig<typeof import('@/lib/translate')>()), localizeListingTitles: async (rows: unknown[]) => rows }))
vi.mock('@/lib/serialize', async (orig) => ({ ...(await orig<typeof import('@/lib/serialize')>()), serializeListing: (r: unknown) => r }))
vi.mock('@/lib/visa-shop', async (orig) => ({ ...(await orig<typeof import('@/lib/visa-shop')>()), getVisaShopSeller: async () => null }))
vi.mock('@/lib/enforcement', async (orig) => ({ ...(await orig<typeof import('@/lib/enforcement')>()), getEnforcement: async () => null }))
vi.mock('@/lib/user-blocks', () => ({ isShopOnlyBlock: async (ownerId: string | null) => !ownerId }))
vi.mock('@/lib/storefront', async (orig) => ({ ...(await orig<typeof import('@/lib/storefront')>()), shopShareUrl: async (handle: string) => `https://${handle}.eno.vn` }))

import { SellerStorefront } from './seller-storefront'
import { StorefrontMoreMenu } from './storefront-more-menu'
import { StorefrontChatButton } from './storefront-chat-button'
import { ShareButton } from './share-button'
import { ReportButton } from './report-button'
import { BlockUserButton } from './block-user-button'
import { SellerListings } from './seller-listings'
import { StorefrontSellerCard } from './storefront-seller-card'

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
  h.chat = null
})

describe('SellerStorefront — Report and Block in the ⋯ on every storefront', () => {
  it('⛔ a handle-less, ownerless linked shop still has the ⋯ — Report, AND Block as a shop (App Store 1.2, 2026-10-28)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    const all = await render('cm-tiki')
    vi.unstubAllEnvs()
    expect(find(all, StorefrontMoreMenu).map(({ el }) => el.props)).toEqual([{ sellerId: 'cm-tiki', shopOnly: true, name: 'Tiki' }])
    // No pill of either on the page: the ⋯ is their one way in.
    expect(find(all, ReportButton)).toEqual([])
    expect(find(all, BlockUserButton)).toEqual([])
  })

  it('a shop a person runs: [Chat][Share][⋯] leads the row, the handle chip after the pair', async () => {
    h.seller = shop({
      id: 'cm-lan', name: "Lan's shop", ownerId: 'owner-1', owner: { accountType: 'personal', lastSeenAt: null },
      handle: { handle: 'lan_shop' }, listings: [{ id: 'l0', affiliateUrl: null, listingType: 'sell' }],
    })
    h.chat = { id: 'l0' } // a listing chat works for
    const all = await render('cm-lan')
    const [more] = find(all, StorefrontMoreMenu)
    expect(more.el.props).toEqual({ sellerId: 'cm-lan', shopOnly: false, name: "Lan's shop" })
    const pair = more.parent!
    expect((pair.props.children as unknown[]).filter(isEl).map((e) => e.type)).toEqual([StorefrontChatButton, ShareButton, StorefrontMoreMenu])
    expect(find(all, ShareButton)[0].el.props).toMatchObject({ url: 'https://lan_shop.eno.vn', shape: 'pair' })
    const row = all.find(({ el }) => el === pair)!.parent!
    expect((row.props.children as unknown[]).filter(isEl)[0]).toBe(pair)
  })
})

describe('SellerStorefront — the r12 storefront build (UI climb r12, cook store-r12c)', () => {
  const tokens = (el: El) => String(el.props.className ?? '').split(/\s+/)
  const HIDING = ['hidden', 'sr-only', 'invisible', 'max-sm:hidden', 'max-sm:sr-only', 'sm:hidden', 'md:hidden', 'max-md:hidden']

  it('⛔ the ⋯ holding Report and Block is drawn at every width: nothing above it hides it (owner, 2026-11-16 — hub Q21)', async () => {
    h.seller = shop({ ownerId: 'owner-1', owner: { accountType: 'personal', lastSeenAt: null } })
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
    const all = await render('cm-tiki')
    vi.unstubAllEnvs()
    const parentOf = new Map(all.map(({ el, parent }) => [el, parent]))
    const [{ el }] = find(all, StorefrontMoreMenu)
    for (let up: El | null | undefined = el; up; up = parentOf.get(up)) expect(tokens(up).filter((t) => HIDING.includes(t))).toEqual([])
  })

  it('the phone facts line\'s reserve is decided at request time: presence in the last 30 days, else none', async () => {
    const cardOf = async () => find(await render('cm-lan'), StorefrontSellerCard)[0].el.props.presenceDue
    h.seller = shop({ ownerId: 'owner-1', owner: { accountType: 'personal', lastSeenAt: new Date() } })
    expect(await cardOf()).toBe(true)
    h.seller = shop({ ownerId: 'owner-1', owner: { accountType: 'personal', lastSeenAt: new Date(Date.now() - 40 * 86_400_000) } })
    expect(await cardOf()).toBe(false)
  })

  it('Q21b (owner, 2026-11-16): the shop\'s own grid is drawn `ownShop` (no partner shield on its cards); the other sellers\' is not', async () => {
    h.seller = shop({ listings: [{ id: 'l0', affiliateUrl: null, listingType: 'sell' }] })
    const all = await render('cm-tiki')
    const grids = find(all, SellerListings).map(({ el }) => el.props)
    const own = grids.find((g) => (g.serverScope as { params?: Record<string, string> } | undefined)?.params?.seller === 'cm-tiki')
    const others = grids.find((g) => (g.serverScope as { params?: Record<string, string> } | undefined)?.params?.excludeSeller)
    expect(own?.ownShop).toBe(true)
    expect(others?.ownShop).toBeUndefined()
  })

  it('S7, as on the subdomain storefront: "More from other sellers" 24 / 24 on a phone, its count sentence announced, not printed', async () => {
    const all = await render('cm-tiki')
    const [grid] = find(all, SellerListings).filter(({ el }) => (el.props.serverScope as { params?: Record<string, string> } | undefined)?.params?.excludeSeller)
    expect(grid.el.props.quietCount).toBe(true)
    expect(tokens(grid.parent!)).toEqual(expect.arrayContaining(['mt-6', 'pt-6', 'sm:mt-12', 'sm:pt-8', 'border-t']))
  })
})

describe('SellerStorefront — ⛔ Chat and Share are a pair only when both are drawn (review, 2026-11-16)', () => {
  const memberProps = (all: Awaited<ReturnType<typeof render>>) => ({
    chat: find(all, StorefrontChatButton).map(({ el }) => el.props),
    share: find(all, ShareButton).map(({ el }) => el.props),
  })

  it('a handle and a chat target: Chat and Share, each the pair\'s half — 16px under the identity on a phone', async () => {
    h.seller = shop({ handle: { handle: 'lan_shop' }, listings: [{ id: 'l0', affiliateUrl: null, listingType: 'sell' }] })
    h.chat = { id: 'l0' }
    const all = await render('cm-tiki')
    const { chat, share } = memberProps(all)
    expect(chat).toEqual([{ chatListingId: 'l0', alone: false }])
    expect(share).toEqual([expect.objectContaining({ shape: 'pair', alone: false })])
    // The identity's box gives the row 16px below it on a phone (12 from sm, the column's space-y-3), as on /s/[handle].
    expect(String(find(all, StorefrontSellerCard)[0].parent!.props.className).split(' ')).toEqual(['max-w-md', 'max-sm:mb-4'])
  })

  it('⛔ no handle (nothing to share): Chat alone — its own width, never the whole row', async () => {
    h.seller = shop({ listings: [{ id: 'l0', affiliateUrl: null, listingType: 'sell' }] })
    h.chat = { id: 'l0' }
    const { chat, share } = memberProps(await render('cm-tiki'))
    expect(chat).toEqual([{ chatListingId: 'l0', alone: true }])
    expect(share).toEqual([])
  })

  it('⛔ an affiliate-only partner (no Chat, owner 2026-08-24): Share alone — its own width', async () => {
    h.seller = shop({ handle: { handle: 'tiki' } })
    const { chat, share } = memberProps(await render('cm-tiki'))
    expect(chat).toEqual([])
    expect(share).toEqual([expect.objectContaining({ url: 'https://tiki.eno.vn', shape: 'pair', alone: true })])
  })

  it('an empty shop (no anchor, not a partner): no Chat element at all, so Share is alone too', async () => {
    h.seller = shop({ handle: { handle: 'new_shop' }, listings: [], _count: { listings: 0 } })
    const { chat, share } = memberProps(await render('cm-tiki'))
    expect(chat).toEqual([])
    expect(share).toEqual([expect.objectContaining({ alone: true })])
  })
})

describe('SellerStorefront — Q15: the shop\'s grid strip is the filled strip, naming the order it shows (review, 2026-11-16)', () => {
  it('`strip="filled"` on the shop\'s own grid, and its order is "Newest" ("recent"): the rows are postedAt-desc', async () => {
    h.seller = shop({ listings: [{ id: 'l0', affiliateUrl: null, listingType: 'sell' }] })
    const all = await render('cm-tiki')
    const own = find(all, SellerListings).map(({ el }) => el.props).find((g) => (g.serverScope as { params?: Record<string, string> } | undefined)?.params?.seller === 'cm-tiki')!
    expect(own).toMatchObject({ strip: 'filled', initialSort: 'recent', sortable: true })
    // The first page it is handed IS the newest: the seller's rows are read postedAt-desc (the API's 'recent', buildFeedOrderBy).
    const rows = (h.sellerQuery as { include?: { listings?: { orderBy?: unknown } } }).include?.listings
    expect(rows?.orderBy).toEqual([{ postedAt: 'desc' }, { id: 'desc' }])
    // Not the goods look: the cards stay the shop's own.
    expect(own.look).toBeUndefined()
  })
})
