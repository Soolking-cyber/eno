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
    expect(row.map((i) => i.text).join(' ')).toContain('Linked listing — not verified by')
    expect(row.some((i) => i.cls.includes('max-md:hidden'))).toBe(false)
  })
})
