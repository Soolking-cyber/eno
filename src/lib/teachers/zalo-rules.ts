/**
 * "ZALO FOR URGENT COVER" — the pure rules, shared by the server (zalo.ts) and the forms (owner, 2026-10-28: "ask for zalo
 * number from teachers who opted in to cover explain in urgent cover schools can request their number and it can be show
 * without them texting back. Schools can reveal 1 zalo number per day for more they have to upload and go through
 * business kyc"). No 'server-only': the teacher's panel and the school's button read the same numbers.
 */

/**
 * ⛔ THE NOTICE'S MEANING IS THIS VERSION (the COVER_CONSENT_VERSION rule): change what the Zalo notice says is shown, to
 * whom, or how often, and bump it in the same change. A grant under an older version is not revealed (zalo.ts
 * eligibility) until the teacher switches it on again under the new words; the save refuses a body that did not show
 * the current one (`zaloNotice`), so a stale page can never stamp consent to words it did not show.
 */
export const COVER_ZALO_NOTICE_VERSION = '2026-10-28'

/**
 * How many NEW teachers' Zalo numbers a school (a business account) may see per Vietnam day:
 *   · school   — a business account whose business verification (with its identity check) is not live: 1 (the owner's
 *                number);
 *   · verified — business verification live (dm-quota.ts teacherDmTier 'business'): 20 — "for more they have to upload
 *                and go through business kyc". Not unlimited: a cap that still stops a scraper with a real company.
 * Re-opening a number already seen (the same grant) is never counted.
 */
export const ZALO_REVEAL_LIMITS = { school: 1, verified: 20 } as const

/**
 * ⛔ THROWAWAY ACCOUNTS (plan review, codex + opus 2026-10-28): a business account is a typed name and phone sign-in is
 * off, so one reveal a day per ACCOUNT alone would let a handful of fresh accounts copy every cover teacher's number in a
 * day. Two more brakes apply below business verification, both counted on the ledger inside the reveal's transaction:
 *   · POOL — every account on one internet connection (dm-quota.ts poolKeyFor: hashed, an IPv6 client is its /64) shares
 *     this many reveals a day;
 *   · PER TEACHER — one teacher's number is shown to at most this many unverified schools a day.
 */
export const ZALO_REVEAL_POOL = 2
export const ZALO_REVEAL_PER_TEACHER_UNVERIFIED = 3

/**
 * A Vietnamese MOBILE number, canonical (0 + 9 digits, the 03/05/07/08/09 ranges) — or null. Spaces, dots, dashes and a
 * +84 / 84 prefix are accepted and dropped. ⛔ STRICTER THAN isTeacherPhone (profile.ts, ≥ 8 digits, any country): a Zalo
 * link resolves a VN mobile in its local form only (contact.ts zaloHref), and a landline or a foreign number would give a
 * school a button that opens "user not found". Syntax only — whether Zalo knows the number is the teacher's to check.
 */
export function normalizeVnMobile(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 32) return null
  if (/[^\d\s.\-+()]/.test(raw)) return null
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('84') && d.length === 11) d = `0${d.slice(2)}`
  return /^0[35789]\d{8}$/.test(d) ? d : null
}

/** What the teacher sees about the number: grouped for reading (0901 234 567), never stored that way. */
export const formatVnMobile = (d: string): string => (/^0\d{9}$/.test(d) ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : d)
