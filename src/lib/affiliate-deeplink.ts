/**
 * WHEN AN AFFILIATE LINK DOES NOT REACH THE PRODUCT, AND WHAT TO DO ABOUT IT.
 *
 * ⛔ THE PROBLEM, MEASURED 2026-09-17 AND NOT INFERRED. AccessTrade's own per-product links for the
 * SuperSports campaign (`product_link/create`, campaign 5883902897773910283) carry the product URL
 * as `?url=…` all the way to `click.accesstrade.vn` — and the ADVERTISER's tracker
 * (`centralgrouponline.go2cloud.org`, offer 275) drops it, landing every shopper on
 * `supersports.com.vn/en`. Verified with real handles in both locales, with the short link, and
 * against five other destination parameter spellings (`deeplink`, `dl`, `u`, `utm_content`, and the
 * tracker's own URL as the destination): `url=` is the only one that produces a TRACKED click, and
 * none of them arrives at the product. The tracker itself honours `&url=`, so this is a switch on
 * the advertiser's side — the day they flip it, every stored link deep-links and this whole module
 * stops doing anything (see `CAMPAIGNS_WITHOUT_DEEP_LINKS`).
 *
 * ⛔ WHAT WE DO NOT DO, SO NOBODY PROPOSES IT AGAIN: fire the affiliate click somewhere the shopper
 * cannot see — a hidden iframe, a background tab, a popunder — and then send them to the product.
 * That is the forced-click pattern every network's terms prohibit, on a programme paying 9% across
 * ~6,000 products. It also would not work: the attribution cookie has to land on the MERCHANT's
 * domain, and fired from a frame on eno.vn it is a third-party cookie that Safari blocks outright.
 *
 * ⚠️ WHAT WE DO INSTEAD (owner's choice, 2026-09-17): the visible two-step. The buy button is the
 * affiliate link, exactly as before — a real click the shopper makes and sees, which is what counts
 * it and sets the merchant's 30-day last-click cookie. Only AFTER that click does the page offer a
 * second, plain link straight to the product. The shopper ends up where they wanted, the click is
 * attributed, and nothing is hidden from anyone.
 */

/** The merchant hosts whose product URLs we are willing to send a shopper to from a listing. */
const MERCHANT_HOSTS = new Set(['supersports.com.vn', 'www.supersports.com.vn'])

/**
 * AccessTrade campaigns measured NOT to deep-link. Only these get the second step: for a campaign
 * whose links already land on the product (CellphoneS's do), a "go to the item" link points at the
 * page the shopper is already on, which is noise.
 *
 * ⚠️ DELETE THE ENTRY, NOT THE FEATURE, when a campaign starts deep-linking — the UI disappears on
 * its own and the stored links keep working. If this set empties, the whole module is dead code and
 * should go with it.
 */
const CAMPAIGNS_WITHOUT_DEEP_LINKS = new Set(['5883902897773910283'])

/**
 * The merchant product URL an affiliate link was minted FOR, or null.
 *
 * ⚠️ NO SCHEMA COLUMN AND NO RE-IMPORT: the destination is already inside the link we stored
 * (`…/deep_link/<publisher>/<campaign>?url=<product>`), so it is recovered by reading it back.
 * ⚠️ VALIDATED, not trusted: https only, and only a host we know, so this can never turn a listing
 * into an open redirect to wherever a feed put a `url` parameter.
 */
export function embeddedProductUrl(affiliateUrl: string | null | undefined): string | null {
  if (!affiliateUrl) return null
  let outer: URL
  try { outer = new URL(affiliateUrl) } catch { return null }
  if (outer.hostname !== 'go.isclix.com') return null
  // `/deep_link/<publisherId>/<campaignId>`
  const campaign = outer.pathname.split('/').filter(Boolean)[2]
  if (!campaign || !CAMPAIGNS_WITHOUT_DEEP_LINKS.has(campaign)) return null
  const inner = outer.searchParams.get('url')
  if (!inner) return null
  let target: URL
  try { target = new URL(inner) } catch { return null }
  if (target.protocol !== 'https:') return null
  if (!MERCHANT_HOSTS.has(target.hostname)) return null
  // A product page, not the shop's home — the whole point is that the home page is where the
  // shopper already landed.
  if (!/\/products\//.test(target.pathname)) return null
  return target.toString()
}
