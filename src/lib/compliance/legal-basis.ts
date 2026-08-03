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
    effective: '2027-01-01',
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
export const IDENTITY_DEADLINE = new Date('2027-01-01T00:00:00+07:00')

/** Retention floor for investigative logs: 3 years. See docs/compliance-2026.md §4.2. */
export const INVESTIGATIVE_RETENTION_DAYS = 3 * 365
