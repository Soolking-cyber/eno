// @vitest-environment jsdom
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

/**
 * UI climb batch 90 (2026-11-14; owner 2026-11-13: "reduce lines … super clean, minimal wording, only what's necessary"):
 * below md the listing page's seller strip drops "Joined <year>" (`max-md:hidden`, per item, never a height clip) ONLY for an
 * official partner whose listing count heads the line (K-TRUST-BADGE option D, owner 2026-09-30) — the A/B pages were GoPlus
 * and Blvck. A private seller keeps it on every width: it is the one item that says the account is new (codex + Opus,
 * 2026-11-14). The order is unchanged (Joined · rating, as seller-card.tsx). md and up still print every item.
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

/** The strip's items, as rendered, with their own class lists. */
function items(props: Record<string, unknown>, m?: Partial<Record<string, unknown>>) {
  const div = document.createElement('div')
  div.innerHTML = renderToString(<PdpShopLink name="Shop" href="/sellers/s1" metrics={metrics(m)} {...props} />)
  const strip = div.querySelector('div.flex-wrap.text-xs')
  return strip ? [...strip.children].map((el) => ({ text: text(el), cls: el.className.split(/\s+/) })) : []
}

describe('batch 90 — a partner’s phone seller strip keeps one meta line; a person keeps "Joined"', () => {
  const partner = { officialPartner: true, partnerListingCount: 19 }

  it('an official partner: the count heads the line, "Joined" is the one item hidden below md', () => {
    const row = items(partner, { reviewCount: 2, rating: 5 })
    expect(row[0].text).toMatch(/^19 listings on /)
    expect(row[0].cls).not.toContain('max-md:hidden')
    const joined = row.filter((i) => i.text.startsWith('Joined'))
    expect(joined).toHaveLength(1)
    expect(joined[0].cls).toContain('max-md:hidden')
    expect(row.filter((i) => i.cls.includes('max-md:hidden'))).toEqual(joined)
    // From md it is back: no md:/lg: rule hides it, and nothing else on it changed.
    expect(joined[0].cls.filter((c) => c !== 'max-md:hidden')).toEqual(['inline-flex', 'items-center', 'gap-1.5'])
  })

  it('⛔ a private seller keeps "Joined" on every width — with a reply time, a rating, or nothing else at all', () => {
    for (const m of [{ reviewCount: 3, rating: 4.7 }, { reviewCount: 0 }, { responseBucket: { key: null, en: '', vi: '' }, reviewCount: 0 }]) {
      const row = items({}, m)
      expect(row.some((i) => i.text.startsWith('Joined'))).toBe(true)
      expect(row.some((i) => i.cls.includes('max-md:hidden'))).toBe(false)
    }
  })

  it('a partner without a count shown (count 0) keeps "Joined" too — only the count stands in for it', () => {
    const row = items({ officialPartner: true, partnerListingCount: 0 })
    expect(row.some((i) => i.cls.includes('max-md:hidden'))).toBe(false)
  })

  it('the order is unchanged (Joined · rating, as the storefront card) and a rating is never hidden', () => {
    const row = items(partner, { reviewCount: 3, rating: 4.7 })
    const rating = row.findIndex((i) => /reviews$/.test(i.text))
    const joined = row.findIndex((i) => i.text.startsWith('Joined'))
    expect(rating).toBeGreaterThanOrEqual(0)
    expect(joined).toBeLessThan(rating)
    expect(row[rating].cls).not.toContain('max-md:hidden')
  })

  it('"Active today" (after mount) stays, before "Joined", and the hidden item is still "Joined"', () => {
    MOUNTED = true
    try {
      const row = items(partner)
      const active = row.findIndex((i) => /today/i.test(i.text))
      expect(active).toBeGreaterThanOrEqual(0)
      expect(row[active].cls).not.toContain('max-md:hidden')
      const joined = row.findIndex((i) => i.text.startsWith('Joined'))
      expect(active).toBeLessThan(joined)
      expect(row[joined].cls).toContain('max-md:hidden')
    } finally {
      MOUNTED = false
    }
  })

  it('in Vietnamese too: a partner’s "Tham gia" is the hidden item', () => {
    LANG = 'vi'
    try {
      const row = items(partner, { reviewCount: 3, rating: 4.7 })
      const joined = row.find((i) => i.text.startsWith('Tham gia'))!
      expect(joined.cls).toContain('max-md:hidden')
      expect(row.filter((i) => i.cls.includes('max-md:hidden'))).toEqual([joined])
    } finally {
      LANG = 'en'
    }
  })

  it('a linked listing (no Joined at all) hides nothing: its "not verified" line stays on every width', () => {
    const row = items({ linked: 'listing', unrated: true })
    expect(row.map((i) => i.text).join(' ')).toContain('Linked listing: not verified by')
    expect(row.some((i) => i.cls.includes('max-md:hidden'))).toBe(false)
  })
})

/**
 * UI climb batch 95 (owner-approved 2026-11-14, decision 3, "the job page says it once"; mock variants13/d2c3): a linked job's
 * storefront row is ONE link — the name, 16px bold, a chevron — and the kept counsel line under it. No avatar, no "Linked
 * shop" chip, no "More jobs ›". Every other row is as it was (the batch 90 block above).
 */
describe('batch 95 — a linked job names its storefront once, as one link, over the kept "not verified" line', () => {
  const job = (props: Record<string, unknown> = {}) => {
    const div = document.createElement('div')
    div.innerHTML = renderToString(<PdpShopLink name="Nord Anglia Education" href="/sellers/s1" metrics={metrics({ reviewCount: 4, rating: 4.5 })} linked="job" unrated linkedShop {...props} />)
    return div
  }

  it('one /sellers link: the name and a chevron, block-level, with the 44px hit area and a press state', () => {
    const div = job()
    const links = [...div.querySelectorAll('a')]
    expect(links).toHaveLength(1)
    const a = links[0]
    expect(a.getAttribute('href')).toBe('/sellers/s1')
    expect(text(a)).toBe('Nord Anglia Education')
    expect(a.hasAttribute('aria-hidden')).toBe(false)
    expect(a.querySelector('svg')).not.toBeNull()
    const cls = a.className.split(/\s+/)
    for (const c of ['relative', 'tap-44', 'flex', 'w-fit', 'max-w-full', 'text-base', 'font-bold', 'text-foreground', 'hover:underline', 'active:opacity-60']) expect(cls).toContain(c)
    // ⚠️ The truncation is on the inner span: `overflow:hidden` on the link would clip tap-44's ::before.
    expect(cls).not.toContain('truncate')
    expect(a.querySelector('span.truncate')?.textContent).toBe('Nord Anglia Education')
  })

  // `head` (owner-approved 2026-11-14, cook r06 jobs): the copy under a linked job's role below md — the name at the sub-section
  // role with an 18px chevron, the counsel line at the meta role directly under it; the same one link, the same words.
  it('`head`: the name at the sub-section role, an 18px chevron, the counsel line at the meta role', () => {
    const div = job({ head: true, className: 'md:hidden' })
    expect(div.firstElementChild!.className).toBe('md:hidden')
    const a = div.querySelector('a')!
    const cls = a.className.split(/\s+/)
    expect(cls).toContain('text-t-h3')
    expect(cls).not.toContain('text-base')
    expect(cls).toEqual(expect.arrayContaining(['relative', 'tap-44', 'font-bold', 'text-foreground']))
    expect(a.querySelector('svg')!.getAttribute('class')).toContain('size-4.5')
    const line = div.querySelector('a + p')!
    expect(line.className.split(/\s+/)).toEqual(['mt-0', 'text-t-meta', 'text-muted-foreground'])
    expect(text(line)).toBe('Linked job posting — not verified by eno.vn')
  })

  it('no avatar, no Linked-shop chip, no trust chip, no metrics and no "More jobs"', () => {
    const div = job()
    const html = div.innerHTML
    expect(div.querySelector('[tabindex="-1"]')).toBeNull()
    expect(html).not.toContain('data-linked-shop-chip')
    expect(html).not.toContain('data-trust-chip')
    expect(text(div)).not.toMatch(/More jobs|Việc làm khác|Joined|review/)
    expect(div.querySelector('[aria-label]')).toBeNull()
  })

  it('⛔ the counsel line stays, directly under the link, in English and Vietnamese', () => {
    const en = job()
    const line = en.querySelector('a + p')!
    expect(text(line)).toBe('Linked job posting — not verified by eno.vn')
    expect(line.className.split(/\s+/)).toEqual(['mt-1', 'text-xs', 'text-muted-foreground', 'lg:text-sm', 'lg:text-body'])
    LANG = 'vi'
    try {
      expect(text(job().querySelector('a + p')!)).toBe('Tin tuyển dụng dẫn link — eno.vn chưa xác minh')
    } finally {
      LANG = 'en'
    }
  })

  it('names eno.forum when the brand gate is on', () => {
    gate.forum = true
    try {
      expect(text(job().querySelector('a + p')!)).toBe('Linked job posting — not verified by eno.forum')
      LANG = 'vi'
      expect(text(job().querySelector('a + p')!)).toBe('Tin tuyển dụng dẫn link — eno.forum chưa xác minh')
    } finally {
      gate.forum = false
      LANG = 'en'
    }
  })

  it('a linked listing and a person keep the full row: avatar, the strip, and the Shop link', () => {
    const div = document.createElement('div')
    div.innerHTML = renderToString(<PdpShopLink name="Shop" href="/sellers/s1" metrics={metrics()} linked="listing" unrated linkedShop />)
    expect(div.querySelectorAll('a')).toHaveLength(3)
    expect(div.innerHTML).toContain('data-linked-shop-chip')
    expect(text(div)).toContain('Linked listing: not verified by eno.vn')
    expect(div.querySelector('a[aria-label="Visit shop"]')).not.toBeNull()
    const person = document.createElement('div')
    person.innerHTML = renderToString(<PdpShopLink name="Lan" href="/sellers/s2" metrics={metrics()} />)
    expect(person.querySelectorAll('a[href="/sellers/s2"]').length).toBeGreaterThanOrEqual(3)
    expect(text(person)).toContain('Joined 2024')
  })
})

/**
 * ⛔ THE RENTAL LISTING PAGE'S HOST ROW (owner-approved 2026-11-14, cook r05 "rental-c"; a flat row since owner-approved 2026-11-15
 * (build 7), cook r07 "rental"; src/lib/rental-sheet.ts): no border, no shadow, no fill — the row's own nodes and words in DOM =
 * paint order: avatar (aria-hidden, 56, a hairline ring) down the left, name, badge, status line, then (a partner with a count
 * only) the count on its own line, its number bold, and "Shop" as the outline pill at the row's end. Batch 90's partner
 * "Joined" hide and the linked listing's counsel line are kept; the status line holds one line from the server HTML.
 */
describe('PdpShopLink variant="card" — the rental sheet\'s host row', () => {
  const card = (props: Record<string, unknown> = {}, m?: Partial<Record<string, unknown>>) => {
    const div = document.createElement('div')
    div.innerHTML = renderToString(<PdpShopLink name="GoPlus" href="/sellers/s1" metrics={metrics(m)} variant="card" {...props} />)
    return div.querySelector('[data-host-card]') as HTMLElement
  }
  const partner = { officialPartner: true, partnerListingCount: 5379 }
  /** The text of the row's nodes in document order: the name link, the status line, the count, Shop. */
  const order = (el: HTMLElement) => {
    const name = el.querySelector('a.text-t-h3')!
    const status = el.querySelector('div.min-h-5')!
    const count = el.querySelector('[data-partner-listing-count]')
    const shop = el.querySelector('a[aria-label="Visit shop"]')!
    const pos = (n: Element | null) => (n ? [...el.querySelectorAll('*')].indexOf(n) : -1)
    return { name: pos(name), status: pos(status), count: pos(count), shop: pos(shop) }
  }

  it('one flat row (no border, radius, padding or shadow) on a three-column grid, with a 56px ringed avatar', () => {
    const el = card(partner)
    const cls = el.className.split(' ')
    expect(cls).toEqual(expect.arrayContaining(['grid', 'grid-cols-[3.5rem_minmax(0,1fr)_auto]', 'items-center', 'gap-x-3']))
    for (const c of cls) expect(c).not.toMatch(/^(border|rounded|p-|shadow|bg-)/)
    const avatarLink = el.querySelector('a[aria-hidden="true"]')!
    expect(avatarLink.getAttribute('tabindex')).toBe('-1')
    expect(avatarLink.className.split(' ')).toEqual(expect.arrayContaining(['col-start-1', 'row-span-3', 'self-center']))
    expect(avatarLink.firstElementChild!.className.split(' ')).toEqual(expect.arrayContaining(['size-14', 'ring-1', 'ring-border']))
  })

  it('a partner: the count on its own line, its number bold, not in the status line; DOM order is name, status, count, Shop', () => {
    const el = card(partner)
    const count = el.querySelector('[data-partner-listing-count]')!
    expect(el.querySelector('div.border-t')).toBeNull()
    expect(el.querySelector('div.min-h-5 [data-partner-listing-count]')).toBeNull()
    expect(count.parentElement!.className.split(' ')).toEqual(expect.arrayContaining(['row-start-3', 'text-sm', 'text-muted-foreground']))
    const num = count.querySelector(':scope > span')!
    expect(text(num)).toBe('5,379')
    expect(num.className.split(' ')).toEqual(expect.arrayContaining(['font-bold', 'text-foreground']))
    // The element's text is still the one sentence.
    expect(text(count)).toMatch(/^5,379 listings on /)
    const o = order(el)
    expect(o.name).toBeLessThan(o.status)
    expect(o.status).toBeLessThan(o.count)
    expect(o.count).toBeLessThan(o.shop)
    // Shop: the shell's outline pill at 40, down every line of the row, no chevron, still tap-44.
    const shop = el.querySelector('a[aria-label="Visit shop"]')!
    expect(shop.className.split(' ')).toEqual(expect.arrayContaining(['tap-44', 'rounded-full', 'border', 'border-line-strong', 'min-h-10', 'px-4', 'font-bold', 'text-foreground', 'col-start-3', 'row-span-3']))
    expect(shop.querySelector('svg')).toBeNull()
  })

  it('a partner\'s "Joined" is the one hidden item (batch 90), and the status line holds one line before "Active …" arrives', () => {
    const el = card(partner, { reviewCount: 2, rating: 5, responseBucket: { key: null, en: '', vi: '' } })
    const status = el.querySelector('div.min-h-5')!
    const items = [...status.querySelectorAll(':scope > div > span')]
    const joined = items.filter((i) => text(i).startsWith('Joined'))
    expect(joined).toHaveLength(1)
    expect(joined[0].className).toContain('max-md:hidden')
    expect(items.filter((i) => i.className.includes('max-md:hidden'))).toEqual(joined)
    expect(status.className.split(' ')).toContain('min-h-5')
    MOUNTED = true
    try {
      const after = card(partner, { responseBucket: { key: null, en: '', vi: '' } })
      expect(text(after.querySelector('div.min-h-5')!)).toMatch(/Active today/)
    } finally {
      MOUNTED = false
    }
  })

  it('a private seller: no count line, two lines beside the avatar, "Joined" stays visible, and the name is the h3 role', () => {
    const el = card({}, { reviewCount: 3, rating: 4.7 })
    expect(el.querySelector('[data-partner-listing-count]')).toBeNull()
    const items = [...el.querySelectorAll('div.min-h-5 > div > span')]
    expect(items.some((i) => text(i).startsWith('Joined'))).toBe(true)
    expect(items.some((i) => i.className.includes('max-md:hidden'))).toBe(false)
    expect(el.querySelector('a.text-t-h3')!.textContent).toBe('GoPlus')
    expect(el.querySelector('a[aria-hidden="true"]')!.className).toContain('row-span-2')
    const shop = el.querySelector('a[aria-label="Visit shop"]')!
    expect(shop.className.split(' ')).toEqual(expect.arrayContaining(['min-h-10', 'text-sm', 'font-bold', 'row-span-2']))
    expect(shop.parentElement).toBe(el)
  })

  it('a linked listing keeps its counsel line in the card, visible', () => {
    const el = card({ linked: 'listing', unrated: true, linkedShop: true })
    expect(text(el.querySelector('div.min-h-5')!)).toContain('Linked listing: not verified by eno.vn')
    expect(el.innerHTML).toContain('data-linked-shop-chip')
  })

  it('in Vietnamese: "5.379 tin đăng trên", "Gian hàng"', () => {
    LANG = 'vi'
    try {
      const el = card(partner)
      const count = el.querySelector('[data-partner-listing-count]')!
      expect(text(count)).toMatch(/^5\.379 tin đăng trên /)
      expect(text(el.querySelector('a[aria-label="Vào gian hàng"]')!)).toBe('Gian hàng')
    } finally {
      LANG = 'en'
    }
  })

  it('the row is unchanged without the variant (no card, no figure row)', () => {
    const div = document.createElement('div')
    div.innerHTML = renderToString(<PdpShopLink name="GoPlus" href="/sellers/s1" metrics={metrics()} {...partner} />)
    expect(div.querySelector('[data-host-card]')).toBeNull()
    expect(div.querySelector('div.flex-wrap.text-xs [data-partner-listing-count]')).not.toBeNull()
  })
})
