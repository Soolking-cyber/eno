import { describe, expect, it } from 'vitest'
import { finalTitle, judge, planOf, renderKnown, sourceRefusal, speaksOfWarranty, storeLine, titleForModel } from './import-translation'
import { richTextGroups } from './rich-text-blocks'

// The rules of scripts/translate-imports-haiku.ts. Each case below is one a commit-gate reviewer found (rounds 2–15).

const HH = { title: 'iPhone 13 128GB Cũ - TBH', description: 'Hàng cũ · Mới 99%\n\n128GB · Blue · KHÔNG\n\nBảo hành 6 tháng\n\nCửa hàng: Số 489B Đỗ Xuân Hợp' }
const ok = (r: ReturnType<typeof judge>) => { if ('why' in r) throw new Error(`refused: ${r.why}`); return r }
const why = (r: ReturnType<typeof judge>) => ('why' in r ? r.why : null)

describe('the table — badges and warranty are written by code', () => {
  it('renders the known segments', () => {
    expect(renderKnown('Hàng cũ · Mới 99%')).toBe('Used · 99% like-new')
    expect(renderKnown('Trôi bảo hành · Mới 95%')).toBe('Warranty already started · 95% like-new')
    expect(renderKnown('Bảo hành đến 07/07/2027')).toBe('Warranty until 07/07/2027')
    expect(renderKnown('6 Tháng tại Hoàng Hà')).toBe('Warranty 6 months at Hoang Ha Mobile')
    expect(renderKnown('Bảo hành 1 tháng')).toBe('Warranty 1 month')
    expect(renderKnown('Không bảo hành')).toBe('No warranty')
  })
  it('a line with any unknown segment is not rendered', () => {
    expect(renderKnown('Chưa kích hoạt bảo hành')).toBeNull()
    expect(renderKnown('256GB · Blue · KHÔNG')).toBeNull()
  })
  it('a month count is a warranty; a date or a street is not', () => {
    expect(speaksOfWarranty('máy hàng demo, bảo hành 3 tháng')).toBe(true)
    expect(speaksOfWarranty('Sản xuất tháng 3/2024')).toBe(false)
    expect(speaksOfWarranty('Cửa hàng: 580 đường 2 tháng 4')).toBe(false)
  })
})

describe('what the model sees', () => {
  it('only the lines code cannot write, and the title without "TBH"', () => {
    const p = planOf(HH.description)
    expect(p.refuse).toBeNull()
    expect(p.lines.filter((l) => 'vi' in l)).toEqual([{ vi: '128GB · Blue · KHÔNG' }])
    expect(titleForModel(HH.title)).toBe('iPhone 13 128GB Cũ')
    expect(titleForModel('ĐTDĐ iPhone Air 256GB - TBH - 231A CẦN THƠ')).toBe('ĐTDĐ iPhone Air 256GB - 231A CẦN THƠ')
  })
  it('a source the table cannot write goes to a human before the model is asked', () => {
    expect(sourceRefusal({ title: 'x', description: 'Không phụ kiện · Bảo hành 6 tháng' })).toBe('warranty line not in the table')
    expect(sourceRefusal({ title: 'iPhone 13 không bảo hành', description: 'Hàng cũ' })).toBe('title warranty wording not in the table')
    expect(sourceRefusal({ title: 'x', description: 'Hàng cũ\nCửa hàng: Bảo hành chính hãng 24 tháng' })).toBe('store line is not an address')
    expect(sourceRefusal({ title: 'x', description: 'Hàng cũ\nCửa hàng: 48 Đống Đa máy mới nguyên hộp' })).toBe('store line is not an address')
    expect(sourceRefusal({ title: 'x', description: 'Màu xanh dương\nMáy trần' })).toBe('line order not verifiable')
    expect(sourceRefusal({ title: 'x', description: 'Bảo hành trọn đời'.normalize('NFD') })).toBe('warranty line not in the table')
  })
})

describe('judge — the answer, line by line', () => {
  const T = 'iPhone 13 128GB Used'
  it('assembles code lines and the model line, each fact its own paragraph, the title phrase by code', () => {
    const out = ok(judge(HH, { title: T, description: '128GB · Blue · No accessories' }))
    expect(out.title).toBe('iPhone 13 128GB Used · Warranty already started')
    expect(out.description).toBe('Used · 99% like-new\n\n128GB · Blue · No accessories\n\nWarranty 6 months\n\nStore: No. 489B Do Xuan Hop')
    expect(richTextGroups(out.description)).toHaveLength(4)
  })
  it('the model may not speak of a warranty — on a line or in the title', () => {
    expect(why(judge(HH, { title: T, description: '128GB · Blue · No warranty' }))).toBe('names a warranty')
    expect(why(judge({ title: 'x 1', description: '128GB · Blue · Fullbox' }, { title: 'x 1', description: '128GB · Blue · Full box with manufacturer coverage' }))).toBe('names a warranty')
    expect(why(judge(HH, { title: 'iPhone 13 128GB — no warranty already started', description: '128GB · Blue · No accessories' }))).toBe('title negation changed')
    expect(why(judge(HH, { title: 'iPhone 13 128GB with warranty', description: '128GB · Blue · No accessories' }))).toBe('names a warranty')
  })
  it('a negation survives, numbers keep their order, lines are neither merged nor split', () => {
    expect(why(judge(HH, { title: T, description: '128GB · Blue · Accessories included' }))).toBe('negation changed')
    expect(why(judge({ title: 'x 1', description: '8GB RAM · 256GB' }, { title: 'x 1', description: '256GB RAM · 8GB' }))).toBe('line numbers changed')
    expect(why(judge(HH, { title: T, description: '128GB · Blue\nNo accessories' }))).toBe('lines merged or split')
    expect(why(judge(HH, { title: 'iPhone 15 128GB Used', description: '128GB · Blue · No accessories' }))).toBe('title numbers changed')
  })
  it('per item: a negation stays on its own item; a title negation survives; đồng stays VND', () => {
    expect(why(judge({ title: 'Tai nghe 1', description: 'Có sạc · Không tai nghe' }, { title: 'Earphones 1', description: 'No charger · Earphones included' }))).toBe('negation changed')
    expect(why(judge({ title: 'iPhone 13 Cũ · Không Face ID', description: '128GB · Fullbox' }, { title: 'iPhone 13 Used · Face ID', description: '128GB · Full box' }))).toBe('title negation changed')
    expect(why(judge({ title: 'Chuột không dây B175', description: '128GB · Fullbox' }, { title: 'Wireless mouse B175', description: '128GB · Full box' }))).toBeNull()
    expect(why(judge({ title: 'x 1', description: '128GB · 5.000.000đ' }, { title: 'x 1', description: '128GB · 5.000.000 USD' }))).toBe('currency changed')
    expect(why(judge({ title: 'x 1', description: 'Giá 5.000.000đ · Phụ phí 100 USD' }, { title: 'x 1', description: 'Price 5.000.000 USD · Fee 100 VND' }))).toBe('currency changed')
  })
  it('negations and defects are counted; currencies stay with their amounts — title and lines', () => {
    expect(why(judge({ title: 'x 1', description: 'Không sạc, không cáp' }, { title: 'x 1', description: 'No charger, cable included' }))).toBe('negation changed')
    expect(why(judge({ title: 'iPhone 13 Cũ · Mất Face ID', description: '128GB · Fullbox' }, { title: 'iPhone 13 Used · Face ID', description: '128GB · Full box' }))).toBe('title negation changed')
    expect(why(judge({ title: 'x 1', description: '128GB · Lỗi loa' }, { title: 'x 1', description: '128GB · Speaker' }))).toBe('negation changed')
    expect(why(judge({ title: 'x 1', description: '128GB · Lỗi loa' }, { title: 'x 1', description: '128GB · Faulty speaker' }))).toBeNull()
    expect(why(judge({ title: 'x 1', description: 'Không sạc, có cáp' }, { title: 'x 1', description: 'Charger, no cable' }))).toBe('negation changed')
    expect(why(judge({ title: 'x 1', description: 'Có sạc' }, { title: 'x 1', description: "Charger isn't included" }))).toBe('negation changed')
    expect(why(judge({ title: 'x 1', description: 'Không sạc' }, { title: 'x 1', description: "Charger isn't included" }))).toBeNull()
    expect(why(judge({ title: 'x 1', description: '128GB · Vỡ màn' }, { title: 'x 1', description: '128GB · Screen' }))).toBe('negation changed')
    expect(why(judge({ title: 'x 1', description: '128GB · Trầy xước nhẹ' }, { title: 'x 1', description: '128GB · Light scratches' }))).toBeNull()
    expect(why(judge({ title: 'x 1', description: 'Giá 5.000.000đ, phụ phí 100 USD' }, { title: 'x 1', description: 'Price 5.000.000 USD, fee 100 VND' }))).toBe('currency changed')
    expect(why(judge({ title: 'iPhone 13 giá 5.000.000đ', description: '128GB' }, { title: 'iPhone 13 price 5.000.000 USD', description: '128GB' }))).toBe('currency changed')
  })
  it('taking "TBH" out of a title never takes a digit with it', () => {
    expect(titleForModel('iPhone 13 TBH')).toBe('iPhone 13')
    expect(titleForModel('iPhone 13TBH')).toBe('iPhone 13TBH')
    expect(sourceRefusal({ title: 'iPhone 13TBH', description: 'Hàng cũ' })).toBe('title warranty wording not in the table')
  })
  it('English only, and no new goods', () => {
    expect(why(judge(HH, { title: T, description: '128GB · Xanh dương · No accessories' }))).toBe('still Vietnamese')
    expect(why(judge(HH, { title: 'New iPhone 13 128GB', description: '128GB · Blue · No accessories' }))).toBe('new-goods wording')
  })
  it('a title without "TBH" gets no warranty phrase', () => {
    expect(finalTitle('iPhone 13 Cũ', 'iPhone 13 Used')).toBe('iPhone 13 Used')
  })
})

describe('the store line', () => {
  it('is the address without diacritics, never translated into other words', () => {
    expect(storeLine('Số 489B Đỗ Xuân Hợp')).toBe('Store: No. 489B Do Xuan Hop')
    expect(storeLine('92 Nguyễn Ái Quốc - Khu Phố 8A')).toBe('Store: 92 Nguyen Ai Quoc - Khu Pho 8A')
  })
})

describe('no false refusals on correct English (round 21, measured on Hoàng Hà rows)', () => {
  it('a source with its own English negation, "Stainless", and comma counts that differ', () => {
    expect(why(judge({ title: 'x 1', description: 'Mặc định · Trắng · no box' }, { title: 'x 1', description: 'Default · White · No box' }))).toBeNull()
    expect(why(judge({ title: 'Apple Watch Series 8 45mm Gold Stainless Steel Case', description: '128GB' }, { title: 'Apple Watch Series 8 45mm Gold Stainless Steel Case', description: '128GB' }))).toBeNull()
    expect(why(judge({ title: 'x 1', description: '4GB/128GB · Đen · Hộp, Sạc,Cáp, Ốp Lưng' }, { title: 'x 1', description: '4GB/128GB · Black · Box, charger, cable, phone case' }))).toBeNull()
  })
})

describe('a negation whose parts do not line up', () => {
  it('is refused when the source has several parts and one is negated', () => {
    expect(why(judge({ title: 'x 1', description: 'Không sạc, có cáp' }, { title: 'x 1', description: 'Charger and no cable' }))).toBe('negation changed')
    expect(why(judge({ title: 'x 1', description: 'Không dây sạc' }, { title: 'x 1', description: 'Wireless charging' }))).toBe('negation changed')
    expect(why(judge({ title: 'Tai nghe không dây B1', description: '128GB' }, { title: 'Wireless earphones B1', description: '128GB' }))).toBeNull()
  })
})

describe('title numbers keep their order', () => {
  it('a model number and a capacity never trade places', () => {
    expect(why(judge({ title: 'iPhone 13 128GB Cũ', description: '128GB · Fullbox' }, { title: 'iPhone 128 13GB Used', description: '128GB · Full box' }))).toBe('title numbers changed')
  })
})
