import 'server-only'
import { db } from './db'

/**
 * Is this (already-normalized, +84…) phone tied to a DIFFERENT account?
 * A number identifies one account, so it can't be reused — in ANY format, since
 * every write normalizes first (0772…, +84772…, 84772… all collapse to one key).
 *
 * "Taken by another" = another user's Profile.phone, OR a Seller owned by another
 * user. UNOWNED (guest) sellers don't count — they're claimable by whoever later
 * verifies that number (the existing guest-claim flow).
 */
export async function phoneTakenByOther(phone: string, meProfileId: string | null): Promise<boolean> {
  if (!phone) return false
  const [prof, sell] = await Promise.all([
    db.profile.findFirst({
      where: { phone, ...(meProfileId ? { NOT: { id: meProfileId } } : {}) },
      select: { id: true },
    }),
    db.seller.findFirst({
      where: { phone, ownerId: { not: null }, ...(meProfileId ? { NOT: { ownerId: meProfileId } } : {}) },
      select: { id: true },
    }),
  ])
  return !!(prof || sell)
}
