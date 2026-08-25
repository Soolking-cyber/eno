import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isLegalSpec, type SpecKey } from './electronics-specs'
import { VI_CHARS, guardDescription, isGroundedInTitle, reconcileSpecs } from './ai-describe-guard'

const base = {
  subcategorySlug: 'laptops-pcs',
  title: 'Laptop ASUS VivoBook 14 M1407KA-LY849W',
  titleVi: null,
  attributes: { laptopSize: '14' } as Record<string, string>,
  descVi: 'ASUS VivoBook 14 la chiec laptop mong nhe danh cho cong viec hang ngay va hoc tap.',
}
const ok = (descEn: string, over: Partial<typeof base> = {}) =>
  guardDescription({ ...base, ...over, descEn })

describe('guardDescription — uncorroborated spec claims', () => {
  /**
   * ⛔ THE HOLE THIS MODULE EXISTS FOR. `isLegalSpec` guards the attributes column; nothing guarded
   * prose. A spec invented in a sentence reaches JSON-LD, the Facebook catalog and the Google
   * Merchant feed, all fetched unattended.
   */
  it('rejects a spec asserted in prose that neither the title nor the attributes back', () => {
    const r = ok('The ASUS VivoBook 14 is a slim laptop with 16GB RAM and a 512GB SSD for everyday work.')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reasons.join(' ')).toContain('ram=16')
      expect(r.reasons.join(' ')).toContain('storage=512')
    }
  })
  it('accepts prose whose specs match the title', () => {
    expect(ok('The ASUS VivoBook 14 is a slim 14-inch laptop built for everyday productivity and study.').ok).toBe(true)
  })
  it('accepts a spec that a validated attribute backs', () => {
    const r = ok('This iPhone 15 carries 128GB of storage and a bright display for everyday use.',
      { subcategorySlug: 'phones-tablets', title: 'iPhone 15', attributes: { storage: '128' } })
    expect(r.ok).toBe(true)
  })
  it('rejects a capacity that contradicts the title', () => {
    const r = ok('This iPhone 15 carries 512GB of storage and a bright display for everyday use.',
      { subcategorySlug: 'phones-tablets', title: 'iPhone 15 128GB', attributes: { storage: '128' } })
    expect(r.ok).toBe(false)
  })
  // ⚠️ The Vietnamese slot is checked too — a fabricated spec is no safer in Vietnamese.
  it('checks the Vietnamese slot for the same fabrication', () => {
    const r = guardDescription({ ...base, descEn: 'A slim 14-inch laptop for everyday study and work at home.',
      descVi: 'Laptop mong nhe voi 32GB RAM cho cong viec hang ngay.' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reasons.join(' ')).toContain('vi: uncorroborated spec claim ram=32')
  })
})

describe('guardDescription — claims a marketplace that takes no payment cannot make', () => {
  const cases: [string, string][] = [
    ['warranty', 'A slim 14-inch laptop for study, covered by a 12-month warranty from the shop.'],
    ['shipping', 'A slim 14-inch laptop for study, with free shipping anywhere in the country.'],
    ['returns', 'A slim 14-inch laptop for study, with 7-day returns if you change your mind.'],
    ['price', 'A slim 14-inch laptop for study, now only 18.290.000 đ for a limited time.'],
    ['discount', 'A slim 14-inch laptop for study — save 20% on this model while stocks last.'],
    ['superlative', 'A slim 14-inch laptop for study, the cheapest model of its kind available.'],
    ['url', 'A slim 14-inch laptop for study. Read the full specification at https://example.com'],
    ['phone', 'A slim 14-inch laptop for study. Call 0912 345 678 to ask about this model.'],
    ['stock', 'A slim 14-inch laptop for study, in stock and ready to dispatch right now.'],
  ]
  it.each(cases)('rejects a %s claim', (_label, text) => {
    expect(ok(text).ok).toBe(false)
  })
})

describe('guardDescription — the gaps reviewers found after the first version', () => {
  /**
   * ⛔ `\b` AROUND A VIETNAMESE PHRASE CAN NEVER MATCH. JS word boundaries are ASCII-only, so
   * `\bđổi trả\b` needs a word char before "đ" — measured: a returns promise in Vietnamese sailed
   * through while the English "returns" was caught. Fifth appearance of this trap here.
   */
  it('catches a Vietnamese claim, accented and unaccented', () => {
    const vi = (t: string) => guardDescription({ ...base, descEn: 'A slim 14-inch laptop for everyday study and work.', descVi: t })
    expect(vi('San pham duoc doi tra trong 7 ngay tai cua hang.').ok).toBe(false)
    expect(vi('Sản phẩm được đổi trả trong 7 ngày tại cửa hàng.').ok).toBe(false)
    expect(vi('May co bao hanh 12 thang tai trung tam.').ok).toBe(false)
    expect(vi('Laptop mỏng nhẹ dành cho công việc hằng ngày và học tập.').ok).toBe(true)
  })
  // ⚠️ ANY shipping mention, not only a free one — this marketplace never touches the goods.
  it('catches shipping that is not described as free', () => {
    expect(ok('The ASUS VivoBook 14 is a slim laptop. Delivery is available nationwide in two days.').ok).toBe(false)
    expect(ok('The ASUS VivoBook 14 is a slim laptop that ships quickly to buyers everywhere.').ok).toBe(false)
  })
  /**
   * ⛔ THE PRICE RULE WAS REWRITTEN AFTER THREE ROUNDS OF HOLES: a leading `\b` governed the `$`
   * branch (space-then-`$` is not a boundary, so "$999" was uncaught), the real đồng sign `₫` was
   * missing, "VND 18.290.000" puts the code BEFORE the number, and `\btỷ\b` can never match
   * because `ỷ` is not an ASCII word character.
   */
  it('catches every shape a price gets written in', () => {
    for (const p of [
      'costing around 99 USD for most buyers',
      'priced near 18 trieu for most buyers',
      'at about 18 million for most buyers',
      'priced at $999 for most buyers today',
      'at 18.290.000₫ for most buyers today',
      'at VND 18.290.000 for most buyers today',
      'costing 2 ty dong for most buyers today',
    ]) expect(ok(`The ASUS VivoBook 14 is a slim laptop ${p} and daily study.`).ok, p).toBe(false)
  })
  it('does not mistake an ordinary spec sentence for a price', () => {
    expect(ok('The ASUS VivoBook 14 is a slim 14-inch laptop with a bright display for study.').ok).toBe(true)
  })
  it('treats a guarantee as the warranty it is', () => {
    expect(ok('The ASUS VivoBook 14 is a slim laptop with guaranteed quality for daily study.').ok).toBe(false)
  })
  it('still accepts an honest, plain description', () => {
    expect(ok('The ASUS VivoBook 14 is a slim 14-inch laptop built for everyday study and office work.').ok).toBe(true)
  })
})

describe('guardDescription — the đồng trap', () => {
  /**
   * ⛔ `đ` IS IN THE VIETNAMESE-DETECTION CLASS. translate-imported-listings.ts re-translates any
   * row whose description matches it, so an English description containing the đồng symbol or a
   * place name with diacritics is machine-translated over itself and mangled.
   */
  it('rejects English containing any Vietnamese character', () => {
    const r = ok('A slim 14-inch laptop, shipped to buyers in Đà Nẵng and elsewhere in the country.')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reasons.join(' ')).toContain('Vietnamese characters')
  })
  it('allows Vietnamese characters in the Vietnamese slot', () => {
    const r = guardDescription({ ...base, descEn: 'A slim 14-inch laptop built for everyday study and work.',
      descVi: 'Laptop mỏng nhẹ dành cho công việc hằng ngày và học tập tại nhà.' })
    expect(r.ok).toBe(true)
  })
  // ⚠️ The class is copied from the script deliberately; if the script's changes, this must too.
  it('stays in sync with the script that would overwrite the description', () => {
    const src = readFileSync('scripts/translate-imported-listings.ts', 'utf8')
    const m = src.match(/const VI_RE = (\/\[[^\n]+?\]\/i)/)
    expect(m, 'VI_RE not found in translate-imported-listings.ts').toBeTruthy()
    expect(m![1]).toBe(VI_CHARS.toString())
  })
})

describe('guardDescription — length', () => {
  it('rejects a stub and a wall of text', () => {
    expect(ok('Too short.').ok).toBe(false)
    expect(ok('A slim 14-inch laptop. '.repeat(60)).ok).toBe(false)
  })
})

describe('isGroundedInTitle — the gate the closed list cannot be', () => {
  /**
   * ⛔ `isLegalSpec` passes all 279 (key,value) pairs in the schema — it tests WELL-FORMEDNESS, not
   * truth. It caught the 134-iPhone incident only because ram=128 is malformed for a phone. It
   * cannot catch a legal-but-false value; this can.
   */
  it('catches a legal, well-formed, FALSE capacity', () => {
    expect(isLegalSpec('storage', '512', 'phones-tablets')).toBe(true)
    expect(isGroundedInTitle('storage', '512', 'iPhone 15 128GB', null)).toBe(false)
  })
  it('accepts what the title actually says, including TB and decimal forms', () => {
    expect(isGroundedInTitle('storage', '1024', 'MacBook Air M5 13-inch 1TB', null)).toBe(true)
    expect(isGroundedInTitle('laptopSize', '15', 'LG Gram 15.6 inch', null)).toBe(true)
    expect(isGroundedInTitle('ram', '16', 'Laptop 16GB 512GB', null)).toBe(true)
  })
  // ⚠️ Aliases are what the merchant WRITES, never an inference: "U5" is Intel's own shorthand.
  it('accepts a manufacturer alias present in the title', () => {
    expect(isGroundedInTitle('cpu', 'ultra5', 'PC Mini Asus NUC 14 Pro Revel Canyon U5', null)).toBe(true)
    expect(isGroundedInTitle('connectivity', 'lte', 'Apple Watch 46mm 4G', null)).toBe(true)
  })
  /**
   * ⚠️ THESE ARE CORRECT AND STILL REFUSED, WHICH IS THE POINT. A Dell Vostro 3530 really is
   * 15.6 inches and S501MD-512400079W really is an i5-12400 — but neither string is readable in
   * anything we hold, and attributes publish to Google Merchant unattended.
   */
  /**
   * ⛔ THE UNANCHORED-SUBSTRING BUG, FOUND BY THREE REVIEWERS IN ONE ROUND. The first version asked
   * `title.includes("8")`, and "8" sits inside "128GB" — so a model-recalled `ram: "8"` on an
   * "iPhone 16 Pro 128GB" read as grounded and the gate collapsed for every small number.
   */
  it('refuses a number that only appears inside a longer number', () => {
    expect(isGroundedInTitle('ram', '8', 'iPhone 16 Pro 128GB', null)).toBe(false)
    expect(isGroundedInTitle('laptopSize', '15', 'Laptop Dell Vostro 3515', null)).toBe(false)
    expect(isGroundedInTitle('storage', '64', 'Laptop Ryzen 7640HS', null)).toBe(false)
  })
  // ⚠️ A number counts only WITH ITS UNIT — "16" alone in a model name is not 16GB of anything.
  it('requires the unit, not just the digits', () => {
    expect(isGroundedInTitle('ram', '16', 'Laptop 16GB 512GB', null)).toBe(true)
    expect(isGroundedInTitle('ram', '16', 'Apple Watch Series 16', null)).toBe(false)
    expect(isGroundedInTitle('caseSize', '44', 'Apple Watch SE 44mm GPS', null)).toBe(true)
    expect(isGroundedInTitle('refreshRate', '165', 'Monitor 27 inch 165Hz', null)).toBe(true)
  })
  it('refuses product knowledge the title does not state', () => {
    expect(isGroundedInTitle('laptopSize', '15', 'Laptop Dell Vostro 3530 2H1TPI7', null)).toBe(false)
    expect(isGroundedInTitle('cpu', 'i5', 'ASUS S501MD-512400079W office PC', null)).toBe(false)
  })
  /**
   * ⛔ RAM AND STORAGE SHARE THE "GB" UNIT. "Laptop Asus 16GB RAM" contains both the number and the
   * unit, so a naive check grounded `storage: "16"` from it and would have published a fabricated
   * capacity. The deterministic extractor already knows which slot a labelled capacity belongs to.
   */
  it('does not let a RAM figure ground a storage claim', () => {
    expect(isGroundedInTitle('storage', '16', 'Laptop Asus 16GB RAM', null)).toBe(false)
    expect(isGroundedInTitle('ram', '16', 'Laptop Asus 16GB RAM', null)).toBe(true)
    expect(isGroundedInTitle('storage', '512', 'Laptop Asus 16GB RAM 512GB SSD', null)).toBe(true)
  })
  // ⚠️ Merchants hyphenate at least as often as they space: "13-inch", "15.6-inch", "1-TB".
  it('reads a hyphenated unit', () => {
    expect(isGroundedInTitle('laptopSize', '13', 'MacBook Air M5 13-inch 2026', null)).toBe(true)
    expect(isGroundedInTitle('screenSize', '27', 'Monitor 27-inch gaming', null)).toBe(true)
    expect(isGroundedInTitle('laptopSize', '15', 'LG Gram 15.6-inch', null)).toBe(true)
    expect(isGroundedInTitle('storage', '1024', 'MacBook 1-TB model', null)).toBe(true)
  })
  it('reads the Vietnamese title too', () => {
    expect(isGroundedInTitle('ram', '8', 'Phone', 'Điện thoại 8GB 256GB')).toBe(true)
  })
})

describe('reconcileSpecs', () => {
  const legal = (k: string, v: string) => isLegalSpec(k as SpecKey, v, 'laptops-pcs')
  const grounded = () => true
  it('adds what the model found and the regex could not reach', () => {
    const r = reconcileSpecs({ laptopSize: '14' }, { cpu: 'i5' }, legal, grounded)
    expect(r.merged).toEqual({ laptopSize: '14', cpu: 'i5' })
    expect(r.added).toEqual(['cpu'])
  })
  // ⛔ The deterministic value wins: it reads the merchant's own title and cannot invent one.
  it('keeps the deterministic value on a disagreement and records it', () => {
    const r = reconcileSpecs({ ram: '16' }, { ram: '32' }, legal, grounded)
    expect(r.merged.ram).toBe('16')
    expect(r.conflicts[0]).toContain('kept 16')
  })
  it('drops a value that is not legal for the subcategory', () => {
    const r = reconcileSpecs({}, { ram: '7', cpu: 'pentium' }, legal, grounded)
    expect(r.merged).toEqual({})
    expect(r.conflicts).toHaveLength(2)
  })
  // ⛔ Ungrounded values are recorded and refused unless explicitly allowed.
  it('refuses an ungrounded value by default and records it', () => {
    const r = reconcileSpecs({}, { cpu: 'i5' }, legal, () => false)
    expect(r.merged).toEqual({})
    expect(r.ungrounded).toEqual(['cpu=i5'])
    const opt = reconcileSpecs({}, { cpu: 'i5' }, legal, () => false, true)
    expect(opt.merged).toEqual({ cpu: 'i5' })
    expect(opt.ungrounded).toEqual(['cpu=i5'])
  })
  it('ignores empty and missing model output', () => {
    expect(reconcileSpecs({ ram: '8' }, undefined, legal, grounded).merged).toEqual({ ram: '8' })
    expect(reconcileSpecs({ ram: '8' }, { cpu: '' }, legal, grounded).merged).toEqual({ ram: '8' })
  })
})

describe('guardDescription — the false positives that a blind revert would have destroyed', () => {
  const g = (descEn: string, descVi = 'Dien thoai thong minh phu hop cho nhu cau su dung hang ngay cua ban.') =>
    guardDescription({ subcategorySlug: null, title: 'X', titleVi: null, attributes: {}, descEn, descVi })

  /**
   * ⛔ ENGLISH USES "DELIVER" FOR EVERYTHING. A flat `\b(deliver|delivers|delivery)\b` flagged 754
   * good descriptions — "delivers cable-free typing", "quick power delivery", "delivers durable
   * protection" — none of which promise to send anyone anything. The verify pass reported them as
   * 13% failures and the fix was found by READING them rather than trusting the count.
   */
  it('allows the ordinary English sense of deliver', () => {
    expect(g('The Aula S99 Pro is a wireless keyboard. It delivers cable-free typing for work.').ok).toBe(true)
    expect(g('The Baseus GaN5 Pro is a 65W charger with a cable for quick power delivery here.').ok).toBe(true)
    expect(g('The Spigen case delivers durable daily protection and supports magnetic mounting.').ok).toBe(true)
  })
  it('still catches an actual fulfilment promise', () => {
    expect(g('A neutral product. Delivery is available nationwide within two days for you.').ok).toBe(false)
    expect(g('A neutral product that ships to buyers across the country very quickly indeed.').ok).toBe(false)
    expect(g('A neutral product with free shipping on every order placed here today now.').ok).toBe(false)
  })

  /**
   * ⛔ THE ĐỒNG SIGN IS THE LETTER "Đ", which begins a great many ordinary Vietnamese words. An
   * ASCII lookahead could not tell "32 đến 75 inch" (32 TO 75 inches) from a price, so 345 correct
   * Vietnamese descriptions were flagged. `(?!\p{L})` with the `u` flag can.
   */
  it('does not read a Vietnamese word beginning with đ as a price', () => {
    const en = 'A neutral English description of this product for everyday use at home today.'
    expect(g(en, 'Giá treo tivi tương thích với màn hình kích thước từ 32 đến 75 inch cho phòng khách.').ok).toBe(true)
    expect(g(en, 'Hub Baseus Type-C 4 trong 1 đã qua sử dụng giúp mở rộng cổng kết nối cho laptop.').ok).toBe(true)
  })
  it('still catches a real đồng price', () => {
    const en = 'A neutral English description of this product for everyday use at home today.'
    expect(g(en, 'San pham nay co gia 18.290.000 đ tai cua hang cua chung toi hom nay.').ok).toBe(false)
  })
})
