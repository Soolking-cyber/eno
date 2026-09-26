import type { DistrictChip } from '@/lib/district-canonical'

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

const EN = new Intl.NumberFormat('en-US')
const VI = new Intl.NumberFormat('vi-VN')

/**
 * A full, grouped count for prose — en "25,502", vi "25.502".
 * ⚠️ NOT `formatCount` from src/lib/vnd.ts: that is the COMPACT chip label ("25.5k"). The separators
 * are the ones vnd.ts uses for money, so one page never groups two numbers two ways.
 */
export function formatCountFull(n: number, lang: string): string {
  return (lang === 'vi' ? VI : EN).format(n)
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
 * The four home and work shapes the rentals copy may name, in the order it names them.
 * `one` is the English singular — a count of 1 must read "1 office", not "1 offices" (Vietnamese has
 * no plural form).
 */
export const RENTAL_KINDS = [
  { slug: 'apartment-rental', en: 'apartments', one: 'apartment', vi: 'căn hộ' },
  { slug: 'house-rental', en: 'houses', one: 'house', vi: 'nhà' },
  { slug: 'room-rental', en: 'rooms', one: 'room', vi: 'phòng trọ' },
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

const RENTALS_LINKED_META: Record<Exclude<LinkedTier, 'none'>, Record<PageLang, string>> = {
  all: {
    en: 'Every listing links to its original on a partner property portal.',
    vi: 'Mỗi tin đều dẫn tới tin gốc trên trang bất động sản đối tác.',
  },
  most: {
    en: 'Most listings link to their original on a partner property portal.',
    vi: 'Phần lớn tin dẫn tới tin gốc trên trang bất động sản đối tác.',
  },
  some: {
    en: 'Some listings link to their original on a partner property portal.',
    vi: 'Một số tin dẫn tới tin gốc trên trang bất động sản đối tác.',
  },
}

/** `<title>` + meta description for /c/rentals. */
export function rentalsMetadata(f: RentalsFacts, lang: PageLang, siteName: string): { title: string; description: string } {
  const place = f.allHcmc ? HCMC_NAME : VIETNAM_NAME
  const n = formatCountFull(f.total, lang)
  const kinds = f.kinds.map((k) => `${formatCountFull(k.count, lang)} ${rentalKindNoun(k.slug, k.count, lang)}`)
  const linked = f.linked === 'none' ? '' : ` ${RENTALS_LINKED_META[f.linked][lang]}`
  // ⚠️ NO DISTRICT LIST HERE: it took the snippet to ~270 characters, past what a result shows. The
  // districts are linked on the page itself (<RentalsDistricts>), where they carry the anchors.
  const description =
    lang === 'vi'
      ? `${n} tin cho thuê tại ${place.vi}${kinds.length ? `, gồm ${joinList(kinds, 'vi')}` : ''}.${linked}`
      : `${n} ${f.total === 1 ? 'place' : 'places'} for rent in ${place.en}${kinds.length ? `, including ${joinList(kinds, 'en')}` : ''}.${linked}`
  return { title: `${HEADLINE_TITLE[rentalsHeadline(f)][lang]} | ${siteName}`, description }
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
 * `<title>` + meta description for /c/<category> when it is not rentals (English, as before).
 *
 * ⛔ "— Trusted listings" AND "Every seller has a public trust score" ARE KEPT ONLY WHERE NOTHING IS
 * LINKED. Electronics and furniture carried both over shelves in which every sampled row (100/100,
 * 2026-09-27) links out to a partner shop; a trust score says nothing about a listing copied from
 * another site. A category of listings posted here keeps its old copy word for word.
 */
export function categoryMetadata(
  cat: { name: string },
  linked: LinkedTier,
  siteName: string,
): { title: string; description: string } {
  if (linked === 'none') {
    return {
      title: `${cat.name} in Vietnam — Trusted listings | ${siteName}`,
      description: `Browse ${cat.name.toLowerCase()} for expats in Vietnam. Every seller has a public trust score and bad listings get reported — fewer fakes, fewer bait prices.`,
    }
  }
  return {
    title: `${cat.name} in Vietnam | ${siteName}`,
    description: `Browse ${cat.name.toLowerCase()} for expats in Vietnam. ${CATEGORY_LINKED_SENTENCE[linked].en}`,
  }
}

/**
 * The sentence that replaces the trust claim on a category whose stock is linked. Also rendered by
 * CategoryLede (src/components/marketplace/category-lede.tsx) as literal `tr()` pairs — the test in
 * category-copy.test.ts keeps the two identical.
 */
export const CATEGORY_LINKED_SENTENCE: Record<Exclude<LinkedTier, 'none'>, Record<PageLang, string>> = {
  all: { en: 'Every listing here links to its original on a partner site.', vi: 'Mỗi tin ở đây đều dẫn tới tin gốc trên trang đối tác.' },
  most: { en: 'Most listings here link to their original on a partner site.', vi: 'Phần lớn tin ở đây dẫn tới tin gốc trên trang đối tác.' },
  some: { en: 'Some listings here link to their original on a partner site.', vi: 'Một số tin ở đây dẫn tới tin gốc trên trang đối tác.' },
}

/* ── category × district ──────────────────────────────────────────────────────────────────────── */

export type DistrictFacts = {
  category: { slug: string; name: string; nameVi: string }
  place: { en: string; vi: string }
  /** A curated DISTRICTS place — i.e. in HCMC, so the city can be named after it. */
  inHcmc: boolean
  total: number
  linked: LinkedTier
}

/** What the linked rows are linked FROM — a property portal for rentals, a partner site otherwise. */
export function partnerNoun(categorySlug: string): { en: string; vi: string } {
  return categorySlug === 'rentals'
    ? { en: 'a partner property portal', vi: 'trang bất động sản đối tác' }
    : { en: 'a partner site', vi: 'trang đối tác' }
}

/**
 * The linked sentence after a district count. `total` picks the singular: /c/rentals/can-gio held ONE
 * rental on 2026-09-27 and read "1 place for rent … Every one links …" (VI "Tất cả đều …"). At a count
 * of 1 the tier can only be "all" (linkedTier), so the one form covers it.
 */
export function districtLinkedSentence(tier: Exclude<LinkedTier, 'none'>, categorySlug: string, lang: PageLang, total: number): string {
  const p = partnerNoun(categorySlug)[lang]
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
  const city = f.inHcmc ? `, ${HCMC_NAME[lang]}` : ''
  const n = formatCountFull(f.total, lang)
  if (lang === 'vi') {
    const tail = f.linked === 'none' ? 'Mỗi người bán đều có điểm uy tín công khai, và tin xấu sẽ bị báo cáo.' : districtLinkedSentence(f.linked, f.category.slug, 'vi', f.total)
    return {
      title: `${f.category.nameVi} tại ${f.place.vi}${city} | ${siteName}`,
      description: `${n} tin ${f.category.nameVi.toLowerCase()} tại ${f.place.vi}${city}. ${tail}`,
    }
  }
  // ⚠️ The no-link tail is the page's old sentence, word for word: own-stock pages lose nothing.
  const tail = f.linked === 'none' ? 'Every seller has a public trust score and bad listings get reported — fewer fakes, fewer bait prices.' : districtLinkedSentence(f.linked, f.category.slug, 'en', f.total)
  // "3,741 rentals listings" read as a typo; rentals are counted as places, like /c/rentals does.
  // Singular at exactly 1 — /c/rentals/can-gio held one rental on 2026-09-27.
  const what =
    f.category.slug === 'rentals'
      ? f.total === 1 ? 'place for rent' : 'places for rent'
      : `${f.category.name.toLowerCase()} ${f.total === 1 ? 'listing' : 'listings'}`
  return {
    title: `${f.category.name} in ${f.place.en}${city} | ${siteName}`,
    description: `${n} ${what} in ${f.place.en}${city}. ${tail}`,
  }
}
