/**
 * The quality gate for machine translation output — PURE, and deliberately in its own module.
 *
 * ⛔ NO `server-only` HERE, WHICH IS THE POINT. This logic has to be reachable from Node scripts
 * (scripts/backfill-bilingual.ts translates the whole catalogue offline), and `mt-local.ts` is
 * server-only because it holds a fetch client and reads env. A pure predicate is neither, and
 * gating a 15M-character backfill with a DIFFERENT, hand-rolled copy of these rules is exactly
 * how two implementations drift until only one of them rejects hallucinations.
 */

/** Why a translation was refused — surfaced in logs so the reject rate stays observable. */
export type MtReject = 'entity-loss' | 'length-ratio' | 'boilerplate' | 'repetition' | 'empty' | 'untranslated'

/**
 * Tokens a translation MUST carry through untouched: model codes (VX2779-HD-PRO, FTKB25ZVMV),
 * mixed alphanumerics (12MXH100), and any run of 3+ digits (capacities, years, wattages).
 *
 * ⛔ A MODEL CODE CARRIES BOTH A LETTER AND A DIGIT — that lookahead pair is the whole rule, and
 * the earlier `[A-Z0-9]{2,}` version was wrong in three separate ways at once, all found in
 * review and all reproduced before changing anything:
 *  · IT MADE ORDINARY CAPITALISED WORDS MANDATORY. "BLACK TABLE" and the Vietnamese "THUN"
 *    became required tokens, so a perfectly good translation ("Bàn đen", "t-shirt") was
 *    REJECTED and sent to the paid provider — the gate spending money to punish correct work.
 *  · IT TRUNCATED REAL CODES. Allowing a single `-` captured only "VX2779-HD" of
 *    "VX2779-HD-PRO", so a hallucinated "VX2779-HD-FAKE" satisfied it.
 *  · IT MISSED LOWERCASE ENTIRELY. "ftkb25zvmv" extracted nothing, so dropping it passed.
 *
 * ⛔ A DECIMAL SPEC IS ONE ENTITY, AND IT MUST BE MATCHED FIRST. Without the leading
 * alternative, `\b` fires between the "." and the "0" of "1.0HP", so the mandatory token was
 * "0HP" — which "2.0HP" also contains. The gate happily accepted a translation that DOUBLED the
 * advertised capacity of an air conditioner (astra, reviewing this diff). Decimal specs are
 * exactly the numbers a buyer decides on.
 *
 * ⚠️ `-` CONTINUES A CODE, `/` DOES NOT. "VX2779-HD-PRO" is one token, but "1GB/Ngày" is
 * "1GB per day" — treating `/` as a joiner glued the translatable word "Ngày" onto the code and
 * then demanded the English output contain it, rejecting a correct translation.
 *
 * ⚠️ 2+ DIGITS FOR THE PURE-NUMBER CASE. This was 3+ for a while because gating two-digit
 * numbers rejected good translations — but that was the BOUNDARY's fault, not the threshold's:
 * "27 inch" → "27-inch" failed a hyphen-excluding boundary. Numbers now use a NON-DIGIT
 * boundary (see keepsEntity), so "27-inch" passes and "32-inch" does not. That closes a real
 * hole reviewers were right to keep pressing on: with two-digit numbers ungated,
 * "Màn hình 27 inch" → "32-inch monitor" carried no required entity, had a plausible ratio, and
 * passed every check — publishing the wrong screen size, permanently.
 */
/**
 * ── NUMBERS ARE COMPARED BY VALUE, NOT BY STRING ──────────────────────────────────────────────
 *
 * ⛔ AN EARLIER VERSION DID THIS WITH REGEX BOUNDARIES AND WAS WRONG IN BOTH DIRECTIONS AT ONCE.
 * Forbidding a `.`/`,` next to a protected number caught "27" → "27.5", but it also rejected
 * "Số lượng 12" → "Quantity: 12." (ordinary sentence punctuation) and "1.500.000" → "1,500,000"
 * (a CORRECT locale conversion). Allowing them accepted "500GB" → "0.500GB", a thousandfold
 * capacity change. No boundary class can separate those, because the question is not what
 * character sits next to the digits — it is whether the QUANTITY survived (codex, astra).
 *
 * So: pull the numbers out of both sides, normalise the separators, and require every source
 * quantity to still be present. "1.500.000" and "1,500,000" are the same number; "27" and "27.5"
 * are not; "12" and "12." are.
 */

/**
 * Units that are the SAME SYMBOL in every language, so a number may be checked together with
 * them. ⛔ The list is conservative on purpose: an ordinary noun unit TRANSLATES ("12 tháng" →
 * "12 months"), so pairing a number with it would reject correct work. Only symbols that survive
 * translation unchanged belong here.
 */
const STABLE_UNITS = new Set([
  'hp', 'kw', 'kwh', 'wh', 'mah', 'ah', 'gb', 'tb', 'mb', 'kb', 'ghz', 'mhz', 'khz',
  'kg', 'mg', 'ml', 'km', 'cm', 'mm', 'nm', 'rpm', 'fps', 'mp', 'mpx', 'psi', 'iso',
  // ⛔ THE SHORT ONES MATTER MOST, because they differ from their neighbours by a FACTOR OF
  // 1000. Without 'g', "Khối lượng 500 kg" → "Weight 500 g" passed: `g` was not a known unit, so
  // it counted as "no unit", and a missing unit matches anything (astra). Safe to include only
  // because the unit must now be a WHOLE WORD — see the lookahead in quantitiesIn.
  'g', 'm', 'l', 'w', 'v', 'a', 't', 'kb', 'mm2', 'm2', 'm3',
  // ⛔ NON-METRIC UNITS TOO, or they read as "no unit" and match anything: "500 kg" → "500 lb"
  // passed, a materially different advertised weight (codex, astra).
  'lb', 'lbs', 'oz', 'ft', 'in', 'yd', 'mi', 'gal', 'pt', 'qt', 'kt', 'mph', 'db',
])

/**
 * Is `raw` a real thousands grouping in this convention — 1.500.000, 1,250?
 *
 * ⛔ NO DYNAMIC REGEX HERE, DELIBERATELY. The previous version built this pattern with a template
 * literal and over-escaped it: the compiled source was `^\\d{1,3}...`, which matches a literal
 * BACKSLASH followed by `d` and therefore never matched anything. The language-aware branch was
 * dead code, so Vietnamese "1.250" (=1250) and English "1.250" (=1.25) normalised identically —
 * silently reinstating the thousandfold error this function exists to prevent, while its tests
 * passed for the wrong reason (codex, astra). Plain string work cannot fail that way.
 */
function isGrouping(raw: string, group: string): boolean {
  const parts = raw.split(group)
  if (parts.length < 2) return false
  if (!/^\d{1,3}$/.test(parts[0])) return false
  return parts.slice(1).every((p) => /^\d{3}$/.test(p))
}

/**
 * Parse one numeric literal using the SEPARATOR CONVENTION OF ITS LANGUAGE.
 *
 * ⛔ THE CONVENTIONS ARE INVERTED BETWEEN THE TWO LANGUAGES THIS MOSTLY TRANSLATES, so a
 * language-blind parser is not merely imprecise — it is wrong in the expensive direction.
 * Vietnamese "1.250" is one thousand two hundred and fifty; English "1.250" is one and a quarter.
 */
function parseNumber(raw: string, lang?: string): string {
  // ⚠️ ONLY VIETNAMESE — AND AN UNSPECIFIED LANGUAGE, WHICH IS THIS MARKETPLACE'S DEFAULT — USES
  // `.` FOR THOUSANDS. Treating every non-English language as Vietnamese made Japanese or Korean
  // "1,250" and English "1.250" normalise alike (codex); those languages group like English.
  const vi = lang === undefined || lang === 'vi'
  const group = vi ? '.' : ','
  const decimal = vi ? ',' : '.'
  let value: string
  // ⛔ GROUPING AND A DECIMAL CAN APPEAR TOGETHER — "1.500,50" in Vietnamese, "1,500.50" in
  // English. Handling only one or the other left those unparseable, so a CORRECT conversion
  // between the two shared no normalised value and was rejected (codex).
  if (raw.includes(group) && raw.includes(decimal)) {
    const cut = raw.lastIndexOf(decimal)
    const whole = raw.slice(0, cut)
    const frac = raw.slice(cut + 1)
    value = isGrouping(whole, group) ? `${whole.split(group).join('')}.${frac}` : raw
  } else if (isGrouping(raw, group)) {
    value = raw.split(group).join('') // real grouping — the separators are noise
  } else {
    // ⛔ NOT A VALID GROUPING ⇒ THE SEPARATOR IS A DECIMAL POINT, whichever character it is.
    // Stripping the group separator unconditionally turned the Vietnamese-parsed "1.0" into
    // "10", so "1.0HP" and "10HP" compared equal and a faithful translation was REJECTED.
    value = raw.split(group).join('.').split(decimal).join('.')
  }
  value = value.replace(/\.$/, '')
  const n = Number(value)
  return Number.isFinite(n) ? String(n) : value
}

/** One quantity found in a string: its value in both separator conventions, its raw literal,
 *  and its unit when that unit is a symbol translation leaves alone. */
type Quantity = { values: Set<string>; raw: string; unit: string }

/**
 * Every quantity in `text`. `requireTwoDigits` applies to the SOURCE only — see the note below.
 *
 * ⛔ BOTH CONVENTIONS ARE RECORDED, plus the raw literal, because a translator has several
 * FAITHFUL choices and rejecting the ones we did not predict is expensive on a 15M-character
 * backfill. A model very often echoes "1.500.000" verbatim instead of re-localising it to
 * "1,500,000": the digits are unchanged, so that is a cosmetic nit, not a wrong price. A real
 * SUBSTITUTION still shares no representation at all — "1.0" has nothing in common with "2.0".
 */
function quantitiesIn(text: string, lang?: string, requireTwoDigits = true): Quantity[] {
  const out: Quantity[] = []
  // ⚠️ `(?!\p{L})` MAKES THE UNIT A WHOLE WORD. Without it, "500 gói" (500 packs) captured "g"
  // and paired the quantity with a mass unit that was never written. That guard is what makes
  // the single-letter units above safe to recognise at all.
  for (const m of text.matchAll(/(\d+(?:[.,]\d+)*)\s*([A-Za-z]{1,4})?(?!\p{L})/gu)) {
    const raw = m[1]
    // ⚠️ SINGLE DIGITS ARE DELIBERATELY UNGATED IN THE SOURCE, and reviewers are right it is a
    // real gap: "Bộ 2 ghế" → "Set of 8 chairs" passes. Gating them is worse — rendering a numeral
    // as a WORD is correct behaviour ("Set of two chairs"), so every "1" and "2" in ordinary prose
    // becomes a tripwire. The gap is recorded, not closed badly.
    //
    // ⛔ COUNT DIGITS IN THE RAW MATCH, NOT THE NORMALISED VALUE. Normalising "1.0" to "1" left
    // one digit, so it was dropped and "1.0HP" → "2.0 HP" sailed through.
    //
    // ⚠️ AND THE THRESHOLD IS ASYMMETRIC: the HYPOTHESIS is searched exhaustively, because a
    // source "1.0 HP" normalises to 1 and the faithful output "1 HP" would otherwise be discarded
    // as a single digit before the comparison ever saw it (astra).
    if (requireTwoDigits && raw.replace(/[^0-9]/g, '').length < 2) continue
    const unit = (m[2] || '').toLowerCase()
    out.push({
      // ⛔ THIS SIDE'S CONVENTION ONLY, PLUS THE RAW LITERAL. Recording the OTHER convention's
      // reading too made both sides so permissive that real errors matched: English "0.500GB"
      // reads as 500 under Vietnamese grouping, so it satisfied a source "500GB" — a
      // thousandfold change; and an English source "1.250" reads as 1250, so it satisfied a
      // Vietnamese "1250". Own convention + raw literal is exactly enough: a correct
      // re-localisation matches on the VALUE, a verbatim echo matches on the RAW, and a
      // substitution matches on neither.
      values: new Set([parseNumber(raw, lang), raw]),
      raw,
      unit: STABLE_UNITS.has(unit) ? unit : '',
    })
  }
  return out
}

/**
 * Is every quantity in `src` still present in `hyp`?
 *
 * ⛔ A GREEDY ONE-TO-ONE MATCH, not set membership. A set let one surviving "12" satisfy BOTH
 * halves of "12 x 12 cm" (codex), so each hypothesis quantity is consumed at most once.
 *
 * ⛔ AND THE UNIT MUST NOT HAVE MOVED. Comparing bare values only, "1.0HP, công suất 2.0kW" →
 * "2.0HP, power 1.0kW" matched — both sides contain a 1 and a 2, with capacity and power simply
 * traded (astra). Two STABLE units that differ therefore block a match. A missing unit on either
 * side still matches, because "12 tháng" → "12 months" legitimately loses the symbol into a
 * translated word.
 */
function keepsQuantities(srcQ: Quantity[], hypQ: Quantity[]): boolean {
  const used = new Array(hypQ.length).fill(false)
  for (const s of srcQ) {
    const i = hypQ.findIndex((h, idx) => {
      if (used[idx]) return false
      if (s.unit && h.unit && s.unit !== h.unit) return false
      for (const v of s.values) if (h.values.has(v)) return true
      return false
    })
    if (i < 0) return false
    used[i] = true
  }
  return true
}

/**
 * Alphanumeric model codes — the other thing a translation must carry verbatim.
 *
 * ⛔ THE LETTER AND THE DIGIT MAY LIVE IN DIFFERENT HYPHEN SEGMENTS. Requiring the FIRST segment
 * to contain both meant "AB-1234" was never captured as a code — the integer rule took "1234"
 * alone, so "Mẫu AB-1234" → "Model CD-1234" passed and pointed at a different product (codex).
 * Candidates are matched loosely and filtered in code, which is clearer than a regex that tries
 * to express "contains both, anywhere".
 */
function codesIn(text: string): string[] {
  const out: string[] = []
  // ⛔ `/` IS BOTH A JOINER AND A SEPARATOR, AND THE DIFFERENCE IS WHAT FOLLOWS IT. "AB/1234" is
  // one model code, so joining only on `-` left just "1234" protected and "CD/1234" passed as
  // the same product (codex). But "1GB/Ngày" is "1GB PER DAY" — joining there glued a
  // translatable Vietnamese word onto the code and then demanded the English output contain it,
  // rejecting a correct translation. The rule that separates them: cross a `/` only when the
  // next segment CONTAINS A DIGIT. `.` is never a joiner — it ends sentences.
  for (const m of text.matchAll(/\b[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+|\/[A-Za-z0-9]*[0-9][A-Za-z0-9]*)*\b/g)) {
    const tok = m[0]
    if (tok.length < 3) continue
    // ⛔ THE TAIL OF A DECIMAL IS NOT A MODEL CODE. In "1.0HP" the `.` breaks the token, so "0HP"
    // was extracted as a code — and the faithful normalisation "1 HP" does not contain it, so a
    // CORRECT translation was rejected (codex, astra). The quantity check already protects
    // "1.0HP" properly; a fragment preceded by `<digit>.` is that same number, not an identifier.
    if (/[0-9][.,]$/.test(text.slice(0, m.index))) continue
    if (!/[A-Za-z]/.test(tok) || !/[0-9]/.test(tok)) continue
    out.push(tok)
  }
  return out
}

function keepsCode(hyp: string, code: string): boolean {
  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')
  // ⛔ A SEPARATOR TERMINATES A CODE UNLESS THAT CODE CONTAINS IT. A joiner must not act as a
  // terminator — otherwise "VX2779-HD-PRO-FAKE" satisfies "VX2779-HD-PRO", a different model.
  // But excluding all three separators unconditionally broke the opposite case: "1GB" contains
  // no slash, and in "1GB/day" the slash is an ordinary boundary, so a blanket exclusion
  // rejected a correct translation. Derive the exclusion from the code in hand.
  // ⛔ A HYPHEN NEVER TERMINATES A CODE, whether or not this code contains one: making the
  // exclusion fully dynamic let "VX2779" be satisfied by "VX2779-FAKE", a different model
  // (astra — a regression the blanket version did not have). `/` and `_` DO terminate unless the
  // code contains them, because "1GB" in "1GB/day" is an ordinary boundary and excluding the
  // slash there rejected a correct translation.
  // ⛔ `-` AND `_` NEVER TERMINATE A CODE, whether or not this code contains one: making the
  // exclusion fully dynamic let "VX2779" be satisfied by "VX2779-FAKE" and then by
  // "VX2779_FAKE" — a different model passing the one check meant to catch that (astra, twice).
  // `/` stays conditional, because "1GB" contains no slash and in "1GB/day" the slash is an
  // ordinary boundary; excluding it there rejected a correct translation.
  // ⛔ `/` IS A BOUNDARY ONLY WHEN IT IS NOT ACTING AS A JOINER, and codesIn joins across a
  // slash exactly when a DIGIT follows it. A blanket exclusion rejected "1GB" in "1GB/day"; a
  // blanket allowance let "VX2779" be satisfied by "VX2779/2", a different model (astra). So the
  // rule mirrors codesIn: a slash may end a code unless the next character is a digit.
  const notJoined = String.raw`(?![A-Za-z0-9\-_])(?!\/[0-9])`
  const notJoinedBefore = String.raw`(?<![A-Za-z0-9\-_])(?<![0-9]\/)`
  // ⚠️ Optional whitespace at digit↔letter transitions, because MT standardly writes "1.0HP" as
  // "1.0 HP" and "500GB" as "500 GB". Only there — stripping whitespace from the haystack would
  // glue the code to the words either side and destroy the boundary.
  const flexible = escape(code).replace(/(?<=[0-9])(?=[A-Za-z])|(?<=[A-Za-z])(?=[0-9])/g, '\\s*')
  return new RegExp(`${notJoinedBefore}${flexible}${notJoined}`, 'i').test(hyp)
}

/**
 * ANY Vietnamese diacritic, not only the language-exclusive ones.
 *
 * ⚠️ THE EXCLUSIVE SET IS THE WRONG TEST HERE, and using it silently disabled the echo check for
 * ordinary rows: "Áo thun nam" carries only an acute accent — shared with French — so it was not
 * "provably Vietnamese" and its echo went unflagged. For THIS question the broad set is right:
 * whatever language it is, an English translation of a diacriticked phrase is not the identical
 * diacriticked phrase. (The exclusive set exists for detectContentLang, which answers a different
 * question and must never mislabel.)
 */
const VI_MARK =
  /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]/

/**
 * Did the model just hand back the input?
 *
 * ⛔ AN ECHO IS THE ONE FAILURE THE BACKFILL EXISTS TO REMOVE. scripts/backfill-bilingual.ts
 * MOVES Vietnamese out of the English column; if the model returns it unchanged and the gate
 * accepts, the script writes Vietnamese into the English slot and marks the row done —
 * recreating the defect AND putting the row beyond its own selection predicate. Nothing else
 * catches it: ratio exactly 1, every entity trivially intact, no boilerplate (astra).
 *
 * ⚠️ BUT AN IDENTICAL OUTPUT IS OFTEN CORRECT. "iPhone 15 Pro" is "iPhone 15 Pro" in every
 * language, and flagging it would leave every brand-and-model title permanently unenriched and
 * re-selected on every run (codex and astra). So an echo only counts as a failure when the
 * SOURCE carries a Vietnamese-exclusive letter and the target is not Vietnamese — i.e. when we
 * can PROVE the text needed to change and did not.
 */
function isEcho(src: string, hyp: string, target?: string): boolean {
  // ⛔ SYMMETRIC. An earlier version returned false outright for a Vietnamese target, so
  // "Black table" → "Black table" was accepted and untranslated ENGLISH could be written into
  // the Vietnamese column — the mirror of the bug this check exists to stop, and the backfill
  // runs EN→VI jobs too (codex, astra). Translating INTO Vietnamese must produce a diacritic;
  // translating OUT of it must remove one.
  // ⚠️ NFC FIRST. VI_MARK lists PRECOMPOSED characters, so a decomposed (NFD) source — "Áo" as
  // A + combining acute — matched nothing and its echo went unflagged, letting untranslated
  // Vietnamese into the English column (codex). Vietnamese text arrives in both forms.
  const hadMark = VI_MARK.test(src.normalize('NFC'))
  if (target === 'vi' ? hadMark : !hadMark) return false
  // ⚠️ HOW MANY WORDS IT TAKES TO BE SURE DIFFERS BY DIRECTION, because the evidence differs.
  // Out of Vietnamese, the diacritics already PROVE the text had to change, so two words is
  // enough — one diacriticked token is usually a name that legitimately survives ("Phở").
  // Into Vietnamese there is no such proof: an undiacriticked English string that comes back
  // unchanged may be untranslated English OR a brand that is identical in every language
  // ("iPhone 15 Pro", "Black table"). Only a longer phrase is safely distinguishable, so short
  // EN→VI echoes are ACCEPTED — a known, documented gap rather than a false rejection that
  // would strand every brand-titled row forever.
  const words = src.split(/[^\p{L}]+/u).filter((w) => w.length > 1)
  if (words.length < (target === 'vi' ? 4 : 2)) return false
  const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return norm(src) === norm(hyp)
}

/**
 * Fluent boilerplate a seq2seq model falls into when it loses the input. These are VERBATIM
 * openings observed in the benchmark, not guesses — each appeared on a title whose meaning was
 * entirely invented. They were produced by NLLB-600M (rejected on licence, see the server
 * header); they are kept because the failure mode is generic to the architecture, cheap to
 * test for, and impossible to detect once cached.
 */
const BOILERPLATE =
  /(is designed to be used|the following is (a|the) list|for the manufacture of|in accordance with the provisions of)/i


/**
 * Relative character density per language — how many characters that language needs to say the
 * same thing, with Latin script as 1.0.
 *
 * ⛔ A FIXED RATIO BAND CANNOT WORK ACROSS THESE SCRIPTS, IN EITHER DIRECTION. Measured on the
 * box over 60 real listing strings, the share of GOOD vi→X translations falling under a flat
 * 0.45 floor: zh-Hans 50% · ko 27% · ja 20% · ru 2% · th 0% · en 0%. Four of the five
 * EAGER_WARM_LANGS are CJK-adjacent, so a shared floor rejected roughly half of all Chinese
 * output as "collapsed" and paid Google for it — the exact spend this module exists to remove.
 *
 * ⛔ AND THE CEILING HAS THE MIRROR BUG, which a target-only table would have missed: a
 * faithful zh→en translation EXPANDS 3-5x, so a shared 2.5 ceiling rejects every Chinese- or
 * Japanese-SOURCE translation (found by agy). The band therefore has to be computed from the
 * pair — expected ratio ≈ density(target) / density(source) — not from the target alone.
 *
 * ⚠️ THE BAND IS WIDE ON PURPOSE. This is a smoke alarm for collapse and runaway repetition,
 * not a quality metric; a translation can be entirely wrong at a perfect 1.0 ratio, which is
 * why the entity and boilerplate checks carry the real load. Do not tighten it to "catch more"
 * — a false reject costs a paid call on a translation that was already good.
 */
const DENSITY: Record<string, number> = {
  'zh-Hans': 0.25,
  ja: 0.35,
  ko: 0.45,
  km: 0.6,
  th: 0.7,
}
const LATIN_DENSITY = 1.0
const density = (lang?: string) => (lang ? DENSITY[lang] : undefined) ?? LATIN_DENSITY
/** How far either side of the expected ratio still counts as plausible. */
const BAND_LOW = 0.45
const BAND_HIGH = 2.5

export function gateTranslation(src: string, hyp: string, target?: string, source?: string): MtReject | null {
  if (!hyp || !hyp.trim()) return 'empty'

  // ⚠️ BEFORE the entity checks, because an echo passes every one of them.
  if (isEcho(src, hyp, target)) return 'untranslated'

  // Every quantity in the source must still be there, by VALUE, counting repeats — parsed with
  // each side's OWN separator convention.
  if (!keepsQuantities(quantitiesIn(src, source), quantitiesIn(hyp, target, false))) return 'entity-loss'

  // Every model code must still be there, verbatim (modulo a space at a digit↔letter seam).
  if (codesIn(src).some((c) => !keepsCode(hyp, c))) return 'entity-loss'

  const expected = density(target) / density(source)
  const ratio = hyp.length / Math.max(src.length, 1)
  if (ratio < expected * BAND_LOW || ratio > expected * BAND_HIGH) return 'length-ratio'

  if (BOILERPLATE.test(hyp)) return 'boilerplate'

  // Degenerate repetition: the decoder looping on one phrase. Only meaningful once there are
  // enough words for the ratio to mean something.
  const words = hyp.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length > 8 && new Set(words).size / words.length < 0.5) return 'repetition'

  return null
}
