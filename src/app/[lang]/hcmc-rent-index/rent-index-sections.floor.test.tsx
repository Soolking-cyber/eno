// @vitest-environment jsdom
import * as React from 'react'
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { LanguageProvider } from '@/context/language-context'
import { MIN_INDEXABLE_LISTINGS } from '@/lib/index-floor'
import { RENT_TYPES, type DistrictRow, type RentIndex, type Stats } from '@/lib/rent-index'
import { DistrictTable } from './rent-index-sections'

/**
 * ⛔ THE RENT INDEX LINKS A DISTRICT PAGE ONLY AT THE INDEXING FLOOR (SEO wave B, I1).
 *
 * Every row used to link `/c/rentals/<slug>`, including `can-gio` (one house on the 2026-09-27 CSV),
 * whose page is `noindex, follow` below 10 listings. The row's `total` is a subset of that page's
 * scope (the same curated spellings, homes only), so a row at the floor links a page at the floor;
 * below it the name stays, as plain text.
 */
const empty: Stats = { n: 0, median: null, p25: null, p75: null, nArea: 0, medianPerM2: null }
const district = (slug: string, name: string, nameEn: string, total: number): DistrictRow => ({
  slug, name, nameEn, partOf: null, total,
  cells: Object.fromEntries(RENT_TYPES.map((t) => [t, { ...empty, n: t === 'house' ? total : 0 }])) as DistrictRow['cells'],
})
const index: RentIndex = {
  rulesVersion: 2,
  computedAt: '2026-09-29T00:00:00.000Z',
  read: 0,
  used: 0,
  excluded: { notResidential: 0, notForRent: 0, currency: 0, unit: 0, belowBand: 0, aboveBand: 0, crossPosted: 0 },
  cityWide: Object.fromEntries(RENT_TYPES.map((t) => [t, empty])) as RentIndex['cityWide'],
  districts: [
    district('cu-chi', 'Củ Chi', 'Cu Chi District', MIN_INDEXABLE_LISTINGS - 1),
    district('can-gio', 'Cần Giờ', 'Can Gio District', 1),
    district('d7', 'Quận 7 (Phú Mỹ Hưng)', 'District 7 (Phu My Hung)', MIN_INDEXABLE_LISTINGS),
  ],
  unassigned: 0,
}

const render = (lang: 'en' | 'vi') => {
  const el = document.createElement('div')
  el.innerHTML = renderToString(
    <LanguageProvider initialLang={lang} initialViDict={{}}>
      <DistrictTable index={index} lang={lang} locale={lang === 'vi' ? 'vi' : 'en'} />
    </LanguageProvider>,
  )
  return el
}

describe('the rent index district table', () => {
  it.each(['en', 'vi'] as const)('%s: links only the row at the floor, and keeps every name', (lang) => {
    const el = render(lang)
    const links = [...el.querySelectorAll('tbody a')].map((a) => a.getAttribute('href'))
    expect(links).toEqual(['/c/rentals/d7'])
    const rows = [...el.querySelectorAll('tbody th[scope="row"]')].map((th) => th.textContent)
    expect(rows).toEqual(
      lang === 'vi' ? ['Củ Chi', 'Cần Giờ', 'Quận 7 (Phú Mỹ Hưng)'] : ['Cu Chi District', 'Can Gio District', 'District 7 (Phu My Hung)'],
    )
  })
})
