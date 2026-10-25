import { Fragment } from 'react'
import Link from 'next/link'
import { ArrowRight } from '@/components/ui/icons'
import { formatMoneyFull } from '@/lib/vnd'
import { moneyText } from '@/lib/teach-guides/inline'
import { teachGuideLinks, teachHubLink } from '@/lib/teach-guides/site-links'
import { DISPLAY_STEP_VND, ROUND_VND, roundForDisplay, type ApartmentBand } from '@/lib/rent-index'
import {
  CITY_BANDS, DISTRICT_BANDS, TEACHER_COST_INDEX_CSV_PATH, TEACHER_COST_INDEX_GUIDES, TEACHER_COST_INDEX_NAME,
  TEACHER_COST_INDEX_PATH, cellFigures, editionMonth, editionNotes, editionPath, insuranceRateText, saigonDay, shareText,
  type CellFigures, type Edition, type Erratum, type RentCell,
} from '@/lib/teacher-cost-index'
import { CiteBox } from '@/app/[lang]/hcmc-rent-index/cite-box'

/**
 * The visible HCMC Teacher Cost & Pay Index — one view for the series page (the newest edition) and every edition page.
 * Server components only, and every figure is read from the FROZEN edition (src/lib/teacher-cost-index.ts): the stored
 * shares and what is left after rent, the stored cells and pay, never a recomputation.
 *
 * ⛔ LITERAL ENGLISH, NEVER `<Tr>`/`tr()`/`<Bilingual>` — on both language variants, until counsel answers whether
 * Vietnamese teacher-pay figures are labour-market information and a native reviewer writes the copy (d1-spec §11). A
 * `<Tr>` key would let the machine-translation layer and a later vi-overrides run print a Vietnamese pay sentence nobody
 * approved. So the whole `<main>` is English and says so — `lang="en"` on EVERY render, as the teach hub's text is
 * (seo-article.tsx `ArticleText`): the client sets `<html lang>` to the visitor's language, the nine machine-translated
 * ones included (language-context.tsx), and English inheriting "ko" is read aloud as Korean (opus, gate review). The
 * header and footer around it stay in the visitor's language. The page-test holds the en and vi renders of `<main>` to
 * the same text.
 * ⚠️ MONEY IN ENGLISH GROUPING ON BOTH VARIANTS ("6,600,000 đ"), because the sentences around it are English.
 * ⛔ No licensed-services word anywhere (CLAUDE.md, the edition split): the page-test sweeps the rendered text.
 */

/** The Rent Index's own English band labels (rent-index-sections.tsx BAND_LABEL), Studio first as it orders them. */
const BAND_LABEL: Record<ApartmentBand, string> = {
  studio: 'Studio',
  br1: '1 bedroom',
  br2: '2 bedrooms',
  br3plus: '3 or more bedrooms',
}

const money = (n: number) => formatMoneyFull(n, '₫', 'en')
/** ⚠️ ROUNDED FOR READING, AS THE RENT INDEX PAGE ROUNDS (`roundForDisplay`, imported); the CSV keeps the finer figure. */
const shown = (n: number) => money(roundForDisplay(n))
const count = (n: number) => n.toLocaleString('en-US')
/** "1 listing", "139 listings": a cell of one is common under the floor (District 3's 1- and 2-bedroom, 2026-10). */
const listings = (n: number) => `${count(n)} ${n === 1 ? 'listing' : 'listings'}`
/** "28,000,000–32,100,000 đ" — one currency mark at the end, as the guides print a range (inline.ts `moneyText`). */
const range = (lo: number, hi: number) => (hi > lo ? moneyText(lo, hi) : moneyText(lo))

/** What is left after rent across the two incomes — or that there is nothing left, never a negative range. */
function leftText([lo, hi]: readonly [number, number]): string {
  const [a, b] = [roundForDisplay(lo), roundForDisplay(hi)]
  if (b <= 0) return 'nothing: the rent asks more than the take-home pay'
  if (a <= 0) return `up to ${money(b)}, and nothing at the lower pay`
  // The range may break after its dash, never before its mark: a no-break space keeps "đ" on its number's line.
  return range(a, b).replace(/ đ$/, '\u00a0đ')
}

/** An hourly rate in the middle of the salary guide's full-time band (450,000–550,000 đ), to say what the salaries mean in hours. */
const EXAMPLE_HOURLY_VND = 500_000

/** The pay at each reference income, lowest take-home first. */
const payOf = (e: Edition) => [...e.model.takeHome].sort((a, b) => a.takeHomeVnd - b.takeHomeVnd)

/** The answer first (d1-spec §5): the one-bedroom, as the teach hub's rent line quotes it — then the studio. */
function Lede({ e }: { e: Edition }) {
  const pay = payOf(e)
  const payText = range(pay[0].takeHomeVnd, pay[pay.length - 1].takeHomeVnd)
  const br1 = cellFigures(e, 'city', 'all', 'br1')
  const br1n = e.rent.cells.find((c) => c.scope === 'city' && c.band === 'br1')?.n ?? 0
  const studio = cellFigures(e, 'city', 'all', 'studio')
  return (
    <p className="mt-4 max-w-prose text-base leading-relaxed text-body">
      {br1 ? (
        <>
          In the {editionMonth(e.edition)} edition, a median one-bedroom apartment in Ho Chi Minh City asks{' '}
          <strong className="font-semibold text-foreground whitespace-nowrap">{shown(br1.cell.medianVnd)}</strong> a month (
          {listings(br1.cell.n)}): <strong className="font-semibold text-foreground">{shareText(br1.shareWhole)}</strong> of a
          full-time language-centre teacher&apos;s modelled take-home pay of <span className="whitespace-nowrap">{payText}</span> a
          month.
        </>
      ) : (
        <>
          In the {editionMonth(e.edition)} edition too few one-bedroom apartments were listed in Ho Chi Minh City to publish a
          one-bedroom figure ({listings(br1n)}, against a floor of {e.rent.minCellN}). A full-time language-centre
          teacher&apos;s modelled take-home pay is <span className="whitespace-nowrap">{payText}</span> a month.
        </>
      )}
      {studio && (
        <>
          {' '}A studio asks <strong className="font-semibold text-foreground whitespace-nowrap">{shown(studio.cell.medianVnd)}</strong> a
          month ({listings(studio.cell.n)}): {shareText(studio.shareWhole)} of that pay.
        </>
      )}
    </p>
  )
}

/** Four figures on one ruled band — the Rent Index's band row and its measured four-up sizes (rent-index-sections.tsx). */
const BAND_ROW_FOUR = 'grid grid-cols-1 border-t border-border md:grid-cols-4 md:divide-x md:divide-border max-md:divide-y max-md:divide-border'

function ShareFigure({ label, n, f }: { label: string; n: number; f: CellFigures | null }) {
  return (
    <div className="min-w-0 py-4 md:px-4 md:first:pl-0">
      <p className="text-sm font-semibold text-muted-foreground">{label}</p>
      {f ? (
        <>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground md:text-xl lg:text-2xl xl:text-3xl">
            {shareText(f.shareWhole)} <span className="whitespace-nowrap text-sm font-semibold text-muted-foreground">of take-home pay</span>
          </p>
          <p className="mt-1 text-xs text-body">
            Median rent <span className="whitespace-nowrap">{shown(f.cell.medianVnd)}</span> a month
          </p>
          {/* No nowrap on the range: at md's four columns "28,000,000–32,100,000 đ" is about the column's width, so it may
              break after its dash (a line-break opportunity in Unicode) rather than run into the next figure. */}
          <p className="text-xs text-body">Left after rent: {leftText(f.leftAfterRentVnd)}</p>
        </>
      ) : (
        <p className="mt-1 text-3xl font-bold text-muted-foreground md:text-xl lg:text-2xl xl:text-3xl">—</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">{listings(n)}</p>
    </div>
  )
}

function CityFigures({ e }: { e: Edition }) {
  const pay = payOf(e)
  const [low, high] = [pay[0], pay[pay.length - 1]]
  return (
    <section className="mt-8" aria-labelledby="city-wide">
      <h2 id="city-wide" className="h-section text-foreground mb-1">Rent as a share of take-home pay, city-wide</h2>
      <p className="mb-4 max-w-prose text-sm text-muted-foreground">
        The median monthly asking rent of an apartment in Ho Chi Minh City, divided by a full-time language-centre teacher&apos;s
        modelled take-home pay: the lower share at {money(high.grossVnd)} gross a month ({money(high.takeHomeVnd)} take-home), the
        higher at {money(low.grossVnd)} ({money(low.takeHomeVnd)}). A dash means fewer listings than the publishing threshold.
      </p>
      <div className={BAND_ROW_FOUR}>
        {CITY_BANDS.map((b) => (
          <ShareFigure key={b} label={BAND_LABEL[b]} n={e.rent.cells.find((c) => c.scope === 'city' && c.band === b)?.n ?? 0} f={cellFigures(e, 'city', 'all', b)} />
        ))}
      </div>
    </section>
  )
}

/** One district × band cell: the share, the median and the count — or a dash and the count (the Rent Index's `Cell`). */
function ShareCell({ cell, f, heading }: { cell: RentCell | undefined; f: CellFigures | null; heading: string }) {
  const label = <span className="block text-2xs font-semibold text-muted-foreground md:hidden">{heading}</span>
  const listed = <span className="block text-2xs tabular-nums text-muted-foreground">{listings(cell?.n ?? 0)}</span>
  if (!f) {
    return (
      <td className="min-w-0 align-top md:py-2 md:pl-4 md:text-right">
        {label}
        <span className="block font-semibold text-muted-foreground">—</span>
        {listed}
      </td>
    )
  }
  return (
    <td className="min-w-0 align-top md:py-2 md:pl-4 md:text-right">
      {label}
      <span className="block whitespace-nowrap font-bold tabular-nums text-foreground">{shareText(f.shareWhole)}</span>
      <span className="block whitespace-nowrap text-2xs tabular-nums text-body">{shown(f.cell.medianVnd)}</span>
      {listed}
    </td>
  )
}

/** Thủ Đức is the union of its own rows and Districts 2 and 9, so each of those rows says so (as on the Rent Index). */
function DistrictNote({ slug, partOf }: { slug: string; partOf: string | null }) {
  if (slug === 'thu-duc') return <span className="block text-2xs font-normal text-muted-foreground">All of Thu Duc City, including listings still labelled District 2 or 9</span>
  if (partOf) return <span className="block text-2xs font-normal text-muted-foreground">Listings labelled with the former district name; also counted in Thu Duc City</span>
  return null
}

/**
 * By district: Studio, 1 and 2 bedrooms. ⚠️ ONE TABLE AT EVERY WIDTH, RESTYLED BELOW md like the Rent Index's (C-RENT-
 * INDEX): each district becomes a heading over a 3-up grid of labelled cells, never a sideways scroller. A district with
 * no listing in any of the three bands is left out; one with any keeps its row, dashes and counts included.
 * ⚠️ NAMES ONLY, NO LINKS: the Rent Index's district table links each row at the indexing floor.
 */
function DistrictTable({ e }: { e: Edition }) {
  const slugs = [...new Set(e.rent.cells.filter((c) => c.scope === 'district').map((c) => c.districtSlug))]
  const rows = slugs
    .map((slug) => ({ slug, cells: e.rent.cells.filter((c) => c.scope === 'district' && c.districtSlug === slug) }))
    .filter((d) => d.cells.some((c) => c.n > 0))
  if (rows.length === 0) return null
  return (
    <section className="mt-12" aria-labelledby="by-district">
      <h2 id="by-district" className="h-section text-foreground mb-1">By district</h2>
      <p className="mb-4 max-w-prose text-sm text-muted-foreground">
        Each cell shows the rent as a share of the same take-home pay, the median monthly asking rent and how many listings it is
        computed from. A dash means fewer listings than the publishing threshold.
      </p>
      <div className="md:overflow-x-auto">
        <table className="w-full text-sm max-md:block md:min-w-[36rem]">
          <thead className="max-md:sr-only">
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="pb-2 pr-4 font-semibold">District</th>
              {DISTRICT_BANDS.map((b) => (
                <th key={b} scope="col" className="pb-2 pl-4 text-right font-semibold">{BAND_LABEL[b]}</th>
              ))}
            </tr>
          </thead>
          <tbody className="max-md:block">
            {rows.map((d) => (
              <tr key={d.slug} className="border-t border-border max-md:grid max-md:grid-cols-3 max-md:gap-x-3 max-md:py-3">
                <th scope="row" className="text-left align-top font-semibold text-foreground max-md:col-span-3 max-md:pb-2 md:min-w-[9rem] md:py-2 md:pr-4">
                  {d.cells[0].districtName}
                  <DistrictNote slug={d.slug} partOf={d.cells[0].partOf} />
                </th>
                {DISTRICT_BANDS.map((b) => (
                  <ShareCell key={b} heading={BAND_LABEL[b]} cell={d.cells.find((c) => c.band === b)} f={cellFigures(e, 'district', d.slug, b)} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * How it is calculated — rendered from the edition's own inputs (its Rent Index snapshot and rules version, its pay
 * model), so the method printed beside a frozen edition is the one that made it, whatever the code says today.
 * ⚠️ ONE FIGURE HERE IS DERIVED, NOT STORED: the taxable income, gross − insurance − the personal deduction, all three
 * stored with the edition — `takeHome`'s own formula, which the recompute test holds every stored edition to. A model
 * that taxes differently is a new MODEL_VERSION, and this line must then follow the edition's version (opus, gate review).
 */
function Method({ e }: { e: Edition }) {
  const m = e.model.inputs
  const pay = [...e.model.takeHome].sort((a, b) => a.grossVnd - b.grossVnd)
  const brackets = m.taxBrackets.map(([top, pct], i) =>
    top === null ? `${pct}% above` : i === 0 ? `${pct}% up to ${money(top)}` : `${pct}% to ${money(top)}`)
  const salary = teachGuideLinks([TEACHER_COST_INDEX_GUIDES[0]])[0]
  // What the example salaries mean in hours, at the middle of the guide's full-time rates (450,000–550,000 đ an hour).
  const hours = pay.map((t) => Math.round(t.grossVnd / EXAMPLE_HOURLY_VND))
  // ⚠️ ONE STEP SMALLER AND TIGHTER BELOW sm: at 320px the table at text-sm ran 12px into the page gutter (measured offline,
  // Chromium, 2026-10-21); from 360px up it fit either way. The figures never wrap.
  const td = 'py-2 pl-3 text-right tabular-nums whitespace-nowrap sm:pl-4'
  return (
    <section className="mt-12 max-w-3xl" aria-labelledby="method">
      <h2 id="method" className="h-section text-foreground mb-3">How it is calculated</h2>
      <div className="space-y-3 text-base leading-relaxed text-body">
        <p>
          Each figure is a median asking rent divided by a modelled take-home pay. Both halves are stated in full below, and the
          edition is frozen: its figures never change after it is published.
        </p>
        <h3 className="pt-3 text-base font-bold text-foreground">The rents</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            The median monthly asking rent of apartments for rent in Ho Chi Minh City on eno.vn, from the{' '}
            <Link href="/hcmc-rent-index#method" className="font-semibold text-accent-foreground hover:underline">HCMC Rent Index</Link>{' '}
            snapshot of {saigonDay(e.rent.snapshotUtc)} (its rules version {e.rent.rulesVersion}). The Rent Index&apos;s method names
            the sources of each snapshot and every rule behind its medians.
          </li>
          <li>
            Studios and 1, 2 and 3 or more bedrooms city-wide; studios, 1 and 2 bedrooms by district. A studio is an apartment
            listed as Studio or Duplex with 1 bedroom, or with Studio as its number of bedrooms. Houses and rooms are not in this
            index.
          </li>
          <li>
            Minimum listings behind a published median: {e.rent.minCellN}, checked here as well as on the Rent Index. Below that a
            cell shows a dash and its count.
          </li>
          <li>
            District names are the ones listings still carry. Districts 2 and 9 also count in Thu Duc City, so the district rows do
            not add up to the city.
          </li>
        </ul>
        <h3 className="pt-3 text-base font-bold text-foreground">The pay</h3>
        <p>
          Modelled, not reported pay: what a full-time language-centre teacher keeps from two example salaries,{' '}
          {pay.map((t) => money(t.grossVnd)).join(' and ')} gross a month — the two 12-month-contract rows of the take-home table
          in{' '}
          {salary ? (
            <Link href={salary.href} className="font-semibold text-accent-foreground hover:underline">{salary.label}</Link>
          ) : (
            'our English teacher salary guide'
          )}
          , about {hours[0] === hours[hours.length - 1] ? hours[0] : `${hours[0]}–${hours[hours.length - 1]}`} teaching hours a
          month at {money(EXAMPLE_HOURLY_VND)} an hour. Assumptions: {m.assumptions}.
        </p>
        <p>
          Employee social insurance is {insuranceRateText(m)} of salary ({m.insurancePerMille.pension / 10}% pension and{' '}
          {m.insurancePerMille.health / 10}% health insurance), on salary up to {money(m.insuranceSalaryCapVnd)} a month. Income
          tax follows {m.law}: after the personal deduction of {money(m.personalDeductionVnd)} a month, {brackets.join(', ')}.
          Pay model version {e.model.version}.
        </p>
        <div className="md:overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="pb-2 pr-3 font-semibold sm:pr-4"><span className="sr-only">Step</span></th>
                {pay.map((t) => (
                  <th key={t.grossVnd} scope="col" className="pb-2 pl-3 text-right font-semibold sm:pl-4">{money(t.grossVnd)} gross</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border">
                <th scope="row" className="py-2 pr-3 text-left font-semibold text-foreground sm:pr-4">Social insurance, {insuranceRateText(m)}</th>
                {pay.map((t) => <td key={t.grossVnd} className={td}>{money(t.insuranceVnd)}</td>)}
              </tr>
              <tr className="border-t border-border">
                <th scope="row" className="py-2 pr-3 text-left font-semibold text-foreground sm:pr-4">Taxable income</th>
                {pay.map((t) => <td key={t.grossVnd} className={td}>{money(Math.max(0, t.grossVnd - t.insuranceVnd - m.personalDeductionVnd))}</td>)}
              </tr>
              <tr className="border-t border-border">
                <th scope="row" className="py-2 pr-3 text-left font-semibold text-foreground sm:pr-4">Income tax</th>
                {pay.map((t) => <td key={t.grossVnd} className={td}>{money(t.taxVnd)}</td>)}
              </tr>
              <tr className="border-t border-border">
                <th scope="row" className="py-2 pr-3 text-left font-bold text-foreground sm:pr-4">Take-home pay</th>
                {pay.map((t) => <td key={t.grossVnd} className={`${td} font-bold text-foreground`}>{money(t.takeHomeVnd)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
        <h3 className="pt-3 text-base font-bold text-foreground">Rounding</h3>
        <p>
          On this page each share is a whole percentage, half up from the exact share, and rents and what is left after rent are
          given to the nearest {money(DISPLAY_STEP_VND)}. The CSV gives each share to 0.1 percentage point, each rent to the
          nearest {money(ROUND_VND)}, and take-home pay and what is left after rent to the đồng.
        </p>
        <h3 className="pt-3 text-base font-bold text-foreground">What the figures are not</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>Asking rents, not signed leases: tenants often agree a lower rent, and a long lease or several months paid up front usually earns a discount.</li>
          <li>Modelled pay, not anyone&apos;s payslip: hours, rates and contracts vary. A non-resident pays a flat 20% income tax with no deductions, social insurance is not compulsory on a contract under 12 months, and a registered dependant lowers the tax.</li>
          <li>One city and one kind of job: a full-time load at a language centre in Ho Chi Minh City.</li>
        </ul>
      </div>
    </section>
  )
}

/**
 * Every edition, newest first, each linked and dated by its own rents; the CSV holds them all. ⚠️ A MONTHLY CADENCE, NEVER
 * A DAY: monthly is the owner's decision 4, but nothing enforces the 1st (the runbook aims for it), so the page never
 * names one (codex, gate review) and each edition states its rents' day instead. ⚠️ AND NEVER "THAT DAY'S" RENT INDEX: the
 * freeze reads the latest daily snapshot, from the edition's own month (planEdition) — which may be the day before the
 * freeze, not its day (verifier round).
 */
function Editions({ e, editions }: { e: Edition; editions: readonly Edition[] }) {
  return (
    <section className="mt-12 max-w-3xl" aria-labelledby="editions">
      <h2 id="editions" className="h-section text-foreground mb-3">Editions</h2>
      <p className="text-base leading-relaxed text-body">
        A new edition is frozen once a month from the Rent Index&apos;s latest snapshot, and each one below names the day its rents are from.
        An edition&apos;s figures never change after it is published: a correction is printed beside it and in the CSV. Figures
        from editions under different Rent Index rules or a different pay model are not comparable, and the edition says so.
      </p>
      <ul className="mt-4 divide-y divide-border border-y border-border">
        {editions.map((x, i) => (
          <li key={x.edition} className="py-3 text-sm text-body">
            {x.edition === e.edition ? (
              <span className="font-semibold text-foreground">{editionMonth(x.edition)}</span>
            ) : (
              <Link href={i === 0 ? TEACHER_COST_INDEX_PATH : editionPath(x.edition)} className="font-semibold text-accent-foreground hover:underline">
                {editionMonth(x.edition)}
              </Link>
            )}
            {' · '}rents of {saigonDay(x.rent.snapshotUtc)} · Rent Index rules version {x.rent.rulesVersion} · pay model version {x.model.version}
            {i === 0 && ' · latest'}
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <a href={TEACHER_COST_INDEX_CSV_PATH} download className="inline-flex items-center gap-1 text-sm font-semibold text-accent-foreground hover:underline">
          Download every edition (CSV) <ArrowRight className="h-4 w-4" />
        </a>
      </div>
    </section>
  )
}

/**
 * The page's own notes: a superseded edition points at the newest; then the edition's series break, note, the sources of
 * its rents and its errata (`editionNotes`). ⚠️ THE SOURCES SIT HERE, BY THE HEADLINE, NOT DOWN IN THE METHOD: a headline
 * that may rest on few sources says what its rents are where it is read (d1-spec §16.2; verifier round).
 */
function EditionNotes({ e, latest, errata }: { e: Edition; latest: Edition; errata: readonly Erratum[] }) {
  const notes = editionNotes(e, errata)
  if (e.edition === latest.edition && notes.length === 0) return null
  return (
    <div className="mt-4 max-w-prose space-y-2 rounded-xl bg-tint p-4 text-sm leading-relaxed text-body">
      {e.edition !== latest.edition && (
        <p className="font-semibold text-foreground">
          This is the {editionMonth(e.edition)} edition. The newest is the{' '}
          <Link href={TEACHER_COST_INDEX_PATH} className="text-accent-foreground hover:underline">{editionMonth(latest.edition)} edition</Link>.
        </p>
      )}
      {notes.map((n) => <p key={n}>{n}</p>)}
    </div>
  )
}

export function TeacherCostIndexMain({ e, editions, errata, origin, siteName, series }: {
  /** The edition shown: the newest on the series page. */
  e: Edition
  /** Every edition, newest first (teacher-cost-index-editions.ts EDITIONS). */
  editions: readonly Edition[]
  errata: readonly Erratum[]
  origin: string
  siteName: string
  series: boolean
}) {
  const month = editionMonth(e.edition)
  /**
   * ⚠️ THE CITATION NAMES THE EDITION'S OWN URL, ON THE SERIES PAGE TOO (d1-spec §8): a cited figure must still be at the
   * address a reader follows next year, and the series page will show a newer edition by then. A BRAND ANCHOR, never a
   * keyword one, and English on both variants (the Rent Index's precedent: it is pasted into somebody else's page).
   */
  const url = `${origin}${editionPath(e.edition)}`
  const citation = `${siteName} (${e.edition.slice(0, 4)}). ${TEACHER_COST_INDEX_NAME}, ${month} edition. ${url}`
  const htmlSnippet = `${TEACHER_COST_INDEX_NAME.replace(/&/g, '&amp;')}, ${month} (<a href="${url}">${siteName}</a>)`
  const guides = teachGuideLinks(TEACHER_COST_INDEX_GUIDES)
  const hub = teachHubLink()
  const related: { href: string; label: string }[] = [
    { href: '/hcmc-rent-index', label: 'HCMC Rent Index' },
    ...guides.map((g) => ({ href: g.href, label: g.label })),
    ...(hub ? [{ href: hub.href, label: hub.label }] : []),
  ]
  return (
    <main id="main" tabIndex={-1} lang="en" className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-10 pb-16">
      <p className="eyebrow text-accent-foreground mb-2">Data · Ho Chi Minh City</p>
      <h1 className="h-display text-foreground">Ho Chi Minh City Teacher Cost &amp; Pay Index{series ? '' : `, ${month}`}</h1>
      <Lede e={e} />
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>{month} edition · rents of {saigonDay(e.rent.snapshotUtc)}</span>
        {/* The cite box sits at the foot of the page; this puts it one tap from the top, as on the Rent Index. */}
        <a href="#cite" className="font-semibold text-accent-foreground hover:underline">Cite or link to this data</a>
      </p>
      <EditionNotes e={e} latest={editions[0]} errata={errata} />
      <CityFigures e={e} />
      <DistrictTable e={e} />
      <Method e={e} />
      <Editions e={e} editions={editions} />
      <CiteBox english url={url} htmlSnippet={htmlSnippet} citation={citation} />
      <p className="mt-12 max-w-3xl text-sm text-body">
        {related.map((r, i) => (
          <Fragment key={r.href}>
            {i > 0 && ' · '}
            <Link href={r.href} className="font-semibold text-accent-foreground hover:underline">{r.label}</Link>
          </Fragment>
        ))}
      </p>
    </main>
  )
}
