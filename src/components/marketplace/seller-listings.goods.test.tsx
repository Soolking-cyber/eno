// @vitest-environment jsdom
/**
 * ⛔ A GOODS CATEGORY ON A PHONE (owner-approved 2026-11-14, cook r06 goods: "after this cook round build all best options and
 * deploy"; SellerListings `look="goods"`, (index)/page.tsx `goods`): no rule under the strip (transparent, its 1px kept), the
 * sort pill's words alone at the page's own order, the count muted at the strip's end, 12px from the strip to the grid, and the
 * goods cards in rows 40px apart (build 8; 20 in build 7, 32 in r06). ⛔ Since build 8 (owner-approved 2026-11-15, cook r08
 * goods) the strip STAYS PINNED, its pills are FILLED (`data-pills`), and its hairline is back once it is stuck (`data-stuck`).
 * ⛔ Since 2026-11-16 (owner, hub Q15) the filled pills, the hairline only while stuck and the words-alone sort pill are every
 * PINNED strip's (`pinStrip`, the /c pages), with or without the look; a strip that never pins is as before.
 * Every class `max-sm:`; without the look and without `pinStrip` nothing changes.
 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SerializedListingCard } from '@/lib/types'
import { LISTING_GRID } from './listing-grid'

const hidden = vi.hoisted(() => ({ value: false }))
const stuckNow = vi.hoisted(() => ({ value: false, on: [] as boolean[] }))
vi.mock('@/hooks/use-stuck', () => ({ useStuck: (_ref: unknown, on = true) => { stuckNow.on.push(on); return on && stuckNow.value } }))
const cards = vi.hoisted(() => ({ props: [] as Record<string, unknown>[], skeletons: [] as Record<string, unknown>[] }))
vi.mock('@/hooks/use-hide-on-scroll', () => ({ useHideOnScroll: () => hidden.value }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en }),
  Tr: ({ text }: { text: string }) => <>{text}</>,
}))
vi.mock('./listing-card', () => ({
  ListingCard: (p: { listing: SerializedListingCard } & Record<string, unknown>) => { cards.props.push(p); return <article data-testid="card">{p.listing.title}</article> },
}))
vi.mock('./listing-card-skeleton', () => ({
  ListingCardSkeleton: (p: Record<string, unknown>) => { cards.skeletons.push(p); return <div data-skeleton="" /> },
}))

const { SellerListings } = await import('./seller-listings')
const card = (id: string): SerializedListingCard =>
  ({ id, title: id, titleVi: null, price: 1_000_000, location: 'Ho Chi Minh City', district: 'District 1', postedAt: '2026-09-01T00:00:00.000Z', contactCount: 0, sellerId: 's' } as unknown as SerializedListingCard)
const MANY = Array.from({ length: 10 }, (_, i) => card(`r${i}`))
const SCOPE = { params: { category: 'electronics' }, total: 64, pageSize: 10 }
const tokens = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
/** The cards' grid: the element whose class list is one of the two grid strings. */
const grid = (c: HTMLElement) => [...c.querySelectorAll('div')].find((d) => d.className.startsWith(LISTING_GRID))!

afterEach(() => { cleanup(); hidden.value = false; stuckNow.value = false; stuckNow.on = []; cards.props = []; cards.skeletons = []; vi.unstubAllGlobals() })
const drawn = () => cards.props.slice(-MANY.length)
const goods = () => render(<SellerListings listings={MANY} sortable pinStrip serverScope={SCOPE} look="goods" />)

describe('SellerListings look="goods"', () => {
  it('the strip keeps its hairline\'s 1px but paints it transparent below sm; the pinned bar stays the page\'s white', () => {
    const { container } = goods()
    const bar = container.querySelector('[data-pinned-strip]')!
    expect(tokens(bar)).toContain('bg-background')
    const tabs = bar.querySelector('[data-slot="tabs"]')!
    expect(tokens(tabs)).toEqual(expect.arrayContaining(['border-b', 'border-border', 'max-sm:border-b-transparent']))
  })

  it('the sort pill has no glyph at the page\'s own order ("Relevance ⌄")', () => {
    goods()
    const pill = screen.getByRole('combobox', { name: /Sort by/ })
    expect(pill.textContent).toContain('Relevance')
    expect(pill.querySelectorAll('svg')).toHaveLength(1) // the ⌄ alone
  })

  it('the count at the strip\'s end is the meta role, muted — never under 13px', () => {
    const { container } = goods()
    const note = container.querySelector('[data-pinned-strip] p[aria-live]')!
    expect(tokens(note)).toEqual(expect.arrayContaining(['text-t-meta', 'text-muted-foreground', 'sm:hidden']))
    expect(tokens(note)).not.toContain('text-xs')
  })

  it('⛔ 12px from the strip to the grid; rows 40px apart (build 8, owner-approved 2026-11-15, cook r08 goods; 20 in build 7); every card and placeholder takes the goods look', () => {
    const { container } = goods()
    const root = container.querySelector('.space-y-4')!
    expect(tokens(root)).toContain('max-sm:space-y-3')
    expect(tokens(grid(container))).toContain('max-sm:gap-y-10')
    expect(tokens(grid(container))).not.toContain('max-sm:gap-y-5')
    expect(drawn()).toHaveLength(10)
    for (const p of drawn()) expect(p.look).toBe('goods')
  })

  it('without the look: the 12px count and the shell cards as before, and the strip leaves with the header', () => {
    const { container } = render(<SellerListings listings={MANY} sortable pinStrip serverScope={SCOPE} />)
    expect(tokens(grid(container))).not.toContain('max-sm:gap-y-10')
    for (const p of drawn()) expect(p.look).toBeUndefined()
    const bar = container.querySelector('[data-pinned-strip]')!
    expect(bar.hasAttribute('data-stay-pinned')).toBe(false)
  })

  it('⛔ every pinned strip, with or without the look (owner, 2026-11-16, hub Q15): filled, its rule only once stuck, "Relevance" with no ⇅', () => {
    const { container } = render(<SellerListings listings={MANY} sortable pinStrip serverScope={SCOPE} />)
    const bar = container.querySelector('[data-pinned-strip]')!
    expect(bar.getAttribute('data-pills')).toBe('filled')
    expect(tokens(bar)).toContain('group/pin')
    expect(stuckNow.on).toContain(true)
    expect(tokens(container.querySelector('[data-slot="tabs"]'))).toEqual(expect.arrayContaining(['max-sm:border-b-transparent', 'max-sm:group-data-[stuck]/pin:border-b-border']))
    const pill = screen.getByRole('combobox', { name: /Sort by/ })
    expect(pill.textContent).toBe('Relevance')
    expect(pill.querySelectorAll('svg')).toHaveLength(1) // the ⌄ alone
    expect(tokens(pill)).toContain('pill-rest')
  })

  it('a strip that never pins (storefronts, vehicle hubs) is as before: its rule (nothing to be stuck to), and its muted ⇅ at its own order', () => {
    const { container } = render(<SellerListings listings={MANY} sortable serverScope={SCOPE} />)
    expect(container.querySelector('[data-pinned-strip]')).toBeNull()
    expect(tokens(container.querySelector('[data-slot="tabs"]'))).not.toContain('max-sm:border-b-transparent')
    const pill = screen.getByRole('combobox', { name: /Sort by/ })
    expect(pill.textContent).toBe('Relevance')
    // ⚠️ Q15's words-alone pill is the pinned strips' (the /c pages); the storefront batch owns these strips.
    const glyphs = pill.querySelectorAll('svg')
    expect(glyphs).toHaveLength(2) // the ⇅ and the ⌄
    expect(tokens(glyphs[0])).toEqual(expect.arrayContaining(['size-3.5', 'text-ink-4']))
  })

  it('⛔ the strip stays pinned below sm while the header is hidden (build 8): it reverses the 08-12 rule on a goods category', () => {
    hidden.value = true
    const { container } = goods()
    const bar = container.querySelector('[data-pinned-strip]')!
    expect(bar.getAttribute('data-stay-pinned')).toBe('true')
    expect(tokens(bar)).toEqual(expect.arrayContaining(['top-[-9rem]', 'max-sm:top-[max(env(safe-area-inset-top),var(--safe-area-inset-top,0px))]']))
  })

  it('⛔ its pills are filled (build 8): the strip says so for globals.css, and the resting pills carry the rule\'s marker', () => {
    const { container } = goods()
    expect(container.querySelector('[data-pinned-strip]')!.getAttribute('data-pills')).toBe('filled')
    expect(tokens(screen.getByRole('combobox', { name: /Sort by/ }))).toContain('pill-rest')
  })

  it('⛔ once pinned over the grid the hairline is back (build 8): `data-stuck` on the strip, the rule\'s colour through `group/pin`', () => {
    const { container, rerender } = goods()
    const bar = () => container.querySelector('[data-pinned-strip]')!
    expect(tokens(bar())).toContain('group/pin')
    expect(bar().hasAttribute('data-stuck')).toBe(false)
    expect(tokens(bar().querySelector('[data-slot="tabs"]'))).toEqual(expect.arrayContaining(['max-sm:border-b-transparent', 'max-sm:group-data-[stuck]/pin:border-b-border']))
    stuckNow.value = true
    rerender(<SellerListings listings={MANY} sortable pinStrip serverScope={SCOPE} look="goods" />)
    expect(bar().getAttribute('data-stuck')).toBe('true')
    expect(stuckNow.on).toContain(true)
  })
})
