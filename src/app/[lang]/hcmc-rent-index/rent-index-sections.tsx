import Link from 'next/link'
import { Tr } from '@/context/language-context'
import { ArrowRight } from '@/components/ui/icons'
import { formatMoneyFull, groupVnd, type MoneyLocale } from '@/lib/vnd'
import {
  MAX_AREA_M2, MAX_MONTHLY_VND, MAX_VND_PER_M2, MIN_AREA_M2, MIN_CELL_N, MIN_MONTHLY_VND, MIN_VND_PER_M2,
  RENT_TYPES, type ExclusionReason, type RentIndex, type RentType, type Stats,
} from '@/lib/rent-index'

/**
 * The visible half of /hcmc-rent-index. Server components only: every number here is rendered from the
 * one `RentIndex` the page loaded, and the copy goes through `<Tr>` with curated Vietnamese in
 * src/generated/vi-overrides.ts, so a Vietnamese reader gets Vietnamese in the first HTML.
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
 * ⚠️ ROUNDED FOR READING, EXACT IN THE CSV. A median of 15,437,500 ₫ claims a precision asking prices
 * do not have; the page shows 100,000 ₫ steps and the downloadable file keeps the computed integer.
 */
const shown = (n: number, locale: MoneyLocale) => money(Math.round(n / 100_000) * 100_000, locale)

/** The figures could not be read — say so, and never say there is no data. */
export function Unavailable() {
  return (
    <p className="mt-6 max-w-prose text-sm font-semibold text-body">
      <Tr text="The live figures could not be read just now. They come back within a few minutes; the method below is unchanged." />
    </p>
  )
}

export function Headline({ index, locale }: { index: RentIndex; locale: MoneyLocale }) {
  return (
    <section className="mt-8" aria-labelledby="city-wide">
      <h2 id="city-wide" className="h-section text-foreground mb-4">
        <Tr text="Median asking rent across the city" />
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {RENT_TYPES.map((t) => {
          const s = index.cityWide[t]
          return (
            <div key={t} className="rounded-2xl border border-border p-4">
              <p className="text-sm font-semibold text-muted-foreground"><TypeLabel t={t} /></p>
              {s.median !== null ? (
                <>
                  <p className="mt-1 text-2xl font-bold text-foreground">
                    {shown(s.median, locale)}<span className="text-sm font-semibold text-muted-foreground"> <Tr text="per month" /></span>
                  </p>
                  <p className="mt-1 text-xs text-body">
                    <Tr text="Middle half" />: {shown(s.p25!, locale)} – {shown(s.p75!, locale)}
                  </p>
                  {s.medianPerM2 !== null && (
                    <p className="text-xs text-body">{money(Math.round(s.medianPerM2 / 1_000) * 1_000, locale)} {PER_M2}</p>
                  )}
                </>
              ) : (
                <p className="mt-1 text-2xl font-bold text-muted-foreground">—</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">{count(s.n, locale)} <Tr text="listings" /></p>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Cell({ s, locale }: { s: Stats; locale: MoneyLocale }) {
  if (s.median === null) {
    return (
      <td className="py-2 pr-4 align-top">
        <span className="font-semibold text-muted-foreground">—</span>
        <span className="block text-2xs text-muted-foreground">{count(s.n, locale)} <Tr text="listings" /></span>
      </td>
    )
  }
  return (
    <td className="py-2 pr-4 align-top">
      <span className="block whitespace-nowrap font-semibold text-foreground">{shown(s.median, locale)}</span>
      <span className="block whitespace-nowrap text-2xs text-body">{shown(s.p25!, locale)} – {shown(s.p75!, locale)}</span>
      <span className="block text-2xs text-muted-foreground">{count(s.n, locale)} <Tr text="listings" /></span>
    </td>
  )
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
      {/* ⚠️ THE TABLE SCROLLS, THE PAGE DOES NOT. Four columns of full đồng amounts are wider than a
          phone; the first column stays readable as the scroll anchor. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="pb-2 pr-4 font-semibold"><Tr text="District" /></th>
              {RENT_TYPES.map((t) => (
                <th key={t} scope="col" className="pb-2 pr-4 font-semibold"><TypeLabel t={t} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {index.districts.map((d) => (
              <tr key={d.slug} className="border-t border-border">
                <th scope="row" className="min-w-[9rem] py-2 pr-4 text-left align-top font-semibold text-foreground">
                  {/* ⚠️ EVERY ROW HERE HAS ≥ 1 LISTING, AND /c/rentals/<slug> MATCHES A SUPERSET OF
                      THEM (the same curated spellings on `district` OR `location`), so the link can
                      never land on that page's 404. Its count is larger than this row's n for the same
                      reason — the methodology says so. */}
                  <Link href={`/c/rentals/${d.slug}`} className="text-accent-foreground hover:underline">
                    {lang === 'vi' ? d.name : d.nameEn}
                  </Link>
                  {d.slug === 'thu-duc' && (
                    <span className="block text-2xs font-normal text-muted-foreground"><Tr text="All of Thu Duc City, including listings still labelled District 2 or 9" /></span>
                  )}
                  {d.partOf && (
                    <span className="block text-2xs font-normal text-muted-foreground"><Tr text="Listings labelled with the former district name; also counted in Thu Duc City" /></span>
                  )}
                </th>
                {RENT_TYPES.map((t) => <Cell key={t} s={d.cells[t]} locale={locale} />)}
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

/** Literal `<Tr>`s, not a lookup table, so scripts/gen-ui-strings.mjs harvests them for the MT languages. */
const EXCLUSIONS: ExclusionReason[] = ['notResidential', 'notForRent', 'currency', 'unit', 'belowBand', 'aboveBand', 'crossPosted']
function ExclusionLabel({ k }: { k: ExclusionReason }) {
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
          <li><Tr text="An apartment or house listed by two different sellers with the same district, price and floor area counts once. Rooms are never merged: their round prices and sizes match too often by chance." /></li>
          <li><Tr text="Districts come from the listing's own district field. A listing naming two districts, or none we recognise, counts toward the city-wide figures only." /></li>
          <li>
            <Tr text="Minimum listings behind a published median" />: {MIN_CELL_N}. <Tr text="Below that the cell shows a dash and its count, never a median of a handful." />
          </li>
          <li><Tr text="The median is the middle asking rent; the middle half is the range between the 25th and 75th percentiles." /></li>
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
