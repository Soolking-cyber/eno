/**
 * A narrow second opinion on gateTranslation's `entity-loss` verdict for GOOGLE output — mt-gate.ts
 * is shared with the Gemini pipeline and is deliberately left untouched.
 *
 * MEASURED 2026-09-15 on a 10-title sample: the gate rejected 7 of 10 Google translations as
 * entity-loss. Six were false alarms — the source was glued by the scrape ("42/44/45mm" arrived as
 * `424445mm`), a code glued to a Vietnamese word through a diacritic boundary ("sạc4AA…" read as
 * `c4AA…`), or Vietnamese length notation converted correctly (`1m2` → "1.2m"). One was real: a
 * selected 100ml variant dropped.
 *
 * An `entity-loss` hypothesis is accepted only if ALL of:
 *  1. The digit CHARACTERS are the same multiset — nothing added, nothing dropped.
 *  2. Every digit RUN in the translation is a substring of some digit run in the source. Reordering
 *     and splitting pass (424445 → 42, 44, 45); re-grouping does not. Rule 1 alone accepted
 *     "12V 3A" → "1V 23A" (external review): same digits, different specification.
 *  3. Every run of 2+ ASCII capitals in the source survives verbatim (model and brand codes).
 * Any OTHER gate rejection stands.
 */
export function entitiesSurvive(src: string, hyp: string): boolean {
  const chars = (t: string) => [...t.replace(/\D/g, '')].sort().join('')
  if (chars(src) !== chars(hyp)) return false
  const srcRuns = src.match(/\d+/g) ?? []
  if ((hyp.match(/\d+/g) ?? []).some((h) => !srcRuns.some((s) => s.includes(h)))) return false
  if (!(src.match(/[A-Z]{2,}/g) ?? []).every((c) => hyp.includes(c))) return false
  return unitOrderKept(src, hyp)
}

/**
 * 4. For every unit, the VALUES attached to it keep their order — whenever both sides carry that unit the
 *    same number of times. Rules 1–3 are blind to WHERE a number sits, and three review rounds produced the
 *    same class: "RAM 8GB SSD 256GB" → "RAM 256GB SSD 8GB", "12V 3A" → "3V 12A". Compared per unit, so
 *    English moving a spec across the title ("0.25mm 3D" → "3D … 0.25mm") still passes.
 *    Numbers joined by / & , or - are read as one group per unit (see UNIT_RE), so scrape glue compares equal
 *    and a swap does not. Fewer occurrences in the translation fail (a value lost its unit); more are left
 *    to rules 1–2.
 */
// ⚠️ `(?![\p{L}\p{N}])`, NOT `\b`. JavaScript's \b is ASCII-only, so in "1m2 Mới" it sees a boundary between
// "M" and "ớ" and reads "2 M" as two metres. Replayed over the day's 1,699 accepted translations, the \b
// version rejected 7 correct ones exactly that way ("1m2 Mới", "3 Trong 1 22gGói").
// ⚠️ THE NUMBER IS A GROUP: digit runs joined by / & , or - ("42/44/45mm", "8/256GB") are ONE value whose
// digits are compared as a whole. That is what lets a scrape-glued "424445mm" equal "42/44/45mm" without
// the loose tail match the previous version used — which also accepted "42mm Series 2" → "2mm Series 42",
// since "42" ends with "2" (external review). No SPACE in the joiners: "Series 9 42mm" is two facts.
// `[\s-]?` before the unit because English hyphenates a spec used as an adjective ("10.2-inch iPad").
const UNIT_RE = /((?:\d+(?:[.,]\d+)?\s?[\/&,-]\s?)*\d+(?:[.,]\d+)?)[\s-]?(mah|wh|gb|tb|mb|mm|cm|ml|kg|hz|inches|inch|w|v|a|l|g|m)(?![\p{L}\p{N}])/giu
function unitOrderKept(src: string, hyp: string): boolean {
  const byUnit = (t: string) => {
    const m = new Map<string, string[]>()
    for (const [, n, u] of t.matchAll(UNIT_RE)) {
      // "inches" is "inch": English pluralises ("85 inch" → "85 inches"), which is not a changed spec.
      // ⚠️ "g" is NOT folded into "gb" — Vietnamese writes "64G" for storage, but "1g" of saffron must never
      // be allowed to become "1GB". Those rows stay Vietnamese, which is the safe miss.
      const k = u.toLowerCase() === 'inches' ? 'inch' : u.toLowerCase(), list = m.get(k) ?? []
      // Joiners and spaces go; the DECIMAL stays. Stripping it too let "15W" equal "1.5W" — a tenfold change
      // (external review). A Vietnamese decimal comma ("1,5V") is normalised to the English point first.
      list.push(n.replace(/(\d),(\d)(?!\d)/g, '$1.$2').replace(/[^\d.]/g, '')); m.set(k, list)
    }
    return m
  }
  const a = byUnit(src), b = byUnit(hyp)
  for (const [unit, vals] of a) {
    const other = b.get(unit)
    // A unit the source states must still be stated: "12V 3A" → "12W 3A" kept every digit and every
    // position and changed the specification (external review).
    if (!other) return false
    // Fewer occurrences in the translation means a value lost its unit: "RAM 8GB SSD 256GB" → "RAM 256GB
    // SSD 8" (external review). More is the scrape-glue shape rules 1–2 already judged, so only fewer fails.
    if (other.length < vals.length) return false
    // Same count: position by position the digits must be identical. Glue has already been folded into
    // one group on both sides, so "424445" = "42/44/45"; a swap ("8"/"256", "42"/"2") cannot pass.
    if (other.length === vals.length && vals.some((v, i) => v !== other[i])) return false
  }
  return true
}

/**
 * Vietnamese category words that product names write in Title Case WITHOUT diacritics, and that a correct
 * translation therefore replaces. MEASURED, not recalled: across the 830 no-diacritic titles re-translated
 * on 2026-09-15, these were the ONLY capitalised source words missing from the English — Loa (speaker)
 * ×136, Tai [nghe] (headphones) ×118, Tivi ×52, Bao [da] (case) ×38, Balo (backpack) ×19, [Loa] Thanh
 * (soundbar) ×1. Extend it only from the same kind of measurement.
 */
const VI_NODIAC_CATEGORY_WORDS = new Set(['loa', 'tai', 'nghe', 'tivi', 'bao', 'da', 'balo', 'thanh'])

/**
 * For a title WITHOUT diacritics — a product name that is mostly brand, model and spec already — every
 * capitalised Latin word must survive the translation, apart from the measured category words above.
 *
 * ⛔ WHY THIS EXISTS: digits and codes are not the only facts in a product name. Measured: "iPad Air 2 -
 * 16GB/ Wifi + 4G (Gold)" came back "(Meta)" from a 50-title batch — same digits, no code lost, every
 * other check passed, wrong colour on a live listing. The same class produced "Sakos" → "Bag" (brand) and
 * "Victus" → "EliteBook" (model) under auto-detect.
 * ⚠️ NOT FOR TITLES WITH DIACRITICS. There, Title Case Vietnamese words without accents ("Cao", "Cho",
 * "Xanh", …) are legitimately translated away by the hundred, so this check would be noise.
 * ⚠️ A SPELLING NORMALISATION IS REJECTED TOO ("Aluminium" → "Aluminum"). That is the safe direction:
 * the row keeps its original title, it is never mislabelled.
 */
export function latinWordsSurvive(src: string, hyp: string): boolean {
  // WHOLE WORDS, case-insensitive — a substring test let "Air" survive inside "Chair" (external review).
  const words = new Set(hyp.toLowerCase().match(/[a-z0-9]+/g) ?? [])
  const titleCase = (src.match(/\b[A-Z][A-Za-z]{2,}\b/g) ?? [])
    .every((w) => VI_NODIAC_CATEGORY_WORDS.has(w.toLowerCase()) || words.has(w.toLowerCase()))
  // Two-letter brands and codes ("HP", "LG", "TP") are below the Title Case pattern's reach; runs of
  // capitals must survive VERBATIM, so "Laptop HP" → "Laptop Dell" is rejected (external review).
  const capitals = (src.match(/\b[A-Z]{2,}\b/g) ?? []).every((c) => new RegExp(`\\b${c}\\b`).test(hyp))
  return titleCase && capitals
}
