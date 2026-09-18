/**
 * THE MODEL a merchant-feed title names — "iPhone 16 Pro Max", "Galaxy S24 Ultra" — so a shopper
 * can filter to their exact device and find its accessories (owner, 2026-08-24: "easier to find
 * accessories for designated brand model"). `model` is a live filter (feed-query.ts pushes
 * `{ model }`).
 *
 * ⚠️ IT LIVES HERE, NOT IN scripts/import-accesstrade.ts WHERE IT WAS WRITTEN, for the same reason
 * thread-kind.ts had to be split out of messages.ts: that script imports `../src/lib/db` at module
 * scope, so a unit test cannot load it at all and the rule could only ever be "tested" by mocking
 * it. A rule with a history of getting the wrong answer should be the most testable thing here.
 *
 * ⚠️ THE CANONICAL CASING IS THE POINT, NOT DECORATION. The filter matches on the STRING, so
 * "Macbook Pro" and "MacBook Pro" are two different filter entries listing half the stock each —
 * and the feed contains both spellings. Measured on 4,000 real titles: 23% carry a model,
 * 122 distinct once canonicalised.
 *
 * ⚠️ NO MATCH LEAVES IT NULL. Most of this feed is appliances and cables with no model; inventing
 * one would fill the facet with noise, which is the opposite of "easier to find".
 */

/**
 * ⛔ EVERY TRAILING NUMBER IS ANCHORED WITH `\b`, AND THAT IS THE BUG THIS FILE WAS EXTRACTED FOR.
 * The Apple Watch pattern was `Ultra\s?\d?`, which happily took the `4` out of
 * "Apple Watch Ultra **49**mm" and invented a product: 6 live listings were filed under
 * "Apple Watch Ultra 4", a watch that does not exist (owner, 2026-08-26: "apple watch ultra 4
 * doesnt exist"). The tell was a listing reading "(GPS)" rather than "(4G)" and STILL landing on
 * Ultra 4 — the digit never came from the connectivity suffix, it came from the case size.
 *
 * `\b` after the digits is what distinguishes a model number from the head of a measurement:
 *   "Ultra 2 2024 49mm" → `2` is followed by a space   → boundary → MODEL 2       ✓
 *   "Ultra 49mm"        → `4` is followed by `9`, `9` by `m` → no boundary at any
 *                          backtrack, so the optional group matches EMPTY → "Apple Watch Ultra" ✓
 * ⚠️ It works by backtracking, so it must sit immediately after the last character that can be
 * part of the model number — moving it to the end of the whole alternation would let `\d{1,3}`
 * keep "49" and only then check the boundary.
 * ⛔ SO IT GOES AFTER THE OPTIONAL SUFFIX, NEVER BETWEEN THE DIGITS AND IT — and I got this wrong
 * TWICE in one sitting. First draft put `\b` straight after the digits everywhere: "Xiaomi 14T"
 * went null (my own test caught it), I fixed Redmi/Xiaomi, wrote a comment explaining the rule, and
 * left the identical shape in the iPhone and Galaxy patterns. A reviewer caught those; measured,
 * "iPhone 16e" and "Galaxy S21FE" — both real, both previously matching — were returning null.
 * The suffix is part of the model name, so the boundary belongs after it.
 * ⚠️ It still rejects a size there: "Xiaomi 14mm" backtracks through letter="m" and letter="" and
 * finds no boundary either way.
 * ⛔ Do not "simplify" any `\d\b` back to `\d` here. Audited across the live catalogue: this was
 * the only model whose trailing number was really a millimetre size, and `\b` is what keeps it so.
 */
/**
 * ⛔ ONLY THE APPLE WATCH PATTERN IS GUARDED, AND THAT NARROWNESS IS THE DECISION. `Ultra\s?\d?`
 * took the `4` out of "Apple Watch Ultra **49**mm" and invented a product: 6 live listings were
 * filed under "Apple Watch Ultra 4", a watch that does not exist (owner, 2026-08-26). The tell was
 * a listing reading "(GPS)" rather than "(4G)" and STILL landing on Ultra 4 — the digit never came
 * from the connectivity suffix, it came from the case size.
 *
 * ⛔ I FIRST GENERALISED THE GUARD TO EVERY PATTERN AND IT WAS A MISTAKE — three rounds of reviewer
 * findings, each a real product, each caught only because someone looked:
 *   · `\b` after the digits        → "Xiaomi 14T", "Redmi 12C" went null
 *   · `\b` after the suffix group  → "Galaxy A05s" went null (a suffix no alternation lists)
 *   · a generic letter tail        → "iPhone 16GB" became a MODEL
 *   · `in` read as inches          → "Apple Watch Ultra 2 in Black" lost its generation
 * ⚠️ AND THE REAL COST WAS INVISIBLE UNTIL I DRY-RAN IT OVER THE CATALOGUE: the generalised version
 * changed 60 of 9,773 stored models — inventing "iPhone 20W" (a charger wattage), dropping
 * "AirPods Pro 2" to "AirPods Pro", and re-keying "Galaxy Watch6" to "Galaxy Watch 6", which SPLITS
 * a facet rather than unifying it. A canonicalising function must not churn its own history.
 * ✅ Narrowed to the one line that was wrong: every other pattern is byte-identical to what shipped,
 * and the same dry run now reports only the 6 Apple Watch rows.
 *
 * The guard reads: a model number is not followed by another digit, nor by a case size.
 *   "Ultra 49mm"    → `4` is followed by `9` → rejected, and `49` by `mm` → rejected → EMPTY
 *   "Ultra 2 2024"  → `2` is followed by a space and no unit → kept
 * ⛔ `(?!\s?mm)` ALONE IS NOT A GUARD — IT BACKTRACKS, and my first two attempts shipped exactly
 * that. A negative lookahead sits after a GREEDY quantifier, so when it fails the engine simply
 * matches fewer digits and re-tests: "Series 44mm" failed on `44`, backtracked to `4`, found `4`
 * is not followed by "mm", and answered "Apple Watch Series 4" — a phantom, the very bug this file
 * exists to kill. Same for "Galaxy Watch 47mm" → "Galaxy Watch 4".
 * ✅ `(?!\d)(?!\s?mm)` closes it: the shorter run is rejected because a DIGIT follows it. That pair
 * must appear together on every numeric branch — `WATCH_NUM` only escaped the bug because its
 * single `\d` left nothing to backtrack into.
 * ⚠️ AND MY TESTS HID IT: they asserted `not.toBe('Galaxy Watch 47')`, which passes happily when the
 * answer is the equally-wrong 'Galaxy Watch 4'. A negative assertion is not a test of a parser.
 * They assert exact values now.
 *
 * ⚠️ `SE(?!ries)` — NOT `SE\b`. "SE" matches the "Se" of "Series", so a title whose Series branch
 * correctly declined a measurement fell through and answered "Apple Watch SE". But `\b` was the
 * wrong fix: it also rejects the compact "Apple Watch SE2", which the old pattern accepted.
 * Excluding the one literal collision keeps both true.
 *
 * ⚠️ THE GALAXY PATTERN GETS THE `mm` LOOKAHEAD AND NOTHING ELSE. "Galaxy Watch 47mm" is the same
 * defect one brand over, and no live listing hits it today — but the guard is free here: measured
 * over all 9,773 stored models, adding it changes zero additional rows, because the letter tail and
 * the word boundary (the parts that caused 60 rows of churn) are deliberately NOT included. */
const WATCH_NUM = String.raw`\d(?!\d)(?!\s?mm)`

export const MODEL_RES: RegExp[] = [
  /**
   * ⛔ NOT EVERY iPhone HAS A NUMBER, AND THE PATTERN BELOW REQUIRES ONE. Measured 2026-09-19
   * against a partner-shop probe: `modelFor('iPhone Duo 256GB …')` returned NULL, and so did
   * `iPhone Air` — two products Apple actually sells and this catalogue actually carries (24 live
   * `iPhone Air` rows). The numeric pattern needs a digit straight after "iPhone", so a named model
   * falls through it silently and imports with `model = null`.
   *
   * ⚠️ AND A NULL MODEL IS NOT A COSMETIC GAP — it is what the per-model landing pages query on.
   * `/iphone-duo-vietnam` selects `model: { in: ['iPhone Duo'] }`, so every Duo imported from a
   * partner shop would have been invisible on the page built to sell it, with nothing anywhere
   * reporting a problem.
   *
   * ⚠️ FIRST IN THE LIST, because the numeric pattern cannot match these anyway and a named model
   * must never be shadowed by a looser rule added later.
   *
   * ⛔ IT SWALLOWS AN OPTIONAL NUMBER BEFORE `Duo|Fold`, AND ALL THREE REVIEW SEATS CAUGHT WHY. The
   * foldable's own page copy says Vietnamese retailers write it three ways — "iPhone Duo",
   * "iPhone Fold" and "iPhone 18 Fold" — and the first cut only matched the first two. "iPhone 18
   * Fold" fell through to the NUMERIC rule and came out as plain `iPhone 18`, so a 65-million-đồng
   * foldable would have landed in the iPhone 18 price table AND been invisible on the Duo page. The
   * page predicted the string and the pattern did not accept it.
   *
   * ⚠️ AND THE TRAILING `\b` IS LOAD-BEARING: without it `iPhone AirPods` captures "iPhone Air".
   * `Air` followed by `P` is not a word boundary, so the guard costs nothing and closes it.
   */
  /**
   * ⚠️ THE OPTIONAL GENERATION DIGIT IS FENCED OFF FROM THE STORAGE TIER, and the first cut was
   * not: `(?:\s?\d{1,2})?` happily ate the "25" of "256GB" and answered `iPhone Duo 25`. The
   * lookaheads say "a generation number is one or two digits that are NOT the start of a longer
   * number and NOT a capacity" — so "iPhone Air 256GB" is `iPhone Air`, while a future
   * "iPhone Air 2 256GB" still resolves to `iPhone Air 2`.
   */
  /\b(iPhone\s?(?:\d{1,2}\s?)?(?:Duo|Fold)|iPhone\s?Air(?:\s?\d{1,2}(?!\d)(?!\s?[GT]B))?)\b/i,
  /\b(iPhone\s?\d{1,2}(?:\s?Pro\s?Max|\s?Pro|\s?Plus|\s?Mini|e)?)/i,
  /\b(Galaxy\s(?:Z\s)?(?:Fold|Flip|Note|Tab|Watch|Buds)?\s?[A-Z]?\d{1,3}(?!\d)(?!\s?mm)(?:\s?Ultra|\s?Plus|\s?FE)?)/i,
  /\b(MacBook\s(?:Air|Pro)(?:\s?M\d)?)/i,
  /\b(iPad(?:\s(?:Pro|Air|Mini))?(?:\s?M\d)?)/i,
  new RegExp(String.raw`\b(Apple\sWatch\s(?:Series\s\d+(?!\d)(?!\s?mm)|Ultra(?:\s?${WATCH_NUM})?|SE(?!ries)(?:\s?${WATCH_NUM})?))`, 'i'),
  /\b(AirPods(?:\s(?:Pro|Max))?\s?\d?)/i,
  /\b(Redmi\s(?:Note\s)?\d{1,2}[A-Za-z]?)/i,
  /\b(Xiaomi\s\d{1,2}[A-Za-z]?)/i,
]

/** Spellings the feed uses inconsistently, mapped to one display form. */
export const MODEL_CASE: [RegExp, string][] = [
  /**
   * ⛔ THREE SPELLINGS, ONE PHONE. Apple sells the foldable as "iPhone Duo"; Vietnamese retailers
   * also write "iPhone Fold" and "iPhone 18 Fold". A model column holding all three splits one
   * product across three pages that each query a literal, so they collapse here — the same job this
   * list already does for casing. ⚠️ FIRST, so the generic `^iphone` rule below cannot claim them.
   */
  [/^iphone\s?(?:\d{1,2}\s?)?(?:duo|fold)$/i, 'iPhone Duo'],
  [/^macbook/i, 'MacBook'], [/^iphone/i, 'iPhone'], [/^ipad/i, 'iPad'],
  [/^airpods/i, 'AirPods'], [/^apple watch/i, 'Apple Watch'], [/^galaxy/i, 'Galaxy'],
  [/^redmi/i, 'Redmi'], [/^xiaomi/i, 'Xiaomi'],
]

export function modelFor(name: string): string | null {
  for (const re of MODEL_RES) {
    const m = name.match(re)
    if (!m) continue
    const raw = m[1].replace(/\s+/g, ' ').trim()
    // ⚠️ WORD-CASE FIRST, CANONICAL HEAD SECOND — the other order lowercases the canonical form it
    // just applied and turns "MacBook Pro" back into "Macbook Pro", which is the exact split this
    // function exists to prevent. Caught by running both spellings through it.
    const cased = raw.split(' ').map((w) => /^(M\d|SE|FE)$/i.test(w) ? w.toUpperCase()
      : /^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
    for (const [head, canon] of MODEL_CASE) {
      if (head.test(cased)) return cased.replace(head, canon)
    }
    return cased
  }
  return null
}
