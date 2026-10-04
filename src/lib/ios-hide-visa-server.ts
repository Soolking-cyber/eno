import 'server-only'
import { db } from './db'
import { isEVisaProductListing } from './evisa-listing'
import { threadKind } from './thread-kind'

/**
 * App Store gate `ios-hide-visa` (D5 = b; src/lib/ios-hide-visa.ts) — the SERVER's answer to "is this conversation an
 * e-Visa application thread?": bound to an application, a desk visa product's thread, or one about a partner's e-Visa
 * product (the visa slot + an e-Visa chip). Kept out of ios-hide-visa.ts because that module runs in the edge proxy,
 * which has no database.
 * ⚠️ NO try/catch, ON PURPOSE: callers use it to REFUSE a write, so a failed read must fail the request rather than
 * answer "not e-Visa" and let the write through. Call it only with the gate on and for the iOS app — it reads the DB.
 */
export async function isEVisaThread(conversationId: string): Promise<boolean> {
  const c = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { visaApplicationId: true, listing: { select: { id: true, subcategorySlug: true, attributes: true, category: { select: { slug: true } } } } },
  })
  if (!c) return false
  if (c.visaApplicationId) return true
  if (!c.listing) return false
  if (isEVisaProductListing({ categorySlug: c.listing.category.slug, subcategorySlug: c.listing.subcategorySlug, attributes: c.listing.attributes })) return true
  return (await threadKind({ listingId: c.listing.id })) === 'visa'
}
