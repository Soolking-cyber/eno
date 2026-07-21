import 'server-only'
import { cache } from 'react'
import { db } from '@/lib/db'
import { MAX_EVISA_VALIDITY_DAYS, visaDateDefaultsForStart, type VisaPayload } from '@/lib/visa/schema'

// ── The eno e-Visa SHOP ────────────────────────────────────────────────────────────
// "Visa in a DM" starts with the user picking a PRODUCT from a real storefront: the
// visa desk is an ordinary marketplace Seller whose listings are the visa services we
// sell. This module is the ONE place that knows which storefront that is and which
// listings are its products — every other surface (chat product picker, the step
// messages, checkout) asks here instead of hardcoding an email, a seller id, or a
// listing id. Nothing here decrypts or touches applicant PII: it deals in listings.
//
// Everything is fail-soft. Before the shop is seeded (scripts/seed-visa-shop.mjs) the
// resolvers answer null / [] rather than throwing, so a Wave-2 surface renders "no
// products yet" instead of a 500.

/**
 * The account that OWNS the visa storefront and answers its threads: support@eno.vn
 * (owner-locked 2026-07-21). The forum app declares the same address for the operator
 * queue (apps/forum/src/lib/visa/auth.ts:5 VISA_SUPPORT_ADMIN_EMAIL); that copy is not
 * importable from here (separate Next app, separate `@/` root), so this is the eno.vn
 * side's single source of truth and it is env-overridable for a staging project.
 *
 * ⚠️ WHERE THIS SHOULD LIVE: once the forum's visa surfaces are retired (see the
 * "Visa ownership" note in CLAUDE.md), the two constants collapse into ONE — this
 * one — and apps/forum's copy goes away with the rest of that code. Until then, keep
 * them equal; they are compared by nothing but a human, which is why the address is
 * read from env first.
 */
export const VISA_SHOP_OWNER_EMAIL = (process.env.VISA_SHOP_OWNER_EMAIL || 'support@eno.vn').trim().toLowerCase()

/**
 * Visa products are identified by `Listing.externalId` — the partner-sync column,
 * NULL for every ordinary listing and UNIQUE per seller (@@unique([sellerId, externalId])).
 * That makes it both the seed's idempotency key and a stable machine-readable marker
 * that survives edits through the dashboard (updateListingCore never touches it),
 * unlike title text or the `attributes` blob (which sanitizeAttributes rewrites).
 */
export const VISA_PRODUCT_EXTERNAL_PREFIX = 'visa:'

export type VisaEntryType = VisaPayload['entryType'] // 'single' | 'multiple'

/**
 * The product catalogue, DERIVED FROM THE ENGINE — not invented:
 *  · `entryType` is exactly the payload's own enum (single | multiple);
 *  · the stay length is MAX_EVISA_VALIDITY_DAYS (90) — the only window the engine
 *    PRODUCES: visaDateDefaultsForStart() emits a 90-day span and nothing else, and
 *    validateVisaForReview rejects anything longer (visa_period_exceeds_90_days).
 * So the honest SKU set is 2, not 4. A shorter stay is *validatable* (stayLengthDays
 * accepts 1–90 alongside explicit dates), so a 30-day product is not impossible — but
 * it would need its own end-date rule AND a checkout that can charge it a different
 * amount (today's fee is flat, src/lib/visa/payments.ts). Both are product decisions,
 * not something to infer here. ⚠️ Note src/lib/sync-pairs.test.ts byte-couples
 * src/lib/visa/schema.ts to the forum copy, so the date rule cannot be changed alone.
 */
export type VisaProductKey = 'evisa-90-single' | 'evisa-90-multiple'

export type VisaProduct = {
  key: VisaProductKey
  /** Listing.externalId of the listing that sells this product. */
  externalId: string
  entryType: VisaEntryType
  /** Prefilled into VisaPayload.stayLengthDays; ≤ MAX_EVISA_VALIDITY_DAYS by construction. */
  stayDays: number
  /** Display order in the chat product picker (cheapest/most common first). */
  order: number
}

export const VISA_PRODUCTS: readonly VisaProduct[] = [
  { key: 'evisa-90-single', externalId: `${VISA_PRODUCT_EXTERNAL_PREFIX}evisa-90-single`, entryType: 'single', stayDays: MAX_EVISA_VALIDITY_DAYS, order: 1 },
  { key: 'evisa-90-multiple', externalId: `${VISA_PRODUCT_EXTERNAL_PREFIX}evisa-90-multiple`, entryType: 'multiple', stayDays: MAX_EVISA_VALIDITY_DAYS, order: 2 },
] as const

/** The product a listing's externalId denotes, or null (an ordinary listing). */
export function visaProductFromExternalId(externalId: string | null | undefined): VisaProduct | null {
  if (!externalId) return null
  return VISA_PRODUCTS.find((p) => p.externalId === externalId) ?? null
}

/**
 * The engine-facing prefill for a picked product: the two payload fields the CHOICE
 * itself determines. Dates are only added for a full-length product, because
 * visaDateDefaultsForStart() only knows the 90-day window — a shorter product would
 * need its own end-date rule, and guessing one here would put an invented validity
 * window into a government application.
 */
export function visaPrefillForProduct(product: VisaProduct, startDate?: string): Partial<VisaPayload> {
  const base: Partial<VisaPayload> = { entryType: product.entryType, stayLengthDays: product.stayDays }
  if (!startDate || product.stayDays !== MAX_EVISA_VALIDITY_DAYS) return base
  return { ...visaDateDefaultsForStart(startDate), ...base }
}

// ── Resolvers (per-request memoized; fail-soft) ────────────────────────────────────

export type VisaShopSeller = {
  id: string
  name: string
  /** The support account's Profile id — the seller side of every visa thread. */
  ownerId: string | null
  avatarUrl: string | null
  avatarColor: string
}

/**
 * The visa storefront: the Seller owned by the support account. Resolved BY OWNER
 * EMAIL (not by a hardcoded seller id) so the row the seed created and the row the
 * app reads can never drift apart. null when the account has no storefront yet.
 * findFirst is deterministic here: Profile.email and Seller.ownerId are both UNIQUE,
 * so at most one storefront can match.
 */
export const getVisaShopSeller = cache(async (): Promise<VisaShopSeller | null> => {
  try {
    const seller = await db.seller.findFirst({
      where: { owner: { email: VISA_SHOP_OWNER_EMAIL } },
      select: { id: true, name: true, ownerId: true, avatarUrl: true, avatarColor: true },
    })
    return seller ?? null
  } catch (e) {
    console.error('[visa-shop] seller lookup', e)
    return null
  }
})

export type VisaShopListing = {
  id: string
  product: VisaProduct
  title: string
  titleVi: string | null
  description: string
  /** Stored amount + its currency symbol — render through <Price>, never bare. */
  price: number
  currency: string
  priceUnit: string
  images: string[]
  /** A listing must be verified AND active to be messageable (see /api/conversations). */
  verified: boolean
  status: string
}

/**
 * The shop's product listings, in catalogue order. Only rows whose externalId is a
 * known product key are returned, so an unrelated listing on the same storefront can
 * never be mistaken for a visa product.
 */
export const getVisaShopListings = cache(async (): Promise<VisaShopListing[]> => {
  const seller = await getVisaShopSeller()
  if (!seller) return []
  try {
    const rows = await db.listing.findMany({
      where: { sellerId: seller.id, externalId: { in: VISA_PRODUCTS.map((p) => p.externalId) } },
      select: {
        id: true, externalId: true, title: true, titleVi: true, description: true,
        price: true, currency: true, priceUnit: true, images: true, verified: true, status: true,
      },
    })
    return rows
      .flatMap((row) => {
        const product = visaProductFromExternalId(row.externalId)
        if (!product) return []
        let images: string[] = []
        try {
          const parsed: unknown = JSON.parse(row.images || '[]')
          images = Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === 'string') : []
        } catch { images = [] }
        return [{
          id: row.id, product, title: row.title, titleVi: row.titleVi, description: row.description,
          price: row.price, currency: row.currency, priceUnit: row.priceUnit, images,
          verified: row.verified, status: row.status,
        }]
      })
      .sort((a, b) => a.product.order - b.product.order)
  } catch (e) {
    console.error('[visa-shop] listings lookup', e)
    return []
  }
})

/** The listings a buyer may actually start a visa thread on (the messageable set). */
export const getVisaShopProductsForSale = cache(async (): Promise<VisaShopListing[]> =>
  (await getVisaShopListings()).filter((l) => l.verified && l.status === 'active'))

/**
 * The visa product a listing sells, or null. Two memoized reads (the listing row and
 * the shop seller), so calling it per rendered message is cheap. Ownership is checked
 * as well as the marker: a foreign seller cannot claim a product by copying an
 * externalId (the unique index is per-seller, so the string alone proves nothing).
 */
export const visaProductForListing = cache(async (listingId: string): Promise<VisaProduct | null> => {
  if (!listingId) return null
  try {
    const [seller, listing] = await Promise.all([
      getVisaShopSeller(),
      db.listing.findUnique({ where: { id: listingId }, select: { sellerId: true, externalId: true } }),
    ])
    if (!seller || !listing || listing.sellerId !== seller.id) return null
    return visaProductFromExternalId(listing.externalId)
  } catch (e) {
    console.error('[visa-shop] product lookup', e)
    return null
  }
})

/** The one check the rest of the feature should ask: is this listing a visa product? */
export async function isVisaShopListing(listingId: string): Promise<boolean> {
  return (await visaProductForListing(listingId)) !== null
}
