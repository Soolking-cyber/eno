import { rentalPeriodOfUnit } from '@/lib/taxonomy'
import { dropEmployerTail } from '@/lib/card-title'
import { detectContentLang } from '@/lib/detect-lang'

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

/** Two names are one name: Unicode form, spacing and case aside. */
const sameName = (a: string, b: string) => {
  const k = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
  return k(a) !== '' && k(a) === k(b)
}

export type HeadingText = { title: string; titleVi: string | null; i18n: Record<string, string> | null }

/**
 * ⛔ A LINKED JOB'S H1 IS THE ROLE ONLY — WHERE THE STOREFRONT IS THE EMPLOYER (UI climb batch 95, owner-approved 2026-11-14,
 * decision 3, "the job page says it once"; mock variants13/d2c3). The importer titles a linked job "<role> — <employer>"
 * (job-listing.ts), and on an employer-site board (Nord Anglia, Inspired, FPT…) the storefront link right under the buy box
 * names the same employer, so the H1 said it twice. The cut, or null for "print the title as stored", when ALL hold:
 *   · `employer` (attributes.employer) is a string and IS the storefront's name (NFC, spacing and case aside) — the mock's own
 *     rule. ⛔ An aggregator (LinkedIn, TEAST, CareerLink…) keeps "<role> — <employer>": its link can only truthfully name the
 *     BOARD, so the H1 is the one place the employer is named. RMIT ("… LLC" against "RMIT University Vietnam") keeps it too;
 *   · the importer's exact " — <employer>" tail is there and leaves two words or more (card-title.ts dropEmployerTail, the
 *     job card's own cut — never a "[Job opening]" tag, never a word the source wrote);
 *   · the cut does not change the language detectContentLang reads, so the localisation path the H1 takes is the same.
 * The stored Vietnamese title and every embedded translation go through the same cut; one whose tail is not exact keeps its
 * full text (the harmless direction). The page's <title>, share and og titles, crumb and JSON-LD keep the full title, and
 * the Details "Employer" row is still decided on the full heading (headingNamesEmployer).
 */
export function roleOnlyHeading({ title, titleVi, i18n, employer, storefront }: {
  title: string
  titleVi: string | null | undefined
  i18n: Record<string, string> | null | undefined
  employer: unknown
  storefront: string
}): HeadingText | null {
  if (typeof employer !== 'string' || !sameName(employer, storefront)) return null
  // The card's spelling of the name (serialize.ts cardJobFacts), so the card and the page cut alike.
  const name = employer.replace(/\s+/g, ' ').trim()
  const cut = dropEmployerTail(title, name)
  if (cut === title || detectContentLang(cut) !== detectContentLang(title)) return null
  return {
    title: cut,
    titleVi: titleVi ? dropEmployerTail(titleVi, name) : null,
    i18n: i18n ? Object.fromEntries(Object.entries(i18n).map(([lang, t]) => [lang, typeof t === 'string' ? dropEmployerTail(t, name) : t])) : null,
  }
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
