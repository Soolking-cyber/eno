import Link from 'next/link'
import { LocalizedLink } from '@/components/marketplace/localized-link'
import type { ReactNode } from 'react'
import { Tr } from '@/context/language-context'
import { Bilingual } from '@/components/marketplace/bilingual'
import { ArrowRight } from '@/components/ui/icons'
import { Price } from '@/components/marketplace/price'
import { NEW_APPLE_SHOPS } from '@/lib/new-apple'
import type { PriceRow } from './lowest-prices'

/**
 * The answer the visitor searched for, at the top of the page: what each iPhone variant sells for here today, per storage
 * tier, with the listing behind every figure. Two kinds, never mixed in one table (`condition`):
 *   · 'used' — SECOND-HAND units from the shops (the second-hand focus, 2026-10-03 — lowest-prices.ts `lowestPrices`);
 *   · 'new'  — NEW units from ShopDunk, CellphoneS and Hoàng Hà Mobile (2026-11-26 — `lowestNewPrices`), which those shops
 *     sell; the visitor messages the shop on eno.vn and gets its "Buy now" (src/lib/partner-buy.ts), which may earn a
 *     commission — so a new table always carries its own one-line disclosure (`AffiliateNote condition="new"`).
 *
 * ⚠️ EVERY NUMBER IS A LINK TO THE LISTING IT CAME FROM. A price table that cannot be checked is a
 * claim; one that can is the marketplace's own inventory, which is also what makes this page
 * something other than a scrape of retail prices (both plan reviewers flagged the difference).
 */
type PriceTableProps = {
  rows: PriceRow[]; known: boolean; updated: string
  /** The section's anchor id — unique on the page. */
  id: string
  /**
   * false on the hub, whose CTAs above the table already lead to each model's page. The link below
   * goes to the explorer's search URL, which canonicalises to `/` — the one place the hub no longer
   * links (see `browseLinks` in iphone-18-vietnam/page.tsx).
   */
  seeAll?: boolean
} & (
  | {
      condition: 'used'
      /**
       * ⛔ PER CALL SITE, NOT HARD-CODED: the hub renders two of these (iPhone 18 and iPhone 17), and a fixed
       * "iPhone 18 prices" h2 with one fixed id put the wrong title on the second and a duplicate id in the page
       * (review, 2026-10-03). Pass a literal `<Tr text="…" />` so gen-ui-strings harvests it.
       */
      heading: ReactNode
    }
  | {
      condition: 'new'
      /** ⛔ NONE: a new table's heading names the shops its rows come from (`NewFromShops`), and only those. */
      heading?: never
    }
)

/** The shops a new table quotes, each once, in NEW_APPLE_SHOPS order (src/lib/new-apple.ts) — a heading's order, not the tie-break's. */
export function shopsOf(rows: PriceRow[]): string[] {
  const order = (name: string) => {
    const i = NEW_APPLE_SHOPS.findIndex((s) => s.name === name)
    return i === -1 ? NEW_APPLE_SHOPS.length : i
  }
  return [...new Set(rows.map((r) => r.seller).filter(Boolean))].sort((a, b) => order(a) - order(b) || a.localeCompare(b))
}

/** "A", "A and B", "A, B and C" — the shop names are proper nouns and are never translated; only the joining word is. */
const listOf = (names: string[], and: string) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} ${and} ${names[names.length - 1]}`

/**
 * "New, from ShopDunk and CellphoneS" — the shops that ACTUALLY appear in the rows, never the three by default (a shop with no
 * live unit is not a source of this table). An authored template with the names filled in after translation (`Bilingual`
 * `values`), so the nine machine-translated languages translate the sentence, not one instance of it.
 */
function NewFromShops({ rows }: { rows: PriceRow[] }) {
  const names = shopsOf(rows)
  return <Bilingual en="New, from {shops}" vi="Máy mới, từ {shops}" values={{ shops: listOf(names, 'and') }} valuesVi={{ shops: listOf(names, 'và') }} />
}

export function PriceTable({ rows, known, updated, heading, id, seeAll: seeAllProp, condition }: PriceTableProps) {
  // ⛔ The new table links no site-wide browse by default (commit gate round 4): `condition=new` would list strangers' new and
  // like-new units right under a table that is careful to quote only the three shops. Each of its rows links its own listing.
  const seeAll = seeAllProp ?? condition !== 'new'
  /**
   * ⚠️ RENDERING NOTHING IS ONLY HONEST WHEN THE CATALOGUE WAS ACTUALLY READ. The intro two lines
   * above promises "every price below comes from a live listing"; on a build where the database was
   * unreachable this component returned null and left that promise pointing at empty space (agy).
   */
  if (rows.length === 0) {
    return known ? null : (
      <p className="mt-8 text-sm text-body">
        {/* A new table's line names its rows: a page whose second-hand table did read must not say "live prices" failed. */}
        {condition === 'new'
          ? <Tr text="New prices from the shops could not be read just now — they are back on the next refresh." />
          : <Tr text="Live prices could not be read just now — they are back on the next refresh." />}
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
    <section className="mt-8" aria-labelledby={id}>
      <h2 id={id} className="h-section text-foreground mb-1">
        {condition === 'new' ? <NewFromShops rows={rows} /> : heading}
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        {/* ⚠️ THE EXCLUSION IS NAMED (review, 2026-10-03): "the lowest price" would be untrue the day the
            outlier guard in lowest-prices.ts leaves a typo-priced listing out.
            ⛔ A NEW TABLE SAYS WHO SELLS (2026-11-26): the shop does — eno.vn sells nothing; the visitor messages the shop
            and gets its Buy now (partner-buy.ts). */}
        {condition === 'new'
          ? <Tr text="The lowest price for each storage tier among the new phones these shops list here; a price far out of line with the others, or with Apple's own price, is left out as a likely typo. The shop sells the phone: message it here and you get a Buy now button that opens the shop's own page to order. Tap a price to open the listing." />
          : <Tr text="The lowest price among the second-hand phone shops' live listings here, for each storage tier. A price far out of line with the other listings of the same model, or with Apple's own price, is left out as a likely typo. Tap a price to open the listing." />}{' '}
        {/* ⚠️ THE NOUN IS TRANSLATED, THE NUMBER AND DATE ARE NOT. An English "24 listings" baked
            into the stamp is the one fragment a Vietnamese reader would still see in English. */}
        <span className="whitespace-nowrap">{offers} <Tr text="listings" /> · {updated}</span>
      </p>
      {/* Each model is a ruled group on the canvas — its own heading over its own table, under one
          hairline — not a bordered box (flat-surface canon §3b; C-BOXES). The heading and the table
          are the grouping now, so they stay inside the model's own block. */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {models.map((model) => (
          <div key={model} className="border-t border-border pt-4">
            <h3 className="text-sm font-bold text-foreground">{model}</h3>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
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
      {/* ⛔ ONE LINE, IN THE SECTION IT DISCLOSES: every new row is bought through the shop's Buy now. */}
      {condition === 'new' && showAffiliateNote(rows) && <AffiliateNote condition="new" />}
      {seeAll && (
        <LocalizedLink
          href={models.length === 1
            ? `/?category=electronics&subcategory=phones-tablets&brand=apple&condition=${condition}&model=${encodeURIComponent(models[0])}`
            : `/?category=electronics&subcategory=phones-tablets&brand=apple&condition=${condition}`}
          rel="nofollow"
          prefetch={false}
          className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent-foreground hover:underline"
        >
          {/* The explorer's "new" chip is "New / Like new" (listing-condition.ts): the label says both. */}
          {condition === 'new' ? <Tr text="See every new and like-new listing" /> : <Tr text="See every second-hand listing" />}{' '}
          <ArrowRight className="h-4 w-4" />
        </LocalizedLink>
      )}
    </section>
  )
}

/**
 * ⛔ RENDERED BY THE PAGE, NOT BY A TABLE, AND THAT IS THE FIX RATHER THAN THE STYLE. It lived
 * inside <PriceTable>, which returns null when the iPhone 18 rows are empty — so on the day the Pro
 * listings lapse and only the Duo pre-orders remain, the page would still print a monetised price
 * table, ordered by a tie-break that favours tracked partner links, with no disclosure anywhere
 * (opus). A page that earns commission says so for as long as it shows a price.
 * ⚠️ AND ONLY THEN (2026-10-03): the call sites render it when a QUOTED row is tracked (`showAffiliateNote`)
 * — most second-hand rows link a shop directly or are people's own posts, and a commission disclosure on
 * a table with no tracked link would be a claim about nothing.
 */
export const showAffiliateNote = (...tables: PriceRow[][]): boolean => tables.some((rows) => rows.some((r) => r.tracked))

export function AffiliateNote({ condition = 'used' }: { condition?: 'used' | 'new' }) {
  /* ⛔ "AFFILIATE LINK", NOT "PARTNER LINK" (2026-10-01): "partner" now means a company with a signed
     agreement (partner-badge.tsx), and the retailers behind these tracked links (AccessTrade — the
     tie-break in lowest-prices.ts `isTracked`) hold none. Same disclosure, same tie-break, named for what
     it is. An authored pair (the curated Vietnamese with that phrase changed), a literal `tr()` so
     gen-ui-strings harvests the English, rendered through <Bilingual> because this is a server file.
     ⚠️ 'new' IS ITS OWN LINE (2026-11-26): every new row is sold through the shop's Buy now, and its ties go by the shop's
     rank (lowest-prices.ts `lowestNewPrices`), not to a tracked link — so the used note's tie-break sentence would be false. */
  const tr = (en: string, vi: string) => <Bilingual en={en} vi={vi} />
  return (
    <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
      {condition === 'new'
        ? tr(
            "We may earn a commission when you buy through the shop's Buy now button, at no extra cost to you. The price you pay is the shop's.",
            'Chúng tôi có thể nhận hoa hồng khi bạn mua qua nút Mua ngay của cửa hàng, bạn không phải trả thêm chi phí nào. Mức giá bạn thanh toán là giá của cửa hàng.',
          )
        : tr(
            "Some listings reach the shop through a tracked affiliate link, which may earn this site a commission at no cost to you. The lowest price always wins; when two listings ask exactly the same, the one with the tracked link is shown. The price you pay is the shop's.",
            'Một số tin đăng dẫn đến cửa hàng qua liên kết affiliate có theo dõi, trang web có thể nhận hoa hồng mà bạn không phải trả thêm chi phí nào. Mức giá thấp nhất luôn được ưu tiên; khi hai tin đăng có giá hoàn toàn bằng nhau, tin có liên kết được theo dõi sẽ được hiển thị. Mức giá bạn thanh toán là giá của cửa hàng.',
          )}
    </p>
  )
}
