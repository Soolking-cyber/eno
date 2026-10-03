import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { categoryFor, subcategoryFor, withoutGiftClause } from '@/lib/feed-taxonomy'
import { conditionWhere } from '@/lib/listing-condition'
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
  /** The shop's storefront name (only ownerless import storefronts are read). */
  seller: string
  /** How many live listings offer this exact variant (after the price guard). */
  offers: number
  /** Every row here is second-hand — `lowestPrices` selects nothing else; model-product-ld.ts checks it. */
  condition: 'used'
  /** The quoted listing reaches its shop through a tracked affiliate link — the AffiliateNote shows only then. */
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
    seller: { ownerId: null },
    AND: [conditionWhere('used')!],
  }
}

export async function lowestPrices(models: string[] = IPHONE_18_MODELS): Promise<PriceLookup> {
  let rows: {
    id: string; title: string; titleVi: string | null; price: number; currency: string
    model: string | null; affiliateUrl: string | null; images: string; seller: { name: string } | null
  }[] = []
  try {
    rows = await db.listing.findMany({
      where: await scopedListingWhere(usedPriceWhere(models)),
      select: {
        id: true, title: true, titleVi: true, price: true, currency: true, model: true,
        affiliateUrl: true, images: true, seller: { select: { name: true } },
      },
    })
  } catch {
    // DB unreachable at build time — the page still renders its editorial half, and ISR fills this
    // in on the next pass. Same contract as the listing rail in <SeoLanding>.
    return { rows: [], known: false }
  }

  // Group by (model, storage) first, so the outlier guard sees each tier whole.
  const tiers = new Map<string, PriceRow[]>()
  for (const r of rows) {
    const name = r.titleVi || r.title
    if (looksLikeAnAccessory(name)) continue
    const parsed = storageOf(name)
    if (!parsed || !r.model) continue
    const { label: storage, gb: storageGb } = parsed
    const key = `${r.model}|${storage}`
    const tier = tiers.get(key) ?? []
    tier.push({
      model: r.model, storage, storageGb, price: Number(r.price), currency: r.currency,
      listingId: r.id, seller: r.seller?.name ?? '', offers: 1, condition: 'used',
      tracked: isTracked(r.affiliateUrl), image: firstImage(r.images),
    })
    tiers.set(key, tier)
  }

  const byModel = new Map<string, PriceRow[]>()
  for (const tier of tiers.values()) byModel.set(tier[0].model, [...(byModel.get(tier[0].model) ?? []), ...tier])

  const best: PriceRow[] = []
  for (const tier of tiers.values()) {
    if (!onSaleYet(tier[0].model)) continue
    const kept = plausibleTier(tier, byModel.get(tier[0].model) ?? tier, APPLE_VN_FROM_PRICE[tier[0].model])
    if (!kept.length) continue
    // ⚠️ Price first, always; a tie goes to the tracked link (see `isTracked`).
    const floor = kept.reduce((a, b) => (b.price < a.price || (b.price === a.price && b.tracked && !a.tracked) ? b : a))
    best.push({ ...floor, offers: kept.length })
  }

  return {
    rows: best.sort((a, b) => a.model.localeCompare(b.model) || a.storageGb - b.storageGb),
    known: true,
  }
}
