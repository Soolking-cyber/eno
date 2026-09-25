/**
 * honeycomb.com.vn → eno REFERENCE LISTINGS: the pure half of scripts/import-honeycomb-com-vn.ts.
 *
 * Everything here is parsing and mapping with no I/O, so it can be unit-tested against the page
 * shape we measured on 2026-09-24 (honeycomb-listing.test.ts). The script owns fetching, the
 * database and storage.
 *
 * WHAT THE SOURCE IS (measured 2026-09-24, not assumed):
 *   · Honeycomb House is an HCMC expat-rental AGENCY, not a portal. WordPress + the WP Residence
 *     theme. robots.txt disallows only /wp-admin/ (https://honeycomb.com.vn/robots.txt). No
 *     challenge, no login. The REST API does not expose `estate_property`, so the importer reads
 *     the WordPress sitemaps plus each detail page's HTML.
 *   · A detail page carries: the H1, a category link (`/properties/<slug>/`), a "Property Details"
 *     panel (Property Id = the WordPress post id, Price "$ 2,692", Bedrooms, Bathrooms, District,
 *     Code), an Address panel (Address, Project), and a 5-photo lightbox gallery. It carries NO
 *     floor area, NO coordinates, NO description text and NO "rented" marker. A 2020 listing
 *     still answers 200 with the same shape, so page liveness says nothing about availability;
 *     the sitemap's `lastmod` is the only freshness signal there is.
 *   · Prices are US dollars with no unit printed. Every category slug says "-for-rent-in-hcmc",
 *     so the figure is read as a MONTHLY RENT, and anything that does not look like one is dropped
 *     rather than guessed at (see `assessHoneycomb`).
 *
 * ⛔ eno STORES EVERY PRICE IN ĐỒNG (src/lib/core/listings.currency.test.ts), so the USD figure is
 * converted at import time and the original is kept, verbatim, in the description. The stored
 * price is therefore an approximation and the description says so in both languages.
 */
import { buildSearchText, fold } from './fold'
import { listingMoneyFor, roomAttributes } from './taxonomy'
import { localizeImportText, type MissingSegment } from './import-i18n'
import vnUnits from '../data/vn-units.json'

/** ⛔ PINNED BY ID, never resolved by name — `Seller.name` is not unique and is user-settable. */
export const HONEYCOMB_SELLER_ID = 'honeycomb-import-seller-0001'
/** What the PDP prints on the outbound button ("Rent on Honeycomb House"), so it is the brand's
 *  own name as its site footer writes it. */
export const HONEYCOMB_SELLER_NAME = 'Honeycomb House'
/**
 * The brand's own square site icon (the yellow hexagon "H"), 512x512 PNG. The wide wordmark
 * (`/2024/04/honeycomb_house_logo.png`, 200x82) measures 6.4% visible on the padded 512² avatar
 * square — under set-partner-avatar's 8% floor — where this measures 15.4%. Measured 2026-09-24.
 */
export const HONEYCOMB_LOGO_URL = 'https://honeycomb.com.vn/wp-content/uploads/2024/04/cropped-honeycomb_favicon.png'
export const HONEYCOMB_ORIGIN = 'https://honeycomb.com.vn'
export const EXTERNAL_ID_PREFIX = 'honeycomb:'

/** Monthly-rent sanity band in US dollars. Real stock seen: $500–$7,000. A sale price would be six
 *  figures, a per-night or per-m² figure two; both fall outside and are dropped, not converted. */
export const USD_MONTHLY_BAND = { min: 150, max: 60_000 } as const
/** The contract's đồng band (import-rever-rentals.ts:188), applied after conversion. */
export const VND_BAND = { min: 1_000_000, max: 2_000_000_000 } as const
/** src/lib/visa/fx.ts's plausibility band for a đồng-per-dollar rate. */
export const VND_PER_USD_BAND = { min: 5_000, max: 100_000 } as const
/** set-partner-avatar.ts's floor: share of the 512² flattened avatar that is not near-white. */
export const MIN_LOGO_VISIBLE_PCT = 8

// ── small text helpers ──────────────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', sup2: '²',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m
  })
}

/** Tag-stripped, entity-decoded, whitespace-collapsed text of an HTML fragment. */
export function textOf(html: string): string {
  /** Tags are stripped AGAIN after decoding: an entity-encoded '&lt;script&gt;' in a source field
   *  would otherwise come out as a literal '<script>' in our description and searchText. */
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

const inRange = (n: unknown, lo: number, hi: number): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi

// ── robots.txt ──────────────────────────────────────────────────────────────────────────────

/**
 * Does robots.txt let user-agent `*` fetch `path`? Longest matching rule wins and Allow wins a tie
 * (RFC 9309 §2.2.2). `*` and `$` wildcards are honoured. Only the `*` group is read: this importer
 * does not claim any named agent's permissions.
 */
export function robotsAllows(robotsTxt: string, path: string): boolean {
  const rules: { allow: boolean; pattern: string }[] = []
  let inStar = false
  let sawRuleInGroup = false
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line)
    if (!m) continue
    const key = m[1].toLowerCase()
    const val = m[2].trim()
    if (key === 'user-agent') {
      // A user-agent line after rules starts a NEW group.
      if (sawRuleInGroup) { inStar = false; sawRuleInGroup = false }
      if (val === '*') inStar = true
    } else if (key === 'allow' || key === 'disallow') {
      sawRuleInGroup = true
      if (inStar && val) rules.push({ allow: key === 'allow', pattern: val })
    }
  }
  /** `*` = any run of characters; a trailing `$` anchors the end; everything else is literal. */
  const toRe = (p: string) => {
    const anchored = p.endsWith('$')
    const body = (anchored ? p.slice(0, -1) : p).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    return new RegExp(`^${body}${anchored ? '$' : ''}`)
  }
  let best: { allow: boolean; len: number } | null = null
  for (const r of rules) {
    const re = toRe(r.pattern)
    if (!re.test(path)) continue
    const len = r.pattern.length
    if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len }
  }
  return best ? best.allow : true
}

// ── sitemaps ────────────────────────────────────────────────────────────────────────────────

export type SitemapEntry = { url: string; lastmod: string | null }

/** `<sitemap><loc>` children of a sitemap index. */
export function parseSitemapIndex(xml: string): string[] {
  const out: string[] = []
  const re = /<sitemap>\s*<loc>([^<]+)<\/loc>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) out.push(decodeEntities(m[1].trim()))
  return out
}

/** Only the property-post sitemaps; pages, agents, taxonomies and users are not listings. */
export const isPropertySitemap = (u: string) =>
  /^https:\/\/honeycomb\.com\.vn\/wp-sitemap-posts-estate_property-\d+\.xml$/.test(u)

/** `<url>` entries of a urlset, with `lastmod` when present. */
export function parseUrlset(xml: string): SitemapEntry[] {
  const out: SitemapEntry[] = []
  const re = /<url>([\s\S]*?)<\/url>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const loc = /<loc>([^<]+)<\/loc>/.exec(m[1])
    if (!loc) continue
    const lm = /<lastmod>([^<]+)<\/lastmod>/.exec(m[1])
    out.push({ url: decodeEntities(loc[1].trim()), lastmod: lm ? lm[1].trim() : null })
  }
  return out
}

// ── URL pins ────────────────────────────────────────────────────────────────────────────────

/**
 * ⛔ THE OUTBOUND CTA IS ONLY AS TRUSTWORTHY AS THIS CHECK. `affiliateUrl` becomes a live link on
 * the PDP and `safeAffiliateUrl()` only enforces https, so the HOST and the listing path are pinned
 * here. A trailing-slash-less or query-carrying variant is refused rather than normalised.
 */
export const allowedTarget = (u: unknown): u is string =>
  typeof u === 'string' && /^https:\/\/honeycomb\.com\.vn\/property\/[a-z0-9%-]+\/$/.test(u)

/** Photos live on the site's own uploads folder; nothing else on the page is a listing photo. */
export const allowedImage = (u: unknown): u is string =>
  typeof u === 'string' && /^https:\/\/honeycomb\.com\.vn\/wp-content\/uploads\/\d{4}\/\d{2}\/[^/?#"'\s]+\.(jpe?g|png|webp)$/i.test(u)

/**
 * The FULL-SIZE upload behind a WordPress thumbnail: `EH-17-1110x640.jpg` → `EH-17.jpg`. The
 * lightbox serves 1110x640 CROPS; the original (1280x960 measured) is the whole frame.
 */
export const originalImageUrl = (u: string) => u.replace(/-\d{2,4}x\d{2,4}(\.(?:jpe?g|png|webp))$/i, '$1')

// ── the detail page ─────────────────────────────────────────────────────────────────────────

export type HoneycombRecord = {
  url: string
  /** WordPress post id — "Property Id" in the details panel, `postid-N` on <body>, `?p=N`. */
  postId: string
  /** The agency's own reference, e.g. EH317878. Printed in the description for enquiries. */
  code: string | null
  sourceTitle: string
  /** `/properties/<slug>/` category slugs in page order, e.g. apartments-for-rent-in-hcmc. */
  categorySlugs: string[]
  /** The Price detail's text with its unit labels, e.g. "$ 2,692". */
  priceText: string | null
  /** Text of the theme's before/after price labels (empty on every page seen). */
  priceLabel: string
  bedrooms: number | null
  bathrooms: number | null
  districtRaw: string | null
  address: string | null
  project: string | null
  areaM2: number | null
  /** Full-size photo URLs in gallery order, deduplicated, host-pinned. */
  images: string[]
}

/** Label → inner HTML of every `<div class="listing_detail"><strong>Label:</strong> …</div>`. */
export function detailFields(html: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /<div class="listing_detail[^"]*"[^>]*>\s*<strong>([^<]{1,60}?):?\s*<\/strong>([\s\S]*?)<\/div>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const label = textOf(m[1]).replace(/:$/, '').trim().toLowerCase()
    if (label && !out.has(label)) out.set(label, m[2])
  }
  return out
}

/** A count field: a positive integer, or null. ⛔ "0" IS ABSENT, NOT A STUDIO — a 2026 villa page
 *  reads "Bedrooms: 0 · Bathrooms: 0", i.e. the agent left both blank. */
export function positiveCount(text: string | null | undefined): number | null {
  const m = /^\s*(\d{1,2})\s*$/.exec(text ?? '')
  const n = m ? Number(m[1]) : NaN
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * Floor area from free text. ⛔ THE THOUSANDS SEPARATOR DEPENDS ON THE LANGUAGE, AND BOTH FAIL
 * SILENTLY: English writes 1,200 m², Vietnamese writes 1.200 m² — read with the wrong rule either
 * becomes 1.2 m². Only GROUPS OF THREE are treated as thousands, so a real 4.5 or 4,5 stays a
 * decimal (import-batdongsan-rentals.ts:67-85 is the same bug, caught on 701 rows).
 */
export function parseAreaM2(text: string | null | undefined): number | null {
  const m = /(\d[\d.,]*)\s*(?:m2|m²|sqm|sq\.?\s?m)?/i.exec(text ?? '')
  if (!m) return null
  const t = m[1].replace(/[.,]$/, '')
  let n: number
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) n = Number(t.replace(/,/g, ''))
  else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) n = Number(t.replace(/\./g, '').replace(',', '.'))
  else n = Number(t.replace(',', '.'))
  return Number.isFinite(n) && n > 0 && n < 100_000 ? n : null
}

/**
 * A USD figure from "$ 2,692" / "USD 3,500" / "3,500 USD". Null when the text names another
 * currency or carries no dollar marker — ⛔ A BARE NUMBER IS NOT ASSUMED TO BE DOLLARS.
 */
export function parseUsd(text: string | null | undefined): number | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  if (!t || !/\$|\bUSD\b/i.test(t)) return null
  if (/VND|VNĐ|đ|triệu|tỷ|\btr\b/i.test(t)) return null
  /** ⛔ A RANGE IS NOT A PRICE: '$ 1,200 - $1,800' used to publish 1,200 as the rent, fixed-price. It
   *  is dropped (no price) rather than guessed. */
  if (/\d[\d,.]*\s*(?:-|–|—|to)\s*(?:US)?\$?\s*\d/i.test(t)) return null
  const m = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/.exec(t)
  if (!m) return null
  const n = Number(m[1].replace(/,/g, '') + (m[2] ? `.${m[2]}` : ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Gallery photos: the lightbox carousel (`#owl-demo`), falling back to the header strip. */
export function galleryImages(html: string): string[] {
  const grab = (block: string) => {
    const out: string[] = []
    const re = /background-image:\s*url\(\s*['"]?([^'")\s]+)['"]?\s*\)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(block))) out.push(decodeEntities(m[1]))
    return out
  }
  let urls: string[] = []
  const start = html.indexOf('id="owl-demo"')
  /** ⛔ ONLY BETWEEN THE TWO MARKERS. With the end marker gone (a theme change), reading on for 20,000
   *  characters reached the sidebar strip of OTHER listings, whose thumbnails pass allowedImage — a row
   *  would publish another property's photos. No end marker = no lightbox; the header strip below
   *  is the fallback, and no photo at all drops the row. */
  if (start >= 0) {
    const end = html.indexOf('lighbox-image-close', start)
    if (end > start) urls = grab(html.slice(start, end))
  }
  if (!urls.length) {
    // The header strip: `<div class="col-md-… image_gallery …" style="background-image:url(…)">`.
    const re = /<div class="[^"]*\bimage_gallery\b[^"]*"[^>]*style="([^"]*)"/g
    let m: RegExpExecArray | null
    while ((m = re.exec(html))) urls.push(...grab(m[1]))
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of urls.map(originalImageUrl)) {
    if (!allowedImage(u) || seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}

/**
 * Parse one detail page. Returns a string (the drop reason) when the page is not a listing we can
 * identify — ⛔ THE ID MUST AGREE WITH ITSELF: "Property Id", `postid-N` on <body> and the
 * `?p=N` shortlink are the same WordPress post id, and a page where they disagree is refused
 * rather than keyed on whichever came first.
 */
export function parseHoneycombPage(html: string, url: string): HoneycombRecord | 'noId' | 'idMismatch' {
  const fields = detailFields(html)
  const val = (k: string) => {
    const v = fields.get(k)
    return v === undefined ? null : textOf(v) || null
  }
  const ids = new Set<string>()
  const pid = val('property id')
  if (pid && /^\d+$/.test(pid)) ids.add(pid)
  const body = /<body[^>]*class="[^"]*\bpostid-(\d+)\b/.exec(html)
  if (body) ids.add(body[1])
  const short = /rel=["']?shortlink["']?[^>]*href=['"][^'"]*[?&]p=(\d+)/.exec(html) ??
    /href=['"][^'"]*[?&]p=(\d+)['"][^>]*rel=['"]?shortlink/.exec(html)
  if (short) ids.add(short[1])
  if (ids.size === 0) return 'noId'
  if (ids.size > 1) return 'idMismatch'
  const postId = [...ids][0]

  const categs = /<div id="prop_categs"[^>]*>([\s\S]*?)<\/div>/.exec(html)
  const categorySlugs: string[] = []
  if (categs) {
    const re = /href="https:\/\/honeycomb\.com\.vn\/properties\/([a-z0-9-]+)\/?"/g
    let m: RegExpExecArray | null
    while ((m = re.exec(categs[1]))) categorySlugs.push(m[1])
  }
  const h1 = /<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/.exec(html)
  const priceHtml = fields.get('price') ?? null
  const labels: string[] = []
  if (priceHtml) {
    const re = /<span class="price_label[^"]*">([\s\S]*?)<\/span>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(priceHtml))) { const t = textOf(m[1]); if (t) labels.push(t) }
  }
  const areaText = val('property size') ?? val('size') ?? val('area') ?? val('property area')
  return {
    url,
    postId,
    code: val('code'),
    sourceTitle: h1 ? textOf(h1[1]) : '',
    categorySlugs,
    priceText: priceHtml === null ? null : textOf(priceHtml),
    priceLabel: labels.join(' '),
    bedrooms: positiveCount(val('bedrooms')),
    bathrooms: positiveCount(val('bathrooms')),
    districtRaw: val('district'),
    address: val('address'),
    project: val('project'),
    areaM2: areaText ? parseAreaM2(areaText) : null,
    images: galleryImages(html),
  }
}

// ── mapping ─────────────────────────────────────────────────────────────────────────────────

/**
 * The site's four property categories (https://honeycomb.com.vn/wp-sitemap-taxonomies-property_category-1.xml).
 * ⛔ SERVICED APARTMENTS ARE APARTMENT RENTALS, NOT `homestay-serviced`. That subcategory is labelled
 * "Homestay" and sits with hotels under Short stays (taxonomy.ts), while these are monthly leases on
 * whole flats; the nhatot and muaban importers file the same stock under `apartment-rental`, and only
 * that subcategory carries the bedroom and area facets a renter filters on (review 2026-09-24).
 * A slug not listed here is DROPPED, never guessed: it is how a sale category would first appear.
 */
export const CATEGORY_MAP: Record<string, { subcategorySlug: string; en: string; vi: string }> = {
  'apartments-for-rent-in-hcmc': { subcategorySlug: 'apartment-rental', en: 'apartment', vi: 'căn hộ' },
  'penthouses-duplexes-for-rent-in-hcmc': { subcategorySlug: 'apartment-rental', en: 'penthouse / duplex', vi: 'căn hộ penthouse / duplex' },
  'serviced-apartments-for-rent-in-hcmc': { subcategorySlug: 'apartment-rental', en: 'serviced apartment', vi: 'căn hộ dịch vụ' },
  'houses-villas-for-rent-in-hcmc': { subcategorySlug: 'house-rental', en: 'house / villa', vi: 'nhà / biệt thự' },
}

export type CityKey = 'hcmc' | 'hanoi' | 'danang'
export const CITY_KEYS: readonly CityKey[] = ['hcmc', 'hanoi', 'danang']

/** One province of src/data/vn-units.json — the dataset the area filter's province picker serves. */
type VnWard = { code: string; name: string; nameEn: string }
type VnProvince = { code: string; name: string; nameEn: string; wards: VnWard[] }
const VN_PROVINCES = vnUnits as VnProvince[]
/** GSO province codes of the three cities this importer accepts. */
export const CITY_PROVINCE_CODE: Record<CityKey, string> = { hcmc: '79', hanoi: '01', danang: '48' }
function provinceOf(key: CityKey): VnProvince {
  const p = VN_PROVINCES.find((x) => x.code === CITY_PROVINCE_CODE[key])
  if (!p) throw new Error(`src/data/vn-units.json has no province ${CITY_PROVINCE_CODE[key]} (${key})`)
  return p
}

/**
 * `Listing.city` values — ⛔ THE vn-units VIETNAMESE `name`: 'Hồ Chí Minh', 'Hà Nội', 'Đà Nẵng'.
 * Owner/lead decision 2026-09-24: ONE spelling per city across every importer, and it is the one the
 * post wizard stores and the ~98,000 existing rows carry, so anything that groups by `city` sees one
 * bucket per city. The area filter sends the ENGLISH name (`nameEn`, 'Ho Chi Minh'); the shared
 * province predicate (src/lib/province-match.ts, commit 10107374) matches that AND this spelling
 * against `city`, so these rows are found either way. Derived from src/data/vn-units.json by GSO
 * code, not typed, so it cannot drift from the wizard's value.
 * (Until 2026-09-24 this was `nameEn`, which split every city into two buckets.)
 */
export const CITY_NAME: Record<CityKey, string> = {
  hcmc: provinceOf('hcmc').name, hanoi: provinceOf('hanoi').name, danang: provinceOf('danang').name,
}
/** The Vietnamese name, for `location` and the Vietnamese copy — the same strings as `CITY_NAME`. */
export const CITY_NAME_VI: Record<CityKey, string> = CITY_NAME
/** The English display name for the English copy. */
export const CITY_NAME_EN: Record<CityKey, string> = { hcmc: 'Ho Chi Minh City', hanoi: 'Hanoi', danang: 'Da Nang' }

/** The rent money shape — `listingMoneyFor` is the one place the app decides it ('VND/month'). */
export const HONEYCOMB_MONEY = listingMoneyFor({ categorySlug: 'rentals', listingType: 'rent' })

/**
 * The city a WHOLE address segment names, or null: "HCMC", "Ho Chi Minh City", "TP. Hồ Chí Minh",
 * "Hanoi", "Đà Nẵng". ⚠️ WHOLE SEGMENT, NOT A SUBSTRING — "Ha Noi Highway" is a street in District 2
 * (Xa lộ Hà Nội), and a substring test filed a Thảo Điền villa under Hà Nội.
 */
export function citySegment(segment: string): CityKey | null {
  const f = fold(segment).replace(/[^a-z0-9]+/g, ' ').trim().replace(/^(?:thanh pho|tp)\s*/, '').replace(/\s+city$/, '')
  if (/^(?:hcmc|hcm|ho chi minh|saigon|sai gon)$/.test(f)) return 'hcmc'
  if (/^(?:ha noi|hanoi)$/.test(f)) return 'hanoi'
  if (/^(?:da nang|danang)$/.test(f)) return 'danang'
  return null
}

/** City from the address's last city-naming segment, else from a category slug that names it.
 *  Null when neither says. */
export function cityOf(address: string | null, categorySlugs: string[]): CityKey | null {
  const segs = (address ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  for (let i = segs.length - 1; i >= 0; i--) {
    const c = citySegment(segs[i])
    if (c) return c
  }
  if (categorySlugs.some((s) => s.endsWith('-in-hcmc'))) return 'hcmc'
  if (categorySlugs.some((s) => s.endsWith('-in-hanoi'))) return 'hanoi'
  if (categorySlugs.some((s) => s.endsWith('-in-da-nang') || s.endsWith('-in-danang'))) return 'danang'
  return null
}

/**
 * HCMC named districts: folded English spelling → the Vietnamese `Listing.district` string live
 * rentals already use (read-only prod query, 2026-09-24: 'Quận Bình Thạnh' 1,855, 'TP. Thủ Đức'
 * 707, …), and the English form for the English title. Each Vietnamese value substring-matches its
 * DISTRICTS[].match entry in listings-explorer.constants.ts — the unit test asserts that.
 */
const NAMED_DISTRICTS: Record<string, { vi: string; en: string }> = {
  'binh thanh': { vi: 'Quận Bình Thạnh', en: 'Binh Thanh District' },
  'phu nhuan': { vi: 'Quận Phú Nhuận', en: 'Phu Nhuan District' },
  'tan binh': { vi: 'Quận Tân Bình', en: 'Tan Binh District' },
  'go vap': { vi: 'Quận Gò Vấp', en: 'Go Vap District' },
  'tan phu': { vi: 'Quận Tân Phú', en: 'Tan Phu District' },
  'binh tan': { vi: 'Quận Bình Tân', en: 'Binh Tan District' },
  'thu duc': { vi: 'TP. Thủ Đức', en: 'Thu Duc City' },
  'nha be': { vi: 'Huyện Nhà Bè', en: 'Nha Be District' },
  'binh chanh': { vi: 'Huyện Bình Chánh', en: 'Binh Chanh District' },
  'hoc mon': { vi: 'Huyện Hóc Môn', en: 'Hoc Mon District' },
  'cu chi': { vi: 'Huyện Củ Chi', en: 'Cu Chi District' },
  'can gio': { vi: 'Huyện Cần Giờ', en: 'Can Gio District' },
}

/**
 * The district, from the details panel ("2", "Binh Thanh") or failing that the address
 * ("…, District 2, HCMC"). ⚠️ STORED AS THE PRE-2025 DISTRICT, INCLUDING THE ABOLISHED 'Quận 2',
 * because that is what the source says and what the explorer's chips match (contract §7).
 * Only meaningful for HCMC; other cities get null rather than an HCMC district name.
 */
export function districtOf(raw: string | null, address: string | null): { vi: string; en: string } | null {
  const tryOne = (s: string | null): { vi: string; en: string } | null => {
    if (!s) return null
    const f = fold(s).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
    const num = /^(?:district|quan|q)?\s*(\d{1,2})$/.exec(f)
    if (num) {
      const n = Number(num[1])
      return n >= 1 && n <= 12 ? { vi: `Quận ${n}`, en: `District ${n}` } : null
    }
    const name = f.replace(/^(?:district|quan|huyen|tp|thanh pho)\s+/, '').replace(/\s+(?:district|city)$/, '')
    return NAMED_DISTRICTS[name] ?? null
  }
  const direct = tryOne(raw)
  if (direct) return direct
  for (const part of (address ?? '').split(',')) {
    const hit = /\bDistrict\b|\bQuận\b|\bCity\b/i.test(part) ? tryOne(part) : null
    if (hit) return hit
  }
  return null
}

/** The ward segment of the address AS WRITTEN: "An Phu Ward" → named "An Phu"; "Ward 6" → numbered
 *  6. Unchecked — `checkWard` decides whether it may be published. There is no ward column
 *  (contract §7); a ward only ever reaches the titles, `location` and the description. */
export type RawWard = { kind: 'numbered'; n: number } | { kind: 'named'; name: string }
export function wardOf(address: string | null): RawWard | null {
  for (const part of (address ?? '').split(',').map((s) => s.trim())) {
    const numbered = /^Ward\s+(\d{1,2})$/i.exec(part)
    if (numbered) return { kind: 'numbered', n: Number(numbered[1]) }
    const named = /^(.{2,40}?)\s+Ward$/i.exec(part)
    if (named && !/\d/.test(named[1])) return { kind: 'named', name: named[1].trim() }
  }
  return null
}

/**
 * HCMC's pre-2025 wards per district, with each district's GSO ward-code block. Source: the
 * pre-reform dataset at https://provinces.open-api.vn/api/v1/p/79?depth=3 (robots.txt allows all),
 * fetched 2026-09-24 — 273 wards, the 2024 state. Its "Thành phố Thủ Đức" is split back into the
 * three districts it merged (old Thủ Đức 26794-26827, Quận 9 26830-26866, Quận 2 27088-27118),
 * because the source — and `Listing.district` — still name those.
 * ⚠️ WHY A SECOND DATASET: src/data/vn-units.json is the 2025 model (province → ward, no districts
 * at all), so it cannot say which district a ward belonged to. It is still used below: a 2025 ward's
 * GSO code is the code of one of the old wards it absorbed, so the code block places it.
 * Keys are the exact `Listing.district` strings `districtOf` emits.
 */
const HCMC_OLD_WARDS: readonly (readonly [district: string, codeLo: number, codeHi: number, wards: string])[] = [
  ['Quận 1', 26734, 26761, 'Tân Định|Đa Kao|Bến Nghé|Bến Thành|Nguyễn Thái Bình|Phạm Ngũ Lão|Cầu Ông Lãnh|Cô Giang|Nguyễn Cư Trinh|Cầu Kho'],
  ['Quận 12', 26764, 26791, 'Thạnh Xuân|Thạnh Lộc|Hiệp Thành|Thới An|Tân Chánh Hiệp|An Phú Đông|Tân Thới Hiệp|Trung Mỹ Tây|Tân Hưng Thuận|Đông Hưng Thuận|Tân Thới Nhất'],
  ['Thủ Đức', 26794, 26827, 'Linh Xuân|Bình Chiểu|Linh Trung|Tam Bình|Tam Phú|Hiệp Bình Phước|Hiệp Bình Chánh|Linh Chiểu|Linh Tây|Linh Đông|Bình Thọ|Trường Thọ'],
  ['Quận 9', 26830, 26866, 'Long Bình|Long Thạnh Mỹ|Tân Phú|Hiệp Phú|Tăng Nhơn Phú A|Tăng Nhơn Phú B|Phước Long B|Phước Long A|Trường Thạnh|Long Phước|Long Trường|Phước Bình|Phú Hữu'],
  ['Quận Gò Vấp', 26872, 26902, '15|17|6|16|12|14|10|5|1|8|11|3'],
  ['Quận Bình Thạnh', 26905, 26962, '13|11|27|26|12|25|5|7|14|2|1|17|22|19|28'],
  ['Quận Tân Bình', 26965, 27007, '2|4|12|13|1|3|11|7|5|10|6|8|9|14|15'],
  ['Quận Tân Phú', 27010, 27040, 'Tân Sơn Nhì|Tây Thạnh|Sơn Kỳ|Tân Quý|Tân Thành|Phú Thọ Hòa|Phú Thạnh|Phú Trung|Hòa Thạnh|Hiệp Tân|Tân Thới Hòa'],
  ['Quận Phú Nhuận', 27043, 27085, '4|5|9|7|1|2|8|15|10|11|13'],
  ['Quận 2', 27088, 27118, 'Thảo Điền|An Phú|An Khánh|Bình Trưng Đông|Bình Trưng Tây|Cát Lái|Thạnh Mỹ Lợi|An Lợi Đông|Thủ Thiêm'],
  ['Quận 3', 27127, 27160, '14|12|11|Võ Thị Sáu|9|4|5|3|2|1'],
  ['Quận 10', 27163, 27202, '15|13|14|12|10|9|1|8|2|4|6'],
  ['Quận 11', 27208, 27253, '15|5|14|11|3|10|8|7|1|16'],
  ['Quận 4', 27259, 27298, '13|9|8|18|4|3|16|2|15|1'],
  ['Quận 5', 27301, 27343, '4|9|2|12|7|1|11|14|5|13'],
  ['Quận 6', 27346, 27385, '14|13|9|12|2|11|8|1|7|10'],
  ['Quận 8', 27397, 27433, 'Rạch Ông|Hưng Phú|4|Xóm Củi|5|14|6|15|16|7'],
  ['Quận Bình Tân', 27436, 27463, 'Bình Hưng Hòa|Bình Hưng Hoà A|Bình Hưng Hoà B|Bình Trị Đông|Bình Trị Đông A|Bình Trị Đông B|Tân Tạo|Tân Tạo A|An Lạc|An Lạc A'],
  ['Quận 7', 27466, 27493, 'Tân Thuận Đông|Tân Thuận Tây|Tân Kiểng|Tân Hưng|Bình Thuận|Tân Quy|Phú Thuận|Tân Phú|Tân Phong|Phú Mỹ'],
  ['Huyện Củ Chi', 27496, 27556, 'Củ Chi|Phú Mỹ Hưng|An Phú|Trung Lập Thượng|An Nhơn Tây|Nhuận Đức|Phạm Văn Cội|Phú Hòa Đông|Trung Lập Hạ|Trung An|Phước Thạnh|Phước Hiệp|Tân An Hội|Phước Vĩnh An|Thái Mỹ|Tân Thạnh Tây|Hòa Phú|Tân Thạnh Đông|Bình Mỹ|Tân Phú Trung|Tân Thông Hội'],
  ['Huyện Hóc Môn', 27559, 27592, 'Hóc Môn|Tân Hiệp|Nhị Bình|Đông Thạnh|Tân Thới Nhì|Thới Tam Thôn|Xuân Thới Sơn|Tân Xuân|Xuân Thới Đông|Trung Chánh|Xuân Thới Thượng|Bà Điểm'],
  ['Huyện Bình Chánh', 27595, 27640, 'Tân Túc|Phạm Văn Hai|Vĩnh Lộc A|Vĩnh Lộc B|Bình Lợi|Lê Minh Xuân|Tân Nhựt|Tân Kiên|Bình Hưng|Phong Phú|An Phú Tây|Hưng Long|Đa Phước|Tân Quý Tây|Bình Chánh|Quy Đức'],
  ['Huyện Nhà Bè', 27643, 27661, 'Nhà Bè|Phước Kiển|Phước Lộc|Nhơn Đức|Phú Xuân|Long Thới|Hiệp Phước'],
  ['Huyện Cần Giờ', 27664, 27682, 'Cần Thạnh|Bình Khánh|Tam Thôn Hiệp|An Thới Đông|Thạnh An|Long Hòa|Lý Nhơn'],
]
/** A `Listing.district` value that spans several old districts. */
const DISTRICT_GROUPS: Record<string, string[]> = { 'TP. Thủ Đức': ['Thủ Đức', 'Quận 9', 'Quận 2'] }
/** The old districts a `Listing.district` string covers — every string `districtOf` can emit has one. */
export const oldDistrictsFor = (districtVi: string) =>
  HCMC_OLD_WARDS.filter(([d]) => (DISTRICT_GROUPS[districtVi] ?? [districtVi]).includes(d))

/** Accent-, case-, space- and punctuation-free, so "Dakao" = "Đa Kao" and "Hoà" = "Hòa". */
const squash = (s: string) => fold(s).replace(/[^a-z0-9]/g, '')

/**
 * ⛔ A WARD IS PUBLISHED ONLY IF IT IS CONSISTENT WITH THE DISTRICT; OTHERWISE IT IS DROPPED AND THE
 * DISTRICT KEPT. The source is hand-typed by agents: honeycomb:317872 reads "Tang Nhon Phu A Ward,
 * District 2", a Quận 9 ward (review 2026-09-24), and a wrong ward in a title is a wrong place.
 *   · named ward — in the district's pre-2025 list above, or a 2025 ward of the province
 *     (src/data/vn-units.json) whose GSO code falls in the district's code block;
 *   · "Ward N" — only in a district that numbers its wards (Quận 3, Bình Thạnh …), N ≤ 30. A number
 *     is not checked against the 2024 list, which dropped some numbers the source still writes;
 *   · no district known — a named ward that exists anywhere in the city; a bare number never;
 *   · Hà Nội / Đà Nẵng — a 2025 ward name of that province (no older dataset here); never a number.
 * Anything else, including a ward this data cannot place, is dropped: FAIL CLOSED.
 */
export function checkWard(raw: RawWard | null, cityKey: CityKey, districtVi: string | null): { en: string; vi: string } | null {
  if (!raw) return null
  const province = provinceOf(cityKey)
  if (cityKey !== 'hcmc') {
    if (raw.kind !== 'named') return null
    const hit = province.wards.find((w) => squash(w.name) === squash(raw.name))
    return hit ? { en: `${raw.name} Ward`, vi: `P. ${hit.name}` } : null
  }
  const blocks = districtVi ? oldDistrictsFor(districtVi) : HCMC_OLD_WARDS
  if (!blocks.length) return null
  if (raw.kind === 'numbered') {
    if (!districtVi || !(raw.n >= 1 && raw.n <= 30)) return null
    const numbers = blocks.some(([, , , wards]) => wards.split('|').some((w) => /^\d+$/.test(w)))
    return numbers ? { en: `Ward ${raw.n}`, vi: `Phường ${raw.n}` } : null
  }
  const key = squash(raw.name)
  if (!key) return null
  for (const [, , , wards] of blocks) {
    const old = wards.split('|').find((w) => squash(w) === key)
    if (old) return { en: `${raw.name} Ward`, vi: `P. ${old}` }
  }
  const now = province.wards.find((w) => squash(w.name) === key)
  const code = now ? Number(now.code) : NaN
  if (now && blocks.some(([, lo, hi]) => code >= lo && code <= hi)) return { en: `${raw.name} Ward`, vi: `P. ${now.name}` }
  return null
}

/**
 * The street NAME(S) of an address with every house number gone. ⛔ NEVER PUBLISH A HOUSE NUMBER:
 * any comma segment carrying a digit is dropped whole ("No.49", "628C Ha Noi Highway", "Street 66"),
 * as are the ward, district and city segments (those are published only after `checkWard` /
 * `districtOf`). What is left is a bare street name such as "Hoang Hoa Tham Street", or null.
 */
export function streetOf(address: string | null): string | null {
  const keep = (address ?? '').split(',').map((s) => s.trim()).filter((seg) =>
    seg && !/\d/.test(seg) &&
    !/\bWard\b|\bDistrict\b|\bCity\b|\bQuận\b|\bHuyện\b|\bPhường\b|^P\.\s/i.test(seg) &&
    citySegment(seg) === null && !/^(viet ?nam|vn)$/.test(fold(seg)))
  return keep.length ? keep.join(', ') : null
}

/** Does this text still carry a house or street number? Administrative numbers ("Quận 2",
 *  "Phường 6", "District 7", "Ward 22") are allowed; any other digit is not. */
export const hasHouseNumber = (text: string | null | undefined) =>
  /\d/.test((text ?? '').replace(/\b(?:Quận|Phường|District|Ward)\s+\d{1,2}\b/gi, ''))

/** Name → slug for a map building. */
export type BuildingRef = { slug: string; name: string; lat: number; lng: number }

/** "The Estella Heights" and "Estella Heights" are one tower; "Diamond Island - Đảo Kim Cương" is
 *  "Diamond Island". Folded, the part before " - ", no leading "the", alphanumerics only. */
export function buildingNameKey(name: string): string {
  return fold(name.split(' - ')[0]).replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * The map building (src/generated/rever-buildings.ts) this project names, or null. `buildingKey`
 * is what /api/listings/buildings groups on and the module is where the pin's label and centroid
 * live, so only a slug the module knows is worth writing. ⛔ AN AMBIGUOUS NAME MATCHES NOTHING:
 * two buildings folding to the same key would otherwise file a unit under a coin flip.
 */
export function buildingFor(project: string | null, buildings: Record<string, BuildingRef>): BuildingRef | null {
  if (!project) return null
  const key = buildingNameKey(project)
  if (!key) return null
  const hits = Object.values(buildings).filter((b) => buildingNameKey(b.name) === key)
  return hits.length === 1 ? hits[0] : null
}

/** Round a converted rent to 10,000 đ — it is an approximation and should read like one. */
export function usdToVnd(usd: number, vndPerUsd: number): number {
  return Math.round((usd * vndPerUsd) / 10_000) * 10_000
}

/**
 * đồng per dollar from `https://open.er-api.com/v6/latest/USD`, or null. ⚠️ THE USD-BASE FEED,
 * NOT THE VND-BASE ONE /api/fx READS: that one prints rates.USD as 3.9e-05 — two significant
 * figures — which inverts to 25,641 against the USD base's 25,971.63 on the same timestamp
 * (measured 2026-09-24), a 1.3% error on every price. Band-checked like src/lib/visa/fx.ts.
 */
export function vndPerUsdFrom(json: unknown): number | null {
  const d = json as { result?: unknown; rates?: Record<string, unknown> } | null
  if (!d || d.result !== 'success' || !d.rates) return null
  const r = d.rates.VND
  return inRange(r, VND_PER_USD_BAND.min, VND_PER_USD_BAND.max) ? r : null
}

const fmtUsd = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)
const fmtUsdVi = (n: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(n)

/** The line that carries the SOURCE price in the description. Also how a re-run tells whether the
 *  dollar figure changed (`usdFromDescription`), so its shape is part of the contract. */
export const rentLine = (usd: number) => `Rent: US$${fmtUsd(usd)}/month`

/** The USD figure a stored description was written from, or null. */
export function usdFromDescription(description: string | null | undefined): number | null {
  const m = /Rent: US\$([\d,]+(?:\.\d{1,2})?)\/month/.exec(description ?? '')
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * ⚠️ A RE-RUN MUST NOT RE-PRICE A ROW JUST BECAUSE THE EXCHANGE RATE MOVED. The dollar figure is
 * the source's; the đồng one is ours. If the stored description was written from the same dollar
 * amount, the stored price stands — otherwise every run would rewrite every row (and bump
 * `updatedAt`, which the sitemap orders by) over a 0.1% FX wobble.
 */
export function priceToStore(existing: { price: number; description: string } | null, usd: number, fresh: number): number {
  if (existing && usdFromDescription(existing.description) === usd && inRange(existing.price, VND_BAND.min, VND_BAND.max)) {
    return existing.price
  }
  return fresh
}

export type DropReason =
  | 'badTarget' | 'category' | 'noPrice' | 'notUsd' | 'perM2' | 'notMonthly' | 'usdBand' | 'vndBand'
  | 'city' | 'cityFilter' | 'tooFewImages' | 'houseNumber'

export type MappedHoneycomb = {
  externalId: string
  affiliateUrl: string
  title: string
  titleVi: string
  description: string
  descriptionVi: string
  priceUsd: number
  /** Converted at `vndPerUsd`; the script may keep an older stored value (priceToStore). */
  price: number
  subcategorySlug: string
  city: string
  district: string | null
  location: string
  areaM2: number | null
  attributes: string | null
  lat: number | null
  lng: number | null
  buildingKey: string | null
  searchText: string
  images: string[]
  /** Mixed-language segments the reviewed dictionary does not cover yet (import-i18n.ts) — a report, never stored. */
  untranslated: MissingSegment[]
}

/**
 * Keep-or-drop, and the row as it would be stored. Every drop names its reason so the dry run's
 * histogram explains itself.
 */
export function assessHoneycomb(
  r: HoneycombRecord,
  opts: { vndPerUsd: number; minImages: number; cityFilter: CityKey | null; buildings: Record<string, BuildingRef> },
): { ok: true; row: MappedHoneycomb } | { ok: false; reason: DropReason } {
  if (!allowedTarget(r.url)) return { ok: false, reason: 'badTarget' }
  const cat = r.categorySlugs.map((s) => CATEGORY_MAP[s]).find(Boolean)
  if (!cat) return { ok: false, reason: 'category' }

  /**
   * ⛔ TWO INDEPENDENT PRICE GUARDS, AS ON BATDONGSAN. A per-m² or per-night figure published as the
   * monthly rent is the one lie a renter reads first, so the unit labels and the price text are
   * each allowed to veto: either one saying "not a monthly lump sum" drops the row.
   */
  /** No figure at all (4 of the newest 30 on 2026-09-24 — the "call us" listings) is its own reason. */
  if (!r.priceText || !/\d/.test(r.priceText)) return { ok: false, reason: 'noPrice' }
  const priceAll = `${r.priceText} ${r.priceLabel}`
  if (/\/\s*m\b|m2|m²|sqm|sq\.?\s?m/i.test(priceAll)) return { ok: false, reason: 'perM2' }
  if (/night|day|week|year|đêm|ngày|tuần|năm/i.test(priceAll)) return { ok: false, reason: 'notMonthly' }
  const usd = parseUsd(r.priceText)
  if (usd === null) return { ok: false, reason: 'notUsd' }
  if (!inRange(usd, USD_MONTHLY_BAND.min, USD_MONTHLY_BAND.max)) return { ok: false, reason: 'usdBand' }
  const price = usdToVnd(usd, opts.vndPerUsd)
  if (!inRange(price, VND_BAND.min, VND_BAND.max)) return { ok: false, reason: 'vndBand' }

  const cityKey = cityOf(r.address, r.categorySlugs)
  if (!cityKey) return { ok: false, reason: 'city' }
  if (opts.cityFilter && cityKey !== opts.cityFilter) return { ok: false, reason: 'cityFilter' }
  if (r.images.length < opts.minImages) return { ok: false, reason: 'tooFewImages' }

  const district = cityKey === 'hcmc' ? districtOf(r.districtRaw, r.address) : null
  /** ⛔ Only a ward consistent with the district is published (checkWard); the district is kept either way. */
  const ward = checkWard(wardOf(r.address), cityKey, district?.vi ?? null)
  /** ⛔ The street NAME only — never the house number the source prints (streetOf). */
  const street = streetOf(r.address)
  const building = buildingFor(r.project, opts.buildings)
  /** A missing bedroom count is NOT a Studio (contract §9): no count, no attribute. */
  // Bedrooms AND bathrooms, clamped at the taxonomy's open-ended top bucket (6+) — roomAttributes.
  const attributes = roomAttributes({ bedrooms: r.bedrooms, bathrooms: r.bathrooms })
  const area = r.areaM2 !== null && Number.isFinite(r.areaM2) && r.areaM2 > 0 ? r.areaM2 : null

  const bits: string[] = []
  if (r.bedrooms) bits.push(`${r.bedrooms} bed`)
  if (r.bathrooms) bits.push(`${r.bathrooms} bath`)
  if (area) bits.push(`${area} m²`)
  const whereEn = [r.project, ward?.en, district?.en].filter(Boolean).join(', ')
  const whereVi = [r.project, ward?.vi, district?.vi].filter(Boolean).join(', ')
  const cap = (t: string) => t[0].toUpperCase() + t.slice(1)
  const head = bits.length ? `${bits.join(' · ')} ${cat.en}` : cap(cat.en)
  const title = `${head} for rent${whereEn ? ` — ${whereEn}` : ''}`
  const titleVi = `Cho thuê ${cat.vi}${r.bedrooms ? ` ${r.bedrooms}PN` : ''}${area ? ` ${area}m²` : ''}${whereVi ? ` — ${whereVi}` : ''}`

  /**
   * ⛔ `location` IS COMPOSED FROM CHECKED PARTS, NEVER COPIED FROM THE SOURCE ADDRESS, which prints
   * house numbers ("No.49, Street 66, …", "628C Ha Noi Highway, …"). Vietnamese, like the
   * 'Quận 1 (P. …)' shape the other importers store; HCMC omits the city (the whole catalogue is
   * HCMC and `city` carries it), other cities name it; nothing known at all → the city alone.
   */
  const placeVi = [ward?.vi, district?.vi, cityKey === 'hcmc' ? null : CITY_NAME_VI[cityKey]].filter(Boolean).join(', ')
  const location = placeVi || CITY_NAME_VI[cityKey]
  const placeEn = [ward?.en, district?.en, CITY_NAME_EN[cityKey]].filter(Boolean).join(', ')
  const placeViFull = [ward?.vi, district?.vi, CITY_NAME_VI[cityKey]].filter(Boolean).join(', ')

  const factsEn = ([
    ['Type', cap(cat.en)], ['Project', r.project], ['Bedrooms', r.bedrooms], ['Bathrooms', r.bathrooms],
    ['Area', area ? `${area} m²` : null], ['Street', street], ['Location', placeEn], ['Listing code', r.code],
  ] as [string, unknown][]).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}: ${v}`)
  const factsVi = ([
    ['Loại', cap(cat.vi)], ['Dự án', r.project], ['Phòng ngủ', r.bedrooms], ['Phòng tắm', r.bathrooms],
    ['Diện tích', area ? `${area} m²` : null], ['Đường', street], ['Khu vực', placeViFull], ['Mã tin', r.code],
  ] as [string, unknown][]).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}: ${v}`)

  const description = [
    'Listed on Honeycomb House (honeycomb.com.vn).',
    '',
    ...factsEn,
    rentLine(usd),
    '',
    'Honeycomb House quotes this rent in US dollars. The đồng price shown on eno is converted from it and is approximate.',
  ].join('\n')
  const descriptionVi = [
    'Tin đăng trên Honeycomb House (honeycomb.com.vn).',
    '',
    ...factsVi,
    `Giá thuê: ${fmtUsdVi(usd)} USD/tháng`,
    '',
    'Honeycomb House niêm yết giá thuê bằng USD. Giá VND hiển thị trên eno được quy đổi từ USD và chỉ mang tính tham khảo.',
  ].join('\n')
  /** Belt and braces: composed from checked parts, so this cannot trip — if it ever does, drop. */
  if (hasHouseNumber(location) || hasHouseNumber(street)) return { ok: false, reason: 'houseNumber' }

  /**
   * ⛔ THE VIETNAMESE TEXT IS MADE VIETNAMESE HERE, NOT LATER IN THE DATABASE (import-i18n.ts): the
   * source is an English site, so the Vietnamese block printed "Đường: Song Hanh Street". Every text
   * field is refreshed (mutableOf), so only a fix in the mapper survives a re-run. The English "Rent:
   * US$…" line is en-US already and is left alone, so usdFromDescription still reads it. Before
   * `searchText`, which folds the localized titles.
   */
  const text = localizeImportText({ title, titleVi, description, descriptionVi })

  const lat = building && inRange(building.lat, 8, 24) ? building.lat : null
  const lng = building && inRange(building.lng, 102, 110) ? building.lng : null
  return {
    ok: true,
    row: {
      externalId: `${EXTERNAL_ID_PREFIX}${r.postId}`,
      affiliateUrl: r.url,
      title: text.title, titleVi: text.titleVi, description: text.description, descriptionVi: text.descriptionVi,
      priceUsd: usd,
      price,
      subcategorySlug: cat.subcategorySlug,
      city: CITY_NAME[cityKey],
      district: district?.vi ?? null,
      location,
      areaM2: area,
      attributes,
      // Both or neither: a half coordinate is not a place.
      lat: lat !== null && lng !== null ? lat : null,
      lng: lat !== null && lng !== null ? lng : null,
      buildingKey: building?.slug ?? null,
      /** ⚠️ title and titleVi FIRST — rebaseSearchText (import-i18n.ts) relies on that order. */
      searchText: buildSearchText([text.title, text.titleVi, street, placeEn, placeViFull, r.project, cat.en, cat.vi, r.code]),
      images: r.images,
      untranslated: text.missing,
    },
  }
}

/** Share (0–100) of an 8-bit greyscale raster darker than near-white — set-partner-avatar.ts's
 *  visibility measure, so a white-on-transparent mark is caught before it ships as a blank disc. */
export function visiblePct(grey: Uint8Array): number {
  if (!grey.length) return 0
  let visible = 0
  for (const px of grey) if (px < 245) visible++
  return (visible / grey.length) * 100
}

// ── run plumbing: stage file, refusals, rate limit, retirement ──────────────────────────────

/** `source` stamp of a staged file, so another importer's file is refused rather than misread. */
export const STAGE_SOURCE = 'honeycomb.com.vn'
/** ⛔ A staged file older than this cannot be applied — same limit as the nhatot importer. */
export const STAGE_MAX_AGE_H = 72
/** Owner decision 2026-09-24: only listings the agency touched in the last 90 days are imported. */
export const DEFAULT_SINCE_DAYS = 90
/** Politeness: ⛔ NEVER UNDER 1.2 s between requests — the floor, not just the default (import
 *  contract: ≥1.2 s per host). `--delay-ms` can slow the crawl down, never speed it past this. */
export const DELAY_MS = { default: 1200, min: 1200, max: 60_000 } as const

/** One parsed detail page as staged, plus its sitemap `lastmod`. */
export type StagedHoneycomb = HoneycombRecord & { lastmod: string | null }

/** The reviewed file `--apply` imports from. Everything the write needs is in it — including the
 *  exchange rate, so the prices a reviewer read are the prices that get stored. */
export type HoneycombStage = {
  source: typeof STAGE_SOURCE
  fetchedAt: string
  userAgent: string
  params: { since: string; limit: number; city: CityKey | null }
  fx: { vndPerUsd: number; source: string }
  /** The full sitemap URL set — the retire pass's candidate list — and whether every map was read. */
  sitemap: { maps: number; mapsOk: number; complete: boolean; entries: SitemapEntry[] }
  /** Page-level outcome of the crawl: drops before parsing, and why the read stopped early (if it did). */
  pages: { read: number; drop: Record<string, number>; stopped: string | null }
  records: StagedHoneycomb[]
}

const optStr = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length <= max ? v : null
const optCount = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 100 ? v : null

/**
 * ⛔ THE FIELD ALLOWLIST, APPLIED WHEN A RECORD IS STAGED AND AGAIN WHEN A STAGED FILE IS READ.
 * A hand-edited file must not smuggle a field, an off-host link or an off-host photo into the
 * write: every field is rebuilt from scratch, type-checked and host-pinned, and anything else is
 * dropped. Returns null when the record's identity (url, post id) does not survive.
 */
export function stageHoneycombRecord(raw: unknown): StagedHoneycomb | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!allowedTarget(r.url)) return null
  if (typeof r.postId !== 'string' || !/^\d{1,12}$/.test(r.postId)) return null
  const slugs = Array.isArray(r.categorySlugs)
    ? r.categorySlugs.filter((x): x is string => typeof x === 'string' && /^[a-z0-9-]{1,80}$/.test(x)).slice(0, 10)
    : []
  const images: string[] = []
  if (Array.isArray(r.images)) for (const u of r.images) if (allowedImage(u) && !images.includes(u) && images.length < 40) images.push(u)
  const area = typeof r.areaM2 === 'number' && Number.isFinite(r.areaM2) && r.areaM2 > 0 && r.areaM2 < 100_000 ? r.areaM2 : null
  return {
    url: r.url,
    postId: r.postId,
    code: optStr(r.code, 40),
    sourceTitle: optStr(r.sourceTitle, 300) ?? '',
    categorySlugs: slugs,
    priceText: optStr(r.priceText, 100),
    priceLabel: optStr(r.priceLabel, 100) ?? '',
    bedrooms: optCount(r.bedrooms),
    bathrooms: optCount(r.bathrooms),
    districtRaw: optStr(r.districtRaw, 80),
    address: optStr(r.address, 300),
    project: optStr(r.project, 120),
    areaM2: area,
    images,
    lastmod: optStr(r.lastmod, 40),
  }
}

/**
 * A staged file, re-validated. ⛔ Refuses a file from another source, one with no parsable
 * `fetchedAt`, or one whose exchange rate is outside the plausibility band; re-runs the record
 * allowlist and drops duplicate post ids (first wins). `complete` is true only when it says so.
 */
export function readHoneycombStage(json: unknown): { ok: true; stage: HoneycombStage; rejected: number } | { ok: false; reason: string } {
  if (!json || typeof json !== 'object') return { ok: false, reason: 'not a JSON object' }
  const j = json as Record<string, unknown>
  if (j.source !== STAGE_SOURCE) return { ok: false, reason: `source is ${JSON.stringify(j.source)}, not "${STAGE_SOURCE}"` }
  if (typeof j.fetchedAt !== 'string' || !Number.isFinite(Date.parse(j.fetchedAt))) return { ok: false, reason: 'no parsable fetchedAt' }
  const fx = (j.fx ?? {}) as Record<string, unknown>
  if (!inRange(fx.vndPerUsd, VND_PER_USD_BAND.min, VND_PER_USD_BAND.max)) return { ok: false, reason: `fx.vndPerUsd ${JSON.stringify(fx.vndPerUsd)} is outside ${VND_PER_USD_BAND.min}–${VND_PER_USD_BAND.max}` }
  if (!Array.isArray(j.records)) return { ok: false, reason: 'no records array' }
  const sm = (j.sitemap ?? {}) as Record<string, unknown>
  const entries: SitemapEntry[] = Array.isArray(sm.entries)
    ? sm.entries.flatMap((e) => {
      const x = e as Record<string, unknown> | null
      return x && allowedTarget(x.url) ? [{ url: x.url, lastmod: optStr(x.lastmod, 40) }] : []
    })
    : []
  const p = (j.params ?? {}) as Record<string, unknown>
  const pg = (j.pages ?? {}) as Record<string, unknown>
  const seen = new Set<string>()
  const records: StagedHoneycomb[] = []
  let rejected = 0
  for (const raw of j.records) {
    const rec = stageHoneycombRecord(raw)
    if (!rec || seen.has(rec.postId)) { rejected++; continue }
    seen.add(rec.postId)
    records.push(rec)
  }
  const drop: Record<string, number> = {}
  if (pg.drop && typeof pg.drop === 'object') for (const [k, v] of Object.entries(pg.drop)) if (typeof v === 'number') drop[k] = v
  return {
    ok: true,
    rejected,
    stage: {
      source: STAGE_SOURCE,
      fetchedAt: j.fetchedAt,
      userAgent: optStr(j.userAgent, 200) ?? '',
      params: {
        since: optStr(p.since, 10) ?? '',
        limit: typeof p.limit === 'number' && Number.isInteger(p.limit) && p.limit >= 0 ? p.limit : 0,
        city: CITY_KEYS.includes(p.city as CityKey) ? (p.city as CityKey) : null,
      },
      fx: { vndPerUsd: fx.vndPerUsd as number, source: optStr(fx.source, 200) ?? '' },
      sitemap: {
        maps: typeof sm.maps === 'number' ? sm.maps : 0,
        mapsOk: typeof sm.mapsOk === 'number' ? sm.mapsOk : 0,
        complete: sm.complete === true && entries.length > 0,
        entries,
      },
      pages: { read: typeof pg.read === 'number' ? pg.read : 0, drop, stopped: optStr(pg.stopped, 300) },
      records,
    },
  }
}

/** Why a staged file may not be applied at `now`, or null. Uses the file's OWN `fetchedAt` (an mtime
 *  is reset by cp/touch/checkout). `!(age <= max)` so a garbled date fails; a future date fails too. */
export function stageAgeProblem(fetchedAt: unknown, now: number, maxH: number = STAGE_MAX_AGE_H): string | null {
  const t = typeof fetchedAt === 'string' ? Date.parse(fetchedAt) : NaN
  const ageH = (now - t) / 3_600_000
  if (!Number.isFinite(ageH)) return `fetchedAt ${JSON.stringify(fetchedAt)} is not a date`
  if (ageH < -0.1) return `fetchedAt ${fetchedAt} is in the future`
  if (!(ageH <= maxH)) return `staged ${fetchedAt} (${ageH.toFixed(1)} h ago) — over ${maxH} h; re-stage with --save`
  return null
}

/**
 * The flag combination a run may start with, or why not. ⛔ CHECKED BEFORE ANY NETWORK OR DATABASE
 * CALL: `--apply` only ever imports a staged, reviewed file (`--src`), and only with a journal dir
 * to record every upload in — a run that is going to refuse must refuse before it has crawled.
 */
/**
 * A valued flag present with no value after it, or null. ⚠️ `--limit` with no value fell back to its
 * default 0 = NO limit, so `--src f.json --limit --apply` imported the whole file; `--src` with no
 * value quietly meant a live crawl. The flag is refused instead (the nhatot and muaban importers do
 * the same).
 */
export const HONEYCOMB_VALUED_FLAGS = ['--limit', '--city', '--since', '--vnd-per-usd', '--src', '--save', '--journal-dir', '--delay-ms'] as const
export function valuedFlagProblem(argv: readonly string[]): string | null {
  for (const k of HONEYCOMB_VALUED_FLAGS) {
    const i = argv.indexOf(k)
    if (i > -1 && (argv[i + 1] === undefined || argv[i + 1] === '' || argv[i + 1].startsWith('--'))) return `${k} needs a value`
  }
  return null
}

export function applyPreflight(o: { apply: boolean; src: string | null; save: string | null; journalDir: string | null; retire: boolean; limit: number }): string | null {
  if (o.src && o.save) return '--save stages a LIVE read; --src already is a staged file'
  if (o.apply && !o.src) return '--apply imports only a reviewed staged file: stage with --save <file>, review it, then --src <file> --apply'
  if (o.apply && !o.journalDir) return '--apply needs --journal-dir <durable dir> for the upload manifest and created-row journal'
  if (o.retire && o.limit) return '--retire needs the whole import in view; drop --limit'
  return null
}

/** Why `dir` is not a place for the journal, or null. ⛔ Not a temp dir: macOS empties /tmp on
 *  reboot and the journal is the only record of what to sweep or undo (attach-rever-photos.ts). */
export function journalDirProblem(dir: string | null, tmpRoots: string[]): string | null {
  if (!dir || !dir.trim()) return '--journal-dir is empty'
  if (!dir.startsWith('/')) return `--journal-dir ${dir} must be an absolute path`
  const norm = dir.replace(/\/+$/, '')
  for (const t of tmpRoots.map((x) => x.replace(/\/+$/, '')).filter(Boolean)) {
    if (norm === t || norm.startsWith(`${t}/`)) return `--journal-dir ${dir} is under ${t}, which the OS may empty — use a durable directory`
  }
  return null
}

/**
 * ⛔ A RATE-LIMIT ARGUMENT CAN NEVER TURN THE RATE LIMIT OFF. `Number('1500ms')` is NaN and a NaN
 * wait is no wait; `Infinity` or 1e10 overflow setTimeout, which then fires after 1 ms. Anything
 * not a finite number falls back to the default; a finite one is clamped to [min, max].
 */
export function parseDelayMs(raw: string | null | undefined, d: { default: number; min: number; max: number } = DELAY_MS): number {
  const n = raw === null || raw === undefined || raw.trim() === '' ? NaN : Number(raw)
  if (!Number.isFinite(n)) return d.default
  return Math.min(d.max, Math.max(d.min, n))
}

// ── the fetcher: one request at a time, rate-gated, redirects followed only inside the site ─────

/** The site refused us in a way we must not work around. The run stops; nothing is bypassed. */
export class Infeasible extends Error {}

export const HONEYCOMB_HOST = new URL(HONEYCOMB_ORIGIN).host
/** RFC 9309 §2.3.1.2 asks a crawler to follow at least five redirects; more than that is a loop. */
export const MAX_REDIRECTS = 5
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])

/**
 * Where a redirect may be followed to, or why not. ⛔ ONLY honeycomb.com.vn → honeycomb.com.vn, over
 * https, to a path that site's robots.txt allows (when it has been read). robots.txt, the host pins
 * and the rate gate all describe honeycomb.com.vn alone: a hop to any other host would be a request
 * to a site whose robots.txt this importer never read, so it is REFUSED, not followed. A redirect
 * FROM another host (the FX feed) is refused too — nothing this importer reads is expected to move.
 */
export function redirectTarget(from: string, location: string | null | undefined, robotsTxt: string | null):
  { ok: true; url: string } | { ok: false; reason: string } {
  let src: URL
  try { src = new URL(from) } catch { return { ok: false, reason: `unparsable request URL ${JSON.stringify(from.slice(0, 120))}` } }
  if (src.host !== HONEYCOMB_HOST) return { ok: false, reason: `${src.host} redirected — only ${HONEYCOMB_HOST} redirects are followed` }
  const loc = (location ?? '').trim()
  if (!loc) return { ok: false, reason: 'redirect without a Location header' }
  let to: URL
  try { to = new URL(loc, src) } catch { return { ok: false, reason: `unparsable Location ${JSON.stringify(loc.slice(0, 120))}` } }
  if (to.protocol !== 'https:' || to.host !== HONEYCOMB_HOST || to.username || to.password) {
    return { ok: false, reason: `redirect to ${to.protocol}//${to.host} — not ${HONEYCOMB_ORIGIN}; not followed` }
  }
  const path = to.pathname + to.search
  if (robotsTxt !== null && !robotsAllows(robotsTxt, path)) return { ok: false, reason: `redirect to ${path} — disallowed by robots.txt; not followed` }
  to.hash = ''
  return { ok: true, url: to.href }
}

/**
 * The robots.txt rules a fetch of it yields, or why the run must stop. RFC 9309 §2.3.1: 200 → its
 * rules; a 4xx → no rules; a 5xx → disallow all. ⛔ A robots.txt this fetcher could NOT reach — a
 * redirect it refused (off the site, or a loop) or any other non-200 below 400 — is read as
 * disallow-all too, never as "no rules": failing open here would let the crawl ignore the file.
 */
export function robotsFromResponse(got: { status: number; refusedRedirect: string | null; body: string }):
  { ok: true; robotsTxt: string } | { ok: false; reason: string } {
  if (got.refusedRedirect) return { ok: false, reason: `robots.txt redirect refused (${got.refusedRedirect}) — treated as disallow-all` }
  if (got.status === 200) return { ok: true, robotsTxt: got.body }
  if (got.status >= 400 && got.status < 500) return { ok: true, robotsTxt: '' }
  return { ok: false, reason: `robots.txt answered ${got.status} — treated as disallow-all` }
}

/** A response as the importer sees it. `refusedRedirect` is set when the chain stopped at a 3xx
 *  this fetcher would not follow; `status` and `finalUrl` are then that 3xx and the URL that sent it. */
export type Got = { status: number; finalUrl: string; body: Buffer; type: string; refusedRedirect: string | null }
type FetchInit = { headers: Record<string, string>; redirect: 'manual'; signal: AbortSignal }
type FetchLike = (url: string, init: FetchInit) =>
  Promise<{ status: number; headers: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>

/**
 * The importer's ONLY way onto the network. One request at a time, each at least the gap after the
 * previous one FINISHED — and ⛔ EVERY REDIRECT HOP IS A REQUEST: `redirect: 'follow'` would re-request
 * at once, skipping the gate, and to any host at all. So redirects are followed by hand (`manual`),
 * each hop gated and checked by `redirectTarget`. A bot challenge, a captcha or a 429 throws
 * Infeasible: never retried around, solved or evaded. The gap goes through `parseDelayMs` again, so
 * no caller can pass one under the floor.
 */
export function makePoliteGet(o: {
  fetch: FetchLike; sleep: (ms: number) => Promise<unknown>; now: () => number
  delayMs: number; userAgent: string
  /** honeycomb.com.vn's robots.txt once read, else null (then only the host rule applies to a hop). */
  robotsTxt: () => string | null
  timeoutMs?: number
}): { get: (url: string) => Promise<Got>; count: () => number } {
  const gap = parseDelayMs(String(o.delayMs))
  let last = -Infinity
  let count = 0
  async function once(url: string) {
    const wait = last + gap - o.now()
    if (wait > 0) await o.sleep(wait)
    count++
    try {
      const res = await o.fetch(url, {
        headers: { 'User-Agent': o.userAgent, Accept: '*/*' },
        redirect: 'manual',
        signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
      })
      const body = Buffer.from(await res.arrayBuffer())
      const head = body.subarray(0, 4000).toString('utf8')
      if (res.headers.get('cf-mitigated') ||
        ((res.status === 403 || res.status === 503) && /Just a moment|challenge-platform|cf-chl|captcha/i.test(head))) {
        throw new Infeasible(`${url} answered a bot challenge (HTTP ${res.status}) — INFEASIBLE; not bypassing it`)
      }
      if (res.status === 429) throw new Infeasible(`${url} answered 429 — the site is rate-limiting us; stopping`)
      return { status: res.status, body, type: res.headers.get('content-type') ?? '', location: res.headers.get('location') }
    } finally {
      last = o.now()
    }
  }
  async function get(url: string): Promise<Got> {
    let current = url
    for (let hop = 0; ; hop++) {
      const r = await once(current)
      if (!REDIRECT_STATUSES.has(r.status)) return { status: r.status, finalUrl: current, body: r.body, type: r.type, refusedRedirect: null }
      const next = hop >= MAX_REDIRECTS
        ? { ok: false as const, reason: `more than ${MAX_REDIRECTS} redirects` }
        : redirectTarget(current, r.location, o.robotsTxt())
      if (!next.ok) return { status: r.status, finalUrl: current, body: r.body, type: r.type, refusedRedirect: next.reason }
      current = next.url
    }
  }
  return { get, count: () => count }
}

/** The default `--since`: `days` before `now`, as the YYYY-MM-DD date in Vietnam (UTC+7). */
export function defaultSince(now: number, days: number = DEFAULT_SINCE_DAYS): string {
  return new Date(now - days * 86_400_000 + 7 * 3_600_000).toISOString().slice(0, 10)
}

/**
 * The lastmod window of a run: an explicit --since, else — on a replay — the window the file was
 * STAGED and reviewed with, else the default 90 days back from now.
 * ⚠️ A REPLAY USED TO RE-DERIVE THE DEFAULT FROM THE CLOCK, so applying a file 48 h after staging
 * dropped the rows near the edge of the window the reviewer had approved (both reviewers, integrator
 * review 2026-09-24), while the report still printed the staged window.
 */
export function runSince(sinceArg: string | null, stagedSince: string | null | undefined, now: number): string {
  if (sinceArg) return sinceArg
  if (typeof stagedSince === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(stagedSince)) return stagedSince
  return defaultSince(now)
}

/**
 * ⛔ WHY THE PINNED SELLER MAY NOT BE WRITTEN INTO, or null. Renamed means someone else's shop sits
 * on our id; an owner means a real person would receive the enquiries and could edit the rows; any
 * badge means eno would be vouching for an agency it never vetted.
 */
export function sellerRefusal(
  seller: { name: string; ownerId: string | null; verified: boolean; verifiedSeller: boolean; officialPartner: boolean } | null,
  expectedName: string = HONEYCOMB_SELLER_NAME,
): string | null {
  if (!seller) return null
  if (seller.name !== expectedName) return `is named "${seller.name}", not "${expectedName}" — someone else's shop`
  if (seller.ownerId) return `has an owner (${seller.ownerId}) — a real account would receive these enquiries`
  const badges = (['verified', 'verifiedSeller', 'officialPartner'] as const).filter((k) => seller[k])
  if (badges.length) return `carries ${badges.join(', ')} — an import seller must carry no badge`
  return null
}

/** ⛔ The ONLY retire signal this source gives: the page itself answers 404 or 410. It publishes
 *  no "rented" status, so age, absence and a failed fetch retire nothing. */
export const isGoneStatus = (status: number) => status === 404 || status === 410

/** Active rows the retire pass re-checks: those whose page is no longer in the (complete) sitemap. */
export function retireCandidates<T extends { affiliateUrl: string | null }>(rows: T[], sitemapUrls: ReadonlySet<string>): T[] {
  /** Only a link the importer could have written (allowedTarget): the retire pass requests each one,
   *  and an edited, off-host affiliateUrl must be neither fetched nor hidden on its answer. */
  return rows.filter((r) => allowedTarget(r.affiliateUrl) && !sitemapUrls.has(r.affiliateUrl))
}
