// @vitest-environment jsdom
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

/**
 * ⛔ THE STOREFRONT'S PHONE HEADER IS A STAT HEADER (UI climb r12, cook store-r12c S1; seller-card.tsx). Pinned: the cells are
 * built ONLY from facts the strip already shows, in its own words — the listing count ("listings on <site>" for a partner,
 * "listings" otherwise), the year over "Joined", the rating over "N reviews" only when the shop HAS reviews — each fact once
 * per width (the strip drops its stat leaves below sm, the cells are `sm:hidden`), the avatar 84px, the one <h1>, every size
 * a whole role of the closed scale, the facts line's reserve as the page decided it, the [Chat][Share][⋯] row (owner,
 * 2026-11-16 — hub Q21), and the PDP card untouched. ⚠️ vitest pins NEXT_PUBLIC_ENO_EDITION=services, so SITE_NAME is eno.forum here.
 */
let LANG = 'en'
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: LANG, tr: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : en), t: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : en), setLang: () => {} }),
  useTr: () => (en: string) => en,
  Tr: ({ text }: { text: string }) => text,
}))
vi.mock('@/hooks/use-mounted', () => ({ useMounted: () => false }))

import { SellerCard } from './seller-card'
import { SITE_NAME } from '@/lib/edition'
import type { SellerMetrics } from '@/lib/seller-metrics'

const base = { responseBucket: { key: null, en: '', vi: '' }, lastSeenDay: null, memberSinceYear: 2026, reviewCount: 0, rating: 0, trustScore: 80, trustTier: 'standard' }
const metrics = (over: Record<string, unknown> = {}) => ({ ...base, ...over }) as unknown as SellerMetrics
const seller = (over: Record<string, unknown> = {}) => ({ id: 's1', name: 'GoPlus', avatarColor: '#000', isBusiness: false, ...over })

function mount(props: Partial<React.ComponentProps<typeof SellerCard>> = {}) {
  const div = document.createElement('div')
  div.innerHTML = renderToString(<SellerCard variant="storefront" seller={seller()} metrics={metrics()} {...props} />).replaceAll('<!-- -->', '')
  return div
}
/** A stand-in for the page's Share, held in a constant for the i18n lint. */
const SHARE = 'Share'
const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const tokens = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)
const cells = (div: HTMLElement) => [...div.querySelectorAll('[data-store-stat]')].map((c) => c.getAttribute('data-store-stat'))
const cell = (div: HTMLElement, kind: string) => div.querySelector(`[data-store-stat="${kind}"]`)
/** The cell's two lines as drawn: the numeral (`order-first`) over its label. */
const lines = (el: Element | null) => {
  const spans = [...(el?.children ?? [])]
  const num = spans.find((s) => tokens(s).includes('order-first'))!
  return [text(num), ...spans.filter((s) => s !== num).map(text)]
}

describe('SellerCard storefront — the phone stat header (S1)', () => {
  it('a partner: "5,379" over "listings on <site>", "2026" over "Joined" — and no reviews cell without reviews', () => {
    const div = mount({ seller: seller({ officialPartner: true }), listingCount: 5379 })
    expect(cells(div)).toEqual(['listings', 'joined'])
    expect(lines(cell(div, 'listings'))).toEqual(['5,379', `listings on ${SITE_NAME}`])
    expect(lines(cell(div, 'joined'))).toEqual(['2026', 'Joined'])
    expect(div.querySelector('[data-store-stat="reviews"]')).toBeNull()
    expect(text(div)).not.toMatch(/review/i)
  })

  it('everyone else: the bare "listings" (one: "listing"); no count at all → no listings cell', () => {
    expect(lines(cell(mount({ listingCount: 2 }), 'listings'))).toEqual(['2', 'listings'])
    expect(lines(cell(mount({ listingCount: 1 }), 'listings'))).toEqual(['1', 'listing'])
    expect(cells(mount({ listingCount: 0 }))).toEqual(['joined'])
    expect(cells(mount())).toEqual(['joined'])
  })

  it('reviews only when the shop has them: the rating over "12 reviews" (one: "1 review")', () => {
    const div = mount({ metrics: metrics({ reviewCount: 12, rating: 4.8 }), listingCount: 3 })
    expect(cells(div)).toEqual(['listings', 'joined', 'reviews'])
    expect(lines(cell(div, 'reviews'))).toEqual(['4.8', '12 reviews'])
    expect(lines(cell(mount({ metrics: metrics({ reviewCount: 1, rating: 5 }) }), 'reviews'))).toEqual(['5.0', '1 review'])
  })

  it('Vietnamese: the strip\'s own words, split at the number ("Tham gia" under the year)', () => {
    LANG = 'vi'
    const div = mount({ seller: seller({ officialPartner: true }), listingCount: 5379 })
    LANG = 'en'
    expect(lines(cell(div, 'joined'))).toEqual(['2026', 'Tham gia'])
    // CountValue reads the language from the real context's default here; the words are what this pins.
    expect(lines(cell(div, 'listings'))[1]).toBe(`tin đăng trên ${SITE_NAME}`)
  })

  it('each fact once per width: the cells are phone-only, the strip drops the same leaves below sm', () => {
    const div = mount({ seller: seller({ officialPartner: true }), metrics: metrics({ reviewCount: 3, rating: 4.5, responseBucket: { key: 'day', en: 'Responds within a day', vi: 'Thường phản hồi trong ngày' } }), listingCount: 40 })
    expect(tokens(div.querySelector('[data-store-stats]'))).toContain('sm:hidden')
    const leaves = [...div.querySelectorAll('.overflow-x-clip > div > span')]
    const words = (l: Element) => text(l).replace(/^·\s*/, '') // the leaf's own separator dot
    const hiddenOnPhone = leaves.filter((l) => tokens(l).includes('max-sm:hidden')).map(words)
    expect(hiddenOnPhone).toEqual(['Joined 2026', '4.5 · 3 reviews', `40 listings on ${SITE_NAME}`])
    // The facts line keeps what is not a stat, at 14/20 on a phone.
    expect(leaves.filter((l) => !tokens(l).includes('max-sm:hidden')).map(words)).toEqual(['Responds within a day'])
    expect(tokens(div.querySelector('.overflow-x-clip > div'))).toEqual(expect.arrayContaining(['max-sm:text-sm', 'max-sm:min-h-5']))
  })

  it('the facts line: kept from the first paint only when the page says presence will be drawn; never an empty line', () => {
    const facts = (over: Partial<React.ComponentProps<typeof SellerCard>>) => tokens(mount(over).querySelector('.overflow-x-clip'))
    expect(facts({})).toContain('max-sm:hidden')
    // ⛔ A dormant shop (seen over 30 days ago, no response figure): the page decided on the server that nothing will arrive.
    expect(facts({ metrics: metrics({ lastSeenDay: '2026-09-01' }), presenceDue: false })).toContain('max-sm:hidden')
    expect(facts({ metrics: metrics({ lastSeenDay: '2026-11-16' }), presenceDue: true })).not.toContain('max-sm:hidden')
    // A response figure is drawn from the first paint whatever presence does.
    expect(facts({ metrics: metrics({ responseBucket: { key: 'day', en: 'Responds within a day', vi: 'Phản hồi trong ngày' } }), presenceDue: false })).not.toContain('max-sm:hidden')
    // A caller that does not decide keeps the old reading (any stored day).
    expect(facts({ metrics: metrics({ lastSeenDay: '2026-11-16' }) })).not.toContain('max-sm:hidden')
  })

  it('type on the closed scale: numerals in the price role whole (17/22, no leading override), the <h1> in the h2 role below sm', () => {
    const div = mount({ listingCount: 2 })
    const num = cell(div, 'joined')!.querySelector('.order-first')
    expect(tokens(num)).toEqual(expect.arrayContaining(['text-t-price', 'text-foreground']))
    expect(tokens(num).filter((t) => t.startsWith('leading-') || t.startsWith('text-t-h'))).toEqual([])
    const h1s = div.querySelectorAll('h1')
    expect(h1s).toHaveLength(1)
    // `!`: a layered role beats the unlayered `.h-title` only as important (its 1.22 would ride any size: 24/29.3).
    expect(tokens(h1s[0])).toEqual(expect.arrayContaining(['h-title', 'max-sm:text-t-h2!']))
    expect(div.innerHTML).not.toContain('--text-title')
  })

  it('the identity: an 84px avatar on a phone (64 from sm), its initials on the scale, one <h1> spanning the row', () => {
    const div = mount({ listingCount: 2 })
    const avatar = div.querySelector('span[title], span.flex.shrink-0')!.firstElementChild
    expect(tokens(avatar)).toEqual(expect.arrayContaining(['size-21', 'text-t-display', 'sm:size-16', 'sm:text-t-h3']))
    expect(tokens(avatar).filter((t) => /^(sm:)?text-(lg|xl|2xl|base)$/.test(t))).toEqual([])
    expect(tokens(div.querySelector('h1')!.closest('.min-w-0.flex-1'))).toContain('max-sm:col-span-2')
  })

  it('S2: with the page\'s `actions`, the row is [Chat now][actions] — Chat an equal pair member; without them, Chat alone as before', () => {
    const withActions = mount({ onChat: () => {}, actions: <button type="button" data-testid="share">{SHARE}</button> })
    const row = withActions.querySelector('[data-store-actions]')!
    expect([...row.children].map((c) => c.textContent?.trim())).toEqual(['Chat now', SHARE])
    expect(tokens(row.children[0])).toEqual(expect.arrayContaining(['min-h-11', 'flex-1', 'rounded-xl']))
    expect(tokens(row.children[0])).not.toContain('px-8')
    // 16px from the identity to the row on a phone (cook store-r12c S2); 12 from sm.
    expect(tokens(withActions.firstElementChild)).toEqual(expect.arrayContaining(['flex-col', 'gap-3', 'max-sm:gap-4']))
    const alone = mount({ onChat: () => {} })
    // ⛔ Alone, its own width — never the row's (owner, 2026-07-23: "chat button too long"; review 2026-11-16).
    expect(tokens(alone.querySelector('[data-store-actions] > button'))).toEqual(expect.arrayContaining(['px-8', 'min-h-11']))
    expect(tokens(alone.querySelector('[data-store-actions] > button'))).not.toContain('flex-1')
    // The actions alone (no chat target — an affiliate shop): the row still draws them.
    expect(mount({ actions: <button type="button">{SHARE}</button> }).querySelector('[data-store-actions]')?.textContent).toBe(SHARE)
  })

  it('the PDP card is untouched: no stat cells, no phone grid, the strip whole', () => {
    const div = document.createElement('div')
    div.innerHTML = renderToString(<SellerCard seller={seller()} metrics={metrics({ reviewCount: 2, rating: 4 })} listingCount={5} />).replaceAll('<!-- -->', '')
    expect(div.querySelector('[data-store-stats]')).toBeNull()
    expect(div.innerHTML).not.toContain('max-sm:grid')
    expect(div.innerHTML).not.toContain('max-sm:hidden')
    expect(div.querySelector('h1')).toBeNull()
  })
})
