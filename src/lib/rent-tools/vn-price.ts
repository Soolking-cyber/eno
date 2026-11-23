/**
 * Vietnamese price shorthand → an exact amount in đồng, for /vietnamese-price-converter and the money fields of the other
 * rent tools ("15tr", "1,5 tỷ", "800k", "15 triệu 500", "mười lăm triệu", "2 tỷ 3").
 *
 * ⚠️ NOT src/lib/query-parse.ts, ALTHOUGH IT ALSO READS "8tr". That parser pulls a price FILTER out of a search box, so it
 * is built to leave model numbers alone ("i7 9700k", "đèn 6500k", "nhà 80m") and refuses anything else it is unsure of;
 * its helpers are private, it has no spelled-out numbers and no "15 triệu 500". Here the whole input IS a price, so the
 * question is only which amount it names — and when two amounts are honestly possible, the answer is a refusal that
 * names both, never a guess.
 *
 * The rules, in order of how often they decide something:
 *   · Units: k / nghìn / ngàn / thousand = 1.000; tr / triệu / củ / million = 1.000.000; tỷ / tỉ / billion = 1.000.000.000;
 *     "nghìn tỷ" = 1.000 tỷ. "m" and "b" are NOT units here (metres, bytes), and neither is any other word.
 *   · A separator before a unit is a decimal point when 1–2 digits follow it ("1.5 tỷ", "1,5 tỷ", "1,25 tỷ"). With 3
 *     digits it is refused: "1.500 triệu" is 1.500 triệu in Vietnamese grouping and 1.5 triệu in English.
 *   · Digits after a unit CONTINUE it, as people write them: "2 tỷ 3" = 2,3 tỷ, "15tr5" = 15,5 triệu, and three digits
 *     are the whole next group ("15 triệu 500" = 15.500.000, "15 triệu 050" = 15.050.000). TWO digits are refused:
 *     "15tr50" is 15.500.000 by that rule and 15.050.000 read as "50 nghìn", and nothing in the text decides.
 *   · A number with no unit is đồng when it is at least 1.000 ("15000000", "15.000.000", "15,000,000"); a smaller one
 *     ("15") is refused, since it is shorthand for 15k, 15 triệu or 15 tỷ with the unit left out.
 *   · Spelled-out Vietnamese numbers read the same way ("mười lăm triệu", "hai tỷ ba trăm triệu", "hai triệu tư",
 *     "mười lăm triệu rưỡi"); diacritics are required on number words, since "nam" or "muoi" could be other words.
 *   · …except a spelled group that says its hundreds ("không trăm năm mươi", "năm trăm"): that is đồng, as an amount is
 *     written "bằng chữ", so every amount vietnameseWords writes reads back exactly. And an explicit "đồng" after digits
 *     the shorthand would continue ("1 triệu 500 đồng") is refused with both readings.
 */

export type Unit = { factor: number; word: string }

export const MAX_VND = 1_000_000_000_000_000 // one triệu tỷ: past this it is not a price

export type PriceRefusal =
  | { code: 'empty' }
  | { code: 'negative' }
  | { code: 'zero' }
  | { code: 'tooLarge' }
  | { code: 'range' }
  | { code: 'unknownWord'; word: string }
  /** A number with no unit, below 1.000 ("15", "mười lăm"). */
  | { code: 'noUnit'; text: string }
  /** A decimal with no unit ("1,5"). */
  | { code: 'decimalNoUnit'; text: string }
  /** Đồng have no decimals ("1,5 đ"). */
  | { code: 'fraction' }
  /** "1.500 triệu": two readings a thousand times apart. `a` reads the separator as grouping, `b` as a decimal point. */
  | { code: 'ambiguousSeparator'; text: string; a: number; b: number }
  /** "15tr50": `a` continues the unit (15,50 triệu), `b` reads the digits as the next unit (15 triệu 50 nghìn). */
  | { code: 'ambiguousTail'; text: string; a: number; b: number }
  /** "1 triệu 50 đồng": three readings — continued (`a`, 1.500.000), the next unit (`b`, 1.050.000), as written (`c`, 1.000.050). */
  | { code: 'ambiguousTailCurrency'; text: string; a: number; b: number; c: number }
  /** "1 triệu 500 đồng": `a` continues the unit (the shorthand, 1.500.000), `b` takes the digits as the đồng they say (1.000.500). */
  | { code: 'ambiguousCurrency'; text: string; a: number; b: number }
  /** Units out of order or repeated ("15tr 20tr", "500 nghìn 2 triệu") — often two amounts in one box. */
  | { code: 'unitOrder' }
  | { code: 'malformed' }

/** What the reading did that a reader may not expect, so the page can say it before the number. */
export type PriceNote =
  | { kind: 'bare' }
  | { kind: 'tail'; tail: string; unit: string; adds: number }
  | { kind: 'half'; unit: string }
  /** A spelled group with its hundreds said, read as đồng ("mười lăm triệu năm trăm" → + 500 đ). */
  | { kind: 'literal'; tail: string; unit: string; adds: number }

export type PriceReading = { ok: true; vnd: number; perMonth: boolean; notes: PriceNote[] }
export type PriceResult = PriceReading | { ok: false; refusal: PriceRefusal }

const UNIT_WORDS: Record<string, Unit> = {
  k: { factor: 1e3, word: 'nghìn' },
  nghìn: { factor: 1e3, word: 'nghìn' },
  ngàn: { factor: 1e3, word: 'nghìn' },
  nghin: { factor: 1e3, word: 'nghìn' },
  ngan: { factor: 1e3, word: 'nghìn' },
  thousand: { factor: 1e3, word: 'nghìn' },
  tr: { factor: 1e6, word: 'triệu' },
  triệu: { factor: 1e6, word: 'triệu' },
  trieu: { factor: 1e6, word: 'triệu' },
  củ: { factor: 1e6, word: 'triệu' },
  million: { factor: 1e6, word: 'triệu' },
  tỷ: { factor: 1e9, word: 'tỷ' },
  tỉ: { factor: 1e9, word: 'tỷ' },
  ty: { factor: 1e9, word: 'tỷ' },
  ti: { factor: 1e9, word: 'tỷ' },
  billion: { factor: 1e9, word: 'tỷ' },
}

const CURRENCY = new Set(['đ', 'đồng', 'dong', 'vnd', 'vnđ'])

/** Spelled digits. Both spellings of 1, 4 and 5 are accepted anywhere: neither has another reading in a price. */
const DIGIT_WORDS: Record<string, number> = {
  không: 0, một: 1, mốt: 1, hai: 2, ba: 3, bốn: 4, tư: 4, năm: 5, lăm: 5, nhăm: 5, sáu: 6, bảy: 7, bẩy: 7, tám: 8, chín: 9,
}

type Tok =
  | { t: 'num'; raw: string }
  | { t: 'digit'; v: number; raw: string }
  | { t: 'ten' } // mười
  | { t: 'tens' } // mươi
  | { t: 'hundred' } // trăm
  | { t: 'zeroTens' } // linh / lẻ
  | { t: 'unit'; unit: Unit; raw: string }
  | { t: 'half' } // rưỡi
  | { t: 'cur' }

function classify(word: string): Tok | null {
  if (/^\d/.test(word)) return { t: 'num', raw: word }
  if (Object.hasOwn(UNIT_WORDS, word)) return { t: 'unit', unit: UNIT_WORDS[word], raw: word }
  if (Object.hasOwn(DIGIT_WORDS, word)) return { t: 'digit', v: DIGIT_WORDS[word], raw: word }
  if (word === 'mười') return { t: 'ten' }
  if (word === 'mươi') return { t: 'tens' }
  if (word === 'trăm') return { t: 'hundred' }
  if (word === 'linh' || word === 'lẻ') return { t: 'zeroTens' }
  if (word === 'rưỡi') return { t: 'half' }
  if (CURRENCY.has(word)) return { t: 'cur' }
  return null
}

const refuse = (refusal: PriceRefusal): PriceResult => ({ ok: false, refusal })

/** A digit run as written: a plain integer, a grouped one ("15.000.000"), or a decimal (one separator, 1–3 digits after). */
type Numeral =
  | { kind: 'int'; value: number; digits: string; grouped: boolean }
  | { kind: 'dec'; int: number; frac: string; sepThree: boolean; raw: string }

function readNumeral(raw: string): Numeral | 'tooLarge' | null {
  const s = raw.replace(/[.,]+$/, '')
  // ⛔ BY VALUE AGAINST MAX_VND, INCLUSIVE — not by digit count, which refused 1000000000000000 (exactly MAX_VND). Any
  // figure up to MAX_VND is a safe integer, so Number() reads it exactly; anything past it is refused before it is used.
  const big = (n: number) => !Number.isFinite(n) || n > MAX_VND
  if (/^\d+$/.test(s)) return big(Number(s)) ? 'tooLarge' : { kind: 'int', value: Number(s), digits: s, grouped: false }
  // Two or more separators: grouping only, and the groups must be whole (8.000.000, 8,000,000 — never mixed).
  if (/^\d{1,3}([.,])\d{3}(?:\1\d{3})+$/.test(s)) {
    const digits = s.replace(/[.,]/g, '')
    return big(Number(digits)) ? 'tooLarge' : { kind: 'int', value: Number(digits), digits, grouped: true }
  }
  const one = /^(\d+)[.,](\d{1,3})$/.exec(s)
  if (one) {
    if (big(Number(one[1]))) return 'tooLarge'
    return { kind: 'dec', int: Number(one[1]), frac: one[2], sepThree: one[2].length === 3, raw: s }
  }
  return null
}

/** A spelled (or "5 trăm") group of up to three digits; `places` is how many digits it was said with, for the tail rule. */
type Group = { value: number; places: 1 | 2 | 3; hundreds: boolean }

function readSpelled(toks: Tok[]): Group | null {
  let i = 0
  let value = 0
  let places: 1 | 2 | 3 = 1
  const digitAt = (k: number): number | null => {
    const x = toks[k]
    if (x?.t === 'digit') return x.v
    if (x?.t === 'num' && /^\d$/.test(x.raw)) return Number(x.raw)
    return null
  }
  // [d trăm]
  const h = digitAt(0)
  if (h !== null && toks[1]?.t === 'hundred') {
    value = h * 100
    places = 3
    i = 2
  }
  const hundreds = i > 0
  const rest = toks.slice(i)
  if (rest.length === 0) return i > 0 ? { value, places, hundreds } : null
  // linh d
  if (rest[0].t === 'zeroTens') {
    if (i === 0 || rest.length !== 2 || rest[1].t !== 'digit' || rest[1].v === 0) return null
    return { value: value + rest[1].v, places, hundreds }
  }
  // mười [d]
  if (rest[0].t === 'ten') {
    if (rest.length === 1) return { value: value + 10, places: i ? 3 : 2, hundreds }
    if (rest.length === 2 && rest[1].t === 'digit' && rest[1].v > 0) return { value: value + 10 + rest[1].v, places: i ? 3 : 2, hundreds }
    return null
  }
  if (rest[0].t !== 'digit') return null
  const d = rest[0].v
  // "một trăm năm" is 150 to some and 105 to others: after trăm a lone digit needs its "linh" or "mươi".
  if (rest.length === 1) return i > 0 ? null : { value: d, places: 1, hundreds }
  // d mươi [d]
  if (rest[1].t === 'tens') {
    if (d < 2) return null
    if (rest.length === 2) return { value: value + d * 10, places: i ? 3 : 2, hundreds }
    if (rest.length === 3 && rest[2].t === 'digit' && rest[2].v > 0) return { value: value + d * 10 + rest[2].v, places: i ? 3 : 2, hundreds }
    return null
  }
  // the spoken "hai lăm" (25), "ba mốt" (31), "hai tư" (24): only the forms that are never a leading digit
  if (rest.length === 2 && rest[1].t === 'digit' && d >= 2 && ['lăm', 'mốt', 'tư'].includes(rest[1].raw)) {
    return { value: value + d * 10 + rest[1].v, places: i ? 3 : 2, hundreds }
  }
  return null
}

/** A chunk between units: one numeral token, or a spelled group. */
type Chunk = { numeral: Numeral; text: string } | { group: Group; text: string }

function readChunk(toks: Tok[], text: string): Chunk | 'tooLarge' | null {
  if (toks.length === 1 && toks[0].t === 'num') {
    const n = readNumeral(toks[0].raw)
    if (n === 'tooLarge') return n
    return n ? { numeral: n, text } : null
  }
  const g = readSpelled(toks)
  return g ? { group: g, text } : null
}

/** Exact integer arithmetic for decimals: 1,25 × 1 tỷ without the float error in 1.25 * 1e9. */
const scaled = (int: number, frac: string, factor: number) => int * factor + (Number(frac) * factor) / 10 ** frac.length

export function parseVnPrice(input: string): PriceResult {
  let s = (input ?? '').normalize('NFC').toLowerCase().replace(/[  ]/g, ' ').replace(/₫/g, ' đ ').trim()
  if (!s) return refuse({ code: 'empty' })
  let perMonth = false
  const month = /\s*\/\s*(?:tháng|th|month|mo)\.?\s*$/
  if (month.test(s)) {
    perMonth = true
    s = s.replace(month, '').trim()
  }
  s = s.replace(/^giá\s*:?\s*/, '').trim()
  // Space as the thousands separator ("15 000 000"): adjacent digit groups can only be one number.
  s = s.replace(/(?<![\d.,])\d{1,3}(?: \d{3})+(?![\d.,])/g, (m) => m.replace(/ /g, ''))
  if (!s) return refuse({ code: 'empty' })
  if (/^[-−–]\s*\d/.test(s)) return refuse({ code: 'negative' })
  if (/\d\s*[a-zà-ỹđ]*\s*[-–—~]\s*\d/.test(s) || /(?:^|\s)(?:đến|tới|to)(?:\s|$)/.test(s)) return refuse({ code: 'range' })

  // Words, numerals (with their separators) and anything else, one character at a time. "15tr500" → 15 · tr · 500.
  const words = s.match(/\d[\d.,]*|[\p{L}\p{M}]+|\S/gu) ?? []
  const toks: Tok[] = []
  for (const w of words) {
    if (/^[.,:;!]$/.test(w)) continue
    const tok = classify(w)
    if (!tok) return refuse({ code: 'unknownWord', word: w })
    toks.push(tok)
  }
  // The currency mark may close the amount, once.
  while (toks.length && toks[toks.length - 1].t === 'cur') toks.pop()
  if (toks.some((x) => x.t === 'cur')) return refuse({ code: 'malformed' })
  if (!toks.length) return refuse({ code: 'malformed' })
  const hadCurrency = words.some((w) => CURRENCY.has(w))

  // ── A count of tỷ that is itself a compound number ("một nghìn năm trăm tỷ", "1 triệu tỷ", vietnameseWords' own form for
  // 1.000 tỷ and up): the run before that tỷ is read on its own, as a whole number of tỷ, and stands in for its digits.
  const tyAt = toks.findIndex((x, i) => x.t === 'unit' && x.unit.factor === 1e9 && toks.slice(0, i).some((y) => y.t === 'unit' && y.unit.factor < 1e9))
  if (tyAt > 0) {
    const head = evaluate(toks.slice(0, tyAt), false)
    if (!head.ok) return head
    // Only a plain count: no digits continuing a unit ("500 nghìn 2 tỷ" is two amounts, not 500.200 tỷ), no rưỡi.
    if (head.notes.some((n) => n.kind === 'tail' || n.kind === 'half') || !Number.isInteger(head.value)) return refuse({ code: 'unitOrder' })
    if (head.value > MAX_VND / 1e9) return refuse({ code: 'tooLarge' })
    toks.splice(0, tyAt, { t: 'num', raw: String(head.value) })
  }

  const r = evaluate(toks, hadCurrency)
  if (!r.ok) return r
  if (r.value === 0) return refuse({ code: 'zero' })
  return finish(r.value, perMonth, r.notes)
}

const label = (toks: Tok[]) => toks.map((x) => ('raw' in x ? x.raw : x.t === 'ten' ? 'mười' : x.t === 'tens' ? 'mươi' : x.t === 'hundred' ? 'trăm' : x.t === 'zeroTens' ? 'linh' : '')).join(' ')

type Evaluated = { ok: true; value: number; notes: PriceNote[] } | { ok: false; refusal: PriceRefusal }
const no = (refusal: PriceRefusal): Evaluated => ({ ok: false, refusal })

/** The amount a run of tokens names (the currency mark already taken off; `hadCurrency` says there was one). */
function evaluate(toks: Tok[], hadCurrency: boolean): Evaluated {
  // Split into [chunk, unit] pairs and a tail with no unit.
  const segments: { chunk: Tok[]; unit: Unit; unitRaw: string }[] = []
  let run: Tok[] = []
  let half = false
  for (const x of toks) {
    if (half) return no({ code: 'malformed' })
    if (x.t === 'unit') {
      if (!run.length) return no({ code: 'malformed' })
      segments.push({ chunk: run, unit: x.unit, unitRaw: x.raw })
      run = []
    } else if (x.t === 'half') {
      if (run.length || !segments.length) return no({ code: 'malformed' })
      half = true
    } else if (x.t === 'cur') return no({ code: 'malformed' })
    else run.push(x)
  }
  const tailToks = run

  // ── No unit at all: đồng, written out in full.
  if (!segments.length) {
    const c = readChunk(tailToks, label(tailToks))
    if (c === 'tooLarge') return no({ code: 'tooLarge' })
    if (!c) return no({ code: 'malformed' })
    if ('numeral' in c) {
      const n = c.numeral
      if (n.kind === 'dec') {
        // "1.500" with a đ is grouping; "1,5 đ" is a fraction of a đồng; "1,5" alone has lost its unit.
        if (!n.sepThree) return no(hadCurrency ? { code: 'fraction' } : { code: 'decimalNoUnit', text: n.raw })
      }
      const value = n.kind === 'dec' ? n.int * 1000 + Number(n.frac) : n.value
      if (value === 0) return no({ code: 'zero' })
      if (value < 1000 && !hadCurrency) return no({ code: 'noUnit', text: c.text })
      return { ok: true, value, notes: hadCurrency || n.kind === 'dec' || n.grouped ? [] : [{ kind: 'bare' }] }
    }
    if (c.group.value === 0) return no({ code: 'zero' })
    if (!hadCurrency) return no({ code: 'noUnit', text: c.text })
    return { ok: true, value: c.group.value, notes: [] }
  }

  // ── Units, strictly descending.
  for (let k = 1; k < segments.length; k++) {
    if (segments[k].unit.factor >= segments[k - 1].unit.factor) return no({ code: 'unitOrder' })
  }
  let total = 0
  const notes: PriceNote[] = []
  for (const [k, seg] of segments.entries()) {
    const c = readChunk(seg.chunk, label(seg.chunk))
    if (c === 'tooLarge') return no({ code: 'tooLarge' })
    if (!c) return no({ code: 'malformed' })
    const f = seg.unit.factor
    if ('numeral' in c) {
      const n = c.numeral
      if (n.kind === 'dec') {
        if (n.sepThree) {
          return no({ code: 'ambiguousSeparator', text: `${n.raw} ${seg.unitRaw}`, a: (n.int * 1000 + Number(n.frac)) * f, b: scaled(n.int, n.frac, f) })
        }
        // A decimal says the whole amount: nothing may follow it, and it opens the amount.
        if (k > 0 || segments.length > 1 || tailToks.length || half) return no({ code: 'malformed' })
        total += scaled(n.int, n.frac, f)
        continue
      }
      if (n.grouped && f > 1) {
        // "1.500.000 triệu" can only be grouping, but nobody writes a unit after a grouped figure: refuse rather than
        // multiply a full amount by a million.
        return no({ code: 'malformed' })
      }
      if (k > 0 && n.value >= 1000) return no({ code: 'unitOrder' })
      total += n.value * f
    } else {
      if (k > 0 && c.group.value >= 1000) return no({ code: 'unitOrder' })
      total += c.group.value * f
    }
  }
  const last = segments[segments.length - 1]
  if (half) {
    total += last.unit.factor / 2
    notes.push({ kind: 'half', unit: last.unit.word })
  }

  // ── The tail: what follows the last unit with no unit of its own.
  if (tailToks.length) {
    const f = last.unit.factor
    const c = readChunk(tailToks, label(tailToks))
    if (c === 'tooLarge' || !c) return no({ code: 'malformed' })
    const text = `${label(segments.flatMap((sg) => [...sg.chunk, { t: 'unit', unit: sg.unit, raw: sg.unitRaw } as Tok]))} ${c.text}`
    // ⛔ A SPELLED GROUP WITH ITS HUNDREDS SAID ("không trăm năm mươi", "năm trăm", "5 trăm") IS A LITERAL GROUP OF ĐỒNG,
    // the way a contract writes an amount "bằng chữ": vietnameseWords(1.000.050) is "một triệu không trăm năm mươi", and
    // reading that as a continuation gave 1.050.000. So "mười lăm triệu năm trăm" is 15.000.500 (a note says so, and
    // how to say 500 nghìn); the digit shorthand "15 triệu 500" still continues the unit.
    if ('group' in c && c.group.hundreds) {
      total += c.group.value
      notes.push({ kind: 'literal', tail: c.text, unit: last.unit.word, adds: c.group.value })
    } else {
      let places: number
      let value: number
      if ('numeral' in c) {
        if (c.numeral.kind !== 'int' || c.numeral.grouped) return no({ code: 'malformed' })
        places = c.numeral.digits.length
        value = c.numeral.value
      } else {
        places = c.group.places
        value = c.group.value
      }
      if (places > 3) return no({ code: 'malformed' })
      if (places === 2) {
        const a = total + (value * f) / 100
        const b = total + (value * f) / 1000
        // ⛔ WITH AN EXPLICIT ĐỒNG, THE AS-WRITTEN READING IS ONE OF THEM: "1 triệu 50 đồng" may be 1.000.050 as well as
        // 1.500.000 or 1.050.000. After nghìn "the next unit" already is đồng, so there it is two readings, not three.
        if (hadCurrency) {
          const c = total + value
          return no(c === b ? { code: 'ambiguousCurrency', text, a, b } : { code: 'ambiguousTailCurrency', text, a, b, c })
        }
        return no({ code: 'ambiguousTail', text, a, b })
      }
      const adds = places === 1 ? (value * f) / 10 : (value * f) / 1000
      // ⛔ AN EXPLICIT ĐỒNG AFTER THE TAIL SAYS THE DIGITS MAY BE ĐỒNG: "1 triệu 500 đồng" is 1.500.000 by the shorthand and
      // 1.000.500 as written. Two readings, so a refusal naming both — unless they agree ("800 nghìn 500 đồng").
      if (hadCurrency && adds !== value) return no({ code: 'ambiguousCurrency', text, a: total + adds, b: total + value })
      total += adds
      notes.push({ kind: 'tail', tail: c.text, unit: last.unit.word, adds })
    }
  }
  return { ok: true, value: total, notes }
}

function finish(vnd: number, perMonth: boolean, notes: PriceNote[]): PriceResult {
  if (!Number.isFinite(vnd) || vnd > MAX_VND) return refuse({ code: 'tooLarge' })
  if (vnd <= 0) return refuse({ code: 'zero' })
  if (!Number.isInteger(vnd)) return refuse({ code: 'fraction' })
  return { ok: true, vnd, perMonth, notes }
}

/* ── Reading an amount back ──────────────────────────────────────────────────────────────────── */

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín']

/** 0–999 as spoken. `inner`: a group after a higher one, which keeps its "không trăm" / "linh" (1.005.000 → "một triệu không trăm linh năm nghìn"). */
function readTriple(n: number, inner: boolean): string {
  const h = Math.floor(n / 100)
  const t = Math.floor(n / 10) % 10
  const u = n % 10
  const out: string[] = []
  const full = inner || h > 0
  if (full) out.push(DIGITS[h], 'trăm')
  if (t === 0) {
    if (u > 0 && full) out.push('linh')
  } else if (t === 1) out.push('mười')
  else out.push(DIGITS[t], 'mươi')
  if (u > 0) {
    if (u === 1 && t >= 2) out.push('mốt')
    else if (u === 5 && t >= 1) out.push('lăm')
    else if (u === 4 && t >= 2) out.push('tư')
    else out.push(DIGITS[u])
  }
  return out.join(' ')
}

/** Below one tỷ: triệu, nghìn and the last group, zero groups left out. */
function readBelowTy(n: number, inner: boolean): string {
  const parts: string[] = []
  const groups: [number, string][] = [[Math.floor(n / 1e6), 'triệu'], [Math.floor(n / 1e3) % 1000, 'nghìn'], [n % 1000, '']]
  let seen = inner
  for (const [g, word] of groups) {
    if (g === 0) continue
    parts.push(readTriple(g, seen) + (word ? ` ${word}` : ''))
    seen = true
  }
  return parts.join(' ')
}

/** An amount in Vietnamese words, as a contract or a receipt writes it "bằng chữ": 15.500.000 → "mười lăm triệu năm trăm nghìn". */
export function vietnameseWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) return ''
  if (n === 0) return 'không'
  if (n < 1e9) return readBelowTy(n, false)
  const ty = Math.floor(n / 1e9)
  const rest = n % 1e9
  const head = `${vietnameseWords(ty)} tỷ`
  return rest ? `${head} ${readBelowTy(rest, true)}` : head
}

/**
 * The amount in the shorthand's own units, exact: "15 triệu 500 nghìn" / "15 million 500 thousand". Groups of zero are left
 * out, and the last group is plain đồng.
 */
export function unitReading(n: number, lang: 'en' | 'vi'): string {
  if (!Number.isSafeInteger(n) || n <= 0) return ''
  const words = lang === 'vi' ? ['tỷ', 'triệu', 'nghìn'] : ['billion', 'million', 'thousand']
  const grouping = new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US')
  const parts: string[] = []
  const ty = Math.floor(n / 1e9)
  if (ty) parts.push(`${grouping.format(ty)} ${words[0]}`)
  const tr = Math.floor(n / 1e6) % 1000
  if (tr) parts.push(`${tr} ${words[1]}`)
  const ng = Math.floor(n / 1e3) % 1000
  if (ng) parts.push(`${ng} ${words[2]}`)
  const d = n % 1000
  if (d) parts.push(String(d))
  return parts.join(' ')
}
