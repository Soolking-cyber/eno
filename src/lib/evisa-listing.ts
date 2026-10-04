import { isVisaProductSlot } from './taxonomy'

/**
 * Is this listing an e-Visa PRODUCT, whoever sells it — the visa slot (services / visa-legal) AND an e-Visa chip
 * (`visaEntryType` or `visaSpeed`)?
 *
 * ⚠️ THE SLOT ALONE IS NOT ENOUGH, and that is why the chips are part of the test. `visa-legal` also holds work-permit,
 * tax and legal listings from ordinary sellers (taxonomy.ts isVisaProductSlot), and those are not visa applications.
 * The chips are what an e-Visa product carries: measured read-only 2026-10-05, all 14 live VietKite e-Visa listings on
 * eno.forum have both (`{"visaEntryType":"multiple","visaSpeed":"1D",…}`).
 * ⚠️ The DESK's own products are answered by isVisaShopListing (visa-shop.ts) — callers OR the two together; this one
 * exists for the partner listings that the desk check correctly says are not the desk's.
 *
 * Used by App Store gate `ios-hide-visa` (src/lib/ios-hide-visa.ts): in the iOS app an e-Visa product offers no way to
 * start an application in the app, because its chat is where the seller takes one.
 */
export function isEVisaProductListing(l: {
  categorySlug: string
  subcategorySlug?: string | null
  /** The raw column (a JSON string) or the parsed object — both shapes reach the callers. */
  attributes?: string | Record<string, unknown> | null
}): boolean {
  if (!isVisaProductSlot(l.categorySlug, l.subcategorySlug)) return false
  let attrs: unknown = l.attributes ?? null
  if (typeof attrs === 'string') {
    try { attrs = JSON.parse(attrs) } catch { return false }
  }
  if (!attrs || typeof attrs !== 'object') return false
  const a = attrs as Record<string, unknown>
  const set = (v: unknown) => typeof v === 'string' && v.trim() !== ''
  return set(a.visaEntryType) || set(a.visaSpeed)
}
