import { describe, expect, it } from 'vitest'
import { canonicalKey, composeDescription, decodeEntities, parseGallery, parseSpecs } from './merchant-specs'

/** Shapes copied from real BỀN product pages — entities un-decoded, contact form included. */
const PAGE = `
<table>
  <tr><td>Họ tên</td><td>Số điện thoại</td></tr>
  <tr><td>Th&ocirc;ng số</td><td>Chi tiết</td></tr>
  <tr><td>Thương hiệu</td><td>Lenovo</td></tr>
  <tr><td>Model</td><td>ThinkPad E14 Gen 7 (21SX002QVA)</td></tr>
  <tr><td>Hệ điều h&agrave;nh</td><td>Non OS</td></tr>
  <tr><td>CPU</td><td>Intel Core Ultra 5 225U</td></tr>
  <tr><td>M&agrave;u sắc</td><td>Black</td></tr>
  <tr><td>Bảo h&agrave;nh</td><td>&nbsp;</td></tr>
  <tr><td>Xuất xứ</td><td>đang cập nhật</td></tr>
</table>
<img src="https://cdn.ben.com.vn/Content/Images/Products/aaa.jpg">
<img src="https://cdn.ben.com.vn/Content/Images/Products/bbb.jpg">
<img src="https://cdn.ben.com.vn/Content/Images/Products/aaa.jpg">
<img src="https://cdn.other.com/x.jpg">
`

describe('decodeEntities', () => {
  it('decodes the Vietnamese named entities these pages actually ship', () => {
    expect(decodeEntities('Ti&ecirc;u chuẩn')).toBe('Tiêu chuẩn')
    expect(decodeEntities('H&agrave;ng')).toBe('Hàng')
    expect(decodeEntities('M&Agrave;U')).toBe('MÀU')
  })
  it('decodes numeric and hex forms, and leaves unknown names alone', () => {
    expect(decodeEntities('&#272;&#7891;')).toBe('Đồ')
    expect(decodeEntities('&#x110;')).toBe('Đ')
    expect(decodeEntities('&notareal;')).toBe('&notareal;')
  })
})

describe('parseSpecs', () => {
  const specs = parseSpecs(PAGE)

  /**
   * ⛔ THE ONE THAT MATTERS. Every sampled product page puts the "ask about this product" form in a
   * table, so "Họ tên / Số điện thoại" (name / phone) parses exactly like a specification. Five
   * pages out of five carried it. Without the exclusion it lands in every description.
   */
  it('does not mistake the contact form for a specification', () => {
    expect(specs.map((s) => s.key)).not.toContain('Họ tên')
    expect(JSON.stringify(specs)).not.toMatch(/Số điện thoại/)
  })

  it('drops the table header row', () => {
    expect(specs.map((s) => s.key)).not.toContain('Thông số')
  })

  it('drops rows whose value is blank or a placeholder', () => {
    expect(specs.map((s) => s.key)).not.toContain('Bảo hành')   // &nbsp; only
    expect(specs.map((s) => s.key)).not.toContain('Xuất xứ')     // "đang cập nhật"
  })

  it('keeps the real attributes, decoded', () => {
    expect(specs).toEqual([
      { key: 'Thương hiệu', value: 'Lenovo' },
      { key: 'Model', value: 'ThinkPad E14 Gen 7 (21SX002QVA)' },
      { key: 'Hệ điều hành', value: 'Non OS' },
      { key: 'CPU', value: 'Intel Core Ultra 5 225U' },
      { key: 'Màu sắc', value: 'Black' },
    ])
  })

  /**
   * ⛔ THE SAME FACT, WRITTEN TWICE, IN TWO LANGUAGES. The real Lenovo page lists BOTH
   * "Thương hiệu: Lenovo" and "Brand: Lenovo", and the first version de-duplicated on the raw key —
   * so the description read "Brand: Lenovo · … · Brand: Lenovo". Found by running the enrichment
   * over real pages, not by reading the code.
   */
  it('collapses the same fact written in two languages', () => {
    const both = '<tr><td>Thương hiệu</td><td>Lenovo</td></tr><tr><td>Brand</td><td>Lenovo</td></tr>'
    expect(parseSpecs(both)).toEqual([{ key: 'Thương hiệu', value: 'Lenovo' }])
    expect(canonicalKey('Brand')).toBe(canonicalKey('Thương hiệu'))
  })

  it('honours the limit and de-duplicates repeated labels', () => {
    expect(parseSpecs(PAGE, 2)).toHaveLength(2)
    const dupes = '<tr><td>Model</td><td>A</td></tr><tr><td>model</td><td>B</td></tr>'
    expect(parseSpecs(dupes)).toEqual([{ key: 'Model', value: 'A' }])
  })
})

describe('parseGallery', () => {
  it('returns each product image once, in page order, and ignores other hosts', () => {
    expect(parseGallery(PAGE)).toEqual([
      'https://cdn.ben.com.vn/Content/Images/Products/aaa.jpg',
      'https://cdn.ben.com.vn/Content/Images/Products/bbb.jpg',
    ])
  })
})

describe('composeDescription', () => {
  const specs = parseSpecs(PAGE)

  /** ⚠️ Labels translate from the dictionary; VALUES pass through untouched — a model number or a
   *  unit run through a translator is how "1TB" becomes something that is not 1TB. */
  it('translates the label vocabulary and never the values', () => {
    const en = composeDescription(specs, { merchant: 'BỀN COMPUTER', lang: 'en' })!
    expect(en).toContain('Brand: Lenovo')
    expect(en).toContain('Operating system: Non OS')
    expect(en).toContain('Colour: Black')
    expect(en).toContain('ThinkPad E14 Gen 7 (21SX002QVA)')
    expect(en).toMatch(/New, supplied by BỀN COMPUTER\.$/)
  })

  it('keeps Vietnamese labels in the Vietnamese copy', () => {
    const vi = composeDescription(specs, { merchant: 'BỀN COMPUTER', lang: 'vi' })!
    expect(vi).toContain('Thương hiệu: Lenovo')
    expect(vi).toContain('Hệ điều hành: Non OS')
    expect(vi).toMatch(/Hàng mới, phân phối bởi BỀN COMPUTER\.$/)
  })

  /**
   * ⛔ ENGLISH LABELS MUST BECOME VIETNAMESE IN THE VIETNAMESE COPY. These pages mix the two —
   * "Màu sắc" next to "Color", "Weight", "Packed Weight" — so passing keys through unchanged
   * produced a "Vietnamese" description that was half English. Caught on real pages.
   */
  it('translates English labels into Vietnamese, not just the reverse', () => {
    const mixed = parseSpecs('<tr><td>Color</td><td>Black</td></tr><tr><td>Weight</td><td>0.44 kg</td></tr>')
    const vi = composeDescription(mixed, { merchant: 'M', lang: 'vi' })!
    expect(vi).toContain('Màu sắc: Black')
    expect(vi).toContain('Trọng lượng: 0.44 kg')
    expect(vi).not.toContain('Color:')
    expect(vi).not.toContain('Weight:')
  })

  it('leaves an unmapped label in Vietnamese rather than guessing at it', () => {
    const odd = [{ key: 'Kiểu chân đế', value: 'X' }]
    expect(composeDescription(odd, { merchant: 'M', lang: 'en' })).toContain('Kiểu chân đế: X')
  })

  /** ⚠️ Nothing factual to say → null, so the caller keeps what it had. A stub sentence that
   *  restates the title is worse than no description. */
  it('returns null when there is nothing factual left', () => {
    expect(composeDescription([], { merchant: 'M', lang: 'en' })).toBeNull()
    expect(composeDescription([{ key: 'Tên sản phẩm', value: 'X' }], { merchant: 'M', lang: 'en' })).toBeNull()
  })
})
