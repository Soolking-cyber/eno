/**
 * Electronics spec schema — ONE source for what can be filtered, what values are legal, and how
 * those values are read out of a merchant's product title.
 *
 * ⛔ WHY THIS FILE EXISTS. 9,726 imported CellphoneS products had 18% attribute coverage: 378
 * smartwatches with ZERO attributes (so the filter panel offered only Condition/Warranty/Colour —
 * no 40mm/44mm, no LTE), 1,239 phone cases with one, 1,677 rows with no subcategory at all. The
 * facet chips and the code that writes attributes were separately maintained, which is how they
 * came to disagree about everything.
 *
 * ⛔ CLOSED VALUE LISTS, AND EXACT VALUES — NOT RANGES. The owner's instruction (2026-08-25) was
 * "not 64gb+ bullshit exact filter untill top spec like 256gb ram and so on or 2 tb storage". A
 * range chip cannot express "exactly 512GB", and a marketplace where you cannot ask for the thing
 * you want is a marketplace you leave. Every value here is a canonical string; taxonomy.ts builds
 * its chips FROM this table, so a chip that exists is a value the extractor can produce and vice
 * versa.
 *
 * ⚠️ ATTRIBUTES ARE MATCHED AS A SUBSTRING: feed-query.ts does
 * `attributes contains '"ram":"8"'` against a compact JSON string column. The closing quote is
 * what makes that safe — `"ram":"8"` cannot match `"ram":"80"`. So values must be written with
 * plain `JSON.stringify` (no spaces) and must never carry a unit inside the value ("8", never
 * "8GB"), or the chip and the row stop agreeing on the exact byte sequence.
 */

export type SpecKey =
  | 'storage' | 'ram' | 'screenSize' | 'laptopSize' | 'caseSize' | 'cpu' | 'connectivity'
  | 'resolution' | 'refreshRate' | 'wattage' | 'capacity' | 'storageType' | 'audioType'
  | 'deviceKind' | 'wifiStandard' | 'cameraKind' | 'printerKind' | 'compatibleWith'

export type SpecDef = {
  key: SpecKey
  label: string
  labelVi: string
  /** The subcategories this spec is offered on. A spec absent here is never written or shown. */
  subcats: string[]
  /** Canonical values, in the order the chips should appear. Small→large for numbers. */
  values: { value: string; label: string; labelVi?: string }[]
  /**
   * Narrow the offered values for one subcategory.
   * ⛔ A PHONE CANNOT HAVE 128GB OF RAM. `ram` is shared by phones and laptops because it is the
   * same attribute, but the realistic ranges are not the same — without this, a phone shopper is
   * offered 64 GB and 128 GB RAM chips that can never match a row, which reads as a broken filter
   * rather than as an impossible spec.
   */
  valuesBySubcat?: Record<string, string[]>
}

// ⚠️ "64 GB", WITH THE SPACE — the app's existing capacity chips read that way and a facet-bar
// test pins the exact accessible name. The VALUE is still bare ("64"); only the label has a space.
const gb = (n: number) => ({ value: String(n), label: n >= 1024 ? `${n / 1024} TB` : `${n} GB` })
const mm = (n: number) => ({ value: String(n), label: `${n}mm` })
const inch = (n: string) => ({ value: n, label: `${n}"` })

export const SPECS: SpecDef[] = [
  {
    key: 'storage', label: 'Storage', labelVi: 'Bộ nhớ', subcats: ['phones-tablets', 'laptops-pcs', 'gaming', 'storage'],
    // A 32GB phone is a real (cheap) product; a 32GB laptop drive is not sold here.
    valuesBySubcat: { 'laptops-pcs': ['128', '256', '512', '1024', '2048'] },
    // ⚠️ 1024/2048 rather than "1TB"/"2TB" so one numeric comparison orders the whole list; the
    // LABEL says TB. A mixed "512" / "1TB" value set cannot be sorted or range-filtered later.
    values: [32, 64, 128, 256, 512, 1024, 2048].map(gb),
  },
  {
    key: 'ram', label: 'RAM', labelVi: 'RAM', subcats: ['phones-tablets', 'laptops-pcs', 'gaming'],
    valuesBySubcat: { 'phones-tablets': ['3', '4', '6', '8', '12', '16', '24'] },
    // 128 is real on workstations and is exactly the query ("a laptop with 128gb ram") that
    // returned nothing, because no row carried a ram value at all. ⚠️ It is also the CEILING: the
    // owner's phrasing was "untill top spec like 256gb ram", but 256GB is a server part that this
    // catalogue does not sell, and a chip matching nothing is the noise this list exists to avoid.
    // Add it the day a row needs it — `isLegalSpec` is the only gate that has to agree.
    values: [3, 4, 6, 8, 12, 16, 24, 32, 64, 128].map(gb),
  },
  {
    key: 'caseSize', label: 'Case size', labelVi: 'Kích thước mặt', subcats: ['smartwatch'],
    values: [38, 40, 41, 42, 43, 44, 45, 46, 47, 49].map(mm),
  },
  {
    key: 'connectivity', label: 'Connectivity', labelVi: 'Kết nối', subcats: ['smartwatch', 'phones-tablets'],
    values: [
      { value: 'lte', label: 'LTE / eSIM', labelVi: 'LTE / eSIM' },
      { value: 'gps', label: 'GPS only', labelVi: 'Chỉ GPS' },
      { value: '5g', label: '5G', labelVi: '5G' },
    ],
  },
  {
    key: 'cpu', label: 'Processor', labelVi: 'Bộ xử lý', subcats: ['laptops-pcs'],
    values: [
      { value: 'celeron', label: 'Celeron' }, { value: 'i3', label: 'Core i3' },
      { value: 'i5', label: 'Core i5' }, { value: 'i7', label: 'Core i7' }, { value: 'i9', label: 'Core i9' },
      { value: 'ultra5', label: 'Core Ultra 5' }, { value: 'ultra7', label: 'Core Ultra 7' }, { value: 'ultra9', label: 'Core Ultra 9' },
      { value: 'ryzen3', label: 'Ryzen 3' }, { value: 'ryzen5', label: 'Ryzen 5' },
      { value: 'ryzen7', label: 'Ryzen 7' }, { value: 'ryzen9', label: 'Ryzen 9' },
      { value: 'm1', label: 'Apple M1' }, { value: 'm2', label: 'Apple M2' },
      { value: 'm3', label: 'Apple M3' }, { value: 'm4', label: 'Apple M4' },
      // ⚠️ M5 exists — the 2026 MacBook Air/Pro line is in this catalogue today. A CPU list that
      // stops at the generation you happen to remember silently drops the newest products.
      { value: 'm5', label: 'Apple M5' },
      { value: 'snapdragon', label: 'Snapdragon' },
    ],
  },
  {
    key: 'laptopSize', label: 'Screen', labelVi: 'Màn hình', subcats: ['laptops-pcs'],
    values: ['13', '14', '15', '16', '17'].map(inch),
  },
  {
    key: 'screenSize', label: 'Screen', labelVi: 'Màn hình', subcats: ['tv-monitors'],
    values: ['22', '24', '27', '32', '34', '43', '50', '55', '65', '75', '85', '98'].map(inch),
  },
  {
    key: 'resolution', label: 'Resolution', labelVi: 'Độ phân giải', subcats: ['tv-monitors'],
    values: [
      { value: 'hd', label: 'HD' }, { value: 'fhd', label: 'Full HD' },
      { value: '2k', label: '2K / QHD' }, { value: '4k', label: '4K UHD' }, { value: '8k', label: '8K' },
    ],
  },
  {
    key: 'refreshRate', label: 'Refresh rate', labelVi: 'Tần số quét', subcats: ['tv-monitors'],
    values: [60, 75, 100, 120, 144, 165, 180, 240, 360].map((n) => ({ value: String(n), label: `${n}Hz` })),
  },
  {
    key: 'audioType', label: 'Type', labelVi: 'Loại', subcats: ['audio'],
    values: [
      { value: 'tws', label: 'True wireless', labelVi: 'Tai nghe không dây' },
      { value: 'earphone', label: 'Earphones', labelVi: 'Tai nghe nhét tai' },
      { value: 'headphone', label: 'Headphones', labelVi: 'Tai nghe chụp tai' },
      { value: 'speaker', label: 'Speaker', labelVi: 'Loa' },
      { value: 'soundbar', label: 'Soundbar', labelVi: 'Loa thanh' },
      { value: 'microphone', label: 'Microphone', labelVi: 'Micro' },
    ],
  },
  {
    key: 'wattage', label: 'Power', labelVi: 'Công suất', subcats: ['cables-chargers', 'power-banks'],
    values: [20, 25, 30, 33, 45, 65, 67, 100, 120, 140, 240].map((n) => ({ value: String(n), label: `${n}W` })),
  },
  {
    key: 'capacity', label: 'Capacity', labelVi: 'Dung lượng', subcats: ['power-banks'],
    values: [5000, 10000, 20000, 25000, 30000, 50000].map((n) => ({ value: String(n), label: `${n.toLocaleString('en-US')}mAh` })),
  },
  {
    key: 'storageType', label: 'Type', labelVi: 'Loại', subcats: ['storage'],
    values: [
      { value: 'ssd', label: 'SSD' }, { value: 'hdd', label: 'HDD' },
      { value: 'microsd', label: 'microSD' }, { value: 'usb', label: 'USB drive', labelVi: 'USB' },
    ],
  },
  {
    key: 'deviceKind', label: 'Device', labelVi: 'Thiết bị', subcats: ['keyboards-mice'],
    values: [
      { value: 'keyboard', label: 'Keyboard', labelVi: 'Bàn phím' },
      { value: 'mouse', label: 'Mouse', labelVi: 'Chuột' },
      { value: 'combo', label: 'Keyboard + mouse', labelVi: 'Bộ phím chuột' },
      { value: 'mousepad', label: 'Mouse pad', labelVi: 'Lót chuột' },
    ],
  },
  {
    key: 'wifiStandard', label: 'Wi-Fi', labelVi: 'Wi-Fi', subcats: ['networking'],
    values: [
      { value: 'wifi5', label: 'Wi-Fi 5' }, { value: 'wifi6', label: 'Wi-Fi 6' },
      { value: 'wifi6e', label: 'Wi-Fi 6E' }, { value: 'wifi7', label: 'Wi-Fi 7' },
    ],
  },
  {
    key: 'cameraKind', label: 'Type', labelVi: 'Loại', subcats: ['cameras'],
    values: [
      { value: 'action', label: 'Action camera', labelVi: 'Camera hành trình' },
      { value: 'security', label: 'Security camera', labelVi: 'Camera an ninh' },
      { value: 'mirrorless', label: 'Mirrorless' }, { value: 'dslr', label: 'DSLR' },
      { value: 'webcam', label: 'Webcam' }, { value: 'drone', label: 'Drone', labelVi: 'Flycam' },
    ],
  },
  {
    /**
     * ⛔ THE ACCESSORY AXIS, AND IT IS THE ONLY ONE THAT MATTERS FOR 1,947 PRODUCTS. Owner, 2026-08-25:
     * "add subbrands example apple iphone 16 etc easier to find accessories for designated brand
     * model". Nobody shops for "a case" — they shop for a case that fits THEIR phone, and with no
     * such facet the 1,239 phone cases were an undifferentiated wall.
     * ⚠️ The values were read OFF THE CATALOGUE, not guessed: iPhone 17 (269), 16 (263), 15 (136),
     * iPad (102), MacBook (78), Apple Watch (77), Galaxy S26 (56)… A list invented from what phones
     * exist would have carried a dozen chips matching nothing and missed Galaxy A entirely.
     * ⚠️ Galaxy A is ONE chip, not thirteen: A04…A57 appear 1-10 times each, and a chip that matches
     * two products is noise in a panel.
     */
    key: 'compatibleWith', label: 'Fits', labelVi: 'Dành cho',
    subcats: ['phone-cases', 'screen-protectors', 'bags-sleeves', 'cables-chargers', 'accessories'],
    values: [
      { value: 'iphone17', label: 'iPhone 17' }, { value: 'iphone16', label: 'iPhone 16' },
      { value: 'iphone15', label: 'iPhone 15' }, { value: 'iphone14', label: 'iPhone 14' },
      { value: 'iphone13', label: 'iPhone 13' }, { value: 'iphone12', label: 'iPhone 12' },
      { value: 'iphone11', label: 'iPhone 11' },
      { value: 'ipad', label: 'iPad' }, { value: 'macbook', label: 'MacBook' },
      { value: 'applewatch', label: 'Apple Watch' }, { value: 'airpods', label: 'AirPods' },
      { value: 'galaxys26', label: 'Galaxy S26' }, { value: 'galaxys25', label: 'Galaxy S25' },
      { value: 'galaxys24', label: 'Galaxy S24' }, { value: 'galaxys23', label: 'Galaxy S23' },
      { value: 'galaxya', label: 'Galaxy A' }, { value: 'galaxyz', label: 'Galaxy Z Fold / Flip' },
      { value: 'galaxytab', label: 'Galaxy Tab' },
      { value: 'xiaomi', label: 'Xiaomi / Redmi / POCO' },
      { value: 'oppo', label: 'OPPO' }, { value: 'vivo', label: 'vivo' },
    ],
  },
  {
    key: 'printerKind', label: 'Type', labelVi: 'Loại', subcats: ['printers'],
    values: [
      { value: 'laser', label: 'Laser' }, { value: 'inkjet', label: 'Inkjet', labelVi: 'Phun mực' },
      { value: 'inktank', label: 'Ink tank', labelVi: 'Bơm mực ngoài' },
      { value: 'scanner', label: 'Scanner', labelVi: 'Máy quét' },
    ],
  },
]

/**
 * Specs offered on a subcategory, in chip order, with values narrowed to that subcategory.
 * ⚠️ Returns NARROWED copies — call sites must read `.values` from what this returns, never from
 * the SPECS table directly, or a phone gets offered 128 GB of RAM again.
 */
export function specsFor(subcategorySlug: string | null | undefined): SpecDef[] {
  if (!subcategorySlug) return []
  return SPECS.filter((s) => s.subcats.includes(subcategorySlug)).map((s) => {
    const only = s.valuesBySubcat?.[subcategorySlug]
    return only ? { ...s, values: s.values.filter((v) => only.includes(v.value)) } : s
  })
}

/**
 * Is `value` a legal canonical value for `key`? The gate every writer passes through.
 *
 * ⛔ PASS THE SUBCATEGORY. Without it this checks the GLOBAL value list, so `ram = 128` — legal on
 * a workstation — passes for a phone. That is not hypothetical: it shipped, and 134 live listings
 * claimed an iPhone 14 Plus had 128GB of RAM before it was caught. `valuesBySubcat` exists exactly
 * so a phone cannot hold a laptop's RAM, and a gate that ignores it is not a gate.
 */
export function isLegalSpec(key: SpecKey, value: string, subcategorySlug?: string | null): boolean {
  const spec = SPECS.find((s) => s.key === key)
  if (!spec) return false
  if (subcategorySlug) {
    if (!spec.subcats.includes(subcategorySlug)) return false
    const only = spec.valuesBySubcat?.[subcategorySlug]
    if (only) return only.includes(value)
  }
  return spec.values.some((v) => v.value === value)
}

// ── Deterministic extraction ─────────────────────────────────────────────────
/**
 * Read specs out of a merchant product title.
 *
 * ⛔ DETERMINISTIC FIRST, LLM ONLY FOR THE GAPS. The specs are usually already IN the title
 * ("Meizu Mblu 22 Pro NFC 8GB 256GB", "Samsung Galaxy Watch9 40mm"), so a regex pass is free,
 * instant, and — the part that matters on a live marketplace — incapable of inventing a capacity
 * that does not exist. An LLM asked to extract 9,726 of these WILL hallucinate some, and a
 * hallucinated "512GB" on a 128GB phone is a false advertisement we published.
 * ⚠️ Every value is validated against the closed list before it is returned, so a parse that finds
 * "48GB" (real, but not a chip) yields nothing rather than an unfilterable orphan value.
 */
export function extractSpecs(subcategorySlug: string | null | undefined, title: string): Record<string, string> {
  const allowed = new Set(specsFor(subcategorySlug).map((s) => s.key))
  if (!allowed.size) return {}
  const out: Record<string, string> = {}
  const t = ` ${title} `
  const put = (k: SpecKey, v: string | number | null | undefined) => {
    if (v == null || !allowed.has(k)) return
    const s = String(v)
    if (isLegalSpec(k, s, subcategorySlug) && !(k in out)) out[k] = s
  }

  /**
   * Capacities. Three rules, in decreasing order of confidence.
   *
   * 1. A LABELLED capacity is believed outright ("RAM 16GB", "SSD 512GB", "Bộ nhớ 256GB").
   * 2. Otherwise an unlabelled PAIR is read positionally — "8GB 256GB" is RAM then storage, and
   *    there is no unit difference to key on; Vietnamese retail titles put RAM first.
   * 3. A lone capacity is whichever slot it is legal in FOR THIS SUBCATEGORY.
   *
   * ⛔ GPU MEMORY IS NOT RAM. "Laptop RTX 8GB, RAM 16GB, SSD 512GB" read positionally gives
   * 8GB RAM / 16GB storage — both wrong, from a number that describes the graphics card. Capacities
   * attached to a GPU marker are dropped before anything else looks at them.
   */
  const GPU = /(rtx|gtx|radeon|vram|geforce|card đồ họa)\s*[a-z0-9 ]{0,12}$/i
  const capAt = [...t.matchAll(/(\d+)\s*(GB|TB)\b/gi)].map((m) => ({
    n: m[2].toUpperCase() === 'TB' ? Number(m[1]) * 1024 : Number(m[1]),
    before: t.slice(Math.max(0, m.index! - 22), m.index!),
  })).filter((c) => !GPU.test(c.before))

  /**
   * Try each labelled pattern and take the first that yields a LEGAL value for this key.
   * ⛔ "FIRST PATTERN THAT MATCHES" IS NOT ENOUGH. In "laptop 16GB RAM 512GB SSD" the leading-label
   * pattern `RAM <n>GB` happily matches "RAM 512GB" — the 512 belongs to the SSD that follows —
   * and returns 512, which is not a legal RAM size, so the RAM was dropped entirely. Validating
   * inside the search lets the trailing-label pattern ("16GB RAM") supply the right answer.
   */
  /**
   * @param res patterns tried in order; `guard` means "a GPU marker just before the NUMBER makes
   *   this match untrustworthy".
   * ⛔ THE GUARD BELONGS ONLY TO THE TRAILING FORM. In "Laptop RTX 8GB RAM 32GB" the trailing
   *   pattern matches "8GB RAM", where the 8 is the card's VRAM — that needs the guard. The
   *   LEADING form "RAM 32GB" names its slot before the number, so it is unambiguous no matter
   *   what precedes it; guarding it too rejected the correct 32 and returned nothing at all.
   */
  const labelled = (key: SpecKey, ...res: { re: RegExp; guard: boolean; onlyIfSingleCapacity?: boolean }[]) => {
    for (const { re, guard, onlyIfSingleCapacity } of res) {
      // ⛔ The unguarded last resort is ONLY safe when there is nothing to be ambiguous ABOUT.
      // With two capacities in play ("RTX 8GB RAM 128GB SSD") it happily claimed the SSD's 128 as
      // system RAM — reintroducing, through the back door, the exact adjacency bug the guarded
      // patterns exist to prevent.
      if (onlyIfSingleCapacity && capAt.length !== 1) continue
      // ⚠️ EVERY occurrence, not just the first. "512GB RAM unavailable; choose 16GB RAM" rejected
      // 512 and then abandoned the pattern, losing the 16 that came after it.
      for (const m of t.matchAll(new RegExp(re.source, `${re.flags.replace('g', '')}g`))) {
        if (guard && GPU.test(t.slice(Math.max(0, m.index! - 22), m.index!))) continue
        const n = m[2]?.toUpperCase() === 'TB' ? Number(m[1]) * 1024 : Number(m[1])
        if (isLegalSpec(key, String(n), subcategorySlug)) return n
      }
    }
    return null
  }
  /**
   * ⚠️ THE LABEL CAN COME EITHER SIDE OF THE NUMBER. Vietnamese retail writes "RAM 16GB"; English
   * titles and, more importantly, people typing into search write "16GB RAM" / "a laptop with
   * 128gb ram". Reading only the leading form meant that query fell through to the positional rule,
   * which called 128 a STORAGE size — so the search asked for a 128GB disk and found nothing.
   */
  /**
   * ⛔ A LEADING LABEL MUST NOT CLAIM A NUMBER THAT BELONGS TO THE NEXT LABEL. In
   * "Laptop 16GB RAM 128GB SSD" the leading pattern `RAM <n>GB` happily matches "RAM 128GB" —
   * and 128 IS a legal RAM size, so validation could not catch it and the row was indexed with
   * 128GB of RAM instead of 16GB. Two reviewers found this independently, in the same minute.
   * The negative lookahead makes the pairing unambiguous: a capacity immediately followed by a
   * DIFFERENT spec label belongs to that label, not to the one before it.
   */
  /**
   * ⚠️ THE LOOKAHEAD NEEDS ITS OWN LOOKAHEAD, and getting this wrong breaks the commonest form.
   * Two shapes, both real, differing only in whether the NEXT label carries its own number:
   *   "16GB RAM 128GB SSD"  — "RAM 128GB" then bare "SSD": the SSD owns the 128  → REJECT
   *   "RAM 16GB SSD 512GB"  — "RAM 16GB"  then "SSD 512GB": the SSD has its own  → ACCEPT
   * A flat `(?!\s*ssd)` rejects both and drops the RAM from the standard Vietnamese retail form.
   * ⚠️ Vietnamese labels and the word "of" belong inside it too, or the same ambiguity walks
   * straight back in through "128GB bộ nhớ trong" and "128GB of storage".
   */
  // ⚠️ `(?![a-z0-9])` NOT `\b` AFTER A VIETNAMESE LABEL. JS word boundaries are ASCII-only, so
  // `bộ nhớ\b` needs a word char right after "ớ" and never matched at end-of-string or before a
  // space — the same trap that made `thẻ nhớ\b` dead. Measured: "16GB RAM 128GB bộ nhớ" read as
  // 128GB of RAM.
  const ST = String.raw`(?:of\s*)?(?:ssd|hdd|storage|rom|bộ nhớ trong|bộ nhớ)(?![a-z0-9])`
  const NOT_STORAGE = String.raw`(?!\s*${ST}(?!\s*\d))`
  const NOT_RAM = String.raw`(?!\s*(?:of\s*)?ram\b(?!\s*\d))`
  const ramLabelled = labelled('ram',
    { re: new RegExp(String.raw`\bram\s*:?\s*(\d+)\s*(GB|TB)\b` + NOT_STORAGE, 'i'), guard: false },
    { re: /\b(\d+)\s*(GB|TB)\s*(?:of\s*)?ram\b/i, guard: true },
    /**
     * ⚠️ LAST RESORT: the leading form WITHOUT the adjacency lookahead. "Laptop RAM 16GB SSD" names
     * an SSD with no size of its own, so the lookahead — written for "16GB RAM 128GB SSD" — rejected
     * a 16 that is plainly the RAM. Trying it only after the other two keeps the real ambiguity
     * resolved (there, the trailing form supplies the answer before this ever runs) while letting an
     * unambiguous title through.
     */
    { re: /\bram\s*:?\s*(\d+)\s*(GB|TB)\b/i, guard: false, onlyIfSingleCapacity: true })
  const storageLabelled = labelled('storage',
    { re: new RegExp(String.raw`\b(?:ssd|hdd|rom|bộ nhớ trong|bộ nhớ|storage)\s*:?\s*(\d+)\s*(GB|TB)\b` + NOT_RAM, 'i'), guard: false },
    // ⚠️ `of` here too — "512GB of storage" is as natural as "16GB of RAM" — and the Vietnamese
    // trailing form "128GB bộ nhớ trong", which had no pattern at all.
    { re: /\b(\d+)\s*(GB|TB)\s*(?:of\s*)?(?:ssd|hdd|storage|rom|bộ nhớ trong|bộ nhớ)(?![a-z0-9])/i, guard: true })
  if (ramLabelled != null) put('ram', ramLabelled)
  if (storageLabelled != null) put('storage', storageLabelled)

  const caps = capAt.map((c) => c.n)
  /**
   * ⚠️ A PARTIALLY LABELLED TITLE STILL NEEDS THE POSITIONAL PASS. Guarding on "neither was
   * labelled" threw away the sibling: "Laptop RAM 16GB 512GB" found RAM and then skipped the block
   * that would have read 512 as storage, and "Laptop 16GB SSD 512GB" lost the RAM the same way.
   * The positional read now runs whenever a slot is still empty, and `put` already refuses to
   * overwrite a labelled value — so the label always wins and the leftover capacity is claimed by
   * whichever slot the label did not fill.
   */
  const bothLabelled = ramLabelled != null && storageLabelled != null
  if (!bothLabelled) {
    if (ramLabelled != null && caps.length >= 1) {
      // RAM is known; the remaining capacity that is not the RAM figure is the storage.
      const rest = caps.filter((n) => n !== ramLabelled)
      if (rest.length) put('storage', rest[rest.length - 1])
    } else if (storageLabelled != null && caps.length >= 1) {
      const rest = caps.filter((n) => n !== storageLabelled)
      if (rest.length) put('ram', rest[0])
    } else if (caps.length >= 2) { put('ram', caps[0]); put('storage', caps[1]) }
    else if (caps.length === 1) {
      /**
       * ⚠️ THE LEGALITY CHECK MUST CARRY THE SUBCATEGORY, or a lone capacity falls between the two
       * slots and is lost. "Laptop Asus 32GB": 32 is a legal storage value GLOBALLY (phones sell at
       * 32GB), so the storage branch was taken — then rejected, because laptop storage starts at
       * 128GB — and the RAM branch never ran. Result: {} on every 32GB and 64GB laptop.
       */
      const v = String(caps[0])
      if (isLegalSpec('storage', v, subcategorySlug)) put('storage', caps[0])
      else put('ram', caps[0])
    }
  }

  // Watch case size: "40mm", "44 mm", "Watch9 45mm".
  put('caseSize', t.match(/\b(\d{2})\s?mm\b/i)?.[1])

  /**
   * Cellular. ⛔ 5G IS TESTED FIRST because `put` keeps the first value it accepts, and a 5G phone
   * that also says "eSIM" or "LTE" — most of them — was being locked to `lte`, hiding it from the
   * 5G chip entirely. 5G is the more specific claim and the one a shopper filters on.
   * ⚠️ On a WATCH the meaningful split is cellular-vs-GPS-only, and watches are not marketed as 5G,
   * so that pair still works: `connectivity` is offered on smartwatch and phones-tablets, and each
   * reads the value its own shoppers use.
   */
  if (/\b5g\b/i.test(t)) put('connectivity', '5g')
  else if (/\b(lte|4g|esim|cellular)\b/i.test(t)) put('connectivity', 'lte')
  else if (/\bgps\b/i.test(t)) put('connectivity', 'gps')

  // CPU family. Intel's "i5-1334U" and "Ultra 7 155H", AMD's "Ryzen 5", Apple's bare "M4".
  const cpu =
    /\bultra\s?([579])\b/i.test(t) ? `ultra${t.match(/\bultra\s?([579])\b/i)![1]}` :
    /\bi([3579])[\s-]?\d{4,5}/i.test(t) ? `i${t.match(/\bi([3579])[\s-]?\d{4,5}/i)![1]}` :
    /\bcore\s?i([3579])\b/i.test(t) ? `i${t.match(/\bcore\s?i([3579])\b/i)![1]}` :
    /\bryzen\s?([3579])\b/i.test(t) ? `ryzen${t.match(/\bryzen\s?([3579])\b/i)![1]}` :
    /*
     * ⛔ NO `(?!\s?g)` LOOKAHEAD. It was meant to dodge "4G"/"5G", which it never needed to —
     * those have no leading `m`, so `\bm([1-5])\b` cannot match them. What it DID match was the
     * space-then-G in "MacBook Air M3 Gray", "M2 Gold" and "M4 Giá rẻ", silently dropping the CPU
     * from every colour- or Vietnamese-suffixed Mac. Measured: 3 of 5 real titles lost their chip.
     * `cpu` only applies to laptops-pcs, so a phone called "M5" can never pick this up.
     */
    /\bm([12345])\b/i.test(t) ? `m${t.match(/\bm([12345])\b/i)![1]}` :
    /\bceleron\b/i.test(t) ? 'celeron' :
    /\bsnapdragon\b/i.test(t) ? 'snapdragon' : null
  put('cpu', cpu)

  // Screen size. "15.6 inch" / '27"' / "15.6in". Laptops round DOWN to the marketed class
  // (15.6" is a 15" laptop); monitors and TVs are already sold at whole inches.
  const inches = t.match(/(\d{2}(?:[.,]\d)?)\s*(?:inch|in\b|"|”|''|inches)/i)?.[1]?.replace(',', '.')
  if (inches) {
    put('screenSize', String(Math.round(Number(inches))))
    put('laptopSize', String(Math.floor(Number(inches))))
  }

  put('resolution',
    /\b8k\b/i.test(t) ? '8k' :
    /\b(4k|uhd|2160p)\b/i.test(t) ? '4k' :
    /\b(2k|qhd|1440p|wqhd)\b/i.test(t) ? '2k' :
    /\b(full\s?hd|fhd|1080p)\b/i.test(t) ? 'fhd' :
    /\bhd\b/i.test(t) ? 'hd' : null)

  put('refreshRate', t.match(/\b(\d{2,3})\s?hz\b/i)?.[1])
  put('wattage', t.match(/\b(\d{2,3})\s?w\b/i)?.[1])
  put('capacity', t.match(/\b(\d{4,6})\s?mah\b/i)?.[1])

  put('storageType',
    // ⚠️ NO `\b` AFTER "nhớ". JS word boundaries are ASCII-only, so `thẻ nhớ\b` requires a word
    // char right after "ớ" and never matches "Thẻ nhớ 128GB". Anchor on the phrase itself.
    /\bmicro\s?sd|thẻ nhớ/i.test(t) ? 'microsd' :
    /\bssd\b/i.test(t) ? 'ssd' : /\bhdd\b/i.test(t) ? 'hdd' :
    /\busb|flash drive\b/i.test(t) ? 'usb' : null)

  put('audioType',
    /\bsoundbar|loa thanh\b/i.test(t) ? 'soundbar' :
    // ⛔ NOT a bare `micro`. "Loa kéo karaoke kèm micro" and "tai nghe có micro" are a speaker and
    // an earphone that INCLUDE a mic — filing them under Microphone is how a category fills with
    // things that are not it. Require the standalone English word or the Vietnamese noun phrase.
    // ⚠️ NOT `^micro` — `t` is space-padded (` ${title} `), so a start-anchor can never match and
    // "Micro không dây Shure" fell through to the không-dây test and was stored as TWS earbuds.
    /\bmicrophone\b|\bmic thu âm\b|^\s*micro\b/i.test(t) ? 'microphone' :
    /\bloa\b|\bspeaker\b/i.test(t) ? 'speaker' :
    /chụp tai|over[- ]?ear|headphone/i.test(t) ? 'headphone' :
    /true\s?wireless|\btws\b|không dây/i.test(t) ? 'tws' :
    /tai nghe|earphone|earbud/i.test(t) ? 'earphone' : null)

  put('deviceKind',
    /bộ.*phím.*chuột|combo|keyboard.*mouse/i.test(t) ? 'combo' :
    /lót chuột|mouse ?pad|deskmat/i.test(t) ? 'mousepad' :
    /bàn phím|keyboard/i.test(t) ? 'keyboard' :
    /\bchuột\b|\bmouse\b/i.test(t) ? 'mouse' : null)

  put('wifiStandard',
    /wi-?fi\s?7|be\d{4}/i.test(t) ? 'wifi7' : /wi-?fi\s?6e/i.test(t) ? 'wifi6e' :
    /wi-?fi\s?6|ax\d{3,4}/i.test(t) ? 'wifi6' : /wi-?fi\s?5|ac\d{3,4}/i.test(t) ? 'wifi5' : null)

  put('cameraKind',
    /flycam|drone/i.test(t) ? 'drone' : /webcam/i.test(t) ? 'webcam' :
    /hành trình|action ?cam|gopro|insta360/i.test(t) ? 'action' :
    /an ninh|security|giám sát|ip cam/i.test(t) ? 'security' :
    /mirrorless|không gương/i.test(t) ? 'mirrorless' : /\bdslr\b/i.test(t) ? 'dslr' : null)

  /**
   * ⚠️ THIS IS A PRECEDENCE LIST, NOT TITLE ORDER — a reviewer read the previous comment as a claim
   * about which mention comes first in the string, which is not what the chain does and not what it
   * should do. An accessory title names exactly one target ("Ốp lưng iPhone 16 Pro Max"); when a
   * second device is mentioned it is compatibility chatter, and the NEWEST generation is the one
   * the product is actually sold for. Newest-first is therefore correct regardless of position.
   */
  const compat =
    /iphone\s?17/i.test(t) ? 'iphone17' : /iphone\s?16/i.test(t) ? 'iphone16' :
    /iphone\s?15/i.test(t) ? 'iphone15' : /iphone\s?14/i.test(t) ? 'iphone14' :
    /iphone\s?13/i.test(t) ? 'iphone13' : /iphone\s?12/i.test(t) ? 'iphone12' :
    /iphone\s?11/i.test(t) ? 'iphone11' :
    /\bipad\b/i.test(t) ? 'ipad' : /macbook/i.test(t) ? 'macbook' :
    /apple\s?watch|watch\s?ultra/i.test(t) ? 'applewatch' : /airpods/i.test(t) ? 'airpods' :
    /galaxy\s?s\s?26/i.test(t) ? 'galaxys26' : /galaxy\s?s\s?25/i.test(t) ? 'galaxys25' :
    /galaxy\s?s\s?24/i.test(t) ? 'galaxys24' : /galaxy\s?s\s?23/i.test(t) ? 'galaxys23' :
    /galaxy\s?z|galaxy\s?(fold|flip)/i.test(t) ? 'galaxyz' :
    /galaxy\s?tab/i.test(t) ? 'galaxytab' : /galaxy\s?a\s?\d/i.test(t) ? 'galaxya' :
    /xiaomi|redmi|\bpoco\b/i.test(t) ? 'xiaomi' : /\boppo\b/i.test(t) ? 'oppo' :
    /\bvivo\b/i.test(t) ? 'vivo' : null
  put('compatibleWith', compat)

  put('printerKind',
    /\bscan(ner)?\b|máy quét/i.test(t) ? 'scanner' :
    /ink ?tank|bơm mực|phun mực liên tục/i.test(t) ? 'inktank' :
    /\blaser\b/i.test(t) ? 'laser' : /phun mực|inkjet/i.test(t) ? 'inkjet' : null)

  return out
}

/**
 * The facet chips for these specs, in the shape taxonomy.ts's `FacetDef` expects.
 *
 * ⛔ GENERATED, NOT HAND-MAINTAINED, AND THAT IS THE WHOLE POINT. The hand-written chips had
 * drifted from the values anything actually stored: the `cpu` facet offered `intel-i5` /
 * `apple-silicon` while every extractor writes `i5` / `m4`, so those chips matched ZERO rows and
 * looked like "no products" rather than like a bug. One table, one set of values, no drift.
 *
 * ⛔ EVERY GENERATED FACET IS `optional`. `isRequiredFacet` treats a non-range, non-derived,
 * non-optional facet as REQUIRED TO PUBLISH — so shipping these as required would stop an ordinary
 * seller posting a phone until they filled in RAM, storage and connectivity. Standing owner policy
 * is maximum posting leniency at launch; these describe a merchant's catalogue, they are not a
 * hurdle for a person selling one used handset.
 *
 * ⚠️ The structural return type (not an imported `FacetDef`) keeps the dependency one-way:
 * taxonomy.ts imports this file, never the reverse.
 */
export function specFacets(): {
  key: string; label: string; labelVi: string; kind: 'toggle'; subcats: string[]; optional: true
  options: { value: string; label: string; labelVi: string }[]
}[] {
  const out: ReturnType<typeof specFacets> = []
  for (const s of SPECS) {
    /**
     * ⚠️ A SPEC WITH NARROWED VALUES BECOMES ONE FACET PER GROUP OF SUBCATEGORIES THAT SHARE A
     * VALUE LIST, not one facet for all of them. `facetsFor` picks by `subcats`, so a single entry
     * could only ever carry ONE option list — and whichever it carried would be wrong for the
     * other subcategory. Splitting keeps the same facet KEY (so stored values and URLs are
     * unchanged) while letting phones and laptops offer different capacities.
     */
    const groups = new Map<string, string[]>()
    for (const sub of s.subcats) {
      const only = s.valuesBySubcat?.[sub]
      const sig = only ? only.join(',') : '*'
      groups.set(sig, [...(groups.get(sig) ?? []), sub])
    }
    for (const [sig, subs] of groups) {
      const values = sig === '*' ? s.values : s.values.filter((v) => sig.split(',').includes(v.value))
      out.push({
        key: s.key, label: s.label, labelVi: s.labelVi, kind: 'toggle' as const,
        subcats: subs, optional: true as const,
        options: values.map((v) => ({ value: v.value, label: v.label, labelVi: v.labelVi ?? v.label })),
      })
    }
  }
  return out
}

/**
 * Extract from SEVERAL titles for one product (the merchant's original and its translation) and
 * merge, first non-empty per key.
 *
 * ⛔ NEVER CONCATENATE THE TITLES AND PARSE ONCE. That is the bug this function exists to make
 * unrepeatable: "iPhone 15 128GB" + "iPhone 15 128GB" concatenated yields the capacity list
 * [128, 128], which the ordered RAM/storage pair rule reads as "128GB RAM, 128GB storage". It put
 * 128GB of RAM on 134 live iPhones and iPads. Parsing each title on its own keeps every capacity
 * list exactly as long as the product's real spec.
 * ⚠️ Order matters: pass the most trustworthy title first. Earlier titles win each key.
 */
export function extractSpecsFromTitles(subcategorySlug: string | null | undefined, titles: (string | null | undefined)[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const t of titles) {
    if (!t) continue
    for (const [k, v] of Object.entries(extractSpecs(subcategorySlug, t))) if (!(k in out)) out[k] = v
  }
  return out
}
