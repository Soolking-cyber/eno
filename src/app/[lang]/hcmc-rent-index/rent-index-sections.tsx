import type { ReactNode } from 'react'
import Link from 'next/link'
import { Tr } from '@/context/language-context'
import { Bilingual } from '@/components/marketplace/bilingual'
import { ArrowRight } from '@/components/ui/icons'
import { formatMoneyFull, groupVnd, type MoneyLocale } from '@/lib/vnd'
import { isIndexableCount } from '@/lib/index-floor'
import {
  APARTMENT_BANDS, DISPLAY_STEP_VND, MAX_AREA_M2, MAX_MONTHLY_VND, MAX_VND_PER_M2, MIN_AREA_M2, MIN_CELL_N,
  MIN_MONTHLY_VND, MIN_VND_PER_M2, RENT_INDEX_RULES_VERSION, RENT_TYPES, ROUND_VND, roundForDisplay,
  type ApartmentBand, type DistrictRow, type ExclusionReason, type RentIndex, type RentType, type Stats,
} from '@/lib/rent-index'

/**
 * The visible half of /hcmc-rent-index. Server components only: every number here is rendered from the
 * one `RentIndex` the page loaded, and the copy goes through `<Tr>` with curated Vietnamese in
 * src/generated/vi-overrides.ts, so a Vietnamese reader gets Vietnamese in the first HTML.
 *
 * ⛔ COPY ADDED FROM RULES v3 ON (SEO wave B, R2) RENDERS THROUGH `<Bilingual en vi>`, NOT `<Tr>`, with
 * the Vietnamese from the owner-approved copy sheet CS-2 (2026-09-30). A new `<Tr>` key has no curated
 * Vietnamese until vi-overrides is regenerated, and that run would also pull in hundreds of unreviewed
 * machine translations for strings elsewhere (plan v4, R2). Unchanged `<Tr>` strings stay.
 *
 * ⚠️ NUMBERS STAY OUTSIDE THE TRANSLATED SENTENCES. A `<Tr>` key is the exact English string; a
 * sentence with a count baked in is a new key on every snapshot and would never match its override
 * (the same trap src/app/[lang]/returns/page.tsx records for SITE_NAME).
 */

/** Literal `<Tr>`s rather than a lookup table, so scripts/gen-ui-strings.mjs harvests them. */
function TypeLabel({ t }: { t: RentType }) {
  if (t === 'apartment') return <Tr text="Apartments" />
  if (t === 'house') return <Tr text="Houses" />
  return <Tr text="Rooms" />
}

/**
 * An apartment bedroom band's label (CS-2 R2-2…R2-4). Literal pairs, one per band, so a band added in
 * rent-index.ts fails to compile here until it has approved copy.
 */
const BAND_LABEL: Record<ApartmentBand, { en: string; vi: string }> = {
  br1: { en: '1 bedroom', vi: '1 phòng ngủ' },
  br2: { en: '2 bedrooms', vi: '2 phòng ngủ' },
  br3plus: { en: '3 or more bedrooms', vi: 'Từ 3 phòng ngủ' },
}
function BandLabel({ b }: { b: ApartmentBand }) {
  return <Bilingual en={BAND_LABEL[b].en} vi={BAND_LABEL[b].vi} />
}

/** Unit marks: the same in every language, and outside the jsx-no-literals allowlist. */
const PER_M2 = '/ m²'
const M2 = 'm²'

/**
 * ⚠️ EXACT COUNTS, NOT formatCount's "25.5k". A cited figure has to be the figure, and "2k m²" read
 * as an abbreviation nobody would put in a methodology.
 */
const count = (n: number, locale: MoneyLocale) => groupVnd(String(n), locale)

const money = (n: number, locale: MoneyLocale) => formatMoneyFull(n, '₫', locale)

/**
 * ⚠️ ROUNDED FOR READING, FINER IN THE CSV. The page shows 100,000 ₫ steps (`roundForDisplay`, beside
 * the rules in src/lib/rent-index.ts so every surface printing an index figure rounds it one way);
 * the downloadable file keeps the 1,000 ₫ figure.
 */
const shown = (n: number, locale: MoneyLocale) => money(roundForDisplay(n), locale)

/**
 * ⛔ A MEDIAN IS PRINTED ONLY AT THE PUBLISHING THRESHOLD, CHECKED HERE TOO. The rules already leave
 * `median` null below MIN_CELL_N (rent-index.ts `stats`); the page does not rely on that alone, so a
 * snapshot built any other way can never publish a median of a handful (review, R2).
 */
const publishable = (s: Stats): s is Stats & { median: number } => s.median !== null && s.n >= MIN_CELL_N

/** The figures could not be read — say so, and never say there is no data. */
export function Unavailable() {
  return (
    <p className="mt-6 max-w-prose text-sm font-semibold text-body">
      <Tr text="The live figures could not be read just now. They come back within a few minutes; the method below is unchanged." />
    </p>
  )
}

/**
 * One city-wide figure on the ruled band: its label, the median, the middle half, ₫/m² and the count.
 * Shared by the type row and the bedroom-band row, so both print a figure one way.
 */
function Figure({ label, s, locale }: { label: ReactNode; s: Stats; locale: MoneyLocale }) {
  return (
    <div className="min-w-0 py-4 md:px-6 md:first:pl-0">
      <p className="text-sm font-semibold text-muted-foreground">{label}</p>
      {publishable(s) ? (
        <>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground md:text-2xl lg:text-3xl">
            {shown(s.median, locale)} <span className="whitespace-nowrap text-sm font-semibold text-muted-foreground"><Tr text="per month" /></span>
          </p>
          <p className="mt-1 text-xs text-body">
            <Tr text="Middle half" />: {shown(s.p25!, locale)} – {shown(s.p75!, locale)}
          </p>
          {s.medianPerM2 !== null && (
            <p className="text-xs text-body">{money(Math.round(s.medianPerM2 / ROUND_VND) * ROUND_VND, locale)} {PER_M2}</p>
          )}
        </>
      ) : (
        <p className="mt-1 text-3xl font-bold text-muted-foreground md:text-2xl lg:text-3xl">—</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">{count(s.n, locale)} <Tr text="listings" /></p>
    </div>
  )
}

/** Three figures on one ruled band, not three bordered tiles (flat-surface canon §3b; C-BOXES). */
const BAND_ROW = 'grid border-t border-border md:grid-cols-3 md:divide-x md:divide-border max-md:divide-y max-md:divide-border'

export function Headline({ index, locale }: { index: RentIndex; locale: MoneyLocale }) {
  return (
    <section className="mt-8" aria-labelledby="city-wide">
      <h2 id="city-wide" className="h-section text-foreground mb-4">
        <Tr text="Median asking rent across the city" />
      </h2>
      {/* Hairlines between the figures, stacked with a rule between each below md. The figure drops a
          step between md and lg only, where three columns share a tablet width and "12,000,000 ₫" at
          30px would wrap; "per month" wraps as one unit or not at all. */}
      <div className={BAND_ROW}>
        {RENT_TYPES.map((t) => <Figure key={t} label={<TypeLabel t={t} />} s={index.cityWide[t]} locale={locale} />)}
      </div>
      {/* ⚠️ THE BANDS ARE A SUBSET OF THE APARTMENT FIGURE ABOVE, NOT A SPLIT OF IT: a studio or an
          apartment with no bedroom count has no band but still counts in "Apartments" (rules v3, R-d). */}
      {/* Like BedroomTable: no row of three "— 0 listings" when no apartment carries a count. */}
      {APARTMENT_BANDS.some((b) => index.cityBands[b].n > 0) && (
        <>
          <h3 className="mt-6 mb-2 text-sm font-bold text-foreground">
            <Bilingual en="Apartments by number of bedrooms" vi="Căn hộ theo số phòng ngủ" />
          </h3>
          <div className={BAND_ROW}>
            {APARTMENT_BANDS.map((b) => <Figure key={b} label={<BandLabel b={b} />} s={index.cityBands[b]} locale={locale} />)}
          </div>
        </>
      )}
    </section>
  )
}

/**
 * One district × type cell. Below md each carries its own type label, because the column headers are
 * visually hidden there (see DistrictTable); from md the headers show and the label hides.
 * Figures are tabular and right-aligned on desktop, so the medians line up by digit down a column.
 */
function Cell({ s, heading, locale }: { s: Stats; heading: ReactNode; locale: MoneyLocale }) {
  const label = <span className="block text-2xs font-semibold text-muted-foreground md:hidden">{heading}</span>
  if (!publishable(s)) {
    return (
      <td className="min-w-0 align-top md:py-2 md:pl-4 md:text-right">
        {label}
        <span className="block font-semibold text-muted-foreground">—</span>
        <span className="block text-2xs tabular-nums text-muted-foreground">{count(s.n, locale)} <Tr text="listings" /></span>
      </td>
    )
  }
  return (
    <td className="min-w-0 align-top md:py-2 md:pl-4 md:text-right">
      {label}
      <span className="block whitespace-nowrap font-bold tabular-nums text-foreground">{shown(s.median, locale)}</span>
      <span className="block text-2xs tabular-nums text-body md:whitespace-nowrap">{shown(s.p25!, locale)} – {shown(s.p75!, locale)}</span>
      <span className="block text-2xs tabular-nums text-muted-foreground">{count(s.n, locale)} <Tr text="listings" /></span>
    </td>
  )
}

/** Thủ Đức is the union of its own rows and Districts 2 and 9, so each of those rows says so. */
function DistrictNote({ d }: { d: DistrictRow }) {
  if (d.slug === 'thu-duc') {
    return <span className="block text-2xs font-normal text-muted-foreground"><Tr text="All of Thu Duc City, including listings still labelled District 2 or 9" /></span>
  }
  if (d.partOf) {
    return <span className="block text-2xs font-normal text-muted-foreground"><Tr text="Listings labelled with the former district name; also counted in Thu Duc City" /></span>
  }
  return null
}

export function DistrictTable({ index, lang, locale }: { index: RentIndex; lang: string; locale: MoneyLocale }) {
  return (
    <section className="mt-12" aria-labelledby="by-district">
      <h2 id="by-district" className="h-section text-foreground mb-1">
        <Tr text="Median rent by district" />
      </h2>
      <p className="mb-4 max-w-prose text-sm text-muted-foreground">
        <Tr text="Each cell shows the median monthly asking rent, the middle half of asking rents below it, and how many listings it is computed from. A dash means fewer listings than the publishing threshold." />
      </p>
      {/* ⚠️ ONE TABLE AT EVERY WIDTH, RESTYLED BELOW md — NOT A SCROLLER, NOT A SECOND LIST (C-RENT-INDEX).
          Four columns of full đồng amounts are wider than a phone, and the table used to scroll sideways
          inside the page with no affordance (638px of content in a 366px box at 390, 24 rows). Below md
          each district row becomes a heading line over a 3-up grid of its figures, each cell labelled;
          the header row stays in the DOM for assistive tech but leaves the layout. Keeping one <table>
          keeps what the Dataset JSON-LD, print and a crawler read, and never prints a number twice.
          From md it is the plain table again, horizontally scrollable only if a column ever outgrows it. */}
      <div className="md:overflow-x-auto">
        <table className="w-full text-sm max-md:block md:min-w-[36rem]">
          <thead className="max-md:sr-only">
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="pb-2 pr-4 font-semibold"><Tr text="District" /></th>
              {RENT_TYPES.map((t) => (
                <th key={t} scope="col" className="pb-2 pl-4 text-right font-semibold"><TypeLabel t={t} /></th>
              ))}
            </tr>
          </thead>
          <tbody className="max-md:block">
            {index.districts.map((d) => (
              <tr key={d.slug} className="border-t border-border max-md:grid max-md:grid-cols-3 max-md:gap-x-3 max-md:py-3">
                <th scope="row" className="text-left align-top font-semibold text-foreground max-md:col-span-3 max-md:pb-2 md:min-w-[9rem] md:py-2 md:pr-4">
                  {/* ⚠️ EVERY ROW HERE HAS ≥ 1 LISTING, AND /c/rentals/<slug> MATCHES A SUPERSET OF
                      THEM (the same curated spellings on `district` OR `location`; apartments, houses
                      and rooms are all places), so the link can never land on that page's 404. Its
                      count is larger than this row's n for the same reason — the methodology says so.
                      ⛔ AND A ROW IS LINKED ONLY AT THE INDEXING FLOOR (SEO wave B, I1): below 10
                      listings that page can answer `noindex, follow`, and a followed link to it from our
                      own analysis is the wrong signal. The superset makes `d.total` a safe test: a
                      row at the floor links a page at the floor. Below it, the name is plain text.
                      ⚠️ AS OF THE SNAPSHOT (up to a day old, load-rent-index.ts), while the page counts
                      live: the same bounded lag as D3's sitemap rule. It is a margin, not a knife edge:
                      the smallest linked row held 44 homes, on a page of at least 161 places (hoc-mon,
                      2026-09-29). */}
                  {isIndexableCount(d.total) ? (
                    <Link href={`/c/rentals/${d.slug}`} className="text-accent-foreground hover:underline">
                      {lang === 'vi' ? d.name : d.nameEn}
                    </Link>
                  ) : (
                    lang === 'vi' ? d.name : d.nameEn
                  )}
                  <DistrictNote d={d} />
                </th>
                {RENT_TYPES.map((t) => <Cell key={t} s={d.cells[t]} heading={<TypeLabel t={t} />} locale={locale} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <a href="/hcmc-rent-index.csv" download className="inline-flex items-center gap-1 text-sm font-semibold text-accent-foreground hover:underline">
          <Tr text="Download the data (CSV)" /> <ArrowRight className="h-4 w-4" />
        </a>
        <Link href="/c/rentals" className="inline-flex items-center gap-1 text-sm font-semibold text-accent-foreground hover:underline">
          <Tr text="Browse every rental listing" /> <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  )
}

/**
 * Apartments by bedroom band in each district (rules v3, R-d). The same `Cell` as the district table,
 * so a band under MIN_CELL_N prints "—" and its count, never a median of a handful.
 * ⚠️ A DISTRICT WITH NO BANDED APARTMENT AT ALL IS LEFT OUT (a row of three "— 0 listings" says
 * nothing); one with any banded listing keeps its row, dashes included, so the counts stay visible.
 * ⚠️ NAMES ONLY, NO LINKS: the district table above already links each row at the indexing floor.
 */
export function BedroomTable({ index, lang, locale }: { index: RentIndex; lang: string; locale: MoneyLocale }) {
  const rows = index.districts.filter((d) => APARTMENT_BANDS.some((b) => d.bands[b].n > 0))
  if (rows.length === 0) return null
  return (
    <section className="mt-12" aria-labelledby="by-bedrooms">
      <h2 id="by-bedrooms" className="h-section text-foreground mb-1">
        <Bilingual en="Apartment rent by bedrooms and district" vi="Giá thuê căn hộ theo số phòng ngủ và theo quận" />
      </h2>
      <p className="mb-4 max-w-prose text-sm text-muted-foreground">
        <Bilingual
          en="Median monthly asking rent for apartments, by number of bedrooms. A dash means fewer listings than the publishing threshold."
          vi="Giá thuê chào trung vị mỗi tháng của căn hộ, theo số phòng ngủ. Dấu gạch nghĩa là số tin chưa đạt ngưỡng công bố."
        />
      </p>
      {/* One table at every width, restyled below md exactly like the district table above. */}
      <div className="md:overflow-x-auto">
        <table className="w-full text-sm max-md:block md:min-w-[36rem]">
          <thead className="max-md:sr-only">
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="pb-2 pr-4 font-semibold"><Tr text="District" /></th>
              {APARTMENT_BANDS.map((b) => (
                <th key={b} scope="col" className="pb-2 pl-4 text-right font-semibold"><BandLabel b={b} /></th>
              ))}
            </tr>
          </thead>
          <tbody className="max-md:block">
            {rows.map((d) => (
              <tr key={d.slug} className="border-t border-border max-md:grid max-md:grid-cols-3 max-md:gap-x-3 max-md:py-3">
                <th scope="row" className="text-left align-top font-semibold text-foreground max-md:col-span-3 max-md:pb-2 md:min-w-[9rem] md:py-2 md:pr-4">
                  {lang === 'vi' ? d.name : d.nameEn}
                  <DistrictNote d={d} />
                </th>
                {APARTMENT_BANDS.map((b) => <Cell key={b} s={d.bands[b]} heading={<BandLabel b={b} />} locale={locale} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * Literal `<Tr>`s, not a lookup table, so scripts/gen-ui-strings.mjs harvests them for the MT languages.
 * `commercial` (rules v3, R-a) is new copy, so it is a `<Bilingual>` pair from CS-2 (R2-7). The order
 * is the order the rules attribute a row (rent-index.ts `classify`): commercial before the price band.
 */
const EXCLUSIONS: ExclusionReason[] = ['notResidential', 'notForRent', 'currency', 'unit', 'commercial', 'belowBand', 'aboveBand', 'crossPosted']
function ExclusionLabel({ k }: { k: ExclusionReason }) {
  if (k === 'commercial') return <Bilingual en="A house with no bedroom count (counted as commercial)" vi="Nhà không ghi số phòng ngủ (xem là mặt bằng kinh doanh)" />
  if (k === 'notResidential') return <Tr text="Not an apartment, house or room (offices, vehicles, nightly stays)" />
  if (k === 'notForRent') return <Tr text="A renter looking for a place, not a place for rent" />
  if (k === 'currency') return <Tr text="Priced in a currency other than đồng" />
  if (k === 'unit') return <Tr text="Not a monthly price" />
  if (k === 'belowBand') return <Tr text="Below the monthly band" />
  if (k === 'aboveBand') return <Tr text="Above the monthly band" />
  return <Tr text="The same unit cross-posted on a second source" />
}

/**
 * The rules, rendered from the constants that apply them. `index` is null when the figures could not
 * be read: the method still renders — it is true either way — and only the counts disappear.
 */
export function Methodology({ index, locale, snapshot }: { index: RentIndex | null; locale: MoneyLocale; snapshot: string | null }) {
  return (
    <section className="mt-12 max-w-3xl" aria-labelledby="method">
      <h2 id="method" className="h-section text-foreground mb-3"><Tr text="How the index is calculated" /></h2>
      <div className="space-y-3 text-base leading-relaxed text-body">
        <p><Tr text="These are asking prices, not signed leases. Landlords and agents often agree a lower rent, so treat every figure as what the market is asking this week rather than what tenants pay." /></p>
        <p>
          <Tr text="The index is recalculated once a day from every published rental listing on eno.vn in Ho Chi Minh City." />
          {snapshot && <> <Tr text="This snapshot" />: <strong className="font-semibold text-foreground">{snapshot}</strong>.</>}
        </p>
        <p><Tr text="Compiled from public listings on Batdongsan, Nhatot, Muaban, Rever, Honeycomb and eno.vn members. Most are imported from those sites and link back to the original advert; the figures are always pooled and never broken down by source." /></p>
        <ul className="list-disc space-y-1 pl-5">
          <li><Tr text="Only apartments, houses and rooms. Offices, vehicle hire and nightly stays are left out." /></li>
          <li><Tr text="Only monthly prices in đồng. A price without a monthly unit counts only from the two sources whose importers were checked to store monthly rent (Batdongsan.com.vn and Rever.vn)." /></li>
          <li>
            <Tr text="Monthly band" />: {money(MIN_MONTHLY_VND, locale)} – {money(MAX_MONTHLY_VND, locale)}. <Tr text="Anything outside is a typo, a deposit, a whole building or a sale price." />
          </li>
          <li>
            <Tr text="Price per square metre" />: {MIN_AREA_M2}–{count(MAX_AREA_M2, locale)} {M2} · {money(MIN_VND_PER_M2, locale)} – {money(MAX_VND_PER_M2, locale)} {PER_M2}. <Tr text="Only floor areas and results inside these ranges are used; a listing with an implausible area still counts toward the rent." />
          </li>
          <li>
            <Bilingual
              en="Apartments are also split by bedrooms: 1, 2, and 3 or more. The all-apartment figures still include every apartment."
              vi="Căn hộ còn được chia theo số phòng ngủ: 1, 2, và từ 3 trở lên. Số liệu căn hộ chung vẫn gồm mọi căn hộ."
            />{' '}
            <Bilingual
              en="Serviced and mini apartments count as apartments, in their bedroom band. Not every source labels them, so the index does not report them separately."
              vi="Căn hộ dịch vụ và căn hộ mini được tính là căn hộ, theo số phòng ngủ. Không phải nguồn nào cũng ghi rõ loại này, nên chỉ số không tách riêng."
            />
          </li>
          <li>
            <Bilingual
              en="A house with no bedroom count is counted as commercial space and left out. The number left out is listed below."
              vi="Nhà không ghi số phòng ngủ được xem là mặt bằng kinh doanh và không được tính. Số tin bị loại được ghi ở dưới."
            />
          </li>
          <li>
            <Bilingual
              en="An apartment or house posted by two different sellers counts once when their photos match."
              vi="Một căn hộ hoặc nhà nguyên căn do hai người khác nhau đăng chỉ được tính một lần khi ảnh của hai tin trùng nhau."
            />
          </li>
          <li><Tr text="Districts come from the listing's own district field. A listing naming two districts, or none we recognise, counts toward the city-wide figures only." /></li>
          <li>
            <Tr text="Minimum listings behind a published median" />: {MIN_CELL_N}. <Tr text="Below that the cell shows a dash and its count, never a median of a handful." />
          </li>
          <li><Tr text="The median is the middle asking rent; the middle half is the range between the 25th and 75th percentiles." /></li>
          <li>
            <Bilingual
              en="Nothing is trimmed: every listing inside the monthly band counts, however high or low its rent."
              vi="Không cắt bỏ số liệu nào: mọi tin nằm trong khoảng giá mỗi tháng đều được tính, dù giá cao hay thấp."
            />
          </li>
          {/* ⚠️ THE STEPS ARE THE CONSTANTS THE RULES ROUND WITH (rent-index.ts), never typed: the page
              rounds to DISPLAY_STEP_VND, ₫/m² and the CSV to ROUND_VND (rules v3). */}
          <li>
            <Bilingual
              en="Rents on this page are rounded to the nearest" // design-lint-allow: the copy word, not a radius class
              vi="Giá thuê trên trang này được làm tròn đến"
            />{' '}
            {money(DISPLAY_STEP_VND, locale)}
            <Bilingual en=", and rent per m² to the nearest" vi=", giá mỗi m² làm tròn đến" />{' '}
            {money(ROUND_VND, locale)}.{' '}
            <Bilingual en="The CSV gives each figure to the nearest" vi="Tệp CSV ghi mỗi số liệu làm tròn đến" />{' '}
            {money(ROUND_VND, locale)}.
          </li>
          <li>
            <Bilingual en="Rules version" vi="Quy tắc phiên bản" /> {RENT_INDEX_RULES_VERSION}.{' '}
            <Bilingual
              en="Figures are not comparable with snapshots made under earlier rules."
              vi="Số liệu không so sánh được với các lần tính theo quy tắc cũ."
            />
          </li>
          <li><Tr text="Districts 2 and 9 were merged into Thu Duc City in 2021, but many listings still use the old names. They get their own rows and are also counted in Thu Duc City, so the district rows do not add up to the city total." /></li>
          <li><Tr text="District names are the ones listings still carry: Vietnam replaced city districts with wards in July 2025, and the city now also covers the former Binh Duong and Ba Ria–Vung Tau provinces. A listing counts when its own city field says Ho Chi Minh City; one that names no district listed here counts toward the city-wide figures only." /></li>
          <li><Tr text="A district's listings page can show more listings than its row here: it also matches the free-text address, which this index does not." /></li>
        </ul>
        {index && (
          <>
            <h3 className="pt-3 text-base font-bold text-foreground"><Tr text="What was counted" /></h3>
            <ul className="space-y-1 text-sm">
              <li>{count(index.read, locale)} · <Tr text="rental listings read" /></li>
              <li>{count(index.used, locale)} · <Tr text="listings in the index" /></li>
              {EXCLUSIONS.map((k) => (
                <li key={k}>{count(index.excluded[k], locale)} · <ExclusionLabel k={k} /></li>
              ))}
              <li>{count(index.unassigned, locale)} · <Tr text="in the index without a recognised district (city-wide figures only)" /></li>
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
