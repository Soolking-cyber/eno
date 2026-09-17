import Link from 'next/link'
import { Tr } from '@/context/language-context'
import { ArrowRight } from '@/components/ui/icons'
import { Price } from '@/components/marketplace/price'
import type { PriceRow } from './lowest-prices'

/**
 * Apple's first foldable: what Vietnamese retailers are charging for it, and what Apple says it
 * costs.
 *
 * ⛔ THE INVENTORY SENTENCE IS A QUERY, NOT A CLAIM. This card first read "no retailer is listing
 * the Duo yet — it has not shipped", written from the affiliate sweep (zero Duo rows across all 22
 * approved feeds) and simply false: the partner-shop crawler had already imported **eight live
 * pre-order listings**, 64.990.000 ₫ to 103.990.000 ₫, from Thế Giới Di Động and Bạch Long. Both
 * reviewers flagged the SHAPE of the bug before the data showed it — a hardcoded "not yet" on an
 * hourly-revalidating page rots silently, and 23 October would have made it wrong for everyone. The
 * card now renders whatever the catalogue holds, on either side of that date.
 */

/**
 * ⚠️ AMOUNTS, FORMATTED BY vnd.ts — not pre-typed strings. A literal "64.999.000 ₫" is a second
 * formatter by another name: it freezes Vietnamese separators into a page whose other prices follow
 * the reader's locale, and design-lint's money rule exists because every such hand-roll has
 * eventually disagreed with the component beside it (opus caught this one on review). These are
 * Apple Vietnam's published RRP — the fallback shown only while nobody is listing one.
 */
const DUO_RRP: [string, number][] = [
  ['256GB', 64_999_000],
  ['512GB', 71_490_000],
  ['1TB', 84_499_000],
  ['2TB', 103_999_000],
]

export function DuoCard({ rows, known, checked }: { rows: PriceRow[]; known: boolean; checked: string }) {
  const listed = rows.length > 0

  return (
    <section className="mt-8 rounded-xl border border-border p-5" aria-labelledby="iphone-duo">
      <p className="eyebrow text-accent-foreground mb-1"><Tr text="On sale 23 October 2026" /></p>
      <h2 id="iphone-duo" className="h-section text-foreground">
        <Tr text="iPhone Duo — the foldable, and what it costs here" />
      </h2>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-body">
        {/* ⚠️ NO MONEY INSIDE THE SENTENCE. An amount typed into translated copy is a second money
            formatter with US separators ("103,999,000") sitting three lines above vnd.ts output with
            Vietnamese ones — opus caught both conventions in one card. The figures live in the table
            below, where formatMoneyFull and <Price> render them. */}
        <Tr text="Apple's first folding iPhone: a 5.4-inch cover display that opens to 7.6 inches, the A20 Pro chip and a 48MP Dual Fusion camera, in Starlight White and Midnight Blue. Vietnamese pre-orders open at 7pm on 16 October 2026 and deliveries start on 23 October — and the 2TB model is the first iPhone to pass 100 million dong in Vietnam." />
      </p>

      {listed ? (
        <table className="mt-4 w-full max-w-md text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="pb-2 font-semibold"><Tr text="Storage" /></th>
              <th scope="col" className="pb-2 font-semibold"><Tr text="Lowest price" /></th>
              <th scope="col" className="pb-2 font-semibold"><Tr text="Seller" /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.storage} className="border-t border-border">
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
      ) : (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          {DUO_RRP.map(([storage, price]) => (
            <div key={storage}>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{storage}</dt>
              <dd className="font-semibold text-foreground">
                <Price native price={price} currency="₫" priceUnit="" dual={false} className="text-sm leading-tight" />
              </dd>
            </div>
          ))}
        </dl>
      )}

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        {/* ⚠️ THREE STATES, NOT TWO. The middle one — the catalogue could not be read — must not be
            reported as "nobody is listing one": that sentence would then be a build outage
            masquerading as a fact, cached for an hour (opus). */}
        {listed
          ? <><Tr text="Live pre-order prices from Vietnamese retailers, checked" /> {checked}. <Tr text="Apple Vietnam's own recommended price starts at" /> <Price native price={64_999_000} currency="₫" priceUnit="" dual={false} className="inline text-xs" />.</>
          : known
            ? <><Tr text="Apple Vietnam recommended retail prices, announced 9 September 2026. No retailer has listed one here yet, as of" /> {checked}.</>
            : <Tr text="Apple Vietnam recommended retail prices, announced 9 September 2026." />}
      </p>
      <Link
        href={listed
          ? '/?category=electronics&subcategory=phones-tablets&brand=apple&model=iPhone+Duo'
          : '/?category=electronics&subcategory=phones-tablets&brand=apple'}
        className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent-foreground hover:underline"
      >
        {listed ? <Tr text="See every iPhone Duo listing" /> : <Tr text="Browse Apple phones listed today" />}
        {' '}<ArrowRight className="h-4 w-4" />
      </Link>
    </section>
  )
}
