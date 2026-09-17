import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { categoryFor, subcategoryFor, withoutGiftClause } from '@/lib/feed-taxonomy'

/**
 * The live floor price for each iPhone 18 variant sold on this marketplace.
 *
 * ⚠️ THE PAGE AND ITS STRUCTURED DATA READ THE SAME ROWS. An ItemList assembled from a second query
 * can disagree with the table a human sees — different sort, different moment, different answer —
 * and the disagreement is invisible until a rich result quotes a price the page does not show.
 */

/**
 * ⚠️ EXACT VALUES, BECAUSE `Listing.model` IS FREE TEXT. There is no Model table (see
 * `/api/brands/[slug]/models`, which groups this column on demand), so a family is a list, not a
 * prefix. Apple's 2026 autumn line is Pro and Pro Max only — the plain iPhone 18, the 18e and the
 * Air 2 are expected in spring 2027 and get added here when they exist, not before.
 */
export const IPHONE_18_MODELS = ['iPhone 18 Pro', 'iPhone 18 Pro Max']

/**
 * ⚠️ THE FOLDABLE IS LISTED HERE ALREADY — MEASURED, AFTER ASSUMING OTHERWISE. The affiliate sweep
 * found no iPhone Duo row in any of the 22 approved feeds, and the first version of this page said
 * so in prose. It was wrong: Thế Giới Di Động and Bạch Long both carry pre-order pages, 8 live
 * listings from 64.990.000 ₫ to 103.990.000 ₫, imported by the partner-shop crawler rather than an
 * affiliate feed. A claim about inventory belongs in a query, not in a sentence.
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
  seller: string
  /** How many live listings offer this exact variant. */
  offers: number
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

export async function lowestPrices(models: string[] = IPHONE_18_MODELS): Promise<PriceLookup> {
  let rows: {
    id: string; title: string; titleVi: string | null; price: number; currency: string
    model: string | null; affiliateUrl: string | null; seller: { name: string } | null
  }[] = []
  try {
    rows = await db.listing.findMany({
      /**
       * ⛔ BRAND AND MODEL ARE NOT ENOUGH, AND BOTH REVIEWERS REACHED THE SAME STATE FROM DIFFERENT
       * DIRECTIONS. This query publishes a headline price and a schema.org Offer that the copy
       * attributes to "a Vietnamese retailer with the Apple Vietnam warranty", so it has to select
       * exactly those rows:
       *   · `subcategorySlug` — an accessory that kept a phone's model (the repair script skips
       *     human sellers by design) would otherwise underbid every phone at ₫200,000.
       *   · `seller.ownerId: null` — imported retail catalogues only. One private listing of a used
       *     handset at ₫18,000,000 would become "the lowest price", under a sentence promising a
       *     retailer's warranty.
       *   · `currency` — a USD listing is a smaller NUMBER, so it wins a đồng comparison and then
       *     renders as "1.200 ₫". Cross-currency minima need a rate; this page needs one currency.
       */
      where: await scopedListingWhere({
        status: 'active',
        verified: true,
        brandSlug: 'apple',
        model: { in: models },
        subcategorySlug: 'phones-tablets',
        currency: '₫',
        seller: { ownerId: null },
      }),
      select: {
        id: true, title: true, titleVi: true, price: true, currency: true, model: true,
        affiliateUrl: true, seller: { select: { name: true } },
      },
    })
  } catch {
    // DB unreachable at build time — the page still renders its editorial half, and ISR fills this
    // in on the next pass. Same contract as the listing rail in <SeoLanding>.
    return { rows: [], known: false }
  }

  const best = new Map<string, PriceRow & { tracked: boolean }>()
  for (const r of rows) {
    const name = r.titleVi || r.title
    if (looksLikeAnAccessory(name)) continue
    const parsed = storageOf(name)
    if (!parsed || !r.model) continue
    const { label: storage, gb: storageGb } = parsed
    const key = `${r.model}|${storage}`
    const tracked = isTracked(r.affiliateUrl)
    const current = best.get(key)
    const candidate = {
      model: r.model, storage, storageGb, price: Number(r.price), currency: r.currency,
      listingId: r.id, seller: r.seller?.name ?? '', offers: (current?.offers ?? 0) + 1, tracked,
    }
    if (!current) { best.set(key, candidate); continue }
    const cheaper = candidate.price < current.price
    const tiedAndTracked = candidate.price === current.price && candidate.tracked && !current.tracked
    best.set(key, cheaper || tiedAndTracked ? { ...candidate, offers: current.offers + 1 } : { ...current, offers: current.offers + 1 })
  }

  return {
    rows: [...best.values()]
      .map(({ tracked: _tracked, ...row }) => row)
      .sort((a, b) => a.model.localeCompare(b.model) || a.storageGb - b.storageGb),
    known: true,
  }
}
