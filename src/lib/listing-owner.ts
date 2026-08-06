import 'server-only'
import { db } from './db'
import { getCurrentProfile } from './admin'

/**
 * Every code `checkListingOwner` can put on the wire.
 *
 * ⚠️ NAMED RATHER THAN `error: string`, and this one guards a PRIVILEGE boundary rather than a
 * validation message. Six routes answer `{ error: r.error }` straight from this helper
 * (`listings/[id]/{sold,status,confirm,buyers}` and friends), so its union is an API union — and
 * while it was a bare `string` nothing stopped a future branch here returning a code no client
 * knows, on the path that decides whether a caller may mutate a listing they do not own.
 * `src/lib/api/errors.ts` now asserts this is a subset of `ApiErrorCode` at COMPILE time.
 *
 * The four are deliberately DISTINCT and must stay so: `no_storefront` (signed in, no shop) and
 * `forbidden` (signed in, has a shop, wrong shop) are different sentences to the user, and
 * collapsing them into one 403 is the tidying this migration keeps refusing to do.
 */
export type OwnerCheckErrorCode = 'auth_required' | 'no_storefront' | 'not_found' | 'forbidden'

export type OwnerCheck =
  | { ok: true; sellerId: string; profileId: string }
  | { ok: false; code: number; error: OwnerCheckErrorCode }

/**
 * Authorize a listing-mutating request: the caller must be signed in and own the
 * storefront (`Seller.ownerId === profile.id`) that the listing belongs to.
 * Prisma BYPASSES RLS, so ownership MUST be re-checked here in app code.
 */
export async function checkListingOwner(listingId: string): Promise<OwnerCheck> {
  const profile = await getCurrentProfile()
  if (!profile) return { ok: false, code: 401, error: 'auth_required' }
  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true } })
  if (!seller) return { ok: false, code: 403, error: 'no_storefront' }
  const listing = await db.listing.findUnique({ where: { id: listingId }, select: { sellerId: true } })
  if (!listing) return { ok: false, code: 404, error: 'not_found' }
  if (listing.sellerId !== seller.id) return { ok: false, code: 403, error: 'forbidden' }
  return { ok: true, sellerId: seller.id, profileId: profile.id }
}
