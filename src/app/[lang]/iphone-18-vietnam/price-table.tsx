import Link from 'next/link'
import { Tr } from '@/context/language-context'
import { ArrowRight } from '@/components/ui/icons'
import { Price } from '@/components/marketplace/price'
import type { PriceRow } from './lowest-prices'

/**
 * The answer the visitor searched for, at the top of the page: what each iPhone 18 variant costs
 * here today, per storage tier, with the listing behind every figure.
 *
 * ⚠️ EVERY NUMBER IS A LINK TO THE LISTING IT CAME FROM. A price table that cannot be checked is a
 * claim; one that can is the marketplace's own inventory, which is also what makes this page
 * something other than a scrape of retail prices (both plan reviewers flagged the difference).
 */
export function PriceTable({ rows, known, updated }: { rows: PriceRow[]; known: boolean; updated: string }) {
  /**
   * ⚠️ RENDERING NOTHING IS ONLY HONEST WHEN THE CATALOGUE WAS ACTUALLY READ. The intro two lines
   * above promises "every price below comes from a live listing"; on a build where the database was
   * unreachable this component returned null and left that promise pointing at empty space (agy).
   */
  if (rows.length === 0) {
    return known ? null : (
      <p className="mt-8 text-sm text-body">
        <Tr text="Live prices could not be read just now — they are back on the next refresh." />
      </p>
    )
  }
  const models = [...new Set(rows.map((r) => r.model))]
  // ⚠️ THE COUNT AND THE DATE ARE FORMATTED OUTSIDE THE SENTENCE. Interpolating them into the
  // translated string would split it into three fragments, and the MT layer translates whole
  // sentences — a fragment like "listings from Vietnamese retailers, checked" has no verb and comes
  // back as nonsense in Vietnamese or Korean.
  const offers = rows.reduce((n, r) => n + r.offers, 0)

  return (
    <section className="mt-8" aria-labelledby="live-prices">
      <h2 id="live-prices" className="h-section text-foreground mb-1">
        <Tr text="iPhone 18 prices in Vietnam today" />
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        <Tr text="The lowest live price across every listing from a Vietnamese retailer. Tap a price to open the listing." />{' '}
        {/* ⚠️ THE NOUN IS TRANSLATED, THE NUMBER AND DATE ARE NOT. An English "24 listings" baked
            into the stamp is the one fragment a Vietnamese reader would still see in English. */}
        <span className="whitespace-nowrap">{offers} <Tr text="listings" /> · {updated}</span>
      </p>
      <div className="grid gap-6 sm:grid-cols-2">
        {models.map((model) => (
          <div key={model} className="rounded-xl border border-border p-4">
            <h3 className="text-sm font-bold text-foreground">{model}</h3>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="pb-2 font-semibold"><Tr text="Storage" /></th>
                  <th scope="col" className="pb-2 font-semibold"><Tr text="Lowest price" /></th>
                  <th scope="col" className="pb-2 font-semibold"><Tr text="Seller" /></th>
                </tr>
              </thead>
              <tbody>
                {rows.filter((r) => r.model === model).map((r) => (
                  <tr key={`${r.model}-${r.storage}`} className="border-t border-border">
                    <th scope="row" className="py-2 pr-3 text-left font-semibold text-foreground">{r.storage}</th>
                    <td className="py-2 pr-3">
                      <Link href={`/listings/${r.listingId}`} className="font-semibold text-accent-foreground hover:underline">
                        <Price native price={r.price} currency={r.currency} priceUnit="" dual={false} className="text-sm leading-tight" />
                      </Link>
                    </td>
                    <td className="py-2 text-body">
                      {r.seller}
                      {r.offers > 1 && <span className="text-muted-foreground"> +{r.offers - 1}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <Link
        href="/?category=electronics&subcategory=phones-tablets&brand=apple&q=iPhone+18"
        className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent-foreground hover:underline"
      >
        <Tr text="See every iPhone 18 listing" /> <ArrowRight className="h-4 w-4" />
      </Link>
    </section>
  )
}

/**
 * ⛔ RENDERED BY THE PAGE, NOT BY A TABLE, AND THAT IS THE FIX RATHER THAN THE STYLE. It lived
 * inside <PriceTable>, which returns null when the iPhone 18 rows are empty — so on the day the Pro
 * listings lapse and only the Duo pre-orders remain, the page would still print a monetised price
 * table, ordered by a tie-break that favours tracked partner links, with no disclosure anywhere
 * (opus). A page that earns commission says so for as long as it shows a price.
 */
export function AffiliateNote() {
  return (
    <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
      <Tr text="Some listings reach the retailer through a tracked partner link, which may earn this site a commission at no cost to you. The lowest price always wins; when two retailers charge exactly the same, the partner is the one shown. The price you pay is the retailer's." />
    </p>
  )
}
