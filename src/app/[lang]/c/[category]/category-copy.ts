import type { DistrictChip } from '@/lib/district-canonical'
import { RENTAL_CHECK_MAX_ITEMS } from '@/lib/rental-check/shared'
import { HOME_RENTAL_SUBCATS } from '@/lib/rental-homes'
import { formatInteger } from '@/lib/vnd'

/**
 * THE WORDS /c/<category> AND /c/<category>/<district> SAY ABOUT THEIR OWN STOCK — pure, so every
 * branch is testable without a database (category-copy.test.ts).
 *
 * ⛔ EVERY CLAIM HERE IS DECIDED BY A NUMBER THE PAGE COUNTED AT RENDER. "In Ho Chi Minh City" is
 * printed only while every live rental is there; "linked from partner portals" says all / most /
 * some from the real affiliate count; the kinds of home are the live subcategory counts. Nothing is
 * typed in: a count written into copy is a claim with an expiry (the rentals figure in five guides
 * went from 19,359 to 25,502 in four days and every one of them went stale).
 *
 * ⚠️ NO "TRUSTED" OVER LINKED STOCK. The old title was "Rentals in Vietnam — Trusted listings" and
 * the lede promised every listing came from a seller with a public trust score, over a category in
 * which every sampled row is an import from another portal. A trust sentence is kept only where the
 * count says nothing on the page is linked.
 */

export type PageLang = 'en' | 'vi'

/** The `[lang]` segment is a render variant ('en' | 'vi'); anything else renders as English. */
export const pageLang = (lang: string | null | undefined): PageLang => (lang === 'vi' ? 'vi' : 'en')

/**
 * A full, grouped count for prose — en "25,502", vi "25.502" — through vnd.ts's `formatInteger`, the
 * one integer grouping the app has (L-NUMBERS).
 * ⚠️ NOT `formatCount` from src/lib/vnd.ts: that is the COMPACT chip label ("25.5k").
 */
export function formatCountFull(n: number, lang: string): string {
  return formatInteger(n, lang === 'vi' ? 'vi' : 'en')
}

export type LinkedTier = 'all' | 'most' | 'some' | 'none'

/**
 * How much of the stock links out to the portal it came from (`affiliateUrl` set — the same test the
 * card's `isPartnerBooking` and the sitemap's submitted-listing predicate use).
 *
 * ⚠️ `>=`, NOT `===`, FOR "ALL": the two numbers are two queries, and an import landing between them
 * can make `linked` one higher than `total`. That is still "all", never "most".
 */
export function linkedTier(linked: number, total: number): LinkedTier {
  if (total <= 0 || linked <= 0) return 'none'
  if (linked >= total) return 'all'
  return linked * 2 > total ? 'most' : 'some'
}

export const HCMC_NAME = { en: 'Ho Chi Minh City', vi: 'TP. Hồ Chí Minh' } as const
const VIETNAM_NAME = { en: 'Vietnam', vi: 'Việt Nam' } as const

/**
 * The five home and work shapes the rentals copy may name, in the order it names them.
 * `one` is the English singular — a count of 1 must read "1 office", not "1 offices" (Vietnamese has
 * no plural form).
 */
export const RENTAL_KINDS = [
  { slug: 'apartment-rental', en: 'apartments', one: 'apartment', vi: 'căn hộ' },
  { slug: 'house-rental', en: 'houses', one: 'house', vi: 'nhà' },
  { slug: 'room-rental', en: 'rooms', one: 'room', vi: 'phòng trọ' },
  // Owner decision O-45 (2026-09-30): `homestay-serviced` is a home (src/lib/rental-homes.ts), so the
  // homes breakdown names it; without this row the parts stopped adding up to the homes=1 total. Named
  // by the category's own label (taxonomy.ts: "Homestay" / "Homestay"), which covers homestays AND
  // serviced apartments — never "serviced apartments", which would mislabel the homestays in it.
  { slug: 'homestay-serviced', en: 'homestays', one: 'homestay', vi: 'homestay' },
  // taxonomy.ts: `office-rental` is "Office" / "Mặt bằng" — commercial space, not a desk.
  { slug: 'office-rental', en: 'offices', one: 'office', vi: 'mặt bằng' },
] as const

/** The English noun for `n` of a rental kind — singular at exactly 1. */
export function rentalKindNoun(slug: RentalKind, n: number, lang: PageLang): string {
  const k = RENTAL_KINDS.find((x) => x.slug === slug)!
  return lang === 'vi' ? k.vi : n === 1 ? k.one : k.en
}
export type RentalKind = (typeof RENTAL_KINDS)[number]['slug']

export type RentalsFacts = {
  /** Live rentals — the number the robots decision was made on (load-category.ts). */
  total: number
  /** true ONLY when the HCMC count reached the total: a failed or partial count removes the claim. */
  allHcmc: boolean
  linked: LinkedTier
  /** Live count per kind, in RENTAL_KINDS order, zero kinds dropped. */
  kinds: { slug: RentalKind; count: number }[]
  /** The busiest districts, canonical slugs, busiest first. */
  top: DistrictChip[]
  /**
   * Live car / motorbike / bicycle hire in the same category. NOT part of `total`: the lede counts
   * "places for rent", and a car is not a place — but the grid under the lede shows both, so the lede
   * names the vehicles in their own sentence rather than leaving its number short of the grid's.
   */
  vehicles?: { cars: number; motorbikes: number }
  /**
   * The homes among them (SEO wave B, D1b): apartments, houses and rooms, and the office count. With
   * `homes.total > 0` the description, the lede and the preview all count homes — one number
   * (category-copy.d1b.test.ts). Optional so a fixture without it keeps today's wording.
   */
  homes?: HomeFacts
  /** How much of the HOMES is linked — the tier the homes description and lede speak with. */
  homesLinked?: LinkedTier
}

/** Only the kinds with live stock, in display order — a zero is never printed as "0 offices". */
export function rentalKinds(counts: Partial<Record<string, number>>): RentalsFacts['kinds'] {
  return RENTAL_KINDS.map((k) => ({ slug: k.slug, count: counts[k.slug] ?? 0 })).filter((k) => k.count > 0)
}

/**
 * Which headline the stock supports. The query this page exists for is "apartment(s) for rent in
 * Ho Chi Minh City" (~720 searches/month, no matching page before this), so that is the wording —
 * but only while there are apartments to show and every rental is in HCMC.
 */
export type RentalsHeadline = 'apartments-houses-hcmc' | 'apartments-hcmc' | 'rentals-hcmc' | 'rentals-vietnam'
export function rentalsHeadline(f: Pick<RentalsFacts, 'allHcmc' | 'kinds'>): RentalsHeadline {
  if (!f.allHcmc) return 'rentals-vietnam'
  const has = (s: RentalKind) => f.kinds.some((k) => k.slug === s)
  if (has('apartment-rental')) return has('house-rental') ? 'apartments-houses-hcmc' : 'apartments-hcmc'
  return 'rentals-hcmc'
}

const HEADLINE_TITLE: Record<RentalsHeadline, Record<PageLang, string>> = {
  'apartments-houses-hcmc': { en: 'Apartments & Houses for Rent in Ho Chi Minh City', vi: 'Cho thuê căn hộ và nhà tại TP. Hồ Chí Minh' },
  'apartments-hcmc': { en: 'Apartments for Rent in Ho Chi Minh City', vi: 'Cho thuê căn hộ ở TP. Hồ Chí Minh' },
  'rentals-hcmc': { en: 'Rentals in Ho Chi Minh City', vi: 'Cho thuê ở TP. Hồ Chí Minh' },
  // ⚠️ THE FALLBACK IS THE OLD WORDING WITHOUT ITS "— Trusted listings" TAIL (see the header).
  'rentals-vietnam': { en: 'Rentals in Vietnam', vi: 'Cho thuê tại Việt Nam' },
}

/** "a, b and c" / "a, b và c". */
export function joinList(items: string[], lang: PageLang): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} ${lang === 'vi' ? 'và' : 'and'} ${items[items.length - 1]}`
}

/**
 * `<title>` + meta description for /c/rentals.
 *
 * ⚠️ THE TITLE'S VARIANT IS A PARAMETER, NOT `rentalsHeadline(f)`. The H1 lives in `(index)/layout.tsx`,
 * above the loading boundary, where it may not wait on these counts, so it prints the cached variant
 * (`loadRentalsHeadline`, category-data.ts). The title takes that same value, so the two can never
 * name different variants; the description still says what the live counts say.
 */
export function rentalsMetadata(
  f: RentalsFacts,
  lang: PageLang,
  siteName: string,
  headline: RentalsHeadline,
): { title: string; description: string } {
  const place = f.allHcmc ? HCMC_NAME : VIETNAM_NAME
  const title = `${HEADLINE_TITLE[headline][lang]} | ${siteName}`
  /**
   * ⛔ WITH HOMES, THE DESCRIPTION COUNTS HOMES (SEO wave B, D1b; CS-2 D1b-1): it listed "2,270
   * offices" and ended on "a partner property portal" (peer finding 2a). Now: homes, their kinds, the
   * free check (RENTAL_CHECK_MAX_ITEMS), then D-f's sentence over the linked tier of the HOMES (review:
   * the offices' tier said nothing about them; CS-2 D1b-3 had it over places). The
   * robots decision keeps reading the total; the title keeps H1b's cached variant.
   */
  if (f.homes && f.homes.total > 0) {
    return { title, description: homesDescription(f.homes, place, { en: '', vi: '' }, f.homesLinked ?? f.linked, lang) }
  }
  const n = formatCountFull(f.total, lang)
  const kinds = f.kinds.map((k) => `${formatCountFull(k.count, lang)} ${rentalKindNoun(k.slug, k.count, lang)}`)
  // D-f (CS-2 D1b-3…5, the same set as the district pages).
  const linkedSentence = rentalsLinkedSentence(f.linked, f.total, lang)
  const linked = linkedSentence ? ` ${linkedSentence}` : ''
  // ⚠️ NO DISTRICT LIST HERE: it took the snippet to ~270 characters, past what a result shows. The
  // districts are linked on the page itself (<RentalsDistricts>), where they carry the anchors.
  const description =
    lang === 'vi'
      ? `${n} tin cho thuê tại ${place.vi}${kinds.length ? `, gồm ${joinList(kinds, 'vi')}` : ''}.${linked}`
      : `${n} ${f.total === 1 ? 'place' : 'places'} for rent in ${place.en}${kinds.length ? `, including ${joinList(kinds, 'en')}` : ''}.${linked}`
  return { title, description }
}

/**
 * The H1, sentence case (Title Case belongs in <title>).
 * ⚠️ <RentalsHeading> (category-text.tsx) renders these through literal `tr()` calls so the string
 * harvester can pre-translate them; category-text.test.tsx renders all four in both languages and
 * compares them with this map, so the two cannot drift.
 */
export const RENTALS_H1: Record<RentalsHeadline, Record<PageLang, string>> = {
  'apartments-houses-hcmc': { en: 'Apartments & houses for rent in Ho Chi Minh City', vi: HEADLINE_TITLE['apartments-houses-hcmc'].vi },
  'apartments-hcmc': { en: 'Apartments for rent in Ho Chi Minh City', vi: HEADLINE_TITLE['apartments-hcmc'].vi },
  'rentals-hcmc': { en: 'Rentals in Ho Chi Minh City', vi: HEADLINE_TITLE['rentals-hcmc'].vi },
  'rentals-vietnam': { en: 'Rentals in Vietnam', vi: HEADLINE_TITLE['rentals-vietnam'].vi },
}

/* ── every other category ─────────────────────────────────────────────────────────────────────── */

/**
 * The trust sentence a category or district description ends on while nothing in it is linked.
 * ⛔ NO "— fewer fakes, fewer bait prices" (SEO wave B, V2; CS-3 claim 3, owner 2026-10-01): a comparison
 * no code measures. What stays is what the code makes true — every `Seller` row carries a public
 * `trustScore` (trust-score.tsx), and signed-in members can report a listing (api/report/route.ts).
 * The Vietnamese is the district description's existing sentence, word for word.
 */
export const TRUST_SENTENCE: Record<PageLang, string> = {
  en: 'Every seller has a public trust score and bad listings get reported.',
  vi: 'Mỗi người bán đều có điểm uy tín công khai, và tin xấu sẽ bị báo cáo.',
}

/**
 * ⛔ JOBS ARE LINKED FROM JOB SITES (SEO wave B, V2; CS-3 V2-8, approved 2026-10-01). The linked jobs come
 * from job boards and employers' own careers sites (`JOB_BOARDS`, src/lib/job-listing.ts) — "a job site"
 * covers both. Used by the META descriptions only (categoryMetadata, districtMetadata); the on-page
 * district lede keeps `sourceNoun`'s wording, which V2 does not touch (category-text.tsx).
 */
export const JOBS_LINKED_SENTENCE: Record<Exclude<LinkedTier, 'none'>, Record<PageLang, string>> = {
  all: { en: 'Every listing here links to its original on a job site.', vi: 'Mỗi tin ở đây đều dẫn tới tin gốc trên trang tuyển dụng.' },
  most: { en: 'Most listings here link to their original on a job site.', vi: 'Phần lớn tin ở đây dẫn tới tin gốc trên trang tuyển dụng.' },
  some: { en: 'Some listings here link to their original on a job site.', vi: 'Một số tin ở đây dẫn tới tin gốc trên trang tuyển dụng.' },
}
const JOBS_NOUN = { en: 'a job site', vi: 'trang tuyển dụng' } as const

/**
 * ⛔ TEACHERS ARE PEOPLE, NOT LISTINGS (owner, 2026-09-30: no seller-trust or bait-price claim — the
 * note is in category-lede.tsx). CS-3 V2-9a: the page's own first sentence (category-lede.tsx), then
 * the share gate — a teacher's phone, email and CV reach a thread only after they tap "Share" there
 * (src/lib/teachers/share.ts), and the JSON-LD never carries them (teachers/jsonld.ts).
 */
const TEACHERS_DESCRIPTION: Record<PageLang, string> = {
  en: 'English and subject teachers looking for work in Vietnam. Their phone, email and CV are shared only when the teacher chooses to.',
  vi: 'Giáo viên tiếng Anh và các môn học đang tìm việc tại Việt Nam. Số điện thoại, email và CV chỉ được chia sẻ khi giáo viên đồng ý.',
}

/**
 * `<title>` + meta description for /c/<category> when it is not rentals with a cached headline, in the
 * page's language (SEO wave B, V2; copy sheet CS-3, approved by the owner 2026-10-01).
 *
 * ⛔ NO "— Trusted listings" IN ANY TITLE (CS-3 claim 2, owner 2026-10-01): nothing verifies a listing,
 * and on /c/teachers it called people "listings". Every tier now reads "{name} in Vietnam | eno.vn" —
 * the linked tiers' title, which is also the page's own H1 ("{nameVi} ở Việt Nam" in Vietnamese,
 * `(index)/layout.tsx`).
 * ⛔ THE TRUST SENTENCE ONLY WHERE NOTHING IS LINKED. Electronics and furniture carried it over shelves in
 * which every sampled row (100/100, 2026-09-27) links out to a source shop; a trust score says nothing
 * about a listing copied from another site. Linked tiers say where the listing opens instead: retail
 * "a source site", jobs "a job site", rentals D-f's sentence (this branch runs for /c/rentals when the
 * cached headline is null, CS-3 V2-10 — never "partner").
 */
export function categoryMetadata(
  cat: { slug: string; name: string; nameVi?: string | null },
  linked: LinkedTier,
  siteName: string,
  lang: PageLang = 'en',
): { title: string; description: string } {
  const name = lang === 'vi' ? cat.nameVi || cat.name : cat.name
  const title = lang === 'vi' ? `${name} ở Việt Nam | ${siteName}` : `${name} in Vietnam | ${siteName}`
  if (cat.slug === 'teachers') return { title, description: TEACHERS_DESCRIPTION[lang] }
  const lead = lang === 'vi' ? `Xem tin ${name.toLowerCase()} tại Việt Nam.` : `Browse ${name.toLowerCase()} for expats in Vietnam.`
  const tail =
    linked === 'none' ? TRUST_SENTENCE[lang]
    : cat.slug === 'rentals' ? RENTALS_LINKED_SENTENCE[linked][lang]
    : cat.slug === 'jobs' ? JOBS_LINKED_SENTENCE[linked][lang]
    : CATEGORY_LINKED_SENTENCE[linked][lang]
  return { title, description: `${lead} ${tail}` }
}

/**
 * The JSON-LD BreadcrumbList names of a category and a district page, in the page's language, equal to
 * the visible crumbs: "Home" / "Trang chủ" (`<Tr text="Home" />`) and the category's own name
 * (`<Bilingual en={cat.name} vi={cat.nameVi || cat.name} />`). SEO wave B, V2 (CS-3 V2-7, V2-11, V2-12):
 * the Vietnamese rendering read Home / Rentals / Quận 1.
 */
export function crumbNames(cat: { name: string; nameVi?: string | null }, lang: PageLang): { home: string; category: string } {
  return lang === 'vi' ? { home: 'Trang chủ', category: cat.nameVi || cat.name } : { home: 'Home', category: cat.name }
}

/**
 * The sentence that replaces the trust claim on a category whose stock is linked. Also rendered by
 * CategoryLede (src/components/marketplace/category-lede.tsx) as literal `tr()` pairs — the tests in
 * category-text.test.tsx and category-lede.test.tsx keep the two identical.
 * ⛔ "A SOURCE SITE", NOT "A PARTNER SITE" (2026-10-01). Since the owner's decision that day the word
 * "partner" means one thing on eno — a company with a SIGNED AGREEMENT (the badge's tooltip,
 * partner-badge.tsx) — and the shops this stock is linked from (Tiki, CellphoneS, FPT Shop…) hold none;
 * their badge was withdrawn. The sentence says where the listing points, and claims no relationship.
 */
export const CATEGORY_LINKED_SENTENCE: Record<Exclude<LinkedTier, 'none'>, Record<PageLang, string>> = {
  all: { en: 'Every listing here links to its original on a source site.', vi: 'Mỗi tin ở đây đều dẫn tới tin gốc trên trang nguồn.' },
  most: { en: 'Most listings here link to their original on a source site.', vi: 'Phần lớn tin ở đây dẫn tới tin gốc trên trang nguồn.' },
  some: { en: 'Some listings here link to their original on a source site.', vi: 'Một số tin ở đây dẫn tới tin gốc trên trang nguồn.' },
}

/* ── category × district ──────────────────────────────────────────────────────────────────────── */

/**
 * ⛔ THE RENTALS "WHERE THE LISTING OPENS" SENTENCE — NEUTRAL, NAMING NOBODY (SEO wave B, decision D-f;
 * copy sheet CS-2 D1-14…D1-17, approved 2026-09-30). The imports are reference listings copied from
 * Batdongsan, Rever, Chợ Tốt Nhà, Muaban and Honeycomb House (import-sellers.ts); no code or contract
 * records a partnership, so "a partner property portal" was a claim. The listing page names the site
 * itself. ⛔ Retail no longer says "partner site" either (2026-10-01), when the affiliate stores lost the
 * partner badge: "partner" now means only the signed-agreement Official partner badge, so every other
 * linked row is from "a source site" (CATEGORY_LINKED_SENTENCE, sourceNoun).
 * ONE SET for every rentals surface — the district description and lede, and /c/rentals' description
 * and lede — so the languages and the pages cannot drift. `one` is the singular form, for a total of 1
 * (where the tier can only be `all`, linkedTier).
 */
export const RENTALS_LINKED_SENTENCE: Record<Exclude<LinkedTier, 'none'> | 'one', Record<PageLang, string>> = {
  all: { en: 'Every listing links to its original ad on another listing site.', vi: 'Mỗi tin đều dẫn tới tin gốc trên một trang đăng tin khác.' },
  most: { en: 'Most listings link to their original ads on other listing sites.', vi: 'Phần lớn tin dẫn tới tin gốc trên các trang đăng tin khác.' },
  some: { en: 'Some listings link to their original ads on other listing sites.', vi: 'Một số tin dẫn tới tin gốc trên các trang đăng tin khác.' },
  one: { en: 'It links to its original ad on another listing site.', vi: 'Tin này dẫn tới tin gốc trên một trang đăng tin khác.' },
}

/** The D-f sentence for a rentals scope of `total`, or '' when nothing in it is linked. */
export function rentalsLinkedSentence(tier: LinkedTier, total: number, lang: PageLang): string {
  if (tier === 'none') return ''
  return RENTALS_LINKED_SENTENCE[total === 1 ? 'one' : tier][lang]
}

/**
 * ⛔ WHAT A RENTALS PAGE CALLS ITS PLACE IN THE TITLE, H1 AND DESCRIPTION — searchers' words (SEO wave
 * B, decision D-d; CS-2 D1-L1…L3). `d2` owns "District 2 / Thảo Điền" searches (D0 moved the Thảo Điền
 * spellings into its scope, so "(Thao Dien)" is true of it); `d9` drops "(Thu Duc)" so it does not
 * compete with the Thủ Đức page. Everything else — the breadcrumb, the chips, the rent block — keeps
 * the DISTRICTS labels.
 */
export const RENTALS_PLACE_LABEL: Record<string, { en: string; vi: string }> = {
  d2: { en: 'District 2 (Thao Dien)', vi: 'Quận 2 (Thảo Điền)' },
  d9: { en: 'District 9', vi: 'Quận 9' },
  'thu-duc': { en: 'Thu Duc City', vi: 'TP Thủ Đức' },
}
export function rentalsPlaceLabel(slug: string, place: { en: string; vi: string }): { en: string; vi: string } {
  return Object.hasOwn(RENTALS_PLACE_LABEL, slug) ? RENTALS_PLACE_LABEL[slug] : place
}

/**
 * THE HOMES IN A RENTALS SCOPE (SEO wave B, D1): apartments, houses and rooms — HOME_RENTAL_SUBCATS,
 * the one list — out of the page's per-subcategory counts. Offices, nightly stays and rows with no
 * subcategory are rentals (the page's `total`, which the robots floor reads) but not homes.
 * `offices` is the `office-rental` count ALONE: the "Also here" link opens exactly those rows, so it
 * may never be `total − homes` (CS-2 D1-9 — that difference holds hotels and untyped rows too).
 */
export type HomeFacts = {
  total: number
  /** Home kinds with stock, in RENTAL_KINDS order. */
  kinds: RentalsFacts['kinds']
  offices: number
}
export function homeFacts(bySub: Partial<Record<string, number>>): HomeFacts {
  const homes = Object.fromEntries(HOME_RENTAL_SUBCATS.map((s) => [s, bySub[s] ?? 0]))
  const kinds = rentalKinds(homes)
  return { total: kinds.reduce((n, k) => n + k.count, 0), kinds, offices: bySub['office-rental'] ?? 0 }
}

/**
 * ⛔ WHETHER A RENTALS DISTRICT PAGE LISTS ONLY ITS HOMES (D1). Yes while it has homes — but NOT when
 * the homes alone are under the indexing floor while the page's `total` (which the robots decision
 * reads, order rule 3) is at or over it: /c/rentals/cu-chi held 2 homes among 90 rentals (land,
 * warehouses, shopfronts; 2026-09-30), and a homes-only view would have been an indexable page of two
 * cards (both reviewers, D1 round 2). Such a page keeps today's all-rentals view and wording. So an
 * indexable page always lists at least the floor. `floor` is MIN_INDEXABLE_LISTINGS, passed in to keep
 * this file free of server imports.
 */
export function listsHomesOnly(homes: HomeFacts | null | undefined, total: number, floor: number): boolean {
  if (!homes || homes.total === 0) return false
  return homes.total >= floor || total < floor
}

/**
 * Which headline a rentals district page may print (D-a): "Apartments & Houses" only while it lists
 * both, "Apartments" while it lists apartments and no house, else null — today's "Rentals in …".
 * The same rule as `rentalsHeadline` for /c/rentals.
 */
export type DistrictRentalsHeadline = 'apartments-houses' | 'apartments'
export function districtRentalsHeadline(h: HomeFacts | null | undefined): DistrictRentalsHeadline | null {
  if (!h || h.total === 0) return null
  const has = (s: RentalKind) => h.kinds.some((k) => k.slug === s)
  if (!has('apartment-rental')) return null
  return has('house-rental') ? 'apartments-houses' : 'apartments'
}

/**
 * The rentals district H1 before the place (sentence case, like RENTALS_H1). <RentalsDistrictHeading>
 * renders these as literal `tr()` pairs; category-text.test.tsx holds the two equal.
 */
export const DISTRICT_RENTALS_H1: Record<DistrictRentalsHeadline, Record<PageLang, string>> = {
  'apartments-houses': { en: 'Apartments & houses for rent in', vi: 'Cho thuê căn hộ và nhà tại' },
  apartments: { en: 'Apartments for rent in', vi: 'Cho thuê căn hộ tại' },
}
const DISTRICT_RENTALS_TITLE: Record<DistrictRentalsHeadline, Record<PageLang, string>> = {
  'apartments-houses': { en: 'Apartments & Houses for Rent in', vi: DISTRICT_RENTALS_H1['apartments-houses'].vi },
  apartments: { en: 'Apartments for Rent in', vi: DISTRICT_RENTALS_H1.apartments.vi },
}
/** ", HCMC" / ", TP.HCM" — the short city the rentals titles and descriptions use (CS-2 conventions). */
const HCMC_SHORT = { en: 'HCMC', vi: 'TP.HCM' } as const

/**
 * "Pick up to N and eno checks availability for free." — N is RENTAL_CHECK_MAX_ITEMS, the limit the
 * route enforces, never a typed 5 (plan v4, fix 7). "eno", not a domain: both editions run the check.
 */
export const rentalCheckSentence = (lang: PageLang): string =>
  lang === 'vi'
    ? `Chọn tối đa ${RENTAL_CHECK_MAX_ITEMS} căn, eno kiểm tra phòng trống miễn phí.`
    : `Pick up to ${RENTAL_CHECK_MAX_ITEMS} and eno checks availability for free.`

/** "{a} apartments, {h} houses and {r} rooms" — only kinds with stock; English singular at 1. */
export function homeKindsList(kinds: RentalsFacts['kinds'], lang: PageLang): string {
  return joinList(kinds.map((k) => `${formatCountFull(k.count, lang)} ${rentalKindNoun(k.slug, k.count, lang)}`), lang)
}

/**
 * The homes description (CS-2 D1-7 / D1b-1): count, place, kinds, the free check, then D-f's
 * sentence. Before that sentence it fits 160 characters in the longest case (category-copy.test.ts).
 * `city` is the ", HCMC" suffix or ''.
 */
export function homesDescription(h: HomeFacts, place: { en: string; vi: string }, city: Record<PageLang, string>, linked: LinkedTier, lang: PageLang): string {
  const n = formatCountFull(h.total, lang)
  const tail = rentalsLinkedSentence(linked, h.total, lang)
  const head =
    lang === 'vi'
      ? `${n} chỗ ở cho thuê tại ${place.vi}${city.vi} — ${homeKindsList(h.kinds, 'vi')}. ${rentalCheckSentence('vi')}`
      : `${n} ${h.total === 1 ? 'home' : 'homes'} for rent in ${place.en}${city.en} — ${homeKindsList(h.kinds, 'en')}. ${rentalCheckSentence('en')}`
  return tail ? `${head} ${tail}` : head
}

export type DistrictFacts = {
  category: { slug: string; name: string; nameVi: string }
  place: { en: string; vi: string }
  /** A curated DISTRICTS place — i.e. in HCMC, so the city can be named after it. */
  inHcmc: boolean
  total: number
  linked: LinkedTier
  /**
   * Rentals only (SEO wave B, D1): the homes in scope, and how much of THEM is linked. With
   * `homes.total > 0` the page lists only homes, so the title, H1 and description speak of them;
   * `total` stays every rental in scope (the robots floor reads it).
   */
  homes?: HomeFacts | null
  homesLinked?: LinkedTier
}

/**
 * What the linked rows are linked FROM. Rentals: another listing site (D-f — no partnership is
 * claimed); retail and everything else: a source site. ⛔ NEVER "a partner site" (2026-10-01), when
 * "partner" came to mean a signed agreement and the affiliate stores lost the badge: the job boards and
 * shop catalogues we import from are not partners — "partner" is reserved for the signed-agreement
 * Official partner badge (/partners; see CATEGORY_LINKED_SENTENCE).
 */
export function sourceNoun(categorySlug: string): { en: string; vi: string } {
  return categorySlug === 'rentals'
    ? { en: 'another listing site', vi: 'một trang đăng tin khác' }
    : { en: 'a source site', vi: 'trang nguồn' }
}

/**
 * The linked sentence after a district count. `total` picks the singular: /c/rentals/can-gio held ONE
 * rental on 2026-09-27 and read "1 place for rent … Every one links …" (VI "Tất cả đều …"). At a count
 * of 1 the tier can only be "all" (linkedTier), so the one form covers it.
 */
export function districtLinkedSentence(
  tier: Exclude<LinkedTier, 'none'>,
  categorySlug: string,
  lang: PageLang,
  total: number,
  noun: { en: string; vi: string } = sourceNoun(categorySlug),
): string {
  // Rentals: D-f's own sentences (CS-2 D1-14…17), not the retail frame with a swapped noun.
  if (categorySlug === 'rentals') return rentalsLinkedSentence(tier, total, lang)
  const p = noun[lang]
  if (total === 1) return lang === 'vi' ? `Tin này dẫn tới tin gốc trên ${p}.` : `It links to its original listing on ${p}.`
  if (lang === 'vi') {
    return { all: `Tất cả đều dẫn tới tin gốc trên ${p}.`, most: `Phần lớn dẫn tới tin gốc trên ${p}.`, some: `Một số tin dẫn tới tin gốc trên ${p}.` }[tier]
  }
  return {
    all: `Every one links to its original listing on ${p}.`,
    most: `Most link to their original listing on ${p}.`,
    some: `Some link to their original listing on ${p}.`,
  }[tier]
}

/** `<title>` + meta description for /c/<category>/<district>. */
export function districtMetadata(f: DistrictFacts, lang: PageLang, siteName: string): { title: string; description: string } {
  /**
   * ⛔ RENTALS WITH HOMES: "Apartments & Houses for Rent in District 7 (Phu My Hung), HCMC" (D-a),
   * and a description that counts homes, never names an office, and states the free check (D1, v3).
   * With no apartment the title keeps today's wording below; with no home at all, so does the
   * description (the page then lists every rental).
   */
  const homes = f.category.slug === 'rentals' && f.homes && f.homes.total > 0 ? f.homes : null
  if (homes) {
    const short = f.inHcmc ? { en: `, ${HCMC_SHORT.en}`, vi: `, ${HCMC_SHORT.vi}` } : { en: '', vi: '' }
    const headline = districtRentalsHeadline(homes)
    const description = homesDescription(homes, f.place, short, f.homesLinked ?? 'none', lang)
    if (headline) {
      const place = lang === 'vi' ? f.place.vi : f.place.en
      return { title: `${DISTRICT_RENTALS_TITLE[headline][lang]} ${place}${short[lang]} | ${siteName}`, description }
    }
    return { title: districtMetadata({ ...f, homes: null }, lang, siteName).title, description }
  }
  const city = f.inHcmc ? `, ${HCMC_NAME[lang]}` : ''
  const n = formatCountFull(f.total, lang)
  /**
   * The tail after the count. Nothing linked: the trust sentence (TRUST_SENTENCE — CS-3 claim 3 took
   * "— fewer fakes, fewer bait prices" off the English), except on teachers, which gets none at all
   * (CS-3 V2-9b: people, not listings). Linked: where the listings open, with jobs naming "a job site"
   * here in the meta description (CS-3 V2-8d).
   */
  const districtTail = (l: PageLang): string =>
    f.linked === 'none' ? (f.category.slug === 'teachers' ? '' : TRUST_SENTENCE[l])
    : districtLinkedSentence(f.linked, f.category.slug, l, f.total, f.category.slug === 'jobs' ? JOBS_NOUN : undefined)
  const withTail = (head: string, tail: string) => (tail ? `${head} ${tail}` : head)
  if (lang === 'vi') {
    // A row with no Vietnamese name falls back to the English one, as the visible H1, the breadcrumb and
    // categoryMetadata do (review: it printed "14 tin  tại Quận 1").
    const nameVi = f.category.nameVi || f.category.name
    return {
      title: `${nameVi} tại ${f.place.vi}${city} | ${siteName}`,
      description: withTail(`${n} tin ${nameVi.toLowerCase()} tại ${f.place.vi}${city}.`, districtTail('vi')),
    }
  }
  const tail = districtTail('en')
  // "3,741 rentals listings" read as a typo; rentals are counted as places, like /c/rentals does.
  // Singular at exactly 1 — /c/rentals/can-gio held one rental on 2026-09-27.
  const what =
    f.category.slug === 'rentals'
      ? f.total === 1 ? 'place for rent' : 'places for rent'
      : `${f.category.name.toLowerCase()} ${f.total === 1 ? 'listing' : 'listings'}`
  return {
    title: `${f.category.name} in ${f.place.en}${city} | ${siteName}`,
    description: withTail(`${n} ${what} in ${f.place.en}${city}.`, tail),
  }
}

/**
 * The "By area" chips a category page may show: every place, busiest first (capped at `max`) — but
 * ONLY where there are areas to browse, i.e. three or more places holding five or more listings each.
 * ⚠️ One own-stock listing was enough to print a one-chip row: /c/electronics showed "By area: Cau
 * Giay" and /c/vehicles "Binh Trung" (2026-09-29, C1-LEDE) — a signpost to a page of one card.
 */
export function byAreaChips<T extends { count: number }>(chips: T[], max: number): T[] {
  return chips.filter((d) => d.count >= 5).length >= 3 ? chips.slice(0, max) : []
}

export type TopSubcategory = { name: string; nameVi: string; count: number }

/**
 * The busiest named subcategories for the lede's "including …" (C1-LEDE), busiest first, at most `max`.
 * From per-slug counts over the SAME predicate as the page total, named from the taxonomy only.
 * Left out:
 * - a slug the taxonomy no longer defines (no name to print);
 * - a subcategory holding the WHOLE category ("including Phones (63,730)" of 63,730 says nothing);
 * - the catch-alls — "Other", "Other accessories", "Other books" (misc, vehicle-other, …): "including
 *   Other (412)" names no kind of thing, and a buyer cannot browse towards it.
 */
export function topSubcategories(
  groups: { slug: string | null; count: number }[],
  defs: { slug: string; name: string; nameVi: string }[],
  total: number,
  max = 3,
): TopSubcategory[] {
  const named = new Map(defs.map((d) => [d.slug, d]))
  return groups
    .flatMap((g) => {
      const def = g.slug ? named.get(g.slug) : undefined
      return def && !/^other\b/i.test(def.name) && g.count < total ? [{ name: def.name, nameVi: def.nameVi, count: g.count }] : []
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, max)
}
