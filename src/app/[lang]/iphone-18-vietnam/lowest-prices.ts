import { enoRunPartnerWhere } from '@/lib/eno-run-partners'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { categoryFor, subcategoryFor, withoutGiftClause } from '@/lib/feed-taxonomy'
import { conditionWhere } from '@/lib/listing-condition'
import { NEW_APPLE_IPHONE_MODELS, newAppleOfferWhere, newAppleShopRank } from '@/lib/new-apple'
import { partnerBuyUrlOf } from '@/lib/partner-buy'
import { safeParse } from '@/lib/serialize'
import { APPLE_VN_FROM_PRICE, onSaleYet, plausibleTier } from './price-guard'

/**
 * The live floor price for each iPhone variant, from SECOND-HAND listings on this marketplace.
 *
 * ⛔ USED ONLY, SINCE THE SECOND-HAND FOCUS (owner, 2026-10-03: "tight focus on second hand stores and
 * rentals plus job postings"). These tables used to read new-retail rows (CellphoneS, Thế Giới Di Động,
 * Bạch Long's sealed stock), all hidden that day. They now read `condition: 'used'` rows of the SHOPS —
 * ownerless import storefronts (24hStore, Minh Tuấn Mobile, Điện Thoại Vui, CellphoneS' used shelf…).
 * ⛔ SHOPS ONLY, NOT PRIVATE SELLERS (commit-gate review, two rounds): with a person's own listing in the
 * set, one typo or one scam lure priced to be clicked becomes the page's headline, its FAQ answer and the
 * Product `lowPrice`, with their photo in the rich result — and every threshold guard tried was beaten by
 * a price inside it. Measured 2026-10-03: all 869 live Apple phones-tablets rows are shop rows, so this
 * costs nothing today. `listingType: 'sell'` is pinned and price-guard.ts still drops a shop's typo.
 * Apple Vietnam's own prices are quoted as Apple's,
 * in the page copy, never as a row here.
 *
 * ── AND, SINCE 2026-11-26, NEW UNITS FROM THREE SHOPS (`lowestNewPrices`) ──
 * Owner: "search accesstrade shops for new iphone model affiliate products import them and link to our organic posts". The
 * new iPhone 18 Pro / Pro Max / Duo rows of ShopDunk, CellphoneS and Hoàng Hà Mobile (src/lib/new-apple.ts) are read by a
 * SIBLING of the used read, never by widening it: `newAppleOfferWhere` is exact `condition: 'new'`, the `new:` namespace and the
 * three pinned storefronts by id — no ownerless arm, so a stranger's "new iPhone 18" is never quoted as a shop price — and the
 * used read's `conditionWhere('used')` excludes every one of them, so no row is counted in both tables.
 *
 * ⚠️ THE PAGE AND ITS STRUCTURED DATA READ THE SAME ROWS. Markup assembled from a second query can
 * disagree with the table a human sees — different sort, different moment, different answer — and
 * the disagreement is invisible until a rich result quotes a price the page does not show.
 */

/**
 * ⚠️ EXACT VALUES, BECAUSE `Listing.model` IS FREE TEXT. There is no Model table (see
 * `/api/brands/[slug]/models`, which groups this column on demand), so a family is a list, not a
 * prefix. Apple's 2026 autumn line is Pro and Pro Max only — the plain iPhone 18, the 18e and the
 * Air 2 are expected in spring 2027 and get added here when they exist, not before.
 */
export const IPHONE_18_MODELS = ['iPhone 18 Pro', 'iPhone 18 Pro Max']

/**
 * The 2025 line — the newest phones with real second-hand supply here (measured 2026-10-03: used iPhone 17
 * 17 rows, 17 Pro 25, 17 Pro Max 40, Air 14, from 4–7 shops each), so the hub can show a second-hand price
 * table while the iPhone 18 has none.
 */
export const IPHONE_17_MODELS = ['iPhone 17', 'iPhone 17 Pro', 'iPhone 17 Pro Max', 'iPhone Air']

/**
 * ⚠️ A CLAIM ABOUT INVENTORY BELONGS IN A QUERY, NOT IN A SENTENCE — the first version of the Duo card said
 * no retailer listed one while eight pre-order rows were live. Those were new retail stock (hidden
 * 2026-10-03); the card now reads second-hand Duo rows, of which there are none until units resell.
 */
export const IPHONE_DUO_MODEL = 'iPhone Duo'

export type PriceRow = {
  model: string
  /** "256GB", "1TB" — as the retailers write it. */
  storage: string
  /** Storage in GB, for ordering only. */
  storageGb: number
  price: number
  currency: string
  listingId: string
  /** The shop's storefront name (only shops are read: ownerless import storefronts, eno-run ones, the three new-Apple shops). */
  seller: string
  /** How many live listings offer this exact variant (after the price guard). */
  offers: number
  /**
   * The highest price among those `offers` listings — what model-product-ld.ts publishes as `highPrice`, so the
   * AggregateOffer's low, high and count describe ONE set of listings (the floor alone is not the ceiling of a tier).
   */
  ceiling: number
  /** `lowestPrices` selects second-hand rows only, `lowestNewPrices` new ones only; the tables say which. */
  condition: 'used' | 'new'
  /**
   * The quoted listing may earn this site a commission — the AffiliateNote shows only then. A used row: a tracked public
   * `affiliateUrl`, or an eno-run partner's live listing whose staff purchase link is the chat's "Buy now" (partner-buy.ts
   * `partnerBuyUrlOf`, the same rule the chat applies). A new row: always — the line exists to be bought through Buy now.
   */
  tracked: boolean
  /**
   * The first photo of `listingId` — the same listing the price links to, so the model page's
   * Product image is a photo of a unit this table is actually quoting. Null when it has none.
   */
  image: string | null
}

/** The first stored photo URL, or null. `Listing.images` is a JSON string column. */
function firstImage(images: string): string | null {
  const parsed = safeParse<unknown>(images, [])
  const first = Array.isArray(parsed) ? parsed.find((u): u is string => typeof u === 'string' && u.length > 0) : undefined
  return first ?? null
}

/**
 * ⚠️ THE LARGEST CAPACITY IN THE TITLE, NOT THE FIRST ONE. Vietnamese retailers write RAM and
 * storage as one pair — "MacBook Pro 14 M4 10 CPU/16GB/512GB", "vivo Y05e 4GB/64GB" — and 910 live
 * titles do, so a first-match parse publishes "16GB" as the storage tier, in the visible table AND
 * in the Product JSON-LD. No iPhone 18 title carries a RAM token today (measured: zero), which is
 * exactly why this had to be fixed from the rule rather than from the symptom.
 */
const STORAGE_G = /(\d+)\s*(TB|GB|G)\b/gi

/**
 * ⛔ THE PAGE MUST NOT DEPEND ON A REPAIR SCRIPT HAVING BEEN RUN. `subcategorySlug` is exactly the
 * column that was wrong on 95 rows — 79 of them carrying `model = "iPhone 18 Pro Max"` on a phone
 * case — and the rules that fix it only bind FUTURE imports; the existing rows were repaired by
 * hand. Deploy this page against a database where that has not happened and a ₫500,000 Wiwu case is
 * the "lowest iPhone 18 Pro Max price", in the visible table and in the Product/Offer JSON-LD
 * (opus). Re-deriving the shelf from the title here costs nothing and removes the ordering
 * dependency entirely: a row has to look like a phone by BOTH the stored shelf and the rules.
 */
const ACCESSORY_SHELVES = new Set(['phone-cases', 'screen-protectors', 'cables-chargers', 'power-banks', 'accessories'])

const looksLikeAnAccessory = (name: string) => {
  const shelf = subcategoryFor(categoryFor(name), name)
  return shelf !== null && ACCESSORY_SHELVES.has(shelf)
}

function storageOf(rawName: string): { label: string; gb: number } | null {
  // ⚠️ THE GIFT IS NOT THE PRODUCT HERE EITHER — "… 256GB (Tặng thẻ nhớ 512GB)" would publish a
  // 256GB phone in the 512GB tier, at the 256GB price, in the table AND the Offer (agy).
  const name = withoutGiftClause(rawName)
  let best: { label: string; gb: number } | null = null
  for (const m of name.matchAll(STORAGE_G)) {
    // ⚠️ "5G" IS A NETWORK, NOT A CAPACITY. The bare-G form below exists for "64G"; without a floor it
    // also read "iPhone 18 Pro 5G" as a 5GB tier and minted a fake variant into the table and the
    // Offer list (agy). No phone has shipped with less than 16GB of storage in a decade.
    if (m[2].toUpperCase() === 'G' && Number(m[1]) < 16) continue
    // ⚠️ "64G" IS HOW HALF THIS MARKET WRITES IT — the repo's own fixtures carry "iPad Air 5 64G"
    // (agy). Requiring the full "GB" dropped those rows out of the table and out of the Offer list
    // silently, which is the worst way for a price page to be wrong.
    const unit = m[2].toUpperCase() === 'TB' ? 'TB' : 'GB'
    const gb = Number(m[1]) * (unit === 'TB' ? 1024 : 1)
    if (!best || gb > best.gb) best = { label: `${m[1]}${unit}`, gb }
  }
  return best
}

/**
 * ⚠️ TIE-BREAK TOWARDS THE TRACKED PARTNER, NEVER PRICE. Most variants are listed at the identical
 * đồng amount by three retailers (Apple sets VN retail), so "the cheapest" is a coin toss the page
 * has to settle anyway — and one of those sellers pays a commission on the click. The order is
 * price first and always: a tracked link never outranks a genuinely cheaper untracked one, which is
 * the line between a price table and an advert (agy raised the monetisation, astra the honesty).
 * ⚠️ AN ENO-RUN PARTNER'S "Buy now" COUNTS AS TRACKED TOO (2026-11-26, `PriceRow.tracked`): its public `affiliateUrl` is NULL and
 * it earns through the chat, so the tie and the AffiliateNote ("the one with the tracked link is shown") follow what earns.
 */
const isTracked = (url: string | null) => /isclix\.com|accesstrade/i.test(url ?? '')

/**
 * ⛔ "NO ROWS" AND "COULD NOT LOOK" ARE DIFFERENT ANSWERS, AND ONLY ONE OF THEM IS SAFE TO PRINT.
 * `<SeoLanding>` carries this exact warning about its own rail; this file repeated the mistake it
 * warns about, because the catch below also returns an empty array — so a database that was
 * unreachable AT BUILD TIME would render "No retailer has listed one here yet" on a page that
 * caches for an hour and ranks for the query (opus). `known` is true only when the query returned.
 */
export type PriceLookup = { rows: PriceRow[]; known: boolean }

/**
 * The rows a price table quotes — exported so the sitemap dates the page by the same set (build.ts).
 * ⛔ BRAND AND MODEL ARE NOT ENOUGH:
 *   · `subcategorySlug` — an accessory that kept a phone's model would otherwise underbid every phone;
 *   · `currency` — a USD listing is a smaller NUMBER and would win a đồng comparison;
 *   · `listingType: 'sell'` — a "wanted, budget X" post is a price nobody is selling at;
 *   · `condition: 'used'` (conditionWhere — the feed's own used predicate) and `seller.ownerId: null`
 *     (a shop, not a person) — see the header.
 */
export function usedPriceWhere(models: readonly string[]) {
  return {
    status: 'active',
    verified: true,
    listingType: 'sell',
    brandSlug: 'apple',
    model: { in: [...models] },
    subcategorySlug: 'phones-tablets',
    currency: '₫',
    // ⛔ A SHOP's listing, never a person's own (see the header).
    // …or one eno itself runs (a pinned pair, src/lib/eno-run-partners.ts) — a shop, not a person.
    seller: { OR: [{ ownerId: null }, ...enoRunPartnerWhere()] },
    AND: [conditionWhere('used')!],
  }
}

/**
 * ⛔ THE SAME PARSING AND THE SAME GUARD FOR BOTH TABLES. Each candidate is grouped by (model, storage); a model not yet on sale
 * is dropped (`onSaleYet`); each tier is run through `plausibleTier` against its own model's rows OF THE SAME TABLE (a new and a
 * used price are different markets — the used yardstick would call Apple's own price an outlier upward); the floor of what is
 * left is the row, `offers` its size and `ceiling` its top. `better(challenger, holder)` says whether a kept row takes the floor.
 */
type Candidate = PriceRow & { rank: number }
function floorsOf(candidates: Candidate[], better: (challenger: Candidate, holder: Candidate) => boolean): PriceRow[] {
  // Group by (model, storage) first, so the outlier guard sees each tier whole.
  const tiers = new Map<string, Candidate[]>()
  for (const c of candidates) {
    const key = `${c.model}|${c.storage}`
    tiers.set(key, [...(tiers.get(key) ?? []), c])
  }

  const byModel = new Map<string, Candidate[]>()
  for (const tier of tiers.values()) byModel.set(tier[0].model, [...(byModel.get(tier[0].model) ?? []), ...tier])

  const best: PriceRow[] = []
  for (const tier of tiers.values()) {
    if (!onSaleYet(tier[0].model)) continue
    const kept = plausibleTier(tier, byModel.get(tier[0].model) ?? tier, APPLE_VN_FROM_PRICE[tier[0].model])
    if (!kept.length) continue
    const { rank, ...floor } = kept.reduce((holder, challenger) => (better(challenger, holder) ? challenger : holder))
    void rank
    best.push({ ...floor, offers: kept.length, ceiling: Math.max(...kept.map((r) => r.price)) })
  }
  return best.sort((a, b) => a.model.localeCompare(b.model) || a.storageGb - b.storageGb)
}

/** A row as both reads select it, parsed into a candidate — or null when it is an accessory or names no storage tier. */
function candidateOf(
  r: { id: string; title: string; titleVi: string | null; price: number; currency: string; model: string | null; images: string; seller: { name: string } | null },
  condition: PriceRow['condition'], tracked: boolean, rank: number,
): Candidate | null {
  const name = r.titleVi || r.title
  if (looksLikeAnAccessory(name)) return null
  const parsed = storageOf(name)
  if (!parsed || !r.model) return null
  return {
    model: r.model, storage: parsed.label, storageGb: parsed.gb, price: Number(r.price), currency: r.currency,
    listingId: r.id, seller: r.seller?.name ?? '', offers: 1, ceiling: Number(r.price), condition,
    tracked, image: firstImage(r.images), rank,
  }
}

export async function lowestPrices(models: string[] = IPHONE_18_MODELS): Promise<PriceLookup> {
  let rows: {
    id: string; title: string; titleVi: string | null; price: number; currency: string
    model: string | null; affiliateUrl: string | null; images: string
    status: string; verified: boolean; sellerId: string
    seller: { name: string; ownerId: string | null; officialPartner: boolean }
    purchaseLink: { url: string } | null
  }[] = []
  try {
    rows = await db.listing.findMany({
      where: await scopedListingWhere(usedPriceWhere(models)),
      select: {
        id: true, title: true, titleVi: true, price: true, currency: true, model: true,
        affiliateUrl: true, images: true, status: true, verified: true, sellerId: true,
        seller: { select: { name: true, ownerId: true, officialPartner: true } },
        // ⚠️ READ FOR A YES/NO ONLY. The staff link never leaves this function: `tracked` is a boolean on the row.
        purchaseLink: { select: { url: true } },
      },
    })
  } catch {
    // DB unreachable at build time — the page still renders its editorial half, and ISR fills this
    // in on the next pass. Same contract as the listing rail in <SeoLanding>.
    return { rows: [], known: false }
  }

  const candidates = rows.flatMap((r) => {
    // An eno-run partner's row earns through the chat's Buy now, not a public link (partner-buy.ts): the same test the chat runs.
    const tracked = isTracked(r.affiliateUrl) || partnerBuyUrlOf(r) !== null
    const c = candidateOf(r, 'used', tracked, 0)
    return c ? [c] : []
  })
  // ⚠️ Price first, always; a tie goes to the tracked link (see `isTracked`).
  return {
    rows: floorsOf(candidates, (c, h) => c.price < h.price || (c.price === h.price && c.tracked && !h.tracked)),
    known: true,
  }
}

/**
 * The rows the NEW table quotes — `newAppleOfferWhere` (src/lib/new-apple.ts, the one predicate for these rows), held to the
 * phones shelf like the used rows (`usedPriceWhere`'s reason: an accessory that kept a phone's model). Exported so the sitemap
 * dates the pages by the same set (build.ts).
 */
export function newPriceWhere(models: readonly string[]) {
  return { ...newAppleOfferWhere(models.filter((m) => NEW_APPLE_IPHONE_MODELS.includes(m))), subcategorySlug: 'phones-tablets' }
}

/**
 * The cheapest NEW unit per (model, storage tier) from the three shops (see the header), as PriceRows with `condition: 'new'`.
 * ⚠️ TIES ARE THE NORM, NOT THE EXCEPTION: most shops list a tier at Apple Vietnam's set price, so the order is price, then the
 * shop's NAME (`newAppleShopRank` — never what it pays), then the listing id — the same answer on every
 * render, never whichever row the database returned first. All three shops pay, so the rank only settles a coin toss; it never
 * outranks a cheaper price.
 * `known` false = the read failed; zero rows with `known` true = none listed (the import has not run, or every unit sold out).
 */
export async function lowestNewPrices(models: readonly string[] = NEW_APPLE_IPHONE_MODELS): Promise<PriceLookup> {
  let rows: {
    id: string; title: string; titleVi: string | null; price: number; currency: string
    model: string | null; images: string; sellerId: string; seller: { name: string } | null
  }[] = []
  try {
    rows = await db.listing.findMany({
      where: await scopedListingWhere(newPriceWhere(models)),
      select: {
        id: true, title: true, titleVi: true, price: true, currency: true, model: true,
        images: true, sellerId: true, seller: { select: { name: true } },
      },
    })
  } catch {
    return { rows: [], known: false }
  }

  const candidates = rows.flatMap((r) => {
    const c = candidateOf(r, 'new', true, newAppleShopRank(r.sellerId))
    return c ? [c] : []
  })
  const better = (c: Candidate, h: Candidate) =>
    c.price !== h.price ? c.price < h.price : c.rank !== h.rank ? c.rank < h.rank : c.listingId < h.listingId
  return { rows: floorsOf(candidates, better), known: true }
}

/**
 * One row per model — the cheapest tier of each, in `models` order — for the short "iPhone 18 on eno.vn" block in the buying
 * guides (new-offers-block.tsx). A model with no row is simply absent.
 */
export function cheapestPerModel(rows: PriceRow[], models: readonly string[] = NEW_APPLE_IPHONE_MODELS): PriceRow[] {
  return models.flatMap((m) => {
    const own = rows.filter((r) => r.model === m)
    return own.length ? [own.reduce((a, b) => (b.price < a.price ? b : a))] : []
  })
}
