'use client'

import Link from 'next/link'
import { Tr, useLanguage } from '@/context/language-context'
import { ArrowRight } from '@/components/ui/icons'
import { Row, Rows } from '@/components/ui/rows'
import { IS_SERVICES } from '@/lib/edition'
import type { CategoryGuide } from '@/lib/category-guides'
import {
  HCMC_NAME,
  RENTALS_PLACE_LABEL,
  districtLinkedSentence,
  formatCountFull,
  joinList,
  rentalKindNoun,
  type DistrictRentalsHeadline,
  type HomeFacts,
  type LinkedTier,
  type RentalsFacts,
  type RentalsHeadline,
} from './category-copy'

/**
 * The language-dependent copy of /c/<category> and /c/<category>/<district>.
 *
 * ⛔ CLIENT COMPONENTS FOR THE SAME REASON AS CategoryLede: the sentence must follow the visitor's
 * language even when the choice cannot be persisted (cookies blocked) and the page swaps language
 * client-side. The server passes numbers and names; the words are chosen here.
 *
 * ⚠️ VIETNAMESE IS WRITTEN WHOLE, ENGLISH IN LITERAL `tr()` FRAGMENTS. Vietnamese word order cannot
 * be assembled from English pieces, so the `vi` branch builds its own sentence; the English branch
 * keeps literal fragments because the nine machine-translated languages render from English and the
 * string harvester (scripts/gen-ui-strings.mjs) can only pre-translate a literal.
 */

/** A place name: English on every page but a Vietnamese one — never machine-translated. */
export function PlaceName({ en, vi }: { en: string; vi: string }) {
  const { lang } = useLanguage()
  return <>{lang === 'vi' ? vi : en}</>
}

/**
 * /c/rentals H1 — the four strings category-copy.ts `RENTALS_H1` holds, as literals (tested equal).
 * ⚠️ IT TAKES THE VARIANT, NOT THE FACTS: `(index)/layout.tsx` renders it above the loading boundary
 * from the cached `loadRentalsHeadline`, the same value the `<title>` is built from.
 */
export function RentalsHeading({ headline }: { headline: RentalsHeadline }) {
  const { tr } = useLanguage()
  switch (headline) {
    case 'apartments-houses-hcmc':
      return <>{tr('Apartments & houses for rent in Ho Chi Minh City', 'Cho thuê căn hộ và nhà tại TP. Hồ Chí Minh')}</>
    case 'apartments-hcmc':
      return <>{tr('Apartments for rent in Ho Chi Minh City', 'Cho thuê căn hộ ở TP. Hồ Chí Minh')}</>
    case 'rentals-hcmc':
      return <>{tr('Rentals in Ho Chi Minh City', 'Cho thuê ở TP. Hồ Chí Minh')}</>
    default:
      return <>{tr('Rentals in Vietnam', 'Cho thuê tại Việt Nam')}</>
  }
}

/**
 * /c/rentals lede: the live total, the kinds of home, and how much of it is linked from a portal.
 *
 * ⚠️ IT SAYS WHERE THE LISTING OPENS, NOT WHO HANDLES THE ENQUIRY. The importers' "enquiries and
 * viewings are handled there, not by eno" line was removed on the owner's word (2026-09-25,
 * import-viewing-disclaimer.ts) because the free availability check covers these rentals too —
 * the RentalCheckHint right under this paragraph.
 */
export function RentalsLede({ total, allHcmc, kinds, linked, vehicles, homes, homesLinked }: Pick<RentalsFacts, 'total' | 'allHcmc' | 'kinds' | 'linked' | 'vehicles' | 'homes' | 'homesLinked'>) {
  const { lang, tr } = useLanguage()
  const n = formatCountFull(total, lang)
  /**
   * ⛔ WITH HOMES, THE LEDE COUNTS HOMES (SEO wave B, D1b; CS-2 D1b-2): it opened on "25,502 places
   * … and 2,270 offices", the same number and the same offices as the old description. It now leads
   * with the homes count the description and the preview use (one `loadRentalsFacts` per render);
   * offices sit behind the "Also here" link under the grid. D-f's sentence closes it in both
   * languages, from one set of `tr()` pairs (rentalsLinkedLede).
   */
  const homesShown = !!homes && homes.total > 0
  // The tier of what the sentence counts: the homes' own while it counts homes.
  const tier = homesShown ? homesLinked ?? linked : linked
  const tail = tier === 'none' ? null : rentalsLinkedLede(tier, (homesShown ? homes!.total : total) === 1, tr)
  if (homes && homesShown) {
    return (
      <>
        <HomesSentence homes={homes} place={allHcmc ? HCMC_NAME : { en: 'Vietnam', vi: 'Việt Nam' }} />
        {tail && <> {tail}</>}
        <VehicleHire vehicles={vehicles} />
      </>
    )
  }
  if (lang === 'vi') {
    const list = kinds.map((k) => `${formatCountFull(k.count, 'vi')} ${rentalKindNoun(k.slug, k.count, 'vi')}`)
    return <>{`${n} tin cho thuê tại ${allHcmc ? HCMC_NAME.vi : 'Việt Nam'}${list.length ? `, gồm ${joinList(list, 'vi')}` : ''}.${tail ? ` ${tail}` : ''}`}<VehicleHire vehicles={vehicles} /></>
  }
  // Literal tr() per form so the harvester can pre-translate each; singular at exactly 1.
  const kindWord = (slug: string, one: boolean) =>
    slug === 'apartment-rental' ? (one ? tr('apartment') : tr('apartments'))
    : slug === 'house-rental' ? (one ? tr('house') : tr('houses'))
    : slug === 'room-rental' ? (one ? tr('room') : tr('rooms'))
    : one ? tr('office') : tr('offices')
  const where =
    total === 1
      ? allHcmc ? tr('place for rent in Ho Chi Minh City') : tr('place for rent in Vietnam')
      : allHcmc ? tr('places for rent in Ho Chi Minh City') : tr('places for rent in Vietnam')
  return (
    <>
      {n} {where}
      {kinds.length > 0 && (
        <>
          , {tr('including')}{' '}
          {kinds.map((k, i) => (
            <span key={k.slug}>
              {i > 0 && (i === kinds.length - 1 ? <> {tr('and')} </> : <>, </>)}
              {formatCountFull(k.count, lang)} {kindWord(k.slug, k.count === 1)}
            </span>
          ))}
        </>
      )}
      .{tail && <> {tail}</>}
      <VehicleHire vehicles={vehicles} />
    </>
  )
}

/**
 * The lede's last sentence: car and motorbike hire, which share the rentals category but are not
 * "places" (category-copy.ts RentalsFacts.vehicles) and are not in the grid below — so each count
 * links to the explorer view that lists them. Nothing when there are none; a zero kind is omitted.
 */
function VehicleHire({ vehicles }: Pick<RentalsFacts, 'vehicles'>) {
  const { lang, tr } = useLanguage()
  const cars = vehicles?.cars ?? 0
  const bikes = vehicles?.motorbikes ?? 0
  if (cars + bikes === 0) return null
  /**
   * On eno.vn each count links to its HCMC hub (src/components/marketplace/vehicle-hub.tsx), in the
   * reader's language; on eno.forum to the explorer view instead — the hubs build there too, but a
   * forum surface must not promote its self-canonical COPY of an eno.vn page (the footer's rule).
   */
  const HUB: Record<string, { en: string; vi: string }> = {
    'car-rental': { en: '/car-rental-ho-chi-minh-city', vi: '/thue-xe-tu-lai-tphcm' },
    'motorbike-rental': { en: '/motorbike-rental-ho-chi-minh-city', vi: '/thue-xe-may-tphcm' },
  }
  const link = (sub: string, label: string) => (
    <Link
      href={IS_SERVICES ? `/?category=rentals&subcategory=${sub}` : HUB[sub][lang === 'vi' ? 'vi' : 'en']}
      className="font-semibold text-accent-foreground hover:underline"
    >
      {label}
    </Link>
  )
  // The sentence has the same shape in both languages ("Plus X and Y for hire." / "Ngoài ra còn X và
  // Y cho thuê."), so it is one branch of paired tr() literals; Vietnamese nouns take no plural.
  const carLabel = `${formatCountFull(cars, lang)} ${cars === 1 ? tr('car', 'xe ô tô') : tr('cars', 'xe ô tô')}`
  const bikeLabel = `${formatCountFull(bikes, lang)} ${bikes === 1 ? tr('motorbike', 'xe máy') : tr('motorbikes', 'xe máy')}`
  const parts = [cars > 0 ? link('car-rental', carLabel) : null, bikes > 0 ? link('motorbike-rental', bikeLabel) : null].filter(Boolean)
  return (
    <> {tr('Plus', 'Ngoài ra còn')} {parts[0]}{parts.length === 2 && <> {tr('and', 'và')} {parts[1]}</>} {tr('for hire.', 'cho thuê.')}</>
  )
}

/**
 * /c/rentals, below the grid: the busiest districts as links, by canonical slug, and the Rent Index.
 * ⚠️ THE RENT INDEX LINK LIVES HERE, NOT UNDER THE LEDE (C1-FOLD, 2026-09-29): above the grid it was
 * one more line between a phone's H1 and its first card. /c/rentals still links /hcmc-rent-index from
 * here; an HCMC district page keeps its own under its lede ([district]/page.tsx).
 */
export function RentalsDistricts({ allHcmc, top }: Pick<RentalsFacts, 'allHcmc' | 'top'>) {
  const { lang, tr } = useLanguage()
  if (!top.length) return null
  const links = top.map((d, i) => (
    <span key={d.slug}>
      {i > 0 && (i === top.length - 1 ? <> {tr('and', 'và')} </> : <>, </>)}
      <Link href={`/c/rentals/${d.slug}`} className="font-semibold text-accent-foreground hover:underline">
        {lang === 'vi' ? d.label.vi : d.label.en}
      </Link>
    </span>
  ))
  return (
    <section className="mt-12 border-t border-border pt-8">
      <h2 className="h-section text-foreground">
        {allHcmc ? tr('Renting in Ho Chi Minh City', 'Thuê nhà ở TP. Hồ Chí Minh') : tr('Renting in Vietnam', 'Thuê nhà tại Việt Nam')}
      </h2>
      <p className="mt-3 max-w-prose text-base leading-relaxed text-body">
        {tr('The most listings are in', 'Nhiều tin nhất ở')} {links}.
      </p>
      <RentIndexLink />
    </section>
  )
}

/** /c/<category>/<district> H1: "Rentals in District 2 (Thu Duc)" / "Cho thuê tại Quận 2 (Thủ Đức)". */
export function DistrictHeading({ name, nameVi, place }: { name: string; nameVi: string; place: { en: string; vi: string } }) {
  const { lang } = useLanguage()
  if (lang === 'vi') return <>{`${nameVi} tại ${place.vi}`}</>
  return (
    <>
      <Tr text={name} /> <Tr text="in" /> {place.en}
    </>
  )
}

/**
 * /c/rentals/<district> H1 while the page lists homes (SEO wave B, D1; decision D-a; CS-2 D1-4/D1-5):
 * "Apartments & houses for rent in District 7 (Phu My Hung)". Literal `tr()` pairs, held equal to
 * category-copy.ts `DISTRICT_RENTALS_H1` by category-text.test.tsx. The place is the search label
 * (RENTALS_PLACE_LABEL), passed in by the page.
 */
export function RentalsDistrictHeading({ headline, place }: { headline: DistrictRentalsHeadline; place: { en: string; vi: string } }) {
  const { lang, tr } = useLanguage()
  const lead = headline === 'apartments-houses'
    ? tr('Apartments & houses for rent in', 'Cho thuê căn hộ và nhà tại')
    : tr('Apartments for rent in', 'Cho thuê căn hộ tại')
  return <>{lead} {lang === 'vi' ? place.vi : place.en}</>
}

/**
 * The D-f sentence (category-copy.ts RENTALS_LINKED_SENTENCE, CS-2 D1-14…17) as literal `tr()` pairs,
 * so the harvester pre-translates it; category-text.test.tsx holds each equal to the map.
 */
export function rentalsLinkedLede(tier: Exclude<LinkedTier, 'none'>, one: boolean, tr: (en: string, vi?: string) => string): string {
  if (one) return tr('It links to its original ad on another listing site.', 'Tin này dẫn tới tin gốc trên một trang đăng tin khác.')
  if (tier === 'all') return tr('Every listing links to its original ad on another listing site.', 'Mỗi tin đều dẫn tới tin gốc trên một trang đăng tin khác.')
  if (tier === 'most') return tr('Most listings link to their original ads on other listing sites.', 'Phần lớn tin dẫn tới tin gốc trên các trang đăng tin khác.')
  return tr('Some listings link to their original ads on other listing sites.', 'Một số tin dẫn tới tin gốc trên các trang đăng tin khác.')
}

/** "14,043 apartments, 5,331 houses and 3,289 rooms" — literal `tr()` per word; Vietnamese has no plural. */
function HomeKinds({ kinds }: { kinds: HomeFacts['kinds'] }) {
  const { lang, tr } = useLanguage()
  if (lang === 'vi') return <>{joinList(kinds.map((k) => `${formatCountFull(k.count, 'vi')} ${rentalKindNoun(k.slug, k.count, 'vi')}`), 'vi')}</>
  const word = (slug: string, one: boolean) =>
    slug === 'apartment-rental' ? (one ? tr('apartment') : tr('apartments'))
    : slug === 'house-rental' ? (one ? tr('house') : tr('houses'))
    : one ? tr('room') : tr('rooms')
  return (
    <>
      {kinds.map((k, i) => (
        <span key={k.slug}>
          {i > 0 && (i === kinds.length - 1 ? <> {tr('and')} </> : <>, </>)}
          {formatCountFull(k.count, lang)} {word(k.slug, k.count === 1)}
        </span>
      ))}
    </>
  )
}

/**
 * The homes sentence that opens a rentals lede while the page lists homes (CS-2 D1-8 / D1b-2):
 * "{homes} homes for rent in {place}, including {a} apartments, {h} houses and {r} rooms." Offices
 * and untyped rows are not in it; the page links offices below the grid instead (OtherRentalsLink).
 */
export function HomesSentence({ homes, place }: { homes: HomeFacts; place: { en: string; vi: string } }) {
  const { lang, tr } = useLanguage()
  const n = formatCountFull(homes.total, lang)
  if (lang === 'vi') return <>{`${n} chỗ ở cho thuê tại ${place.vi}, gồm `}<HomeKinds kinds={homes.kinds} />.</>
  return (
    <>
      {n} {homes.total === 1 ? tr('home for rent in') : tr('homes for rent in')} {place.en}, {tr('including')} <HomeKinds kinds={homes.kinds} />.
    </>
  )
}

/**
 * ⛔ THE THREE THỦ ĐỨC PAGES CROSS-LINK (SEO wave B, decision D-d; CS-2 D1-11…13). `thu-duc` is the
 * union of its own rows and d2 + d9 (district-canonical); each page keeps its own canonical because
 * the scopes differ, and says how they relate. ⚠️ A NAME IS LINKED ONLY WHILE ITS PAGE IS AT THE
 * INDEXING FLOOR — the page passes `linkable`, from the same chip tallies its "By area" row uses — so
 * no followed link ever points at a page that may be `noindex` (review, D1 round 3). Below the floor
 * the name stays, as plain text.
 * The history is past tense: Thủ Đức City itself was dissolved in the July 2025 ward reform, which
 * the rent index already says.
 */
export function ThuDucCrossLinks({ slug, linkable }: { slug: string; linkable: readonly string[] }) {
  const { lang, tr } = useLanguage()
  const a = (to: 'd2' | 'd9' | 'thu-duc') => {
    const name = lang === 'vi' ? RENTALS_PLACE_LABEL[to].vi : RENTALS_PLACE_LABEL[to].en
    if (!linkable.includes(to)) return <>{name}</>
    return (
      <Link href={`/c/rentals/${to}`} className="font-semibold text-accent-foreground hover:underline">
        {name}
      </Link>
    )
  }
  if (slug === 'thu-duc') {
    return (
      <>
        {' '}{tr('This page covers all of Thu Duc City, including listings still labelled', 'Trang này gồm toàn bộ TP Thủ Đức, kể cả các tin vẫn ghi')}{' '}
        {a('d2')} {tr('or', 'hoặc')} {a('d9')}.
      </>
    )
  }
  if (slug !== 'd2' && slug !== 'd9') return null
  const history = slug === 'd2'
    ? tr('District 2 became part of Thu Duc City in 2021.', 'Quận 2 được sáp nhập vào TP Thủ Đức năm 2021.')
    : tr('District 9 became part of Thu Duc City in 2021.', 'Quận 9 được sáp nhập vào TP Thủ Đức năm 2021.')
  return (
    <>
      {' '}{history} {tr('These listings are also on the', 'Các tin này cũng có trên trang')} {a('thu-duc')}
      {lang === 'vi' ? '.' : <> {tr('page.')}</>}
    </>
  )
}

/**
 * "Also here: 212 offices and shopfronts" under a homes-only grid (SEO wave B, D1/D1b; decision D-b;
 * CS-2 D1-9). `nofollow` into the explorer, which is canonicalised to /. ⚠️ `n` IS THE office-rental
 * COUNT ONLY — the rows the link opens — never `total − homes`. Nothing at 0.
 */
export function OtherRentalsLink({ n, href }: { n: number; href: string }) {
  const { lang, tr } = useLanguage()
  if (n <= 0) return null
  return (
    <p className="mt-6 text-sm text-body">
      <Link href={href} rel="nofollow" prefetch={false} className="font-semibold text-accent-foreground hover:underline">
        {tr('Also here:', 'Ngoài ra còn')} {formatCountFull(n, lang)}{' '}
        {/* English singular at 1 (review); Vietnamese has no plural, so both forms carry CS-2's one string. */}
        {n === 1 ? tr('office or shopfront', 'văn phòng, mặt bằng cho thuê') : tr('offices and shopfronts', 'văn phòng, mặt bằng cho thuê')}
      </Link>
    </p>
  )
}

/**
 * /c/<category>/<district> lede. The trust sentence survives only where nothing in scope is linked:
 * a public trust score says nothing about a listing imported from another portal.
 *
 * ⚠️ SINGULAR AT EXACTLY 1, in the tail as well as the count: /c/rentals/can-gio (one rental,
 * 2026-09-27) read "1 place for rent in Can Gio District. Every one links…" (VI "Tất cả đều…").
 */
export function DistrictLede({
  total,
  name,
  nameVi,
  categorySlug,
  place,
  linked,
  homes,
  homesLinked = 'none',
  slug,
  linkable = [],
}: {
  total: number
  name: string
  nameVi: string
  categorySlug: string
  place: { en: string; vi: string }
  linked: LinkedTier
  /** Rentals (D1): the homes the page lists. With `homes.total > 0` the lede counts homes. */
  homes?: HomeFacts | null
  homesLinked?: LinkedTier
  /** The canonical district slug — the Thủ Đức pages cross-link (D-d). */
  slug?: string
  /** The district slugs whose rentals page is at the indexing floor: only those are linked. */
  linkable?: readonly string[]
}) {
  const { lang, tr } = useLanguage()
  const n = formatCountFull(total, lang)
  const rentals = categorySlug === 'rentals'
  const cross = rentals && slug ? <ThuDucCrossLinks slug={slug} linkable={linkable} /> : null
  if (rentals && homes && homes.total > 0) {
    return (
      <>
        <HomesSentence homes={homes} place={place} />
        {homesLinked !== 'none' && <> {rentalsLinkedLede(homesLinked, homes.total === 1, tr)}</>}
        {cross}
      </>
    )
  }
  if (rentals && linked !== 'none') {
    // No home in scope: every rental, as before, with D-f's sentence (CS-2 D1-14…17).
    const what = total === 1 ? tr('place for rent in') : tr('places for rent in')
    if (lang === 'vi') return <>{`${n} tin cho thuê tại ${place.vi}. ${rentalsLinkedLede(linked, total === 1, tr)}`}{cross}</>
    return <>{n} {what} {place.en}. {rentalsLinkedLede(linked, total === 1, tr)}{cross}</>
  }
  if (lang === 'vi') {
    const tail =
      linked !== 'none' ? districtLinkedSentence(linked, categorySlug, 'vi', total)
      : total === 1 ? 'Tin này đến từ người bán có điểm uy tín công khai — ít hàng giả, ít giá mồi hơn.'
      : 'Mỗi tin đều đến từ người bán có điểm uy tín công khai — ít hàng giả, ít giá mồi hơn.'
    return <>{`${n} tin ${nameVi.toLowerCase()} tại ${place.vi}. ${tail}`}{cross}</>
  }
  // "3,741 rentals listings" read as a typo; rentals are counted as places, as /c/rentals does.
  const what = rentals ? (
    total === 1 ? tr('place for rent in') : tr('places for rent in')
  ) : (
    <>
      <Tr text={name.toLowerCase()} /> {total === 1 ? <Tr text="listing" /> : <Tr text="listings" />} <Tr text="in" />
    </>
  )
  if (linked === 'none') {
    return (
      <>
        {n} {what} {place.en},{' '}
        {total === 1 ? (
          <Tr text="from a seller with a public trust score — fewer fakes, fewer bait prices." />
        ) : (
          <Tr text="each from a seller with a public trust score — fewer fakes, fewer bait prices." />
        )}
        {cross}
      </>
    )
  }
  // Literal tr() per form so the harvester can pre-translate each. At 1 the tier is always "all".
  // Rentals never reach here while linked (D-f's own sentences, above).
  const tail =
    total === 1 ? tr('It links to its original listing on a partner site.')
    : linked === 'all' ? tr('Every one links to its original listing on a partner site.')
    : linked === 'most' ? tr('Most link to their original listing on a partner site.')
    : tr('Some link to their original listing on a partner site.')
  return (
    <>
      {n} {what} {place.en}. {tail}
    </>
  )
}

/**
 * /c/rentals (under the grid, in RentalsDistricts) and /c/rentals/<district> (under the lede): one line
 * pointing at /hcmc-rent-index.
 *
 * ⚠️ MARKETPLACE EDITION ONLY — the rent index page is `notFound()` on eno.forum, so there this would
 * be a link to a 404. The gate lives here rather than at the two call sites so neither can forget it.
 * ⚠️ NO ROW FRAGMENT on a district page: the index's table rows carry no ids, so a `#<slug>` would
 * land at the top anyway.
 */
export function RentIndexLink() {
  const { tr } = useLanguage()
  if (IS_SERVICES) return null
  return (
    <p className="mt-2 max-w-prose text-sm text-body">
      {tr('Median rent by district', 'Giá thuê trung vị theo quận')}:{' '}
      <Link href="/hcmc-rent-index" className="inline-flex items-center gap-1 font-semibold text-accent-foreground hover:underline">
        {tr('HCMC Rent Index', 'Chỉ số giá thuê nhà TP.HCM')} <ArrowRight className="h-4 w-4 shrink-0" />
      </Link>
    </p>
  )
}

/**
 * The "Guides" block — up to four long-form guides for this category (src/lib/category-guides.ts).
 *
 * ⚠️ FLAT: rows divided by hairlines under a ruled section, no card boxes (docs/design-language.md
 * §3b) — the same ruled-rows shape as SeoArticle's "Keep reading" list.
 * ⚠️ THE LINK TEXT IS THE GUIDE'S OWN LABEL IN THE GUIDE'S OWN LANGUAGE, never translated, and it
 * carries `lang` when that differs from the page's, so a screen reader pronounces it correctly.
 */
export function CategoryGuides({ guides }: { guides: CategoryGuide[] }) {
  const { lang, tr } = useLanguage()
  if (!guides.length) return null
  return (
    <section className="mt-12 border-t border-border pt-8">
      <h2 className="h-section text-foreground">{tr('Guides', 'Cẩm nang')}</h2>
      <Rows className="mt-2 max-w-3xl">
        {guides.map((g) => (
          <Row key={g.href}>
            <Link href={g.href} lang={g.lang === lang ? undefined : g.lang} className="group flex flex-col">
              <span className="flex items-center gap-1 text-sm font-semibold text-foreground group-hover:text-accent-foreground">
                {g.label} <ArrowRight className="h-4 w-4 shrink-0" />
              </span>
              <span className="mt-1 text-sm leading-relaxed text-body">{g.blurb}</span>
            </Link>
          </Row>
        ))}
      </Rows>
    </section>
  )
}
