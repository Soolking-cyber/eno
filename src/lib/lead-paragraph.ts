/**
 * `text` without its first paragraph when that paragraph is EXACTLY one of `leads` (character for character, the whole
 * paragraph up to the first blank line); otherwise `text` unchanged. No normalising, no fuzzy match: a lead that differs by
 * one letter keeps the paragraph. The leads are built by construction from the listing's own fields (blvck-listing.ts
 * blvckIntroSentences, UI climb batch 90). Pure and dependency-free: the listing description (a client component) uses it.
 *
 * ⛔ IT NEVER EMPTIES A TEXT. When nothing but whitespace would remain (the lead WAS the description, or only blank lines
 * follow it), the text comes back unchanged — so a Description section can never be left heading nothing, in any language,
 * any column, any cached translation. The page therefore never hides the section on this account (codex, 2026-11-14: a
 * server-side "was it only the intro?" check drew a new edge case every round — the Vietnamese column, a cached translation,
 * trailing blank lines; the rule that cannot disagree with what is shown is this one).
 */
export function withoutLeadParagraph(text: string, leads: readonly string[]): string {
  for (const lead of leads) {
    if (!lead) continue
    if (text.startsWith(`${lead}\n\n`)) {
      const rest = text.slice(lead.length + 2)
      return rest.trim() ? rest : text
    }
  }
  return text
}
