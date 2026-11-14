// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { VI_OVERRIDES } from '@/generated/vi-overrides'
import { LanguageProvider } from '@/context/language-context'
import { RentalAmenities, RentalCosts, RentalFactRows } from './rental-facts'
import { amenityOptions, rentalCostRows, rentalFactRows } from '@/lib/rental-facts'
import { SHEET_HEAD_GAP, SHEET_ROWS, amenityTakesRow } from '@/lib/rental-sheet'

/**
 * THE LISTING PAGE'S RENTAL FACTS AS A READER GETS THEM (GoPlus partnership, 2026-10-19): grouped amounts in the reader's
 * money format with their units, authored labels in both languages, the amenity list in the filter chips' words. The
 * page is ISR with a database behind it, so — like details-labels.test.tsx — its wiring is asserted on the source and the
 * sections are rendered on their own, through the server renderer the page uses.
 */
const PAGE = readFileSync(join(process.cwd(), 'src/app/[lang]/listings/[id]/(pdp)/page.tsx'), 'utf8')

const ATTRS = {
  deposit: '3500000', electricityPrice: '3800', waterPrice: '100000', waterUnit: 'person', serviceFee: '150000', parkingFee: '100000',
  maxTenants: '2', floor: '0', availableFrom: '2099-01-15',
}
const TOKENS = '|amenities:no-landlord|amenities:car-alley|amenities:aircon|amenities:jacuzzi|'

function text(lang: 'en' | 'vi', ui: React.ReactNode): string {
  const html = renderToString(<LanguageProvider initialLang={lang} initialViDict={VI_OVERRIDES}>{ui}</LanguageProvider>).replaceAll('<!-- -->', '')
  const div = document.createElement('div')
  div.innerHTML = html
  return (div.textContent ?? '').replace(/\s+/g, ' ').trim()
}

describe('<RentalCosts>', () => {
  it('prints the monthly bill, each amount grouped for the reader with its unit', () => {
    const en = text('en', <RentalCosts rows={rentalCostRows(ATTRS)} />)
    expect(en).toContain('Costs')
    expect(en).toContain('Deposit3,500,000 đ')
    expect(en).toContain('Electricity3,800 đ / kWh')
    expect(en).toContain('Water100,000 đ / person per month')
    expect(en).toContain('Service / management fee150,000 đ / month')
    expect(en).toContain('Parking100,000 đ / vehicle per month')
    const vi = text('vi', <RentalCosts rows={rentalCostRows(ATTRS)} />)
    expect(vi).toContain('Chi phí')
    expect(vi).toContain('Tiền điện3.800 đ / kWh')
    expect(vi).toContain('Tiền nước100.000 đ / người / tháng')
    expect(vi).toContain('Phí dịch vụ150.000 đ / tháng')
    expect(vi).toContain('Phí giữ xe100.000 đ / xe / tháng')
  })

  // ⛔ Batch 89 (2026-11-13; owner: "reduce lines … only what's necessary"): the headline price states the rent and its unit.
  it('draws no Rent row: the headline price says it', () => {
    expect(text('en', <RentalCosts rows={rentalCostRows(ATTRS)} />)).not.toMatch(/\bRent\b/)
    expect(text('vi', <RentalCosts rows={rentalCostRows(ATTRS)} />)).not.toContain('Tiền thuê')
  })

  // Batch 89: the facts line prints the deposit on a phone, so Costs hides its Deposit row BELOW md ONLY — from md the line
  // has no deposit and this row is where it is.
  it('hides a phoneHidden row below md only, and every other row on every width', () => {
    const html = renderToString(<LanguageProvider initialLang="en" initialViDict={VI_OVERRIDES}><RentalCosts rows={rentalCostRows(ATTRS)} phoneHidden={['deposit']} /></LanguageProvider>).replaceAll('<!-- -->', '')
    const div = document.createElement('div')
    div.innerHTML = html
    const rows = [...div.querySelectorAll('dl > div')]
    const dep = rows.find((r) => r.querySelector('dt')?.textContent === 'Deposit')!
    expect(dep.className.split(' ')).toContain('max-md:hidden')
    expect(dep.className).not.toMatch(/(^|\s)(hidden|md:hidden|md:block)(\s|$)/)
    for (const r of rows.filter((x) => x !== dep)) expect(r.className).not.toContain('hidden')
  })

  /**
   * ⛔ A GUESSED AMOUNT IS NEVER PRINTED AS FACT (owner, 2026-10-20: "fix error electricity prices with closest guess"):
   * the importer read GoPlus's "44,000 đ / kWh" as 4,000 and flagged it; the row says "≈ 4,000 đ / kWh estimate" — the
   * word in plain sight, never a hover title a touch or keyboard reader cannot open (a reviewer's catch, 2026-10-20).
   */
  it('prints a guessed rate as "≈ … estimate" in both languages, the word as plain text', () => {
    const rows = rentalCostRows({ ...ATTRS, electricityPrice: '4000', electricityEstimated: '4000' })
    const dd = (lang: 'en' | 'vi') => {
      const html = renderToString(<LanguageProvider initialLang={lang} initialViDict={VI_OVERRIDES}><RentalCosts rows={rows} /></LanguageProvider>).replaceAll('<!-- -->', '')
      const div = document.createElement('div')
      div.innerHTML = html
      const row = [...div.querySelectorAll('dl > div')].find((r) => /Electricity|Tiền điện/.test(r.querySelector('dt')?.textContent ?? ''))!
      return row.querySelector('dd')!
    }
    const shown = (d: Element) => (d.textContent ?? '').replace(/\s+/g, ' ').trim()
    const en = dd('en')
    expect(shown(en)).toBe('≈ 4,000 đ / kWh estimate')
    // The "≈" is held to its figure by a no-break space — never left alone at a line's end.
    expect(en.textContent).toContain('≈\u00a04,000')
    // Nothing hidden from anyone: no hover-only title, no screen-reader-only text, no aria-hidden part.
    expect(en.querySelector('[title], .sr-only, [aria-hidden]')).toBeNull()
    expect(shown(dd('vi'))).toBe('≈ 4.000 đ / kWh ước tính')
    // Only the guessed row: every stated amount prints as before, with no "≈" and no "estimate".
    const all = text('en', <RentalCosts rows={rows} />)
    expect(all.match(/≈/g)).toHaveLength(1)
    expect(all.match(/estimate/g)).toHaveLength(1)
    expect(all).toContain('Water100,000 đ / person per month')
  })

  it('a stated rate prints no "≈" and no "estimate"', () => {
    const en = text('en', <RentalCosts rows={rentalCostRows(ATTRS)} />)
    expect(en).not.toContain('≈')
    expect(en).not.toMatch(/estimate/i)
  })
})

describe('<RentalFactRows>', () => {
  it('names each occupancy row in both languages', () => {
    const rows = rentalFactRows(ATTRS)
    const en = text('en', <dl><RentalFactRows rows={rows} /></dl>)
    expect(en).toContain('Max. occupants2')
    expect(en).toContain('FloorGround floor')
    expect(en).toMatch(/Available from15 Jan 2099/)
    const vi = text('vi', <dl><RentalFactRows rows={rows} /></dl>)
    expect(vi).toContain('Số người ở tối đa2')
    expect(vi).toContain('TầngTầng trệt')
  })
})

describe('<RentalAmenities>', () => {
  it('lists the amenities in the chips\' own words, headline ones first, an unknown token left out', () => {
    const items = amenityOptions(TOKENS, 'rentals', 'apartment-rental')
    const li = (lang: 'en' | 'vi') => {
      const html = renderToString(<LanguageProvider initialLang={lang} initialViDict={VI_OVERRIDES}><RentalAmenities items={items} /></LanguageProvider>).replaceAll('<!-- -->', '')
      const div = document.createElement('div')
      div.innerHTML = html
      return [...div.querySelectorAll('li')].map((x) => x.textContent?.trim())
    }
    expect(li('en')).toEqual(['No live-in landlord', 'Car access', 'Air conditioning'])
    expect(li('vi')).toEqual(['Không chung chủ', 'Hẻm xe hơi', 'Máy lạnh'])
  })
})

describe('the listing page wires the facts in', () => {
  it('hides the well-formed raw keys, only where the facts apply, and renders the three sections', () => {
    expect(PAGE).toContain('if (factsApply) for (const k of rentalFactHiddenKeys(listing.attributes)) hiddenAttrs.add(k)')
    // `sheet`: the rental sheet's rows and icon grid below md (owner-approved 2026-11-14, cook r05 "rental-c").
    expect(PAGE).toContain('<RentalCosts rows={costRows} phoneHidden={costsPhoneHidden} sheet={rentalSheet} />')
    expect(PAGE).toContain('<RentalAmenities items={amenities} sheet={rentalSheet} />')
    // Batch 89: without the floor where the facts line prints it (facts-line.test.ts).
    expect(PAGE).toContain('<RentalFactRows rows={detailFactRows} />')
  })
})

/**
 * ⛔ THE RENTAL SHEET (owner-approved 2026-11-14, cook r05 "rental-c"; src/lib/rental-sheet.ts): below md Costs drops its rules
 * (one row style, 16/24, body-ink label, value at 400) — each row 44px at the least since owner-approved 2026-11-15 (build 7) —
 * and Amenities is two columns of a 24px glyph BESIDE its name (build 7; it was three columns, glyph over name), a name too long
 * for a column taking the row. Same rows, same words, same order, in both languages; a phone-hidden row is still hidden below md.
 */
describe('`sheet` — the rental sheet\'s rows and amenity list, below md', () => {
  const dom = (lang: 'en' | 'vi', ui: React.ReactNode) => {
    const div = document.createElement('div')
    div.innerHTML = renderToString(<LanguageProvider initialLang={lang} initialViDict={VI_OVERRIDES}>{ui}</LanguageProvider>).replaceAll('<!-- -->', '')
    return div
  }
  it('Costs: the dl carries SHEET_ROWS (every class max-md:), the heading steps 16, a phone-hidden row stays max-md:hidden', () => {
    const div = dom('en', <RentalCosts rows={rentalCostRows(ATTRS)} phoneHidden={['deposit']} sheet />)
    const dl = div.querySelector('dl')!
    for (const c of SHEET_ROWS.split(' ')) expect(dl.classList.contains(c), c).toBe(true)
    expect(dl.parentElement!.classList.contains(SHEET_HEAD_GAP)).toBe(true)
    const deposit = [...dl.children].find((r) => r.textContent?.startsWith('Deposit'))!
    expect(deposit.className).toContain('max-md:hidden')
    // Without `sheet`: the table as it was.
    const plain = dom('en', <RentalCosts rows={rentalCostRows(ATTRS)} />).querySelector('dl')!
    expect(plain.className).toBe('divide-y divide-border text-sm')
  })
  it('Costs: the same words in both languages with or without the sheet', () => {
    for (const lang of ['en', 'vi'] as const) {
      expect(dom(lang, <RentalCosts rows={rentalCostRows(ATTRS)} sheet />).textContent).toBe(dom(lang, <RentalCosts rows={rentalCostRows(ATTRS)} />).textContent)
    }
  })
  it('Costs on the sheet: each row 44px at the least, its label and value centred on it (SHEET_ROWS, build 7)', () => {
    expect(SHEET_ROWS.split(' ')).toEqual(expect.arrayContaining(['max-md:[&>div]:min-h-11', 'max-md:[&>div]:items-center', 'max-md:[&>div]:py-0']))
    expect(SHEET_ROWS).not.toMatch(/gap-3/)
  })
  it('Amenities: two columns, the 24px ink glyph beside its name in 44px rows, below md only; the same names in EN and VI', () => {
    const items = amenityOptions(TOKENS, 'rentals', 'apartment-rental')
    expect(items.length).toBe(3)
    const div = dom('en', <RentalAmenities items={items} sheet />)
    const ul = div.querySelector('ul')!
    expect(ul.className.split(' ')).toEqual(expect.arrayContaining(['grid-cols-2', 'sm:grid-cols-3', 'max-md:grid-cols-2', 'max-md:gap-x-4', 'max-md:gap-y-1', 'max-md:text-base', 'max-md:text-body']))
    const li = ul.querySelector('li')!
    expect(li.className.split(' ')).toEqual(expect.arrayContaining(['flex', 'items-center', 'max-md:min-h-11', 'max-md:gap-3']))
    expect(li.className).not.toMatch(/flex-col/)
    const svg = li.querySelector('svg')!
    expect(svg.getAttribute('class')!.split(' ')).toEqual(expect.arrayContaining(['max-md:h-6', 'max-md:w-6', 'max-md:text-foreground']))
    const label = li.querySelector('span')!
    expect(label.className).toContain('max-md:text-pretty')
    expect(label.className).not.toMatch(/line-clamp|truncate|nowrap/)
    for (const lang of ['en', 'vi'] as const) {
      const names = (sheet: boolean) => [...dom(lang, <RentalAmenities items={items} sheet={sheet} />).querySelectorAll('li')].map((x) => x.textContent?.trim())
      expect(names(true)).toEqual(names(false))
    }
  })
  it('Amenities: a name too long for a column, in either language, takes the row (decided from the words); the order is the taxonomy\'s', () => {
    expect(amenityTakesRow({ label: 'Air conditioning', labelVi: 'Máy lạnh' })).toBe(false)
    expect(amenityTakesRow({ label: 'Shared washing machine', labelVi: 'Máy giặt chung' })).toBe(true)
    expect(amenityTakesRow({ label: 'Motorbike parking', labelVi: 'Chỗ để xe' })).toBe(true)
    expect(amenityTakesRow({ label: 'Pets allowed', labelVi: 'Cho nuôi thú cưng' })).toBe(true)
    const items = [
      { value: 'aircon', label: 'Air conditioning', labelVi: 'Máy lạnh' },
      { value: 'washer', label: 'Shared washing machine', labelVi: 'Máy giặt chung' },
      { value: 'fridge', label: 'Fridge', labelVi: 'Tủ lạnh' },
    ]
    const lis = [...dom('en', <RentalAmenities items={items} sheet />).querySelectorAll('li')]
    expect(lis.map((l) => l.textContent)).toEqual(['Air conditioning', 'Shared washing machine', 'Fridge'])
    expect(lis.map((l) => l.className.split(' ').includes('max-md:col-span-2'))).toEqual([false, true, false])
    // Without the sheet nothing spans.
    expect(dom('en', <RentalAmenities items={items} />).innerHTML).not.toContain('col-span-2')
  })
})
