import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'

/**
 * A DISTRICT TYPED INTO THE SEARCH BOX BECOMES THE DISTRICT FILTER.
 *
 * ⛔ WHY THIS EXISTS — owner, 2026-09-24: "still cant search by district". The feed matched `q` as
 * folded ≥2-character tokens ANDed against `searchText`, so the digit in "Quận 7" was DROPPED and
 * the query became `quan`, which every Hồ Chí Minh rental carries. Measured on production: "Quận 1",
 * "Quận 2", "Quận 7", "quan 7" all returned the same 20,047 rentals in the same order; "District 7"
 * returned 229 rows of which ZERO were in District 7 (it matched the word "district"); "Q7" returned
 * 0. The district data itself was complete — every live rental carries `Listing.district` — so the
 * fix is to recognise the phrase and apply the scope `?district=<slug>` already applies.
 *
 * ⚠️ PURE AND CLIENT-SAFE ON PURPOSE. The server calls it to build the filter (feed, totals,
 * histogram, facet counts, map buildings, typeahead, saved-search alerts) and the explorer calls it
 * to draw the chip for the district it inferred. One function, the same inputs, the same answer —
 * that is what lets the chip say what the server did without a round trip.
 * ⛔ ITS ONLY INPUT IS THE TEXT, AND THAT IS A DECISION, NOT AN OMISSION. A version that also read
 * the browsed category (so a bare "Q7" meant Quận 7 inside Rentals) was reviewed five times and
 * every round found another surface that could not see the category the same way — the typeahead
 * (global, and on the home explorer its pathname is just `/`), the category rail's counts (each
 * chip IS another category), a header holding a stale copy. A rule that depends only on the words
 * gives one answer everywhere those words go: the feed, the counts, the dropdown, the chip, the
 * saved alert.
 *
 * WHAT COUNTS AS A DISTRICT PHRASE (accent- and case-insensitive):
 *  · numbered, 1–12 — "Quận 7", "quan 7", "quận7", "Q7", "Q.7", "Q 7", "District 7", "Dist 7", "D7".
 *    Quận 2 and Quận 9 resolve to `thu-duc`, because that is where `DISTRICTS` puts them (they were
 *    merged into TP Thủ Đức in 2021).
 *  · named — every lettered spelling in `DISTRICTS[].match` ("Bình Thạnh", "Gò Vấp", "Phú Mỹ Hưng"
 *    → d7 …), optionally with a "Quận/Q./Huyện/H./TP/Thành phố" prefix or a "district/city" suffix.
 *
 * ⚠️ WHAT IT REFUSES, AND WHY EACH ONE IS HERE:
 *  · A NUMBER THAT IS A QUANTITY. "7 triệu" has no district word at all; "q 7tr", "q7.5" and
 *    "quận 7 tuổi" do, but a unit or a decimal right after the number makes it a quantity.
 *  · CONFLICTING DIACRITICS. The typed accents must be a SUBSET of the real name's: "quan 7" and
 *    "quân 7" are Quận 7, but "quần 7" (trousers), "cản gió" (a windbreak — not Cần Giờ), "cử chỉ"
 *    (a gesture — not Củ Chi) and "học môn" are not. Unaccented input is allowed — it is how most
 *    people type on a phone.
 *  · SHORTHAND WITHOUT CONTEXT. "Q7" is also a Roborock and an Audi, "D4"/"D5" a DDR generation —
 *    measured 2026-09-24: 129 live electronics listings carry a Q/D-number token (Mainboard … D5,
 *    Torras Q3, Huawei Watch D2, Nikon D3, Edifier D12), so a bare "D5" on the home feed is far
 *    more often a product than District 5. The short forms ("Q7", "D7") and the four names that are
 *    also ordinary words without accents ("cu chi", "can gio", "hoc mon", "nha be") therefore count
 *    only when the rest of the query is about somewhere to live ("căn hộ Q7", "2pn q7", "phòng Q7")
 *    — and never beside a brand known to use the letter ("audi q7"). A bare "Q7" stays text, as it
 *    was. "Quận 7" and "District 7" need no context: nothing else is called that.
 *  · TWO DIFFERENT DISTRICTS. "quận 1 hoặc quận 3" is left as text — one filter cannot say "or".
 *  · THẢO ĐIỀN. It is in the `thu-duc` match list, but it is a WARD: as text it already finds its
 *    262 rentals precisely (255 of them in Quận 2), and scoping it to Thủ Đức would widen that to
 *    5,637. It stays text. (Phú Mỹ Hưng is the opposite case and IS inferred: 0 listings carry the
 *    phrase, so as text it finds nothing, and `d7` is labelled "Quận 7 (Phú Mỹ Hưng)".)
 *
 * The matched phrase is removed from the text, together with a preposition right before it
 * ("căn hộ ở quận 7") and the city's own name ("… quận 7, TP.HCM"), which the district already
 * implies and which Batdongsan's text does not carry — left in, "quận 7 hcm" would AND a token most
 * Quận 7 listings do not contain.
 */

export type DistrictInference = {
  /** The `DISTRICTS` slug — the value `?district=` takes. */
  slug: string
  /** The district words as the person typed them (the first occurrence). */
  phrase: string
  /** The query with the district phrase removed, in the person's own spelling; '' when nothing is left. */
  rest: string
}

/* ─── folding with an index map ──────────────────────────────────────────────────────────────── */

type Folded = { text: string; map: number[]; chars: string[] }

/**
 * Lowercase, accent-free text plus, for each folded UTF-16 unit, the index of the original character
 * it came from.
 * ⚠️ ONE MAP ENTRY PER UTF-16 UNIT, NOT PER CODE POINT: regex offsets into `text` count units, and an
 * emoji ("🏠 căn hộ quận 7") is two of them. Mapping per code point shifted every offset after it,
 * so the phrase and its accent check read the wrong characters (an external reviewer's catch).
 */
function foldWithMap(input: string): Folded {
  const chars = Array.from(input.normalize('NFC'))
  let text = ''
  const map: number[] = []
  chars.forEach((ch, i) => {
    const f = /\s/.test(ch)
      ? ' '
      : ch.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
    for (let k = 0; k < f.length; k++) { text += f[k]; map.push(i) }
  })
  return { text, map, chars }
}

/** A letter's base and its diacritics; `đ` is `d` plus a stroke. */
function decompose(ch: string): { base: string; marks: string[] } {
  const lower = ch.toLowerCase()
  if (lower === 'đ') return { base: 'd', marks: ['đ'] }
  const nfd = lower.normalize('NFD')
  return { base: nfd[0], marks: Array.from(nfd.slice(1)) }
}

/**
 * Could `typed` be a (possibly unaccented, possibly partly accented) spelling of `target`? Every
 * letter must share the base, and carry only diacritics the target's letter carries. Whitespace and
 * dots are ignored on both sides.
 */
function accentsCompatible(typed: string, target: string): boolean {
  const letters = (s: string) => Array.from(s.normalize('NFC')).filter((c) => !/[\s.]/.test(c))
  const a = letters(typed)
  const b = letters(target)
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = decompose(a[i])
    const y = decompose(b[i])
    if (x.base !== y.base) return false
    if (!x.marks.every((m) => y.marks.includes(m))) return false
  }
  return true
}

const hasAccent = (s: string) => Array.from(s).some((c) => decompose(c).marks.length > 0)

/* ─── the vocabulary, derived from DISTRICTS ─────────────────────────────────────────────────── */

const foldPlain = (s: string) => foldWithMap(s).text.replace(/\s+/g, ' ').trim()
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Numbered district → slug, read off the "Quận N" / "District N" spellings in `DISTRICTS`. */
const NUMBERED: Map<number, string> = (() => {
  const out = new Map<number, string>()
  for (const d of DISTRICTS) {
    for (const m of d.match ?? []) {
      const n = m.match(/^(?:Quận|District)\s+(\d{1,2})$/)
      if (n && !out.has(Number(n[1]))) out.set(Number(n[1]), d.slug)
    }
  }
  return out
})()

/** A ward, not a district — see "THẢO ĐIỀN" above. Folded. */
const NOT_A_DISTRICT = new Set(['thao dien'])
/** Names that are also ordinary words when typed without accents — need an accent, a prefix or context. */
const AMBIGUOUS_NAMES = new Set(['cu chi', 'can gio', 'hoc mon', 'nha be'])

/** Folded name → { slug, the most-accented spelling to check typed accents against }. */
const NAMED: Map<string, { slug: string; target: string }> = (() => {
  const out = new Map<string, { slug: string; target: string }>()
  for (const d of DISTRICTS) {
    for (const m of d.match ?? []) {
      if (/\d/.test(m)) continue
      const key = foldPlain(m)
      if (NOT_A_DISTRICT.has(key)) continue
      const prev = out.get(key)
      const accents = (s: string) => Array.from(s).filter((c) => decompose(c).marks.length > 0).length
      if (!prev || accents(m) > accents(prev.target)) out.set(key, { slug: d.slug, target: m })
    }
  }
  return out
})()

/* ─── patterns (run on the folded text; no lookbehind — Safari < 16.4 cannot parse it) ────────── */

/** A unit or decimal right after the number makes it a quantity, not a district. */
const QUANTITY_AFTER = /^(?:[.,]\d|\s*(?:trieu|tr|ty|ti|k|m2|km|cm|mm|m|kg|g|gb|tb|mb|inch|tuoi|x|%)(?![a-z0-9]))/

const NUMBERED_RE = /(^|[^a-z0-9])(quan|district|dist|q|d)(\s*\.\s*|\s*)(\d{1,2})(?![0-9a-z])/g

const NAMED_RE = new RegExp(
  '(^|[^a-z0-9])' +
    '(?:(quan|huyen|thanh\\s+pho|tp|q|h)(\\s*\\.\\s*|\\s+))?' +
    `(${[...NAMED.keys()].sort((a, b) => b.length - a.length).map((k) => escapeRe(k).replace(/ /g, '\\s+')).join('|')})` +
    '(\\s+(?:district|dist|city))?' +
    '(?![a-z0-9])',
  'g',
)

/** The city the curated districts belong to — redundant once a district is known. */
const CITY_RE = /(^|[^a-z0-9])((?:thanh\s+pho|tp)\s*\.?\s*)?(ho\s+chi\s+minh(?:\s+city)?|hcmc|hcm|sai\s*gon|tphcm)(?![a-z0-9])/g

/** A preposition that only made sense in front of the district ("ở quận 7", "in district 7"). */
const PREPOSITION_BEFORE = /(^|\s)(?:o|tai|in|at|near|around|gan|quanh|khu\s+vuc|khu)\s*[,.]?\s*$/

/**
 * Words that say the rest of the query is about somewhere to live — enough context for a shorthand
 * ("căn hộ Q7"). ⚠️ NOUNS FOR A PLACE, NOT THE VERB "RENT": "thuê xe Q7" is as likely an Audi Q7 as
 * a scooter in Quận 7, so "thuê"/"cho thuê"/"rent" are not evidence on their own (a reviewer's catch).
 * ⚠️ MATCHED WITH THEIR ACCENTS, like the district names: folded, "phóng" (as in "loa phóng thanh",
 * a loudspeaker) and "đặt" (to order) read as "phòng" and "đất", and would have turned "loa phóng
 * thanh D5" into District 5. Typed accents must be a subset of the word's own; unaccented input
 * still counts.
 */
const PLACE_WORDS = [
  'căn hộ', 'chung cư', 'phòng trọ', 'phòng', 'nhà', 'biệt thự', 'văn phòng', 'mặt bằng', 'ở ghép',
  'đất', 'studio', 'apartment', 'apt', 'condo', 'room', 'house', 'villa', 'office', 'shophouse',
  'penthouse', 'duplex', 'officetel', 'homestay', 'ktx', 'bedroom',
]
const PLACE_TARGET = new Map(PLACE_WORDS.map((w) => [foldPlain(w), w]))
const PLACE_RE = new RegExp(
  `(^|[^a-z0-9])(${[...PLACE_TARGET.keys()].sort((a, b) => b.length - a.length).map((k) => escapeRe(k).replace(/ /g, '\\s+')).join('|')})(?![a-z0-9])`,
  'g',
)
/** "2pn", "3 br", "1 bedroom" — a room count is a place however it is spelled. */
const ROOM_COUNT_RE = /(^|[^a-z0-9])\d+\s*(?:pn|br|bed|bedroom|wc)(?![a-z])/

function hasPlaceContext(rest: string): boolean {
  const f = foldWithMap(rest)
  if (ROOM_COUNT_RE.test(f.text)) return true
  for (const m of f.text.matchAll(PLACE_RE)) {
    const start = m.index! + m[1].length
    const target = PLACE_TARGET.get(m[2].replace(/\s+/g, ' '))
    if (target && accentsCompatible(originalOf(f, start, start + m[2].length), target)) return true
  }
  return false
}

/** Brands that name products with a letter-number the shorthand would otherwise read as a district. */
const SHORTHAND_BRANDS = /(^|[^a-z0-9])(?:audi|lg|nikon|roborock|dreame|torras|zhiyun|huawei|edifier)(?![a-z0-9])/


type Span = { start: number; end: number; slug: string | null; needsContext: boolean }

/** Folded span [s, e) → the original characters it covers. */
function originalOf(f: Folded, s: number, e: number): string {
  return f.chars.slice(f.map[s], f.map[e - 1] + 1).join('')
}

/**
 * The district a search query names, or null. See the module comment for exactly what counts.
 */
export function inferDistrictFromQuery(q: string | null | undefined): DistrictInference | null {
  const raw = (q ?? '').trim()
  if (!raw || raw.length > 200) return null
  const f = foldWithMap(raw)
  const spans: Span[] = []

  for (const m of f.text.matchAll(NUMBERED_RE)) {
    const [, lead, prefix, sep, digits] = m
    const start = m.index! + lead.length
    const end = m.index! + m[0].length
    if (QUANTITY_AFTER.test(f.text.slice(end))) continue
    const slug = NUMBERED.get(Number(digits))
    if (!slug) continue
    // "D7" is glued or dotted, never "d 7": a spaced lone d is too often the đồng sign or an initial.
    if (prefix === 'd' && /\s/.test(sep)) continue
    const typedPrefix = originalOf(f, start, start + prefix.length)
    if (prefix === 'quan') {
      if (!accentsCompatible(typedPrefix, 'quận')) continue
    } else if (hasAccent(typedPrefix)) continue // "đ7" is not D7
    spans.push({ start, end, slug, needsContext: prefix === 'q' || prefix === 'd' })
  }

  for (const m of f.text.matchAll(NAMED_RE)) {
    const [, lead, prefix, sep, name, suffix] = m
    const start = m.index! + lead.length
    const end = m.index! + m[0].length
    const key = name.replace(/\s+/g, ' ')
    const entry = NAMED.get(key)
    if (!entry) continue
    const nameStart = start + (prefix ? prefix.length + sep.length : 0)
    const typedName = originalOf(f, nameStart, nameStart + name.length)
    if (!accentsCompatible(typedName, entry.target)) continue
    if (prefix) {
      const typedPrefix = originalOf(f, start, start + prefix.length)
      const target = { quan: 'quận', huyen: 'huyện', tp: 'tp', q: 'q', h: 'h' }[prefix] ?? 'thành phố'
      if (!accentsCompatible(typedPrefix, target)) continue
      if (prefix === 'h' && !sep.includes('.')) continue // "H. Nhà Bè", never a bare h
    }
    // A "Quận/Huyện" prefix or a "district" suffix, or the name's own accents, says it is the place.
    const confident = !!prefix || !!suffix || hasAccent(typedName) || !AMBIGUOUS_NAMES.has(key)
    spans.push({ start, end, slug: entry.slug, needsContext: !confident })
  }

  if (spans.length === 0) return null
  const slugs = new Set(spans.map((s) => s.slug))
  if (slugs.size !== 1) return null
  const slug = spans[0].slug!

  // City names go too — only once a district is known (see the module comment).
  for (const m of f.text.matchAll(CITY_RE)) {
    const start = m.index! + m[1].length
    spans.push({ start, end: m.index! + m[0].length, slug: null, needsContext: false })
  }

  // Remove the spans (plus a preposition right before a district) from the ORIGINAL text.
  spans.sort((a, b) => a.start - b.start)
  const drop = new Array<boolean>(f.chars.length).fill(false)
  for (const s of spans) {
    let from = s.start
    if (s.slug) {
      const before = f.text.slice(0, from).match(PREPOSITION_BEFORE)
      if (before) from = before.index! + before[1].length
    }
    for (let i = f.map[from] ?? f.chars.length; i <= f.map[s.end - 1]; i++) drop[i] = true
  }
  const rest = tidy(f.chars.filter((_, i) => !drop[i]).join(''))

  // Shorthand and ambiguous names need the rest of the query to be about a place to live.
  if (spans.some((s) => s.slug && s.needsContext) && spans.every((s) => !s.slug || s.needsContext)) {
    if (!hasPlaceContext(rest)) return null
    if (SHORTHAND_BRANDS.test(foldPlain(rest))) return null
  }

  const first = spans.find((s) => s.slug)!
  return { slug, phrase: originalOf(f, first.start, first.end).trim(), rest }
}

/** Collapse the whitespace and punctuation a removed phrase leaves behind. */
function tidy(s: string): string {
  return s
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;:])/g, '$1')
    .replace(/([,;:])(\s*[,;:])+/g, '$1')
    .replace(/^[\s,;:·|/\\\-–—.]+/, '')
    .replace(/[\s,;:·|/\\\-–—(]+$/, '')
    .trim()
}

export type QueryChip =
  | { kind: 'text'; text: string; clearTo: string }
  | { kind: 'district'; slug: string; clearTo: string }

/**
 * The explorer's applied-filter chips for the typed query: the words, and — when the server will
 * read one out of them — the district, each clearing ONLY itself. Clearing the district leaves the
 * words (`clearTo: rest`); clearing the words leaves the district phrase in the box, which re-infers
 * the same district. `districtSent` is whether the request carries its own `district` param, in
 * which case the server infers nothing and neither does this. `lang` picks which of the district's
 * own names goes back into the box when the typed phrase could not stand alone.
 */
export function queryChips(typed: string, districtSent: boolean, lang = 'vi'): QueryChip[] {
  const q = typed.trim()
  if (!q) return []
  const inferred = districtSent ? null : inferDistrictFromQuery(q)
  if (!inferred) return [{ kind: 'text', text: q, clearTo: '' }]
  /**
   * ⚠️ CLEARING THE WORDS MUST KEEP THE DISTRICT EVEN WHEN THE DISTRICT NEEDED THEM. "căn hộ Q7" is
   * Quận 7 only BECAUSE of "căn hộ"; leaving "Q7" alone in the box would read as a product search
   * and silently widen to the whole catalogue. So when the typed phrase would not
   * stand on its own, the box gets the district's own name ("Quận 7 (Phú Mỹ Hưng)"), which always
   * does, in either language — pinned for every entry in district-query.test.ts.
   */
  const alone = inferDistrictFromQuery(inferred.phrase)?.slug === inferred.slug
  const d = DISTRICTS.find((x) => x.slug === inferred.slug)!
  const keep = alone ? inferred.phrase : lang === 'vi' ? d.name : d.nameEn
  return [
    ...(inferred.rest ? [{ kind: 'text' as const, text: inferred.rest, clearTo: keep }] : []),
    { kind: 'district' as const, slug: inferred.slug, clearTo: inferred.rest },
  ]
}
