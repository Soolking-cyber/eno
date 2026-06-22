import 'server-only'
import { db } from './db'
import { getCurrentProfile } from './admin'

export type OwnerCheck =
  | { ok: true; sellerId: string; profileId: string }
  | { ok: false; code: number; error: string }

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
