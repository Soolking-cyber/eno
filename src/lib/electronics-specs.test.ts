import { describe, expect, it } from 'vitest'
import { SPECS, extractSpecs, extractSpecsFromTitles, isLegalSpec, specsFor } from './electronics-specs'

describe('schema integrity', () => {
  // ⛔ The chips are built FROM this table, so a duplicate or an empty value set would render a
  // dead chip that can never match a row.
  it('has unique keys and non-empty, unique values', () => {
    expect(new Set(SPECS.map((s) => s.key)).size).toBe(SPECS.length)
    for (const s of SPECS) {
      expect(s.values.length, s.key).toBeGreaterThan(0)
      expect(new Set(s.values.map((v) => v.value)).size, s.key).toBe(s.values.length)
      expect(s.subcats.length, s.key).toBeGreaterThan(0)
    }
  })
  // ⚠️ feed-query matches `"key":"value"` as a SUBSTRING. A value carrying a quote, a backslash or
  // a space would either break the match or, worse, match something it should not.
  it('values are quote-safe and unit-free', () => {
    for (const s of SPECS) for (const v of s.values) {
      expect(v.value, `${s.key}=${v.value}`).toMatch(/^[a-z0-9]+$/)
    }
  })
})

describe('specsFor', () => {
  it('offers watch-specific specs on smartwatch and not on phones', () => {
    expect(specsFor('smartwatch').map((s) => s.key)).toContain('caseSize')
    expect(specsFor('phones-tablets').map((s) => s.key)).not.toContain('caseSize')
  })
  it('returns nothing for an unknown or null subcategory', () => {
    expect(specsFor(null)).toEqual([])
    expect(specsFor('not-a-subcat')).toEqual([])
  })
})

describe('extractSpecs — the real titles this was written for', () => {
  it('reads the RAM/storage pair positionally', () => {
    expect(extractSpecs('phones-tablets', 'Meizu Mblu 22 Pro NFC 8GB 256GB'))
      .toMatchObject({ ram: '8', storage: '256' })
    expect(extractSpecs('phones-tablets', 'HONOR 400 5G 12GB 512GB'))
      .toMatchObject({ ram: '12', storage: '512', connectivity: '5g' })
  })
  it('converts TB so one numeric order covers the whole list', () => {
    expect(extractSpecs('laptops-pcs', 'Laptop Dell XPS 32GB 2TB SSD')).toMatchObject({ ram: '32', storage: '2048' })
  })
  // ⛔ The single-capacity rule: a lone 256 is storage, a lone 12 can only be RAM.
  it('disambiguates a lone capacity by which list it is legal in', () => {
    expect(extractSpecs('phones-tablets', 'iPhone 15 256GB')).toMatchObject({ storage: '256' })
    expect(extractSpecs('laptops-pcs', 'Laptop Acer 12GB')).toMatchObject({ ram: '12' })
  })
  it('reads watch case size and cellular', () => {
    expect(extractSpecs('smartwatch', 'Samsung Galaxy Watch9 40mm')).toMatchObject({ caseSize: '40' })
    expect(extractSpecs('smartwatch', 'Apple Watch Series 10 46mm LTE')).toMatchObject({ caseSize: '46', connectivity: 'lte' })
    expect(extractSpecs('smartwatch', 'Apple Watch SE 44mm GPS')).toMatchObject({ caseSize: '44', connectivity: 'gps' })
  })
  it('reads CPU families in every shape the merchant writes them', () => {
    expect(extractSpecs('laptops-pcs', 'LG Gram Book 15U50T i5-1334U 16GB 512GB')).toMatchObject({ cpu: 'i5' })
    expect(extractSpecs('laptops-pcs', 'MSI Modern 14 Core Ultra 7 155H')).toMatchObject({ cpu: 'ultra7' })
    expect(extractSpecs('laptops-pcs', 'Laptop Asus Ryzen 5 7530U')).toMatchObject({ cpu: 'ryzen5' })
    expect(extractSpecs('laptops-pcs', 'MacBook Air M4 13 inch')).toMatchObject({ cpu: 'm4', laptopSize: '13' })
  })
  it('rounds a 15.6" laptop to its marketed 15" class', () => {
    expect(extractSpecs('laptops-pcs', 'LG Gram 15.6 inch')).toMatchObject({ laptopSize: '15' })
  })
  it('reads monitor resolution and refresh rate', () => {
    expect(extractSpecs('tv-monitors', 'Samsung 27 inch 2K 165Hz Monitor'))
      .toMatchObject({ screenSize: '27', resolution: '2k', refreshRate: '165' })
  })
  // ⛔ THE WHOLE POINT OF THE CLOSED LIST: a real but unlisted value yields nothing rather than an
  // orphan that no chip can ever select.
  it('drops a real value that has no chip', () => {
    expect(extractSpecs('smartwatch', 'Some Watch 39mm').caseSize).toBeUndefined()
    expect(extractSpecs('laptops-pcs', 'Laptop 48GB 999GB').storage).toBeUndefined()
  })
  it('never writes a spec that does not belong to the subcategory', () => {
    // A phone case title full of numbers must not acquire a laptop's CPU, a watch's case size or a
    // monitor's screen size — the subcategory gate is what stops every regex firing on every row.
    const c = extractSpecs('phone-cases', 'Ốp lưng iPhone 15 Pro Max 6.7 inch i5')
    expect(c).toEqual({ compatibleWith: 'iphone15' })
    expect(c.cpu).toBeUndefined()
    expect(c.caseSize).toBeUndefined()
    expect(c.screenSize).toBeUndefined()
  })

  describe('compatibleWith — the accessory axis', () => {
    it('names the one device an accessory targets', () => {
      expect(extractSpecs('phone-cases', 'Ốp lưng MagSafe iPhone 16 Pro Max')).toMatchObject({ compatibleWith: 'iphone16' })
      expect(extractSpecs('screen-protectors', 'Cường lực Galaxy S25 Ultra')).toMatchObject({ compatibleWith: 'galaxys25' })
      expect(extractSpecs('bags-sleeves', 'Túi chống sốc MacBook Air 13')).toMatchObject({ compatibleWith: 'macbook' })
    })
    // ⚠️ Galaxy A is deliberately ONE chip: A04..A57 appear 1-10 times each in the catalogue.
    it('folds every Galaxy A generation into one chip', () => {
      expect(extractSpecs('phone-cases', 'Ốp lưng Galaxy A56').compatibleWith).toBe('galaxya')
      expect(extractSpecs('phone-cases', 'Ốp lưng Galaxy A16').compatibleWith).toBe('galaxya')
    })
    // ⛔ First match wins, in title order — an accessory names exactly one target.
    it('picks the newest Apple device named, not a later mention', () => {
      expect(extractSpecs('phone-cases', 'Ốp iPhone 17 Pro, hợp iPhone 16 case').compatibleWith).toBe('iphone17')
    })
    it('is not offered on products that are not accessories', () => {
      expect(extractSpecs('phones-tablets', 'iPhone 16 Pro 256GB').compatibleWith).toBeUndefined()
    })
  })
  it('returns nothing for a null subcategory', () => {
    expect(extractSpecs(null, 'Anything 8GB 256GB')).toEqual({})
  })
})

describe('isLegalSpec', () => {
  it('accepts canonical values and rejects unit-suffixed ones', () => {
    expect(isLegalSpec('storage', '256')).toBe(true)
    expect(isLegalSpec('storage', '256GB')).toBe(false)
    expect(isLegalSpec('ram', '48')).toBe(false)
  })
})

describe('extractSpecsFromTitles — the bug that reached production', () => {
  /**
   * ⛔ THE REGRESSION THIS FILE EXISTS FOR. The enrichment script passed `${title} ${titleVi}` as
   * ONE string. For a single-capacity product the two titles are near-identical, so the capacity
   * list doubled and the ordered RAM/storage rule read the repeat as RAM. 134 live listings were
   * published claiming an iPhone 14 Plus had 128GB of RAM. Every test here passed, because every
   * test passed ONE title.
   */
  it('does not invent RAM when both titles name the same single capacity', () => {
    const good = extractSpecsFromTitles('phones-tablets', ['iPhone 14 Plus 128GB', 'iPhone 14 Plus 128GB'])
    expect(good.ram).toBeUndefined()
    expect(good.storage).toBe('128')
  })
  /**
   * TWO INDEPENDENT LAYERS NOW STOP THIS, and both are pinned because either alone would have
   * prevented the incident: (a) titles are parsed separately so the capacity list never doubles,
   * and (b) `isLegalSpec` is subcategory-aware so a phone cannot hold 128GB of RAM even if some
   * future call site reintroduces the concatenation.
   */
  it('rejects the impossible value even when handed the concatenated string', () => {
    expect(extractSpecs('phones-tablets', 'iPhone 14 Plus 128GB iPhone 14 Plus 128GB').ram).toBeUndefined()
    // …and on a laptop, where 128GB RAM IS possible, the merge is what keeps it honest.
    expect(extractSpecsFromTitles('laptops-pcs', ['Laptop 512GB', 'Laptop 512GB']).ram).toBeUndefined()
  })
  it('still finds a real RAM/storage pair, and a spec that only the Vietnamese title carries', () => {
    expect(extractSpecsFromTitles('phones-tablets', ['Meizu 22 Pro 8GB 256GB', 'Điện thoại Meizu 22 Pro 8GB 256GB']))
      .toMatchObject({ ram: '8', storage: '256' })
    expect(extractSpecsFromTitles('keyboards-mice', ['Keychron K2', 'Bàn phím cơ Keychron K2']))
      .toMatchObject({ deviceKind: 'keyboard' })
  })
  it('lets the first title win a disagreement', () => {
    expect(extractSpecsFromTitles('smartwatch', ['Watch 44mm', 'Watch 40mm']).caseSize).toBe('44')
  })
})

describe('isLegalSpec is subcategory-aware', () => {
  // ⛔ The gate that failed: 128 is legal RAM globally (workstations) but not on a phone.
  it('refuses a laptop-only value on a phone', () => {
    expect(isLegalSpec('ram', '128')).toBe(true)
    expect(isLegalSpec('ram', '128', 'laptops-pcs')).toBe(true)
    expect(isLegalSpec('ram', '128', 'phones-tablets')).toBe(false)
  })
  it('refuses a spec that does not apply to the subcategory at all', () => {
    expect(isLegalSpec('caseSize', '44', 'phones-tablets')).toBe(false)
    expect(isLegalSpec('caseSize', '44', 'smartwatch')).toBe(true)
  })
})

describe('the regexes that silently never fired', () => {
  /**
   * ⛔ `(?!\s?g)` was meant to dodge "4G"/"5G" — which need no dodging, since neither has a
   * leading `m`. What it actually matched was the space-then-G in a colour name, so every
   * coloured or Vietnamese-suffixed Mac lost its CPU.
   */
  it('reads an Apple chip followed by a colour or a Vietnamese word', () => {
    expect(extractSpecs('laptops-pcs', 'MacBook Air M3 Gray 16GB 512GB').cpu).toBe('m3')
    expect(extractSpecs('laptops-pcs', 'MacBook Air M2 Gold').cpu).toBe('m2')
    expect(extractSpecs('laptops-pcs', 'MacBook Pro M4 Giá rẻ').cpu).toBe('m4')
    expect(extractSpecs('laptops-pcs', 'MacBook Pro M5 Pro 14-inch').cpu).toBe('m5')
  })
  // ⚠️ A phone named "M5" must not acquire a CPU — `cpu` is not offered on phones at all.
  it('never puts an Apple chip on a phone', () => {
    expect(extractSpecs('phones-tablets', 'Xiaomi Poco M5 128GB').cpu).toBeUndefined()
  })
  // ⚠️ JS `\b` is ASCII-only: `thẻ nhớ\b` needs a word char right after "ớ" and never matched.
  it('recognises a Vietnamese memory card', () => {
    expect(extractSpecs('storage', 'Thẻ nhớ MicroSDXC Sandisk 128GB').storageType).toBe('microsd')
  })
  // ⛔ A speaker that INCLUDES a mic is not a microphone.
  it('does not file a karaoke speaker or a headset under microphone', () => {
    expect(extractSpecs('audio', 'Loa kéo karaoke Sony kèm micro').audioType).toBe('speaker')
    expect(extractSpecs('audio', 'Tai nghe gaming có micro').audioType).not.toBe('microphone')
    expect(extractSpecs('audio', 'Microphone thu âm Rode NT1').audioType).toBe('microphone')
  })
})

describe('labelled capacities — either side of the number', () => {
  /**
   * ⛔ The AI concierge tokenised "a laptop with 128gb ram" into words and matched them against
   * `searchText`, which holds the TITLE — and these titles carry a SKU, not a spec. Reading the
   * label lets the same closed-list extractor turn the phrase into `ram = 128`, the exact value
   * the catalogue was indexed with.
   */
  it('reads a trailing label, which is how people type', () => {
    expect(extractSpecs('laptops-pcs', 'a laptop with 128gb ram')).toEqual({ ram: '128' })
    expect(extractSpecs('laptops-pcs', 'laptop 16GB RAM 512GB SSD')).toMatchObject({ ram: '16', storage: '512' })
  })
  it('reads a leading label, which is how the merchant writes', () => {
    expect(extractSpecs('laptops-pcs', 'Laptop RAM 16GB 512GB')).toMatchObject({ ram: '16', storage: '512' })
  })
  /**
   * ⛔ A LABEL MATCH IS ONLY BELIEVED IF THE VALUE IS LEGAL. In "laptop 16GB RAM 512GB SSD" the
   * leading pattern `RAM <n>GB` matches "RAM 512GB" — the 512 belongs to the SSD after it — and
   * returned 512, which is not a legal RAM size, so the RAM was dropped entirely.
   */
  it('rejects a label match whose value is impossible and tries the other form', () => {
    expect(extractSpecs('laptops-pcs', 'laptop 16GB RAM 512GB SSD').ram).toBe('16')
  })
  it('still keeps GPU memory out of it', () => {
    expect(extractSpecs('laptops-pcs', 'Laptop RTX 8GB, RAM 16GB, SSD 512GB')).toMatchObject({ ram: '16', storage: '512' })
  })
})

describe('adjacent spec labels — the ambiguity two reviewers found together', () => {
  /**
   * ⛔ In "Laptop 16GB RAM 128GB SSD" the leading pattern `RAM <n>GB` matches "RAM 128GB", and 128
   * IS a legal RAM size — so value-validation could not catch it and the row would be indexed with
   * 128GB of RAM. A capacity immediately followed by a DIFFERENT label belongs to that label.
   * ⚠️ The earlier test used 512GB, an ILLEGAL RAM size, so it passed for the wrong reason and
   * missed the common shape entirely.
   */
  it('gives a capacity to the label that follows it, not the one before', () => {
    expect(extractSpecs('laptops-pcs', 'Laptop 16GB RAM 128GB SSD')).toEqual({ ram: '16', storage: '128' })
    expect(extractSpecs('laptops-pcs', '32GB RAM 16GB SSD').ram).toBe('32')
  })
  /**
   * ⛔ THE FIRST ADJACENCY FIX BROKE THE COMMONEST FORM. A flat "reject if a storage label
   * follows" also rejected "RAM 16GB SSD 512GB" — where the SSD carries its own number and the 16
   * really is the RAM. The rule is: reject only when the following label has NO number of its own.
   */
  it('keeps the RAM when the next label carries its own capacity', () => {
    expect(extractSpecs('laptops-pcs', 'RAM 16GB SSD 512GB')).toEqual({ ram: '16', storage: '512' })
    expect(extractSpecs('laptops-pcs', 'SSD 512GB RAM 16GB')).toEqual({ ram: '16', storage: '512' })
  })
  // ⚠️ JS word boundaries are ASCII-only, so a `\b` after "nhớ" never matches at end-of-string —
  // the third time that trap appeared in this file. "16GB RAM 128GB bộ nhớ" read as 128GB of RAM.
  it('reads a Vietnamese storage label at the end of the string', () => {
    expect(extractSpecs('laptops-pcs', 'Laptop 16GB RAM 128GB bộ nhớ')).toEqual({ ram: '16', storage: '128' })
    expect(extractSpecs('laptops-pcs', 'Laptop RAM 16GB bộ nhớ 512GB')).toEqual({ ram: '16', storage: '512' })
  })
  it('applies the same rule to Vietnamese labels and to "of"', () => {
    expect(extractSpecs('laptops-pcs', 'Laptop RAM 16GB bộ nhớ trong 512GB')).toEqual({ ram: '16', storage: '512' })
    expect(extractSpecs('laptops-pcs', 'Laptop 16GB RAM 128GB bộ nhớ trong')).toEqual({ ram: '16', storage: '128' })
    expect(extractSpecs('laptops-pcs', 'Laptop 16GB RAM 128GB of storage')).toEqual({ ram: '16', storage: '128' })
  })
  /**
   * ⚠️ "Laptop RAM 16GB SSD" names an SSD with NO size of its own, so the adjacency lookahead —
   * written for "16GB RAM 128GB SSD" — wrongly rejected a 16 that is plainly the RAM. A last-resort
   * unguarded pattern runs only after the other two fail, so the real ambiguity is still resolved
   * by the trailing form before this can fire.
   */
  it('reads a leading label when the following label has no size of its own', () => {
    expect(extractSpecs('laptops-pcs', 'Laptop RAM 16GB SSD')).toEqual({ ram: '16' })
    expect(extractSpecs('laptops-pcs', 'Laptop SSD 512GB RAM')).toEqual({ storage: '512' })
  })
  it('still reads the plain leading form where nothing follows', () => {
    expect(extractSpecs('laptops-pcs', 'Laptop RAM 16GB 512GB')).toMatchObject({ ram: '16', storage: '512' })
  })
  it('accepts "of" on both slots, not just RAM', () => {
    expect(extractSpecs('laptops-pcs', '512GB of storage 16GB of RAM')).toMatchObject({ ram: '16', storage: '512' })
  })
})
