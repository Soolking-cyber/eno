import { formatCalendarDay, vnCalendarDay } from './calendar-day'

/**
 * THE WORDS OF THE PROVENANCE LINE ON AN IMPORTED LISTING (SEO wave B, P1) — pure, so the server
 * render and the browser's first render print the same characters.
 *
 * ⛔ NO `Intl`, NO CLOCK. The listing page is ISR-cached for 30 days and this renders in its first
 * client pass: the date goes through `formatCalendarDay` (calendar-day.ts), which does Vietnam-time
 * string arithmetic, and nothing here reads `Date.now()`. A second formatter would be a second place
 * for the day to drift across midnight.
 *
 * ⚠️ THE COPY IS THE OWNER-APPROVED SHEET, WORD FOR WORD (CS-2, approved 2026-09-30: P1-1 to P1-6).
 * Every pair is a LITERAL English-Vietnamese call to `tr`, so scripts/gen-ui-strings.mjs harvests the English for the
 * other languages; `{site}` and `{date}` are filled in after translation and are never typed into the
 * copy. The retail machine-translation clause (P1-7) is HELD by decision P-f and is not here.
 *
 * ⚠️ NONE OF THESE WORDS VOUCHES FOR THE SOURCE: no "verified", "checked", "protected", "trusted" or
 * "partner" (import-provenance.test.ts guards it). eno.vn never vetted these sites; the line says only
 * where the ad came from and which date the reader is looking at.
 */

/** Which sentence the line uses — decided on the server by `importProvenance` (import-provenance.ts). */
export type ProvenanceKind =
  /** A rental whose source gives its own post date (Chợ Tốt Nhà, Muaban): P1-1, the source's date. */
  | 'source-date'
  /** A rental whose source gives none eno stores (Batdongsan, Rever, Honeycomb): P1-2, the import date. */
  | 'import-date'
  /** A retail item from a PARTNER_STORES shop: P1-3, no date (its price is refreshed daily). */
  | 'retail'

export type ProvenanceTr = (en: string, vi: string) => string

export type ProvenanceParts = {
  /** The text before the date — or the whole sentence when there is no date. */
  before: string
  /** The printed day ('12 Sep 2026' / '12/9/2026'), or null for a retail item. */
  date: string | null
  /** The same day as 'YYYY-MM-DD' for `<time dateTime>` — Vietnam's calendar day, like `date`. */
  dateTime: string | null
  /** The text after the date (empty in both approved sentences; kept so a translation may reorder). */
  after: string
  /** The link's visible words: "original ad" (P1-4) or "original page" (P1-5). */
  link: string
  /** The screen-reader suffix on the link (P1-6): it opens in a new tab. */
  newTab: string
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * Fill `{site}` (and nothing else) into a translated template. A FUNCTION replacer, so a `$&` or `$'`
 * in a storefront name is printed as typed rather than read as a replacement pattern.
 */
const fill = (t: string, site: string) => t.replace('{site}', () => site)

/**
 * The line's parts, in the reader's language. `iso` is ignored for a retail item.
 * ⚠️ A RENTAL WITH NO READABLE DATE GETS NO LINE (null), never "on Invalid Date" and never a wording
 * the owner did not approve. The server passes a stored timestamp, so this is a guard, not a branch.
 * ⚠️ A TRANSLATION THAT LOST A PLACEHOLDER FALLS BACK TO THE ENGLISH SENTENCE. en and vi are literal
 * pairs; the nine machine-translated languages get the English template translated, and a translator
 * can drop or translate `{site}` / `{date}` — and naming the source is the whole point of the line.
 */
export function provenanceParts(
  p: { kind: ProvenanceKind; site: string; iso: string | null },
  lang: string,
  tr: ProvenanceTr,
): ProvenanceParts | null {
  // A storefront name typed on a Mac can arrive decomposed (NFD); the approved copy is NFC, and a
  // mixed string renders the same but compares, searches and hyphenates differently.
  const site = p.site.normalize('NFC')
  const newTab = tr('(opens in a new tab)', '(mở trong tab mới)')

  if (p.kind === 'retail') {
    // The English is spelled out twice on purpose: the harvest reads only a LITERAL first argument.
    const t = tr("Source: {site}'s website", 'Nguồn: website của {site}')
    return {
      before: fill(t.includes('{site}') ? t : "Source: {site}'s website", site),
      date: null, dateTime: null, after: '',
      link: tr('original page', 'trang gốc'),
      newTab,
    }
  }

  const day = p.iso ? vnCalendarDay(p.iso) : null
  if (!day || !p.iso) return null
  const en = p.kind === 'source-date' ? 'Source: {site} · posted there on {date}' : 'Source: {site} · imported to eno on {date}'
  const t = p.kind === 'source-date'
    ? tr('Source: {site} · posted there on {date}', 'Nguồn: {site} · đăng ngày {date}')
    : tr('Source: {site} · imported to eno on {date}', 'Nguồn: {site} · đưa lên eno ngày {date}')
  const sentence = t.includes('{site}') && t.includes('{date}') ? t : en
  // Split on the placeholder, so the day is its own <time> element wherever the language puts it.
  const at = sentence.indexOf('{date}')
  return {
    before: fill(sentence.slice(0, at), site),
    date: formatCalendarDay(p.iso, lang),
    dateTime: `${day.y}-${pad2(day.m)}-${pad2(day.d)}`,
    after: fill(sentence.slice(at + '{date}'.length), site),
    link: tr('original ad', 'tin gốc'),
    newTab,
  }
}
