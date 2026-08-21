// ── Legal citations — THE SINGLE SOURCE OF TRUTH ────────────────────────────────────────────────
//
// ⚠️ NEVER INLINE A LAW OR DECREE NUMBER ANYWHERE ELSE. Not in a component, not in an email
// template, not in a policy page, not in an API response. These strings go in front of users and
// in front of competent authorities — a takedown notice citing the wrong instrument is a legal
// problem, not a typo — and an amendment must be a one-line diff rather than a grep.
//
// Confirmed by the owner 2026-08-03 ("decree confirmed, build in accordance"), consistent with the
// 2026 licensing research already on file (ND 340/2025 currency display, live seller-authentication
// penalties, e-ID by 2027-01-01). Full architecture: docs/compliance-2026.md
//
// ⚠️ BOTH EDITIONS. eno.vn and eno.forum are one codebase deployed twice and BOTH operate as
// marketplaces carrying third-party listings, so every obligation here applies to both. Compliance
// is not one of the visa/itinerary/PayPal legal-boundary exceptions.

export type LegalInstrument = {
  /** Vietnamese citation — the authoritative form, used in notices served in Vietnam. */
  readonly vi: string
  /** English rendering, for the expat half of the user base. Never used alone in a notice. */
  readonly en: string
  /** ISO date the instrument takes effect. */
  readonly effective: string
}

export const LEGAL_BASIS = {
  ecommerceLaw: {
    vi: 'Luật Thương mại điện tử số 122/2025/QH15',
    en: 'Law on E-commerce No. 122/2025/QH15',
    effective: '2026-07-01',
  },
  identityDecree: {
    vi: 'Nghị định 248/2026/NĐ-CP',
    en: 'Decree No. 248/2026/ND-CP',
    // ⚠️ IN FORCE 2026-07-01, WITH LAW 122/2025 — this said 2027-01-01, which conflated the
    // decree's own effect with the identity DUTY it imposes. They are different dates and the
    // constants below keep them apart.
    effective: '2026-07-01',
  },
  eidDecree: {
    vi: 'Nghị định 320/2026/NĐ-CP',
    en: 'Decree No. 320/2026/ND-CP',
    // Signed 13/8/2026, in force 28/9/2026. Adds khoản 9 to Điều 40 of ND 69/2024: seller,
    // livestream-seller and affiliate accounts "phải được liên kết, xác thực với tài khoản định
    // danh điện tử". This is the instrument that names VNeID for e-commerce explicitly.
    effective: '2026-09-28',
  },
  currencyDecree: {
    vi: 'Nghị định 340/2025/NĐ-CP',
    en: 'Decree No. 340/2025/ND-CP',
    effective: '2025-01-01',
  },
} as const satisfies Record<string, LegalInstrument>

export type LegalBasisKey = keyof typeof LEGAL_BASIS

/**
 * ⚠️ VALIDATE AT THE EDGE. The takedown API accepts a legalBasis KEY, never free text — an
 * authority-supplied string would end up quoted verbatim in an email we send under our own name.
 */
export function isLegalBasisKey(v: unknown): v is LegalBasisKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(LEGAL_BASIS, v)
}

/**
 * Hard deadline for seller identity verification (Decree 248/2026, Art. on e-identification).
 *
 * ⚠️ INDOCHINA TIME, EXPLICITLY. A bare `new Date('2027-01-01')` is parsed as UTC, which is
 * 07:00 on 1 January in Hanoi — so a deadline check would fire seven hours late for every
 * Vietnamese seller. Every compliance date in this codebase carries +07:00.
 */
// ⛔ THE DEADLINE MOVED FOUR MONTHS EARLIER AND THIS FILE HAD NOT NOTICED. The single
// 2027-01-01 constant came from Decree 248/2026. Decree 320/2026/NĐ-CP (13/8/2026, in force
// 28/9/2026) supersedes it for the linking duty and splits it in two, so one date can no longer
// answer "is this seller late?" — it depends on when the account was created.
//
// ⚠️ AND NEITHER IS SATISFIABLE BY ANYTHING WE BUILD. "Xác thực điện tử" is a defined term:
// Decree 69/2024 Art 3.6 makes it an operation performed THROUGH the national identification
// system against the Cơ sở dữ liệu quốc gia về dân cư, and Art 3.9 restricts providers to public
// -service units or enterprises inside the People's Police — i.e. Trung tâm RAR under C06. A
// self-built selfie-and-document check does not meet it at any date. See docs/compliance-2026.md.

/** Seller accounts created ON OR AFTER this date must be linked to VNeID before selling. */
export const VNEID_LINK_DEADLINE_NEW = new Date('2026-09-28T00:00:00+07:00')

/** Seller accounts that already existed must be linked by the end of this day. */
export const VNEID_LINK_DEADLINE_EXISTING = new Date('2026-12-31T23:59:59+07:00')

/**
 * The date that applies to ONE seller, which is the only question a caller ever actually has.
 * Pass the account's creation instant; an account created before the new-account rule bit gets
 * the later, existing-account deadline.
 */
export function vneidLinkDeadlineFor(accountCreatedAt: Date): Date {
  return accountCreatedAt < VNEID_LINK_DEADLINE_NEW ? VNEID_LINK_DEADLINE_EXISTING : VNEID_LINK_DEADLINE_NEW
}

/**
 * @deprecated Decree 320/2026 replaced this with the two dates above. Kept only so an unmigrated
 * caller fails loudly in review rather than silently reading a date four months too late.
 */
export const IDENTITY_DEADLINE = VNEID_LINK_DEADLINE_EXISTING

/** Retention floor for investigative logs: 3 years. See docs/compliance-2026.md §4.2. */
export const INVESTIGATIVE_RETENTION_DAYS = 3 * 365
