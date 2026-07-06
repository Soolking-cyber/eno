import { fold } from './fold'

// Single source of truth for Vietnamese phone normalization. Shared so the post
// wizard, contact gating, and (later) the verified-phone business-profile claim
// all join on the SAME canonical form — one person = one Seller, no 09…/+84… dupes.

/**
 * Canonical app form: E.164 WITH a leading '+' (e.g. "+84901234567").
 * Used as the stored Seller.phone key.
 */
export function normalizePhone(raw: string): string {
  const d = (raw || '').replace(/\D/g, '')
  if (d.startsWith('84')) return `+${d}`
  if (d.startsWith('0')) return `+84${d.slice(1)}`
  return d ? `+${d}` : ''
}

/**
 * E.164 WITHOUT the leading '+' (e.g. "84901234567"). This is the exact form
 * Supabase stores in auth.users.phone — needed to match a verified auth phone
 * against Seller.phone when claiming a business profile.
 */
export function normalizePhoneNoPlus(raw: string): string {
  return normalizePhone(raw).replace(/^\+/, '')
}

/**
 * Detects a phone number embedded in free text, so contact info stays OFF public
 * listings — buyers reach sellers in-app, which is what brings sellers back daily
 * to reply + refresh availability. Tuned for VN mobile/landline (0/+84 then a
 * 2–9 leading digit) plus a generic international +<digits>; VND prices don't
 * match (they have no 0/+84 followed by a 2–9 digit run). Shared client + server.
 */
// Separators allow spaces/dashes but NOT dots — VN prices use dot thousand-
// separators (1.080.000.000), which must not be mistaken for a phone number.
// `(?<![\d+])` on the 0/84 anchor stops it starting MID-number: without it, a model
// number ending in 0 next to a year range ("E200 2016-2020") matched as "0 2016-2020"
// and falsely blocked legit car/electronics listings. A real phone's leading 0/8 is
// never immediately preceded by another digit, so this only kills the false positive.
const EMBEDDED_PHONE_RE = /(?<![\d+])(?:\+?84|0)[\s-]?[2-9](?:[\s-]?\d){7,9}|\+\d(?:[\s-]?\d){7,}/

// Dot-separated phones (090.123.4567) — a VERY common VN format — evade the regex above
// (which excludes dots so it doesn't trip on dotted VND prices). Strip ONLY dots, then
// look for a STANDALONE VN number anchored on 0/84 (10–11 contiguous digits). The
// digit-boundary lookarounds + the 0/84 anchor keep prices out: "1.080.000.000" →
// "1080000000" (starts with 1, and any inner 0[2-9]… run is bounded by digits).
const DOTTED_PHONE_RE = /(?<!\d)(?:84|0)[2-9]\d{8}(?!\d)/

// Full-width digits (０９…) → ASCII so they can't slip past the regex.
function toAsciiDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
}

// Spelled-out digits (EN + VI, incl. no-diacritic forms). A run of 7+ in a row is
// someone dictating a number — normal listing prose never strings that many
// number-words together, so the high threshold avoids VN homonym false-positives.
const DIGIT_WORDS = new Set([
  'zero', 'oh', 'o', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'không', 'khong', 'một', 'mot', 'mốt', 'hai', 'ba', 'bốn', 'bon', 'tư', 'tu',
  'năm', 'nam', 'lăm', 'lam', 'sáu', 'sau', 'bảy', 'bay', 'bẩy', 'tám', 'tam', 'chín', 'chin',
])
function hasSpelledDigitRun(text: string): boolean {
  const tokens = text.toLowerCase().split(/[^\p{L}\p{N}]+/u)
  let run = 0
  for (const tok of tokens) {
    if (DIGIT_WORDS.has(tok)) { if (++run >= 7) return true } else run = 0
  }
  return false
}

// Folded number-word → digit, for MIXED forms ("090 một hai ba…" / "0 chín 0 1 2 3…")
// where neither the digits nor the words alone trip the checks above. ("o" dropped — too
// ambiguous a letter; "năm"/year handled by the ≥2-word gate below.)
const NUM_WORD: Record<string, string> = {
  zero: '0', oh: '0', linh: '0', khong: '0', one: '1', mot: '1', two: '2', hai: '2',
  three: '3', ba: '3', four: '4', bon: '4', tu: '4', five: '5', nam: '5', lam: '5',
  six: '6', sau: '6', seven: '7', bay: '7', eight: '8', tam: '8', nine: '9', chin: '9',
}
// A CONTIGUOUS run (broken by any real word) of digit-tokens + number-words that totals
// ≥9 digits AND includes ≥2 spelled words → a phone written in mixed/worded form. The
// "real word breaks the run" + "≥2 words" rules keep spec-soup safe: "đi 30000 km, năm
// 2018, 5 chỗ" never accumulates (km/năm/chỗ break it), and a lone "năm" can't tip a
// digit-heavy run. Pure-digit phones are already caught by the anchored regexes above.
function hasMixedNumberRun(folded: string): boolean {
  let digits = 0, words = 0
  for (const tok of folded.split(/[^a-z0-9]+/)) {
    if (/^\d+$/.test(tok)) digits += tok.length
    else if (NUM_WORD[tok] !== undefined) { digits += 1; words += 1 }
    else { digits = 0; words = 0; continue }
    if (words >= 2 && digits >= 9) return true
  }
  return false
}

/**
 * Detects a phone number embedded in free text, so contact info stays OFF public
 * listings — buyers reach sellers in-app, which is what brings sellers back daily
 * to reply + refresh availability. Catches: VN mobile/landline (0/+84 then a 2–9
 * leading digit), generic international +<digits>, full-width digits, and spelled-
 * out digit runs (EN + VI). VND prices (dot/comma thousand-separators) don't
 * match. Shared client + server.
 */
export function containsPhoneNumber(text: string | null | undefined): boolean {
  if (!text) return false
  const norm = toAsciiDigits(text)
  if (EMBEDDED_PHONE_RE.test(norm) || hasSpelledDigitRun(norm) || hasMixedNumberRun(fold(norm))) return true
  // Dotted fallback: strip dots only (keep spaces so separate numbers stay separate)
  // and check for a standalone VN number. Catches "090.123.4567" without merging a
  // dotted price that sits next to another number.
  return DOTTED_PHONE_RE.test(norm.replace(/[.·]/g, ''))
}
