// @vitest-environment jsdom
/**
 * ⛔ /c/jobs ON A PHONE: THE HEADING LINE CARRIES THE LIST'S TWO CONTROLS (owner-approved 2026-11-14, cook r06 jobs — SellerListings
 * `phoneHead`, passed by (index)/page.tsx on /c/jobs only). Pinned here:
 *   · the heading block is the first visible thing, `sm:hidden`, in the flow (not sticky): heading → sort → Filters → subhead;
 *   · the sort is the SAME CustomSelect, icon-only (its words sr-only, still its name; no ⌄), the ink fill for a non-default sort;
 *   · the pinned strip is `max-sm:hidden` (from sm pinned as before) and carries no sort pill and no phone count;
 *   · exactly one announced count (the sr-only live copy), none printed below sm;
 *   · with nothing to sort the heading still renders, without the controls;
 *   · without the prop nothing of it renders.
 */
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'

vi.mock('@/hooks/use-hide-on-scroll', () => ({ useHideOnScroll: () => false }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en }),
  Tr: ({ text }: { text: string }) => <>{text}</>,
}))
vi.mock('./listing-card', () => ({
  ListingCard: ({ listing }: { listing: SerializedListingCard }) => <article data-testid="card">{listing.title}</article>,
}))

const { SellerListings } = await import('./seller-listings')
const job = (id: string): SerializedListingCard =>
  ({ id, title: id, titleVi: null, price: 0, location: 'Hanoi', district: null, postedAt: '2026-09-01T00:00:00.000Z', contactCount: 0, sellerId: `s-${id}` } as unknown as SerializedListingCard)
const JOBS = Array.from({ length: 8 }, (_, i) => job(`j${i}`))
const Row = ({ listing }: { listing: SerializedListingCard }) => <div data-testid="row">{listing.id}</div>
const WORDS = { heading: 'Jobs in Vietnam', filters: 'Filters', cities: 'cities' }
const HEAD = {
  heading: <p aria-hidden data-head="">{WORDS.heading}</p>,
  end: <a href="/?category=jobs" data-filters="">{WORDS.filters}</a>,
  subhead: <div role="group" data-cities="">{WORDS.cities}</div>,
}

afterEach(cleanup)

const renderHead = (props: Record<string, unknown> = {}) => render(
  <SellerListings listings={JOBS} phoneRow={Row} sortable pinStrip serverScope={{ params: { category: 'jobs' }, total: 54, pageSize: 8 }} phoneHead={HEAD} {...props} />,
).container

describe('SellerListings phoneHead', () => {
  it('opens on the heading block, in the flow, phones only: heading → sort → Filters → cities, then the strip and the rows', () => {
    const c = renderHead()
    const root = c.querySelector('[data-listings-ready], .space-y-4')!
    const visible = Array.from(root.children).filter((e) => !e.classList.contains('sr-only'))
    const head = visible[0] as HTMLElement
    expect(head.className.split(' ')).toEqual(['sm:hidden'])
    expect(head.querySelector('[data-pinned-strip]')).toBeNull()
    const order = Array.from(head.querySelectorAll('[data-head], [role="combobox"], [data-filters], [data-cities]')).map((e) =>
      e.hasAttribute('data-head') ? 'heading' : e.getAttribute('role') === 'combobox' ? 'sort' : e.hasAttribute('data-filters') ? 'filters' : 'cities')
    expect(order).toEqual(['heading', 'sort', 'filters', 'cities'])
    // The heading's cell centres its line on the 44px controls; nothing truncates it.
    expect(head.querySelector('[data-head]')!.parentElement!.className.split(' ')).toEqual(expect.arrayContaining(['min-h-11', 'min-w-0', 'flex-1', 'items-center']))
    expect(head.querySelector('[data-head]')!.parentElement!.outerHTML.replace(/<p[^]*<\/p>/, '')).not.toMatch(/truncate|line-clamp/)
  })

  it('the sort is the same select, icon-only: its words sr-only and still its name, no ⌄, a 44px round button', () => {
    const c = renderHead()
    const sort = c.querySelector('.sm\\:hidden [role="combobox"]') as HTMLElement
    expect(sort.className.split(' ')).toEqual(expect.arrayContaining(['size-11', 'rounded-full', 'justify-center', 'px-0']))
    const label = sort.querySelector('.sr-only')!
    expect(label.textContent).toBe('Relevance')
    // aria-labelledby = the hidden "Sort by" label + the trigger itself (whose sr-only words count).
    const ids = sort.getAttribute('aria-labelledby')!.split(' ')
    expect(document.getElementById(ids[0])!.textContent).toBe('Sort by')
    expect(ids[1]).toBe(sort.id)
    // One glyph: the sort's own, no disclosure chevron.
    expect(sort.querySelectorAll('svg')).toHaveLength(1)
  })

  it('the pinned strip leaves the phone and carries neither the pill nor the phone count; one announced count', () => {
    const c = renderHead()
    const bar = c.querySelector('[data-pinned-strip]')!
    expect(bar.className.split(' ')).toContain('max-sm:hidden')
    expect(bar.querySelector('[role="combobox"]')).toBeNull()
    expect(bar.querySelector('[aria-live]')).toBeNull()
    const live = Array.from(c.querySelectorAll('[aria-live]'))
    // The sr-only phone copy and the sm+ sentence (max-sm:hidden): one per width.
    expect(live).toHaveLength(2)
    expect(live[0].className.split(' ')).toEqual(['sr-only', 'sm:hidden'])
    expect(live[0].textContent).toMatch(/8 of 54/)
    expect(live[1].className.split(' ')).toContain('max-sm:hidden')
  })

  it('with nothing to sort the heading still renders, without the controls', () => {
    const c = render(<SellerListings listings={[job('only')]} phoneRow={Row} pinStrip serverScope={{ params: { category: 'jobs' }, total: 1, pageSize: 8 }} phoneHead={HEAD} />).container
    expect(c.querySelector('[data-head]')).not.toBeNull()
    expect(c.querySelector('[data-cities]')).not.toBeNull()
    expect(c.querySelector('[role="combobox"]')).toBeNull()
    expect(c.querySelector('[data-filters]')).toBeNull()
    expect(c.querySelector('[data-head]')!.closest('.sm\\:hidden')).not.toBeNull()
  })

  it('without the prop nothing of it renders: the pill and the phone count stay in the strip', () => {
    const c = render(<SellerListings listings={JOBS} phoneRow={Row} sortable pinStrip serverScope={{ params: { category: 'jobs' }, total: 54, pageSize: 8 }} />).container
    expect(c.querySelector('[data-head]')).toBeNull()
    const bar = c.querySelector('[data-pinned-strip]')!
    expect(bar.className).not.toContain('max-sm:hidden')
    expect(bar.querySelector('[role="combobox"]')).not.toBeNull()
    expect(bar.querySelector('[aria-live]')).not.toBeNull()
  })
})
