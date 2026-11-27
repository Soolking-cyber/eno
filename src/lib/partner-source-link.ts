/**
 * ── A PARTNER LISTING'S ORIGINAL PAGE, FOR ENO'S ADMINS (owner, 2026-11-24) ──────────────────────────────────────────────
 *
 * "why all partner shop products dont have direct links to original website for respective admins" → "build it" + "also
 * from now on all partner shops should have links for admins".
 *
 * The link lives in the staff-only "PartnerPurchaseLink" table (src/lib/partner-purchase-link.ts: RLS on, no policy, never
 * serialized, never in a cached page) and leaves the server ONLY through GET /api/listings/[id]/goplus-link, as kind
 * 'source', to the storefront's own login and eno's admins: never to a buyer. It is never a "Buy now": partner-buy.ts answers
 * AccessTrade links only.
 *
 * ⛔ A STORED URL IS ANSWERED ONLY ON ITS PARTNER'S OWN WEBSITE: the hosts below, for an official partner storefront
 * (officialPartner, a flag eno's staff set) whose handle is that key. A row pointing anywhere else is never served.
 *
 * ⛔ EVERY PARTNER NEEDS AN ENTRY. partner-source-link.test.ts fails when the partner strip (src/lib/partner-strip.ts) or
 * scripts/register-partner-seller.mjs gains a storefront that is in neither this table nor PARTNER_LINK_COVERED_ELSEWHERE.
 * After an import: `set -a; . ~/eno.vn/.env; set +a; npx tsx scripts/backfill-partner-source-links.ts <handle>` (dry run), then the
 * same with `--journal-dir <durable dir> --apply` writes the new rows' links.
 */
export type PartnerSource = {
  /** The partner's own website hosts (exact; `www.` is added automatically). */
  hosts: readonly string[]
  /** The page a listing with no page of its own links to: the partner's listing index or home page. */
  home: string
  /** Only for a site that serves no https at all (its https address redirects to http): measured, not assumed. */
  allowHttp?: true
}

export const PARTNER_SOURCES: Readonly<Record<string, PartnerSource>> = {
  // Housing (records[].link in the import research; scripts/backfill-partner-source-links.ts)
  alphahousing: { hosts: ['alphahousing.vn'], home: 'https://alphahousing.vn/' },
  housingsaigon: { hosts: ['housingsgn.com'], home: 'https://housingsgn.com/' },
  cvr: { hosts: ['cvr.com.vn'], home: 'https://cvr.com.vn/' },
  jhouse: { hosts: ['jhouse.vn'], home: 'https://jhouse.vn/' },
  saigoncribs: { hosts: ['saigoncribs.com'], home: 'https://saigoncribs.com/' },
  // Cars (cars[src].pageUrl in the import research)
  karplus: { hosts: ['karplus.vn'], home: 'https://karplus.vn/' },
  carbi: { hosts: ['chothuexecarbihcm.com'], home: 'https://chothuexecarbihcm.com/cho-thue-xe-tu-lai' },
  ankhanhtravel: { hosts: ['ankhanhtravel.com'], home: 'https://ankhanhtravel.com/' },
  // https://www.thuexetulaihcm.com/… answers 301 → http:// (measured 2026-11-24).
  quehuong: { hosts: ['thuexetulaihcm.com'], home: 'http://www.thuexetulaihcm.com/', allowHttp: true },
  anbinhtours: { hosts: ['anbinhtours.com'], home: 'https://anbinhtours.com/thue-xe-tu-lai-page/' },
  // Motorbikes
  theextramile: { hosts: ['theextramile.co'], home: 'https://theextramile.co/motorbikes/' },
  saigonscootercentre: { hosts: ['saigonscootercentre.com'], home: 'https://saigonscootercentre.com/ssc-rentals/' },
  hagasmartech: { hosts: ['hagasmartech.com'], home: 'https://hagasmartech.com/' },
  blvck: { hosts: ['thuexemaysaigon.vn'], home: 'https://thuexemaysaigon.vn/' },
  // Services
  saigonmoving: { hosts: ['saigonmoving.com'], home: 'https://saigonmoving.com/bang-gia.htm' },
  evisasaigon: { hosts: ['evisasaigon.vn'], home: 'https://evisasaigon.vn/' },
  vietkite: { hosts: ['vietkite.com.vn'], home: 'https://vietkite.com.vn/' },
  luathoangphi: { hosts: ['luathoangphi.vn'], home: 'https://luathoangphi.vn/' },
  // FPT's own home-internet page (200, its own canonical, read 2026-11-27): every FPT listing is a plan sold there.
  fpttelecom: { hosts: ['fpt.vn'], home: 'https://fpt.vn/internet' },
}

/**
 * Partners whose admins already have the original link another way, so they need no entry above — each with the reason.
 * The test reads this list; adding a partner here needs the same kind of reason.
 */
export const PARTNER_LINK_COVERED_ELSEWHERE: Readonly<Record<string, string>> = {
  goplus: 'goplusRoomPageUrl builds each room page from its externalId (src/lib/goplus-listing.ts)',
  cellphones: 'eno-run AccessTrade shop: the purchase link (src/lib/eno-run-partners.ts)',
  dienthoaivui: 'eno-run AccessTrade shop: the purchase link (src/lib/eno-run-partners.ts)',
  hoanghamobile: 'eno-run AccessTrade shop: the purchase link (src/lib/eno-run-partners.ts)',
  shopdunk: 'eno-run AccessTrade shop: the purchase link (src/lib/eno-run-partners.ts)',
  vinwonders: 'its tickets carry a public affiliateUrl that everyone, admins included, sees',
  gmbr: 'account being closed (promo removed 2026-11-09); no listings',
}

/** True when `url` may be served as `handle`'s original page: http(s) per the entry, on one of its own hosts exactly. */
export function partnerSourceUrlOk(handle: string | null | undefined, url: string | null | undefined): boolean {
  if (!handle || !url) return false
  const src = Object.prototype.hasOwnProperty.call(PARTNER_SOURCES, handle) ? PARTNER_SOURCES[handle] : undefined
  if (!src) return false
  let u: URL
  try { u = new URL(url) } catch { return false }
  if (u.protocol !== 'https:' && !(src.allowHttp && u.protocol === 'http:')) return false
  if (u.username || u.password || u.port) return false
  const host = u.hostname.toLowerCase()
  return src.hosts.some((h) => host === h || host === `www.${h}`)
}
