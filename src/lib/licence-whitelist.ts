// ── THE LICENCE CHECK'S WHITELIST (owner, 2026-10-15: "whitelist vietkite") ─────────────────────────────────────────
//
// A partner storefront eno vouches for itself is EXEMPT from the licence check IN THE AISLES LISTED, exactly as eno's own
// desk is: no values required, never held, never swept, nothing to approve or revoke (src/lib/licence-stamp.ts reads
// it on every server path; the post wizard reads it so a whitelisted poster is not asked for the two values).
// ⛔ IT IS NOT THE DESK'S HIDE-LIST: HIDDEN_DESK_OWNER_EMAILS removes a storefront from eno.vn, and a partner must never
// be put there (edition-scope.ts) — a whitelisted storefront stays visible everywhere it was.
// ⚠️ PER AISLE, deliberately: VietKite holds an international travel-service licence, which covers e-Visa
// (services/visa-legal) and not Legal & permits — a VietKite work-permit listing is checked like anyone's.
// ⛔ BY SELLER ID — AND THE ID IS THE IDENTITY (commit gate, 2026-10-15): an owned storefront never changes hands here.
// Ownership is CLAIM-ONCE — the only writes that set Seller.ownerId on an existing row are guarded by `ownerId: null`
// (src/app/api/listings/resolve-seller.ts, src/lib/profile.ts), and compliance/public-state-writes.test.ts pins every
// claim path — so this id names VietKite's storefront for as long as the row exists. Even orphaned (Seller.owner is
// onDelete: SetNull, so a deleted account leaves it ownerless), it can be claimed only with a VERIFIED phone equal to
// the storefront's own number — by whoever controls VietKite's phone, i.e. VietKite. If the row ever stops existing (a
// restore that re-created rows), the entry matches nothing and VietKite is checked like anyone: fail closed by
// construction, with no identity check to trust or to fail open. Every path decides without a database read (the SQL
// guard inlines the ids — UUIDs, checked below).
//
// Client-safe: no node:crypto, no server import, and no contact data (this ships in the browser bundle).
import { LICENCE_CHECK_SUBCATEGORIES } from './taxonomy'

/** `name` documents the entry (the storefront's handle); only `sellerId` and `aisles` decide anything. */
export const LICENCE_WHITELIST: readonly { sellerId: string; name: string; aisles: readonly string[] }[] = [
  { sellerId: 'b6b7b817-6af9-4d37-a762-cf54f6ec74e6', name: 'vietkite', aisles: ['visa-legal'] },
]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
for (const w of LICENCE_WHITELIST) {
  if (!UUID.test(w.sellerId)) throw new Error(`LICENCE_WHITELIST: not a seller id: ${w.sellerId}`)
  if (!w.aisles.length || w.aisles.some((a) => !(LICENCE_CHECK_SUBCATEGORIES as readonly string[]).includes(a))) {
    throw new Error(`LICENCE_WHITELIST: not licence aisles: ${w.aisles.join(',')}`)
  }
}

/** Is this storefront whitelisted for this aisle? */
export function isLicenceWhitelisted(sellerId: string | null | undefined, subcategorySlug: string | null | undefined): boolean {
  return !!sellerId && !!subcategorySlug && LICENCE_WHITELIST.some((w) => w.sellerId === sellerId && w.aisles.includes(subcategorySlug))
}
