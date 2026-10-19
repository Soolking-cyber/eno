// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { VI_OVERRIDES } from '@/generated/vi-overrides'
import { LanguageProvider } from '@/context/language-context'
import { RentalAmenities, RentalCosts, RentalFactRows } from './rental-facts'
import { amenityOptions, rentalCostRows, rentalFactRows } from '@/lib/rental-facts'

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
    const en = text('en', <RentalCosts rent={3_500_000} rows={rentalCostRows(ATTRS)} />)
    expect(en).toContain('Costs')
    expect(en).toContain('Rent3,500,000 đ / month')
    expect(en).toContain('Deposit3,500,000 đ')
    expect(en).toContain('Electricity3,800 đ / kWh')
    expect(en).toContain('Water100,000 đ / person per month')
    expect(en).toContain('Service / management fee150,000 đ / month')
    expect(en).toContain('Parking100,000 đ / vehicle per month')
    const vi = text('vi', <RentalCosts rent={3_500_000} rows={rentalCostRows(ATTRS)} />)
    expect(vi).toContain('Chi phí')
    expect(vi).toContain('Tiền điện3.800 đ / kWh')
    expect(vi).toContain('Tiền nước100.000 đ / người / tháng')
    expect(vi).toContain('Phí dịch vụ150.000 đ / tháng')
    expect(vi).toContain('Phí giữ xe100.000 đ / xe / tháng')
  })

  it('draws no rent row when the price is not quoted per month', () => {
    expect(text('en', <RentalCosts rent={null} rows={rentalCostRows(ATTRS)} />)).not.toContain('Rent')
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
    expect(PAGE).toContain('<RentalCosts rent={monthlyRent} rows={costRows} />')
    expect(PAGE).toContain('<RentalAmenities items={amenities} />')
    expect(PAGE).toContain('<RentalFactRows rows={factRows} />')
  })
})
