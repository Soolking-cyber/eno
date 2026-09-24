// @vitest-environment jsdom
/**
 * ⛔ A TAPPED CARD SHOWED NOTHING FOR 0.5–2.3s.
 *
 * `onOpen` is a router push; the PDP's first frame measured 0.5–0.7s after the tap at 1x CPU and up to 2.3s at 4x,
 * and the card's `active:` press released at touchend (~110ms) — so the frame at +250ms was identical to the one
 * before the tap. The card now holds a `data-pending` state (pressed scale + dimmed photo) from the tap until the
 * route replaces it. These tests pin WHO may set it:
 *   · the stretched card link and the photo — the two navigating paths — set it and call onOpen exactly once;
 *   · the save heart (an in-card <button>) sets neither: it does not navigate, so it must not look like it does;
 *   · a second tap while it is opening does not push the route again;
 *   · a modifier click opens a new tab — this page is going nowhere, so no pending;
 *   · it clears itself if the navigation never lands.
 *
 * The card's children that are not under test (badges, price, trust chip, tooltips) are stubbed: they drag in
 * the generated icon sprite and contexts, and none of them takes part in the tap.
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

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('ListingCard — a tap is acknowledged until the next screen paints', () => {
  it('clicking the card link sets data-pending and calls onOpen once', () => {
    const { onOpen, root, link } = renderCard()
    expect(root.hasAttribute('data-pending')).toBe(false)
    fireEvent.click(link)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(LISTING)
    expect(root.hasAttribute('data-pending')).toBe(true)
  })

  it('a second tap while the first is still opening does not push the route again', () => {
    const { onOpen, root, link, media } = renderCard()
    fireEvent.click(link)
    fireEvent.click(link)
    fireEvent.click(media)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(root.hasAttribute('data-pending')).toBe(true)
  })

  it('clicking the photo sets data-pending and calls onOpen once', () => {
    const { onOpen, root, media } = renderCard()
    fireEvent.click(media)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(root.hasAttribute('data-pending')).toBe(true)
  })

  it('clicking the save heart does neither', () => {
    const { onOpen, root, heart } = renderCard()
    fireEvent.click(heart)
    expect(onOpen).not.toHaveBeenCalled()
    expect(root.hasAttribute('data-pending')).toBe(false)
  })

  it('a modifier click (new tab) does not mark this card as opening', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { onOpen, root, link, media } = renderCard()
    // The real href would try to navigate jsdom's document; the browser's new-tab default is not under test.
    link.addEventListener('click', (e) => e.preventDefault())
    fireEvent.click(link, { metaKey: true })
    fireEvent.click(media, { ctrlKey: true })
    expect(onOpen).not.toHaveBeenCalled()
    expect(root.hasAttribute('data-pending')).toBe(false)
    open.mockRestore()
  })

  it('carries the pressed scale and the dimmed photo as classes keyed on data-pending', () => {
    const { root, media } = renderCard()
    expect(root.className).toContain('data-pending:scale-[0.97]')
    // The press guard for in-card buttons survives alongside it.
    expect(root.className).toContain('has-[button:active]:scale-100')
    expect(media.className).toContain('group-data-pending:opacity-80')
  })

  it('lets go on its own if the navigation never lands', () => {
    vi.useFakeTimers()
    const { root, link } = renderCard()
    fireEvent.click(link)
    expect(root.hasAttribute('data-pending')).toBe(true)
    act(() => { vi.advanceTimersByTime(3_900) })
    expect(root.hasAttribute('data-pending')).toBe(true)
    act(() => { vi.advanceTimersByTime(200) })
    expect(root.hasAttribute('data-pending')).toBe(false)
  })
})
