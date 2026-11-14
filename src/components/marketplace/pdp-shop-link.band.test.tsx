// @vitest-environment jsdom
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

/**
 * ⛔ THE GOODS SHEET'S SELLER BAND (PdpShopLink `variant="band"`; owner-approved 2026-11-14, cook r06 "item"): DOM = paint —
 * the avatar spanning two lines, the name (h3 role) and its badge, "Shop" as the shell's outline chip with no chevron, the
 * status strip under them at 13px; the "Linked shop" chip left out beside the "Linked listing: not verified" line only.
 */
let LANG = 'en'
let MOUNTED = false
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: LANG, tr: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : en), t: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : en), setLang: () => {} }),
  useTr: () => (en: string) => en,
  Tr: ({ text }: { text: string }) => text,
}))
vi.mock('@/hooks/use-mounted', () => ({ useMounted: () => MOUNTED }))
// `site-brand-copy` (R7) off by default, as shipped: brandForCopy keeps "eno.vn"; on, it names this edition (eno.forum under vitest).
const gate = vi.hoisted(() => ({ forum: false }))
vi.mock('@/lib/app-review-gates', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  brandForCopy: (site: string) => (gate.forum ? site : 'eno.vn'),
}))

import { PdpShopLink } from './pdp-shop-link'
import type { SellerMetrics } from '@/lib/seller-metrics'

const text = (el: Element) => (el.textContent ?? '').replace(/·/g, ' ').replace(/\s+/g, ' ').trim()
const today = new Date().toISOString().slice(0, 10)
const metrics = (m: Partial<Record<string, unknown>> = {}) => ({
  responseBucket: { key: 'hour', en: 'Replies within an hour', vi: 'Trả lời trong 1 giờ' },
  lastSeenDay: today, memberSinceYear: 2024, reviewCount: 0, rating: 0, trustScore: 100, ...m,
}) as unknown as SellerMetrics


const band = (props: Record<string, unknown> = {}, m?: Partial<Record<string, unknown>>) => {
  const div = document.createElement('div')
  div.innerHTML = renderToString(<PdpShopLink name="Tuấn Nguyễn Mobile" href="/sellers/s1" metrics={metrics(m)} variant="band" {...props} />)
  return div.querySelector('[data-seller-band]') as HTMLElement
}

describe('PdpShopLink variant="band"', () => {
  it('one grid, in reading order: the hidden avatar twin, the name row, Shop, the status strip', () => {
    const el = band({ officialPartner: true, partnerListingCount: 19 })
    expect(el.className).toContain('grid-cols-[2.75rem_minmax(0,1fr)_auto]')
    const kids = [...el.children]
    expect(kids[0].tagName).toBe('A')
    expect(kids[0].getAttribute('aria-hidden')).toBe('true')
    expect(kids[0].getAttribute('tabindex')).toBe('-1')
    expect(kids[0].className).toContain('row-span-2')
    expect(kids[1].querySelector('a')!.className).toContain('text-t-h3')
    expect(text(kids[1])).toContain('Tuấn Nguyễn Mobile')
    expect(kids[2].tagName).toBe('A')
    expect(text(kids[2])).toBe('Shop')
    expect(kids[2].getAttribute('aria-label')).toBe('Visit shop')
    expect(kids[2].className).toContain('min-h-9')
    expect(kids[2].className).toContain('tap-44')
    expect(kids[2].querySelector('svg')).toBeNull()
    expect(kids[3].className).toContain('col-span-2')
    expect(text(kids[3])).toMatch(/19 listings on/)
    expect(kids[3].querySelector('div')!.className).toContain('text-t-meta')
  })
  it('a linked listing: the counsel line in the strip, and no "Linked shop" chip beside the name', () => {
    const el = band({ linked: 'listing', unrated: true, linkedShop: true })
    expect(text(el)).toContain('Linked listing: not verified by eno.vn')
    expect(el.querySelector('[data-linked-shop-chip]')).toBeNull()
    expect(text(el)).not.toMatch(/Linked shop/)
  })
  it('the row (desktop) keeps the chip', () => {
    const div = document.createElement('div')
    div.innerHTML = renderToString(<PdpShopLink name="Shop" href="/sellers/s1" metrics={metrics()} linked="listing" unrated linkedShop />)
    expect(div.innerHTML).toMatch(/Linked shop|data-linked-shop-chip/)
  })
  it('a person keeps "Joined" on the phone band', () => {
    expect(text(band())).toContain('Joined 2024')
  })
})
