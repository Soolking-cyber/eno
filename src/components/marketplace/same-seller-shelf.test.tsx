import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/**
 * rentals-14: a job board is not a "seller". When every card on the PDP's same-seller rail is a job, the
 * English title is "More jobs from {board}"; any other rail keeps "More from this seller". Vietnamese reads
 * "Tin khác từ {name}" for both. The rail's chrome and cards are stubbed — only the title is under test.
 */
let LANG = 'en'
/** What a machine-translated language answers for an English source (the layer that may lose `{…}`). */
const MT: Record<string, Record<string, string>> = {
  ja: { 'More jobs from {name}': '{name} のその他の求人' }, // keeps the slot, moves it first
  ko: { 'More jobs from {name}': '이름의 다른 일자리' }, // lost the slot
}
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: LANG, tr: (en: string, vi?: string) => (LANG === 'vi' && vi != null ? vi : MT[LANG]?.[en] ?? en) }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('./listing-card', () => ({ ListingCard: () => null }))
vi.mock('./shelf', () => ({
  RAIL_CARD_W: '',
  Shelf: ({ title, children }: { title: string; children: React.ReactNode }) => <section><h2>{title}</h2>{children}</section>,
}))

import { SameSellerShelf } from './same-seller-shelf'
import type { SerializedListingCard } from '@/lib/types'

const card = (id: string, slug: string) => ({ id, category: { slug } }) as unknown as SerializedListingCard
const title = (listings: SerializedListingCard[], lang = 'en', sellerName = 'CareerLink.vn') => {
  LANG = lang
  const html = renderToString(<SameSellerShelf listings={listings} sellerHref="/s/x" sellerName={sellerName} />)
  LANG = 'en'
  return html.match(/<h2>(.*?)<\/h2>/)?.[1]?.replace(/<!-- -->/g, '').replace(/&amp;/g, '&') ?? null
}

describe('SameSellerShelf — the rail title', () => {
  it('names a board\'s jobs in English, and keeps "Tin khác từ {name}" in Vietnamese', () => {
    const jobs = [card('a', 'jobs'), card('b', 'jobs')]
    expect(title(jobs)).toBe('More jobs from CareerLink.vn')
    expect(title(jobs, 'vi')).toBe('Tin khác từ CareerLink.vn')
  })

  it('any other rail, or a mixed one, keeps "More from this seller"', () => {
    expect(title([card('a', 'rentals'), card('b', 'rentals')])).toBe('More from this seller')
    expect(title([card('a', 'jobs'), card('b', 'electronics')])).toBe('More from this seller')
  })

  it('one template, filled after translation: a translated language keeps its own order, and a lost slot falls back to English', () => {
    const jobs = [card('a', 'jobs'), card('b', 'jobs')]
    expect(title(jobs, 'ja')).toBe('CareerLink.vn のその他の求人')
    expect(title(jobs, 'ko')).toBe('More jobs from CareerLink.vn')
  })

  it('a name is printed as typed — `$&` / `$1` are not replacement patterns', () => {
    expect(title([card('a', 'jobs'), card('b', 'jobs')], 'en', 'Jobs $& More $1')).toBe('More jobs from Jobs $& More $1')
  })
})
