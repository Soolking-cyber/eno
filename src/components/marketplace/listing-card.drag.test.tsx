// @vitest-environment jsdom
/**
 * ⛔ THE CARD'S PHOTO STRIP FOLLOWS THE FINGER (Emil audit, tier 3). A swipe was judged only at touchend, so a drag
 * moved the photo 0px and then it jumped. A sideways drag now moves the strip with the finger (rubber-banded at the
 * ends), and touchend releases it to wherever the swipe rule lands. A vertical drag (the feed scrolling) never moves
 * it, and a sideways drag is never also a tap. Harness after listing-card.pending.test.tsx.
 */
import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
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
  useFavorites: () => ({ isFavorite: () => false, toggle: vi.fn(), savedDelta: () => 0 }),
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

import { ListingCard } from './listing-card'

const LISTING = {
  id: 'l1',
  title: 'Honda Wave 110',
  titleVi: null,
  titleI18n: null,
  images: ['https://picsum.photos/seed/a/400', 'https://picsum.photos/seed/b/400'],
  video: null,
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
} as unknown as SerializedListingCard

function renderCard() {
  const onOpen = vi.fn()
  const view = render(<ListingCard listing={LISTING} onOpen={onOpen} />)
  const root = view.container.querySelector<HTMLElement>('[data-card-root]')!
  const link = view.container.querySelector<HTMLAnchorElement>('a[data-card-link]')!
  const media = view.container.querySelector<HTMLElement>('[data-rail-media]')!
  const heart = view.getByRole('button', { name: 'Save listing' })
  return { onOpen, root, link, media, heart }
}

afterEach(() => { cleanup() })

const t = (x: number, y = 100) => [{ clientX: x, clientY: y, identifier: 1 }]
function drag(media: HTMLElement, xs: number[], y = 100) {
  act(() => { fireEvent.touchStart(media, { touches: t(200, 100), changedTouches: t(200, 100) }) })
  for (const x of xs) act(() => { fireEvent.touchMove(media, { touches: t(x, y), changedTouches: t(x, y) }) })
}
const end = (media: HTMLElement, x: number, y = 100) => act(() => { fireEvent.touchEnd(media, { touches: [], changedTouches: t(x, y) }) })

describe('ListingCard — the photo strip follows the finger', () => {
  it('⛔ a sideways drag moves the strip with the finger, with no transition while it does', () => {
    const { media } = renderCard()
    const strip = media.querySelector<HTMLElement>('[data-card-strip]')!
    drag(media, [190, 170])
    expect(strip.style.transform).toBe('translateX(calc(0% + -30px))')
    expect(strip.style.transition).toBe('none')
  })

  it('released past the swipe rule, it goes on to the next photo under the transition', () => {
    const { media } = renderCard()
    const strip = media.querySelector<HTMLElement>('[data-card-strip]')!
    drag(media, [190, 170, 140])
    end(media, 140)
    expect(strip.style.transition).toBe('')
    expect(strip.style.transform).toBe('translateX(-100%)')
  })

  it('released short of it, it goes back to its own photo', () => {
    const { media } = renderCard()
    const strip = media.querySelector<HTMLElement>('[data-card-strip]')!
    drag(media, [190, 180])
    end(media, 180)
    expect(strip.style.transform).toBe('translateX(-0%)')
  })

  it('before the first photo it gives (rubber band) rather than tracking the finger 1:1', () => {
    const { media } = renderCard()
    const strip = media.querySelector<HTMLElement>('[data-card-strip]')!
    drag(media, [210, 260])
    const px = Number(/\+ (-?[\d.]+)px/.exec(strip.style.transform)![1])
    expect(px).toBeGreaterThan(0)
    expect(px).toBeLessThan(60)
  })

  it('⛔ a vertical drag (the feed scrolling) never moves the strip', () => {
    const { media } = renderCard()
    const strip = media.querySelector<HTMLElement>('[data-card-strip]')!
    drag(media, [198, 195], 100)
    act(() => { fireEvent.touchMove(media, { touches: t(196, 160), changedTouches: t(196, 160) }) })
    expect(strip.style.transition).toBe('')
    expect(strip.style.transform).toBe('translateX(-0%)')
  })

  it('⛔ a sideways drag that comes back is not a tap: the release does not open the listing', () => {
    const { media, onOpen } = renderCard()
    drag(media, [180, 199])
    end(media, 199)
    fireEvent.click(media)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('⛔ a gesture locked vertical never pages at the release, however far it drifted sideways after the lock', () => {
    const { media } = renderCard()
    const strip = media.querySelector<HTMLElement>('[data-card-strip]')!
    drag(media, [199], 100)
    act(() => { fireEvent.touchMove(media, { touches: t(198, 115), changedTouches: t(198, 115) }) }) // locks vertical
    act(() => { fireEvent.touchMove(media, { touches: t(120, 120), changedTouches: t(120, 120) }) }) // then sideways
    end(media, 120, 120)
    expect(strip.style.transform).toBe('translateX(-0%)')
  })

  it('⛔ a drag that starts on a diagonal does not move the strip until it is clearly sideways (a thumb scroll\'s arc)', () => {
    const { media } = renderCard()
    const strip = media.querySelector<HTMLElement>('[data-card-strip]')!
    act(() => { fireEvent.touchStart(media, { touches: t(200, 100), changedTouches: t(200, 100) }) })
    act(() => { fireEvent.touchMove(media, { touches: t(191, 107), changedTouches: t(191, 107) }) }) // dx 9, dy 7: undecided
    expect(strip.style.transition).toBe('')
    act(() => { fireEvent.touchMove(media, { touches: t(160, 110), changedTouches: t(160, 110) }) }) // dx 40, dy 10: sideways
    expect(strip.style.transform).toBe('translateX(calc(0% + -40px))')
  })

  it('a diagonal swipe that still leads horizontally locks sideways by 24px — it follows, never jumps at release', () => {
    const { media } = renderCard()
    const strip = media.querySelector<HTMLElement>('[data-card-strip]')!
    act(() => { fireEvent.touchStart(media, { touches: t(200, 100), changedTouches: t(200, 100) }) })
    act(() => { fireEvent.touchMove(media, { touches: t(185, 110), changedTouches: t(185, 110) }) }) // dx 15, dy 10: undecided
    expect(strip.style.transition).toBe('')
    act(() => { fireEvent.touchMove(media, { touches: t(170, 118), changedTouches: t(170, 118) }) }) // dx 30, dy 18: leads, ≥24
    expect(strip.style.transform).toBe('translateX(calc(0% + -30px))')
  })

  it('⛔ a sloppy tap that slid under the tap slop still opens the listing', () => {
    const { media, onOpen } = renderCard()
    drag(media, [188]) // 12px sideways: locks and nudges the strip, but browsers still call this a tap
    end(media, 188)
    fireEvent.click(media)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('a fast flick that ends before the lock still pages (nothing locked it vertical)', () => {
    const { media } = renderCard()
    const strip = media.querySelector<HTMLElement>('[data-card-strip]')!
    act(() => { fireEvent.touchStart(media, { touches: t(200), changedTouches: t(200) }) })
    end(media, 150)
    expect(strip.style.transform).toBe('translateX(-100%)')
  })

  it('a touch the OS takes away (touchcancel) puts the strip back in its slot', () => {
    const { media } = renderCard()
    const strip = media.querySelector<HTMLElement>('[data-card-strip]')!
    drag(media, [190, 170])
    act(() => { fireEvent.touchCancel(media, { touches: [], changedTouches: t(170) }) })
    expect(strip.style.transform).toBe('translateX(-0%)')
    expect(strip.style.transition).toBe('')
  })
})
