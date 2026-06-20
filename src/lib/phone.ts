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
const EMBEDDED_PHONE_RE = /(?:\+?84|0)[\s-]?[2-9](?:[\s-]?\d){7,9}|\+\d(?:[\s-]?\d){7,}/
export function containsPhoneNumber(text: string | null | undefined): boolean {
  return !!text && EMBEDDED_PHONE_RE.test(text)
}
