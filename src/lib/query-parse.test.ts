import { describe, it, expect } from 'vitest'
import { parseQuery } from './query-parse'

/**
 * ⚠️ THE NEGATIVE CASES ARE THE POINT OF THIS FILE, not the happy path.
 *
 * parseQuery's whole design premise is that a FALSE parse is worse than no parse: a wrong facet
 * deletes part of the model name from the query and then hides the listings that do exist. So the
 * "refuses to parse" describe block below is the one that must never be weakened to make a new
 * feature pass — each case in it is a real string a buyer types on this marketplace (4K TVs, GPUs,
 * m² floor areas, diesel trim codes, memory sizes, phone numbers), and each one would have become a
 * price or a year under a looser rule.
 *
 * THE CLOCK IS PINNED. The year window's upper bound is `now`'s year + 1, so with a live clock this
 * suite would start failing on 1 January and the 2027/2028 boundary cases would silently swap
 * meaning. NOW below fixes the window at 1990…2027.
 */
const NOW = new Date('2026-08-11T00:00:00Z')
const parse = (q: string) => parseQuery(q, { now: NOW })

describe('parseQuery — the wireframe example', () => {
  it('lifts a year and a price ceiling out, leaving the model behind', () => {
    const r = parse('honda vision 2024 duoi 8 trieu')
    expect(r.year).toBe(2024)
    expect(r.priceMax).toBe(8_000_000)
    expect(r.priceMin).toBeUndefined()
    expect(r.text).toBe('honda vision')
  })

  it('reads the ACCENTED spelling identically', () => {
    const r = parse('honda vision 2024 dưới 8 triệu')
    expect(r.year).toBe(2024)
    expect(r.priceMax).toBe(8_000_000)
    expect(r.text).toBe('honda vision')
  })

  it('keeps the residual in the ORIGINAL casing and accents — it is going back in a search box', () => {
    const r = parse('Honda Vision 2024 Dưới 8 Triệu')
    expect(r.year).toBe(2024)
    expect(r.priceMax).toBe(8_000_000)
    expect(r.text).toBe('Honda Vision')
  })

  it('hands the chip row everything it needs: kind, value, the exact words, and whether we guessed', () => {
    const r = parse('honda vision 2024 dưới 8 triệu')
    expect(r.facets).toEqual([
      { kind: 'year', value: 2024, source: '2024', explicit: false },
      { kind: 'priceMax', value: 8_000_000, source: 'dưới 8 triệu', explicit: true },
    ])
  })
})

describe('parseQuery — Vietnamese money words', () => {
  const cases: [string, number][] = [
    ['8tr', 8_000_000],
    ['8 tr', 8_000_000],
    ['8 trieu', 8_000_000],
    ['8 triệu', 8_000_000],
    ['8triệu', 8_000_000],
    ['800k', 800_000],
    ['800 k', 800_000],
    ['950k', 950_000], // the top of the k-shorthand band, just under guard 5's 1.000 ceiling
    ['800 nghìn', 800_000],
    ['800 ngan', 800_000],
    ['1 tỷ', 1_000_000_000],
    ['1 ty', 1_000_000_000],
    ['1tỉ', 1_000_000_000],
    ['8000000đ', 8_000_000],
    ['8000000 vnd', 8_000_000],
  ]
  for (const [input, expected] of cases) {
    it(`reads "${input}" as ${expected}`, () => {
      expect(parse(input).priceMax).toBe(expected)
    })
  }

  it('reads English million/billion words too', () => {
    expect(parse('8 million').priceMax).toBe(8_000_000)
    expect(parse('2 billion').priceMax).toBe(2_000_000_000)
  })

  /**
   * ⚠️ A TRAILING CURRENCY WORD BELONGS TO THE AMOUNT. "dưới 8 triệu đồng" is one phrase, and
   * claiming only "8 triệu" stranded "đồng" in the free text — a word no listing title contains, so
   * it silently suppressed the very matches the query was for.
   */
  it('swallows a trailing đồng / VND instead of stranding it in the search text', () => {
    expect(parse('honda vision dưới 8 triệu đồng')).toEqual({
      text: 'honda vision',
      priceMax: 8_000_000,
      facets: [{ kind: 'priceMax', value: 8_000_000, source: 'dưới 8 triệu đồng', explicit: true }],
    })
    expect(parse('bike 8 million VND').text).toBe('bike')
    expect(parse('áo 800k đồng').text).toBe('áo')
  })

  /**
   * ⚠️ A BARE GROUPED NUMBER IS ONLY MONEY IF IT ENDS IN A ROUND THOUSAND, and the "no phone number
   * can match" claim that preceded this rule was disproved by measurement: "+84 912.345.678" leads
   * with three digits and became a 912.345.678 ₫ ceiling. The đồng has no practical sub-thousand
   * unit, so a quoted price is round and an identifier is not. The refusal cases are in the
   * "refuses to parse" block; these are the prices that must keep working.
   */
  it('handles BOTH separator conventions — vi groups with dots, en with commas', () => {
    expect(parse('8.000.000').priceMax).toBe(8_000_000)
    expect(parse('8,000,000').priceMax).toBe(8_000_000)
    expect(parse('honda vision 11.500.000').priceMax).toBe(11_500_000)
  })

  it('swallows a trailing "trở xuống" — it agrees with the ceiling, so it is not left in the text', () => {
    // The bound was always right here; what was wrong was the residual "xe trở xuống", two words no
    // listing title contains, suppressing the matches the query was for.
    expect(parse('xe 20 triệu trở xuống')).toEqual({
      text: 'xe',
      priceMax: 20_000_000,
      facets: [{ kind: 'priceMax', value: 20_000_000, source: '20 triệu trở xuống', explicit: false }],
    })
    expect(parse('bike 20 million or less').text).toBe('bike')
  })

  it('an explicit comparator still trusts a non-round figure — the rule only gates the INFERENCE', () => {
    expect(parse('dưới 8.123.456').priceMax).toBe(8_123_456)
  })

  it('handles a decimal in either convention: "8,5 triệu" and "8.5tr" are the same money', () => {
    expect(parse('8,5 triệu').priceMax).toBe(8_500_000)
    expect(parse('8.5tr').priceMax).toBe(8_500_000)
  })

  /**
   * ⚠️ A 1000x INFLATION, AND IT SHIPPED GREEN UNTIL A REVIEWER FOUND IT. "1,125 triệu" is 1.125
   * triệu read as a vi decimal and 1,125 triệu read as en grouping — a factor of a thousand apart,
   * with nothing in the string to decide. The grouped reading won, so a buyer who meant 1.125.000 ₫
   * got a ceiling of 1,125 TỶ and a feed that could never empty. Three digits after the separator is
   * exactly the collision; one or two is unambiguous and still parses.
   */
  it('refuses a three-digit separator in front of a magnitude unit rather than pick a reading', () => {
    for (const q of ['xe 1,125 triệu', 'xe 1.500 tr', 'xe 2.250 tỷ']) {
      expect(parse(q)).toEqual({ text: q, facets: [] })
    }
    // The unambiguous neighbours must keep working: a 1–2 place decimal, and grouping with no
    // magnitude behind it (there the separators can only mean thousands).
    expect(parse('8,5 triệu').priceMax).toBe(8_500_000)
    expect(parse('dưới 8.000.000').priceMax).toBe(8_000_000)
    expect(parse('8.000.000 đồng').priceMax).toBe(8_000_000)
  })
})

describe('parseQuery — comparators', () => {
  it('dưới / under / below / < all set a CEILING', () => {
    for (const q of ['dưới 8 triệu', 'duoi 8 trieu', 'under 8m', 'below 8tr', '< 8tr', '<8tr', '≤ 8tr']) {
      const r = parse(q)
      expect({ q, max: r.priceMax, min: r.priceMin }).toEqual({ q, max: 8_000_000, min: undefined })
    }
  })

  it('trên / over / above / > all set a FLOOR', () => {
    for (const q of ['trên 20 triệu', 'tren 20 trieu', 'over 20tr', 'above 20tr', '> 20tr', '≥ 20tr']) {
      const r = parse(q)
      expect({ q, max: r.priceMax, min: r.priceMin }).toEqual({ q, max: undefined, min: 20_000_000 })
    }
  })

  /**
   * ⚠️ REGRESSION, AND IT USED TO INVERT THE BUYER'S INTENT RATHER THAN JUST FAIL. A single-character
   * operator split turned ">= 20tr" into ">", "=", "20tr": the floor never parsed, the loose "20tr"
   * was inferred as a CEILING, and someone asking for bikes above 20 triệu was shown only bikes
   * below it — with "> =" left in the search box. Every ASCII compound form is pinned here.
   */
  it('the two-character operators parse as ONE token, glued or spaced', () => {
    for (const q of ['xe >= 20tr', 'xe >=20tr']) {
      const r = parse(q)
      expect({ q, min: r.priceMin, max: r.priceMax, text: r.text }).toEqual({ q, min: 20_000_000, max: undefined, text: 'xe' })
    }
    for (const q of ['xe <= 8tr', 'xe <=8tr']) {
      const r = parse(q)
      expect({ q, min: r.priceMin, max: r.priceMax, text: r.text }).toEqual({ q, min: undefined, max: 8_000_000, text: 'xe' })
    }
  })

  /**
   * ⚠️ A CONTRADICTION IS REFUSED WHOLE. Shipping min 20M with max 8M is an empty set by
   * construction, and one ZeroResults cannot recover: "relax ONE thing" always leaves the other
   * bound standing. Both bounds go back into the text where the buyer can see the mistake.
   */
  it('refuses BOTH bounds when they contradict, and hands the words back', () => {
    const r = parse('xe trên 20 triệu dưới 8 triệu')
    expect(r.priceMin).toBeUndefined()
    expect(r.priceMax).toBeUndefined()
    expect(r.facets).toEqual([])
    expect(r.text).toBe('xe trên 20 triệu dưới 8 triệu')
  })

  /**
   * ⚠️ WHEN ONLY ONE SIDE WAS GUESSED, ONLY THE GUESS GOES. Dropping both let the parser's own
   * inference cancel the buyer's explicit words: measured on "xe trên 20 triệu 8tr", the EXPLICIT
   * floor of 20 triệu was deleted to resolve a conflict with an INFERRED ceiling of 8 triệu — the
   * explicit-beats-inferred doctrine inverted at the very last step.
   */
  it('an explicit bound survives a contradiction with an inferred one', () => {
    const r = parse('xe trên 20 triệu 8tr')
    expect(r.priceMin).toBe(20_000_000)
    expect(r.priceMax).toBeUndefined()
    expect(r.text).toBe('xe 8tr')
  })

  it('keeps a year through a refused contradiction — only the prices are dropped', () => {
    const r = parse('xe 2020 trên 20 triệu dưới 8 triệu')
    expect(r.year).toBe(2020)
    expect(r.priceMin).toBeUndefined()
    expect(r.priceMax).toBeUndefined()
    expect(r.text).toBe('xe trên 20 triệu dưới 8 triệu')
  })

  it('both bounds in one query gives a real range', () => {
    const r = parse('xe trên 5 triệu dưới 8 triệu')
    expect(r.priceMin).toBe(5_000_000)
    expect(r.priceMax).toBe(8_000_000)
    expect(r.text).toBe('xe')
  })

  it('a comparator accepts a BARE number — "dưới 8000000" cannot be anything but a budget', () => {
    const r = parse('dưới 8000000')
    expect(r.priceMax).toBe(8_000_000)
    expect(r.facets[0].explicit).toBe(true)
  })

  /**
   * ⚠️ AN APPROXIMATE PRICE HAS NO BOUND TO SET, AND FOR A WHILE ONLY THE COMMENT SAID SO. The
   * header listed "khoảng / about / ~" as deliberately unparsed while the code read the number
   * behind them as a ceiling: measured, "xe khoảng 8 triệu" returned priceMax 8.000.000. A ceiling
   * is also the wrong direction — "khoảng 8 triệu" widens the target, so capping at 8 triệu hides
   * the 8,5 triệu listing the buyer would have taken.
   */
  it('never turns an approximate price into a ceiling', () => {
    for (const q of ['xe khoảng 8 triệu', 'xe tầm 8 triệu', 'bike about 8 million', 'bike around 8m', 'xe ~ 8tr']) {
      const r = parse(q)
      expect({ q, max: r.priceMax, min: r.priceMin }).toEqual({ q, max: undefined, min: undefined })
    }
  })

  it('a comparator with nothing spendable behind it is left in the text, not eaten', () => {
    const r = parse('kệ trên tường')
    expect(r.facets).toEqual([])
    expect(r.text).toBe('kệ trên tường')
  })

  /**
   * ⚠️ WHAT THE BUYER SAID BEATS WHAT WE GUESSED, regardless of word order. This is the two-pass
   * property: in a single left-to-right pass the inferred ceiling at position 0 would fill the slot
   * and the explicit "dưới 5tr" behind it would be refused.
   */
  it('an EXPLICIT ceiling wins over an inferred one that appeared earlier', () => {
    const r = parse('8tr dưới 5tr')
    expect(r.priceMax).toBe(5_000_000)
    expect(r.facets).toEqual([{ kind: 'priceMax', value: 5_000_000, source: 'dưới 5tr', explicit: true }])
    expect(r.text).toBe('8tr')
  })
})

describe('parseQuery — years', () => {
  it('reads a bare four-digit year inside the window, and marks it INFERRED', () => {
    const r = parse('macbook pro 2019')
    expect(r.year).toBe(2019)
    expect(r.facets[0].explicit).toBe(false)
    expect(r.text).toBe('macbook pro')
  })

  it('đời / year name the facet, so it is EXPLICIT and the noise word goes with it', () => {
    for (const q of ['đời 2024', 'doi 2024', 'year 2024']) {
      const r = parse(q)
      expect({ q, year: r.year, explicit: r.facets[0]?.explicit, text: r.text }).toEqual({ q, year: 2024, explicit: true, text: '' })
    }
  })

  /**
   * ⚠️ "năm" IS NOT A YEAR WORD, AND MUST NOT BE ADDED BACK. It folds to the same token as "nam"
   * (men's) — one of the commonest qualifiers in this catalogue — so it deleted the qualifier and
   * returned women's stock while the chip claimed the buyer had said it. The year still parses; it
   * is simply inferred, which is the honest reading of a bare number.
   */
  it('does not eat "nam", the men-s-wear qualifier — the year still lands, the noun survives', () => {
    for (const q of ['xe đạp nam 2024', 'đồng hồ nam 2024']) {
      const r = parse(q)
      expect({ q, year: r.year, explicit: r.facets[0]?.explicit }).toEqual({ q, year: 2024, explicit: false })
      expect(r.text).toContain('nam')
    }
  })

  it('does not eat "đôi" (a pair) either — the year word must sit immediately before the year', () => {
    const r = parse('đôi giày nike 2024')
    expect(r.year).toBe(2024)
    expect(r.text).toBe('đôi giày nike')
  })

  /**
   * ⚠️ A FOUR-DIGIT NUMBER FOLLOWED BY A MONEY WORD IS MONEY. Before this rule, "xe 2024 triệu"
   * claimed 2024 as a model year and orphaned "triệu" in the residual — the 2.024 tỷ ceiling lost,
   * and a nonsense query ("xe triệu") sent to the feed.
   */
  it('lets an explicit money unit outrank the year reading', () => {
    expect(parse('xe 2024 triệu')).toEqual({
      text: 'xe',
      priceMax: 2_024_000_000,
      facets: [{ kind: 'priceMax', value: 2_024_000_000, source: '2024 triệu', explicit: false }],
    })
    expect(parse('xe 1999 triệu').priceMax).toBe(1_999_000_000)
  })

  /**
   * ⚠️ AND IT MUST NOT DEPEND ON WHAT ELSE IS IN THE QUERY. The first version of the rule above
   * computed the money reading only when no ceiling had been claimed yet, so "xe 1999 triệu" gave a
   * 1.999 tỷ ceiling while the same phrase after an explicit "dưới" gave year 1999 and an orphaned
   * "triệu" — the same three words read two different ways. An already-filled slot now suppresses
   * the FACET only; the words stay in the text rather than becoming a year nobody asked for.
   */
  it('reads a number the same way no matter what follows it in the query', () => {
    const r = parse('xe 1999 triệu dưới 5 triệu')
    expect(r.priceMax).toBe(5_000_000)
    expect(r.year).toBeUndefined()
    expect(r.text).toBe('xe 1999 triệu')
  })

  /**
   * ⚠️ AND THE BLOCK IS UNCONDITIONAL, NOT "ONLY WHEN THE MONEY READING IS VALID" — which is what it
   * said first, until guard 5 falsified it. "xe 2000 k" is refused as money (the k-shorthand stops at
   * 1.000), and under the conditional version the bare-year branch then claimed 2000 instead and
   * orphaned the "k": an invented filter plus a broken text query — and the glued "xe 2000k", the
   * same intent, parsed differently. A four-digit number followed by a money word is money
   * VOCABULARY; if the money reading does not hold, we take nothing and hand the words back whole.
   */
  it('refuses BOTH readings when a money unit follows but the amount is not usable', () => {
    for (const q of ['xe 2024 đ', 'xe 2000 k']) {
      // "2024 đ" is 2.024 ₫ and "2000 k" is a refused shorthand — no valid money, and not a year.
      expect(parse(q)).toEqual({ text: q, facets: [] })
    }
    // The glued spelling of the same intent agrees, which is the property that was broken.
    expect(parse('xe 2000k')).toEqual({ text: 'xe 2000k', facets: [] })
  })

  /**
   * ⚠️ A YEAR BEHIND A COMPARATOR IS A RANGE, AND THERE IS NO RANGE FACET — so it is refused whole.
   * Measured before this rule: "xe đời dưới 2020" (2020-or-older) came back as the EXACT year 2020
   * with the residual "xe đời dưới" — a filter the buyer never asked for plus two orphaned words.
   */
  it('refuses a year that sits behind a comparator rather than turning a range into an exact match', () => {
    const ranges = [
      'xe đời dưới 2020', 'xe dưới 2020', 'xe trên 2015', 'xe dưới đời 2020', 'xe đời trước 2020', 'car before 2020',
      // Trailing forms: "2020 trở lên" is 2020-and-newer, so an EXACT 2020 hides everything asked for.
      'xe 2020 trở lên', 'car 2020 or newer',
      // ⚠️ BOTH DIRECTIONS. "trở xuống" is a non-issue after a PRICE (it agrees with the inferred
      // ceiling) but after a YEAR it is a range endpoint like any other.
      'xe 2020 trở xuống', 'car 2020 or older',
      // ⚠️ And through the EXPLICIT year path too — pass A checked only the token in front.
      'xe đời 2020 trở lên', 'xe đời 2020 trở xuống',
    ]
    for (const q of ranges) {
      expect(parse(q)).toEqual({ text: q, facets: [] })
    }
  })

  /**
   * ⚠️ A MEASUREMENT BEHIND THE NUMBER MAKES IT A MEASUREMENT, NOT A MODEL YEAR — and the first
   * version of this guard only knew about MONEY units, so "đất 2000 m2" came back as year 2000 with
   * the residual "đất m2". The glued spellings ("2000m2", "2000w") were already refused, so the two
   * ways of typing one thing disagreed. The list is a denylist of real units on purpose: a
   * shape test ("any short word") would eat the "đỏ" case below, which is a query people really run.
   */
  it('a spaced measurement unit blocks the year reading', () => {
    for (const q of ['đất 2000 m2', 'loa 2000 w', 'xe tải 2000 kg', 'man hinh 2000 px', 'máy chiếu 2000 lm']) {
      expect(parse(q)).toEqual({ text: q, facets: [] })
    }
  })

  it('but an ordinary short word behind the year does not — "đỏ" is a colour, not a unit', () => {
    const r = parse('honda vision 2024 đỏ')
    expect(r.year).toBe(2024)
    expect(r.text).toBe('honda vision đỏ')
  })

  it('honours the window: 1990 and next model year in, 1989 and beyond next year out', () => {
    expect(parse('xe 1990').year).toBe(1990)
    expect(parse('xe 2027').year).toBe(2027) // NOW is 2026 → currentYear + 1
    expect(parse('xe 1989').year).toBeUndefined()
    expect(parse('xe 2028').year).toBeUndefined()
  })

  it('takes the FIRST year only — the second stays in the text rather than overwriting it', () => {
    const r = parse('2019 2020')
    expect(r.year).toBe(2019)
    expect(r.text).toBe('2020')
  })
})

describe('parseQuery — refuses to parse (a false parse is worse than no parse)', () => {
  const refuses: [string, string][] = [
    ['iphone 13', 'a two-digit model number is neither a year nor money'],
    ['honda wave 110', 'a bare number with no money unit is never a price'],
    ['sony bravia 55', 'screen size'],
    ['tivi 4k', 'RESOLUTION — 4k would be 4.000 đ, under the 50.000 đ floor'],
    ['man hinh 2k', 'same, 2.000 đ'],
    ['tivi 8k', 'same, 8.000 đ'],
    // ⚠️ These three are ABOVE the floor, so guard 2 never fires on them — guard 5 does. Colour
    // temperature and Intel K-SKUs are the reason the k-shorthand stops at 1.000.
    ['đèn led 3000k', 'colour temperature in Kelvin, not 3 triệu'],
    ['bóng đèn 6500k', 'same, and 6,5 triệu for a bulb would be absurd'],
    ['cpu i7 9700k', 'an Intel K-SKU, not a 9,7 triệu ceiling'],
    ['ram 3200 mhz', 'a clock speed; mhz is not a money unit either'],
    // ⚠️ THE ACKNOWLEDGED COST of the k-shorthand ceiling, pinned so it stays visible. "1200k" IS a
    // real classifieds price (1,2 triệu) and is deliberately given up, because lighting runs
    // 2200K–6500K and no cut-off separates the two meanings. It falls back to a plain text search
    // rather than a wrong filter, which is the trade this whole file makes.
    ['xe 1200k', 'a genuine 1,2 triệu price we knowingly decline — the k-band is ambiguous above 1.000'],
    ['nhà 80m2', 'floor area, and the unit does not run to the end of the token'],
    ['căn hộ 100m', 'a bare "m" is metres — it only means million after an explicit comparator'],
    ['8m', 'the same rule with nothing else in the query'],
    ['bmw 320d', 'a diesel trim code — 320 đ is under the floor'],
    ['canon 4000d', 'a camera body — 4.000 đ is under the floor'],
    ['iphone 15 pro 256gb', 'storage is not a money unit'],
    ['xe 50cc', 'engine displacement is not a money unit'],
    ['rtx 4090', 'a GPU model number, outside the year window by construction'],
    ['rtx 2080', 'same'],
    ['gtx 1080', 'same, below 1990'],
    ['0912.345.678', 'a phone number — the lead group is four digits'],
    ['lien he 912.345.678', 'the SAME phone number in international form: three-digit lead, arbitrary last group'],
    ['192.168.001', 'an IP address — dotted groups, but the last one is not a round thousand'],
    ['ma don 123.456.789', 'a dotted reference number'],
    ['8 nghìn', '8.000 đ is under the floor'],
    ['dưới 200 tỷ', 'above the 100 tỷ ceiling — the comparator is left in the text too'],
  ]
  for (const [input, why] of refuses) {
    it(`leaves "${input}" alone (${why})`, () => {
      const r = parse(input)
      expect(r.facets).toEqual([])
      expect(r.year).toBeUndefined()
      expect(r.priceMax).toBeUndefined()
      expect(r.priceMin).toBeUndefined()
      expect(r.text).toBe(input)
    })
  }

  /**
   * ⚠️ THE TWO WORDS THAT ARE DELIBERATELY NOT COMPARATORS. Both were tried and both destroy the
   * noun the buyer typed: "max" would turn "iPhone 13 Pro Max 1tr" into a search for "iphone 13
   * pro", and "từ" folds to "tu" — one of the commonest nouns in the catalogue (tủ lạnh, tủ quần
   * áo). Keep these tests; they are the only thing stopping someone adding the words back.
   */
  it('"max" is part of the model name, never a ceiling word', () => {
    const r = parse('iphone 13 pro max 1tr')
    expect(r.priceMax).toBe(1_000_000)
    expect(r.text).toBe('iphone 13 pro max')
  })

  it('"tủ" survives — it is a cabinet, not a "from"', () => {
    const r = parse('tủ lạnh 5 triệu')
    expect(r.priceMax).toBe(5_000_000)
    expect(r.text).toBe('tủ lạnh')
  })

  /**
   * ⚠️ THE WORST OUTCOME THIS FILE CAN PRODUCE IS THE OPPOSITE FILTER, NOT A MISSING ONE — and
   * declining to parse "từ" was not enough on its own. The bare-amount rule then read the number
   * behind it as a CEILING: "tủ lạnh từ 5 triệu" measured as priceMax 5.000.000, so a buyer asking
   * for fridges FROM 5 triệu was shown only fridges UNDER it. Refusing to guess has to mean refusing
   * to guess the inverse as well.
   */
  it('never turns an at-least phrase into a ceiling', () => {
    const noCeiling = [
      'tủ lạnh từ 5 triệu',
      'fridge from 5 million',
      'xe 20 triệu trở lên',
      'xe tren 5tr tren 8tr',
      'bike minimum 5 million',
      'bike starting at 5 million',
      // ⚠️ The SAME words on the other side of the number — both languages put them there just as
      // often, and only the "before" list existed at first.
      'bike 5 million minimum',
      'xe 5 triệu tối thiểu',
    ]
    for (const q of noCeiling) {
      const r = parse(q)
      expect({ q, max: r.priceMax }).toEqual({ q, max: undefined })
    }
  })

  /**
   * ⚠️ "hơn" IS A COMPARATIVE PARTICLE AND MUST STAY BLOCKED — it was briefly promoted to a real
   * FLOOR_WORD and that inverted a whole family of queries. Its direction comes from the ADJECTIVE
   * in front of it, which this scanner cannot see: "rẻ hơn"/"nhỏ hơn"/"thấp hơn" are ceilings,
   * "cao hơn"/"nhiều hơn" are floors, and bare "hơn" is a floor again. Measured while it was a
   * floor: "xe rẻ hơn 5 triệu" — CHEAPER than 5 triệu — returned priceMin 5.000.000 with "rẻ"
   * deleted from the query. Every form is refused now; none of them may quietly start parsing.
   */
  it('refuses every "hơn" comparison rather than guessing a direction it cannot see', () => {
    for (const q of ['xe rẻ hơn 5 triệu', 'nhà nhỏ hơn 5 tỷ', 'xe cao hơn 5 triệu', 'xe hơn 5 triệu', 'xe min 5tr']) {
      const r = parse(q)
      expect({ q, min: r.priceMin, max: r.priceMax, text: r.text }).toEqual({ q, min: undefined, max: undefined, text: q })
    }
  })

  it('and the floor it DID parse still stands — only the inferred ceiling behind it is dropped', () => {
    const r = parse('xe tren 5tr tren 8tr')
    expect(r.priceMin).toBe(5_000_000)
    expect(r.text).toBe('xe tren 8tr')
  })

  it('nike air max 270 comes back completely untouched', () => {
    expect(parse('nike air max 270')).toEqual({ text: 'nike air max 270', facets: [] })
  })
})

describe('parseQuery — diacritic symmetry, both directions', () => {
  const pairs: [string, string][] = [
    ['dưới 8 triệu', 'duoi 8 trieu'],
    ['trên 1 tỷ', 'tren 1 ty'],
    ['đời 2024', 'doi 2024'],
    ['800 nghìn', '800 nghin'],
  ]
  for (const [accented, plain] of pairs) {
    it(`"${accented}" and "${plain}" produce the same facets`, () => {
      const a = parse(accented)
      const b = parse(plain)
      expect({ year: a.year, priceMin: a.priceMin, priceMax: a.priceMax }).toEqual({ year: b.year, priceMin: b.priceMin, priceMax: b.priceMax })
      expect(a.facets.map((f) => [f.kind, f.value, f.explicit])).toEqual(b.facets.map((f) => [f.kind, f.value, f.explicit]))
    })
  }
})

describe('parseQuery — edges', () => {
  it('empty and whitespace-only input parse to nothing at all', () => {
    expect(parse('')).toEqual({ text: '', facets: [] })
    expect(parse('   \t  ')).toEqual({ text: '', facets: [] })
  })

  it('trailing punctuation does not stop a match, and stays on the residual word', () => {
    const r = parse('honda vision, dưới 8 triệu.')
    expect(r.priceMax).toBe(8_000_000)
    expect(r.text).toBe('honda vision,')
  })

  it('collapses runs of whitespace in the residual', () => {
    expect(parse('honda    vision   2024').text).toBe('honda vision')
  })

  it('caps a pathological input rather than working through it', () => {
    const r = parse('x'.repeat(300))
    expect(r.text).toHaveLength(200)
    expect(r.facets).toEqual([])
  })
})
