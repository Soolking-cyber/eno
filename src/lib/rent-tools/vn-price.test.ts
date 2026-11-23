import { describe, expect, it } from 'vitest'
import { MAX_VND, parseVnPrice, unitReading, vietnameseWords } from './vn-price'

const vnd = (s: string) => {
  const r = parseVnPrice(s)
  if (!r.ok) throw new Error(`${s} refused: ${JSON.stringify(r.refusal)}`)
  return r.vnd
}
const code = (s: string) => {
  const r = parseVnPrice(s)
  return r.ok ? `ok:${r.vnd}` : r.refusal.code
}

describe('parseVnPrice · the owner’s examples', () => {
  it.each([
    ['15tr', 15_000_000],
    ['1.5 tỷ', 1_500_000_000],
    ['1,5 tỷ', 1_500_000_000],
    ['800k', 800_000],
    ['15 triệu 500', 15_500_000],
    ['mười lăm triệu', 15_000_000],
    ['2 tỷ 3', 2_300_000_000],
  ])('%s → %d', (input, want) => expect(vnd(input)).toBe(want))
})

describe('parseVnPrice · units and spellings', () => {
  it.each([
    ['15 tr', 15_000_000], ['15 triệu', 15_000_000], ['15 trieu', 15_000_000], ['15 TRIỆU', 15_000_000], ['15 củ', 15_000_000],
    ['15 million', 15_000_000], ['800 nghìn', 800_000], ['800 ngàn', 800_000], ['800 thousand', 800_000], ['2 tỉ', 2_000_000_000],
    ['2 ty', 2_000_000_000], ['1.5 billion', 1_500_000_000], ['1,25 tỷ', 1_250_000_000], ['0,5tr', 500_000], ['1500k', 1_500_000],
    ['1k5', 1_500], ['1tr2', 1_200_000], ['15tr5', 15_500_000], ['15tr500', 15_500_000], ['15 triệu 050', 15_050_000],
    ['2 tỷ 300', 2_300_000_000], ['2 tỷ 300 triệu', 2_300_000_000], ['15 triệu 500 nghìn', 15_500_000], ['15 triệu 500 nghìn 200', 15_500_200],
    ['1500 triệu', 1_500_000_000], ['3 nghìn tỷ', 3_000_000_000_000], ['1 ngàn tỷ', 1_000_000_000_000],
  ])('%s → %d', (input, want) => expect(vnd(input)).toBe(want))

  it('reads a full amount in either grouping, with or without the đồng mark', () => {
    for (const s of ['15000000', '15.000.000', '15,000,000', '15.000.000đ', '15.000.000 đ', '15.000.000 ₫', '15.000.000 VND', '15.000.000 vnđ', '15 000 000', '15\u00a0000\u00a0000 đ']) {
      expect(vnd(s), s).toBe(15_000_000)
    }
    expect(vnd('1.500')).toBe(1_500)
    expect(vnd('500 đ')).toBe(500)
    expect(vnd('500 đồng')).toBe(500)
  })

  it('drops a leading "giá" and a closing per-month suffix, and says the amount is per month', () => {
    expect(vnd('Giá: 15tr')).toBe(15_000_000)
    for (const s of ['15tr/tháng', '15tr / tháng', '15 triệu/th', '15tr/month']) {
      const r = parseVnPrice(s)
      expect(r.ok && r.perMonth, s).toBe(true)
      expect(r.ok && r.vnd, s).toBe(15_000_000)
    }
    const plain = parseVnPrice('15tr')
    expect(plain.ok && plain.perMonth).toBe(false)
  })

  it('decimals are exact, never float-rounded', () => {
    expect(vnd('1,15 tỷ')).toBe(1_150_000_000)
    expect(vnd('2.35 tỷ')).toBe(2_350_000_000)
    expect(vnd('0.07tr')).toBe(70_000)
  })
})

describe('parseVnPrice · spelled-out Vietnamese', () => {
  it.each([
    ['mười lăm triệu', 15_000_000],
    ['hai tỷ ba trăm triệu', 2_300_000_000],
    ['một trăm năm mươi nghìn', 150_000],
    ['một trăm linh năm nghìn', 105_000],
    ['một trăm lẻ năm nghìn', 105_000],
    ['hai mươi mốt triệu', 21_000_000],
    ['hai mươi tư triệu', 24_000_000],
    ['hai lăm nghìn', 25_000],
    ['mười lăm triệu rưỡi', 15_500_000],
    ['15tr rưỡi', 15_500_000],
    ['hai triệu tư', 2_400_000],
    ['hai tỷ ba', 2_300_000_000],
    ['mười lăm triệu năm trăm nghìn', 15_500_000],
    ['hai tỷ không trăm năm mươi triệu', 2_050_000_000],
    ['5 trăm nghìn', 500_000],
    ['năm trăm đồng', 500],
  ])('%s → %d', (input, want) => expect(vnd(input)).toBe(want))
})

describe('parseVnPrice · what it refuses, and why', () => {
  it.each([
    ['', 'empty'], ['   ', 'empty'], ['giá', 'empty'],
    ['-15tr', 'negative'], ['−2 tỷ', 'negative'],
    ['0', 'zero'], ['0tr', 'zero'], ['0 đ', 'zero'],
    ['15-20tr', 'range'], ['15tr - 20tr', 'range'], ['từ 15 đến 20 triệu', 'range'], ['15 to 20 million', 'range'],
    ['15', 'noUnit'], ['500', 'noUnit'], ['mười lăm', 'noUnit'], ['năm trăm', 'noUnit'],
    ['1,5', 'decimalNoUnit'], ['1.5', 'decimalNoUnit'],
    ['1,5 đ', 'fraction'],
    ['abc', 'unknownWord'], ['15m', 'unknownWord'], ['2b', 'unknownWord'], ['muoi lam trieu', 'unknownWord'], ['15tr/năm', 'unknownWord'],
    ['15tr 20tr', 'unitOrder'], ['500 nghìn 2 triệu', 'unitOrder'], ['2 tỷ 3000 triệu', 'unitOrder'],
    ['triệu', 'malformed'], ['15 15', 'malformed'], ['2 tỷ 3000', 'malformed'], ['1,5 tỷ 200 triệu', 'malformed'], ['1.500.000 triệu', 'malformed'],
    ['1.5.5 tr', 'malformed'], ['một trăm năm nghìn', 'malformed'],
  ])('%j → %s', (input, want) => expect(code(input)).toBe(want))

  it('a separator with three digits before a unit: refused, naming both readings', () => {
    const r = parseVnPrice('1.500 triệu')
    expect(r).toEqual({ ok: false, refusal: { code: 'ambiguousSeparator', text: '1.500 triệu', a: 1_500_000_000, b: 1_500_000 } })
    const r2 = parseVnPrice('1,125 tỷ')
    expect(!r2.ok && r2.refusal).toMatchObject({ code: 'ambiguousSeparator', a: 1_125_000_000_000, b: 1_125_000_000 })
  })

  it('two digits after a unit: refused, naming both readings', () => {
    const r = parseVnPrice('15tr50')
    expect(!r.ok && r.refusal).toMatchObject({ code: 'ambiguousTail', a: 15_500_000, b: 15_050_000 })
    const r2 = parseVnPrice('2 tỷ 35')
    expect(!r2.ok && r2.refusal).toMatchObject({ code: 'ambiguousTail', a: 2_350_000_000, b: 2_035_000_000 })
    const r3 = parseVnPrice('hai triệu hai lăm')
    expect(!r3.ok && r3.refusal).toMatchObject({ code: 'ambiguousTail', a: 2_250_000, b: 2_025_000 })
  })

  it('absurd sizes are refused, never Infinity or an inexact number', () => {
    expect(vnd('1 triệu tỷ')).toBe(MAX_VND)
    expect(code('1001 nghìn tỷ')).toBe('tooLarge')
    expect(code('9999999999999999999999')).toBe('tooLarge')
    expect(code('1e30')).toBe('unknownWord')
    expect(code('999999999999 tỷ')).toBe('tooLarge')
    expect(vnd('1000 nghìn tỷ')).toBe(MAX_VND)
  })

  it('never returns NaN, Infinity, a fraction or a negative for anything it accepts', () => {
    const inputs = ['15tr', '1,5 tỷ', '0,01k', '1k5', '2 tỷ 3', 'hai tỷ ba', '999 nghìn tỷ', '15 triệu 500 nghìn 200', '1.000', '001tr']
    for (const s of inputs) {
      const r = parseVnPrice(s)
      if (r.ok) {
        expect(Number.isSafeInteger(r.vnd), s).toBe(true)
        expect(r.vnd, s).toBeGreaterThan(0)
      }
    }
  })
})

describe('parseVnPrice · a tail that is đồng, not shorthand (gate round 1)', () => {
  /**
   * ⛔ "1 triệu 500 đồng" READ AS 1.500.000: the shorthand continued the unit although the reader wrote đồng after the
   * digits. Both readings are real, so it is refused naming both; the bare shorthand is unchanged.
   */
  it('an explicit đồng after a continuing tail is refused with both readings; without it the shorthand stands', () => {
    expect(parseVnPrice('1 triệu 500 đồng')).toEqual({ ok: false, refusal: { code: 'ambiguousCurrency', text: '1 triệu 500', a: 1_500_000, b: 1_000_500 } })
    expect(vnd('1 triệu 500')).toBe(1_500_000)
    for (const s of ['1tr500đ', '1 triệu 500 VND', '2 tỷ 3 đồng', 'hai triệu tư đồng', '1k5 đ']) expect(code(s), s).toBe('ambiguousCurrency')
    const one = parseVnPrice('2 tỷ 3 đồng')
    expect(!one.ok && one.refusal).toMatchObject({ a: 2_300_000_000, b: 2_000_000_003 })
  })

  it('…unless the two readings agree: three digits after nghìn are đồng either way', () => {
    expect(vnd('800 nghìn 500 đồng')).toBe(800_500)
    expect(vnd('800k500đ')).toBe(800_500)
  })

  /**
   * ⛔ A SPELLED TAIL WITH ITS HUNDREDS SAID IS A LITERAL GROUP OF ĐỒNG — vietnameseWords(1.000.050) is "một triệu không
   * trăm năm mươi", and it read back as 1.050.000. "X trăm" after a unit is đồng too (a note says how to say nghìn).
   */
  it('"không trăm …" and "X trăm …" after a unit are đồng, with or without the mark', () => {
    for (const [s, want] of [
      ['một triệu không trăm năm mươi', 1_000_050],
      ['một triệu không trăm năm mươi đồng', 1_000_050],
      ['một triệu không trăm linh một', 1_000_001],
      ['mười lăm triệu năm trăm', 15_000_500],
      ['15 triệu 5 trăm', 15_000_500],
      ['hai tỷ không trăm năm mươi', 2_000_000_050],
    ] as const) expect(vnd(s), s).toBe(want)
    const r = parseVnPrice('mười lăm triệu năm trăm')
    expect(r.ok && r.notes).toEqual([{ kind: 'literal', tail: 'năm trăm', unit: 'triệu', adds: 500 }])
  })

  it('a compound count of tỷ — vietnameseWords’ own form from 1.000 tỷ up — reads as one number', () => {
    expect(vnd('một nghìn năm trăm tỷ')).toBe(1_500_000_000_000)
    expect(vnd('một nghìn tỷ hai trăm triệu')).toBe(1_000_200_000_000)
    expect(vnd('1,5 nghìn tỷ')).toBe(1_500_000_000_000)
    expect(code('500 nghìn 2 tỷ')).toBe('unitOrder')
    expect(code('2 triệu 1 tỷ')).toBe('unitOrder')
    expect(code('2 triệu tỷ')).toBe('tooLarge')
  })
})

describe('parseVnPrice · gate round 2', () => {
  /** ⛔ "1 triệu 50 đồng" offered 1.500.000 / 1.050.000 and left out what was written: 1.000.050. */
  it('two digits after a unit plus an explicit đồng: the as-written reading is among those offered', () => {
    expect(parseVnPrice('1 triệu 50 đồng')).toEqual({ ok: false, refusal: { code: 'ambiguousTailCurrency', text: '1 triệu 50', a: 1_500_000, b: 1_050_000, c: 1_000_050 } })
    const tr = parseVnPrice('15tr50đ')
    expect(!tr.ok && tr.refusal).toMatchObject({ code: 'ambiguousTailCurrency', c: 15_000_050 })
    // After nghìn the next unit already is đồng: two readings, the as-written one included.
    expect(parseVnPrice('800 nghìn 50 đồng')).toEqual({ ok: false, refusal: { code: 'ambiguousCurrency', text: '800 nghìn 50', a: 800_500, b: 800_050 } })
    // Without the mark, the shorthand's two readings as before.
    expect(code('1 triệu 50')).toBe('ambiguousTail')
  })

  /** ⛔ The digit-count cap refused exactly MAX_VND; the limit is the value, inclusive. */
  it('a full figure up to MAX_VND inclusive reads; one đồng more is too large', () => {
    for (const s of ['1000000000000000', '1.000.000.000.000.000', '1,000,000,000,000,000', '1.000.000.000.000.000 đ', '0001000000000000000']) expect(vnd(s), s).toBe(MAX_VND)
    for (const s of ['1000000000000001', '1.000.000.000.000.001', '99999999999999999999']) expect(code(s), s).toBe('tooLarge')
    expect(vnd('999.999.999.999.999')).toBe(999_999_999_999_999)
  })
})

describe('vietnameseWords ↔ parseVnPrice: every amount the words function writes parses back exactly', () => {
  /** A spread across every group shape — zero groups, linh, mười, mốt/tư/lăm, compound tỷ — plus seeded random amounts. */
  const FIXED = [
    1_000, 1_001, 1_010, 1_015, 1_105, 1_500, 21_000, 105_000, 999_999, 1_000_001, 1_000_050, 1_005_000, 1_050_000, 2_000_500,
    15_000_500, 15_500_000, 20_400_000, 21_021_021, 110_000_000, 999_999_999, 1_000_000_000, 2_000_000_050, 2_050_000_000,
    2_300_000_000, 1_000_000_000_000, 1_500_000_000_050, 123_456_789_012_345, 999_999_999_999_999, 1_000_000_000_000_000,
  ]
  const seeded = (() => {
    let x = 0x2f6b_1d3c
    const out: number[] = []
    for (let i = 0; i < 400; i++) {
      x = (Math.imul(x, 1_103_515_245) + 12_345) >>> 0
      const digits = 4 + (x % 12) // 4–15 digits
      x = (Math.imul(x, 1_103_515_245) + 12_345) >>> 0
      out.push(Math.max(1_000, Math.floor((x / 2 ** 32) * 10 ** digits)))
    }
    return out
  })()

  it.each(FIXED)('%d', (n) => {
    const words = vietnameseWords(n)
    expect(vnd(words), words).toBe(n)
    expect(vnd(`${words} đồng`), `${words} đồng`).toBe(n)
  })

  it('400 seeded amounts from 1.000 to 10^15, bare and with “đồng”', () => {
    const wrong = seeded.filter((n) => {
      const a = parseVnPrice(vietnameseWords(n))
      const b = parseVnPrice(`${vietnameseWords(n)} đồng`)
      return !(a.ok && a.vnd === n && b.ok && b.vnd === n)
    })
    expect(wrong).toEqual([])
  })

  it('under 1.000 the words alone have no unit and are refused; with “đồng” they read back', () => {
    for (const n of [1, 5, 15, 21, 105, 110, 500, 999]) {
      expect(code(vietnameseWords(n)), String(n)).toBe('noUnit')
      expect(vnd(`${vietnameseWords(n)} đồng`), String(n)).toBe(n)
    }
  })
})

describe('parseVnPrice · notes say what the reading did', () => {
  it('a tail names what it added; a bare number says it was taken as đồng; rưỡi says half', () => {
    const tail = parseVnPrice('15 triệu 500')
    expect(tail.ok && tail.notes).toEqual([{ kind: 'tail', tail: '500', unit: 'triệu', adds: 500_000 }])
    const bare = parseVnPrice('15000000')
    expect(bare.ok && bare.notes).toEqual([{ kind: 'bare' }])
    expect((parseVnPrice('15.000.000') as { notes: unknown[] }).notes).toEqual([])
    const half = parseVnPrice('15tr rưỡi')
    expect(half.ok && half.notes).toEqual([{ kind: 'half', unit: 'triệu' }])
  })
})

describe('vietnameseWords — the amount as a contract writes it', () => {
  it.each([
    [0, 'không'],
    [5, 'năm'],
    [15, 'mười lăm'],
    [21, 'hai mươi mốt'],
    [24, 'hai mươi tư'],
    [25, 'hai mươi lăm'],
    [105, 'một trăm linh năm'],
    [110, 'một trăm mười'],
    [800_000, 'tám trăm nghìn'],
    [15_000_000, 'mười lăm triệu'],
    [15_500_000, 'mười lăm triệu năm trăm nghìn'],
    [15_050_000, 'mười lăm triệu không trăm năm mươi nghìn'],
    [1_005_000, 'một triệu không trăm linh năm nghìn'],
    [1_000_050, 'một triệu không trăm năm mươi'],
    [2_300_000_000, 'hai tỷ ba trăm triệu'],
    [2_050_000_000, 'hai tỷ không trăm năm mươi triệu'],
    [1_500_000_000_000, 'một nghìn năm trăm tỷ'],
    [1_000_000_000_000, 'một nghìn tỷ'],
  ])('%d → %s', (n, words) => expect(vietnameseWords(n)).toBe(words))

  it('answers nothing for a value it cannot read', () => {
    expect(vietnameseWords(-1)).toBe('')
    expect(vietnameseWords(1.5)).toBe('')
    expect(vietnameseWords(Number.NaN)).toBe('')
  })
})

describe('unitReading — the shorthand’s own units, exact', () => {
  it('in English and Vietnamese, zero groups left out', () => {
    expect(unitReading(15_500_000, 'en')).toBe('15 million 500 thousand')
    expect(unitReading(15_500_000, 'vi')).toBe('15 triệu 500 nghìn')
    expect(unitReading(2_300_000_000, 'en')).toBe('2 billion 300 million')
    expect(unitReading(1_500_000_000_000, 'vi')).toBe('1.500 tỷ')
    expect(unitReading(1_500_000_000_000, 'en')).toBe('1,500 billion')
    expect(unitReading(800_500, 'en')).toBe('800 thousand 500')
    expect(unitReading(0, 'en')).toBe('')
  })
})
