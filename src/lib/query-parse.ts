import { fold } from './fold'

/**
 * STRUCTURE OUT OF A TYPED QUERY — the input side of zero-results recovery.
 *
 * A buyer types "honda vision 2024 dưới 8 triệu" into one box. The feed can only act on that if the
 * year and the price ceiling stop being letters and become FILTERS, and the buyer can only recover
 * from a dead end if each one is a chip they can take back off. So this returns both halves: the
 * facets it lifted out, and the residual free text ("honda vision") that is still just words.
 *
 * ⚠️ A FALSE PARSE IS WORSE THAN NO PARSE, and that asymmetry decides every rule below. A missed
 * facet costs a filter the buyer can still set by hand. A wrong one silently deletes part of the
 * MODEL NAME from the query and then hides the listings that do exist — the exact failure the
 * zero-results surface is there to fix. Every rule here is written to fail toward "leave it in the
 * text". Where a signal is genuinely two-sided ("8m" = 8 million or 8 metres) the tie is broken by
 * refusing to guess, not by picking the likelier reading.
 *
 * The four guards that do most of that work, because they are not obvious from the code:
 *
 *   1. A NUMBER IS NEVER A PRICE WITHOUT A MONEY UNIT (or an explicit dưới/trên in front of it).
 *      This is what keeps "iphone 13" a phone, "honda wave 110" a bike and "sony 55" a TV.
 *   2. A PRICE FLOOR of 50.000 ₫. Nothing on this marketplace is listed under it, and it is what
 *      makes "tivi 4k" a resolution (4.000 ₫ → refused) rather than a budget. Same guard turns
 *      "bmw 320d" and "canon 4000d" back into model numbers.
 *   3. SINGLE-LETTER UNITS (`m`, `b`) ONLY COUNT AFTER AN EXPLICIT COMPARATOR. "under 8m" is a
 *      budget; a bare "80m" is floor area, and property is a live category here.
 *   4. THE YEAR WINDOW is 1990 … currentYear + 1, which excludes GPU and camera model numbers BY
 *      CONSTRUCTION rather than by a denylist: rtx 4090, rtx 2080 and gtx 1080 all fall outside it.
 *
 * DELIBERATELY NOT PARSED — each of these is a decision, not an omission, and each is cheaper to
 * leave in the free text than to get wrong:
 *
 *   · RANGES written as one phrase: "5-8 triệu", "từ 5 đến 8 triệu". Two comparators in one query
 *     ("trên 5 triệu dưới 8 triệu") DO give a range, because each half states its own bound. A
 *     hyphen has too many other jobs (SH-125, RTX-4090, Air-Max) to be a range operator here.
 *     ⚠️ What "từ 5 đến 8 triệu" actually returns today, since "not parsed" undersells it: the "5"
 *     is refused (it follows "từ"), the tail becomes an INFERRED ceiling of 8 triệu, and the
 *     residual is "từ 5 đến". The ceiling is directionally right — 8 triệu really is the top of the
 *     stated range — so it is left alone; the untidy residual is the price of not adding "đến" to
 *     the blocker list, which would cost every "áo đen 500k" instead (fold collapses đến and đen).
 *   · "khoảng" / "tầm" / "about" / "~" — an approximate price has no bound to set. Silently turning
 *     it into a ceiling would be the inference this file otherwise refuses, and it would hide the
 *     listing just above the number, which is the one the buyer most likely wanted.
 *   · DISTRICT, CONDITION, COLOUR, and every other facet the explorer already has a control for.
 *     They need the catalogue, and this module is pure by design.
 *   · A BARE NUMBER as a price ("honda vision 8000000" with no unit and no comparator). Guard 1.
 *   · A SECOND facet of a kind already filled — the first wins and the rest stay as text.
 *   · STRICT vs INCLUSIVE comparison. "<8tr" and "≤8tr" both yield `priceMax: 8_000_000`, inclusive.
 *     Nobody typing a budget on a marketplace means to exclude the listing that costs exactly it,
 *     and an inclusivity flag would put that distinction in every consumer of this type forever.
 *     One consequence, stated so it is not a surprise: "trên 8tr dưới 8tr" is an EXACT-price query
 *     (min = max = 8.000.000), not a contradiction, so the contradiction rule leaves it alone.
 *
 * ⚠️ TWO KNOWN LIVE RISKS, STATED RATHER THAN HIDDEN. Both are irreducible ambiguities, not bugs
 * waiting for a cleverer regex, and both are survivable ONLY because the facet is rendered as a
 * removable chip. If a consumer ever applies these silently instead, revisit them first.
 *
 *   · After a comparator, "m" IS million — so "nhà dưới 100m" reads as 100.000.000 ₫ even though the
 *     buyer probably typed "100m2" and dropped the "2". Correctly-spelled "100m2" is refused
 *     (measured), and the English "under 8m" form is a stated requirement, so this is the residual
 *     cost of guard 3.
 *   · A bare dotted number ending in a round thousand is read as money, and a 9-digit one is
 *     genuinely BOTH readings: "912.345.000" is a plausible Vietnamese phone number written 3-3-3
 *     AND a plausible 912 triệu property price. Nothing in the string distinguishes them. The money
 *     reading wins because this parses a SEARCH BOX, where buyers type products and budgets rather
 *     than phone numbers. Non-round identifiers ("912.345.678", "192.168.001") are refused outright.
 *
 * ⚠️ DIACRITICS ARE FOLDED FOR MATCHING ONLY, VIA `fold()` — never re-implement the normaliser
 * (src/lib/fold.ts is the one the whole search path already uses, so "dưới" and "duoi" cannot drift
 * apart between this file and the query it produces). Measured: fold('dưới') === 'duoi',
 * fold('triệu') === 'trieu', fold('đời') === 'doi', fold('tỷ') === 'ty' — the horn on ơ/ư decomposes
 * to a combining mark inside fold's range, so the accented and unaccented spellings really do meet.
 * The RESIDUAL text is rebuilt from the ORIGINAL words, so casing and accents survive untouched:
 * "Honda Vision 2024 dưới 8 triệu" leaves "Honda Vision", not "honda vision".
 *
 * Pure: no DB, no network, no module state. The clock is injectable so the year window is testable.
 */

/** Facet kinds we are willing to lift out of free text. Deliberately three — see the header. */
export type QueryFacetKind = 'year' | 'priceMin' | 'priceMax'

export type QueryFacet = {
  kind: QueryFacetKind
  /** `year` → 2024. `priceMin`/`priceMax` → whole VND (8_000_000), never a shorthand. */
  value: number
  /**
   * The run of ORIGINAL words this came from ("dưới 8 triệu") — original casing, original accents,
   * so the chip echoes what the buyer typed rather than a normalised restatement of it.
   *
   * ⚠️ FOR DISPLAY, NOT FOR SUBTRACTION. It is the original WORDS rejoined with single spaces, which
   * is not always byte-identical to the input: runs of whitespace collapse, and a glued operator is
   * re-spaced (typed ">=20tr" reports ">= 20tr"). A caller that removes a chip by string-replacing
   * `source` out of the raw query will sometimes miss and leave the filter stuck.
   *
   * ⚠️ AND DO NOT FEED `text` BACK INTO parseQuery TO REMOVE A CHIP — PARSE ONCE, THEN TREAT THE
   * RESULT AS STATE. An earlier version of this note said "re-run with `text` plus whichever facets
   * survive", which reads as re-parsing and is unsound, because `text` can still contain words that
   * parse. Two of this file's own pinned cases show it: "8tr dưới 5tr" yields text "8tr" and one
   * ceiling of 5 triệu, so re-parsing after the buyer removes that chip hands back a ceiling of 8
   * triệu — the chip cannot be removed, it only changes value. Worse, "xe trên 20 triệu 8tr" yields
   * text "xe 8tr" with a surviving explicit floor of 20 triệu; re-parsing produces a ceiling of 8
   * triệu against that floor — the empty set the in-call contradiction rule exists to refuse.
   * parseQuery is pure and stateless, so it cannot know a facet survived from a previous call. The
   * search runs on `text` plus the facets STILL IN THE LIST; removal drops one from the list and
   * changes nothing else.
   */
  source: string
  /**
   * true when the buyer NAMED the facet ("dưới", "trên", "đời", "under"); false when we inferred it
   * from shape alone — a bare "8tr", a bare "2024". An inferred facet is a soft reading and the UI
   * may want to say so; it is only safe to infer at all because the chip is removable.
   */
  explicit: boolean
}

export type ParsedQuery = {
  /**
   * What is left once the facets are lifted out — original casing and diacritics kept. It is the
   * free-text half of the query and goes to the search as-is.
   * ⚠️ It is NOT a query to parse again; see the note on `source` for the two pinned cases where
   * re-parsing it manufactures a facet the buyer just removed.
   */
  text: string
  /**
   * Convenience mirrors of `facets`, for callers that just want to build a where-clause.
   * INVARIANT: when both price bounds are present, `priceMin <= priceMax`. A query that states the
   * reverse yields NEITHER bound (see the contradiction rule at the end of parseQuery), so a caller
   * never has to defend against a where-clause that cannot match anything.
   */
  year?: number
  priceMin?: number
  priceMax?: number
  /** In the order they appeared in the query. At most one per kind — the FIRST wins. */
  facets: QueryFacet[]
}

/**
 * Matches SavedSearchParams' own 120-char cap with headroom; a query is a phrase, not a document.
 * ⚠️ The cut is by CHARACTER, so a query longer than this can lose the second half of a phrase — a
 * "…2024 triệu" straddling the boundary is read as the year 2024 alone. Left as is deliberately:
 * every alternative (cut on a word boundary, refuse the input) is a different arbitrary answer to
 * the same arbitrary input, and 200 characters is roughly ten times the longest real search.
 */
const MAX_INPUT = 200

/**
 * ⚠️ GUARD 2 — the price floor, and it is doing real work, not defensive padding. "4k"/"8k" are how
 * every TV and monitor listing spells its resolution; read as money they are 4.000 ₫ and 8.000 ₫.
 * Nothing on this marketplace is listed below 50.000 ₫, so the floor separates the two readings
 * without a single hardcoded product word. It also disarms the `d`/`đ` suffix: "bmw 320d" → 320 ₫,
 * "canon 4000d" → 4.000 ₫, both refused, while a real "8000000đ" sails through.
 */
const MIN_PRICE_VND = 50_000
/** Ceiling: above 100 tỷ the reading is a typo or a serial number, not a budget. */
const MAX_PRICE_VND = 100_000_000_000

/** ⚠️ GUARD 4 — see the header. The upper bound is the clock's year + 1 (next model year). */
const MIN_YEAR = 1990

/**
 * ⚠️ WHAT IS DELIBERATELY *NOT* A COMPARATOR, because each one was tried and cost more than it paid:
 *
 *   · "max"  — "iPhone 13 Pro Max 1tr" would parse "max 1tr" as a ceiling and hand back the residual
 *              "iphone 13 pro", i.e. it eats the model name at the exact moment the buyer typed it.
 *   · "min"  — same shape, no upside.
 *   · "từ" / "from" — "tủ" folds to "tu" and is one of the commonest nouns in the catalogue
 *              (tủ lạnh, tủ quần áo). As a comparator it would delete the noun.
 *
 * The survivors all have the property that they are not also product vocabulary.
 *
 * ⚠️ AND "từ" COSTS A LITTLE MORE THAN JUST NOT BEING A COMPARATOR — say it plainly, because the
 * first draft of this note did not and a reviewer was right to call it. `tu` is also in FLOOR_HINTS
 * below, which blocks the ceiling inference on whatever follows it; since fold cannot tell tủ from
 * từ, "tủ 8 triệu" now returns NO price (measured — the residual is the whole phrase). That is the
 * safe direction of the trade: a missed facet, not an inverted one, and it buys immunity from
 * "tủ lạnh từ 5 triệu" being answered with a 5-triệu CEILING. "tủ lạnh 5 triệu" is unaffected,
 * because the noun is two words and the price does not sit against the `tu` token.
 */
const CEILING_WORDS = new Set(['duoi', 'under', 'below', '<', '<=', '≤'])
const FLOOR_WORDS = new Set(['tren', 'over', 'above', '>', '>=', '≥'])

/**
 * ⚠️ WORDS THAT MEAN "AT LEAST" BUT ARE NOT SAFE TO PARSE — AND MUST THEREFORE BLOCK THE CEILING
 * INFERENCE, WHICH IS A STRONGER REQUIREMENT THAN SIMPLY BEING LEFT OUT.
 *
 * Excluding "từ"/"from" from FLOOR_WORDS (the tủ-lạnh collision above) only stopped them being read
 * as a floor. It did not stop the bare-amount rule from reading the number BEHIND them as a
 * CEILING — so "tủ lạnh từ 5 triệu" came back as priceMax 5.000.000 and a buyer asking for fridges
 * FROM 5 triệu was shown only fridges UNDER it. Measured; that is the same intent inversion as the
 * ">=" tokenising bug, arrived at from the other direction, and it is the worst outcome this file
 * can produce. "Not confident enough to parse" has to mean not confident enough to guess the
 * OPPOSITE either.
 *
 * The same applies to a real comparator whose own amount was refused, or whose slot was already
 * filled ("xe trên 5tr trên 8tr" inferred a ceiling of 8 triệu behind the second "trên").
 */
/**
 * ⚠️ "hơn" IS BLOCKED, NOT PARSED — AND IT WAS BRIEFLY A REAL FLOOR, WHICH WAS A MISTAKE WORTH
 * RECORDING. "hơn" is a COMPARATIVE PARTICLE, not a preposition: its direction is set by the
 * adjective in front of it, and this scanner only ever looks at the token immediately before the
 * amount. So "rẻ hơn 5 triệu" (CHEAPER than) and "nhỏ hơn 5 tỷ" (SMALLER than) mean a ceiling while
 * "cao hơn"/"nhiều hơn" mean a floor, and the bare "hơn 5 triệu" means a floor again. Reading it as
 * a floor got "xe rẻ hơn 5 triệu" exactly backwards — priceMin 5.000.000, with "rẻ" deleted from the
 * query — measured, on the very sweep that added it. Direction that depends on an adjective this
 * code cannot see is direction it must not guess: block, and let the words go back to the buyer.
 *
 * "min" is here for the same reason as "minimum" in RANGE_HINTS: without it the bare "xe min 5tr"
 * became a 5-triệu CEILING, one synonym away from the hole FLOOR_HINTS exists to close.
 */
const FLOOR_HINTS = new Set(['tu', 'from', 'hon', 'min'])

/**
 * ⚠️ "ABOUT" WORDS BLOCK THE INFERENCE TOO, AND UNTIL THIS SET EXISTED THE FILE'S OWN HEADER WAS
 * WRONG. The DELIBERATELY-NOT-PARSED list said "khoảng / about / ~ — an approximate price has no
 * bound to set", and the code then read the number behind them as a ceiling anyway: measured,
 * "xe khoảng 8 triệu" returned priceMax 8.000.000 with the residual "xe khoảng". A comment
 * describing code that does not exist is a defect in this repo, and here the comment was also the
 * better design — "khoảng 8 triệu" WIDENS a target, so capping at 8 triệu hides the 8,5 triệu
 * listing the buyer would happily have taken.
 *
 * "tầm" (also "around") IS included despite folding to `tam`, which collides with tám/tấm/tạm — and
 * the collision is survivable precisely because this set only ever BLOCKS. The worst it can do is
 * cost "tấm 500k" its price facet; leaving it out cost "xe tầm 8 triệu" a wrong ceiling, which is
 * the side of the trade this file never takes.
 *
 * The glued "~8tr" needs no entry — an amount token must start with a digit, so it never matched.
 */
const APPROX_HINTS = new Set(['khoang', 'tam', 'about', 'around', 'approx', '~'])

/**
 * The same idea in two words. Folded, so "ít nhất" → `it nhat` and "trở lên" → `tro len`.
 * ⚠️ "đến"/"tới" ARE NOT HERE, for the tủ/max reason: fold('đến') and fold('đen') are both `den`,
 * and "áo đen 500k" (a black shirt) is far commoner than a typed range. Measured — the price in
 * that query still parses, which is the point of leaving the word out.
 */
const FLOOR_PHRASES_BEFORE = [['it', 'nhat'], ['toi', 'thieu'], ['at', 'least'], ['starting', 'at']]

/**
 * ⚠️ THE SAME WORDS AGAIN, ON THE OTHER SIDE OF THE NUMBER — Vietnamese and English both put these
 * after the amount as often as before it, and only the "before" list existed at first. Measured:
 * "bike 5 million minimum" and "xe 5 triệu tối thiểu" both returned a 5-triệu CEILING, and
 * "xe 2020 trở lên" (2020 and newer) came back as the EXACT year 2020 with "trở lên" orphaned —
 * hiding every newer vehicle, which is precisely what the buyer asked for.
 */
// ⚠️ "trở xuống" ("or below") is NOT here on purpose: it means a ceiling, which is exactly what the
// inference already produces, so blocking it would refuse a reading that happens to be right.
const FLOOR_PHRASES_AFTER = [['tro', 'len'], ['or', 'more'], ['or', 'newer'], ['or', 'above'], ['toi', 'thieu']]
const FLOOR_WORDS_AFTER = new Set(['minimum', 'min'])

/**
 * ⚠️ THE YEAR NEEDS BOTH DIRECTIONS, THE PRICE ONLY ONE — which is why this is a second list rather
 * than more entries above. "trở xuống" ("or below") after a PRICE agrees with the ceiling the
 * inference already produces, so blocking it there would refuse a correct reading. After a YEAR it
 * is a range endpoint like any other: measured, "xe 2020 trở xuống" (2020 or older) came back as the
 * EXACT year 2020 with the phrase orphaned — the "trở lên" bug, left open in its mirror.
 */
const CEILING_PHRASES_AFTER = [['tro', 'xuong'], ['or', 'less'], ['or', 'below'], ['or', 'older']]
const YEAR_RANGE_PHRASES_AFTER = [...FLOOR_PHRASES_AFTER, ...CEILING_PHRASES_AFTER]

/**
 * Words that turn the number behind them into a RANGE ENDPOINT rather than a value — "đời trước
 * 2020" is 2020-and-older, "before 2020" the same. There is no range facet, so like a comparator
 * they block every inference at that position. Measured: "xe đời trước 2020" used to come back as
 * the EXACT year 2020, i.e. the one model year the buyer explicitly ruled out of the top of the
 * range. ⚠️ "sau"/"sâu" (after/deep) is deliberately absent — the fold collides and "loa sâu" is
 * ordinary catalogue vocabulary, so blocking on it would cost more than it saves.
 */
const RANGE_HINTS = new Set(['truoc', 'before', 'after', 'minimum'])

/**
 * ⚠️ NON-MONEY UNITS BLOCK THE YEAR READING TOO, AND ONLY THE MONEY ONES DID AT FIRST. `unitFollows`
 * was `unitFactor(...)`, which knows about money and nothing else — so a four-digit number in the
 * year window followed by a SPACED measurement still became a model year: measured, "đất 2000 m2"
 * returned year 2000 with the residual "đất m2", and "loa 2000 w" / "xe tải 2000 kg" the same. The
 * glued spellings ("2000m2", "2000w") were already refused, so the two spellings of one intent
 * disagreed — the exact property the "xe 2000k" rule was written to protect.
 *
 * ⚠️ A DENYLIST, NOT A SHAPE TEST, AND THAT IS THE WHOLE DESIGN. "Any short alphabetic token" would
 * be shorter to write and would eat "honda vision 2024 đỏ" (đỏ = red, two letters after folding),
 * deleting a real year from a real query. An explicit roster of measurement units cannot do that:
 * it only ever refuses tokens that ARE units. Add to it when a category needs one.
 */
const MEASURE_UNITS = new Set([
  'm2', 'm²', 'm3', 'cm', 'mm', 'km', 'ha', 'inch', 'in',
  'w', 'kw', 'wh', 'kwh', 'v', 'a', 'ah', 'mah', 'hz', 'mhz', 'ghz',
  'kg', 'g', 'l', 'ml', 'cc', 'hp', 'rpm', 'gb', 'tb', 'mb', 'px', 'mp',
  'lm', 'lumen', 'lumens', 'nit', 'nits', 'db', 'psi', 'bar', 'ppm',
])

/** True when the token before an amount forbids inferring anything about it. */
function inferenceBlockedBy(token: string | undefined): boolean {
  return (
    !!token &&
    (comparatorBound(token) !== null || FLOOR_HINTS.has(token) || APPROX_HINTS.has(token) || RANGE_HINTS.has(token))
  )
}

function phraseAt(folded: string[], at: number, phrases: string[][]): boolean {
  return phrases.some(([a, b]) => folded[at] === a && folded[at + 1] === b)
}

/** A floor-meaning word or phrase sitting AFTER an amount, in either language. */
function raisesFloorAt(folded: string[], at: number): boolean {
  return FLOOR_WORDS_AFTER.has(folded[at] ?? '') || phraseAt(folded, at, FLOOR_PHRASES_AFTER)
}

/** Any range endpoint after a YEAR — both directions, unlike the price case. */
function yearRangeAt(folded: string[], at: number): boolean {
  return FLOOR_WORDS_AFTER.has(folded[at] ?? '') || phraseAt(folded, at, YEAR_RANGE_PHRASES_AFTER)
}

/**
 * "đời 2024" / "year 2024" — the buyer NAMED the year, so the facet is explicit and the noise word
 * leaves the residual with it.
 *
 * ⚠️ "năm" IS DELIBERATELY ABSENT, and it was here until three reviewers independently found it.
 * `fold('năm')` and `fold('nam')` are the same token, and "nam" (men's) is one of the commonest
 * qualifiers in this catalogue. Measured: "xe đạp nam 2024" returned the residual "xe đạp" and an
 * EXPLICIT year chip — the qualifier deleted, women's bikes returned, and the chip claiming the
 * buyer had said something they did not. Exactly the failure `từ`/`tủ` is excluded for.
 *
 * ⚠️ AND THE COST OF REMOVING IT IS ALMOST NOTHING, WHICH IS THE ARGUMENT. The bare-year rule below
 * still reads "2024"; all that is lost is the word "năm" staying in the residual and the facet
 * reading inferred instead of explicit. A stray function word is not worth a deleted noun.
 *
 * "đời" (đôi = a pair, đổi = to exchange) collides in the same way but survives, because the year
 * must follow IMMEDIATELY and "đôi <year>" is not a phrase — measured: "đôi giày nike 2024" keeps
 * "đôi giày nike" intact. It stays because "đời 2024" is THE way a vehicle model year is written.
 */
const YEAR_WORDS = new Set(['doi', 'year'])

/** Money units that stand on their own. Keys are FOLDED, so "triệu"/"trieu" and "tỷ"/"ty" both land. */
const UNITS: Record<string, number> = {
  k: 1_000,
  nghin: 1_000,
  ngan: 1_000,
  thousand: 1_000,
  tr: 1_000_000,
  trieu: 1_000_000,
  million: 1_000_000,
  ty: 1_000_000_000,
  ti: 1_000_000_000,
  billion: 1_000_000_000,
  // Bare currency suffixes. Safe only because of the price floor above — every model number that
  // ends in "d" (320d, 4000d, 2.0d) resolves below it and is refused.
  d: 1,
  dong: 1,
  vnd: 1,
  '₫': 1,
}

/**
 * ⚠️ GUARD 3 — units that are ONLY units when a comparator introduced them. "under 8m" is a budget;
 * "nhà 80m" is floor area and property is a live category. The comparator is the disambiguator, so
 * these are unreachable without one.
 */
const COMPARATOR_ONLY_UNITS: Record<string, number> = { m: 1_000_000, b: 1_000_000_000 }

/**
 * ⚠️ GUARD 5 — THE LETTER `k` IS ONLY MONEY BELOW 1.000, AND THE FLOOR DOES NOT COVER THIS.
 *
 * Guard 2 kills "tivi 4k" because 4.000 ₫ is under 50.000 ₫ — which by construction only protects
 * `k` values under 50. Everything above sails through, and two live categories write exactly that:
 * lighting colour temperature ("đèn led 3000k", "bóng đèn 6500k") and Intel K-SKUs ("i7 9700k").
 * Measured before this rule: all three became 3–9,7 triệu ceilings with the token DELETED from the
 * residual — the model-name-eating failure this file exists to prevent.
 *
 * What separates them is how Vietnamese actually writes money: `k` is sub-million shorthand (200k,
 * 800k, 950k) and past a million everyone switches to "tr"/"triệu". So the shorthand simply stops
 * at 1.000. The spelled-out words ("nghìn", "thousand") are NOT affected: no product spec is
 * written "6500 nghìn", so they need no ceiling.
 *
 * ⚠️ THIS DOES COST REAL PRICES, AND THE LOSS IS ACKNOWLEDGED RATHER THAN GLOSSED. "1200k",
 * "1500k" and "2500k" are genuine classifieds shorthand for 1,2–2,5 triệu and no longer parse:
 * they stay in the free text, so the buyer gets an ordinary text search instead of a wrong filter.
 * The band cannot be reopened by simply raising the ceiling, either — lighting runs 2200K–6500K, so
 * 2500 and 3000 are ambiguous in BOTH directions and no number separates the two meanings. Under
 * this file's rule the loss is the correct side to take, and a case in the refusal block pins it so
 * the cost stays visible instead of being rediscovered.
 */
const K_SHORTHAND_MAX = 1_000
function shorthandRefuses(unit: string, num: number): boolean {
  return unit === 'k' && num >= K_SHORTHAND_MAX
}

/** Punctuation that may cling to a word without being part of it. NOT `<`/`>` (they are operators,
 *  split out before tokenising) and NOT `.`/`,` INSIDE a token (they are number separators). */
const EDGE_PUNCT = /^[."'“”‘’(),;:!?/]+|[."'“”‘’(),;:!?/]+$/g

function foldToken(word: string): string {
  return fold(word).replace(EDGE_PUNCT, '')
}

function unitFactor(token: string, comparatorPresent: boolean): number | undefined {
  const plain = UNITS[token]
  if (plain !== undefined) return plain
  return comparatorPresent ? COMPARATOR_ONLY_UNITS[token] : undefined
}

/**
 * A numeric literal, in both separator conventions — and the two are genuinely ambiguous in
 * Vietnamese, where "." groups thousands ("8.000.000") and "," is the decimal point ("8,5 triệu").
 * The shapes are disjoint, so the digit COUNT after the separator decides, not a locale flag:
 *   · `8.000.000` / `8,000,000` → grouped integer (groups of exactly 3, repeated)
 *   · `8.5` / `8,5`             → one decimal point, 1–2 digits
 *   · `800`                     → plain
 * `moneyShaped` marks the ONE form that may be read as a price with no unit and no comparator behind
 * it — see the rule below, which is narrower than "grouped" and was narrowed for a measured reason.
 */
function parseNumeric(token: string): { value: number; moneyShaped: boolean; separated: boolean } | null {
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(token)) {
    /**
     * ⚠️ A BARE GROUPED NUMBER MUST END IN A ROUND THOUSAND, AND "GROUPED IS ENOUGH" WAS WRONG.
     * The first draft claimed no phone number could match because "0912.345.678" has a four-digit
     * lead group. Measured counterexample from review: the international form "+84 912.345.678"
     * leads with THREE digits and parsed as a 912.345.678 ₫ ceiling — the phone number deleted from
     * the query. "192.168.001" did the same. What actually separates a quoted VND price from a
     * dotted identifier is the LAST group: the đồng has no practical sub-thousand unit, so real
     * prices are quoted round ("8.000.000", "11.500.000") while a phone number's or an IP address's
     * final group is arbitrary. Prices with a comparator in front are unaffected — this rule only
     * gates the no-unit, no-comparator inference.
     */
    return { value: Number(token.replace(/[.,]/g, '')), moneyShaped: /[.,]000$/.test(token), separated: true }
  }
  if (/^\d+(?:[.,]\d{1,2})?$/.test(token)) {
    return { value: Number(token.replace(',', '.')), moneyShaped: false, separated: false }
  }
  return null
}

/** "8tr", "800k", "8.000.000đ" — a number with its unit glued on. The unit must run to the end of
 *  the token, which is what keeps "80m2" (area), "125i" and "256gb" out. */
function splitGlued(token: string): { num: number; unit: string; separated: boolean } | null {
  const m = /^([0-9][0-9.,]*)([a-z₫]+)$/.exec(token)
  if (!m) return null
  const n = parseNumeric(m[1])
  return n ? { num: n.value, unit: m[2], separated: n.separated } : null
}

/**
 * ⚠️ A SEPARATED NUMBER IN FRONT OF A MAGNITUDE UNIT IS REFUSED, BECAUSE THE TWO READINGS DIFFER BY
 * A FACTOR OF A THOUSAND AND NOTHING IN THE STRING DECIDES. "1,125 triệu" is 1,125 triệu under
 * en-grouping and 1.125 triệu under vi-decimal — measured, the grouped reading won and produced a
 * ceiling of 1.125 TỶ from a buyer who meant 1.125.000 ₫, a 1000× inflation that silently empties
 * the feed. Both spellings are common and neither is wrong, so this is exactly the two-sided signal
 * the header says to refuse rather than guess. Unaffected: a plain decimal ("8,5 triệu" — one or two
 * places, never three), and a grouped figure with NO magnitude behind it ("dưới 8.000.000",
 * "8.000.000 đồng"), where the separators can only be grouping.
 */
function magnitudeAmbiguity(separated: boolean, factor: number): boolean {
  return separated && factor > 1
}

/**
 * ⚠️ A TRAILING CURRENCY WORD BELONGS TO THE AMOUNT. "dưới 8 triệu đồng" is one phrase, but only
 * `8 triệu` was being claimed — leaving "đồng" stranded in the free text, where it is a word no
 * listing title contains and therefore quietly suppresses matches. Same for "8 million VND". These
 * are swallowed only AFTER a real magnitude unit, so "8000000 đồng" (where the currency word IS the
 * unit) is unaffected.
 */
const CURRENCY_TAIL = new Set(['dong', 'vnd', 'd', '₫'])

type AmountMatch = { value: number; consumed: number; hadUnit: boolean; moneyShaped: boolean }

/** Extend a matched amount over a trailing "đồng"/"VND" if one is sitting there. */
function withCurrencyTail(m: AmountMatch, folded: string[], start: number): AmountMatch {
  if (!m.hadUnit) return m
  return CURRENCY_TAIL.has(folded[start + m.consumed] ?? '') ? { ...m, consumed: m.consumed + 1 } : m
}

/** Read an amount starting at `i`: "8tr" (1 token), "8 tr" (2), or a bare "8" (1, no unit). */
function matchAmount(folded: string[], i: number, comparatorPresent: boolean): AmountMatch | null {
  const here = folded[i]
  if (!here) return null

  const glued = splitGlued(here)
  if (glued) {
    const factor = unitFactor(glued.unit, comparatorPresent)
    // A number welded to something that is not money (or to a shorthand that refuses this size —
    // guard 5) is left entirely alone; there is nothing else it could be.
    if (factor === undefined || shorthandRefuses(glued.unit, glued.num) || magnitudeAmbiguity(glued.separated, factor)) {
      return null
    }
    return withCurrencyTail({ value: glued.num * factor, consumed: 1, hadUnit: true, moneyShaped: true }, folded, i)
  }

  const n = parseNumeric(here)
  if (!n) return null

  const next = folded[i + 1]
  if (next && !shorthandRefuses(next, n.value)) {
    const factor = unitFactor(next, comparatorPresent)
    if (factor !== undefined && !magnitudeAmbiguity(n.separated, factor)) {
      return withCurrencyTail({ value: n.value * factor, consumed: 2, hadUnit: true, moneyShaped: true }, folded, i)
    }
  }
  return { value: n.value, consumed: 1, hadUnit: false, moneyShaped: n.moneyShaped }
}

function priceInRange(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_PRICE_VND && value <= MAX_PRICE_VND
}

function comparatorBound(token: string): 'priceMax' | 'priceMin' | null {
  if (CEILING_WORDS.has(token)) return 'priceMax'
  if (FLOOR_WORDS.has(token)) return 'priceMin'
  return null
}

/**
 * Lift year and price out of a typed query.
 *
 * @param input the raw search box contents
 * @param opts.now injectable clock — the year window's upper bound is `now`'s year + 1. Tests pin it
 *        so the suite does not start failing on 1 January.
 *        ⚠️ PIN IT ON ANY PATH THAT RUNS BOTH ON THE SERVER AND IN THE BROWSER. The default reads
 *        the LOCAL year, and a Cloud Run server on UTC disagrees with a buyer on UTC+7 for seven
 *        hours around New Year — so "xe 2028" would yield a year chip on the client and none from
 *        the server, i.e. a facet that materialises only after hydration. Passing one clock down
 *        makes the two passes agree; nothing here can do that for the caller.
 */
export function parseQuery(input: string, opts: { now?: Date } = {}): ParsedQuery {
  const raw = (input ?? '').slice(0, MAX_INPUT)
  /**
   * Operators become their own tokens so "<8tr" parses like "< 8tr". If they end up UNCONSUMED they
   * rejoin with a space, which is the only way the residual differs from what was typed.
   *
   * ⚠️ THE TWO-CHARACTER FORMS MUST BE MATCHED FIRST, and getting this wrong INVERTED THE BUYER'S
   * INTENT rather than merely failing. With a single-character class, ">= 20tr" split into ">", "="
   * and "20tr": the floor never parsed (an "=" is not an amount), the loose "20tr" was then read by
   * pass B as an inferred CEILING, and someone who asked for bikes ABOVE 20 triệu was shown only
   * bikes BELOW it — with "> =" left sitting in the search box. Measured on the first draft; all
   * three review families found it. The alternation is ordered longest-first for that reason.
   */
  const words = raw.replace(/(<=|>=|[<>≤≥])/g, ' $1 ').split(/\s+/).filter(Boolean)
  const folded = words.map(foldToken)
  const taken: boolean[] = new Array(words.length).fill(false)
  let found: (QueryFacet & { at: number; span: number })[] = []
  const filled = new Set<QueryFacetKind>()
  const maxYear = (opts.now ?? new Date()).getFullYear() + 1

  const claim = (start: number, count: number): string => {
    for (let j = start; j < start + count; j++) taken[j] = true
    return words.slice(start, start + count).join(' ')
  }
  const add = (kind: QueryFacetKind, value: number, at: number, span: number, source: string, explicit: boolean) => {
    found.push({ kind, value, source, explicit, at, span })
    filled.add(kind)
  }
  const isYear = (t: string | undefined) => !!t && /^\d{4}$/.test(t) && Number(t) >= MIN_YEAR && Number(t) <= maxYear

  /**
   * ⚠️ TWO PASSES, AND THE ORDER BETWEEN THEM IS THE POINT: WHAT THE BUYER SAID BEATS WHAT WE GUESS.
   * In one left-to-right pass, "8tr dưới 5tr" would let the INFERRED ceiling at position 0 fill the
   * slot and then refuse the explicit "dưới 5tr" behind it — a stated intent losing to a guessed one
   * purely because of word order. Claiming every explicit facet first makes that impossible. Facets
   * are re-sorted into typed order at the end, so the chip row still reads left to right.
   */

  // PASS A — the buyer NAMED the facet: a comparator with an amount, or "đời/năm/year" with a year.
  for (let i = 0; i < words.length; i++) {
    const tok = folded[i]

    // The ONLY path that unlocks the single-letter units, and the only one that accepts a bare
    // number — "dưới 8000000" is unmistakably a budget.
    // ⚠️ The comparator is claimed ONLY if the amount behind it is real. Otherwise "dưới" stays in
    // the text, where the later rules can still look at what follows it.
    const bound = comparatorBound(tok)
    if (bound && !filled.has(bound)) {
      const amount = matchAmount(folded, i + 1, true)
      if (amount && priceInRange(amount.value)) {
        add(bound, Math.round(amount.value), i, 1 + amount.consumed, claim(i, 1 + amount.consumed), true)
        i += amount.consumed
        continue
      }
    }

    // ⚠️ ...unless a comparator introduced it. "xe dưới đời 2020" is a RANGE (2020 or older) and
    // there is no range facet here, so claiming an exact year would answer a question the buyer did
    // not ask. Same rule as the bare-year branch in pass B; see the note there.
    if (
      YEAR_WORDS.has(tok) &&
      !filled.has('year') &&
      isYear(folded[i + 1]) &&
      !inferenceBlockedBy(folded[i - 1]) &&
      // ⚠️ AND THE TRAILING SIDE TOO — pass B checks it and pass A did not, so "xe đời 2020 trở lên"
      // returned an EXPLICIT exact year 2020 with the phrase orphaned: a chip claiming the buyer
      // said the one thing they had ruled out of the bottom of their range.
      !yearRangeAt(folded, i + 2)
    ) {
      add('year', Number(folded[i + 1]), i, 2, claim(i, 2), true)
      i += 1
    }
  }

  // PASS B — inference from shape alone, over whatever pass A left behind.
  for (let i = 0; i < words.length; i++) {
    if (taken[i]) continue
    const tok = folded[i]

    // A bare money amount with no comparator — "8tr", "800k", "1.000.000". Read as a CEILING.
    // ⚠️ THIS IS THE ONE INFERENCE IN THE FILE, and it is inference, not fact: nobody searching a
    // marketplace for "xe 8tr" wants bikes priced at exactly 8.000.000 — they are stating a budget.
    // It is only safe because the facet is `explicit: false` and the chip is REMOVABLE, so a wrong
    // reading costs one tap rather than a dead end. A bare number with no unit is NOT reachable here
    // (guard 1); a grouped number is, because "1.000.000" cannot be anything else.
    /**
     * ⚠️ COMPUTED UNCONDITIONALLY — NOT `filled.has('priceMax') ? null : …`, WHICH IS WHAT IT SAID
     * FIRST AND WHICH MADE THE PHRASE MEAN DIFFERENT THINGS IN DIFFERENT SENTENCES. With the guard
     * folded in, a query that had already claimed a ceiling left `money` null, the year branch's
     * test went vacuously true, and the fix below stopped applying. Measured: "xe 2000 k" gave a
     * 2.000.000 ₫ ceiling, while "xe 2000 k dưới 5 triệu" gave `year: 2000` and the residual
     * "xe k" — the same three words read two ways depending on what followed them. The money
     * reading now decides year-vs-money always; `filled` only suppresses the FACET, leaving the
     * words in the text rather than turning them into a year nobody asked for.
     */
    const candidate = matchAmount(folded, i, false)
    const wellFormed = candidate && (candidate.hadUnit || candidate.moneyShaped) && priceInRange(candidate.value) ? candidate : null

    /**
     * ⚠️ NOTHING IS INFERRED NEXT TO A BOUND WORD WE DECLINED TO PARSE — see FLOOR_HINTS. A number
     * introduced by "từ"/"from", or sitting behind a comparator whose own parse was refused, must
     * not become a CEILING: that is not a missed facet, it is the opposite filter. Same for the
     * trailing "trở lên" ("and up"), which puts the floor-meaning word AFTER the amount:
     * "xe 20 triệu trở lên" measured as priceMax 20.000.000 before this guard.
     */
    const blocked = inferenceBlockedBy(folded[i - 1]) || phraseAt(folded, i - 2, FLOOR_PHRASES_BEFORE)
    /**
     * ⛔ A NUMBER FOLLOWED BY A MEASURE UNIT IS A MEASUREMENT, NOT A PRICE — AND THIS GUARD USED TO
     * PROTECT ONLY THE YEAR READING. `MEASURE_UNITS` fed `yearBlocked` and nothing else, so the
     * bare-money inference below happily read an odometer. Measured on the pinned clock:
     *   "xe cu chay 55.000 km"          → priceMax 55.000 ₫, residual "xe cu chay km"
     *   "oto toyota vios 2019 90.000 km" → year 2019 + priceMax 90.000 ₫
     *   "xe 80.000 km gia 50 trieu"      → priceMax 80.000 ₫, and the REAL budget ("50 trieu") is
     *                                      left as free text because the ceiling slot is taken
     * Every one of those lands under MIN_PRICE_VND — the floor this file justifies as "nothing on
     * this marketplace is listed under it" — so the buyer gets a guaranteed empty feed AND their
     * number deleted from the query: the four-tap dead end reached in one tap. The glued spelling
     * "xe 50.000km" was already refused, so the two spellings of one intent disagreed, which is
     * exactly the defect MEASURE_UNITS was introduced to fix for years. Same rule, both readings.
     */
    const measureFollows = MEASURE_UNITS.has(folded[i + (wellFormed?.consumed ?? 1)] ?? '')
    const money = wellFormed && !blocked && !measureFollows && !raisesFloorAt(folded, i + wellFormed.consumed) ? wellFormed : null

    /**
     * A bare four-digit year inside the window. Guard 4 is the whole rule: outside 1990…now+1 this
     * is a model number and stays in the text.
     *
     * ⚠️ MONEY WITH AN EXPLICIT UNIT BEATS THE YEAR READING, and the order used to be the other way
     * round. Measured: "xe 2024 triệu" claimed 2024 as a MODEL YEAR and orphaned "triệu" in the
     * residual ("xe triệu"), so a 2,024 tỷ ceiling became a nonsense query — and "xe 2000 k" did the
     * same with "xe k". A four-digit number that is followed by a money word is money; nothing else
     * writes a year with "triệu" behind it. The unit must be EXPLICIT (`hadUnit`), so a lone "2019"
     * is still a year and "xe 2024 đ" — 2.024 ₫, under the floor, so no valid money reading — falls
     * back to the year rather than losing both.
     */
    /**
     * ⚠️ A YEAR SITTING BEHIND A COMPARATOR IS A RANGE WE DO NOT MODEL, SO IT IS REFUSED WHOLE.
     * "xe đời dưới 2020" asks for 2020-or-older. The comparator path already declined it (2.020 ₫ is
     * under the price floor, correctly — it is not money), and pass B then read the bare "2020" as an
     * EXACT year and handed back the residual "xe đời dưới" — a filter the buyer did not ask for
     * plus two orphaned words. There is no yearMin/yearMax facet here and inventing one is out of
     * scope, so the honest answer is to leave the whole phrase as text where the buyer can see it.
     *
     * ⚠️ A YEAR WORD IN FRONT BLOCKS IT TOO, AND THAT CLOSES THE BACK DOOR. Pass A had first refusal
     * on "đời <year>"; if it declined — the slot was filled, or a comparator was in front, as in
     * "xe dưới đời 2020" — then inferring the very same year here smuggles back exactly what pass A
     * just refused, one token to the right. Measured: that word order slipped through the first
     * version of this guard and returned year 2020 with the residual "xe dưới đời".
     *
     * ⚠️ AND A MONEY UNIT BEHIND IT BLOCKS IT UNCONDITIONALLY — not merely when the money reading is
     * VALID, which is what the first version said and which guard 5 then falsified. "xe 2000 k" is
     * refused as money (k-shorthand stops at 1.000), and with only the valid-money test in place the
     * bare-year branch happily claimed 2000 instead and orphaned the "k": an invented filter plus a
     * broken text query, and the glued "xe 2000k" — the same intent — parsed differently. The rule
     * is simpler stated positively: A FOUR-DIGIT NUMBER FOLLOWED BY A MONEY WORD IS MONEY
     * VOCABULARY, never a model year. If that money reading is valid we take it; if it is not, we
     * take NOTHING and the words go back to the buyer intact.
     */
    const nextTok = folded[i + 1] ?? ''
    const unitFollows = unitFactor(nextTok, false) !== undefined || MEASURE_UNITS.has(nextTok)
    // A floor phrase BEHIND the year makes it a range endpoint, exactly as a comparator in front
    // does: "xe 2020 trở lên" is 2020-and-newer, and reading it as the exact year 2020 hides every
    // vehicle the buyer actually asked for.
    const yearBlocked = blocked || unitFollows || yearRangeAt(folded, i + 1) || YEAR_WORDS.has(folded[i - 1] ?? '')

    if (!filled.has('year') && isYear(tok) && !yearBlocked && !(money && money.hadUnit)) {
      add('year', Number(tok), i, 1, claim(i, 1), false)
      continue
    }

    if (money && !filled.has('priceMax')) {
      // A trailing "trở xuống" / "or less" AGREES with the ceiling we inferred, so it is swallowed
      // rather than blocked — leaving it in the free text would put two words no listing title
      // contains into the search and suppress the very matches the query is for.
      const span = money.consumed + (phraseAt(folded, i + money.consumed, CEILING_PHRASES_AFTER) ? 2 : 0)
      add('priceMax', Math.round(money.value), i, span, claim(i, span), false)
      i += span - 1
    }
  }

  /**
   * ⚠️ A CONTRADICTORY RANGE IS REFUSED WHOLE, NOT SHIPPED HALF-BELIEVED. "xe trên 20 triệu dưới 8
   * triệu" parsed to priceMin 20.000.000 with priceMax 8.000.000 — an empty set by construction, and
   * one the zero-results surface CANNOT recover, because "relax ONE thing" always leaves the other
   * bound in place. Neither bound is more likely to be the intended one (the commonest cause is the
   * two being typed the wrong way round), so guessing would be exactly the false parse this file
   * refuses elsewhere. Both price facets are un-claimed and their words go back into the residual
   * text, where the buyer can see and fix what they typed. The year is unaffected.
   */
  const lo = found.find((f) => f.kind === 'priceMin')
  const hi = found.find((f) => f.kind === 'priceMax')
  if (lo && hi && lo.value > hi.value) {
    /**
     * ⚠️ THE GUESS IS DROPPED BEFORE THE STATED BOUND — the first version dropped both unconditionally
     * and thereby let the parser's own inference cancel the buyer's explicit words. Measured on
     * "xe trên 20 triệu 8tr": pass A claimed an EXPLICIT floor of 20 triệu, pass B INFERRED a ceiling
     * of 8 triệu from the loose amount, and the pair was then thrown away whole — the one thing the
     * buyer actually typed, deleted to resolve a conflict with something nobody said. That inverts
     * the explicit-beats-inferred doctrine the two-pass structure exists to enforce, at the last
     * step. When exactly one side is inferred, only it goes; when both are stated (or both guessed)
     * there is no principled winner and both go.
     */
    const guessed = [lo, hi].filter((f) => !f.explicit)
    const victims = guessed.length === 1 ? guessed : [lo, hi]
    for (const f of victims) for (let j = f.at; j < f.at + f.span; j++) taken[j] = false
    found = found.filter((f) => !victims.includes(f))
  }

  found.sort((a, b) => a.at - b.at)
  const out: ParsedQuery = {
    text: words.filter((_, i) => !taken[i]).join(' '),
    facets: found.map(({ at: _at, span: _span, ...f }) => f),
  }
  for (const f of found) {
    if (f.kind === 'year') out.year = f.value
    else if (f.kind === 'priceMin') out.priceMin = f.value
    else out.priceMax = f.value
  }
  return out
}
