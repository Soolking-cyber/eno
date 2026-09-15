/**
 * Vietnamese retail terms that machine translation gets wrong in a PRODUCT TITLE, rewritten to their
 * English trade term in the text SENT to the translator — never in the stored Vietnamese.
 *
 * Why source-side: Google Cloud Translation v2 has no glossary (that is v3 Advanced), and
 * src/lib/i18n/glossary.ts maps whole UI strings into target languages, which cannot help one noun
 * phrase inside a merchant's title. Substituting before translation is the only lever v2 leaves.
 *
 * ⚠️ EVERY ENTRY IS MEASURED, NOT ANTICIPATED. Add a term only with the listings it broke.
 *
 * ⚠️ NFC FIRST. Scraped titles arrive in both composed and decomposed forms ("ồ" can be 1 or 3 code
 * units), and a pattern written in composed form silently misses the decomposed spelling.
 */
export type ViSourceTerm = {
  /** Matched case-insensitively against the NFC-normalised title. */
  vi: RegExp
  /** What the translator receives instead. */
  en: string
  /** The known-wrong rendering, so already-translated titles can be found and repaired. */
  wrong: RegExp
  /** If the Vietnamese title matches this anywhere, the term keeps its literal meaning — leave it alone. */
  unless?: RegExp
}

export const VI_SOURCE_TERMS: readonly ViSourceTerm[] = [
  /**
   * "nước hoa hồng" is literally "rose water", and in Vietnamese cosmetics retail it means TONER.
   * Measured 2026-09-15: 11 active listings use it and all 11 are toners (Naruko, Sum37, Ohui,
   * Sắc Ngọc Khang, Hatomugi, Lá House); Google rendered two Lá House titles as the sentence "Rose
   * water helps brighten skin. Lá House … Toner".
   * ⚠️ NOT when the title says it is pure or distilled ("nguyên chất", "chưng cất") — that IS rose
   * water, and calling it toner would mislabel the product. None exist today; the guard is cheap.
   */
  {
    // FIRST occurrence only (no `g`), matching the repair: a second mention can be the real ingredient.
    vi: /nước hoa hồng/iu,
    en: 'toner',
    wrong: /\brose[\s-]?water\b/i,
    // Anywhere in the title, not just right after the phrase: "Nước hoa hồng hữu cơ nguyên chất" (organic
    // PURE rose water) put a word between them and slipped past a lookahead (external review).
    // …and not when it is PERFUME: "nước hoa" is perfume, so "Nước hoa hồng nữ Lancôme EDP" is rose perfume
    // for women, and sending it as "toner" would list a perfume as a toner with every digit intact
    // (external review).
    unless: /nguyên chất|chưng cất|eau de|parfum|perfume|\bedp\b|\bedt\b|hương thơm nữ|nước hoa hồng nữ|nước hoa hồng nam/iu,
  },
]

/** The title as it should be sent to the translator. Leaves text with no known term untouched. */
export function applyViSourceTerms(text: string): string {
  let out = text.normalize('NFC')
  for (const t of VI_SOURCE_TERMS) if (!t.unless?.test(out)) out = out.replace(t.vi, t.en)
  return out
}

/** True when an English title shows a known-wrong rendering of a term its Vietnamese contains. */
export function hasKnownMistranslation(titleVi: string, title: string): boolean {
  const vi = titleVi.normalize('NFC')
  return VI_SOURCE_TERMS.some((t) => new RegExp(t.vi.source, 'iu').test(vi) && !t.unless?.test(vi) && t.wrong.test(title))
}

/**
 * The deterministic fallback when a RE-translation is rejected by the gate: swap only the measured
 * wrong rendering for the trade term, keeping everything else the title already says.
 *
 * ⚠️ WHY A REPAIR NEEDS THIS AND A FIRST TRANSLATION DOES NOT. A rejected first translation leaves a
 * Vietnamese title — a blemish. A rejected REPAIR would leave known-wrong English in place. Measured
 * 2026-09-15: one of the two Lá House re-translations dropped its 100ml variant and was correctly
 * rejected, which without this would have kept "Rose water helps brighten skin".
 * Capitalisation follows the wrong text, so a sentence-initial "Rose water" becomes "Toner".
 */
export function repairKnownMistranslation(titleVi: string, title: string): string {
  const vi = titleVi.normalize('NFC')
  let out = title
  for (const t of VI_SOURCE_TERMS) {
    if (!new RegExp(t.vi.source, 'iu').test(vi) || t.unless?.test(vi)) continue
    // FIRST occurrence only: the measured error is one sentence-initial phrase, and a title that also
    // names real rose-water extract further on must keep it (external review).
    out = out.replace(new RegExp(t.wrong.source, 'i'), (m) =>
      m[0] === m[0].toUpperCase() ? t.en[0].toUpperCase() + t.en.slice(1) : t.en)
  }
  return out
}
