'use client'

import Link from 'next/link'
import { Tr, useLanguage } from '@/context/language-context'
import { ArrowRight } from '@/components/ui/icons'
import { Row, Rows } from '@/components/ui/rows'
import { IS_SERVICES } from '@/lib/edition'
import type { CategoryGuide } from '@/lib/category-guides'
import {
  HCMC_NAME,
  districtLinkedSentence,
  formatCountFull,
  joinList,
  rentalKindNoun,
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
export function RentalsLede({ total, allHcmc, kinds, linked }: Pick<RentalsFacts, 'total' | 'allHcmc' | 'kinds' | 'linked'>) {
  const { lang, tr } = useLanguage()
  const n = formatCountFull(total, lang)
  if (lang === 'vi') {
    const list = kinds.map((k) => `${formatCountFull(k.count, 'vi')} ${rentalKindNoun(k.slug, k.count, 'vi')}`)
    const tail = {
      all: ' Tất cả đều được liên kết từ các trang bất động sản đối tác và dẫn tới tin gốc.',
      most: ' Phần lớn được liên kết từ các trang bất động sản đối tác và dẫn tới tin gốc.',
      some: ' Một số tin được liên kết từ các trang bất động sản đối tác và dẫn tới tin gốc.',
      none: '',
    }[linked]
    return <>{`${n} tin cho thuê tại ${allHcmc ? HCMC_NAME.vi : 'Việt Nam'}${list.length ? `, gồm ${joinList(list, 'vi')}` : ''}.${tail}`}</>
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
      .{linked !== 'none' && <> {linkedLede(linked, tr)}</>}
    </>
  )
}

function linkedLede(tier: Exclude<LinkedTier, 'none'>, tr: (en: string) => string): string {
  if (tier === 'all') return tr('Every one is linked from a partner property portal and links to the original listing.')
  if (tier === 'most') return tr('Most are linked from partner property portals and link to the original listing.')
  return tr('Some are linked from partner property portals and link to the original listing.')
}

/** /c/rentals, below the grid: the busiest districts as links, by canonical slug. */
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
}: {
  total: number
  name: string
  nameVi: string
  categorySlug: string
  place: { en: string; vi: string }
  linked: LinkedTier
}) {
  const { lang, tr } = useLanguage()
  const n = formatCountFull(total, lang)
  if (lang === 'vi') {
    const tail =
      linked !== 'none' ? districtLinkedSentence(linked, categorySlug, 'vi', total)
      : total === 1 ? 'Tin này đến từ người bán có điểm uy tín công khai — ít hàng giả, ít giá mồi hơn.'
      : 'Mỗi tin đều đến từ người bán có điểm uy tín công khai — ít hàng giả, ít giá mồi hơn.'
    return <>{`${n} tin ${nameVi.toLowerCase()} tại ${place.vi}. ${tail}`}</>
  }
  const rentals = categorySlug === 'rentals'
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
      </>
    )
  }
  // Literal tr() per form so the harvester can pre-translate each. At 1 the tier is always "all".
  const tail =
    total === 1
      ? rentals ? tr('It links to its original listing on a partner property portal.') : tr('It links to its original listing on a partner site.')
    : linked === 'all'
      ? rentals ? tr('Every one links to its original listing on a partner property portal.') : tr('Every one links to its original listing on a partner site.')
      : linked === 'most'
        ? rentals ? tr('Most link to their original listing on a partner property portal.') : tr('Most link to their original listing on a partner site.')
        : rentals ? tr('Some link to their original listing on a partner property portal.') : tr('Some link to their original listing on a partner site.')
  return (
    <>
      {n} {what} {place.en}. {tail}
    </>
  )
}

/**
 * /c/rentals and /c/rentals/<district>, under the lede: one line pointing at /hcmc-rent-index.
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
 * §3b) — unlike SeoArticle's bordered "Keep reading" cards, which predate the flat pass.
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
