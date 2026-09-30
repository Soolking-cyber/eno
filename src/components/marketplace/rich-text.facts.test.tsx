import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { formatRichText, hideRepeatedFacts } from './rich-text'

/**
 * THE 'Label: value' FACT TABLE — WHAT IT IS FOR AND WHAT IT MUST LEAVE ALONE (review, 2026-09-29).
 *
 * It exists for the importers' fact blocks (an imported rental's Type / Area / Bedrooms … one per line),
 * which used to merge into one run-on paragraph. Two regressions came with it and are pinned here:
 *  · a shop's FEATURE list ("Powerful 125cc Engine: Smooth and responsive performance …") rendered as
 *    spec rows on a partner motorbike PDP — a feature name as the label, a sentence as the value;
 *  · an imported rental's Area / Bedrooms / Bathrooms printed twice, the description's table directly
 *    above the page's own Details table — so each such row is tagged `data-fact` and the PDP hides it.
 */
const html = (text: string) => renderToStaticMarkup(createElement(Fragment, null, ...formatRichText(text)))
const dts = (h: string) => [...h.matchAll(/<dt[^>]*>(.*?)<\/dt>/g)].map((m) => m[1])
const facts = (h: string) => [...h.matchAll(/<div data-fact="([a-z]+)"[^>]*><dt[^>]*>(.*?)<\/dt>/g)].map((m) => `${m[1]}=${m[2]}`)

// nhatot-listing.ts's two blocks, verbatim in shape (one fact per single newline).
const NHATOT_EN = ['Type: Serviced / mini apartment', 'Area: 28 m²', 'Bedrooms: 1', 'Bathrooms: 1', 'Furnishing: Fully furnished', 'Ward: Tân Hòa', 'District: Tân Bình', 'City: Ho Chi Minh City', 'Rent: 6,300,000 ₫/month'].join('\n')
const NHATOT_VI = ['Loại hình: Căn hộ dịch vụ, mini', 'Diện tích: 28 m²', 'Phòng ngủ: 1', 'Phòng vệ sinh: 1', 'Nội thất: Nội thất đầy đủ', 'Phường/xã: Tân Hòa', 'Quận/huyện: Tân Bình', 'Tỉnh/thành: Hồ Chí Minh', 'Giá thuê: 6.300.000 đ/tháng'].join('\n')

// A partner motorbike blurb (janmotorbike, staged feed 2026-09), the lines the review saw as table rows.
const BIKE_BLURB = [
  'Here are some reasons to choose the Honda Airblade 125cc:',
  'Powerful 125cc Engine: Smooth and responsive performance for city riding.',
  'Automatic Transmission: Easy to operate without manual gear shifting.',
  'Fuel Injection: Helps provide efficient and consistent engine performance.',
  'Sporty Design: Modern styling suitable for everyday use.',
  'Smart Key: Convenient keyless operation on equipped versions.',
].join('\n')

describe('formatRichText — the importer fact block still becomes one table (the P-FACTS win)', () => {
  it('English and Vietnamese blocks, every line a row', () => {
    expect(dts(html(NHATOT_EN))).toEqual(['Type', 'Area', 'Bedrooms', 'Bathrooms', 'Furnishing', 'Ward', 'District', 'City', 'Rent'])
    expect(dts(html(NHATOT_VI))).toEqual(['Loại hình', 'Diện tích', 'Phòng ngủ', 'Phòng vệ sinh', 'Nội thất', 'Phường/xã', 'Quận/huyện', 'Tỉnh/thành', 'Giá thuê'])
  })

  it('tags the rows the PDP Details can repeat — in both languages, whatever the Vietnamese label', () => {
    expect(facts(html(NHATOT_EN))).toEqual(['area=Area', 'bedrooms=Bedrooms', 'bathrooms=Bathrooms', 'furnishing=Furnishing'])
    // ⚠️ "Phòng vệ sinh" here, "Số toilet" in the taxonomy's Details label: the same row, one key.
    expect(facts(html(NHATOT_VI))).toEqual(['area=Diện tích', 'bedrooms=Phòng ngủ', 'bathrooms=Phòng vệ sinh', 'furnishing=Nội thất'])
    expect(facts(html(['Số toilet: 2', 'Phòng tắm: 2'].join('\n')))).toEqual(['bathrooms=Số toilet', 'bathrooms=Phòng tắm'])
  })

  it('two importer labels are enough for a table; a seller spec sheet needs three lines', () => {
    expect(dts(html(['Rent: 6,300,000 ₫/month', 'Deposit: 1 month'].join('\n')))).toEqual(['Rent', 'Deposit'])
    expect(dts(html(['Displacement: 125cc', 'Max Power: 8.8 kW (12.0 PS) @ 8,000 rpm', 'Seat Height: 770 mm'].join('\n'))))
      .toEqual(['Displacement', 'Max Power', 'Seat Height'])
  })
})

describe('formatRichText — what the table must leave as prose', () => {
  it('⛔ a feature list is not a spec table: a value that ends like a sentence is never a row', () => {
    const h = html(BIKE_BLURB)
    expect(h).not.toContain('<dl')
    expect(h).toContain('Powerful 125cc Engine: Smooth and responsive performance for city riding.')
  })

  it('an ellipsis or a closing quote after the stop still reads as a sentence', () => {
    expect(html(['Trang bị hiện đại: camera 360, cảm biến va chạm, túi khí,…', 'An toàn: ABS, EBD, túi khí.', 'Nội thất: "Ghế da cao cấp."'].join('\n'))).not.toContain('<dl')
  })

  it('two lines under labels the importers never write stay prose, in their order', () => {
    const h = html(['Great bike.', 'Brand: Honda', 'Model: Wave'].join('\n'))
    expect(h).not.toContain('<dl')
    expect(h).toContain('<p>Great bike. Brand: Honda Model: Wave</p>')
  })

  it('a sentence inside a fact run ends the run and keeps its place in the text', () => {
    const h = html(['Type: Apartment', 'Area: 28 m²', 'Note: Call before visiting.', 'Rent: 6,300,000 ₫/month'].join('\n'))
    expect(dts(h)).toEqual(['Type', 'Area'])
    expect(h.indexOf('Note: Call before visiting. Rent: 6,300,000 ₫/month')).toBeGreaterThan(h.indexOf('</dl>'))
  })
})

describe('hideRepeatedFacts — the class the PDP puts on its description', () => {
  it('one literal class per Details row the page rendered, nothing for rows it cannot repeat', () => {
    expect(hideRepeatedFacts(['area', 'bedrooms', 'bathrooms', 'carrier', 'rentalPeriod', 'constructor'])).toBe(
      '[&_[data-fact=area]]:hidden [&_[data-fact=bedrooms]]:hidden [&_[data-fact=bathrooms]]:hidden',
    )
    expect(hideRepeatedFacts([])).toBe('')
    expect(hideRepeatedFacts(['year', 'year', 'engine'])).toBe('[&_[data-fact=year]]:hidden [&_[data-fact=engine]]:hidden')
  })
})
