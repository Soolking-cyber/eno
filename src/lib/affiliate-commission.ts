/**
 * WHICH OUTBOUND LINKS CAN EARN eno A COMMISSION (owner decision 2026-10-01: ad labelling).
 *
 * ⚠️ PURE AND CLIENT-SAFE — serialize.ts projects it onto every card as a boolean, and the PDP's buy box
 * reads it beside the CTA. It never needs the link itself on the client.
 *
 * ⛔ "HAS AN affiliateUrl" IS NOT THE TEST, AND THAT IS MEASURED FROM THE IMPORTERS, NOT ASSUMED. The
 * column holds every outbound link, and most of them pay nothing:
 *   · rental portals (Batdongsan, Rever, Chợ Tốt, Muaban, Honeycomb) and vehicle hire (Mioto, BonbonCar,
 *     the bike shops) store the source ad's own URL (scripts/import-*-rentals.ts, import-vehicle-rentals.ts);
 *   · linked jobs store the posting's URL (scripts/import-jobs.ts — and the CTA drops `sponsored` there);
 *   · the scraped partner shops and the eSIM carriers store the shop's own product URL
 *     (scripts/import-partners.ts `affiliateUrl: r.url`, scripts/import-esim.ts `affiliateUrl: r.url`,
 *     data/esim-carriers.json — carrier domains).
 * A commission is earned only through the AccessTrade publisher network, whose links are minted on its
 * tracker hosts:
 *   · go.isclix.com — `/deep_link/<publisher>/<campaign>?url=…`, written by scripts/import-accesstrade.ts
 *     (CellphoneS, Tiki, …: repairAffLink in src/lib/affiliate-price-refresh.ts) and
 *     scripts/import-supersports.ts; src/lib/affiliate-deeplink.ts reads the same shape;
 *   · shorten.asia — AccessTrade's short links; data/vinwonders-destinations.json names its affiliateUrl
 *     "the tracked deeplink from the AccessTrade generator", and all 17 of them are on this host;
 *   · click.accesstrade.vn — where both of the above resolve (affiliate-deeplink.ts, import-supersports.ts).
 * So the rule is the HOST, and a new network is one line here.
 */
const COMMISSION_HOSTS = new Set(['go.isclix.com', 'shorten.asia', 'click.accesstrade.vn'])

/** True when this outbound link is a commission-bearing (AccessTrade) tracker link. Null/garbage → false. */
export function isCommissionLink(url: string | null | undefined): boolean {
  if (!url) return false
  let host: string
  try { host = new URL(url).hostname.toLowerCase() } catch { return false }
  return COMMISSION_HOSTS.has(host.replace(/^www\./, ''))
}
