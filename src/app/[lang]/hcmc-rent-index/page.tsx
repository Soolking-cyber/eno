import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { IS_SERVICES, SITE_NAME } from '@/lib/edition'
import { moneyLocale } from '@/lib/vnd'
import { Tr } from '@/context/language-context'
import { VI_OVERRIDES } from '@/generated/vi-overrides'
import { Header } from '@/components/marketplace/header'
import { Footer } from '@/components/marketplace/footer'
import { MIN_CELL_N, type RentIndex } from '@/lib/rent-index'
import { loadRentIndex } from './load-rent-index'
import { DistrictTable, Headline, Methodology, Unavailable } from './rent-index-sections'
import { CiteBox } from './cite-box'

/**
 * /hcmc-rent-index — median asking rent by district and property type in Ho Chi Minh City, computed
 * here from the rentals category. Original analysis the source portals do not publish, built to be
 * linked to and cited (the site is otherwise mostly imported catalogue rows).
 *
 * ⛔ RENDERED PER REQUEST, CACHED ONE LEVEL DOWN. `revalidate` would give this page an ISR copy on its
 * own clock while /hcmc-rent-index.csv kept another, so the table and the download could disagree for
 * a day; both now read the single daily snapshot in ./load-rent-index.ts, which is where the 86,400 s
 * lives. It also means a database outage shows "could not be read" for one request rather than being
 * baked into cached HTML for a day (both plan reviewers).
 *
 * ⚠️ MARKETPLACE ONLY (owner's spec). The repo has no marketplace-only route tier — `.svc.` excludes
 * routes FROM the marketplace, not the other way — so the services build answers 404 here, the CSV
 * route does the same, and the sitemap submits the URL only from eno.vn. Nothing on the page is a
 * licensed-services surface, so compiling into the eno.forum bundle is harmless; it just never renders.
 */
export const dynamic = 'force-dynamic'

const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn'
const PATH = '/hcmc-rent-index'
const URL_ = `${ORIGIN}${PATH}`

/**
 * ⚠️ ONE BILINGUAL TITLE AND DESCRIPTION, THE SAME ON BOTH VARIANTS. Googlebot sends no
 * Accept-Language, so it only ever sees the English render; a Vietnamese searcher gets this page only
 * if the Vietnamese words are in the one <title> Google indexed. Same shape as the category pages on
 * branch seo-bilingual-meta ("EN · VI | eno.vn"), written out here rather than imported. ≤ 65 / 160.
 */
const TITLE = `HCMC Rent Index · Giá thuê nhà TP.HCM theo quận | ${SITE_NAME}`
const DESCRIPTION =
  'Median rent by district in Ho Chi Minh City, updated daily, free to cite. Giá thuê nhà trung vị theo quận tại TP.HCM, cập nhật mỗi ngày.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: PATH,
  },
}

/**
 * ⚠️ PLAIN STATEMENTS WITH NO NUMBERS IN THEM, so each is one stable `<Tr>` key with curated
 * Vietnamese — and so the FAQPage JSON-LD can never quote a figure the table beside it no longer shows.
 */
const FAQS: { q: string; a: string }[] = [
  {
    q: 'How much is rent in Ho Chi Minh City?',
    a: 'It depends mostly on the type of home and the district. The figures at the top of this page are the city-wide medians of current asking rents for apartments, houses and rooms, and the table below them gives the same figures for each district, so you can compare any district with the city as a whole.',
  },
  {
    q: 'Are these the rents people actually pay?',
    a: 'No — they are asking prices from live listings. Signed rents are often lower after negotiation, and a long lease or paying several months up front usually earns a discount. Use the index to compare districts and spot an outlier, not as a quote.',
  },
  {
    q: 'Can I use this data in an article or report?',
    a: 'Yes. The figures are free to cite and quote. Please credit eno.vn with a link to https://eno.vn/hcmc-rent-index. The full table is available as a CSV download, with the snapshot time on every row.',
  },
]

/** The FAQ as the reader sees it — the same curated Vietnamese `<Tr>` renders, so the JSON-LD matches the page. */
const inLang = (en: string, lang: string) => (lang === 'vi' ? VI_OVERRIDES[en] ?? en : en)

function jsonLd(index: RentIndex | null, lang: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Rentals', item: `${ORIGIN}/c/rentals` },
        { '@type': 'ListItem', position: 2, name: 'HCMC Rent Index', item: URL_ },
      ],
    },
  ]
  /**
   * ⚠️ THE FAQ NODE, LIKE THE DATASET, ONLY WITH FIGURES: its first answer points at "the figures at the
   * top of this page", which a could-not-read render does not show (opus, diff review).
   */
  if (index) {
    nodes.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQS.map((f) => ({
        '@type': 'Question',
        name: inLang(f.q, lang),
        acceptedAnswer: { '@type': 'Answer', text: inLang(f.a, lang) },
      })),
    })
  }
  /**
   * ⚠️ THE DATASET IS DECLARED ONLY WHEN THERE ARE FIGURES. A Dataset node with a `dateModified` of a
   * snapshot that could not be read would describe data the page is not showing.
   * ⚠️ NO `temporalCoverage`: the rows are live listings whose original posting dates live on the
   * source sites, so any range stated here would be invented (opus, plan review). `dateModified` is
   * what is actually known — when this snapshot was computed.
   */
  if (index) {
    nodes.push({
      '@context': 'https://schema.org',
      '@type': 'Dataset',
      name: 'Ho Chi Minh City Rent Index',
      description:
        `Median, 25th and 75th percentile monthly asking rent in Vietnamese đồng for apartments, houses and rooms in each Ho Chi Minh City district, computed daily by ${SITE_NAME} from live rental listings. Cells with fewer than ${MIN_CELL_N} listings are not published. Asking prices, not signed leases.`,
      url: URL_,
      creator: { '@type': 'Organization', name: SITE_NAME, url: ORIGIN },
      // ⚠️ NO `license` (owner, 2026-09-27): the terms are "free to cite and quote, with a credit link",
      // which is not an open licence, and naming CC BY here would grant more than the page does.
      // `usageInfo` points at the one place the terms are written: the cite box.
      usageInfo: `${URL_}#cite`,
      isAccessibleForFree: true,
      dateModified: index.computedAt,
      spatialCoverage: {
        '@type': 'Place',
        name: 'Ho Chi Minh City, Vietnam',
        geo: { '@type': 'GeoCoordinates', latitude: 10.7769, longitude: 106.7009 },
      },
      variableMeasured: ['median monthly asking rent (VND)', 'interquartile range (VND)', 'listing count', 'median rent per square metre (VND)'],
      keywords: ['Ho Chi Minh City', 'Saigon', 'rent', 'rental prices', 'apartments', 'Vietnam housing'],
      distribution: {
        '@type': 'DataDownload',
        encodingFormat: 'text/csv',
        contentUrl: `${ORIGIN}/hcmc-rent-index.csv`,
      },
    })
  }
  return nodes
}

export default async function HcmcRentIndexPage({ params }: { params: Promise<{ lang: string }> }) {
  if (IS_SERVICES) notFound()
  const { lang } = await params
  const locale = moneyLocale(lang)
  const lookup = await loadRentIndex()
  const index = lookup.known ? lookup.index : null
  /**
   * ⚠️ A DATE IN HO CHI MINH CITY TIME, FROM THE SNAPSHOT — not from the render, and not a clock time.
   * This is a server component, so no hydration can disagree with it; the date is the snapshot's, so
   * the page and the CSV name the same day.
   */
  const snapshot = index
    ? new Date(index.computedAt).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-GB', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh',
      })
    : null
  /**
   * ⚠️ THE CITATION AND THE LINK SNIPPET ARE ENGLISH ON BOTH LANGUAGES — they are pasted into other
   * people's articles under an English-titled dataset, and "27 tháng 9, 2026" inside an English
   * reference mixed two languages (opus). HCMC-local dates, never UTC: 17:00–24:00 UTC on
   * 31 December is already the next year in Saigon. With no snapshot, the month is today's — this
   * page renders per request, so that is the month the reader is citing it in.
   */
  const hcmc = (opts: Intl.DateTimeFormatOptions) =>
    new Date(index?.computedAt ?? Date.now()).toLocaleDateString('en-GB', { ...opts, timeZone: 'Asia/Ho_Chi_Minh' })
  const citedOn = hcmc({ day: 'numeric', month: 'long', year: 'numeric' })
  const citedMonth = hcmc({ month: 'long', year: 'numeric' })
  const citation = index
    ? `${SITE_NAME} (${citedOn.slice(-4)}). Ho Chi Minh City Rent Index, ${citedOn}. ${URL_}`
    : `${SITE_NAME}. Ho Chi Minh City Rent Index. ${URL_}`
  const htmlSnippet = `<a href="${URL_}">HCMC Rent Index, ${SITE_NAME} (${citedMonth})</a>`

  return (
    <div className="flex min-h-screen flex-col blob-bg">
      {jsonLd(index, lang).map((node, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(node).replace(/</g, '\\u003c') }}
        />
      ))}
      <Header />
      <main id="main" tabIndex={-1} className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-10 pb-16">
        <p className="eyebrow text-accent-foreground mb-2"><Tr text="Data · Ho Chi Minh City" /></p>
        <h1 className="h-display text-foreground"><Tr text="Ho Chi Minh City Rent Index" /></h1>
        <p className="mt-4 max-w-prose text-base leading-relaxed text-body">
          <Tr text="What renting a home in Saigon costs right now, district by district: the median monthly asking rent for apartments, houses and rooms, recalculated every day from live listings and free to cite." />
        </p>
        {index ? (
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span><Tr text="Snapshot" />: {snapshot}</span>
            {/* The backlink box sits at the foot of the page; this puts it one tap from the top. */}
            <a href="#cite" className="font-semibold text-accent-foreground hover:underline">
              <Tr text="Cite or link to this data" />
            </a>
          </p>
        ) : (
          <Unavailable />
        )}

        {index && (
          <>
            <Headline index={index} locale={locale} />
            <DistrictTable index={index} lang={lang} locale={locale} />
          </>
        )}

        <Methodology index={index} locale={locale} snapshot={snapshot} />

        <section className="mt-12" aria-labelledby="faq">
          <h2 id="faq" className="h-section text-foreground mb-4"><Tr text="Frequently asked questions" /></h2>
          <div className="grid gap-x-14 gap-y-5 lg:grid-cols-2">
            {/* ⚠️ LITERAL <Tr>s, SO scripts/gen-ui-strings.mjs HARVESTS THEM for the nine MT languages (every
                diff reviewer). FAQS above feeds the JSON-LD; hcmc-rent-index.test.ts fails if the two drift. */}
            <div>
              <h3 className="text-sm font-bold text-foreground"><Tr text="How much is rent in Ho Chi Minh City?" /></h3>
              <p className="mt-1 text-sm leading-relaxed text-body"><Tr text="It depends mostly on the type of home and the district. The figures at the top of this page are the city-wide medians of current asking rents for apartments, houses and rooms, and the table below them gives the same figures for each district, so you can compare any district with the city as a whole." /></p>
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground"><Tr text="Are these the rents people actually pay?" /></h3>
              <p className="mt-1 text-sm leading-relaxed text-body"><Tr text="No — they are asking prices from live listings. Signed rents are often lower after negotiation, and a long lease or paying several months up front usually earns a discount. Use the index to compare districts and spot an outlier, not as a quote." /></p>
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground"><Tr text="Can I use this data in an article or report?" /></h3>
              <p className="mt-1 text-sm leading-relaxed text-body"><Tr text="Yes. The figures are free to cite and quote. Please credit eno.vn with a link to https://eno.vn/hcmc-rent-index. The full table is available as a CSV download, with the snapshot time on every row." /></p>
            </div>
          </div>
        </section>

        <CiteBox url={URL_} htmlSnippet={htmlSnippet} citation={citation} />

        <p className="mt-12 max-w-3xl text-sm text-body">
          <Link href="/housing-vietnam-expats" className="font-semibold text-accent-foreground hover:underline">
            <Tr text="Housing and apartment rentals for expats in Vietnam" />
          </Link>
        </p>
      </main>
      <Footer />
    </div>
  )
}
