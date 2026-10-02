import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Metadata } from 'next'

/**
 * ⛔ A GONE STOREFRONT 404s FROM generateMetadata (src/lib/storefront-gone.ts; owner 2026-10-02, the
 * emptied SuperSports shop). Both handle routes build their <title> and OG tags off the HANDLE row, not
 * off `loadSeller`, so each generateMetadata has to consult `loadSeller` — null for a hidden OR a gone
 * seller — or the 404 page would still read "SuperSports | eno". And it THROWS notFound() rather than
 * returning a "Not found" title: the 404 contract (not-found-contract.test.ts) wants the throw here,
 * before any boundary could swallow it, and before /s/<handle>'s listing queries run.
 * `loadSeller`'s own rule is pinned in src/components/marketplace/seller-storefront-meta.test.ts; this
 * pins that both routes ask it.
 */
type Row = Record<string, unknown>
const h = vi.hoisted(() => ({
  handleRow: null as Row | null,
  loaded: null as Row | null,
  hidden: false,
  loadSellerCalls: [] as string[],
}))

const stub = () => null
vi.mock('@/lib/db', () => ({ db: { handle: { findUnique: async () => h.handleRow } } }))
vi.mock('@/lib/handle', () => ({ HANDLE_RE: /^[a-z0-9_]{1,40}$/ }))
vi.mock('@/lib/edition-scope', () => ({ isSellerHiddenHere: async () => h.hidden, scopedListingWhere: async (w: object) => w }))
vi.mock('@/lib/storefront', () => ({
  storefrontByHandle: async () => null,
  storefrontByLabel: async (label: string) => ({ sellerId: 'seller-1', handle: label, name: 'SuperSports', bannerUrl: null, bannerMobileUrl: null }),
  storefrontCanonical: async (handle: string, origin: string) => `${origin}/${handle}`,
}))
vi.mock('@/components/marketplace/seller-storefront', () => ({
  loadSeller: async (id: string) => { h.loadSellerCalls.push(id); return h.loaded },
  storefrontMetaDescription: async () => (h.loaded ? 'desc' : null),
  storefrontCard: stub,
  SellerStorefront: stub,
  OTHER_LISTINGS: 24,
}))
vi.mock('@/lib/site-identity', () => ({ pageShare: () => ({}) }))
// The page bodies' UI — irrelevant to metadata, stubbed so the modules load without a DOM.
for (const path of [
  '@/components/marketplace/header', '@/components/marketplace/footer', '@/components/marketplace/listings-explorer',
  '@/components/marketplace/seller-listings', '@/components/marketplace/storefront-seller-card',
  '@/components/marketplace/seller-info', '@/components/marketplace/bilingual', '@/components/marketplace/storefront-banner',
  '@/components/marketplace/share-button', '@/components/ui/empty-state', '@/components/ui/button', '@/components/ui/avatar',
  '@/context/language-context', '@/lib/serialize', '@/lib/translate', '@/lib/categories', '@/lib/feed-window', '@/lib/feed-diversity',
]) vi.doMock(path, () => new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : stub) }))

const handlePage = await import('./page')
const subdomainPage = await import('@/app/[lang]/s/[handle]/page')

/** What next/navigation's notFound() throws — the digest Next reads to answer 404. */
const NOT_FOUND = { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' }

const meta = (m: { generateMetadata: (p: { params: Promise<{ handle: string }> }) => Promise<Metadata> }, handle: string) =>
  m.generateMetadata({ params: Promise.resolve({ handle }) })

beforeEach(() => {
  h.handleRow = { handle: 'supersports', seller: { id: 'seller-1', name: 'SuperSports' }, profile: null }
  h.loaded = null // gone: loadSeller answers null
  h.hidden = false
  h.loadSellerCalls = []
})

describe('eno.vn/<handle> generateMetadata', () => {
  it('a gone shop: notFound() from generateMetadata, so its name titles nothing', async () => {
    await expect(meta(handlePage, 'supersports')).rejects.toMatchObject(NOT_FOUND)
    expect(h.loadSellerCalls).toEqual(['seller-1'])
  })

  it('a hidden shop: notFound() too, without asking loadSeller', async () => {
    h.hidden = true
    h.loaded = { id: 'seller-1' }
    await expect(meta(handlePage, 'supersports')).rejects.toMatchObject(NOT_FOUND)
    expect(h.loadSellerCalls).toEqual([])
  })

  it('a live shop keeps its title', async () => {
    h.loaded = { id: 'seller-1' }
    const m = await meta(handlePage, 'supersports')
    expect(String(m.title)).toContain('SuperSports')
  })
})

describe('<handle>.eno.vn (/s/<handle>) generateMetadata', () => {
  it('a gone shop: notFound() from generateMetadata, so its name titles nothing', async () => {
    await expect(meta(subdomainPage, 'supersports')).rejects.toMatchObject(NOT_FOUND)
    expect(h.loadSellerCalls).toEqual(['seller-1'])
  })

  it('a hidden shop: notFound() too', async () => {
    h.hidden = true
    h.loaded = { id: 'seller-1' }
    await expect(meta(subdomainPage, 'supersports')).rejects.toMatchObject(NOT_FOUND)
  })

  it('a live shop keeps its title', async () => {
    h.loaded = { id: 'seller-1' }
    const m = await meta(subdomainPage, 'supersports')
    expect(String(m.title)).toContain('SuperSports')
  })
})
