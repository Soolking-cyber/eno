// @vitest-environment jsdom
/**
 * ⛔ A CARD CLIP THAT CANNOT LOAD COSTS THE CLIP, NEVER THE PAGE (R22, resilience-01).
 *
 * Measured on live: when the CardVideo chunk failed twice (the request and the bundler's own retry), `/`, `/vi` and
 * `/c/rentals` turned into "Something went wrong" with no listings, and "Try again" could not bring them back, because
 * next/dynamic's React.lazy keeps the rejection. These run the card through the REAL app-router next/dynamic and pin:
 *   · a chunk that never arrives leaves the card (and whatever holds it) standing, with its photo and no clip, and a
 *     card that mounts afterwards (the rejection is kept) is caught the same way;
 *   · the loader asks once more 1.5 s later: a chunk that is back by then plays; one that is not costs one extra ask.
 */
import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'

// How many times the clip module is asked for, and how many of those asks fail (a chunk that will not load).
const clip = { asks: 0, fails: 0 }
// The app router's own next/dynamic (React.lazy + Suspense, ssr:false bail-out), not a stub: its kept rejection is the bug.
vi.mock('next/dynamic', async () => {
  const real = await vi.importActual<{ default?: unknown }>('next/dist/shared/lib/app-dynamic')
  return { default: real.default ?? real }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text
  default: ({ fill: _f, priority: _p, unoptimized: _u, quality: _q, ...rest }: Record<string, unknown>) => <img {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />,
}))
vi.mock('@/components/ui/icons', () => {
  const Icon = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />
  return { Heart: Icon, Building2: Icon, MapPin: Icon, MessageCircle: Icon, Tag: Icon, Play: Icon, ArrowRight: Icon }
})
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', t: (k: string) => k, tr: (en: string) => en }),
  useTr: (s: string) => s,
}))
vi.mock('./listing-content', () => ({
  useLocalized: (title: string) => title,
  PostedAgo: () => null,
}))
vi.mock('@/context/favorites-context', () => ({
  useFavoriteMarks: () => ({ isFavorite: () => false, toggle: vi.fn(), savedDelta: () => 0 }),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn: vi.fn() }) }))
vi.mock('@/hooks/use-mounted', () => ({ useMounted: () => true }))
vi.mock('@/components/marketplace/owner-edit-button', () => ({ OwnerEditButton: () => null }))
vi.mock('@/components/ui/tooltip', () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('./partner-badge', () => ({ PartnerBadge: () => null }))
vi.mock('./image-mark', () => ({ ImageMark: () => null }))
vi.mock('./trust-score', () => ({ TrustScore: () => null }))
vi.mock('./card-badges', () => ({ CardBadges: () => null }))
vi.mock('./price', () => ({ Price: ({ price }: { price: number }) => <span>{price}</span> }))
vi.mock('./category-icons', () => ({ CategoryIcon: () => null }))
vi.mock('@/lib/quick-contact', () => ({ stashQuickCompose: () => false }))

const listing = (id: string) => ({
  id,
  title: `Clip card ${id}`,
  titleVi: null,
  titleI18n: null,
  images: [`https://picsum.photos/seed/${id}/400`],
  video: `/clips/${id}.mp4`,
  price: 12_000_000,
  prevPrice: null,
  currency: 'VND',
  priceUnit: 'VND',
  location: 'Hà Nội',
  condition: 'used',
  savedCount: 0,
  negotiable: true,
  isPartnerBooking: false,
  sellerId: 's1',
  seller: { trustScore: 50, isBusiness: false, officialPartner: false },
  category: { icon: 'bike', slug: 'motorbikes' },
  postedAt: '2026-09-20T00:00:00.000Z',
  brandSlug: null,
  model: null,
}) as unknown as SerializedListingCard

/** Stands in for `[lang]/error.tsx`: what the visitor gets if the throw climbs past the card. */
const ROUTE_ERROR = 'Something went wrong' // a const: `react/jsx-no-literals` lints tests too
class RouteError extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <p>{ROUTE_ERROR}</p> : this.props.children
  }
}

/**
 * next/dynamic's lazy lives in the module, so each test gets a fresh listing-card, and a fresh clip module whose first
 * `fails` asks throw the way a chunk that will not load rejects. (`doMock` here, not a hoisted `vi.mock`: a module that
 * loaded once would otherwise stay loaded for the next test.)
 */
async function freshCard(fails: number) {
  clip.asks = 0
  clip.fails = fails
  vi.resetModules()
  vi.doMock('./card-video', () => {
    clip.asks++
    if (clip.asks <= clip.fails) throw new Error('ChunkLoadError: Failed to load chunk /_next/static/chunks/clip.js')
    return { CardVideo: ({ src }: { src: string }) => <div data-testid="clip" data-src={src} /> }
  })
  return (await import('./listing-card')).ListingCard
}

beforeEach(() => {
  vi.useFakeTimers()
  // React reports what a boundary caught; quiet here, counted where it matters.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ListingCard — a clip chunk that fails', () => {
  it('never arriving: the page keeps the card and its photo, with no clip, after one extra ask', async () => {
    const ListingCard = await freshCard(Infinity)
    const view = render(<RouteError><ListingCard listing={listing('a')} onOpen={vi.fn()} /></RouteError>)
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(view.queryByText(ROUTE_ERROR)).toBeNull()
    expect(view.getByText('Clip card a')).toBeTruthy()
    expect(view.container.querySelector('img')).toBeTruthy()
    expect(view.queryByTestId('clip')).toBeNull()
    expect(clip.asks).toBe(2) // the first ask and one retry, never a loop

    // The rejection is kept for the page's life: a card that mounts later (the next page of the feed) throws at once,
    // and is caught the same way.
    view.rerender(
      <RouteError>
        <ListingCard listing={listing('a')} onOpen={vi.fn()} />
        <ListingCard listing={listing('b')} onOpen={vi.fn()} />
      </RouteError>,
    )
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(view.queryByText(ROUTE_ERROR)).toBeNull()
    expect(view.getByText('Clip card b')).toBeTruthy()
    expect(clip.asks).toBe(2)
  })

  it('back within 1.5 s: the second ask brings the clip', async () => {
    const ListingCard = await freshCard(1)
    const view = render(<RouteError><ListingCard listing={listing('a')} onOpen={vi.fn()} /></RouteError>)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(clip.asks).toBe(1)
    expect(view.queryByTestId('clip')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(clip.asks).toBe(2)
    expect(view.getByTestId('clip').getAttribute('data-src')).toBe('/clips/a.mp4')
    expect(view.queryByText(ROUTE_ERROR)).toBeNull()
  })

  it('a chunk that loads first time is asked for once and plays', async () => {
    const ListingCard = await freshCard(0)
    const view = render(<RouteError><ListingCard listing={listing('a')} onOpen={vi.fn()} /></RouteError>)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(view.getByTestId('clip')).toBeTruthy()
    expect(clip.asks).toBe(1)
  })
})
