import 'server-only'
import { cache } from 'react'
// Relative specifiers on purpose (the crypto.ts / schema.ts / dm-thread.ts idiom): `@/…`
// does not resolve under vitest, and this module's money and attribute parsing are
// unit-tested in src/lib/visa-shop.test.ts. Same modules either way.
import { db } from './db'
import {
  closedVisaWindow,
  parseVisaEntryType,
  parseVisaSpeedCode,
  submissionWindow,
  VISA_ENTRY_TYPES,
  VISA_SPEED_CODES,
  type VisaEntryType,
  type VisaSpeedCode,
  type VisaWindow,
} from './visa/speed'
import { MAX_EVISA_VALIDITY_DAYS, visaDateDefaultsForStart, type VisaPayload } from './visa/schema'

// ── The eno e-Visa SHOP ────────────────────────────────────────────────────────────
//
// THE CATALOGUE IS THE MARKETPLACE. The admin uploads each visa service as an ORDINARY
// listing on the visa storefront — one listing per (entry type × processing speed), each
// with its own price, set on the listing exactly like any other seller sets a price.
// This module reads that storefront back out. It holds no price table, no SKU union and
// no admin price editor: whatever listings exist in the shop ARE the products, and
// Listing.price IS the price. (An earlier attempt built a bespoke pricing table beside
// the marketplace; it was thrown away. Do not rebuild it.)
//
// Where each field comes from:
//   · price          → Listing.price (ĐỒNG, currency '₫') — the admin's authoritative
//                      number, exposed as-is. The USD a foreign buyer is shown and charged
//                      is DERIVED from it per checkout by src/lib/visa/fx.ts and is never
//                      stored here (owner, 2026-07-22)
//   · entry type     → Listing.attributes.visaEntryType   ('single' | 'multiple')
//   · speed          → Listing.attributes.visaSpeed       ('1H' … 'normal')
//   · cutoffs        → src/lib/visa/speed.ts — an operational FACT of the tier, from the
//                      provider, identical for every price, so NOT admin-editable data
//
// Everything is fail-soft. Before the shop is seeded (scripts/seed-visa-shop.mjs) — or
// while the admin is halfway through setting a product up — the resolvers answer null /
// [] rather than throwing, so a surface renders "no products yet" instead of a 500.
// Nothing here decrypts or touches applicant PII: it deals in listings.

/**
 * The account that OWNS the visa storefront and answers its threads: support@eno.forum
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
export const VISA_SHOP_OWNER_EMAIL = (process.env.VISA_SHOP_OWNER_EMAIL || 'support@eno.forum').trim().toLowerCase()

/**
 * ⚠️ A LIST, because pinning ONE address silently disabled the whole visa surface in prod.
 *
 * Found 2026-07-22: VISA_SHOP_OWNER_EMAIL is set in NEITHER the local env nor the deployed
 * secret, so it fell back to 'support@eno.vn' — for which no Profile row exists. The six
 * live e-visa products are owned by 'support@eno.forum'. getVisaShopSeller() therefore
 * matched nothing and every card, binding and charge path failed closed, while the products
 * sat published on the marketplace.
 *
 * CORRECTED 2026-07-22 (verified in the database, both columns): the consolidation moved
 * the account CLEANLY — auth.users.email AND Profile.email both read support@eno.forum,
 * and no Profile anywhere carries support@eno.vn. The earlier note here had the direction
 * backwards. The real cause was this constant's own fallback: it named the pre-migration
 * address, so the lookup matched nothing.
 *
 * It stays a LIST because the failure mode it guards against is real — pinning one address
 * takes the whole visa surface down silently — but the list now contains only addresses
 * that actually resolve. support@eno.vn is a Cloudflare mail REDIRECT into support@eno.forum
 * (owner: "we dont use it nowhere to create accounts"), never an account, so keeping it here
 * would have kept a dead identity alive as a live one.
 */
export const VISA_SHOP_OWNER_EMAILS: readonly string[] = (
  process.env.VISA_SHOP_OWNER_EMAIL || 'support@eno.forum'
)
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

/**
 * The prefix scripts/seed-visa-shop.mjs stamps into `Listing.externalId` for the rows it
 * creates. It is the SEED'S IDEMPOTENCY KEY (externalId is `@@unique([sellerId, externalId])`),
 * and nothing more.
 *
 * ⚠️ IT IS NO LONGER A CATALOGUE FILTER. A product the admin uploads through the ordinary
 * dashboard has `externalId = null`, and that product is the whole point of this feature —
 * filtering on the marker would make the admin's own listings invisible to the app. What
 * identifies a visa product now is the STOREFRONT it belongs to (getVisaShopSeller), which
 * is a stronger guarantee anyway: the marker is a string a foreign seller could copy, while
 * the sellerId is the row's identity.
 */
export const VISA_PRODUCT_EXTERNAL_PREFIX = 'visa:'

/** Re-exported so callers have one import for a visa product's shape. */
export type { VisaEntryType, VisaSpeedCode, VisaWindow }

// Compile-time proof (used, so it cannot rot into a dead assertion) that speed.ts's entry
// types are exactly the engine's — visaPrefillForProduct feeds them straight into
// VisaPayload.entryType, and a widened enum there must not silently pass through here.
const PAYLOAD_ENTRY_TYPES: readonly VisaPayload['entryType'][] = VISA_ENTRY_TYPES

/**
 * ⚠️ LEGACY — the two rows scripts/seed-visa-shop.mjs writes, NOT the catalogue.
 *
 * These are the seed's product keys (its externalId idempotency keys) and they exist here
 * for exactly one reason: `assertCatalogueInSync()` in that script greps this file for them
 * and refuses to run if they are missing. The catalogue itself is `getVisaShopProducts()`,
 * derived from the listings. Nothing in this file reads a product PARAMETER (entry type,
 * speed, stay length) or a PRICE out of the list below, and nothing new should: the admin
 * owns all of that on the listing.
 *
 * When the seeder stops asserting on this file, delete the block.
 */
export type VisaProductKey = 'evisa-90-single' | 'evisa-90-multiple'

export type VisaProduct = {
  key: VisaProductKey
  /** Listing.externalId the seed stamps for this row. */
  externalId: string
  /** Display order among the seeded rows only. */
  order: number
}

export const VISA_PRODUCTS: readonly VisaProduct[] = [
  { key: 'evisa-90-single', externalId: `${VISA_PRODUCT_EXTERNAL_PREFIX}evisa-90-single`, order: 1 },
  { key: 'evisa-90-multiple', externalId: `${VISA_PRODUCT_EXTERNAL_PREFIX}evisa-90-multiple`, order: 2 },
] as const

/** The SEEDED row an externalId denotes, or null. Legacy, see VISA_PRODUCTS. */
export function visaProductFromExternalId(externalId: string | null | undefined): VisaProduct | null {
  if (!externalId) return null
  return VISA_PRODUCTS.find((p) => p.externalId === externalId) ?? null
}

// ── Money ─────────────────────────────────────────────────────────────────────────
//
// ⚠️ A VISA PRODUCT IS PRICED IN ĐỒNG (owner, 2026-07-22). "admin posts in vnd and you
// show in vnd and usd to users they checkout accordingly usd from their paypal but the
// vnd equivalent that admin set." So Listing.price is the authority and this module
// exposes it unchanged; the dollars a foreign buyer sees and pays are a SERVER-ISSUED
// QUOTE of that đồng figure (src/lib/visa/fx.ts), minted at the moment of display and
// charged at the moment of checkout so the two can never be different numbers.
//
// A short-lived rule stored visa products in '$' and made this file refuse everything
// else (f7f8ca40). That is now exactly backwards — the currency gate below is the same
// gate with the currencies swapped, and it must stay pointed at ₫: reading a ₫3.000.000
// price as three million dollars is the 25 000× bug in the direction that empties a card.

/** A sane ceiling — an absurd visa fee, so this only ever catches a data-entry accident
 *  or a corrupted row. ⚠️ Mirrored by MAX_PRICE_VND in src/lib/visa/fx.ts, which re-asserts
 *  it at the charge boundary rather than trusting this module. Keep the two equal. */
const MAX_PRICE_VND = 2_000_000_000

/** A sane ceiling, above which toFixed() would start rendering exponent notation and a
 *  price is obviously a data-entry accident rather than a visa fee. */
const MAX_PRICE_USD = 1_000_000

/**
 * A USD amount → integer cents, EXACTLY. null for anything that is not a chargeable
 * amount (non-finite, zero, negative, absurdly large).
 *
 * ⚠️ NOTHING IN THE CATALOGUE CALLS THIS ANY MORE — visa products are priced in đồng and
 * the dollars come from src/lib/visa/fx.ts, which converts ĐỒNG → cents directly and never
 * goes through a USD decimal. It stays exported because it is still the correct primitive
 * for any caller that genuinely holds a dollars-and-cents DECIMAL (a provider's "12.34",
 * an operator's typed figure) and because its half-cent behaviour is the documented
 * counter-example the money tests are built on. Do not use it to price a listing.
 *
 * NO FLOAT MULTIPLY, on purpose. `Math.round(usd * 100)` is wrong at exactly the
 * half-cent boundaries a money rule cares about: the double nearest 8.475 is
 * 8.474999999999999644…, but `8.475 * 100` rounds UP to exactly 847.5 in binary, so
 * Math.round answers 848 — a cent that is not in the stored number (same story for
 * 0.615 → 62, 1.115 → 112, 2.675 → 268). Rendering the stored double to two decimals
 * and reading the digits straight back is exact by the ECMA-262 definition of toFixed
 * ("let n be an integer for which n / 10^f − x is as close to zero as possible"), does
 * no arithmetic on a non-integer at all, and gives the figure a bank statement would.
 */
export function usdToCentsExact(usd: number): number | null {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0 || usd > MAX_PRICE_USD) return null
  // Guarded by MAX_PRICE_USD: toFixed only switches to exponent notation at ≥ 1e21.
  const cents = Number.parseInt(usd.toFixed(2).replace('.', ''), 10)
  return Number.isInteger(cents) && cents > 0 ? cents : null
}

/**
 * Listing.price + Listing.currency → the ĐỒNG we may sell at, or null when the listing
 * cannot be sold honestly.
 *
 * Two gates:
 *
 * ĐỒNG ONLY. Every listing on eno is priced in đồng (src/lib/taxonomy.ts, listingMoneyFor)
 * and a visa product is not an exception. A row still carrying '$' from the reverted
 * USD-storage rule is therefore NOT quietly reinterpreted — it is dropped from the
 * catalogue and logged, because the two readings of the same number differ by 25 000× and
 * guessing which one the admin meant is not a decision code gets to make. The fix is one
 * price edit in the dashboard.
 *
 * WHOLE ĐỒNG ONLY, which is a DISPLAY-HONESTY gate and not a rounding taste: the card and
 * the PDP render this listing through formatMoneyFull(), which is `group(Math.round(price))`
 * — so a 3 000 000,5 ₫ row advertises 3.000.001 ₫. Quoting the dollars off the un-rounded
 * figure under a card that says something else is the mismatch we refuse everywhere else in
 * this file, and đồng has no minor unit anyway: a fractional price is a corrupt row, not a
 * pricing decision. The product goes unsellable (visible to the admin, unbuyable) rather
 * than mis-advertised.
 */
function sellablePriceVnd(price: number, currency: string): number | null {
  const symbol = (currency || '').trim().toUpperCase()
  // '₫' and 'đ' are both in the wild ('đ'.toUpperCase() === 'Đ'); 'VND' is the ISO code
  // some importers write. Anything else — '$', '€', '' — is refused, never converted.
  if (symbol !== '₫' && symbol !== 'Đ' && symbol !== 'VND') return null
  if (typeof price !== 'number' || !Number.isFinite(price)) return null
  if (!Number.isInteger(price) || price <= 0 || price > MAX_PRICE_VND) return null
  return price
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
    // `in`, not `equals` — see VISA_SHOP_OWNER_EMAILS. Ordered by memberSince so that if the
    // support account ever ends up with two identities, the ORIGINAL storefront (the one
    // holding the live products) wins deterministically rather than by insertion luck.
    const seller = await db.seller.findFirst({
      where: { owner: { email: { in: [...VISA_SHOP_OWNER_EMAILS] } } },
      orderBy: { memberSince: 'asc' },
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
  /** The seed's marker when the seed made this row; null for an admin-uploaded one. */
  externalId: string | null
  /** From Listing.attributes.visaEntryType — null while the admin has not set it. */
  entryType: VisaEntryType | null
  /** From Listing.attributes.visaSpeed — null while the admin has not set it. */
  speed: VisaSpeedCode | null
}

/** Listing.attributes is a JSON STRING typed by an admin. Parse it like hostile input. */
function readVisaAttributes(attributes: string | null | undefined): { entryType: VisaEntryType | null; speed: VisaSpeedCode | null } {
  if (!attributes || typeof attributes !== 'string') return { entryType: null, speed: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(attributes)
  } catch {
    // Malformed JSON is "not set yet", never a throw and never a guessed default.
    return { entryType: null, speed: null }
  }
  // `null`, an array, a number, a string — anything that is not a plain object carries no
  // attributes. (typeof null === 'object', hence the explicit null check.)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { entryType: null, speed: null }
  const blob = parsed as Record<string, unknown>
  return { entryType: parseVisaEntryType(blob.visaEntryType), speed: parseVisaSpeedCode(blob.visaSpeed) }
}

/**
 * CATALOGUE ORDER, and it is a pure function of the product's own parameters so two
 * requests can never disagree: the owner's grid order by speed (fastest → standard),
 * then entry type (single → multiple), then price, then listing id as the final
 * tiebreak. A product whose speed or entry type the admin has not set yet sorts LAST —
 * it is visible (the admin needs to see it) but never at the top of a buyer's list.
 */
function compareCatalogue(
  a: { speed: VisaSpeedCode | null; entryType: VisaEntryType | null; price: number; id: string },
  b: { speed: VisaSpeedCode | null; entryType: VisaEntryType | null; price: number; id: string },
): number {
  const rank = (speed: VisaSpeedCode | null) => (speed ? VISA_SPEED_CODES.indexOf(speed) : VISA_SPEED_CODES.length)
  const entryRank = (entry: VisaEntryType | null) => (entry ? PAYLOAD_ENTRY_TYPES.indexOf(entry) : PAYLOAD_ENTRY_TYPES.length)
  return (
    rank(a.speed) - rank(b.speed) ||
    entryRank(a.entryType) - entryRank(b.entryType) ||
    a.price - b.price ||
    a.id.localeCompare(b.id)
  )
}

/**
 * Every listing on the visa storefront, in catalogue order — the raw catalogue, including
 * rows that are hidden, unverified, or not finished being set up.
 *
 * ⚠️ MEMBERSHIP IS THE STOREFRONT, not a marker string. This seller exists to sell visa
 * services and nothing else (it is created and owned by support@eno.forum), so its listings
 * are its products. Filtering on `externalId` instead would drop exactly the listings this
 * feature is built around: the ones the admin uploads through the ordinary dashboard,
 * which carry no marker at all.
 */
export const getVisaShopListings = cache(async (): Promise<VisaShopListing[]> => {
  const seller = await getVisaShopSeller()
  if (!seller) return []
  try {
    const rows = await db.listing.findMany({
      where: { sellerId: seller.id },
      select: {
        id: true, externalId: true, title: true, titleVi: true, description: true,
        price: true, currency: true, priceUnit: true, images: true, verified: true, status: true,
        attributes: true,
      },
      // A visa desk sells a 2 × 7 grid. The cap is a runaway guard, not a page size.
      take: 200,
    })
    return rows
      .map((row): VisaShopListing => {
        let images: string[] = []
        try {
          const parsed: unknown = JSON.parse(row.images || '[]')
          images = Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === 'string') : []
        } catch { images = [] }
        const { entryType, speed } = readVisaAttributes(row.attributes)
        return {
          id: row.id, title: row.title, titleVi: row.titleVi, description: row.description,
          price: row.price, currency: row.currency, priceUnit: row.priceUnit, images,
          verified: row.verified, status: row.status, externalId: row.externalId ?? null,
          entryType, speed,
        }
      })
      .sort(compareCatalogue)
  } catch (e) {
    console.error('[visa-shop] listings lookup', e)
    return []
  }
})

/** The listings a buyer may actually start a visa thread on (the messageable set). */
export const getVisaShopProductsForSale = cache(async (): Promise<VisaShopListing[]> =>
  (await getVisaShopListings()).filter((l) => l.verified && l.status === 'active'))

/**
 * A sellable visa product, DERIVED FROM A LISTING — never from a hard-coded table.
 *
 * ⚠️ THERE IS NO USD FIELD HERE, deliberately. The dollars a buyer sees and pays are a
 * function of an FX rate at an INSTANT, so a dollar amount hanging off a cached catalogue
 * row would be a number with no expiry attached — exactly the stale-rate hazard the quote
 * exists to close. Ask src/lib/visa/fx.ts for a VisaQuote when you need dollars; it comes
 * with the rate it used and the moment it stops being valid.
 *
 * (`priceCents` used to live here as USD cents. It is gone, not renamed: a field whose
 * meaning flipped currency is the one thing a compile error must not let through.)
 */
export type VisaShopProduct = {
  listingId: string
  title: string
  entryType: VisaEntryType | null      // from Listing.attributes.visaEntryType
  speed: VisaSpeedCode | null          // from Listing.attributes.visaSpeed
  /** Listing.price — WHOLE ĐỒNG, the admin's authoritative number. */
  priceVnd: number
  /** The LISTING's currency, always đồng. Not the charge currency (that is USD). */
  currency: 'VND'
  window: VisaWindow
}

// (Nothing is scheduled for a product whose speed tier is unknown — closedVisaWindow()
// is the same fail-closed answer submissionWindow itself gives, minted per product so no
// two products in a catalogue share one mutable object.)

/**
 * Every for-sale visa listing in the shop, newest-priced-catalogue order. Cached per request.
 *
 * "Newest-priced" is literal: the amount comes off Listing.price on every read, so the
 * moment the admin edits the price in the dashboard, this is the new price — there is no
 * copy of it anywhere for the two to drift apart.
 *
 * A product the admin has not finished setting up (no entryType, no speed) STILL APPEARS,
 * with those fields null and a closed window: the admin has to be able to see the row they
 * are working on, and a buyer-facing surface can tell a half-built product from a ready one
 * by the nulls. A product whose PRICE cannot be charged honestly is a different matter and
 * is dropped — see sellablePriceVnd.
 */
export const getVisaShopProducts = cache(async (): Promise<VisaShopProduct[]> => {
  const now = new Date()
  const products: VisaShopProduct[] = []
  for (const listing of await getVisaShopProductsForSale()) {
    const priceVnd = sellablePriceVnd(listing.price, listing.currency)
    if (priceVnd === null) {
      // Loud, but PII-free: a listing id and a price are public facts.
      console.error(`[visa-shop] listing ${listing.id} has an unsellable price (${listing.price} ${listing.currency}) — set a whole number of đồng`)
      continue
    }
    products.push({
      listingId: listing.id,
      title: listing.title,
      entryType: listing.entryType,
      speed: listing.speed,
      priceVnd,
      currency: 'VND',
      window: listing.speed ? submissionWindow(listing.speed, now) : closedVisaWindow(),
    })
  }
  return products
})

/**
 * THE authoritative lookup for charging. null = not a visa product, not for sale, or unusable.
 *
 * ⚠️ THIS IS THE PRICE. A client may name WHICH listing it wants; the amount comes from
 * here and from nowhere else. Resolved by re-reading the catalogue rather than by its own
 * query, so a product can never be chargeable through this function under rules the shop
 * page did not apply (storefront ownership, for-sale, sellable price).
 */
export async function resolveVisaProduct(listingId: string): Promise<VisaShopProduct | null> {
  if (!listingId || typeof listingId !== 'string') return null
  return (await getVisaShopProducts()).find((p) => p.listingId === listingId) ?? null
}

/**
 * True once a product carries everything the application engine needs to be prefilled
 * from the CHOICE alone. False is not an error — it is a product the admin is still
 * setting up, and the caller must ask the applicant instead of guessing.
 */
export function isVisaProductReadyForAutoFill(product: VisaShopProduct | null | undefined): boolean {
  return !!product && product.entryType !== null && product.speed !== null
}

/**
 * The engine-facing prefill for a picked product: the payload fields the CHOICE itself
 * determines, taken from the LISTING's attributes rather than from any table in this file.
 *
 * null when the product has no entry type yet — a visa application is a government form,
 * so an invented single/multiple is worse than no prefill. Dates are only added when a
 * start date is given, because visaDateDefaultsForStart() only knows the 90-day window
 * (the one window the engine produces; validateVisaForReview rejects anything longer).
 * ⚠️ src/lib/sync-pairs.test.ts byte-couples src/lib/visa/schema.ts to the forum copy, so
 * the date rule cannot be changed here alone.
 */
export function visaPrefillForProduct(
  product: Pick<VisaShopProduct, 'entryType'>,
  startDate?: string,
): Partial<VisaPayload> | null {
  if (!product?.entryType) return null
  const base: Partial<VisaPayload> = { entryType: product.entryType, stayLengthDays: MAX_EVISA_VALIDITY_DAYS }
  if (!startDate) return base
  return { ...visaDateDefaultsForStart(startDate), ...base }
}

/**
 * The visa product a listing sells, or null. Back-compat alias of resolveVisaProduct —
 * same rules, same answer. Prefer resolveVisaProduct in new code.
 */
export const visaProductForListing = async (listingId: string): Promise<VisaShopProduct | null> =>
  resolveVisaProduct(listingId)

/**
 * Is this listing part of the visa storefront's catalogue at all? Deliberately WIDER than
 * resolveVisaProduct: a hidden or half-built product is still a visa listing, and a surface
 * asking "should I render visa chrome here?" must say yes for it. Use resolveVisaProduct
 * — never this — before charging anything.
 */
export async function isVisaShopListing(listingId: string): Promise<boolean> {
  if (!listingId) return false
  return (await getVisaShopListings()).some((l) => l.id === listingId)
}

/** Listing.externalId of the hidden $0 anchor a GENERIC (product-less) case binds to. */
export const VISA_GENERIC_ANCHOR_EXTERNAL_ID = `${VISA_PRODUCT_EXTERNAL_PREFIX}generic`

/**
 * The "Generic Visa Application" anchor listing, or null when the deployment has not
 * seeded it. Deliberately looked up by externalId over the RAW storefront read (hidden
 * rows included): the anchor is status='hidden' + price 0 by design, so it can never be
 * resolved as a product, never be charged, and never appear in any public surface — it
 * exists only so a product-less case's conversation has a truthful listing to sit on.
 */
export async function findVisaGenericAnchor(): Promise<VisaShopListing | null> {
  return (await getVisaShopListings()).find((l) => l.externalId === VISA_GENERIC_ANCHOR_EXTERNAL_ID) ?? null
}
