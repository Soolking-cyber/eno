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
