// @vitest-environment jsdom
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

/**
 * SEO wave B, D1b: /c/rentals' description, lede and preview all count HOMES — one number — name no
 * office, state the free check, and close on D-f's sentence (CS-2 D1b-1…7, approved 2026-09-30).
 * ⛔ THE CHECK'S LIMIT IS MOCKED TO 7 so a typed "5" cannot pass by coincidence (plan v4, fix 7).
 */
vi.mock('@/lib/rental-check/shared', () => ({ RENTAL_CHECK_MAX_ITEMS: 7 }))

import { LanguageProvider } from '@/context/language-context'
import { RENTALS_LINKED_SENTENCE, homeFacts, rentalKinds, rentalsHeadline, rentalsMetadata, type RentalsFacts } from './category-copy'
import { RentalsLede } from './category-text'

const BY_SUB = { 'apartment-rental': 14043, 'house-rental': 5331, 'room-rental': 3289, 'office-rental': 2270, 'car-rental': 6156 }
const LIVE: RentalsFacts = {
  total: 25502, allHcmc: true, linked: 'all', kinds: rentalKinds(BY_SUB), top: [],
  vehicles: { cars: 6156, motorbikes: 232 }, homes: homeFacts(BY_SUB), homesLinked: 'all',
}
const meta = (f: RentalsFacts, lang: 'en' | 'vi') => rentalsMetadata(f, lang, 'eno.vn', rentalsHeadline(f))
const lede = (f: RentalsFacts, lang: 'en' | 'vi') => {
  const el = document.createElement('div')
  el.innerHTML = renderToString(
    <LanguageProvider initialLang={lang} initialViDict={{}}>
      <RentalsLede total={f.total} allHcmc={f.allHcmc} kinds={f.kinds} linked={f.linked} vehicles={f.vehicles} homes={f.homes} homesLinked={f.homesLinked} />
    </LanguageProvider>,
  )
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}
const OFFICE_WORD = /office|văn phòng|mặt bằng/i
const firstNumber = (s: string) => s.match(/^[\d.,]+/)?.[0].replace(/[.,]/g, '')

describe('/c/rentals description (CS-2 D1b-1)', () => {
  it('English, whole', () => {
    expect(meta(LIVE, 'en').description).toBe(
      '22,663 homes for rent in Ho Chi Minh City — 14,043 apartments, 5,331 houses and 3,289 rooms. Pick up to 7 and eno checks availability for free. Every listing links to its original ad on another listing site.',
    )
  })
  it('Vietnamese, whole', () => {
    expect(meta(LIVE, 'vi').description).toBe(
      '22.663 chỗ ở cho thuê tại TP. Hồ Chí Minh — 14.043 căn hộ, 5.331 nhà và 3.289 phòng trọ. Chọn tối đa 7 căn, eno kiểm tra phòng trống miễn phí. Mỗi tin đều dẫn tới tin gốc trên một trang đăng tin khác.',
    )
  })
  it.each(['en', 'vi'] as const)('%s: no office word, the check from the constant, homes = the three kinds, "Vietnam" off HCMC', (lang) => {
    const d = meta(LIVE, lang).description
    expect(d).not.toMatch(OFFICE_WORD)
    expect(d).toContain(lang === 'vi' ? 'tối đa 7 căn' : 'up to 7 ')
    expect(Number(firstNumber(d))).toBe(14043 + 5331 + 3289)
    expect(meta({ ...LIVE, allHcmc: false }, lang).description).toMatch(lang === 'vi' ? /tại Việt Nam — / : /in Vietnam — /)
    expect(d).not.toMatch(/partner|đối tác/i)
  })
  it('keeps the title on the cached variant', () => {
    expect(meta(LIVE, 'en').title).toBe('Apartments & Houses for Rent in Ho Chi Minh City | eno.vn')
  })
  it('with no home live, keeps today\'s all-rentals wording with D-f\'s sentence (D1b-7)', () => {
    const f = { ...LIVE, homes: homeFacts({ 'office-rental': 3 }), kinds: rentalKinds({ 'office-rental': 3 }), total: 3 }
    expect(meta(f, 'en').description).toBe('3 places for rent in Ho Chi Minh City, including 3 offices. Every listing links to its original ad on another listing site.')
  })
})

describe('/c/rentals lede (CS-2 D1b-2)', () => {
  it.each(['en', 'vi'] as const)('%s: leads with the homes count, names no office, ends on D-f then vehicle hire', (lang) => {
    const t = lede(LIVE, lang)
    expect(t).toBe(lang === 'vi'
      ? '22.663 chỗ ở cho thuê tại TP. Hồ Chí Minh, gồm 14.043 căn hộ, 5.331 nhà và 3.289 phòng trọ. Mỗi tin đều dẫn tới tin gốc trên một trang đăng tin khác. Ngoài ra còn 6.156 xe ô tô và 232 xe máy cho thuê.'
      : '22,663 homes for rent in Ho Chi Minh City, including 14,043 apartments, 5,331 houses and 3,289 rooms. Every listing links to its original ad on another listing site. Plus 6,156 cars and 232 motorbikes for hire.')
    expect(t).not.toMatch(OFFICE_WORD)
    expect(t).toContain(RENTALS_LINKED_SENTENCE.all[lang])
  })
  it.each(['en', 'vi'] as const)('%s: with no home live, keeps today\'s wording', (lang) => {
    const f = { ...LIVE, homes: homeFacts({}), total: 25502 }
    expect(lede(f, lang)).toMatch(lang === 'vi' ? /^25\.502 tin cho thuê tại TP\. Hồ Chí Minh, gồm / : /^25,502 places for rent in Ho Chi Minh City, including /)
  })
})

describe('the linked sentence speaks of the homes', () => {
  it.each(['en', 'vi'] as const)('%s: the homes\' tier, not the offices\'', (lang) => {
    const f = { ...LIVE, linked: 'most' as const, homesLinked: 'some' as const }
    expect(meta(f, lang).description.endsWith(RENTALS_LINKED_SENTENCE.some[lang])).toBe(true)
    expect(lede(f, lang)).toContain(RENTALS_LINKED_SENTENCE.some[lang])
    const none = { ...LIVE, linked: 'most' as const, homesLinked: 'none' as const }
    expect(meta(none, lang).description).toMatch(lang === 'vi' ? /miễn phí\.$/ : /for free\.$/)
    expect(lede(none, lang)).not.toContain(RENTALS_LINKED_SENTENCE.most[lang])
  })
})

describe('one number (plan v4)', () => {
  it.each(['en', 'vi'] as const)('%s: the description, the lede and the preview strip count the same homes', (lang) => {
    const n = String(LIVE.homes!.total)
    expect(firstNumber(meta(LIVE, lang).description)).toBe(n)
    expect(firstNumber(lede(LIVE, lang))).toBe(n)
  })
  it('the page hands the strip the homes total, and the preview query carries the home kinds through AND', () => {
    const src = readFileSync('src/app/[lang]/c/[category]/(index)/page.tsx', 'utf8')
    expect(src).toMatch(/total: homes\?\.total \?\? rentals\?\.total \?\? total/)
    expect(src).toMatch(/homes \? \{ AND: \[base, RENTAL_PLACES, \{ subcategorySlug: \{ in: \[\.\.\.HOME_RENTAL_SUBCATS\] \} \}\] \}/)
    expect(src).toMatch(/\[HOMES_ONLY_PARAM\.key\]: HOMES_ONLY_PARAM\.value/)
    expect(src).toMatch(/sortable=\{\(homes\?\.total \?\? total\) > 1\}/)
    // `homes` IS the facts' homes: the lede block and generateMetadata read the same cache()'d call.
    expect(src).toMatch(/const homes = rentalsFacts\?\.homes && rentalsFacts\.homes\.total > 0 \? rentalsFacts\.homes : null/)
    const block = readFileSync('src/app/[lang]/c/[category]/(index)/category-lede-block.tsx', 'utf8')
    expect(block).toMatch(/homes=\{rentals\.homes\}/)
  })
})
