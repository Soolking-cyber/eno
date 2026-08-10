import 'server-only'
import { normalizePhone } from './phone'
// Single source of truth for seller contact. SERVER-ONLY — the number must never
// reach the client bundle; only the auth-gated /api/listings/[id]/contact route
// may resolve it. Returns the seller's REAL stored phone (set in the post wizard)
// or null — never a synthetic/fallback number.
type SellerLike = { phone?: string | null; officialPartner: boolean | null }

/**
 * ⚠️ AN OFFICIAL PARTNER NEVER HAS A PHONE, WHATEVER THE COLUMN SAYS. Partners are companies eno
 * created accounts for and the agreement is that business runs through eno's internal chat, so the
 * refusal belongs HERE — in the one server-only function every contact path already goes through —
 * rather than in the reveal route.
 *
 * The distinction is not academic. Before this, VietKite shared no number only because their `phone`
 * column happened to be NULL; a single profile save would have silently switched their phone back on
 * and nothing in the codebase would have objected. A policy that holds because a field is empty is
 * not a policy. This one holds by construction, and any future caller inherits it for free.
 *
 * ⚠️ `officialPartner` IS REQUIRED, NOT OPTIONAL, AND THAT IS THE POINT. The first version had it
 * optional so as not to disturb existing callers, and an external reviewer was right to refuse it:
 * with `?`, a caller doing `select: { phone: true }` compiles clean, `officialPartner` arrives
 * `undefined`, the check falls through and the function hands back a partner's phone number. A
 * security boundary that a forgotten field silently disables is not a boundary. Required means the
 * compiler stops anyone who has not fetched the fact the policy depends on — which cost exactly
 * nothing here, because this function has one non-test caller and it already selected the column.
 */
export function phoneForSeller(seller: SellerLike): string | null {
  if (seller.officialPartner) return null
  const p = seller.phone?.trim()
  return p || null
}

function digits(p: string): string {
  return p.replace(/\D/g, '')
}

/**
 * A working tel: link — E.164 WITH the leading '+'.
 *
 * ⚠️ THIS WAS BROKEN FOR EVERY SELLER IN PRODUCTION, NOT AS AN EDGE CASE. The old body did
 * `digits(phone)` — which strips the '+' — and then only re-added it on the `startsWith('0')`
 * branch, so an already-international number fell straight through and emitted `tel:84901234567`.
 * A tel: URI without the '+' is not E.164; the dialler treats it as a local number and it does not
 * connect.
 *
 * ⚠️ AND THE '0' BRANCH IS DEAD CODE IN PRODUCTION, which is what made it look latent. Measured
 * 2026-08-10: all 9 sellers with a stored number hold it in `+…` form and NONE start with '0',
 * because every write path (post wizard, listing PATCH, storefront PATCH, account-type switch,
 * resolve-seller) runs `normalizePhone` first — see src/lib/phone.ts, "the stored Seller.phone
 * key". So 100% of contact reveals emitted a link that could not dial. An earlier comment of mine
 * called this "latent rather than universal"; the data says the exact opposite, and I only found
 * that out by counting the rows instead of reasoning about the function.
 *
 * The fix is to stop re-deriving, badly, a normalisation the repo already owns. `normalizePhone`
 * is idempotent for stored numbers and still repairs a hand-typed local form, so the '0' case that
 * the old branch existed for keeps working. `phone.ts` imports nothing server-only (a client
 * component already imports it), so the direction is safe from this `server-only` module.
 */
export function telHref(phone: string): string {
  return `tel:${normalizePhone(phone)}`
}

/** A working Zalo deep link to the seller's number. Zalo resolves VN numbers in LOCAL
 *  format (leading 0), NOT the 84-prefixed international form — so `+84901234567` must
 *  become `zalo.me/0901234567`, otherwise the link opens to "user not found". */
export function zaloHref(phone: string): string {
  const d = digits(phone)
  const local = d.startsWith('84') ? `0${d.slice(2)}` : d
  return `https://zalo.me/${local}`
}
