import { rentalPeriodOfUnit } from '@/lib/taxonomy'

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

/**
 * Batch 89: does the headline price already say the rental period? "Rental period: Daily" under "350,000 đ / day" says it
 * twice. Only a period that IS a unit ('hourly', 'daily', 'weekly', 'monthly') and only when it is the stored unit's own
 * (taxonomy.ts rentalPeriodOfUnit). ⚠️ 'long-term' is a chip, not a unit — "/ month" does not say "long term" — so it keeps
 * its row, and so does any period beside a bare 'VND' (no unit printed). The caller passes null for a price that prints no
 * unit (a Free one).
 */
export function periodRestatedByUnit(period: unknown, priceUnit: string | null | undefined): boolean {
  if (period !== 'hourly' && period !== 'daily' && period !== 'weekly' && period !== 'monthly') return false
  return rentalPeriodOfUnit(priceUnit) === period
}

/**
 * Batch 89: after which fact of the facts line a " · " goes, and on which widths. A fact can be PHONE-ONLY (the deposit:
 * from md the buy box's Costs shows it beside the price), so the separators are decided from the data, never left to the
 * layout: 'all' — after this fact on every width; 'phone' — after it below md only, because every fact after it is
 * phone-only (from md this fact ends the line); null — the last fact. A phone-only fact's own separator hides with it.
 */
export function factSeparators(phoneOnly: readonly boolean[]): ('all' | 'phone' | null)[] {
  return phoneOnly.map((p, i) => {
    if (i === phoneOnly.length - 1) return null
    if (p) return 'all'
    return phoneOnly.slice(i + 1).some((q) => !q) ? 'all' : 'phone'
  })
}
