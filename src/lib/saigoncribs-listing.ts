/**
 * SAIGON CRIBS (saigoncribs.com, an HCMC expat rental agency) → eno: every listing they publish, written ONCE on their own
 * storefront, then the admin's to manage.
 *
 * Owner, 2026-11-18: "add them as partners and their apartment listings"; then picked: import EVERYTHING they list —
 * apartments, serviced apartments, villas/houses, short stays, offices — each DATED with its own posted date. Settled the
 * same day: a row with no price is dropped; create-only (no weekly refresh); a "Listed by Saigon Cribs on <date>" line in
 * every description; nightly stays → homestay-serviced at VND/day; a building filed where it really is (Celesta Rise,
 * Sunrise Riverside → Huyện Nhà Bè); every visa / airport-pickup / immigration / internet-setup / cash-back / promo / rebate
 * line kept out (eno.vn may not advertise visa services — CLAUDE.md's legal boundary); the rent index keeps its existing
 * partner behaviour. The build plan: ~/eno-saigoncribs-2026-11-18/PLAN.md.
 *
 * Pure — no I/O. The I/O is scripts/import-saigoncribs.ts, which reads the research folder (never the live site):
 *   · data.json — the 192 listings parse.py read off the saved pages (2026-11-18): type, price box, beds/baths/area, region
 *     tag, WordPress post date, photo URLs, the kept description lines. `readSaigoncribsRecords` is its contract.
 *   · photo-verdicts.json — per listing, which of the first 20 photos a person kept (cover first) and why the rest went.
 *   · bodies.json — per listing, the final English description lines a person cleaned and read.
 *   Either file may HOLD a listing (`hold`: a reason); a held listing is not written.
 *
 * ⛔ PRICES ARE IN ĐỒNG, CONVERTED FROM THE AGENCY'S US DOLLARS AT RUN TIME (honeycomb-listing.ts usdToVnd, the USD-base
 * feed vndPerUsdFrom). The dollar figure stays, verbatim, in the description, which says the đồng figure is approximate.
 * A figure is never guessed: a price box that disagrees with the listing's own title or text, a nightly type with a bare
 * dollar figure, a price in another unit beside it — HELD for a person (`saigoncribsPrice`).
 *
 * ⛔ A PLACE IS NEVER GUESSED EITHER. The agency's region tag is wrong on ~30 rows (PLAN §0): a building the map knows
 * (REVER_BUILDINGS) named in the headline or a Location line decides the district — Celesta Rise and Sunrise Riverside are
 * in Nhà Bè though tagged District 7 — and pins the row; with no building, a different district the headline or a Location
 * line says the unit is IN holds the row (`saigoncribsPlace`). `location` is composed from checked parts, never the
 * source's address or a unit number.
 *
 * ⛔ NO PHONE, LINK, EMAIL OR ADDRESS IN ANY TEXT (assertCleanTexts, which an admin's later edit meets too), NO VISA OR
 * AGENCY-PERK WORDING, NO DOLLAR FIGURE IN THE BODY (the price section is ours), NO 'Label: value' TABLE (rich-text-blocks.ts
 * renders a run of them as a spec table) — each HOLDS the row with the offending line named, rather than editing text a
 * person already read (`bodyProblem`).
 *
 * ⛔ ONLY ENGLISH IS WRITTEN. `descriptionVi` stays NULL so Reach's daily Haiku job (mt-job.ts) writes the Vietnamese with
 * the nine other languages; a filled `descriptionVi` would block that row. The titles are composed here in both languages
 * (place names spelled, never translated).
 *
 * ⛔ DATED: `postedAt` is the listing's own WordPress date (the site's clock is UTC, PLAN §0), clamped to now
 * (nhatotPostedAt); the script ranks it from that date (nhatotStartingRank) — old stock ranks by its real age. The UI's
 * "Posted" shows the later of postedAt and createdAt (stale.ts listedAt), i.e. the import day, so the date is ALSO in the
 * text: "Listed by Saigon Cribs on 18 October 2026."
 */
import { buildSearchText, fold } from './fold'
import { listingMoneyFor, roomAttributes } from './taxonomy'
import { PublishBlockedError, assertCleanTexts, minPhotosFor } from './publish-guard'
import { dropNearDuplicates, type ImageSizeFloor, type PhotoOutcome } from './import-photo-check'
import { CITY_NAME, USD_MONTHLY_BAND, VND_BAND, buildingNameKey, districtOf, rentLine, usdToVnd } from './honeycomb-listing'
import { nhatotPostedAt } from './nhatot-listing'
import { richTextGroups } from './rich-text-blocks'
import { REVER_BUILDINGS, type ReverBuilding } from '../generated/rever-buildings'

// ─── constants ──────────────────────────────────────────────────────────────────────────────────

export const SAIGONCRIBS_HANDLE = 'saigoncribs'
/** eno-held login (Cloudflare Email Routing → eno's inbox), as for the car partners and Evisa Saigon. */
export const SAIGONCRIBS_EMAIL = 'support+saigoncribs@eno.vn'
export const SAIGONCRIBS_NAME = 'Saigon Cribs'
export const SAIGONCRIBS_ORIGIN = 'https://saigoncribs.com'
/** `<prefix><WordPress post id>` — the listing's key on the storefront (@@unique([sellerId, externalId])). */
export const EXTERNAL_ID_PREFIX = 'saigoncribs:'
export const saigoncribsExternalId = (postId: number) => `${EXTERNAL_ID_PREFIX}${postId}`
export const SAIGONCRIBS_CATEGORY_SLUG = 'rentals'
/**
 * ⛔ THE CATEGORY'S OWN PHOTO FLOOR (3 distinct for rentals), NEVER A LOWER ONE: an admin's edit re-checks it, so a row
 * written under it could never be edited again (import-car-partners.ts MIN_PHOTOS).
 */
export const SAIGONCRIBS_MIN_PHOTOS = minPhotosFor(SAIGONCRIBS_CATEGORY_SLUG)
/** A listing shows its first photos; more than this adds weight, not information (PLAN §5). */
export const SAIGONCRIBS_MAX_PHOTOS = 10
/** Photos judged per listing: the first 20 in gallery order (photo-verdicts.json numbers 1..20). */
export const SAIGONCRIBS_CANDIDATES = 20
export const SAIGONCRIBS_PHOTO_FLOOR: ImageSizeFloor = { minShortEdge: 300 }
/** A photo URL used by this many listings or more is a BUILDING shot (pool, lobby), not the unit: never the cover. */
export const SHARED_PHOTO_MIN_USES = 3
/** Nightly / daily rent sanity band, US dollars. Real stock: $30–$355. */
export const NIGHT_USD_BAND = { min: 15, max: 2000 } as const
/**
 * …and in đồng, after conversion. ⚠️ NOT honeycomb's VND_BAND (1,000,000 đ and up): that is the MONTHLY contract band,
 * and a $30 night is ~790,000 đ — it would refuse an honest nightly rate.
 */
export const NIGHT_VND_BAND = { min: 100_000, max: 60_000_000 } as const
/** Another figure for the same unit within this share of the price box is rounding ($2,549 vs "$2,550"), not a conflict. */
export const PRICE_TOLERANCE = 0.02
/** The agency's own đồng figure ("17 Million VND") may differ from our conversion by this much before the row is held. */
export const VND_HINT_TOLERANCE = 0.05
/** core/listings.ts cuts a description to this on every edit: a longer one would lose its price and dated lines. */
export const DESCRIPTION_MAX = 5000
/** The post wizard's title cap. */
export const TITLE_MAX = 140

// ─── the research's shape ───────────────────────────────────────────────────────────────────────

type Figure = { source: string; amount: number; per: string | null; text: string }
/** One row of data.json (parse.py), the fields this module reads. */
export type SaigoncribsRecord = {
  id: number
  url: string
  title: string
  type: string | null
  region: string | null
  /** WordPress `date` ("2025-11-28T09:35:06"; the site's clock is UTC, so it equals date_gmt). */
  postedAt: string | null
  beds: number | null
  baths: number | null
  rooms: number | null
  areaM2: number | null
  status: string | null
  /** The description lines parse.py kept (contact lines removed) — EVIDENCE for place and price, never published. */
  descriptionLines: string[]
  photos: string[]
  price: {
    amount: number | null
    per: string | null
    /** The price box as printed: "$850 usd/month", "$850", "$155 usd/night", "$30 usd/day", "Private Sale"… */
    raw: string | null
    source: string | null
    perSource: string | null
    /** Other figures in the title / price lines in the same (or no) unit. */
    conflicts: Figure[]
    /** Figures in another unit ("$45 / Night" beside a monthly box). */
    otherRates: Figure[]
    range: { min: number; max: number; text: string } | null
    note: string | null
  }
  /** A rent-level đồng figure the agency itself printed ("17 Million VND"). */
  vndHint: { amount: number; raw: string } | null
  flags: string[]
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const numOrNull = (v: unknown): number | null => (isNum(v) ? v : null)
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
function figures(v: unknown): Figure[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((f) => {
    const o = f as Record<string, unknown> | null
    return o && isNum(o.amount) ? [{ source: String(o.source ?? ''), amount: o.amount, per: strOrNull(o.per), text: String(o.text ?? '') }] : []
  })
}

/**
 * data.json → records. ⛔ FAILS CLOSED ON SHAPE: a row without a numeric id, a title or its price object is a parse the
 * importer cannot vouch for — the whole file is refused (it is research, read once, not a feed to skip around in).
 */
export function readSaigoncribsRecords(json: unknown): SaigoncribsRecord[] {
  if (!Array.isArray(json)) throw new Error('data.json is not an array of listings')
  const seen = new Set<number>()
  return json.map((raw, i) => {
    const r = raw as Record<string, unknown> | null
    if (!r || !Number.isInteger(r.id) || (r.id as number) <= 0) throw new Error(`data.json row ${i}: no WordPress post id`)
    const id = r.id as number
    if (seen.has(id)) throw new Error(`data.json: post ${id} twice`)
    seen.add(id)
    if (typeof r.title !== 'string' || !r.title.trim()) throw new Error(`data.json post ${id}: no title`)
    const p = r.price as Record<string, unknown> | null
    if (!p || typeof p !== 'object') throw new Error(`data.json post ${id}: no price object`)
    const range = p.range as Record<string, unknown> | null
    const vh = r.vndHint as Record<string, unknown> | null
    return {
      id,
      url: String(r.url ?? ''),
      title: r.title,
      type: strOrNull(r.type),
      region: strOrNull(r.region),
      postedAt: strOrNull(r.postedAt),
      beds: numOrNull(r.beds),
      baths: numOrNull(r.baths),
      rooms: numOrNull(r.rooms),
      areaM2: numOrNull(r.areaM2),
      status: strOrNull(r.status),
      descriptionLines: strings(r.descriptionLines),
      photos: strings(r.photos),
      price: {
        amount: numOrNull(p.amount),
        per: strOrNull(p.per),
        raw: strOrNull(p.raw),
        source: strOrNull(p.source),
        perSource: strOrNull(p.perSource),
        conflicts: figures(p.conflicts),
        otherRates: figures(p.otherRates),
        range: range && isNum(range.min) && isNum(range.max) ? { min: range.min, max: range.max, text: String(range.text ?? '') } : null,
        note: strOrNull(p.note),
      },
      vndHint: vh && isNum(vh.amount) ? { amount: vh.amount, raw: String(vh.raw ?? '') } : null,
      flags: strings(r.flags),
    }
  })
}

/** photo-verdicts.json, one listing: photo numbers (1..20, the first 20 of data.json `photos`, same order). */
export type PhotoVerdict = { keep: number[]; drop: { n: number; reason: string }[]; hold: string | null }
/** bodies.json, one listing: the final English description lines a person read. */
export type BodyVerdict = { lines: string[]; hold: string | null }

const holdOf = (v: unknown, where: string): string | null => {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${where}: hold must be null or a reason`)
  return v.trim()
}

/** photo-verdicts.json → verdicts. ⛔ A malformed entry refuses the file: a misread verdict would publish the wrong photos. */
export function readPhotoVerdicts(json: unknown): Record<string, PhotoVerdict> {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('photo-verdicts.json is not an object keyed by listing id')
  const out: Record<string, PhotoVerdict> = {}
  for (const [id, raw] of Object.entries(json as Record<string, unknown>)) {
    const where = `photo-verdicts.json ${id}`
    if (!/^\d+$/.test(id)) throw new Error(`${where}: the key is not a WordPress post id`)
    const v = raw as Record<string, unknown> | null
    if (!v || !Array.isArray(v.keep) || !Array.isArray(v.drop)) throw new Error(`${where}: needs keep[] and drop[]`)
    const keep = v.keep.map((n) => {
      if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > SAIGONCRIBS_CANDIDATES) throw new Error(`${where}: keep holds "${String(n)}", not a photo number 1–${SAIGONCRIBS_CANDIDATES}`)
      return n as number
    })
    const drop = v.drop.map((d) => {
      const o = d as Record<string, unknown> | null
      if (!o || !Number.isInteger(o.n) || (o.n as number) < 1 || (o.n as number) > SAIGONCRIBS_CANDIDATES) throw new Error(`${where}: a drop without a photo number 1–${SAIGONCRIBS_CANDIDATES}`)
      return { n: o.n as number, reason: String(o.reason ?? '') }
    })
    out[id] = { keep, drop, hold: holdOf(v.hold, where) }
  }
  return out
}

/** bodies.json → verdicts. ⛔ A malformed entry refuses the file. */
export function readBodies(json: unknown): Record<string, BodyVerdict> {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('bodies.json is not an object keyed by listing id')
  const out: Record<string, BodyVerdict> = {}
  for (const [id, raw] of Object.entries(json as Record<string, unknown>)) {
    const where = `bodies.json ${id}`
    if (!/^\d+$/.test(id)) throw new Error(`${where}: the key is not a WordPress post id`)
    const v = raw as Record<string, unknown> | null
    if (!v || !Array.isArray(v.lines) || v.lines.some((l) => typeof l !== 'string')) throw new Error(`${where}: needs lines[] of strings`)
    out[id] = { lines: (v.lines as string[]).map((l) => l.trim()).filter(Boolean), hold: holdOf(v.hold, where) }
  }
  return out
}

// ─── outcomes ───────────────────────────────────────────────────────────────────────────────────

/**
 * DROPPED: can never be written as it stands (no price, not for rent, let already, outside HCMC, a type eno has no aisle
 * for). HELD: a person can settle it (a conflict, a verdict's hold, a body line that must go) — reported with the detail.
 */
export type DropReason = 'unknownType' | 'noPrice' | 'leased' | 'notHcmc'
export type HoldReason =
  | 'priceConflict' | 'usdBand' | 'vndBand' | 'businessTransfer' | 'unknownRegion' | 'placeConflict' | 'noDate'
  | 'noBodyVerdict' | 'bodyHold' | 'bodyForbidden' | 'bodyPrice' | 'bodyFactTable' | 'bodyNotEnglish' | 'bodyTimeClaim'
  | 'bodyUnitNumber' | 'contactInText'
  | 'bannedWords' | 'descriptionTooLong' | 'titleTooLong'
export type Refusal = { ok: false; kind: 'drop'; reason: DropReason; detail: string } | { ok: false; kind: 'hold'; reason: HoldReason; detail: string }
const drop = (reason: DropReason, detail: string): Refusal => ({ ok: false, kind: 'drop', reason, detail })
const hold = (reason: HoldReason, detail: string): Refusal => ({ ok: false, kind: 'hold', reason, detail })

// ─── type → aisle ───────────────────────────────────────────────────────────────────────────────

/** The agency's type → what it is. A type not here is DROPPED, never guessed (a "For Sale" type would first appear so). */
type Kind = 'apartment' | 'serviced' | 'villa' | 'office' | 'shortStay'
export const TYPE_MAP: Readonly<Record<string, Kind>> = {
  'Apartments': 'apartment',
  'Serviced Apartments': 'serviced',
  'Villas Mansions': 'villa',
  'Offices': 'office',
  'Short Term Stays': 'shortStay',
}

export type Period = 'month' | 'night' | 'day'

/**
 * Which aisle, unit and attributes a (kind, period) pair gets — PLAN §3. ⚠️ eno has NO "VND/night" unit (RENT_UNIT: hour,
 * day, week, month): a night is stored as VND/day through rentalPeriod 'daily'; the description keeps "US$155 a night".
 */
export function saigoncribsAisle(kind: Kind, period: Period): { subcategorySlug: string; priceUnit: string; daily: boolean } {
  const daily = period !== 'month'
  const subcategorySlug = daily ? 'homestay-serviced'
    : kind === 'villa' ? 'house-rental'
    : kind === 'office' ? 'office-rental'
    : 'apartment-rental'
  return { subcategorySlug, priceUnit: listingMoneyFor({ categorySlug: SAIGONCRIBS_CATEGORY_SLUG, listingType: 'rent', rentalPeriod: daily ? 'daily' : 'monthly' }).priceUnit, daily }
}

// ─── price ──────────────────────────────────────────────────────────────────────────────────────

/** The price box: "$850 usd/month", "$1,200usd/month", "$155 usd/night", "$30 usd/day", or a bare "$850". */
const BOX = /^\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:usd\s*\/\s*(month|night|day))?$/i
/** A dollar figure in a title: "$750", "$1,350/mo", "$30 - $50 / Night", "$1.2k". */
const TITLE_USD = /\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\s?k\b)?/gi
/** A price unit word that is not a month (a bare figure beside one of these is not a monthly rent). */
const NOT_MONTH_WORD = /\b(?:night|nightly|nights|day|daily|days|week|weekly|weeks)\b/i
const within = (a: number, b: number, tol = PRICE_TOLERANCE) => Math.abs(a - b) <= tol * Math.max(a, b)
const fmtUsd = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n)

export type SaigoncribsPrice = { ok: true; usd: number; period: Period; range: { min: number; max: number } | null }

/**
 * The listing's rent in US dollars and its period, or why not. ⛔ TWO INDEPENDENT GUARDS (honeycomb-listing.ts:681): the
 * price box's own unit, and every other figure the listing states (title, price lines — parse.py's conflicts/otherRates —
 * plus every dollar figure in the title, read here again). Any disagreement beyond rounding is HELD, never settled by code:
 *  · the box in a unit the type does not rent by (an apartment per night; a short stay per month) or a bare figure on a
 *    nightly type, or beside a night/day/week word;
 *  · another figure in the same (or no) unit more than PRICE_TOLERANCE away ("$12,500" in the title, $12,000 in the box);
 *  · any figure in another unit ("$30/Night" in the title of a $350/month row; "$300/mo" beside a $30/day box);
 *  · a stated range the box is outside ("$30 – $50 / Night" against a $530 box), or a box unit parse.py found contradicted.
 * A range the box is inside ("$600 – $700", box $600) is written, and the description says so.
 */
export function saigoncribsPrice(rec: SaigoncribsRecord, kind: Kind): SaigoncribsPrice | Refusal {
  const p = rec.price
  if (p.source !== 'priceBox' || p.amount === null || !p.raw) return drop('noPrice', p.note ?? p.raw ?? 'no price box')
  const m = BOX.exec(p.raw.trim())
  if (!m) return hold('priceConflict', `price box "${p.raw}" is not a dollar figure this importer reads`)
  const usd = Number(m[1].replace(/,/g, ''))
  if (usd !== p.amount) return hold('priceConflict', `price box "${p.raw}" reads ${usd}, the research says ${p.amount}`)
  const boxUnit = (m[2]?.toLowerCase() ?? null) as Period | null
  let period: Period
  if (kind === 'shortStay') {
    if (boxUnit !== 'night' && boxUnit !== 'day') return hold('priceConflict', `a short stay priced "${p.raw}" — not a nightly or daily rate`)
    period = boxUnit
  } else if (boxUnit === 'night' || boxUnit === 'day') {
    if (kind !== 'serviced') return hold('priceConflict', `${rec.type} priced "${p.raw}" — this type rents by the month`)
    period = boxUnit
  } else {
    // A bare "$850" is a month only where nothing on the listing names another period.
    if (!boxUnit && NOT_MONTH_WORD.test(`${p.raw} ${rec.title}`)) return hold('priceConflict', `bare "${p.raw}" beside a night/day/week word in the title`)
    period = 'month'
  }
  if (p.perSource && /contradict/i.test(p.perSource)) return hold('priceConflict', `the box says "${p.raw}" but the listing's text gives another unit`)
  const band = period === 'month' ? USD_MONTHLY_BAND : NIGHT_USD_BAND
  if (usd < band.min || usd > band.max) return hold('usdBand', `US$${fmtUsd(usd)} a ${period} is outside ${band.min}–${band.max}`)

  const range = p.range && p.range.min < p.range.max ? { min: p.range.min, max: p.range.max } : null
  const inRange = (n: number) => !!range && n >= range.min * (1 - PRICE_TOLERANCE) && n <= range.max * (1 + PRICE_TOLERANCE)
  if (range && !inRange(usd)) return hold('priceConflict', `box US$${fmtUsd(usd)} is outside the stated US$${fmtUsd(range.min)}–${fmtUsd(range.max)}`)
  const off = p.conflicts.find((f) => !within(f.amount, usd) && !inRange(f.amount))
  if (off) return hold('priceConflict', `box US$${fmtUsd(usd)} but the ${off.source} says US$${fmtUsd(off.amount)}${off.per ? `/${off.per}` : ''} ("${off.text.slice(0, 80)}")`)
  const other = p.otherRates[0]
  if (other) return hold('priceConflict', `box US$${fmtUsd(usd)}/${period} but the ${other.source} also prices it US$${fmtUsd(other.amount)}/${other.per ?? '?'} ("${other.text.slice(0, 80)}")`)
  for (const t of rec.title.matchAll(TITLE_USD)) {
    const n = Number(t[1].replace(/,/g, '')) * (t[2] ? 1000 : 1)
    if (!within(n, usd) && !inRange(n)) return hold('priceConflict', `box US$${fmtUsd(usd)} but the title says "${t[0].trim()}"`)
  }
  return { ok: true, usd, period, range: range && !(within(range.min, usd) && within(range.max, usd)) ? range : null }
}

// ─── place ──────────────────────────────────────────────────────────────────────────────────────

type Named = { vi: string; en: string }
const q = (n: number): Named => ({ vi: `Quận ${n}`, en: `District ${n}` })
/** A `Listing.district` string → its English form (honeycomb's districtOf: the one table for both). */
const districtNamed = (vi: string): Named | null => districtOf(vi, null)
const named = (vi: string): Named => {
  const d = districtNamed(vi)
  if (!d) throw new Error(`districtOf does not know "${vi}"`)
  return d
}
const THAO_DIEN: Named = { vi: 'Thảo Điền', en: 'Thao Dien' }
const PHU_MY_HUNG: Named = { vi: 'Phú Mỹ Hưng', en: 'Phu My Hung' }
/**
 * The agency's region tags (raw/listing-region.json, 2026-11-18) → the PRE-2025 district strings the explorer's chips match
 * (Quận 2 and Quận 9 included — listings-explorer.constants.ts), and the neighbourhood the tag names. A tag not here and not
 * outside HCMC is HELD (unknownRegion): a new tag is read by a person before rows are filed under it.
 */
export const REGION_MAP: Readonly<Record<string, { district: Named; area: Named | null }>> = {
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => [`hcmc_district_${n}`, { district: q(n), area: null }])),
  hcmc_district_2_thao_dien: { district: q(2), area: THAO_DIEN },
  hcmc_district_7_phu_my_hung: { district: q(7), area: PHU_MY_HUNG },
  hcmc_binh_thanh: { district: named('Quận Bình Thạnh'), area: null },
  hcmc_phu_nhuan: { district: named('Quận Phú Nhuận'), area: null },
  hcmc_tan_phu: { district: named('Quận Tân Phú'), area: null },
  hcmc_binh_tan: { district: named('Quận Bình Tân'), area: null },
  hcmc_go_vap: { district: named('Quận Gò Vấp'), area: null },
}
const THU_DUC = 'TP. Thủ Đức'
/** Same place, as a filter would read it: Thủ Đức is the umbrella over the old Districts 2 and 9. */
const sameDistrict = (a: string, b: string) => a === b || (a === THU_DUC && (b === 'Quận 2' || b === 'Quận 9')) || (b === THU_DUC && (a === 'Quận 2' || a === 'Quận 9'))

/** Neighbourhoods and towers the text names that place a unit in one district (never a pin — that is REVER_BUILDINGS'). */
const PLACE_WORDS: Readonly<Record<string, string>> = {
  'thao dien': 'Quận 2', 'an phu': 'Quận 2', 'thu thiem': 'Quận 2', 'phu my hung': 'Quận 7',
  // Landmark 81 stands in Vinhomes Central Park, Bình Thạnh — tagged District 2 on one row (PLAN §0).
  'landmark 81': 'Quận Bình Thạnh',
}
const DISTRICT_WORDS = ['binh thanh', 'phu nhuan', 'tan binh', 'go vap', 'tan phu', 'binh tan', 'thu duc', 'nha be', 'binh chanh', 'hoc mon', 'cu chi', 'can gio']
const MENTION = new RegExp(
  `(?<![a-z0-9])(?:(?:district|dist\\.?|quan)\\s*(\\d{1,2})|[dq](\\d{1,2})|(${[...DISTRICT_WORDS, ...Object.keys(PLACE_WORDS)].join('|')}))(?![a-z0-9])`, 'g')
/**
 * ⚠️ A NAME IS NOT A PLACE CLAIM WHEN IT IS WHERE THE UNIT IS NEAR, FACES OR COMMUTES TO: "5 Mins to D1", "near Diamond
 * Island", "Rapid District 1 Commute", "D1 Street" (a street inside Vinhomes Grand Park), "Tan Phu Ward" (a ward of
 * District 7), "(District 7 / Nha Be border)". Measured on all 192 headlines and Location lines (2026-11-18).
 */
const NEAR_BEFORE = /(?:\bnear|\bto|\bfrom|\bmins?|\bminutes?|\bwalk(?:ing)?|\bviews?(?:\s+(?:of|over|across|to|toward|towards))?|\bclose|\bnext|\baccess|\bdrive|\bdriving|\bbridge|\bacross|\btoward|\btowards|\bbetween|\bvia|\bthan|\bcommute|\bheading|\bborder(?:ing|s)?|\boverlooking|\bfacing|\bopposite|\boutside|\bbeyond|\bunlike|\bvs\.?|\band|\bor|\/|&)\s*(?:the\s+)?(?:(?:heart|centre|center|edge) of\s+)?(?:downtown\s+)?(?:central\s+)?$/
const NEAR_AFTER = /^\s*(?:(?:street|st|road|rd|ward|border|boundary|access|commute|price|prices|bridge|views?|skyline|side|dong)\b|\/[^,;.)]*\b(?:border|boundary)\b)/
/** A labelled place line in the agency's text: "Location: Tan Binh District (Near TSN Airport)". */
const PLACE_LABEL = /^\W*(?:location|address|area|district|neighbou?rhood|building|project)\s*[:|–-]\s*/i

/**
 * The districts a headline or a Location line says the unit is in (Listing.district strings), each with the words that
 * said it. ⚠️ NOT THE BODY'S PROSE: measured on the 192 listings (2026-11-18), its sentences name districts the unit is
 * near ("lands you right in the heart of District 1", "Mega Campus nearby in District 10", the schools "in An Phu") — 12
 * false holds and not one real conflict the headline and Location lines did not already show.
 */
export function districtMentions(text: string): { district: string; said: string }[] {
  const f = fold(text)
  const out: { district: string; said: string }[] = []
  for (const m of f.matchAll(MENTION)) {
    const at = m.index ?? 0
    const before = f.slice(Math.max(0, at - 40), at)
    const after = f.slice(at + m[0].length, at + m[0].length + 30)
    if (NEAR_BEFORE.test(before) || NEAR_AFTER.test(after)) continue
    const n = m[1] ?? m[2]
    let district: string | null = null
    if (n) district = Number(n) >= 1 && Number(n) <= 12 ? `Quận ${Number(n)}` : null
    else if (PLACE_WORDS[m[3]]) district = PLACE_WORDS[m[3]]
    else district = districtOf(m[3], null)?.vi ?? null
    if (district) out.push({ district, said: f.slice(Math.max(0, at - 12), at + m[0].length + 8).trim() })
  }
  return out
}

/** Building name keys, longest first, so "The Beverly Solari" wins over "The Beverly" at the same place. */
function buildingKeys(buildings: Record<string, ReverBuilding>) {
  return Object.values(buildings).map((b) => ({ key: buildingNameKey(b.name), b })).filter((x) => x.key).sort((a, b) => b.key.length - a.key.length)
}
const NEAR_BUILDING_BEFORE = /(?:\bnear|\bviews?(?:\s+(?:of|over|across|to))?|\bto|\bfrom|\bopposite|\boverlooking|\bfacing|\bnext to|\bclose to|\bacross from)\s*$/
/**
 * The map buildings a text names as where the unit IS — never one it is near or looks at ("near Diamond Island", "with
 * Landmark 81 View"). Word-boundary matches on folded text, a plural "s" allowed ("Saigon South Residences"), the longest
 * name first and an overlapped shorter one not counted.
 */
export function buildingsNamed(text: string, buildings: Record<string, ReverBuilding> = REVER_BUILDINGS): ReverBuilding[] {
  const t = ` ${fold(text).replace(/[^a-z0-9]+/g, ' ').trim()} `
  const taken: [number, number][] = []
  const hits = new Map<string, ReverBuilding>()
  for (const { key, b } of buildingKeys(buildings)) {
    const rx = new RegExp(`(?<= )${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?(?= )`, 'g')
    for (const m of t.matchAll(rx)) {
      const s = m.index ?? 0, e = s + m[0].length
      if (taken.some(([a, z]) => a < e && s < z)) continue
      taken.push([s, e])
      if (NEAR_BUILDING_BEFORE.test(t.slice(Math.max(0, s - 20), s).trimEnd()) || /^\s*views?\b/.test(t.slice(e, e + 8))) continue
      hits.set(b.slug, b)
    }
  }
  return [...hits.values()]
}

export type SaigoncribsPlace = {
  ok: true
  district: Named
  /** Thảo Điền / Phú Mỹ Hưng, from the region tag — only when no building names the place more precisely. */
  area: Named | null
  /** Exactly one building: its slug, display name and pin. */
  building: { slug: string; name: string; lat: number; lng: number } | null
  /** Every building named (two = an ambiguous name: no pin, no building in the title). */
  buildingNames: string[]
  /** The district the region tag said, when a building moved the row elsewhere (the dry run lists each). */
  overrode: string | null
}

const displayName = (b: ReverBuilding) => b.name.split(' - ')[0].trim()

/**
 * Where the unit is — PLAN §3 "Region → place". BUILDING FIRST: the headline (else a Location line) naming map buildings
 * that all sit in one district decides it, over the region tag; exactly one building also pins the row (its lat/lng — never
 * a guessed pin) and sets `buildingKey`. Buildings in different districts → HELD. With no building, the region tag stands
 * unless the headline or a Location line names a different district → HELD (placeConflict).
 * A tag outside HCMC (Hanoi, Đà Nẵng, Đà Lạt, Nha Trang, Vũng Tàu — 0 rows on 2026-11-18) is DROPPED: eno files these rows
 * under Hồ Chí Minh only.
 */
export function saigoncribsPlace(rec: SaigoncribsRecord, bodyLines: readonly string[], buildings: Record<string, ReverBuilding> = REVER_BUILDINGS): SaigoncribsPlace | Refusal {
  const slug = rec.region ?? ''
  if (!slug.startsWith('hcmc_')) return drop('notHcmc', `region "${slug || '(none)'}" is not Ho Chi Minh City`)
  const tagged = REGION_MAP[slug]
  if (!tagged) return hold('unknownRegion', `region "${slug}" is not one this importer maps`)
  const lines = [...rec.descriptionLines, ...bodyLines]
  const labelled = lines.filter((l) => PLACE_LABEL.test(l))
  let found = buildingsNamed(rec.title, buildings)
  if (!found.length) found = buildingsNamed(labelled.join(' \n '), buildings)
  if (found.length) {
    const districts = [...new Set(found.map((b) => b.district ?? ''))]
    const d = districts.length === 1 && districts[0] ? districtNamed(districts[0]) : null
    if (!d) return hold('placeConflict', `buildings ${found.map(displayName).join(' + ')} are in ${districts.join(' / ') || 'no known district'}`)
    const one = found.length === 1 ? found[0] : null
    const pin = one && one.lat >= 8 && one.lat <= 24 && one.lng >= 102 && one.lng <= 110 ? one : null
    return {
      ok: true,
      district: d,
      area: null,
      building: pin ? { slug: pin.slug, name: displayName(pin), lat: pin.lat, lng: pin.lng } : null,
      buildingNames: found.map(displayName),
      overrode: sameDistrict(d.vi, tagged.district.vi) ? null : tagged.district.vi,
    }
  }
  const said = [...districtMentions(rec.title), ...labelled.flatMap((l) => districtMentions(l.replace(PLACE_LABEL, '')))]
  const other = said.find((s) => !sameDistrict(s.district, tagged.district.vi))
  if (other) return hold('placeConflict', `tagged ${tagged.district.vi} but the text says ${other.district} ("…${other.said}…")`)
  return { ok: true, district: tagged.district, area: tagged.area, building: null, buildingNames: [], overrode: null }
}

// ─── dates ──────────────────────────────────────────────────────────────────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** The WordPress date as a UTC instant (the site's clock is UTC: date == date_gmt), or null. */
export function wpDateMs(s: string | null): number | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(s)) return null
  const ms = Date.parse(/Z|[+-]\d{2}:\d{2}$/.test(s) ? s : `${s}Z`)
  return Number.isFinite(ms) ? ms : null
}
/** "18 October 2026" — the calendar day the agency's own site shows for the post. */
export function listedDay(s: string): string {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}
/** The run's day in Vietnam (UTC+7, no DST), for the FX line. */
const vnDayOf = (ms: number) => { const d = new Date(ms + 7 * 3_600_000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` }

// ─── body ───────────────────────────────────────────────────────────────────────────────────────

/**
 * ⛔ THE LEGAL BOUNDARY AND THE AGENCY'S PERKS (CLAUDE.md: eno.vn may not advertise visa services; owner 2026-11-18: every
 * visa / airport pickup / immigration / internet setup / cash-back / promo / rebate / agency-perk line goes). bodies.json was
 * cleaned by a person; this is the belt to their braces — a line that still matches HOLDS the row, it is never edited here.
 */
const FORBIDDEN = /\b(?:e-?visas?|visas?|immigration|work permits?|temporary residen(?:ce|t)(?: cards?)?|TRC|airport (?:pick-?ups?|transfers?|runs?|meet)|pick(?:ed)?[- ]?up (?:from|at) the airport|internet (?:set-?up|installation|install)|cash ?-?back|promo(?:tion|tional)?(?: codes?)?|rebates?|referral|discount(?:s|ed)?|vouchers?|commission|booking form|pad sheet|relocation (?:service|package|support))\b|#\w*cash|\[insert/i
/**
 * A rent-level figure: any dollar amount, or a đồng one of a million or more ("15 Million VND", "13,000,000 VND") — the
 * price section is ours, and a figure in the body could be last year's. A utility rate ("4,000 VND/kWh") stays.
 */
const BODY_PRICE = /\$\s?\d|\bUS\$|\b\d[\d,.]*\s?(?:usd|us dollars?)\b|\b\d+(?:[.,]\d+)?\s?(?:million|mil|tr|triệu)\b|\b\d{1,3}(?:[.,]\d{3}){2,}\s?(?:vnd|vnđ|đ|dong)\b/i
/** Japanese, Korean, Chinese: the description is English, and Reach writes the other languages. */
const CJK = /[぀-ヿ㐀-鿿가-힯]/
/** A claim of time that was true on the agency's posting day, not on eno's import day ("Available Now", "JUST LISTED"). */
const TIME_CLAIM = /\b(?:available (?:now|immediately|today)|now available|just listed|new pad alert|vacant now|move[- ]in today)\b/i
/** A unit number ("Celesta Rise T4 0508", "#202", "Unit 1205"): which door, an address — never in a listing text. A bus
 *  route ("Bus Route #46", "Bus Routes Nearby: #31, #64") is not one. */
const UNIT_NUMBER = /\bT\d{1,2}[\s.-]?\d{3,4}\b|(?<!\b(?:routes?|bus(?:es)?)\b[^\n]{0,60})#\d{2,4}\b|\b(?:unit|apt|apartment|room|căn)\s?(?:no\.?\s?)?\d{3,4}\b/i

/** A cost that is not the rent: these may carry their own figure ("management fee approx. $50/month"). */
const FEE_WORD = /\b(?:management|service charge|utilit(?:y|ies)|electric(?:ity)?|water|deposit|parking|cleaning|internet|wi-?fi|gas|fees?|bills?)\b/i
const USD_AMOUNT = /(?:US\$|\$)\s?(\d[\d,]*(?:\.\d+)?)|\b(\d[\d,]*(?:\.\d+)?)\s?(?:usd|us dollars?)\b/gi
const VND_AMOUNT = /\b(\d+(?:[.,]\d+)?)\s?(?:million|mil|tr|triệu)\b|\b(\d{1,3}(?:[.,]\d{3}){2,})\s?(?:vnd|vnđ|đ|dong)\b/gi
const PRICE_LABEL = /^(?:#\s*)?(?:[-*•]\s*)?(?:price|rent|rental(?: rate| price)?|monthly rent|cost|rate)\b/i
export type BodyPrice = { usd: number; vndPerUsd: number }

/**
 * Every money figure on a line, judged against the listing's own rent: 'same' (each figure is the rent, within 2% in US$
 * or 6% in đồng), 'fee' (the line names a cost that is not the rent and its figures are at most 30% of it), else 'conflict'.
 * null when the line has no money figure.
 */
export function linePrice(l: string, p: BodyPrice): 'same' | 'fee' | 'conflict' | null {
  const usd = [...l.matchAll(USD_AMOUNT)].map((m) => Number((m[1] ?? m[2]).replace(/,/g, '')))
  const vnd = [...l.matchAll(VND_AMOUNT)].map((m) => m[1] ? Number(m[1].replace(',', '.')) * 1e6 : Number(m[2].replace(/[.,]/g, '')))
  if (!usd.length && !vnd.length) return BODY_PRICE.test(l) ? 'conflict' : null
  const rentVnd = p.usd * p.vndPerUsd
  const same = usd.every((a) => Math.abs(a - p.usd) <= p.usd * 0.02) && vnd.every((a) => Math.abs(a - rentVnd) <= rentVnd * 0.06)
  if (same) return 'same'
  // A deposit is usually one to three months' rent; any other cost is a fraction of it.
  const limit = /\bdeposit\b/i.test(l) ? 3 : 0.3
  const fee = FEE_WORD.test(l) && usd.every((a) => Math.abs(a - p.usd) <= p.usd * 0.02 || a <= p.usd * limit)
    && vnd.every((a) => Math.abs(a - rentVnd) <= rentVnd * 0.06 || a <= rentVnd * limit)
  return fee ? 'fee' : 'conflict'
}

const TIME_CLAIM_G = new RegExp(TIME_CLAIM.source, 'gi')
const LABEL_VALUE = /^[A-Z][\w &/()'’.-]{0,30}:\s+\S/

/**
 * The reviewed lines, tidied where tidying loses no fact: a line that only restates the rent goes (the page prints its own
 * price section); "Available now" and its kin are cut out (true on the agency's day, not on ours); 'Label: value' lines
 * become list items, so the renderer does not make a second fact sheet of them. Anything else stays as the person left it,
 * and bodyProblem still holds what it must.
 */
export function tidyBody(lines: readonly string[], p: BodyPrice): string[] {
  const out: string[] = []
  for (const raw of lines) {
    let l = raw
    if (TIME_CLAIM.test(l)) {
      l = l.replace(TIME_CLAIM_G, '').replace(/\s*[/|–—-]\s*(?=[.!]?$)/, '').replace(/^\s*[/|–—-]\s*/, '').replace(/\s{2,}/g, ' ').trim()
      if (/^[^:]{1,30}:\s*[.!]?$/.test(l) || !/[A-Za-z]{3}/.test(l)) continue
    }
    if (linePrice(l, p) === 'same' && (PRICE_LABEL.test(l) || l.length <= 80) && !FEE_WORD.test(l)) continue
    out.push(LABEL_VALUE.test(l) && !isListLine(l) ? `- ${l}` : l)
  }
  return out
}

/** Why these body lines cannot be published as they are, or null. */
export function bodyProblem(lines: readonly string[], p?: BodyPrice): { reason: HoldReason; detail: string } | null {
  for (const l of lines) {
    const m = FORBIDDEN.exec(l)
    if (m) return { reason: 'bodyForbidden', detail: `"${m[0]}" in "${l.slice(0, 100)}"` }
    const pm = BODY_PRICE.exec(l)
    if (pm && (!p || linePrice(l, p) === 'conflict')) return { reason: 'bodyPrice', detail: `"${pm[0]}" in "${l.slice(0, 100)}"` }
    if (CJK.test(l)) return { reason: 'bodyNotEnglish', detail: `"${l.slice(0, 60)}"` }
    const tm = TIME_CLAIM.exec(l)
    if (tm) return { reason: 'bodyTimeClaim', detail: `"${tm[0]}" in "${l.slice(0, 100)}"` }
    const um = UNIT_NUMBER.exec(l)
    if (um) return { reason: 'bodyUnitNumber', detail: `"${um[0]}" in "${l.slice(0, 100)}"` }
  }
  // ⚠️ THE RENDERER'S OWN PARSE (rich-text-blocks.ts): a run of 'Label: value' lines is a spec table — a second fact
  // sheet beside the page's own Details (car-partners.ts:25-27; goplus-listing.ts "not a fact sheet"). joinBody's blank
  // lines would split the run into one-line paragraphs, which still read as a fact sheet: judged as if adjacent.
  const table = richTextGroups(lines.join('\n')).find((g) => g.kind === 'dl')
  if (table && table.kind === 'dl') return { reason: 'bodyFactTable', detail: `'Label: value' lines render as a table: ${table.rows.map(([k]) => k).join(', ')}` }
  return null
}

const isListLine = (l: string) => /^(?:[*\-•]\s|[✓✔✅☑]|\d{1,3}[.)]\s)/.test(l)
/**
 * One line, one paragraph: a single newline is a SOFT WRAP in rich-text-blocks.ts, so two prose lines would run together
 * as one. Consecutive list lines stay one list.
 */
export function joinBody(lines: readonly string[]): string {
  let out = ''
  lines.forEach((l, i) => { out += i === 0 ? l : `${isListLine(l) && isListLine(lines[i - 1]) ? '\n' : '\n\n'}${l}` })
  return out
}

// ─── titles ─────────────────────────────────────────────────────────────────────────────────────

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * What the unit is, in each language: "2-bedroom serviced apartment by the night" / "Căn hộ dịch vụ 2PN … theo ngày".
 * The agency files houses and villas under one type ("Villas Mansions"); its own headline says which ("3BR House Near
 * Vinhomes Grand Park" is a house) — a villa only where it says villa or mansion.
 */
function kindWords(kind: Kind, period: Period, beds: number | null, headline: string): { en: string; base: string; tail: string; vi: string; viTail: string } {
  const villa = /\b(?:villas?|mansions?)\b/i.test(headline)
  // A studio, where the agency's headline says so: sources list one as "1 bedroom" (taxonomy.ts aptType), so the count stays.
  const studio = kind !== 'office' && kind !== 'villa' && /\bstudio\b/i.test(headline) && (beds ?? 1) <= 1
  const noun = kind === 'office' ? { en: 'commercial space', vi: 'Mặt bằng' }
    : kind === 'villa' ? (villa ? { en: 'villa', vi: 'Biệt thự' } : { en: 'house', vi: 'Nhà nguyên căn' })
    : kind === 'serviced' ? { en: 'serviced apartment', vi: 'Căn hộ dịch vụ' }
    : kind === 'shortStay' ? { en: 'short-stay apartment', vi: 'Căn hộ ngắn hạn' }
    : { en: 'apartment', vi: 'Căn hộ' }
  const rooms = kind === 'office' ? null : studio ? 'studio' : beds && beds >= 1 ? Math.min(Math.floor(beds), 10) : null
  const base = `${rooms === 'studio' ? 'studio ' : rooms ? `${rooms}-bedroom ` : ''}${noun.en}`
  const tail = period === 'night' ? ' by the night' : period === 'day' ? ' by the day' : ''
  const vi = `${noun.vi}${rooms === 'studio' ? ' studio' : rooms ? ` ${rooms}PN` : ''}`
  return { en: `${base}${tail}`, base, tail, vi, viTail: period === 'month' ? '' : ' theo ngày' }
}

/**
 * The titles, composed by code (PLAN §6), short like the car partners' and GoPlus's — the agency's long headline is theirs,
 * not ours: "2-bedroom apartment, 70 m² · Masteri Centre Point, District 9" / "Căn hộ 2PN 70 m² · Masteri Centre Point,
 * Quận 9". A building's name is spelled as the map spells it, in both languages.
 */
export function saigoncribsTitles(kind: Kind, period: Period, rec: Pick<SaigoncribsRecord, 'beds' | 'title'>, area: number | null, place: SaigoncribsPlace): { title: string; titleVi: string } {
  const w = kindWords(kind, period, rec.beds, rec.title)
  const spot = place.building?.name ?? null
  const whereEn = [spot ?? place.area?.en, place.district.en].filter(Boolean).join(', ')
  const whereVi = [spot ?? place.area?.vi, place.district.vi].filter(Boolean).join(', ')
  return {
    title: `${cap(w.en)}${area ? `, ${area} m²` : ''} · ${whereEn}`,
    titleVi: `${w.vi}${area ? ` ${area} m²` : ''}${w.viTail} · ${whereVi}`,
  }
}

// ─── the row ────────────────────────────────────────────────────────────────────────────────────

export type SaigoncribsRow = {
  externalId: string
  title: string
  titleVi: string
  description: string
  /** ⛔ NULL: Reach's Haiku job writes the Vietnamese (a value here would block it — mt-job.ts). */
  descriptionVi: null
  price: number
  priceUnit: string
  currency: '₫'
  /** As the car partners: no Counter slider on an account whose chats eno answers and passes on. */
  negotiable: false
  listingType: 'rent'
  subcategorySlug: string
  city: string
  district: string
  location: string
  lat: number | null
  lng: number | null
  buildingKey: string | null
  areaM2: number | null
  attributes: string | null
  facetTokens: null
  searchText: string
}

export type SaigoncribsMapped = {
  row: SaigoncribsRow
  postId: number
  postedAt: Date
  usd: number
  period: Period
  place: SaigoncribsPlace
}

export type MapOptions = {
  /** đồng per US dollar, fetched once per run (vndPerUsdFrom). */
  vndPerUsd: number
  /** The run's clock (ms): postedAt is clamped to it, and the FX line is dated with it. */
  now: number
  /** bodies.json's entry for this listing (undefined = none: the row is HELD). */
  body: BodyVerdict | undefined
  buildings?: Record<string, ReverBuilding>
}

const AREA_MAX_M2 = 5000

/**
 * One data.json record → the row create() writes (the storefront, category, photos, status, rank and dates of creation are
 * the script's), or why not. Every refusal names its reason and the evidence, so the dry run explains itself.
 */
export function mapSaigoncribsListing(rec: SaigoncribsRecord, opts: MapOptions): { ok: true; mapped: SaigoncribsMapped } | Refusal {
  const kind = rec.type ? TYPE_MAP[rec.type] : undefined
  if (!kind) return drop('unknownType', `type "${rec.type ?? '(none)'}"`)
  if (rec.status && /leased|occupied|rented|\blet\b/i.test(rec.status)) return drop('leased', `status "${rec.status}"`)
  const price = saigoncribsPrice(rec, kind)
  if (!price.ok) return price
  // A bar sold with its fit-out is a business transfer, not a lease of space (parse.py's flag; 9786, 9799).
  if (rec.flags.some((f) => /business sale|transfer/i.test(f))) return hold('businessTransfer', rec.flags.join('; '))
  const vnd = usdToVnd(price.usd, opts.vndPerUsd)
  const vndBand = price.period === 'month' ? VND_BAND : NIGHT_VND_BAND
  if (vnd < vndBand.min || vnd > vndBand.max) return hold('vndBand', `${vnd} đ from US$${fmtUsd(price.usd)} a ${price.period}`)
  if (rec.vndHint && price.period === 'month' && !within(rec.vndHint.amount, vnd, VND_HINT_TOLERANCE)) {
    return hold('priceConflict', `the agency prints ${rec.vndHint.raw} but US$${fmtUsd(price.usd)} converts to ${vnd} đ`)
  }
  const at = wpDateMs(rec.postedAt)
  const postedAt = nhatotPostedAt(at, opts.now)
  if (!postedAt || !rec.postedAt) return hold('noDate', `posted "${rec.postedAt ?? '(none)'}"`)

  if (!opts.body) return hold('noBodyVerdict', 'no entry in bodies.json')
  if (opts.body.hold) return hold('bodyHold', opts.body.hold)
  const place = saigoncribsPlace(rec, opts.body.lines, opts.buildings)
  if (!place.ok) return place
  const bodyPrice = { usd: price.usd, vndPerUsd: opts.vndPerUsd }
  let body = tidyBody(opts.body.lines, bodyPrice)
  const bp = bodyProblem(body, bodyPrice)
  if (bp) return hold(bp.reason, bp.detail)

  const aisle = saigoncribsAisle(kind, price.period)
  const area = rec.areaM2 !== null && rec.areaM2 > 0 && rec.areaM2 <= AREA_MAX_M2 ? Math.round(rec.areaM2 * 10) / 10 : null
  const { title, titleVi } = saigoncribsTitles(kind, price.period, rec, area, place)
  if (title.length > TITLE_MAX || titleVi.length > TITLE_MAX) return hold('titleTooLong', title)

  /** Vietnamese, like the 'Quận 1 (P. …)' shape the other importers store; HCMC omits the city (`city` carries it). */
  const location = `${place.district.vi}${place.area ? ` (${place.area.vi})` : ''}`
  const whereEn = [place.building?.name ?? place.area?.en, place.district.en].filter(Boolean).join(', ')

  const rate = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(opts.vndPerUsd)
  const priceLines = [
    price.period === 'month' ? `- ${rentLine(price.usd)}` : `- Rent: US$${fmtUsd(price.usd)} a ${price.period}`,
    ...(price.range ? [`- ${SAIGONCRIBS_NAME} quotes US$${fmtUsd(price.range.min)} to US$${fmtUsd(price.range.max)} a ${price.period}, depending on the unit.`] : []),
    `- The đồng price on eno is converted from US dollars (${rate} đ per US$, ${vnDayOf(opts.now)}) and is approximate.`,
  ]
  const w = kindWords(kind, price.period, rec.beds, rec.title)
  const intro = `${cap(w.base)}${area ? ` of ${area} m²` : ''} ${place.building ? 'at' : 'in'} ${whereEn}, Ho Chi Minh City${w.tail ? `, rented${w.tail}` : ''}.`
  const listedOn = listedDay(rec.postedAt)
  const compose = () => [
    body.length ? joinBody(body) : intro,
    `# Price\n${priceLines.join('\n')}`,
    `Listed by ${SAIGONCRIBS_NAME} on ${listedOn}.`,
    `Message ${SAIGONCRIBS_NAME} here on eno to check availability and book a viewing.`,
  ].join('\n\n')
  let description = compose()
  // Too long for an admin's edit (it cuts at DESCRIPTION_MAX, losing the price and date): the body's last lines go first.
  while (description.length > DESCRIPTION_MAX && body.length > 5) { body = body.slice(0, -1); description = compose() }
  if (description.length > DESCRIPTION_MAX) return hold('descriptionTooLong', `${description.length} characters — an admin's edit cuts at ${DESCRIPTION_MAX}, losing the price and date; shorten bodies.json`)

  /**
   * ⛔ THE SCREEN A PERSON'S OWN POST GOES THROUGH (publish-guard assertCleanTexts): phone, email, link, handle, house
   * number, banned words — on everything this row publishes.
   */
  try {
    assertCleanTexts([title, titleVi, location, description])
  } catch (e) {
    if (e instanceof PublishBlockedError) return hold(e.code === 'banned_words' ? 'bannedWords' : 'contactInText', `${e.code}${e.message ? `: ${e.message}` : ''}`)
    throw e
  }

  /** ⛔ ALL STRINGS — attr-match.ts filters with a substring `"key":"value"`, so a number would never match. */
  let attributes: string | null
  if (aisle.daily) attributes = JSON.stringify({ rentalPeriod: 'daily' })
  else if (kind === 'office') attributes = null
  else {
    const rooms = JSON.parse(roomAttributes({ bedrooms: rec.beds, bathrooms: rec.baths }) ?? '{}') as Record<string, string>
    // The agency's own type (honeycomb's mapping): "Serviced / mini" on the apartment-type chip.
    if (kind === 'serviced') rooms.aptType = 'serviced'
    attributes = Object.keys(rooms).length ? JSON.stringify(rooms) : null
  }

  const typeWords = aisle.subcategorySlug === 'homestay-serviced' ? 'serviced apartment short stay căn hộ dịch vụ ngắn hạn'
    : kind === 'office' ? 'commercial space office mặt bằng văn phòng'
    : kind === 'villa' ? 'villa house biệt thự nhà nguyên căn'
    : kind === 'serviced' ? 'serviced apartment căn hộ dịch vụ' : 'apartment căn hộ chung cư'
  return {
    ok: true,
    mapped: {
      postId: rec.id,
      postedAt,
      usd: price.usd,
      period: price.period,
      place,
      row: {
        externalId: saigoncribsExternalId(rec.id),
        title, titleVi, description, descriptionVi: null,
        price: vnd,
        priceUnit: aisle.priceUnit,
        currency: '₫',
        negotiable: false,
        listingType: 'rent',
        subcategorySlug: aisle.subcategorySlug,
        city: CITY_NAME.hcmc,
        district: place.district.vi,
        location,
        // Both or neither, and only from exactly one map building: never a guessed pin.
        lat: place.building?.lat ?? null,
        lng: place.building?.lng ?? null,
        buildingKey: place.building?.slug ?? null,
        areaM2: area,
        attributes,
        facetTokens: null,
        /** ⚠️ title and titleVi FIRST, as every importer writes it (import-i18n.ts rebaseSearchText relies on it). */
        searchText: buildSearchText([title, titleVi, location, place.district.vi, place.district.en, place.area?.en, ...place.buildingNames, SAIGONCRIBS_NAME, typeWords]),
      },
    },
  }
}

// ─── photos ─────────────────────────────────────────────────────────────────────────────────────

/** How many listings show each photo URL — a URL on SHARED_PHOTO_MIN_USES or more is a building shot. */
export function photoUses(recs: readonly Pick<SaigoncribsRecord, 'photos'>[]): Map<string, number> {
  const uses = new Map<string, number>()
  for (const r of recs) for (const u of new Set(r.photos)) uses.set(u, (uses.get(u) ?? 0) + 1)
  return uses
}

/** The candidate photo numbers of a listing: 1..min(20, its photo count). */
export const candidateCount = (rec: Pick<SaigoncribsRecord, 'photos'>) => Math.min(rec.photos.length, SAIGONCRIBS_CANDIDATES)

/**
 * Why a verdict cannot be trusted for this listing, or null. ⛔ EVERY CANDIDATE EXACTLY ONCE, kept or dropped: a verdict
 * naming a photo the listing does not have, or missing one it has, was written for another listing's gallery (or another
 * read of this one) — the run refuses rather than publish photos nobody looked at.
 */
export function photoVerdictProblem(rec: Pick<SaigoncribsRecord, 'id' | 'photos'>, v: PhotoVerdict): string | null {
  const n = candidateCount(rec)
  const all = [...v.keep, ...v.drop.map((d) => d.n)]
  const dup = all.find((x, i) => all.indexOf(x) !== i)
  if (dup !== undefined) return `${rec.id}: photo ${dup} is judged twice`
  const extra = all.find((x) => x > n)
  if (extra !== undefined) return `${rec.id}: photo ${extra} is judged but the listing has ${n} candidates`
  const missing = Array.from({ length: n }, (_, i) => i + 1).find((x) => !all.includes(x))
  if (missing !== undefined) return `${rec.id}: photo ${missing} has no verdict — every candidate is looked at first`
  return null
}

/**
 * The kept photos in the order they are judged and shown: the person's order (cover first), except that BUILDING SHOTS (a
 * URL on SHARED_PHOTO_MIN_USES+ listings: the pool, the lobby) go after the unit's own, so the cover is this unit (PLAN §5).
 */
export function orderedKeep(rec: Pick<SaigoncribsRecord, 'photos'>, v: PhotoVerdict, uses: ReadonlyMap<string, number>): { n: number; shared: boolean }[] {
  const all = v.keep.map((n) => ({ n, shared: (uses.get(rec.photos[n - 1]) ?? 0) >= SHARED_PHOTO_MIN_USES }))
  return [...all.filter((x) => !x.shared), ...all.filter((x) => x.shared)]
}

export type PhotoPlan = { decision: 'create' | 'tooFewPhotos' | 'noOwnPhoto'; keep: number[]; refused: Partial<Record<string, number>>; duplicates: number }
/**
 * The photos a row is written with, from each kept candidate's measurement (import-photo-check.ts imageVerdict, in the
 * order orderedKeep gives): only 'ok' ones (a text card, a logo, a sliver or an undecodable file is left out, so it can
 * never be the cover), the same shot twice once (the publish gate counts DISTINCT angles), at most SAIGONCRIBS_MAX_PHOTOS.
 * Fewer than SAIGONCRIBS_MIN_PHOTOS → not written; no photo of the unit itself left (only building shots) → not written.
 */
export function saigoncribsPhotoPlan(judged: readonly { n: number; shared: boolean; outcome: PhotoOutcome; hash: string | null }[]): PhotoPlan {
  const refused: Partial<Record<string, number>> = {}
  const ok: number[] = []
  judged.forEach((j, i) => { if (j.outcome === 'ok') ok.push(i); else refused[j.outcome] = (refused[j.outcome] ?? 0) + 1 })
  const d = dropNearDuplicates(ok, judged.map((j) => j.hash))
  const idx = d.keep.slice(0, SAIGONCRIBS_MAX_PHOTOS)
  const keep = idx.map((i) => judged[i].n)
  const decision = !idx.some((i) => !judged[i].shared) ? 'noOwnPhoto' : keep.length < SAIGONCRIBS_MIN_PHOTOS ? 'tooFewPhotos' : 'create'
  return { decision, keep, refused, duplicates: d.duplicates }
}

/** The hosted object's slug: the photo's bytes decide it, so a re-run lands on the same name. */
export const saigoncribsPhotoSlug = (sha1Hex: string) => `${SAIGONCRIBS_HANDLE}-${sha1Hex.slice(0, 16)}`

// ─── the storefront ─────────────────────────────────────────────────────────────────────────────

export type SaigoncribsSeller = { id: string; ownerId: string | null; ownerEmail: string | null; officialPartner: boolean; trustScore: number }

/**
 * Why these rows must not go on this storefront, or null — Handle AND owner email AND an owner AND chat-only, as
 * carPartnerSellerRefusal. An ownerless storefront would send a renter's message to nobody; one owned by another address
 * is someone else's shop; one not yet an official partner would show a phone and enter eno's availability checks.
 */
export function saigoncribsSellerRefusal(seller: SaigoncribsSeller | null): string | null {
  if (!seller) return `no storefront with the handle "${SAIGONCRIBS_HANDLE}" — register it first: PARTNER_PASSWORD='…' node --env-file=.env scripts/register-partner-seller.mjs ${SAIGONCRIBS_HANDLE} --apply`
  if (!seller.ownerId) return `the "${SAIGONCRIBS_HANDLE}" storefront (${seller.id}) has no owning account — a renter's message would reach nobody`
  if ((seller.ownerEmail ?? '').toLowerCase() !== SAIGONCRIBS_EMAIL) return `the "${SAIGONCRIBS_HANDLE}" storefront (${seller.id}) is owned by ${seller.ownerEmail ?? 'an account with no email'}, not ${SAIGONCRIBS_EMAIL}`
  if (seller.officialPartner !== true) return `the "${SAIGONCRIBS_HANDLE}" storefront (${seller.id}) is not an official partner yet — run scripts/set-official-partner.mjs ${SAIGONCRIBS_HANDLE} --apply first`
  return null
}
