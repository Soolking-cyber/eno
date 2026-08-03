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

/**
 * Pull the FIRST phone number out of free text, in E.164 digits (no '+').
 *
 * The mirror image of containsPhoneNumber, sharing its regexes on purpose: the thing that
 * decides "this text has a number in it" and the thing that decides "…and here it is" must
 * never disagree, or a chat bubble offers a Zalo/WhatsApp button built from something that
 * was not a phone number. Returns null when there is nothing, or when what is there is not
 * dialable (a spelled-out run like "oh nine one…" is DETECTED by the gate but deliberately
 * NOT extracted — reconstructing digits from words is exactly where a wrong number comes
 * from, and a wrong number is worse than no button).
 *
 * VND prices do not match, for the same reason they do not match the gate: the dot/comma
 * thousand-separator forms are excluded by the regexes themselves.
 */
export function extractPhoneNumber(text: string | null | undefined): string | null {
  if (!text) return null
  const norm = toAsciiDigits(text)
  const direct = norm.match(EMBEDDED_PHONE_RE)?.[0]
  // Dotted VN form (090.123.4567) only after stripping dots — the same fallback, and the
  // same reason: keep spaces so two adjacent numbers cannot merge into one.
  const dotted = direct ? null : norm.replace(/[.·]/g, '').match(DOTTED_PHONE_RE)?.[0]
  const raw = direct || dotted
  if (!raw) return null
  const digits = normalizePhoneNoPlus(raw)
  // A dialable number is 8–15 digits (E.164 caps at 15). Anything outside that came from a
  // false positive, so drop it rather than render a broken deep link.
  return digits.length >= 8 && digits.length <= 15 ? digits : null
}

/** Deep links for the SAME number. Vietnamese sellers live on Zalo; foreign buyers usually
 *  have only WhatsApp — and a Vietnamese mobile works for both, so we offer both rather
 *  than making either side install an app they will never use again (owner, 2026-07-22:
 *  "since foreigners dont have zalo ad whatsapp with same number so users can request
 *  whatspp or zalo both same number"). */
export function contactLinksFor(phoneDigits: string): { zalo: string; whatsapp: string; tel: string } {
  return {
    zalo: `https://zalo.me/${phoneDigits}`,
    whatsapp: `https://wa.me/${phoneDigits}`,
    tel: `tel:+${phoneDigits}`,
  }
}

/**
 * The routing form: digits only, VN local shapes resolved to the 84 country code.
 *
 * ⚠️ THE ROUTER'S OWN NORMALIZER, LIVING HERE SO CLIENT AND SERVER CANNOT DISAGREE. It used to sit
 * in `otp-channels.ts` (server-only) while the sign-in form reached for `normalizePhoneNoPlus`
 * instead — and the two DIVERGE on a bare 9-digit mobile: '912345678' stays '912345678' under
 * normalizePhoneNoPlus but becomes '84912345678' here. Measured 2026-08-03 after both external
 * reviewers flagged the split. With no SMS fallback that mismatch is not cosmetic: the form would
 * promise WhatsApp while the server routed to Zalo, and the code would land in an app the user was
 * never told to open.
 *
 * Distinct from normalizePhone/normalizePhoneNoPlus above, which exist to MATCH a stored Supabase
 * auth phone; this one exists to CHOOSE a delivery channel. Same input, different jobs.
 */
export function normalizePhoneForRouting(raw: string): string {
  const trimmed = (raw || '').trim()
  const hadPlus = trimmed.startsWith('+')
  const d = trimmed.replace(/\D/g, '')
  if (d.startsWith('0')) return '84' + d.slice(1) // local VN form
  if (d.startsWith('84')) return d                // already canonical VN
  if (hadPlus) return d                            // explicit E.164 → its own country code
  // Bare digits: a 9-digit VN mobile typed without the leading 0 gets the prefix;
  // anything longer is a full international number delivered without '+'.
  return d.length === 9 ? '84' + d : d
}

/**
 * Is this a Vietnamese MOBILE? Takes the output of {@link normalizePhoneForRouting}.
 *
 * ⚠️ EXACTLY 11 DIGITS AND A REAL VN MOBILE PREFIX — both conditions were added 2026-08-03 after
 * codex and agy independently broke the looser version, and each rejection is a number that would
 * otherwise be routed to an app that cannot reach it:
 *   · '8431234567' — a US South Carolina number (843…) typed without a country code. 10 digits
 *     starting '84', so the old `length === 10` branch called it Vietnamese and sent an American
 *     user to Zalo. THIS is why 10 is gone: the pre-2018 stale-record case it served is rarer than
 *     the collision it created, and Supabase stores E.164 anyway.
 *   · '842438505000' — a Hanoi landline (+84 24 …). Correctly foreign-ish for our purposes: it is
 *     12 digits and cannot receive an app message at all.
 * VN mobiles since the 2018 renumbering are 84 + [3|5|7|8|9] + 8 more digits, so the prefix test
 * also rejects 84 followed by 1/2/4/6 — landline and service ranges.
 */
export function isVietnamesePhone(normalized: string): boolean {
  return /^84[35789]\d{8}$/.test((normalized || '').replace(/\D/g, ''))
}
