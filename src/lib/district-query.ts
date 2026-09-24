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
 * histogram, facet counts, map buildings, typeahead, saved-search alerts); the explorer calls it
 * only to split a chip's words from its district. WHICH district the chip names is the server's
 * answer (`inferredDistrict` on the response), never this function's: the feed may decline a
 * reading — an explicit `?district=` wins, and a reading that finds nothing where the plain words
 * find something is dropped (resolveFeedFilters in feed-query.ts) — so the browser cannot know it.
 * ⛔ ITS ONLY INPUT IS THE TEXT, AND THAT IS A DECISION, NOT AN OMISSION. A version that also read
 * the browsed category (so a bare "Q7" meant Quận 7 inside Rentals) was reviewed five times and
 * every round found another surface that could not see the category the same way — the typeahead
 * (global, and on the home explorer its pathname is just `/`), the category rail's counts (each
 * chip IS another category), a header holding a stale copy. A rule that depends only on the words
 * gives one answer everywhere those words go: the feed, the counts, the dropdown, the chip, the
 * saved alert.
 *
 * WHAT COUNTS AS A DISTRICT PHRASE (accent- and case-insensitive):
 *  · numbered, 1–12 — "Quận 7", "quan 7", "quận7", "Q.7", "Q. 7", "District 7", "Dist 7", and —
 *    beside a place word only — "Q7", "Q 7", "D7".
 *    Quận 2 and Quận 9 resolve to their own `d2`/`d9` entries (abfca169) — the narrowest entry that
 *    spells them — not to the `thu-duc` umbrella that also still matches them.
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
 *    was. "Quận 7", "District 7" and the address form "Q.7" / "Q. 7" need no context: nothing else
 *    is called that. A place word inside a compound that is not a place ("sạc dự phòng", "lau nhà",
 *    "nâu đất", "phòng khách") is not context (NOT_PLACE_COMPOUNDS).
 *  · A NAME THAT IS A PERSON'S. A bare district name right after a Vietnamese surname ("Nguyễn Tân
 *    Bình", an author) is a name, not the district.
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

/**
 * `inner` narrows `outer`: every spelling of `inner` is also one of `outer`'s (d2 inside thu-duc).
 * ⚠️ THE ONE DEFINITION OF "NARROWER" IN THIS FILE — NUMBERED and oneDistrict both read it, and
 * district-query.test.ts pins the invariant it relies on: two entries that share a spelling are
 * nested, one's spellings a subset of the other's.
 */
export function narrows(inner: string, outer: string): boolean {
  const i = DISTRICTS.find((d) => d.slug === inner)?.match ?? []
  const o = DISTRICTS.find((d) => d.slug === outer)?.match ?? []
  return i.length > 0 && i.every((m) => o.includes(m))
}

/**
 * The one district several phrases name, or null. A narrower and its umbrella named together are
 * one place, and the narrower answers: "Quận 2 (Thủ Đức)" is d2's own name, "Quận 2, Thủ Đức" an
 * address. Anything else ("quận 1 hoặc quận 3", "quận 1 thủ đức") is two places, which one filter
 * cannot say.
 * ⚠️ NO "OR" RULE, ON PURPOSE: one was tried for "Quận 2 hoặc Thủ Đức" and every reviewer found a
 * new way it misfired ("hay" is also "good"; the connector sat anywhere in the query; it stayed in
 * the text). That query narrows to Quận 2 — rare, and inside what was asked.
 */
function innermost(slugs: string[]): string | null {
  const uniq = [...new Set(slugs)]
  if (uniq.length === 1) return uniq[0]
  return uniq.find((s) => uniq.every((o) => o === s || narrows(s, o))) ?? null
}

/**
 * Numbered district → slug, read off the "Quận N" / "District N" spellings in `DISTRICTS`.
 * ⚠️ THE NARROWEST ENTRY WINS. Since abfca169 "Quận 2" and "Quận 9" are spelled by two entries — the
 * `thu-duc` umbrella (which keeps matching the old names: most of its inventory still says them) and
 * their own `d2`/`d9` narrowers. A person who types "Quận 2" asked for Quận 2 — the same scope the
 * picker's "Quận 2 (Thủ Đức)" applies — so the narrower answers (3,741 rows, where the umbrella's
 * 5,896 also hold Quận 9 and every "TP. Thủ Đức" row).
 */
const NUMBERED: Map<number, string> = (() => {
  const spellers = new Map<number, string[]>()
  for (const d of DISTRICTS) {
    for (const m of d.match ?? []) {
      const n = m.match(/^(?:Quận|District)\s+(\d{1,2})$/)
      if (n) spellers.set(Number(n[1]), [...(spellers.get(Number(n[1])) ?? []), d.slug])
    }
  }
  return new Map([...spellers].map(([k, slugs]) => [k, innermost(slugs) ?? slugs[0]]))
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

/**
 * A preposition that only made sense in front of the district ("ở quận 7", "in district 7").
 * ⚠️ ACCENT-CHECKED against the word it stands for: folded, "ô" (as in "cờ ô quan", a board game)
 * reads as "ở" and was stripped with the district (verifier). Typed bare ("o quan 7") still counts.
 */
const PREPOSITION_BEFORE = /(^|\s)(o|tai|in|at|near|around|gan|quanh|khu\s+vuc|khu)\s*[,.]?\s*$/
const PREPOSITION_TARGET: Record<string, string> = { o: 'ở', tai: 'tại', gan: 'gần', 'khu vuc': 'khu vực' }

/**
 * Vietnamese surnames. A bare district name right after one is a person's or a street's name, not the
 * district: "Nguyễn Tân Bình" is an author (verifier: 122 results → 14 once it was read as Tân Bình).
 * ⚠️ Most of these are also ordinary words without their accents ("dương"/"đường", "ngô"/"ngõ",
 * "phan"/"phần"), so only the five that are nothing else count when typed bare; the rest must carry
 * their own accents. "Hồ" is left out entirely: bare it is the "hộ" of "căn hộ Bình Thạnh".
 */
const SURNAMES = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Ngô', 'Dương', 'Lý']
const SURNAME_TARGET = new Map(SURNAMES.map((w) => [foldPlain(w), w]))
const SURNAME_BARE_OK = new Set(['nguyen', 'pham', 'hoang', 'huynh', 'bui'])
const WORD_BEFORE = /(^|[^a-z0-9])([a-z]+)\s+$/

function precededBySurname(f: Folded, start: number): boolean {
  const m = f.text.slice(0, start).match(WORD_BEFORE)
  if (!m) return false
  const target = SURNAME_TARGET.get(m[2])
  if (!target) return false
  const wordStart = m.index! + m[1].length
  const typed = originalOf(f, wordStart, wordStart + m[2].length)
  if (!accentsCompatible(typed, target)) return false
  return hasAccent(typed) || SURNAME_BARE_OK.has(m[2])
}

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
/** "2pn", "3 br", "1 bedroom", "2 phòng ngủ" — a room COUNT is a place however it is spelled. */
const ROOM_COUNT_RE = /(^|[^a-z0-9])\d+\s*(?:pn|br|bed|bedroom|wc|phong\s+ngu)(?![a-z])/

/**
 * ⛔ COMPOUNDS IN WHICH A PLACE WORD IS NOT A PLACE. "phòng", "nhà" and "đất" are one syllable, and
 * Vietnamese builds ordinary product words out of them: a power bank is "sạc dự phòng", a mop "cây lau
 * nhà", a colour "nâu đất", a living-room TV "tivi phòng khách". Read as housing context they turned
 * product searches into district scopes that match nothing (verifier, 2026-09-24): "pin sạc dự phòng
 * Q3" 1 → 0, "lau nhà Q2" 2 → 0, "dây đồng hồ nâu đất D1" 1 → 0, "tivi samsung Q7 phòng khách" 1 → 0.
 * A place word inside one of these compounds is masked before the scan. Accent-checked like every
 * other word here, so "phong khach" typed bare is masked too — a housing search that says "phòng
 * khách" almost always also says "căn hộ" or a room count, which still count.
 * ⚠️ NOT EXHAUSTIVE AND NOT MEANT TO BE: the feed's safety net (resolveFeedFilters in
 * feed-query.ts) serves the plain-text results whenever the district reading finds nothing and the
 * plain words find something, so a compound missing from this list costs a precise reading, not
 * the product search.
 */
const NOT_PLACE_COMPOUNDS = [
  'dự phòng', 'đề phòng', 'phòng khách', 'phòng ngủ', 'phòng tắm', 'phòng bếp', 'phòng ăn',
  'phòng cháy', 'phòng chống', 'phòng ngừa', 'phòng vệ', 'phòng thủ', 'phòng hộ', 'phòng gym', 'phòng net',
  'lau nhà', 'dọn nhà', 'nhà bếp', 'nhà tắm', 'nhà vệ sinh', 'nhà cửa', 'nhà sản xuất', 'nhà phân phối',
  'nhà xe', 'nhà sách', 'nhà thuốc', 'nhà cung cấp', 'nhà búp bê', 'nhà đồ chơi',
  'nâu đất', 'đất sét', 'đất nung', 'nồi đất', 'đất trồng', 'gốm đất',
  'văn phòng phẩm', 'ghế văn phòng', 'bàn văn phòng', 'office chair', 'office desk', 'room spray',
]
const NOT_PLACE_TARGET = new Map(NOT_PLACE_COMPOUNDS.map((w) => [foldPlain(w), w]))
const NOT_PLACE_RE = new RegExp(
  `(^|[^a-z0-9])(${[...NOT_PLACE_TARGET.keys()].sort((a, b) => b.length - a.length).map((k) => escapeRe(k).replace(/ /g, '\\s+')).join('|')})(?![a-z0-9])`,
  'g',
)

function hasPlaceContext(rest: string): boolean {
  const f = foldWithMap(rest)
  if (ROOM_COUNT_RE.test(f.text)) return true
  // Mask the compounds first (same length, so every offset below still maps to the original).
  let text = f.text
  for (const m of f.text.matchAll(NOT_PLACE_RE)) {
    const start = m.index! + m[1].length
    const target = NOT_PLACE_TARGET.get(m[2].replace(/\s+/g, ' '))
    if (!target || !accentsCompatible(originalOf(f, start, start + m[2].length), target)) continue
    text = text.slice(0, start) + ' '.repeat(m[2].length) + text.slice(start + m[2].length)
  }
  for (const m of text.matchAll(PLACE_RE)) {
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
    /**
     * ⚠️ "Q." IS THE ADDRESS ABBREVIATION, NOT A MODEL CODE. "Q.7", "Q. 7", "q.2" are how a
     * Vietnamese address writes Quận — measured 2026-09-24: 0 live listings use a Q-dot-number as a
     * product name, while "Q. 7" used to reach the text filter as the token `q.` and returned 5,611
     * rentals in Bình Thạnh, Tân Bình and Phú Nhuận ("Q. Bình Thạnh" …) and none in Quận 7. So a dot
     * after the q is enough on its own. The bare shorthand ("Q7", "D7") still needs a place word:
     * 129 live electronics listings carry such a code (Roborock Q7, Huawei Watch D2 …).
     */
    const dotted = prefix === 'q' && sep.includes('.')
    spans.push({ start, end, slug, needsContext: (prefix === 'q' && !dotted) || prefix === 'd' })
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
    if (!prefix && precededBySurname(f, start)) continue
    // A "Quận/Huyện" prefix or a "district" suffix, or the name's own accents, says it is the place.
    const confident = !!prefix || !!suffix || hasAccent(typedName) || !AMBIGUOUS_NAMES.has(key)
    spans.push({ start, end, slug: entry.slug, needsContext: !confident })
  }

  if (spans.length === 0) return null
  const slug = innermost(spans.map((s) => s.slug!))
  if (!slug) return null

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
      if (before) {
        const pStart = before.index! + before[1].length
        const word = before[2].replace(/\s+/g, ' ')
        const typed = originalOf(f, pStart, pStart + before[2].length)
        if (accentsCompatible(typed, PREPOSITION_TARGET[word] ?? word)) from = pStart
      }
    }
    for (let i = f.map[from] ?? f.chars.length; i <= f.map[s.end - 1]; i++) drop[i] = true
  }
  const rest = tidy(f.chars.filter((_, i) => !drop[i]).join(''))

  // Shorthand and ambiguous names need the rest of the query to be about a place to live.
  if (spans.some((s) => s.slug && s.needsContext) && spans.every((s) => !s.slug || s.needsContext)) {
    if (!hasPlaceContext(rest)) return null
    if (SHORTHAND_BRANDS.test(foldPlain(rest))) return null
  }

  // The phrase of the district that ANSWERED ("thủ đức quận 9" → "quận 9"), not merely the first one.
  const first = spans.find((s) => s.slug === slug)!
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

/**
 * WHETHER THE QUERY READ WITHOUT ITS DISTRICT IS STILL A SEARCH — i.e. whether the feed may fall back
 * to it when the district reading finds nothing (resolveFeedFilters in feed-query.ts).
 * ⛔ NOT WHEN NOTHING BUT A NUMBERED DISTRICT WAS TYPED. "Quận 7" as plain text is the lone token
 * `quan` — the bug this module exists to fix (it matched every HCMC rental, and in Fashion it matches
 * "quần", trousers). So a bare numbered district in a category with no listings there stays an honest
 * zero.
 * ⛔ NOR WHEN THE OTHER WORDS ARE ABOUT SOMEWHERE TO LIVE ("penthouse quận 7", "phòng trọ Phú
 * Nhuận"). Then the district reading is the right one even when it finds nothing — the plain words
 * would answer with penthouses in every other district, since every HCMC rental carries "quan" — and
 * the feed skips the existence probe altogether (measured 50–80 ms on production, 2026-09-24).
 * Words that are not about a place ("pin sạc dự phòng Q3", "Hồi ức Phú Nhuận") or a district NAME
 * alone ("Phú Nhuận", the title of a book) are a real text search, and a product search must never
 * be the worse for the district reading.
 */
/**
 * Whether the words are a search for a PLACE — nothing but the district ("Quận 7", "Bình Thạnh"), or
 * the district beside words about somewhere to live ("căn hộ Q7"). The other shape — a district
 * beside product words ("Hồi ức Phú Nhuận", a book) — is the one the feed may yet serve as plain
 * words, so the explorer does not let it replace a province, ward or radius the reader picked.
 */
export function isPlaceSearch(inferred: DistrictInference): boolean {
  return !inferred.rest || hasPlaceContext(inferred.rest)
}

/**
 * Whether an explicit `?district=` strips this phrase from the words: only a NUMBERED phrase, whose
 * text is the lone token the district reading exists to replace ("Quận 7" → `quan`, "District 7" →
 * `district`), which matches every HCMC row (verifier: `district=d1&q=Quận 7` answered all of Quận 1
 * "as if the words had been read"). A district NAME stays text under a pick — "Phú Nhuận" folds to
 * two specific tokens, and it may be a product's name ("Hồi ức Phú Nhuận", a book): cutting it lost
 * the query outright (codex, opus). One rule for the feed, the alerts and the explorer's box.
 */
export function strippedUnderExplicitDistrict(inferred: DistrictInference): boolean {
  return /\d/.test(inferred.phrase)
}

export function hasPlainTextFallback(inferred: DistrictInference): boolean {
  if (inferred.rest && hasPlaceContext(inferred.rest)) return false
  return inferred.rest.length > 0 || !/\d/.test(inferred.phrase)
}

export type QueryChip =
  | { kind: 'text'; text: string; clearTo: string }
  | { kind: 'district'; slug: string; clearTo: string }

/**
 * The explorer's applied-filter chips for the typed query: the words, and — when the SERVER read a
 * district out of them — the district, each clearing ONLY itself. Clearing the district leaves the
 * words (`clearTo: rest`); clearing the words leaves the district phrase in the box, which re-infers
 * the same district. `lang` picks which of the district's own names goes back into the box when the
 * typed phrase could not stand alone.
 *
 * ⛔ `serverInferred` IS THE RESPONSE'S `inferredDistrict`, NOT A RE-RUN OF THE PARSER HERE. The feed
 * can decline a reading the parser makes — an explicit `?district=` wins, and when the district scope
 * finds nothing while the plain words find something it serves the plain words (resolveFeedFilters) —
 * and a chip recomputed in the browser would then name a district the results are not in. The parser
 * runs here only to split the words from the phrase so each chip can clear itself; `null` (no district
 * applied, or no answer yet for this text) is one text chip.
 */
export function queryChips(typed: string, serverInferred: string | null, lang = 'vi'): QueryChip[] {
  const q = typed.trim()
  if (!q) return []
  if (!serverInferred) return [{ kind: 'text', text: q, clearTo: '' }]
  const inferred = inferDistrictFromQuery(q)
  if (!inferred || inferred.slug !== serverInferred) {
    // The server read a district this copy of the parser does not (a deploy between the two): name
    // the district that IS applied, and let clearing it clear the words that produced it.
    return [{ kind: 'text', text: q, clearTo: '' }, { kind: 'district', slug: serverInferred, clearTo: '' }]
  }
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
