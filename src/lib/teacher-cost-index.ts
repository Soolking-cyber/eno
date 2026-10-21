import { z } from 'zod'
import {
  APARTMENT_BANDS, BAND_CSV_TYPE, CSV_COLUMNS as RENT_INDEX_CSV_COLUMNS, MIN_CELL_N, RENT_INDEX_RULES_VERSION, csvField,
  type ApartmentBand,
} from '@/lib/rent-index'

/**
 * THE HCMC TEACHER COST & PAY INDEX (D1; owner decisions 2026-10-21, "resolve with recommended") — what a median Ho Chi
 * Minh City apartment asks, as a share of a full-time language-centre teacher's MODELLED take-home pay. Pure: a Rent
 * Index CSV in, a frozen edition out (`planEdition`, which scripts/teacher-cost-index-freeze.ts writes once a month);
 * an edition in, its figures, its CSV rows (`teacherCostIndexCsv`) and the Dataset JSON-LD out.
 *
 * ⛔ AN EDITION IS FROZEN, NEVER RECOMPUTED. A cited figure must never change under its URL, so an edition file
 * (src/content/teacher-cost-index/YYYY-MM.json) holds its inputs — the Rent Index cells and the pay model — AND its
 * outputs, and the page and the CSV print the STORED outputs: a later change to the arithmetic below cannot reach a
 * published edition. teacher-cost-index.test.ts recomputes every stored edition from its stored inputs, so a hand edit
 * shows. A correction is an erratum (errata.json, append-only), printed beside the edition — never an edit to it.
 * ⛔ NO DATABASE AND NO PERSON. The rents are the Rent Index's published aggregates (n ≥ MIN_CELL_N, checked again
 * here) and the pay is arithmetic on two example salaries under the law: no teacher profile, message or job advert is
 * read, the edition schema is strict (so no other dimension — nationality least of all — can ride along), and the
 * import-boundary test holds this module and its data to that.
 * ⛔ MARKETPLACE ONLY, AND NO LICENSED-SERVICES WORD in any string here, in the CSV or in the JSON-LD (CLAUDE.md, the
 * edition split): the test sweeps all three with the teach guides' vocabulary rule (src/test/edition-words.ts).
 * ⚠️ ENGLISH ONLY UNTIL COUNSEL ANSWERS (d1-spec §11): Vietnamese teacher-pay figures may be labour-market information
 * (Law 74/2025 Art. 20(1)(d)), so nothing here has a Vietnamese form and the page prints the same English on both
 * language variants.
 */

export const TEACHER_COST_INDEX_PATH = '/hcmc-teacher-cost-pay-index'
export const TEACHER_COST_INDEX_CSV_PATH = `${TEACHER_COST_INDEX_PATH}.csv`
export const TEACHER_COST_INDEX_NAME = 'HCMC Teacher Cost & Pay Index'
export const editionPath = (id: string) => `${TEACHER_COST_INDEX_PATH}/${id}`

/** The one input: the Rent Index's own file, read by the freeze script once a month — never at build or render time. */
export const RENT_INDEX_CSV_URL = 'https://eno.vn/hcmc-rent-index.csv'

/** The two guides the index restates and links back to: their "Data" line (teach-guide-body.tsx) and the page's links. */
export const TEACHER_COST_INDEX_GUIDES = ['english-teacher-salary-in-vietnam', 'cost-of-living-in-ho-chi-minh-city-for-teachers'] as const

// ── The pay model ──────────────────────────────────────────────────────────────────────────────────────────────

export type ModelInputs = {
  readonly year: number
  readonly law: string
  readonly assumptions: string
  readonly referenceGrossVnd: readonly number[]
  readonly insurancePerMille: { readonly pension: number; readonly health: number }
  readonly insuranceSalaryCapVnd: number
  readonly personalDeductionVnd: number
  readonly taxBrackets: readonly (readonly [number | null, number])[]
}

/**
 * ⛔ THE SALARY GUIDE'S MODEL, UNCHANGED — the guide (src/content/teach-in-vietnam/english-teacher-salary-in-vietnam.json,
 * section `gross-to-net`) is the source of truth, and this file never edits it (an edit voids its review digest).
 * teacher-cost-index.test.ts reads the guide's take-home table and fails the day the two disagree: its two "12-month
 * labour contract" rows (insurance, tax, take-home) and its row above the insurance cap.
 * ⚠️ BUMP MODEL_VERSION WHEN ANY INPUT MOVES (a new tax scale; the insurance cap moves with the base salary): the
 * fingerprint test pins the two together, the next freeze then stops as a series break (`seriesBreaks`), and every
 * frozen edition keeps the inputs it was computed with.
 */
export const MODEL_VERSION = 1
export const MODEL_INPUTS: ModelInputs = {
  year: 2026,
  law: 'PIT Law 109/2025/QH15',
  assumptions: 'tax resident, 12-month labour contract, no dependants',
  // The guide's two "12-month labour contract" rows: about 80–90 teaching hours a month at 500,000 đ an hour, inside its
  // full-time band (78–95 hours at 450,000–550,000 đ).
  referenceGrossVnd: [40_000_000, 45_000_000],
  // The employee's share on a labour contract of 12 months or more, per mille so the arithmetic stays whole: 8% pension
  // plus 1.5% health insurance.
  insurancePerMille: { pension: 80, health: 15 },
  // Contributions stop at this monthly salary from 1 July 2026. It does not bind at the two reference incomes.
  insuranceSalaryCapVnd: 50_600_000,
  // The resident's personal deduction a month, before the scale; no dependants.
  personalDeductionVnd: 15_500_000,
  // The resident monthly scale: [top of the bracket, rate %], the last one open-ended.
  taxBrackets: [[10_000_000, 5], [30_000_000, 10], [60_000_000, 20], [100_000_000, 30], [null, 35]],
}

export type TakeHome = { grossVnd: number; insuranceVnd: number; taxVnd: number; takeHomeVnd: number }

/** Monthly take-home pay under the model: gross − employee insurance − income tax, whole đồng. */
export function takeHome(grossVnd: number, inputs: ModelInputs = MODEL_INPUTS): TakeHome {
  const perMille = inputs.insurancePerMille.pension + inputs.insurancePerMille.health
  const insuranceVnd = Math.round((Math.min(grossVnd, inputs.insuranceSalaryCapVnd) * perMille) / 1000)
  const taxable = Math.max(0, grossVnd - insuranceVnd - inputs.personalDeductionVnd)
  let tax = 0
  let below = 0
  for (const [top, pct] of inputs.taxBrackets) {
    const upTo = top === null ? taxable : Math.min(taxable, top)
    if (upTo > below) tax += ((upTo - below) * pct) / 100
    if (top === null || taxable <= top) break
    below = top
  }
  const taxVnd = Math.round(tax)
  return { grossVnd, insuranceVnd, taxVnd, takeHomeVnd: grossVnd - insuranceVnd - taxVnd }
}

/** The insurance rate as printed: "9.5%". */
export const insuranceRateText = (inputs: ModelInputs) =>
  `${(inputs.insurancePerMille.pension + inputs.insurancePerMille.health) / 10}%`

/**
 * ⚠️ HALF UP, IN WHOLE NUMBERS — never `Math.round` on a float share: 16.5 as a float can be 16.4999…, and the page and
 * the CSV must each round one way (d1-spec §2.4). `num / den` is the exact share; both are whole đồng × a power of ten.
 */
const halfUp = (num: number, den: number) => Math.floor((2 * num + den) / (2 * den))
/** The page's share: whole percent, half up. */
export const sharePctWhole = (rentVnd: number, payVnd: number) => halfUp(rentVnd * 100, payVnd)
/** The CSV's share: to 0.1 percentage point, half up. */
export const sharePct = (rentVnd: number, payVnd: number) => halfUp(rentVnd * 1_000, payVnd) / 10

// ── The edition ────────────────────────────────────────────────────────────────────────────────────────────────

const EDITION_ID = /^\d{4}-(0[1-9]|1[0-2])$/
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
/**
 * ⛔ THE RENT INDEX'S OWN SOURCE LABELS AND NOTHING ELSE (rent-index-sections.tsx `SourceLabel`, its English): members,
 * or an import or an official partner — with its name, or bare as the Rent Index prints a nameless one — joined by " · ".
 * Names only, never a count (owner, 2026-09-27: no figure per source), so "GoPlus (2,605 listings)" is refused while a
 * name may still hold a digit ("99.co" — opus, gate review). Should the Rent Index reword a label, a freeze is refused
 * until this learns the new words, as a new rules version is.
 */
const SOURCE_KIND = "(?:listings imported from that site|an official eno\\.vn partner['’]s own listings)"
const SOURCE_LABEL = new RegExp(`^(?:listings posted by eno\\.vn members|${SOURCE_KIND}|[^()·]+ \\(${SOURCE_KIND}\\))$`)
export const isSourcesLine = (s: string) => s.split(' · ').every((part) => SOURCE_LABEL.test(part))
const scopeSchema = z.enum(['city', 'district'])
const bandSchema = z.enum(APARTMENT_BANDS)

/**
 * ⛔ EVERY OBJECT IS STRICT. An unknown key is a refusal, not a pass-through: the edition carries rents by district and
 * band and pay by reference income, and nothing else can be added to it by accident — no nationality, no person, no
 * per-source figure (owner, 2026-09-27: the Rent Index publishes none).
 */
const rentCellSchema = z.strictObject({
  scope: scopeSchema,
  /** 'all' for the city row, as in the Rent Index CSV. */
  districtSlug: z.string().regex(SLUG),
  /** The Rent Index CSV's own (English) district name — the legacy names listings still carry. */
  districtName: z.string().min(1),
  partOf: z.string().regex(SLUG).nullable(),
  band: bandSchema,
  n: z.number().int().nonnegative(),
  /** The Rent Index median, whole thousands of đồng; null under the floor (MIN_CELL_N), however the file put it. */
  medianVnd: z.number().int().positive().nullable(),
})
export type RentCell = z.infer<typeof rentCellSchema>

const modelInputsSchema = z.strictObject({
  year: z.number().int().min(2025),
  law: z.string().min(1),
  assumptions: z.string().min(1),
  referenceGrossVnd: z.array(z.number().int().positive()).min(1),
  insurancePerMille: z.strictObject({ pension: z.number().int().nonnegative(), health: z.number().int().nonnegative() }),
  insuranceSalaryCapVnd: z.number().int().positive(),
  personalDeductionVnd: z.number().int().nonnegative(),
  taxBrackets: z.array(z.tuple([z.number().int().positive().nullable(), z.number().nonnegative()])).min(1),
})

const takeHomeSchema = z.strictObject({
  grossVnd: z.number().int().positive(),
  insuranceVnd: z.number().int().nonnegative(),
  taxVnd: z.number().int().nonnegative(),
  takeHomeVnd: z.number().int().positive(),
})

/** One published cell at one reference income. A cell under the floor has none. */
const outputSchema = z.strictObject({
  scope: scopeSchema,
  districtSlug: z.string().regex(SLUG),
  band: bandSchema,
  grossVnd: z.number().int().positive(),
  /** The CSV's share, 0.1 percentage point. */
  sharePct: z.number().nonnegative(),
  /** The page's share, whole percent — rounded from the exact share, never from `sharePct` (no double rounding). */
  sharePctWhole: z.number().int().nonnegative(),
  /** Take-home minus the median, whole đồng; negative when the rent asks more than the pay. */
  leftAfterRentVnd: z.number().int(),
})
export type Output = z.infer<typeof outputSchema>

export const editionSchema = z.strictObject({
  /** YYYY-MM: the month of the freeze in Ho Chi Minh City (`editionIdAt`). */
  edition: z.string().regex(EDITION_ID),
  frozenAt: z.iso.datetime(),
  /** Written once, at the freeze (`--note`): what a reader of this edition must know — the series start, a known gap. */
  note: z.string().min(1).nullable(),
  /** Why figures across this edition are not comparable with the one before (`--series-break`, when a guard stopped it). */
  seriesBreak: z.string().min(1).nullable(),
  rent: z.strictObject({
    source: z.literal(RENT_INDEX_CSV_URL),
    /** The fetched file, byte for byte — so anyone holding a copy can prove it is the one this edition was frozen from. */
    csvSha256: z.string().regex(/^[0-9a-f]{64}$/),
    snapshotUtc: z.iso.datetime(),
    rulesVersion: z.number().int().positive(),
    /**
     * WHAT THE RENTS ARE (d1-spec §2.1, §16.2): the snapshot's sources in the Rent Index's own words — its method's
     * "Sources in this snapshot" line, which its CSV does not carry — given at the freeze (`--sources`) and printed
     * beside the edition and in its CSV note (`editionNotes`). ⛔ THE RENT INDEX'S LABELS ONLY (`isSourcesLine`): never a
     * count per source. Optional only for a dry run's plan: every committed edition carries it (teacher-cost-index.test.ts).
     */
    sources: z.string().min(1).max(1_000).refine(isSourcesLine, 'not the Rent Index’s "Sources in this snapshot" labels').optional(),
    /** The floor applied at the freeze (MIN_CELL_N then), kept with the edition like every other input. */
    minCellN: z.number().int().positive(),
    cells: z.array(rentCellSchema).min(1),
  }),
  model: z.strictObject({
    version: z.number().int().positive(),
    inputs: modelInputsSchema,
    takeHome: z.array(takeHomeSchema).min(1),
  }),
  outputs: z.array(outputSchema),
})
export type Edition = z.infer<typeof editionSchema>

/** A correction to a frozen edition, append-only (src/content/teacher-cost-index/errata.json): printed beside it, in its CSV note. */
export const erratumSchema = z.strictObject({
  edition: z.string().regex(EDITION_ID),
  /**
   * When it was added, a UTC time like `frozenAt` — not a day: the sitemap dates the edition's page by the later of the
   * two, and a bare day sorts before a freeze made the same day, so a same-day erratum never moved it (opus, gate review).
   */
  at: z.iso.datetime(),
  text: z.string().min(1),
})
export type Erratum = z.infer<typeof erratumSchema>

/** Newest first — the order the page lists editions in and `EDITIONS` holds them. */
export const newestFirst = (a: { edition: string }, b: { edition: string }) => (a.edition < b.edition ? 1 : a.edition > b.edition ? -1 : 0)

/**
 * The bands the index publishes, in the Rent Index's own order (Studio first, rules v5): every band city-wide; Studio, 1
 * and 2 bedrooms by district — 3+ is too thin to say anything district by district (d1-spec §1).
 * ⚠️ NOT the all-sizes apartment median: it measures the size mix (Rent Index rule R-d), not what a flat costs.
 */
export const CITY_BANDS: readonly ApartmentBand[] = APARTMENT_BANDS
export const DISTRICT_BANDS: readonly ApartmentBand[] = APARTMENT_BANDS.filter((b) => b !== 'br3plus')

/** ⛔ PUBLISHED ONLY AT THE FLOOR, CHECKED AGAIN HERE, as the Rent Index page's `publishable` does — never trust one file. */
export const publishable = (c: RentCell, minCellN: number): c is RentCell & { medianVnd: number } =>
  c.medianVnd !== null && c.n >= minCellN

// ── Reading the Rent Index CSV ─────────────────────────────────────────────────────────────────────────────────

/** Why the freeze will not use a file — or will not freeze at all. The message is the operator's next step. */
export class FreezeRefused extends Error {
  override name = 'FreezeRefused'
}
function refuse(why: string): never {
  throw new FreezeRefused(why)
}

/** RFC 4180 rows: quoted fields, doubled quotes, CRLF or LF. A final line break ends the last row; it starts none. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') cur += c
      else if (text[i + 1] === '"') { cur += '"'; i++ }
      else quoted = false
    } else if (c === '"' && cur === '') quoted = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cur); rows.push(row); row = []; cur = ''
    } else cur += c
  }
  if (cur !== '' || row.length > 0) { row.push(cur); rows.push(row) }
  return rows
}

/** A snapshot older than this is not frozen: the monthly freeze reads the Rent Index of that day, not of last week. */
export const MAX_SNAPSHOT_AGE_HOURS = 36
const SKEW_MS = 5 * 60_000
const BAND_OF_TYPE = new Map<string, ApartmentBand>(APARTMENT_BANDS.map((b) => [BAND_CSV_TYPE[b], b]))

export type RentCsv = { snapshotUtc: string; rulesVersion: number; cells: RentCell[] }

/**
 * The Rent Index CSV, read and refused rather than guessed at. ⛔ REFUSED: anything whose first line is not the Rent
 * Index's header (rent-index.ts CSV_COLUMNS — imported, never restated; a 503's apology is not a file), a row of the
 * wrong width, a file mixing snapshots or rules versions, a rules version other than the one this code was written for
 * (RENT_INDEX_RULES_VERSION) unless a series break is declared, a snapshot more than MAX_SNAPSHOT_AGE_HOURS old (or in
 * the future), and a city or district missing one of its band rows.
 * ⚠️ A MEDIAN UNDER THE FLOOR IS NOT A REFUSAL, IT IS SUPPRESSED: the cell keeps its n and loses its median, as the
 * Rent Index page prints a dash.
 * Cells come out city first (CITY_BANDS), then each district in the file's order (DISTRICT_BANDS).
 */
export function parseRentIndexCsv(text: string, opts: { now: Date; seriesBreak?: string | null }): RentCsv {
  const [head, ...data] = csvRows(text.replace(/^﻿/, ''))
  if (!head || head.join(',') !== RENT_INDEX_CSV_COLUMNS.join(',')) {
    refuse(`not the Rent Index CSV — its first line is ${JSON.stringify((text.split(/\r?\n/)[0] ?? '').slice(0, 120))}`)
  }
  if (data.length === 0) refuse('the Rent Index CSV has a header and no rows')
  const col = Object.fromEntries(RENT_INDEX_CSV_COLUMNS.map((c, i) => [c, i])) as Record<(typeof RENT_INDEX_CSV_COLUMNS)[number], number>
  const snapshotUtc = data[0][col.snapshot_utc]
  const rules = data[0][col.rules_version]
  const seen = new Map<string, RentCell>()
  const districts: string[] = []
  data.forEach((row, i) => {
    const at = `row ${i + 2}`
    if (row.length !== RENT_INDEX_CSV_COLUMNS.length) refuse(`${at} has ${row.length} fields, not ${RENT_INDEX_CSV_COLUMNS.length}`)
    if (row[col.snapshot_utc] !== snapshotUtc) refuse(`${at} is from another snapshot (${row[col.snapshot_utc]}, not ${snapshotUtc})`)
    if (row[col.rules_version] !== rules) refuse(`${at} is under other rules (version ${row[col.rules_version]}, not ${rules})`)
    const scope = row[col.scope]
    if (scope !== 'city' && scope !== 'district') refuse(`${at} has scope ${JSON.stringify(scope)}`)
    const slug = row[col.district_slug]
    if (!SLUG.test(slug)) refuse(`${at} has district_slug ${JSON.stringify(slug)}`)
    // Every district the file names, from ANY of its rows: one whose band rows are all gone is refused below ("… row is
    // missing"), never left out of the edition in silence (codex, integration review).
    if (scope === 'district' && !districts.includes(slug)) districts.push(slug)
    const band = BAND_OF_TYPE.get(row[col.type])
    if (!band) return // the all-sizes, house and room rows: not read (CITY_BANDS)
    if (!(scope === 'city' ? CITY_BANDS : DISTRICT_BANDS).includes(band)) return
    const nRaw = row[col.n]
    const medianRaw = row[col.median_vnd_month]
    if (!/^\d+$/.test(nRaw)) refuse(`${at} has n ${JSON.stringify(nRaw)}`)
    if (medianRaw !== '' && !/^[1-9]\d*$/.test(medianRaw)) refuse(`${at} has median ${JSON.stringify(medianRaw)}`)
    // The Rent Index gives a median for every cell at its floor (rent-index.ts `stats`), so a blank one there is a broken
    // file — never frozen as a dash with its count beside it (codex, gate review).
    if (medianRaw === '' && Number(nRaw) >= MIN_CELL_N) refuse(`${at} has ${nRaw} listings and no median: the Rent Index gives one from ${MIN_CELL_N}`)
    const key = `${scope}|${slug}|${band}`
    if (seen.has(key)) refuse(`${at} repeats ${key}`)
    const n = Number(nRaw)
    const median = medianRaw === '' ? null : Number(medianRaw)
    seen.set(key, {
      scope, districtSlug: slug, districtName: row[col.district_name], partOf: row[col.part_of] || null, band, n,
      medianVnd: median !== null && n >= MIN_CELL_N ? median : null,
    })
  })
  if (districts.length === 0) refuse('the Rent Index CSV has no district rows')
  if (!z.iso.datetime().safeParse(snapshotUtc).success) refuse(`snapshot_utc ${JSON.stringify(snapshotUtc)} is not a UTC time`)
  if (!/^[1-9]\d*$/.test(rules)) refuse(`rules_version ${JSON.stringify(rules)} is not a version`)
  const rulesVersion = Number(rules)
  if (rulesVersion !== RENT_INDEX_RULES_VERSION && !opts.seriesBreak?.trim()) {
    refuse(`the file is Rent Index rules version ${rulesVersion}; this code reads version ${RENT_INDEX_RULES_VERSION}. Read what changed, then freeze with --series-break "<what changed, for readers>"`)
  }
  const age = opts.now.getTime() - Date.parse(snapshotUtc)
  if (age > MAX_SNAPSHOT_AGE_HOURS * 3_600_000) refuse(`the snapshot (${snapshotUtc}) is more than ${MAX_SNAPSHOT_AGE_HOURS} hours old`)
  if (age < -SKEW_MS) refuse(`the snapshot (${snapshotUtc}) is in the future`)
  const pick = (scope: 'city' | 'district', slug: string, band: ApartmentBand): RentCell =>
    seen.get(`${scope}|${slug}|${band}`) ?? refuse(`the ${scope === 'city' ? 'city-wide' : slug} ${BAND_CSV_TYPE[band]} row is missing`)
  return {
    snapshotUtc,
    rulesVersion,
    cells: [
      ...CITY_BANDS.map((b) => pick('city', 'all', b)),
      ...districts.flatMap((slug) => DISTRICT_BANDS.map((b) => pick('district', slug, b))),
    ],
  }
}

// ── Freezing ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The edition a freeze at `now` makes: the month in Ho Chi Minh City (UTC+7, no DST), where the 1st is the freeze day. */
export function editionIdAt(now: Date): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 7)
}

/** A move in the city-wide 1-bedroom count larger than this, edition to edition, is a series break (d1-spec §2.5). */
export const SERIES_BREAK_N_SHIFT = 0.3

const cityCell = (cells: readonly RentCell[], band: ApartmentBand) => cells.find((c) => c.scope === 'city' && c.band === band)

/**
 * ⛔ THE COMPARABILITY GUARDS: why figures on either side of this freeze could not be compared, or [] when they can.
 * The freeze stops on any of them until a reason is given (`--series-break`), and the reason is printed with the
 * edition and in every CSV row of it. The rules version (a changed Rent Index method), the model version (a changed
 * tax or insurance rule), and a city-wide 1-bedroom count that moved more than ±30% — the shape of the 13–16 October
 * 2026 source change (15,141 listings to 481) and of rules v5 (2,516 to 139), neither of which a rules number alone
 * would have caught in time.
 */
export function seriesBreaks(prev: Edition | undefined, next: Pick<RentCsv, 'rulesVersion' | 'cells'>, modelVersion: number = MODEL_VERSION): string[] {
  if (!prev) return []
  const out: string[] = []
  if (next.rulesVersion !== prev.rent.rulesVersion) out.push(`the Rent Index rules moved from version ${prev.rent.rulesVersion} to ${next.rulesVersion}`)
  if (modelVersion !== prev.model.version) out.push(`the pay model moved from version ${prev.model.version} to ${modelVersion}`)
  const was = cityCell(prev.rent.cells, 'br1')?.n ?? 0
  const now = cityCell(next.cells, 'br1')?.n ?? 0
  if (was === 0 ? now !== 0 : Math.abs(now - was) / was > SERIES_BREAK_N_SHIFT) {
    out.push(`the city-wide 1-bedroom count moved from ${was} to ${now} listings, more than ±${SERIES_BREAK_N_SHIFT * 100}%`)
  }
  return out
}

/** An edition from its inputs: the take-home pay at each reference income, and every published cell's share. */
export function computeEdition(
  base: Omit<Edition, 'model' | 'outputs'>,
  model: { version: number; inputs: ModelInputs } = { version: MODEL_VERSION, inputs: MODEL_INPUTS },
): Edition {
  const pay = model.inputs.referenceGrossVnd.map((g) => takeHome(g, model.inputs))
  const outputs: Output[] = base.rent.cells.flatMap((c) =>
    !publishable(c, base.rent.minCellN) ? [] : pay.map((t) => ({
      scope: c.scope, districtSlug: c.districtSlug, band: c.band, grossVnd: t.grossVnd,
      sharePct: sharePct(c.medianVnd, t.takeHomeVnd),
      sharePctWhole: sharePctWhole(c.medianVnd, t.takeHomeVnd),
      leftAfterRentVnd: t.takeHomeVnd - c.medianVnd,
    })))
  return editionSchema.parse({ ...base, model: { version: model.version, inputs: model.inputs, takeHome: pay }, outputs })
}

/**
 * The edition a freeze at `now` writes, or a refusal saying what to do. ⛔ IT NEVER REPLACES ONE: an edition id already
 * frozen, or older than the newest, is refused here, and the script opens the file with `wx` besides.
 */
export function planEdition(input: {
  csvText: string
  csvSha256: string
  now: Date
  /** Every frozen edition, in any order. */
  editions: readonly Edition[]
  seriesBreak?: string | null
  note?: string | null
  /**
   * The Rent Index's "Sources in this snapshot" line, read off its page at the freeze (its CSV does not carry it).
   * Whitespace is collapsed, and a pasted label or the sentence's full stop is dropped: the line ends in ")" or
   * "members", so that stop is never part of a name. Left out, the edition names none; given, it must be that line.
   */
  sources?: string | null
}): Edition {
  const id = editionIdAt(input.now)
  const newest = [...input.editions].sort(newestFirst)[0]
  if (input.editions.some((e) => e.edition === id)) refuse(`edition ${id} is already frozen — an edition is never replaced; a correction is an erratum (errata.json)`)
  if (newest && id < newest.edition) refuse(`edition ${id} would be older than the newest frozen edition, ${newest.edition}`)
  const seriesBreak = input.seriesBreak?.trim() || null
  const sources = input.sources?.replace(/\s+/g, ' ').replace(/ ?· ?/g, ' · ').trim().replace(/^Sources in this snapshot:\s*/i, '').replace(/\.$/, '').trim() || null
  // ⛔ GIVEN, IT MUST BE THAT LINE: a lone "." or the bare label comes to nothing here, and is refused rather than leaving
  // a written edition that names no sources (codex, gate review).
  if (input.sources?.trim() && !(sources && isSourcesLine(sources))) {
    refuse(`--sources ${JSON.stringify(input.sources.trim())} is not the Rent Index's "Sources in this snapshot" line: each source reads "listings posted by eno.vn members", or a name followed by "(listings imported from that site)" or "(an official eno.vn partner's own listings)", joined by " · " — names only, never a count (owner, 2026-09-27)`)
  }
  const rent = parseRentIndexCsv(input.csvText, { now: input.now, seriesBreak })
  /**
   * ⛔ AN EDITION'S RENTS ARE FROM ITS OWN MONTH. The Rent Index refreshes once a day, at whatever hour the last refresh
   * happened (load-rent-index.ts, revalidate 86400, stale while revalidating), so a freeze on the morning of the 1st
   * usually reads the month before's last day — "November 2026 edition · rents of 31 October 2026" (verifier round).
   */
  if (editionIdAt(new Date(rent.snapshotUtc)) !== id) {
    refuse(`the snapshot (${rent.snapshotUtc}, ${saigonDay(rent.snapshotUtc)} in Ho Chi Minh City) is not from edition ${id}'s month. Wait for the Rent Index's first snapshot of ${editionMonth(id)} — a GET of https://eno.vn/hcmc-rent-index refreshes one more than a day old — then retry`)
  }
  const breaks = seriesBreaks(newest, rent)
  if (breaks.length > 0 && !seriesBreak) {
    refuse(`a series break: ${breaks.join('; ')}. Figures on either side are not comparable — freeze with --series-break "<one sentence for readers: what changed>"`)
  }
  return computeEdition({
    edition: id,
    frozenAt: input.now.toISOString(),
    note: input.note?.trim() || null,
    seriesBreak,
    rent: {
      source: RENT_INDEX_CSV_URL, csvSha256: input.csvSha256, snapshotUtc: rent.snapshotUtc, rulesVersion: rent.rulesVersion,
      ...(sources ? { sources } : {}), minCellN: MIN_CELL_N, cells: rent.cells,
    },
  })
}

// ── Reading an edition ─────────────────────────────────────────────────────────────────────────────────────────

/** A published cell with its figures across the reference incomes (lowest share first), or null under the floor. */
export type CellFigures = {
  cell: RentCell & { medianVnd: number }
  shareWhole: readonly [number, number]
  leftAfterRentVnd: readonly [number, number]
}

export function cellFigures(e: Edition, scope: 'city' | 'district', slug: string, band: ApartmentBand): CellFigures | null {
  const cell = e.rent.cells.find((c) => c.scope === scope && c.districtSlug === slug && c.band === band)
  if (!cell || !publishable(cell, e.rent.minCellN)) return null
  const at = e.outputs.filter((o) => o.scope === scope && o.districtSlug === slug && o.band === band)
  if (at.length === 0) return null
  const share = at.map((o) => o.sharePctWhole)
  const left = at.map((o) => o.leftAfterRentVnd)
  return { cell, shareWhole: [Math.min(...share), Math.max(...share)], leftAfterRentVnd: [Math.min(...left), Math.max(...left)] }
}

/** "17–19%", or "17%" when both incomes round to the same share. */
export const shareText = ([lo, hi]: readonly [number, number]) => (lo === hi ? `${lo}%` : `${lo}–${hi}%`)

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** "October 2026" for edition 2026-10. */
export const editionMonth = (id: string) => `${MONTHS[Number(id.slice(5, 7)) - 1]} ${id.slice(0, 4)}`
/** The day of a UTC time in Ho Chi Minh City, "21 October 2026" — the day the Rent Index page prints for its snapshot. */
export function saigonDay(iso: string): string {
  const d = new Date(Date.parse(iso) + 7 * 3_600_000)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

type Dated = Pick<Edition, 'edition' | 'frozenAt'>
const later = (a: string, b: string) => (Date.parse(b) > Date.parse(a) ? b : a)

/** When an edition's own record last changed: its freeze, or a later erratum to it (printed beside it and in its CSV note). */
export const editionLastmod = (e: Dated, errata: readonly Erratum[]): string =>
  errata.filter((x) => x.edition === e.edition).map((x) => x.at).reduce(later, e.frozenAt)

/**
 * When the series last changed: its newest freeze, or a later erratum to ANY edition — a correction changes what the
 * dataset says (codex, gate review). ⛔ ONE VALUE FOR THE DATASET'S `dateModified` AND FOR THE SITEMAP <lastmod> OF THE
 * SERIES PAGE THAT CARRIES IT, so the two can never disagree (verifier round: the page's was its newest edition's alone).
 */
export const seriesLastmod = (editions: readonly Dated[], errata: readonly Erratum[]): string =>
  editions.map((e) => editionLastmod(e, errata)).reduce(later)

/**
 * When an edition's PAGE last changed — the sitemap's <lastmod> for a superseded one: its own record, or the newest
 * edition's freeze, whichever is later. ⚠️ ITS FIGURES NEVER MOVE, BUT ITS PAGE DOES AT EVERY LATER FREEZE: its canonical
 * flips from the series to itself when it is first superseded, and its "The newest is …" line and its editions list gain
 * links at each freeze after ([edition]/page.tsx, sections.tsx) — links and indexing, which Google counts as significant
 * for <lastmod>, and the canonical flip is the very recrawl d1-spec §6 measures. Dated by its freeze alone, a superseded
 * edition told Google of neither (verifier round).
 */
export const editionPageLastmod = (e: Dated, newest: Dated, errata: readonly Erratum[]): string =>
  later(editionLastmod(e, errata), newest.frozenAt)

/**
 * What a reader of an edition must be told beside it: its series break, its note, its rents' sources, then its errata by
 * date. The sources line is the Rent Index's own (rent-index-sections.tsx `Methodology`), about the snapshot it was frozen from.
 */
export function editionNotes(e: Edition, errata: readonly Erratum[]): string[] {
  return [
    ...(e.seriesBreak ? [`Series break: ${e.seriesBreak}`] : []),
    ...(e.note ? [e.note] : []),
    ...(e.rent.sources ? [`Sources in the Rent Index snapshot these rents are from: ${e.rent.sources}. The figures are always pooled and never broken down by source.`] : []),
    ...errata
      .filter((x) => x.edition === e.edition)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      .map((x) => `Erratum (${saigonDay(x.at)}): ${x.text}`),
  ]
}

// ── The CSV ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ ONE LONG TABLE OF EVERY EDITION, OLDEST FIRST, so a new edition only APPENDS rows and a script that saved last
 * month's file finds every row of it unchanged (only `note` can gain an erratum). One row per edition × cell ×
 * reference income; a cell under the floor keeps its n with the rest empty, as in the Rent Index CSV. `note` is last.
 */
export const TEACHER_COST_INDEX_CSV_COLUMNS = [
  'edition', 'rent_snapshot_utc', 'rent_rules_version', 'model_version', 'scope', 'district_slug', 'district_name', 'part_of',
  'bedrooms', 'n', 'median_rent_vnd_month', 'gross_vnd_month', 'take_home_vnd_month', 'rent_share_pct',
  'left_after_rent_vnd_month', 'note',
] as const

/** The `bedrooms` column: the band as a reader names it. */
export const BEDROOMS_CSV: Record<ApartmentBand, string> = { studio: 'studio', br1: '1', br2: '2', br3plus: '3+' }

export function teacherCostIndexCsv(editions: readonly Edition[], errata: readonly Erratum[]): string {
  const lines: string[] = [TEACHER_COST_INDEX_CSV_COLUMNS.join(',')]
  for (const e of [...editions].sort(newestFirst).reverse()) {
    const note = editionNotes(e, errata).join(' | ') || null
    for (const c of e.rent.cells) {
      for (const t of e.model.takeHome) {
        const o = e.outputs.find((x) => x.scope === c.scope && x.districtSlug === c.districtSlug && x.band === c.band && x.grossVnd === t.grossVnd)
        lines.push([
          e.edition, e.rent.snapshotUtc, e.rent.rulesVersion, e.model.version, c.scope, c.districtSlug, c.districtName, c.partOf,
          BEDROOMS_CSV[c.band], c.n, o ? c.medianVnd : null, t.grossVnd, t.takeHomeVnd, o ? o.sharePct.toFixed(1) : null,
          o ? o.leftAfterRentVnd : null, note,
        ].map(csvField).join(','))
      }
    }
  }
  return lines.join('\r\n') + '\r\n'
}

// ── The JSON-LD ────────────────────────────────────────────────────────────────────────────────────────────────

const groupEn = (n: number) => n.toLocaleString('en-US')

/** The trail on both page types: the teach hub, the series, and an edition when the page is one. */
export function teacherCostIndexBreadcrumb(origin: string, edition?: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Teach in Vietnam', item: `${origin}/teach-in-vietnam` },
      { '@type': 'ListItem', position: 2, name: TEACHER_COST_INDEX_NAME, item: `${origin}${TEACHER_COST_INDEX_PATH}` },
      ...(edition ? [{ '@type': 'ListItem', position: 3, name: `${editionMonth(edition)} edition`, item: `${origin}${editionPath(edition)}` }] : []),
    ],
  }
}

/**
 * ONE Dataset for the series, on the series page only — never one per edition.
 * ⛔ NO `license` (owner ruling R-f, restated by owner decision 9): the terms are free to cite and quote, credit eno.vn,
 * a link welcome and allowed to be nofollow — not an open licence. `usageInfo` points at the cite box, the one place
 * they are written. Google lists `license` as recommended, not required, so the Rich Results Test's warning about it is
 * expected. ⚠️ No `temporalCoverage`, as on the Rent Index: when the listings were posted is not known here.
 */
export function teacherCostIndexDataset(editions: readonly Edition[], site: { origin: string; name: string }, errata: readonly Erratum[] = []): Record<string, unknown> {
  const sorted = [...editions].sort(newestFirst)
  // The series page's sitemap <lastmod> is this same value (`seriesLastmod`).
  const modified = seriesLastmod(sorted, errata)
  const latest = sorted[0]
  const first = sorted[sorted.length - 1]
  const url = `${site.origin}${TEACHER_COST_INDEX_PATH}`
  const m = latest.model.inputs
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: TEACHER_COST_INDEX_NAME,
    description:
      `Monthly editions. Median asking rent for apartments in Ho Chi Minh City (studios and 1, 2 and 3+ bedrooms city-wide; studios and 1 and 2 bedrooms by district; only cells with at least ${latest.rent.minCellN} listings), as a share of a full-time language-centre teacher's modelled monthly take-home pay at ${m.referenceGrossVnd.map(groupEn).join(' and ')} VND gross under ${m.year} Vietnamese income-tax and social-insurance rules. Rents from the ${site.name} HCMC Rent Index. Asking rents, not signed leases; modelled pay, not reported pay.`,
    url,
    version: latest.edition,
    creator: { '@type': 'Organization', name: site.name, url: site.origin },
    isAccessibleForFree: true,
    usageInfo: `${url}#cite`,
    datePublished: first.frozenAt,
    dateModified: modified,
    spatialCoverage: {
      '@type': 'Place',
      name: 'Ho Chi Minh City, Vietnam',
      geo: { '@type': 'GeoCoordinates', latitude: 10.7769, longitude: 106.7009 },
    },
    variableMeasured: ['median monthly asking rent (VND)', 'modelled monthly take-home pay (VND)', 'rent as a share of take-home pay (%)', 'take-home pay left after rent (VND)', 'listing count'],
    measurementTechnique: `Rent Index median divided by modelled take-home pay: ${m.assumptions}; ${insuranceRateText(m)} employee insurance; ${m.law}`,
    isBasedOn: [`${site.origin}/hcmc-rent-index`, `${site.origin}/teach-in-vietnam/${TEACHER_COST_INDEX_GUIDES[0]}`],
    distribution: { '@type': 'DataDownload', encodingFormat: 'text/csv', contentUrl: `${site.origin}${TEACHER_COST_INDEX_CSV_PATH}` },
    keywords: ['Ho Chi Minh City', 'Saigon', 'English teacher', 'rent', 'take-home pay', 'cost of living'],
  }
}
