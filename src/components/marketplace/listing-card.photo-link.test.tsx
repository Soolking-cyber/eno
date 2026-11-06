// @vitest-environment jsdom
/**
 * ⛔ THE PHOTO IS A LINK (owner, 2026-11-07: "on desktop clicking right and opening in new tab doesnt work").
 *
 * The photo covers ~70% of a card and had no href: the card link sits UNDER it, so a right-click there gave the photo's
 * own menu, which ImageShield blocked outright. A transparent <a data-photo-link> now lies over the photo and under every
 * control. These pin its contract:
 *   · it is a real link to the listing, out of the tab order and hidden from assistive tech (the card link is the stop);
 *   · a plain click is prevented on the link and opens the listing in the app once (through the media box);
 *   · any other click (Cmd, Ctrl, Shift, Alt, the middle button) is left to the browser: not prevented, no onOpen, and
 *     no window.open from the box's fallback, which would open a second tab;
 *   · the hover zones live inside it, so a right-click on a zone is still the link's.
 */
import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
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
  const media = view.container.querySelector<HTMLElement>('[data-rail-media]')!
  const photo = view.container.querySelector<HTMLAnchorElement>('a[data-photo-link]')!
  return { onOpen, media, photo }
}

/** What the browser would see after React's handlers ran: recorded on the document, then prevented so jsdom does not try to navigate. */
function browserSees(type: 'click' | 'auxclick') {
  const seen: boolean[] = []
  const on = (e: Event) => { seen.push(e.defaultPrevented); e.preventDefault() }
  document.addEventListener(type, on)
  return { seen, off: () => document.removeEventListener(type, on) }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('ListingCard — the photo is a link', () => {
  it('is a real link to the listing over the photo, out of the tab order and the accessibility tree', () => {
    const { media, photo } = renderCard()
    expect(photo).toBeTruthy()
    expect(media.contains(photo)).toBe(true)
    expect(photo.getAttribute('href')).toBe('/listings/l1')
    expect(photo.tabIndex).toBe(-1)
    expect(photo.getAttribute('aria-hidden')).toBe('true')
    expect(photo.getAttribute('draggable')).toBe('false')
    // Over the photo, under the controls (z-10+).
    expect(photo.className).toContain('absolute inset-0 z-[1]')
  })

  it('a plain click is taken over: prevented, and the listing opens in the app once', () => {
    const { onOpen, photo } = renderCard()
    const b = browserSees('click')
    fireEvent.click(photo)
    b.off()
    expect(b.seen).toEqual([true])
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(LISTING)
  })

  it.each([
    ['Cmd', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
  ])('a %s click is the browser\'s: not prevented, no onOpen, no second tab from window.open', (_k, mod) => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { onOpen, photo } = renderCard()
    const b = browserSees('click')
    fireEvent.click(photo, mod)
    b.off()
    expect(b.seen).toEqual([false])
    expect(onOpen).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('a middle click is the browser\'s too: not prevented, and the box does not open another tab', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { onOpen, photo } = renderCard()
    const b = browserSees('auxclick')
    fireEvent(photo, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))
    b.off()
    expect(b.seen).toEqual([false])
    expect(onOpen).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('holds the hover zones, so a right-click on a zone is still the link\'s', () => {
    const { photo } = renderCard()
    const zones = photo.querySelectorAll('span.pointer-events-auto')
    expect(zones.length).toBe(2) // two photos, two slots
    for (const z of zones) expect(z.closest('a[href]')).toBe(photo)
  })
})
