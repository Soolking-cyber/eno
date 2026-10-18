import { intlLocale, isMtLanguage } from '@/lib/i18n/langs'
import { priceUnitSuffix } from '@/lib/price-unit'
// Money formatting. Across the app we show the FULL grouped amount everywhere
// (cards, detail, input, offers) — but the SEPARATORS follow the viewer's
// language. Vietnamese convention is the exact reverse of English: DOT for
// thousands, COMMA for decimals. The currency mark is "đ" in EVERY language.
//
// ⚠️ "đ", NOT "VND", FOR ENGLISH TOO — owner, 2026-09-13: "vietnamese price shows in đ not VND",
// pointing at a Facebook Marketplace grid that renders "2,250,000 đ" under an English UI. This
// used to print "12,000,000 VND" for every non-Vietnamese viewer on the theory that the ISO code
// read clearer to expats; the owner's call is that the local mark is what the market uses and what
// a shopper in Vietnam actually sees on a price tag. It also buys width: " VND" is 4 characters on
// a card price line that its own comments document as being at its width limit.
// Only the MARK changed — English keeps comma grouping ("12,000,000 đ"), Vietnamese keeps dots
// ("12.000.000 đ"). parseVnd still accepts "VND" because pasted and legacy text carries it.
// ⚠️ ONE PRICE LINE DROPS THE MARK: a Vietnamese card's per-unit price in millions, "8,5 triệu / tháng"
// (owner, 2026-10-18 — compactVnd, RATE_COMPACT_VND below). It is the owner's explicit exception for that
// form, not a retreat from this rule: every full figure, the tỷ scale ("1,2 tỷ đ") and every other language
// keep "đ". (The map pins' "51tr" / "51M", compactPrice, never carried a mark.)

export type MoneyLocale = 'en' | 'vi'

const EN = new Intl.NumberFormat('en-US') // comma thousands separator
const VI = new Intl.NumberFormat('vi-VN') // dot thousands separator

/** Narrow the active UI language (useLanguage().lang) to a money locale:
 *  Vietnamese gets native separators, every other language keeps the
 *  international 'en' style. */
export function moneyLocale(lang: string): MoneyLocale {
  return lang === 'vi' ? 'vi' : 'en'
}

// Grouping only differs by locale; decimal handling is done by callers (money
// amounts are always whole VND).
function group(n: number, locale: MoneyLocale): string {
  return (locale === 'vi' ? VI : EN).format(n)
}

/** Full grouped amount. en: "12,000,000 đ" / "$1,200". vi: "12.000.000 đ"
 *  (space before đ); the rare non-VND listing keeps its symbol prefix with
 *  vi grouping. */
export function formatMoneyFull(price: number, currency: string, locale: MoneyLocale = 'en'): string {
  const amount = group(Math.round(price), locale)
  if (currency === '₫') return `${amount} đ`
  return `${currency}${amount}`
}


/** "3,000,000 VND" — the ISO-coded form, for text read OUTSIDE the market: payment-provider line items
 *  a dispute analyst reads (visa/payments.ts). Every on-site price uses formatMoneyFull's "đ" instead;
 *  this exists so that change did not silently reach a Stripe/PayPal description. */
export function formatVndIso(price: number): string {
  return `${group(Math.round(price), 'en')} VND`
}

/** USD amount from cents — the rare USD fee (e.g. the visa service fee). Currency
 *  style with the viewer's separators: "$25.00" (en) / "25,00 US$" (vi). */
export function formatUsdCents(cents: number, locale: MoneyLocale = 'en'): string {
  return new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

/** Price-drop badge label: "−12%", capped at "−50%+" (honest-display rule — beyond
 *  50% we stop advertising a bigger number). null when not a real drop. Shared by
 *  the server rules engine (notification copy) and the client badges so the % a
 *  buyer sees is ALWAYS the same figure everywhere. */
export function dropPercent(fromPrice: number, toPrice: number): string | null {
  if (!(fromPrice > 0) || toPrice >= fromPrice) return null
  const ratio = 1 - toPrice / fromPrice
  // Cap on the UNROUNDED ratio, not the rounded pct — otherwise a true 49.5–49.99%
  // drop rounds to 50 and shows "-50%+" ("at least 50% off"), overstating the deal.
  if (ratio >= 0.5) return '-50%+'
  const pct = Math.round(ratio * 100)
  return pct < 1 ? null : `-${pct}%`
}

/** Digits-only number from a typed string ("12,000,000" → 12000000). */
export function parseVnd(input: string): number {
  const digits = (input || '').replace(/\D/g, '')
  return digits ? parseInt(digits, 10) : 0
}

/** Group raw digits for live input display: "12000000" → "12,000,000" (en) /
 *  "12.000.000" (vi). parseVnd round-trips both (it strips all non-digits). */
export function groupVnd(input: string, locale: MoneyLocale = 'en'): string {
  const digits = (input || '').replace(/\D/g, '')
  return digits ? group(parseInt(digits, 10), locale) : ''
}

// One decimal max, trailing ".0" dropped: 12 → "12", 12.5 → "12.5" (en) /
// "12,5" (vi — comma decimal).
function short(n: number, locale: MoneyLocale = 'en'): string {
  const r = Math.round(n * 10) / 10
  const s = Number.isInteger(r) ? String(r) : r.toFixed(1)
  return locale === 'vi' ? s.replace('.', ',') : s
}

/**
 * Compact VND label for MAP PINS ONLY — the single sanctioned exception to the
 * full-grouped format (pins are too narrow for "51,000,000 đ"). en keeps the
 * explicit international suffixes ("850K", "51M", "1.2B") — the Vietnamese
 * shorthand is opaque to the expat audience — while vi uses the native
 * abbreviations every local reads instantly: "500k", "51tr", "1,2 tỷ".
 */
export function compactPrice(n: number, locale: MoneyLocale = 'en'): string {
  if (locale === 'vi') {
    if (n >= 1_000_000_000) return `${short(n / 1_000_000_000, 'vi')} tỷ`
    if (n >= 1_000_000) return `${short(n / 1_000_000, 'vi')}tr`
    if (n >= 1_000) return `${Math.round(n / 1_000)}k`
    return VI.format(n)
  }
  if (n >= 1_000_000_000) return `${short(n / 1_000_000_000)}B`
  if (n >= 1_000_000) return `${short(n / 1_000_000)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return EN.format(n)
}

/** Compact COUNT label (views, saves, followers…): 1200 → "1.2k" (en) /
 *  "1,2k" (vi); millions "3.4M" (en) / "3,4tr" (vi). Not for money — prices
 *  use formatMoneyFull/compactPrice. */
export function formatCount(n: number, locale: MoneyLocale = 'en'): string {
  if (n >= 1_000_000) return `${short(n / 1_000_000, locale)}${locale === 'vi' ? 'tr' : 'M'}`
  if (n >= 1_000) return `${short(n / 1_000, locale)}k`
  return group(n, locale)
}

/** A full, grouped integer for prose and counts: en "63,730", vi "63.730". Not money (no mark) and
 *  never compact — that is `formatCount`'s "63.7k" chip label. The separators are money's, so one
 *  page never groups two numbers two ways (docs/design-language.md §7). */
export function formatInteger(n: number, locale: MoneyLocale = 'en'): string {
  return group(Math.round(n), locale)
}

/** Average-rating label, always one decimal: 4.8 → "4.8" (en) / "4,8" (vi). */
export function formatRating(n: number, locale: MoneyLocale = 'en'): string {
  const s = n.toFixed(1)
  return locale === 'vi' ? s.replace('.', ',') : s
}

/**
 * THE SECOND SANCTIONED EXCEPTION TO THE FULL-GROUPED FORMAT (break-ui, 2026-10-05, owner-approved):
 * at or above HUGE_VND a NARROW surface — a feed card, a dashboard row, the chat's item strip — shows the
 * amount in words, "95 tỷ đ" / "95 billion đ". Measured at 320px: the API's ceiling (1e12) painted
 * "1.000.000.000.000" straight into the neighbouring card's price, and the chat strip could only
 * truncate it. Ten billion đồng is where Vietnamese property prices are already spoken in tỷ, so the
 * words are how the amount is read anyway; the detail page (PDP) keeps every digit.
 */
export const HUGE_VND = 10_000_000_000
/**
 * In the reader's OWN scale words: "95 tỷ đ", "95 billion đ", "950亿 đ", "95 milliards đ" — the nine non-vi/en UI
 * languages must not read English "billion" (codex, 2026-10-05).
 * ⚠️ vi AND en ARE HAND-BUILT, NOT Intl compact notation: they are the two languages the server renders, and
 * ISR bakes the cards at build time — Node's ICU and the browser's CLDR need not agree on compact-long output
 * (NBSP vs U+202F, plural forms), which would be a hydration mismatch (opus). Plain decimal formatting is
 * stable across both. The MT languages render client-side after mount, so Intl compact is safe for them.
 * Exact to the million in every scale: three decimals of a tỷ/billion; six for Intl (Thai counts in หมื่นล้าน
 * = 1e10 and Hindi in खरब = 1e11). Price calls this only for a whole number of millions; an odd figure is
 * rounded first and marked "≈" there.
 */
// Three decimals of the scale unit — hugeVnd's tỷ/billion and compactVnd's millions share them.
const SCALED = { vi: new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }), en: new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }) }
const HUGE_FORMATS = new Map<string, Intl.NumberFormat>()
export function hugeVnd(n: number, lang: string = 'en'): string {
  if (lang === 'vi' || lang === 'en') return `${SCALED[lang].format(n / 1_000_000_000)} ${lang === 'vi' ? 'tỷ' : 'billion'} đ`
  const locale = intlLocale(lang, 'en-GB') // the MT languages' own locale (the same helper vndWords uses)
  let f = HUGE_FORMATS.get(locale)
  if (!f) { f = new Intl.NumberFormat(locale, { notation: 'compact', compactDisplay: 'long', maximumFractionDigits: 6 }); HUGE_FORMATS.set(locale, f) }
  return `${f.format(n)} đ`
}

/**
 * THE THIRD SANCTIONED EXCEPTION — A RENT ON A CARD READS IN MILLIONS (owner, 2026-10-18: "make it look super
 * professional … so we look like top marketplace"). A price quoted PER UNIT — a rent, a salary, a hire: anything
 * `priceUnitSuffix` names a unit for — of a million đồng or more prints in millions on a feed card,
 * "8.5M đ / month" / "8,5 triệu / tháng" (Chợ Tốt and Nhà Tốt print "8,5 triệu/tháng"). Summed from the shipped
 * Open Runde woff2's advance widths (Bold 16px figure, 12px "≈ $" + its 6px margin; kerning ignored):
 * "8,500,000 đ / month ≈ $332" is 211px against the 173px text column of a 390px phone, which is why all 48 of
 * 48 rental cards on /c/rentals wrapped; "8.5M đ / month ≈ $332" is 166px and fits.
 * The đồng figure still LEADS, the "≈ $" still follows (ND 340/2025 order, owner 2026-09-13), and the PDP keeps
 * every digit.
 * ⚠️ PER-UNIT ONLY. A sale price keeps the full figure the owner chose from Facebook's grid ("2,250,000 đ",
 * 2026-09-13): a goods price already fits its line — it is the "/ month" that pushed rents onto two.
 * ⛔ VIETNAMESE PRINTS NO "đ" AFTER "triệu" — "8,5 triệu / tháng" — AND THAT IS THE OWNER'S EXPLICIT EXCEPTION
 * (2026-10-18: "go on apply all recommended", accepting the before/after report's "'8,5 triệu / tháng' — fits
 * most rents at 390px, all at 412px (Chợ Tốt's form)"). The 2026-09-13 rule that a price carries "đ" holds
 * everywhere else: English "8.5M đ", the tỷ scale ("1,2 tỷ đ", hugeVnd), the nine MT languages, the price
 * input's "8,5 triệu đ" (vndWords) and every full figure, the PDP's included. Do not "restore" the mark here
 * for consistency. "triệu" already says đồng to a Vietnamese reader — the sites above, and muaban.net's
 * price_display the importers read ("25 triệu/tháng"), print none — so " đ" was 14px of Bold and no meaning.
 * Assistive tech gets the same plain text (<Price> puts no aria-label on the figure, and its "≈ $" stays
 * aria-hidden), so a Vietnamese screen reader hears "8,5 triệu / tháng", the way the market says it.
 * MEASURED in the preview, "≈ $332" after it: "8,5 triệu đ / tháng" wrapped at 390; "8,5 triệu / tháng" and
 * "15 triệu / tháng" fit the 173px column; "12,5 triệu / tháng" wraps at 390 and fits at 412 (a 184px column).
 * Summed as above: 173 / 165 / 180px — 187 / 179 / 194 with the mark, when one line at 390 held only a whole
 * single-digit rent ("9 triệu đ / tháng ≈ $351", 169px).
 * ⚠️ NOT ALL AT 412px — THE REPORT'S "ALL" WAS LOOSE (gate review, 2026-10-18). Swept over the one-decimal,
 * whole-thousand rents 1,0–99,9 triệu at ₫25,600 per $ (summed as above): at 390 the rents under 10 triệu and the
 * whole ones to 25 triệu fit ("31 triệu" too; seven, "8,8 triệu" among them, sum 0.1–0.5px over — unmeasured,
 * kerning may save them); a two-digit rent with a decimal does not ("10,5 triệu", 179px), nor, mostly, one whose
 * "≈ $" reaches four figures ("26 triệu ≈ $1,016", 175px). At 412 (a 184px column) every rent with both a decimal
 * and a four-figure "≈ $" wraps — "25,6 triệu ≈ $1,000" (192px) and up — and so does any of 100 triệu or more
 * ("100 triệu ≈ $3,906", 188px). Outside the sweep a second decimal costs ~10px ("8,55 triệu" wraps at 390,
 * "12,35 triệu" at 412) and an odd figure's "≈ " ~14px ("≈ 7,5 triệu" wraps at 412). Those put the estimate on a
 * second line — two truthful lines, never a hidden one.
 */
export const RATE_COMPACT_VND = 1_000_000
const MILLION_FORMATS = new Map<string, Intl.NumberFormat>()
/**
 * A narrow surface's compact đồng label: a tỷ and up in `hugeVnd`'s scale words ("1,2 tỷ đ", mark kept); a million
 * and up in millions, "8.5M đ" / "8,5 triệu" — the pins' "M" in English (compactPrice), `vndWords`' "triệu" in
 * Vietnamese. English keeps the mark; Vietnamese drops it after "triệu", the owner's exception of 2026-10-18
 * (RATE_COMPACT_VND above), so Price's rounded odd figure reads "≈ 8,5 triệu". The nine MT languages take Intl's
 * SHORT scale ("850万 đ", "8,5 Mio. đ"), mark kept, for the reason hugeVnd gives; short, because the long
 * "millions"/"Millionen" is as wide as the digits it replaces.
 * Exact to `compactVndStep(n)` — a thousand đồng — in every scale: three decimals of a million; FIVE for Intl,
 * because Chinese, Japanese and Korean switch to 亿/億/억 (1e8) above a hundred million and Hindi to करोड़ (1e7) —
 * with three, 999,999,000 printed "10亿". Price rounds an odd figure to the step first and marks it "≈".
 */
export function compactVnd(n: number, lang: string = 'en'): string {
  if (n >= 1_000_000_000) return hugeVnd(n, lang)
  if (lang === 'vi') return `${SCALED.vi.format(n / 1_000_000)} triệu` // no " đ": the owner's exception, above
  if (lang === 'en') return `${SCALED.en.format(n / 1_000_000)}M đ`
  const locale = intlLocale(lang, 'en-GB')
  let f = MILLION_FORMATS.get(locale)
  if (!f) { f = new Intl.NumberFormat(locale, { notation: 'compact', compactDisplay: 'short', maximumFractionDigits: 5 }); MILLION_FORMATS.set(locale, f) }
  return `${f.format(n)} đ`
}
/** The step compactVnd is exact to: three decimals of a million is a thousand đồng; of a tỷ, a million. */
export function compactVndStep(n: number): number {
  return n >= 1_000_000_000 ? 1_000_000 : 1_000
}

/**
 * The `compactAbove` a listing CARD hands <Price> — ONE value for its price AND its struck "was" price, so the
 * pair always reads in one form (price.tsx `compactAbove`):
 *   · a per-unit price of RATE_COMPACT_VND or more → RATE_COMPACT_VND: "8.5M đ / month", and the was-price
 *     (higher by definition) in the same millions;
 *   · a drop across HUGE_VND whose new price is still a tỷ or more → a tỷ, so both read in tỷ (break-ui, 2026-10-05);
 *   · anything else → HUGE_VND, the narrow-surface default.
 * ⚠️ ONE PAIR STILL MIXES FORMS, ACCEPTED AS RARE (gate review, 2026-10-18): a per-unit price that drops from a tỷ
 * or more to below one prints a struck "1,2 tỷ đ" beside "900 triệu / tháng" — different scale words (accepted with
 * the million form, 5a7d13cca) and, in Vietnamese, the mark on one side only (the tỷ words keep it, RATE_COMPACT_VND).
 * It needs a rent of a tỷ a month.
 * Here, not in price.tsx: that module is 'use client', and the server-rendered SEO tile calls this too.
 */
export function cardCompactAbove(l: { price: number; prevPrice?: number | null; priceUnit: string | null | undefined }): number {
  if (priceUnitSuffix(l.priceUnit) && l.price >= RATE_COMPACT_VND) return RATE_COMPACT_VND
  const hasDrop = l.prevPrice != null && !!dropPercent(l.prevPrice, l.price)
  return hasDrop && l.prevPrice! >= HUGE_VND && l.price >= 1_000_000_000 ? 1_000_000_000 : HUGE_VND
}

/** Readable helper under the price input: "12 million đ" / "12 triệu đ".
 *  en and vi are hand-written; the nine machine-translated languages spell the magnitude in their own
 *  words through Intl's long compact notation ("12 миллионов đ", "1200万 đ", "1.2 करोड़ đ") — the English
 *  "million" used to be the one untranslated word under the price box.
 *  ⚠️ It keeps its "đ": the card's mark-less "8,5 triệu" (compactVnd) is the owner's exception for one price
 *  line (2026-10-18), not a rule for the word. */
export function vndWords(n: number, lang: string): string {
  if (!n) return ''
  if (isMtLanguage(lang) && n >= 1_000) {
    try {
      return `${new Intl.NumberFormat(intlLocale(lang), { notation: 'compact', compactDisplay: 'long', maximumFractionDigits: 1 } /* en's one decimal (short()) */).format(n)} đ`
    } catch { /* fall through to English */ }
  }
  const locale = moneyLocale(lang)
  const vi = locale === 'vi'
  let val: number
  let word: string
  if (n >= 1_000_000_000) { val = n / 1_000_000_000; word = vi ? 'tỷ' : 'billion' }
  else if (n >= 1_000_000) { val = n / 1_000_000; word = vi ? 'triệu' : 'million' }
  else if (n >= 1_000) { val = n / 1_000; word = vi ? 'nghìn' : 'thousand' }
  else return `${group(n, locale)} đ`
  return `${short(val, locale)} ${word} đ`
}
