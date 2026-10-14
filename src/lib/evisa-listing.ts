import { isVisaProductSlot } from './taxonomy'

/**
 * Is this listing an e-Visa PRODUCT, whoever sells it — a listing in the e-Visa subcategory (services / visa-legal)?
 *
 * ⛔ THE SLOT ALONE, SINCE 2026-10-14. Until then `visa-legal` also held work-permit, tax and legal listings, so the test
 * also wanted an e-Visa chip (`visaEntryType` or `visaSpeed`). The owner then made the slot a dedicated e-Visa
 * subcategory open to every poster (legal work moved to `legal-permits`), and both chips are optional — so a chip test
 * would let an ordinary seller's unchipped e-Visa listing escape every check that reads this (gate review, 2026-10-14).
 * `attributes` is still accepted, so callers need not change, and is no longer read.
 * ⚠️ The DESK's own products are answered by isVisaShopListing (visa-shop.ts) — callers OR the two together; this one
 * exists for the listings that the desk check correctly says are not the desk's.
 *
 * Used by App Store gate `ios-hide-visa` (src/lib/ios-hide-visa.ts): in the iOS app an e-Visa product offers no way to
 * start an application in the app, because its chat is where the seller takes one.
 */
export function isEVisaProductListing(l: {
  categorySlug: string
  subcategorySlug?: string | null
  /** No longer read (see above); accepted so the callers that pass it keep compiling. */
  attributes?: string | Record<string, unknown> | null
}): boolean {
  return isVisaProductSlot(l.categorySlug, l.subcategorySlug)
}
