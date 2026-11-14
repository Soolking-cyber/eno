// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCategory, SerializedListingCard } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))
// The card is drawn as a marker carrying the props this file decides (lane, sizes), so a test can read them back.
vi.mock('./listing-card', () => ({
  ListingCard: ({ listing, lane, sizes }: { listing: { id: string }; lane?: boolean; sizes?: string }) => (
    <i data-card={listing.id} data-lane={lane ? '1' : '0'} data-sizes={sizes ?? ''} />
  ),
}))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en, t: (en: string) => en }) }))

import { CategoryLane, CategoryRails, visibleCategoryRails } from './category-rails'
import { LANE_CARD_SIZES } from './shelf'

/**
 * ⛔ THE RAILS COME FROM THE SERVER (owner-approved 2026-11-14, cook r04 home-b "lanes as rails" — category-rails.tsx has the
 * record). There is no request any more: which rails draw is a pure function of the server's props, so the server render and
 * hydration agree on every lane and its place, and a phone's lanes above the feed never arrive after the first paint.
 */
const cat = (slug: string) => ({ id: `c-${slug}`, slug, name: slug, nameVi: `vi-${slug}`, icon: 'Home' }) as unknown as SerializedCategory
const cats = ['rentals', 'jobs', 'services', 'fashion-beauty'].map(cat)
const listing = (id: string) => ({ id, title: id, sellerId: 's', images: [] }) as unknown as SerializedListingCard
const rail = (slug: string, ids: string[]) => ({ slug, listings: ids.map(listing) })

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('visibleCategoryRails — which rails draw, decided from props alone', () => {
  it('keeps the server order and drops the cards the rails above already showed', () => {
    const lanes = visibleCategoryRails([rail('rentals', ['a', 'b', 'c', 'd']), rail('services', ['e', 'f', 'g'])], cats, ['b'])
    expect(lanes.map((l) => [l.slug, l.items.map((i) => i.id)])).toEqual([['rentals', ['a', 'c', 'd']], ['services', ['e', 'f', 'g']]])
    expect(lanes[0].cat.slug).toBe('rentals')
  })
  it('hides a rail the dedup takes under the sparse floor (three)', () => {
    expect(visibleCategoryRails([rail('rentals', ['a', 'b', 'c'])], cats, ['a'])).toEqual([])
    expect(visibleCategoryRails([rail('rentals', ['a', 'b'])], cats)).toEqual([])
  })
  it('draws nothing for a slug this edition does not list', () => {
    expect(visibleCategoryRails([rail('visa', ['a', 'b', 'c', 'd'])], cats)).toEqual([])
  })
  it('none from the server is none', () => {
    expect(visibleCategoryRails([], cats, ['x'])).toEqual([])
  })
})

describe('CategoryRails (the shelves under the desktop feed)', () => {
  it('renders one rail per lane it is given, in order', () => {
    const lanes = visibleCategoryRails([rail('rentals', ['a', 'b', 'c']), rail('jobs', ['d', 'e', 'f'])], cats)
    const { container } = render(<CategoryRails lanes={lanes} onCategory={() => {}} />)
    expect([...container.querySelectorAll('section h2')].map((h) => h.textContent)).toEqual(['rentals', 'jobs'])
  })
  it('renders nothing for no lanes (no empty box in the shelves’ spacing)', () => {
    const { container } = render(<CategoryRails lanes={[]} onCategory={() => {}} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('CategoryLane — the phone lane look and its gate', () => {
  const lane = visibleCategoryRails([rail('rentals', ['a', 'b', 'c', 'd', 'e'])], cats)[0]

  it('`initialShow`: its cards are in the server HTML, as lane cards with the 220px phone sizes', () => {
    const html = renderToString(<CategoryLane cat={lane.cat} listings={lane.items} onCategory={() => {}} look="lane" initialShow />)
    expect(html.match(/data-card="/g)).toHaveLength(5)
    expect(html).toContain('data-lane="1"')
    expect(html).toContain(`data-sizes="${LANE_CARD_SIZES}"`)
    expect(LANE_CARD_SIZES.endsWith(', 220px')).toBe(true)
  })

  it('without it, the server sends the header and same-size placeholders, and the cards come when it nears the screen', async () => {
    const html = renderToString(<CategoryLane cat={lane.cat} listings={lane.items} onCategory={() => {}} look="lane" />)
    expect(html).not.toContain('data-card="')
    expect(html).toContain('<h2')
    let fire: ((e: { isIntersecting: boolean }[]) => void) | null = null
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: (e: { isIntersecting: boolean }[]) => void) { fire = cb }
      observe() {} unobserve() {} disconnect() {}
    })
    const { container } = render(<CategoryLane cat={lane.cat} listings={lane.items} onCategory={() => {}} look="lane" />)
    expect(container.querySelectorAll('[data-card]')).toHaveLength(0)
    await act(async () => { fire!([{ isIntersecting: true }]) })
    expect(container.querySelectorAll('[data-card]')).toHaveLength(5)
  })

  it('the lane classes are phone-only: 22/28 heading, no heading icon, 220px cards on a bled scroller', () => {
    const html = renderToString(<CategoryLane cat={lane.cat} listings={lane.items} onCategory={() => {}} look="lane" initialShow />)
    expect(html).toContain('max-sm:text-t-h2')
    expect(html).toMatch(/class="[^"]*max-sm:hidden[^"]*"/) // the heading's category icon
    expect(html).toContain('max-sm:w-55')
    expect(html).toContain('max-sm:-mx-3 max-sm:gap-3 max-sm:px-3 max-sm:scroll-px-3')
    // The rail look (desktop's shelves) carries none of them.
    const railHtml = renderToString(<CategoryLane cat={lane.cat} listings={lane.items} onCategory={() => {}} initialShow />)
    for (const c of ['max-sm:text-t-h2', 'max-sm:w-55', 'max-sm:-mx-3', '<section data-lane', 'data-lane="1"']) expect(railHtml).not.toContain(c)
  })

  it('hydrates the server HTML with no mismatch', async () => {
    const { hydrateRoot } = await import('react-dom/client')
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const recovered: unknown[] = []
    try {
      for (const initialShow of [true, false]) {
        const tree = <CategoryLane cat={lane.cat} listings={lane.items} onCategory={() => {}} look="lane" initialShow={initialShow} />
        const host = document.createElement('div')
        host.innerHTML = renderToString(tree)
        document.body.append(host)
        let root: ReturnType<typeof hydrateRoot> | undefined
        await act(async () => { root = hydrateRoot(host, tree, { onRecoverableError: (e) => recovered.push(e) }) })
        await act(async () => { root!.unmount() })
        host.remove()
      }
      expect(recovered).toEqual([])
      expect(error).not.toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
  })
})
