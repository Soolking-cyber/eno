/**
 * UI climb batch 84 (2026-11-13): a linked job's Details drop the rows its header already states. This is the one check that
 * reads text: does the heading the reader sees name the employer?
 *
 * ⛔ WHOLE WORDS, THE FULL NAME (commit review, 2026-11-13): a first cut matched the employer's first 12 characters anywhere in
 * the title, so "Ace" matched inside "Workplace", "IT" inside "Digital", and every "International …" school matched every
 * other one. Now the full name must sit in the heading with no letter or digit on either side, case- and Unicode-form-blind.
 * A name the heading does not carry in full keeps its Employer row.
 */
const WORD = /[\p{L}\p{N}]/u

export function headingNamesEmployer(heading: string, employer: unknown): boolean {
  if (typeof employer !== 'string') return false
  const name = employer.normalize('NFC').trim().toLowerCase()
  if (name.length < 2) return false
  const h = heading.normalize('NFC').toLowerCase()
  for (let i = h.indexOf(name); i >= 0; i = h.indexOf(name, i + 1)) {
    const before = i > 0 ? h[i - 1] : ''
    const after = h[i + name.length] ?? ''
    if (!WORD.test(before) && !WORD.test(after)) return true
  }
  return false
}
