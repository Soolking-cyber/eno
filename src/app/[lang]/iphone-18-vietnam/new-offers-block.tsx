import { SITE_NAME } from '@/lib/edition'
import { formatMoneyFull } from '@/lib/vnd'
import { HereLink } from '@/components/marketplace/here-link'
import { NEW_APPLE_IPHONE_MODELS } from '@/lib/new-apple'
import { cheapestPerModel, lowestNewPrices, type PriceRow } from './lowest-prices'

/**
 * "iPhone 18 on eno.vn" — THE ONE SHORT BLOCK THE iPHONE BUYING GUIDES CARRY (owner, 2026-11-26: "import them and link to our
 * organic posts that get clicks for iphone"): the cheapest NEW iPhone 18 Pro, Pro Max and Duo the three shops list here
 * (lowest-prices.ts `lowestNewPrices`, the same rows and the same guard as the model pages' new table), each price linking its
 * listing, each model linking its own price page, then who sells and the commission line.
 *
 * ⛔ IT IS NOT PART OF THE ARTICLE. It sits in SeoArticle's `ledeRow` — under the intro, outside `sections`, so it is not in
 * "On this page" and changes none of the article's advice. Two of these guides say in their own header that no shop is ranked
 * or recommended by name because the site earns from some; this block ranks nothing either: it states the lowest listed price
 * and the shop that lists it, as the price tables do, and says in the same breath that the site may earn a commission.
 *
 * ⛔ NOTHING, NEVER A CLAIM, WITHOUT ROWS. A post is not a price page: with zero rows or a failed read the block is absent (the
 * page passes no `ledeRow` at all, so the article lays out exactly as before) — never "none listed", which on a cached
 * article would be a statement about stock that outlives it.
 *
 * ⚠️ THE ARTICLE'S LANGUAGE, NOT THE VISITOR'S. These guides are fixed-language pages (lang-pinned.ts), so the words follow
 * `lang`, as the article's own prose and SeoArticle's chrome do — plain constants per language, never `tr()` or an authored
 * pair (gen-ui-strings would warm them for nine languages nobody reads them in). The money is vnd.ts in the article's locale.
 */

/** Each line's own price page. sitemap.test / this block's test hold every path to a page that exists. */
export const NEW_IPHONE_PAGES: Readonly<Record<string, string>> = {
  'iPhone 18 Pro': '/iphone-18-pro-vietnam',
  'iPhone 18 Pro Max': '/iphone-18-pro-max-vietnam',
  'iPhone Duo': '/iphone-duo-vietnam',
}

/** The block's rows: the cheapest new unit of each line that has one, in line order. `[]` for none AND for a failed read. */
export async function newIphoneOffers(): Promise<PriceRow[]> {
  const { rows } = await lowestNewPrices(NEW_APPLE_IPHONE_MODELS)
  return cheapestPerModel(rows).filter((r) => r.model in NEW_IPHONE_PAGES)
}

export function NewIphoneBlock({ lang, rows }: { lang: 'en' | 'vi'; rows: PriceRow[] }) {
  if (!rows.length) return null
  const vi = lang === 'vi'
  const title = vi ? `iPhone 18 trên ${SITE_NAME}` : `iPhone 18 on ${SITE_NAME}`
  return (
    // The guides' lede-row look (teach-in-vietnam's facts box): a hairline under it, not a bordered card (C-BOXES).
    <section aria-label={title} className="mt-6 max-w-3xl border-b border-border pb-6">
      <p className="text-sm font-bold text-accent-foreground">{title}</p>
      <ul className="mt-3 max-w-[60ch] list-disc space-y-2 pl-5 text-base leading-relaxed text-body marker:text-ink-4 lg:text-lg">
        {rows.map((r) => (
          <li key={r.model}>
            <HereLink href={NEW_IPHONE_PAGES[r.model]}>{r.model}</HereLink>
            {vi ? ': máy mới từ ' : ': new from '}
            <HereLink href={`/listings/${r.listingId}`}>
              <span className="whitespace-nowrap">{formatMoneyFull(r.price, r.currency, lang)}</span>
            </HereLink>
            {vi ? `, bản ${r.storage}, tại ${r.seller}` : ` for ${r.storage} at ${r.seller}`}
          </li>
        ))}
      </ul>
      <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
        {vi
          ? `Máy mới do cửa hàng bán: nhắn tin cho cửa hàng trên ${SITE_NAME}, bạn sẽ nhận nút Mua ngay để đặt hàng tại cửa hàng. ${SITE_NAME} có thể nhận hoa hồng khi bạn mua qua nút này, bạn không phải trả thêm chi phí nào.`
          : `The shops sell these new: message one on ${SITE_NAME} and you get a Buy now button that orders from the shop. ${SITE_NAME} may earn a commission when you buy through it, at no extra cost to you.`}
      </p>
    </section>
  )
}
