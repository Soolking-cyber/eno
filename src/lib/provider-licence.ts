// ── THE PROVIDER'S LICENCE ON A LICENCE-AISLE LISTING (owner, 2026-10-14) ──────────────────────────────────────────
//
// ⛔ "SELLER ENTERS" (owner, 2026-10-14). A listing in e-Visa or Legal & permits (taxonomy.ts LICENCE_CHECK_SUBCATEGORIES)
// from anyone but eno's own desk carries the provider's REGISTERED BUSINESS NAME and its LICENCE NUMBER, typed by the
// seller exactly as on the licence. eno's team compares both with the copies the provider emails (Quy chế Article 5) and
// approves the listing (src/lib/licence-stamp.ts); both are printed on the listing page; any change re-holds it.
//
// Two attribute keys, PROVIDER_LEGAL_NAME and PROVIDER_LICENCE_NO, written ONLY by the dedicated path in
// core/listings.ts. sanitizeAttributes drops them, so the generic attribute path (a 40-character cut and no screen) can
// never store them, and they are stripped from a listing that leaves the aisles. ⚠️ They are deliberately NOT in
// FREE_TEXT_ATTRIBUTES / freeTextAttributesFor: listing-enrich reads that list to decide what it may WRITE, and nothing
// but the seller's own typing may put a licence on a listing.
//
// ⛔ THE CONTACT SCREEN STAYS ON (codex #3, plan review). A free-text field printed on a public page is a contact-smuggling
// channel, so the name keeps the full phone / contact / banned-word screen plus a refusal of any 9-digit run, and the
// number gets format rules and the same screen. Both also read their DIGITS ON THEIR OWN (PHONE_IN_DIGITS, R6): a phone
// cut up by letters or slashes ('ZALO/0903/123/456') slips past the phone detector. The ONE waiver is the exact bare
// enterprise code (10 digits, or 10-3 for a branch) in Legal & permits: it has a phone number's shape, so only the
// admin's comparison with the registration certificate can catch a phone typed there — the Licence checks tab flags that
// form, nothing is public before approval, and any change re-holds. e-Visa never accepts a bare number: an international
// travel-service licence always carries letters (79-123/2019/TCDL-GP LHQT).
// ⛔ NEVER A PERSONAL ID (Opus #11): a bare 9- or 12-digit value (CMND / CCCD), a run of 11+ digits, or the words CCCD,
// CMND, căn cước, chứng minh are refused — a "number" field invites a person's ID card otherwise.
//
// Pure and client-safe: the post wizard runs these same rules as the server, so the two cannot disagree. Imports only
// ./phone, ./publish-guard, ./taxonomy and ./fold.

import { containsPhoneNumber } from './phone'
import { containsContactInfo, findBannedWord } from './publish-guard'
import { attributeBag, isLicenceCheckSlot, VISA_SUBCATEGORY_SLUG } from './taxonomy'
import { fold } from './fold'

/** The attribute key of the provider's registered business name. */
export const PROVIDER_LEGAL_NAME = 'providerLegalName'
/** The attribute key of the provider's licence (or, in Legal & permits, registration) number. */
export const PROVIDER_LICENCE_NO = 'providerLicenceNo'
/** Both keys. ⚠️ `as const`: test a plain string with `(PROVIDER_LICENCE_KEYS as readonly string[]).includes(k)`. */
export const PROVIDER_LICENCE_KEYS = [PROVIDER_LEGAL_NAME, PROVIDER_LICENCE_NO] as const

/** Refused above these lengths (too_long), never cut: a cut licence number is a different licence. The inputs carry the
 *  same maxLength. */
export const PROVIDER_LICENCE_LIMITS = { legalName: 160, licenceNo: 60 } as const

export type ProviderLicence = { legalName: string; licenceNo: string }
export type ProviderLicenceReason = 'missing' | 'too_long' | 'no_letter' | 'no_digit' | 'format' | 'personal_id' | 'contact' | 'banned'
export type ProviderLicenceProblem = { field: typeof PROVIDER_LEGAL_NAME | typeof PROVIDER_LICENCE_NO; reason: ProviderLicenceReason }

/**
 * The refusal beside `provider_licence_required` / `provider_licence_invalid` on the session routes (`message`), for the
 * native apps: their current builds still offer both aisles but send no values, and show this rather than a bare code.
 */
export const PROVIDER_LICENCE_REFUSAL = {
  en: 'e-Visa and Legal & permits listings need the provider’s registered business name and licence number. Post from the website to add them.',
  vi: 'Tin e-Visa và Giấy tờ & pháp lý cần tên doanh nghiệp đã đăng ký và số giấy phép của nhà cung cấp. Hãy đăng trên website để nhập thông tin này.',
} as const

/** One line, NFC, single spaces, trimmed; '' for anything that is not a string. The 1000-character slice only bounds
 *  the work — anything that long is refused as too_long anyway. */
function collapse(v: unknown): string {
  return typeof v === 'string' ? v.slice(0, 1000).normalize('NFC').replace(/\s+/gu, ' ').trim() : ''
}

/**
 * A label copied in front of the number ("Số: 79-123/…", "No. 01-1234/…"). ⚠️ REPEATED (`+`) so the normaliser stays
 * idempotent: a single pass over "Số: Số: 0312…" would leave one label for the next pass to strip.
 */
const COPIED_LABEL = /^(?:(?:số|so|no|number)\s*[.:]\s*)+/iu

/** The registered name as stored, compared and stamped. Idempotent. */
export function normalizeLegalName(v: unknown): string {
  return collapse(v)
}

/** The licence number as stored, compared and stamped — normalizeLegalName's rules, minus a copied label. Idempotent. */
export function normalizeLicenceNo(v: unknown): string {
  return collapse(v).replace(COPIED_LABEL, '')
}

/** The licence keys a placement carries: both in a licence aisle, none anywhere else. What the wizard keeps across an
 *  e-Visa ↔ Legal & permits switch (post-wizard-category.ts subcategoryChangeReset) and drops on any other move. */
export function providerLicenceKeysFor(categorySlug: string, subcategorySlug: string | null | undefined): readonly string[] {
  return isLicenceCheckSlot(categorySlug, subcategorySlug) ? PROVIDER_LICENCE_KEYS : []
}

const own = (bag: Record<string, unknown>, k: string): unknown => (Object.hasOwn(bag, k) ? bag[k] : undefined)

/** The two values a request body's `attributes` OBJECT carries, normalised ('' where absent); undefined when it is not a
 *  plain object at all (absent, a string, an array) — the same shapes sanitizeAttributes ignores. */
export function providerLicenceFromInput(raw: unknown): ProviderLicence | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const bag = raw as Record<string, unknown>
  return { legalName: normalizeLegalName(own(bag, PROVIDER_LEGAL_NAME)), licenceNo: normalizeLicenceNo(own(bag, PROVIDER_LICENCE_NO)) }
}

/** The values a listing's attributes hold (the JSON string a row stores, or an object), normalised — or null unless
 *  BOTH are there. */
export function providerLicenceOf(attributes: unknown): ProviderLicence | null {
  const bag = attributeBag(attributes)
  if (!bag) return null
  const legalName = normalizeLegalName(own(bag, PROVIDER_LEGAL_NAME))
  const licenceNo = normalizeLicenceNo(own(bag, PROVIDER_LICENCE_NO))
  return legalName && licenceNo ? { legalName, licenceNo } : null
}

/** Normalised, or null when both halves are empty — so "nothing typed" and "nothing stored" compare equal. */
function normalised(v: Partial<ProviderLicence> | null | undefined): ProviderLicence | null {
  if (!v) return null
  const legalName = normalizeLegalName(v.legalName)
  const licenceNo = normalizeLicenceNo(v.licenceNo)
  return legalName || licenceNo ? { legalName, licenceNo } : null
}

/** Do these say the same thing once normalised? Whitespace and NFD-vs-NFC never count as a change (no re-hold for a
 *  resend); null (or two empty halves) equals null. */
export function sameProviderLicence(a: Partial<ProviderLicence> | null | undefined, b: Partial<ProviderLicence> | null | undefined): boolean {
  const x = normalised(a)
  const y = normalised(b)
  if (!x || !y) return !x && !y
  return x.legalName === y.legalName && x.licenceNo === y.licenceNo
}

/**
 * The attributes JSON with both keys set to `v` (normalised) — or removed, for null or an empty half. Every other key is
 * untouched. The SAME string when nothing changes (so a caller can compare and skip the write); null when nothing is left.
 */
export function withProviderLicence(json: unknown, v: Partial<ProviderLicence> | null): string | null {
  const had = typeof json === 'string' ? json : json == null ? null : JSON.stringify(json)
  // A copy: attributeBag hands back the caller's own object for an object input, which must not change under them.
  const bag = { ...attributeBag(json) }
  const want: Record<string, string | undefined> = {
    [PROVIDER_LEGAL_NAME]: normalizeLegalName(v?.legalName) || undefined,
    [PROVIDER_LICENCE_NO]: normalizeLicenceNo(v?.licenceNo) || undefined,
  }
  let changed = false
  for (const k of PROVIDER_LICENCE_KEYS) {
    if (own(bag, k) === want[k]) continue
    changed = true
    if (want[k] === undefined) delete bag[k]
    else bag[k] = want[k]
  }
  if (!changed) return had
  return Object.keys(bag).length ? JSON.stringify(bag) : null
}

/** The attributes JSON without either key — withProviderLicence's contract (same string when unchanged, null when empty). */
export function withoutProviderLicence(json: unknown): string | null {
  return withProviderLicence(json, null)
}

const ENTERPRISE_CODE = /^\d{10}(?:-\d{3})?$/

/** The bare enterprise (tax) code form — 10 digits, or 10-3 for a branch. The SAME SHAPE AS A PHONE NUMBER: the admin tab
 *  flags it for a comparison with the registration certificate. */
export function isEnterpriseCodeForm(v: unknown): boolean {
  return ENTERPRISE_CODE.test(normalizeLicenceNo(v))
}

const LETTER = /\p{L}/u
/** ASCII digits on purpose: a "number" with none is refused (no_digit) rather than read through another script's digits. */
const DIGIT = /\d/
/** A run of 9+ digits, single spaces / dots / hyphens allowed between them — an ID card or a phone inside a NAME. */
const NAME_DIGIT_RUN = /\d(?:[ .-]?\d){8,}/
const NUMBER_CHARS = /^[\p{L}\p{N} ./-]+$/u
const BARE = /^[\d .-]+$/
const LONG_DIGIT_RUN = /\d{11,}/
/** A citizen-ID number written with separators ('GP 001/123/456/789'): 12 digits in all, the first a 0 (the province code
 *  001–096). A travel licence carries 9–11 (79-123/2019 → 9), so the count is safe to read as an ID (commit gate). */
const isSpacedCitizenId = (x: string): boolean => /^0\d{11}$/.test(x.normalize('NFKC').replace(/\D/g, ''))
/** Folded, with separators read as spaces ("căn-cước" is "can cuoc"). */
const ID_CARD_WORDS = /cccd|cmnd|can cuoc|chung minh/
const LEGAL_PERMITS = 'legal-permits'

/**
 * ⛔ A PHONE CUT UP BY LETTERS OR SLASHES (R6, plan review 2026-10-14). The phone detector joins digits across spaces and
 * hyphens only, so 'ZALO/0903/123/456' and 'GP-0903-ABC-123-456' passed every screen here. The digits are therefore also
 * read on their own: every digit in the value, in order, whatever stands between them (so each run joined by [ ./-] is
 * covered too, and digits typed after the phone do not hide it). A Vietnamese phone number among them is 'contact'.
 * ⚠️ NARROWER THAN containsPhoneNumber, AND MEASURED (2026-10-14): a travel licence's digits run together to a phone's
 * length, and the generic detector reads '02-0123/2019/TCDL-GP LHQT' (0201232019) and '08-0456/2020/TCDL-GP LHQT'
 * (0804562020) as phones. So only a real number's shape counts: a 10-digit mobile on 03, 05, 07, 09 or 081–089 (080 is no
 * public mobile range, which is what lets province 08's zero-padded serials through), an 11-digit landline (02 and nine
 * digits), or either with 84 in place of the 0.
 * ⚠️ AND NOT ON A NUMBER IN THE INTERNATIONAL TRAVEL LICENCE'S OWN FORM (commit gate, 2026-10-14): a province-08 licence
 * past serial 0999 ('08-1456/2020/TCDL-GP LHQT', digits 0814562020) reads as an 081 mobile, and a real provider could not
 * enter its real licence. A value in exactly that form ('<2-digit province>-<serial>/<year>/TCDL-GP LHQT') skips this one
 * digit read — every other screen still applies, nothing is public before eno's team has compared the value with the
 * licence, and any change re-holds the listing. A phone dressed in that exact form is the admin's comparison to catch.
 */
const PHONE_IN_DIGITS = /(?:0|84)(?:(?:[3579]\d|8[1-9])\d{7}|2\d{9})/
const TRAVEL_LICENCE_FORM = /^\d{2}-\d{3,5}\/(?:19|20)\d{2}\/TCDL-GP ?LHQT$/i

/** Do the value's digits, read on their own, hold a Vietnamese phone number? NFKC first, so a full-width or superscript
 *  digit counts as the digit it shows. */
function phoneInDigits(v: string): boolean {
  return PHONE_IN_DIGITS.test(v.normalize('NFKC').replace(/\D/g, ''))
}

function nameProblem(n: string): ProviderLicenceReason | null {
  if (!n) return 'missing'
  if (n.length > PROVIDER_LICENCE_LIMITS.legalName) return 'too_long'
  if (!LETTER.test(n)) return 'no_letter'
  if (NAME_DIGIT_RUN.test(n)) return 'personal_id'
  if (containsPhoneNumber(n) || containsContactInfo(n) || phoneInDigits(n)) return 'contact'
  if (findBannedWord(n)) return 'banned'
  return null
}

function numberProblem(x: string, subcategorySlug: string | null | undefined): ProviderLicenceReason | null {
  if (!x) return 'missing'
  if (x.length > PROVIDER_LICENCE_LIMITS.licenceNo) return 'too_long'
  if (x.length < 3 || !NUMBER_CHARS.test(x)) return 'format'
  if (!DIGIT.test(x)) return 'no_digit'
  if (ID_CARD_WORDS.test(fold(x).replace(/[\s./-]+/g, ' '))) return 'personal_id'
  if (BARE.test(x)) {
    // Digits and separators only: never a licence in e-Visa, an ID card at 9 or 12 digits, and otherwise only the exact
    // enterprise-code form in Legal & permits — the ONE value that skips the phone screen.
    const digits = x.replace(/\D/g, '').length
    if (digits === 9 || digits === 12) return 'personal_id'
    if (subcategorySlug === LEGAL_PERMITS && isEnterpriseCodeForm(x)) return null
    return 'format'
  }
  if (LONG_DIGIT_RUN.test(x) || isSpacedCitizenId(x)) return 'personal_id'
  if (subcategorySlug === VISA_SUBCATEGORY_SLUG && !LETTER.test(x)) return 'format'
  if (containsPhoneNumber(x) || containsContactInfo(x) || (phoneInDigits(x) && !TRAVEL_LICENCE_FORM.test(x))) return 'contact'
  if (findBannedWord(x)) return 'banned'
  return null
}

/**
 * Every problem with these values in this aisle — at most one per field, name first, each the first rule it breaks (the
 * rules are in the header). The wizard shows them per field; the server answers the first (checkProviderLicence) as
 * `provider_licence_invalid` with detail '<field>:<reason>'. Raw input is fine: both values are normalised here.
 */
export function providerLicenceProblems(v: Partial<ProviderLicence> | null | undefined, subcategorySlug: string | null | undefined): ProviderLicenceProblem[] {
  const out: ProviderLicenceProblem[] = []
  const name = nameProblem(normalizeLegalName(v?.legalName))
  if (name) out.push({ field: PROVIDER_LEGAL_NAME, reason: name })
  const number = numberProblem(normalizeLicenceNo(v?.licenceNo), subcategorySlug)
  if (number) out.push({ field: PROVIDER_LICENCE_NO, reason: number })
  return out
}

/** The first problem (providerLicenceProblems), or null when both values can be accepted as written. */
export function checkProviderLicence(v: Partial<ProviderLicence> | null | undefined, subcategorySlug: string | null | undefined): ProviderLicenceProblem | null {
  return providerLicenceProblems(v, subcategorySlug)[0] ?? null
}
