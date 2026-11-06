// @vitest-environment jsdom
/**
 * ⛔ THE ROW IS A LINK (owner, 2026-11-07: "on desktop clicking right and opening in new tab doesnt work"). The list
 * view's row was a clickable div with no href in it: no right-click "Open link in new tab", no Cmd/Ctrl or middle click,
 * no keyboard stop. A real <a> is stretched over it now, with the actions and the chips above it. Pinned here:
 *   · the link goes to the listing and is named by the title;
 *   · a plain click is prevented on the link and opens the listing in the app once;
 *   · a modified click is the browser's: not prevented, and the row does not open it too;
 *   · the actions sit above the link, and a tap on one opens nothing.
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('next/image', () => ({
  // eslint-disable-next-line jsx-a11y/alt-text
  default: ({ fill: _f, priority: _p, unoptimized: _u, quality: _q, fetchPriority: _fp, ...rest }: Record<string, unknown>) => <img {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />,
}))
vi.mock('@/components/ui/icons', () => {
  const Icon = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />
  return { ArrowRight: Icon, MapPin: Icon, MessageCircle: Icon, Tag: Icon, Zap: Icon }
})
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', t: (k: string) => k, tr: (en: string) => en }),
  Tr: ({ text }: { text: string }) => text,
}))
vi.mock('./listing-content', () => ({ useLocalized: (title: string) => title }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn: vi.fn() }) }))
vi.mock('./partner-badge', () => ({ PartnerBadge: () => <span data-partner-chip="" /> }))
vi.mock('./trust-score', () => ({ TrustScore: () => <span data-trust-chip="" /> }))
vi.mock('./favorite-heart', () => ({ FavoriteHeart: () => null }))
vi.mock('./price', () => ({ Price: ({ price }: { price: number }) => <span>{price}</span> }))
vi.mock('./category-icons', () => ({ CategoryIcon: () => null }))
vi.mock('@/components/marketplace/eno-slider', () => ({ EnoSlider: () => null }))
vi.mock('@/lib/quick-contact', () => ({ stashQuickCompose: () => false, quickActionSignIn: () => ({}) }))

import { CompactListingRow } from './compact-listing-row'

const BASE = {
  id: 'l1',
  title: 'Laptop',
  titleVi: null,
  titleI18n: null,
  images: ['https://picsum.photos/seed/a/400'],
  video: null,
  price: 12_000_000,
  currency: '₫',
  priceUnit: 'VND',
  listingType: 'sell',
  location: 'Hồ Chí Minh',
  condition: null,
  savedCount: 0,
  contactCount: 0,
  negotiable: true,
  isPartnerBooking: true,
  isSponsored: true,
  sellerId: 'partner-seller-1',
  seller: { trustScore: 100, isBusiness: true, officialPartner: true },
  category: { icon: 'phone', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' },
  postedAt: '2026-09-20T00:00:00.000Z',
} as unknown as SerializedListingCard

const ROW = { ...BASE, isPartnerBooking: false, isSponsored: false, seller: { trustScore: 60, isBusiness: false, officialPartner: false } } as unknown as SerializedListingCard

function renderRow() {
  const onOpen = vi.fn()
  const view = render(<CompactListingRow listing={ROW} index={0} onOpen={onOpen} onPrefetch={() => {}} onLocate={() => {}} />)
  const link = view.container.querySelector<HTMLAnchorElement>('a[data-row-link]')!
  return { onOpen, link, view }
}

function browserSees() {
  const seen: boolean[] = []
  const on = (e: Event) => { seen.push(e.defaultPrevented); e.preventDefault() }
  document.addEventListener('click', on)
  return { seen, off: () => document.removeEventListener('click', on) }
}

afterEach(cleanup)

describe('CompactListingRow — the row is a link', () => {
  it('links to the listing, named by its title, over the row', () => {
    const { link } = renderRow()
    expect(link.getAttribute('href')).toBe('/listings/l1')
    expect(link.getAttribute('aria-label')).toBe('Laptop')
    expect(link.className).toContain('absolute inset-0 z-[1]')
  })

  it('a plain click is prevented and opens the listing in the app once', () => {
    const { onOpen, link } = renderRow()
    const b = browserSees()
    fireEvent.click(link)
    b.off()
    expect(b.seen).toEqual([true])
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it.each([[{ metaKey: true }], [{ ctrlKey: true }], [{ shiftKey: true }]])('a modified click %j is the browser\'s: not prevented, not opened here', (mod) => {
    const { onOpen, link } = renderRow()
    const b = browserSees()
    fireEvent.click(link, mod)
    b.off()
    expect(b.seen).toEqual([false])
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('the actions sit above the link, and a tap on one opens nothing', () => {
    const { onOpen } = renderRow()
    const chat = screen.getByRole('button', { name: 'Chat with seller' })
    const cluster = chat.closest('div.relative')!
    expect(cluster.className).toContain('z-[2]')
    fireEvent.click(chat)
    expect(onOpen).not.toHaveBeenCalled()
  })
})
