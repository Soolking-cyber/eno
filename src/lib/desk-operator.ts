import 'server-only'
import { createSupabaseServer } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admin'
import { VISA_SHOP_OWNER_EMAILS } from '@/lib/visa-shop'
import { TRIP_DESK_OWNER_EMAILS } from '@/lib/trips/dm-thread'

/**
 * WHO MAY OPERATE A SERVICE DESK — scoped to ONE desk, and deliberately not the same thing as being
 * an eno admin.
 *
 * ⚠️ THE PROBLEM THIS SOLVES IS A REAL ENTITLEMENT HOLE, NOT TIDINESS. Every operator action on the
 * trip desk (quote a request, advance a case) and on the visa desk (upload a result, take over a
 * thread, download the applicant's PII bundle) gates on `getAdmin()`, i.e. membership of
 * ADMIN_EMAILS. That was correct while the only desk operator was eno's own support account.
 *
 * It stops being correct the moment a desk is run by a PARTNER. Owner, 2026-08-13: visa on eno.vn is
 * VietKite's and itineraries are GMBR's. Wiring either of them as an operator under the old model
 * meant putting a third-party company's address in ADMIN_EMAILS — which grants the whole of /admin:
 * every user's dispute room, every report, the enforcement console, the moderation queue and every
 * OTHER applicant's identity documents. To let VietKite file the visas they sell, eno would have had
 * to hand them the entire marketplace's private data. That is the trade this module refuses.
 *
 * ⚠️ THE OPERATOR IS DERIVED FROM THE DESK ITSELF, WITH NO NEW ALLOWLIST. Whoever owns the desk
 * storefront operates that desk — the same env that already decides which account is the seller side
 * of those conversations (VISA_SHOP_OWNER_EMAIL / TRIP_DESK_OWNER_EMAIL). A separate
 * OPERATOR_EMAILS variable would be a second source of truth for one fact, and the two would drift:
 * the day someone repoints a desk and forgets the operator list, either the new partner cannot work
 * or the old one still can. There is nothing to keep in sync here.
 *
 * ⚠️ THE TWO DESKS ARE SEPARATE ENTITLEMENTS. VietKite operating visa must not imply operating
 * trips, and vice versa — they are different companies. Each helper reads only its own list, so the
 * scope is the desk, never "is a partner".
 *
 * ⚠️ ADMINS KEEP EVERYTHING. Both helpers accept an admin first, so this is strictly ADDITIVE: no
 * existing operator loses access, and eno's own support account continues to work on both desks
 * exactly as before (it is the default value of both variables).
 *
 * ⛔ DO NOT REUSE THESE FOR /admin, DISPUTES, REPORTS OR ENFORCEMENT. They answer "may this session
 * act on THIS desk's cases", nothing wider. Anything that reads another user's data outside the
 * desk's own workflow must keep calling `getAdmin()`.
 */

/** The session's verified email, lowercased — the one identity input both helpers share. */
async function sessionEmail(): Promise<string | null> {
  const supabase = await createSupabaseServer()
  const { data } = await supabase.auth.getUser()
  const email = data.user?.email
  return email ? email.toLowerCase() : null
}

/**
 * ⚠️ `getUser()`, NOT `getSession()`, and this mirrors `getAdmin()` on purpose. getUser re-verifies
 * the JWT with the auth server; getSession trusts whatever is in the cookie. An entitlement check
 * that trusts the cookie is not a check.
 */
async function operatorFor(list: readonly string[]): Promise<string | null> {
  const email = await sessionEmail()
  if (!email) return null
  // An admin operates every desk.
  if (isAdminEmail(email)) return email
  // ⚠️ An EMPTY list must never grant access. `[].includes()` is false, so this is already correct —
  // stated because the failure direction matters: an unset desk variable should lock the desk, not
  // open it.
  return list.includes(email) ? email : null
}

/**
 * May this session act on VISA cases — quote, take over a thread, upload a result, read an
 * applicant's document bundle?
 *
 * True for an eno admin, or for the account that owns the visa storefront on this deployment
 * (VISA_SHOP_OWNER_EMAIL — VietKite on eno.vn once repointed, eno's support account on eno.forum).
 */
export async function getVisaDeskOperator(): Promise<string | null> {
  return operatorFor(VISA_SHOP_OWNER_EMAILS)
}

/**
 * May this session act on ITINERARY / trip-assistance cases — quote a request, advance its state?
 *
 * True for an eno admin, or for the account that owns the trip desk on this deployment
 * (TRIP_DESK_OWNER_EMAIL — GMBR on eno.vn once repointed, eno's support account on eno.forum).
 */
export async function getTripDeskOperator(): Promise<string | null> {
  return operatorFor(TRIP_DESK_OWNER_EMAILS)
}
