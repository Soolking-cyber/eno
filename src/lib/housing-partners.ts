/**
 * eno's HOUSING AGENCY PARTNERS (owner, 2026-11-22): Alpha Housing (alphahousing.vn, Hà Nội) and Housing Saigon
 * (housingsgn.com, Ho Chi Minh City) — their rental listings written ONCE on their own storefronts, then eno's admin's.
 *
 * Owner, 2026-11-22: "import this as partner and their offerings https://alphahousing.vn/" and "https://housingsgn.com/
 * this". Asked the same day (AskUserQuestion): Alpha Housing → its listings posted in the last 2 years (57 of 2,466; the
 * rest go back to 2015); housingsgn.com → the last 6 months (535 of 5,718); housingsgn.com IS the "Housing Saigon" store
 * created empty on 2026-11-21 (eno.vn/housingsaigon) — its listings go there. And for every partner the same day: "same as
 * saigon cribs vnd prices shown, use card price": PRICES ARE SHOWN IN ĐỒNG ONLY.
 *
 * The shape is Saigon Cribs' (saigoncribs-listing.ts, 2026-11-18): an agency's apartments, houses and villas by the month,
 * titles composed by code, EN description only (Reach's daily Haiku job writes the other ten languages: a filled
 * `descriptionVi` would block it — mt-job.ts), dated with the agency's own post date. Pure — the I/O is
 * scripts/import-housing-partners.ts, reading the research in ~/eno-housing-partners-2026-11-22/<research>/data.json
 * (parse.py, from the saved pages; nothing is read live).
 *
 * ⛔ NOTHING IS GUESSED. A listing the agency marks Rented, with no monthly price, a price outside the plausible band, or a
 * place this module cannot name (a district, or for Hà Nội a known compound) is not written and the run says why.
 * Pins come only from eno's own building map (REVER_BUILDINGS, HCMC) — Hà Nội and Đà Nẵng listings carry their district,
 * no pin.
 *
 * CVR — CENTRAL VIETNAM REALTY (cvr.com.vn, Đà Nẵng and Hội An), owner 2026-11-23. Asked to import anhducproperty.com, which
 * turned out to be a copy of CVR's site (theme "cvr-clone", every listing's source field a cvr.com.vn page, CVR's agents),
 * the owner chose "Partner with CVR instead"; then homes for rent posted in the last 12 months plus office/retail from the
 * same window, rentals only (no sales). Its price is its card's, in đồng at the run's rate like every partner's (the
 * owner's "use card price"). CVR's cards print US dollars "for orientation" and its text often states the rent in đồng:
 * a listing whose text states a rent the card does not match is HELD (`statesDong`, rentConflict) — the text's figures
 * only ever hold a listing, never set its price (commit-gate review, codex + Opus, two rounds: picking a figure out of
 * free text could mistake a deposit or a furniture package for the rent).
 *
 * ⛔ NO PHONE, LINK, EMAIL, HOUSE NUMBER OR VISA LINE in any text: parse.py drops such lines from Alpha's descriptions (kept
 * in `removed` for audit), and assertCleanTexts — the screen a person's own post meets — holds a row that still has one.
 * ⛔ A DOLLAR FIGURE IN THE AGENCY'S OWN TEXT ("Electricity and tap water: 70 usd/month") is rewritten in đồng at the
 * run's rate, marked "about" (dollarsToDong).
 */
import { buildSearchText } from './fold'
import { CITY_NAME, CITY_NAME_EN, USD_MONTHLY_BAND, VND_BAND, districtOf, usdToVnd } from './honeycomb-listing'
import { PublishBlockedError, assertCleanTexts } from './publish-guard'
import { buildingsNamed, listedDay, wpDateMs } from './saigoncribs-listing'
import { nhatotPostedAt } from './nhatot-listing'
import { listingMoneyFor, roomAttributes } from './taxonomy'
import { HANOI_DISTRICTS } from './teachers/district-hanoi'
import { formatMoneyFull } from './vnd'
import { REVER_BUILDINGS, type ReverBuilding } from '../generated/rever-buildings'

export type HousingPartnerHandle = 'alphahousing' | 'housingsaigon' | 'cvr'

export type HousingPartner = {
  handle: HousingPartnerHandle
  name: string
  /** eno-held login (support+<handle>@eno.vn). */
  email: string
  city: 'hanoi' | 'hcmc' | 'danang'
  /** The storefront's address (Seller.location), as the agency's site prints it. Never in a listing text. */
  address: string
  /** ~/eno-housing-partners-2026-11-22/<research>/ */
  research: string
  /** The agency's own terms, one line each, only what its site states (read 2026-11-22). */
  terms: readonly string[]
  /** Its text states rents in đồng (CVR): a stated rent the card does not match holds the listing (rentConflict). */
  statesDong?: boolean
}

export const HOUSING_PARTNERS: readonly HousingPartner[] = [
  {
    handle: 'alphahousing', name: 'Alpha Housing', email: 'support+alphahousing@eno.vn', city: 'hanoi', research: 'alphahousing', terms: [],
    address: 'Phòng 809, Tòa nhà Vườn Đào, 689 Lạc Long Quân, Tây Hồ, Hà Nội',
  },
  {
    handle: 'housingsaigon', name: 'Housing Saigon', email: 'support+housingsaigon@eno.vn', city: 'hcmc', research: 'housingsgn',
    address: '1/6 Hồ Biểu Chánh, Phường 12, Phú Nhuận, Thành phố Hồ Chí Minh',
    // Every housingsgn.com property page, beside its enquiry form.
    terms: ['Minimum contract: 6 months for a serviced apartment, 12 months for an apartment or condo.'],
  },
  {
    // The office its site's contact page and footer print (read 2026-11-23); no shared terms — each listing states its own.
    handle: 'cvr', name: 'Central Vietnam Realty', email: 'support+cvr@eno.vn', city: 'danang', research: 'cvr', terms: [], statesDong: true,
    address: '333 Chuong Duong Street, Ngu Hanh Son, Da Nang',
  },
]
export const housingPartner = (handle: string) => HOUSING_PARTNERS.find((p) => p.handle === handle)

/** One property as parse.py wrote it (data.json `records`). */
export type HousingRecord = {
  /** The agency's post id (a WordPress number; CVR's own uuid). */
  id: number | string
  link: string
  date: string
  title: string
  priceUsd: number | null
  unit: string | null
  status: string | null
  beds: number | null
  baths: number | null
  areaM2: number | null
  kind: 'apartment' | 'serviced' | 'villa' | 'house' | 'studio' | 'penthouse' | 'office' | 'commercial'
  city: string | null
  /** The compound / building ("Ciputra", "The River Thu Thiem"), as the agency names it. */
  building: string | null
  /** The district as the agency names it ("District 2", "Tay Ho"); Alpha's is often a compound, its tag in `districtTax`. */
  district: string | null
  districtTax?: string[]
  description: string[]
  features: string[]
  photos: string[]
}

export const housingExternalId = (p: HousingPartner, id: number | string) => `${p.handle}:${id}`

// ─── place ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Alpha Housing's compound tags → Hà Nội's districts (HANOI_DISTRICTS keys). Each is where the compound stands; a tag not
 * here holds the row. (Ciputra spans Tây Hồ and Bắc Từ Liêm: its gate, clubhouse and address are Tây Hồ.)
 */
const ALPHA_COMPOUNDS: Readonly<Record<string, string>> = {
  'ciputra': 'hn-tay-ho',
  'd le roi soleil': 'hn-tay-ho',
  'heritage west lake': 'hn-tay-ho',
  'watermark': 'hn-tay-ho',
  'starlake': 'hn-tay-ho',
  'vinhomes riverside': 'hn-long-bien',
  'vinhomes symphony': 'hn-long-bien',
  'sunshine city': 'hn-bac-tu-liem',
  'diplomatic corps complex': 'hn-bac-tu-liem',
  'vinhomes metropolis': 'hn-ba-dinh',
  'indochina plaza': 'hn-cau-giay',
}
const key = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Đà Nẵng's districts as CVR names them (folded) → [vi, en]. ⚠️ Arrays, not `{ en, vi }` literals (gen-ui-strings). */
const DANANG_DISTRICTS: Readonly<Record<string, readonly [string, string]>> = {
  'hai chau': ['Hải Châu', 'Hai Chau'],
  'son tra': ['Sơn Trà', 'Son Tra'],
  'ngu hanh son': ['Ngũ Hành Sơn', 'Ngu Hanh Son'],
  'thanh khe': ['Thanh Khê', 'Thanh Khe'],
  'cam le': ['Cẩm Lệ', 'Cam Le'],
  'lien chieu': ['Liên Chiểu', 'Lien Chieu'],
  'hoa vang': ['Hòa Vang', 'Hoa Vang'],
}
/** Hội An — part of Đà Nẵng city since the 2025 merger; CVR files it as its own city, its wards as districts. */
const HOI_AN: readonly [string, string] = ['Hội An', 'Hoi An']

const titleCase = (s: string) => s.replace(/\S+/g, (w) => (/^[^AEIOUY]{1,4}$/i.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))

/**
 * The agency's project ("FPT Plaza 2 Apartment Da Nang" → "FPT Plaza 2") — only when the listing's own title names it too:
 * CVR links some listings to the wrong project (a FUTA Residence flat filed under "Times Square", a Panoma unit under
 * "Sun Cosmo"), and a wrong building in a title is worse than none.
 */
export function projectCompound(project: string | null, title: string): string | null {
  if (!project) return null
  const name = project.split(/\s[–—-]\s/)[0]
    .replace(/\b(?:da ?nang|danang|viet ?nam|apartments?|project|condotel|luxury)\b/gi, ' ').replace(/\s+/g, ' ').trim()
  // The name's words, in order, as a phrase of the title (a plural counts: "SAM TOWERS" names "Sam Tower"); one word alone
  // must be a long one ("Filmore"), or "Sun Residence"'s "sun" would match "Sun-filled".
  const words = (s: string) => key(s).split(' ').filter((w) => w && w !== 'the' && w !== 'and')
  const core = words(name)
  const t = words(title)
  const same = (a: string, b: string) => a === b || a === `${b}s` || `${a}s` === b
  const at = core.length ? t.findIndex((_, i) => core.every((w, j) => t[i + j] !== undefined && same(t[i + j], w))) : -1
  if (at < 0 || (core.length === 1 && core[0].length < 6)) return null
  return name === name.toUpperCase() ? titleCase(name) : name
}

export type HousingPlace = { district: { vi: string; en: string }; compound: string | null; building: ReverBuilding | null }

/** Where a record is, or null (the row is held). */
export function housingPlace(p: HousingPartner, r: HousingRecord, buildings: Record<string, ReverBuilding> = REVER_BUILDINGS): HousingPlace | null {
  if (p.city === 'danang') {
    const city = key(r.city ?? '')
    const d = city === 'hoi an' ? HOI_AN : city === 'da nang' ? DANANG_DISTRICTS[key(r.district ?? '')] : undefined
    return d ? { district: { vi: d[0], en: d[1] }, compound: projectCompound(r.building, r.title), building: null } : null
  }
  if (p.city === 'hanoi') {
    for (const tag of [...(r.districtTax ?? []), r.district ?? '']) {
      const k = key(tag)
      const hd = HANOI_DISTRICTS.find((d) => key(d.en) === k) ?? HANOI_DISTRICTS.find((d) => d.key === ALPHA_COMPOUNDS[k])
      if (hd) return { district: { vi: hd.vi, en: hd.en }, compound: ALPHA_COMPOUNDS[k] ? tag.trim() : null, building: null }
    }
    return null
  }
  const district = districtOf(r.district, null)
  if (!district) return null
  // A pin only from eno's own map, and only when the agency's building name matches exactly one of its buildings there.
  const hits = r.building ? buildingsNamed(r.building, buildings).filter((b) => !b.district || b.district === district.vi) : []
  return { district, compound: r.building?.trim() || null, building: hits.length === 1 ? hits[0] : null }
}

// ─── text ───────────────────────────────────────────────────────────────────────────────────────

const dong = (n: number) => formatMoneyFull(n, '₫', 'en')
/** "$1,200", "1200 usd", "70 USD", "1,200$" — a dollar amount in the agency's own words. */
/** An amount: thousands grouped by a comma OR a dot ("1,200", "1.200" — agencies here write both), or plain digits. */
const AMOUNT = String.raw`(\d{1,3}(?:[,.]\d{3})+|\d+)`
/** "US$1,200", "USD 70", "$950", then "70 usd", "1.200 USD", "950$" — prefix forms first, so "US$" is eaten whole. */
const DOLLARS = new RegExp(String.raw`(?:US\$|USD|\$)\s?${AMOUNT}(?![\d.,]*\d)|(?<![\d.,])${AMOUNT}\s?(?:USD|US\$|\$)`, 'gi')
/** Anything dollar-like left after the rewrite: such a line is DROPPED (fail closed), never published half-converted. */
// "50 đô" is fifty dollars; "đô thị" (urban) is not money, so only a number before it counts.
const DOLLAR_LEFT = /\$|usd|\bdollars?\b|\d\s*đô(?!\p{L})/iu
/** A range or a pair of amounts around one currency mark ("50-60 USD", "$700 - 800", "700 to 800$"): never rewritten. */
const DOLLAR_RANGE = /\d[\d,.]*\s?(?:[-–~]|to)\s?(?:US\$|USD|\$)?\s?\d[\d,.]*\s?(?:USD|US\$|\$)|(?:US\$|USD|\$)\s?\d[\d,.]*\s?(?:[-–~]|to)\s?\d/i

/**
 * The agency's line with every dollar amount in đồng at the run's rate, marked approximate — or null when a dollar figure
 * it cannot read is left (a range "$700-800", a decimal): that line is not published (commit-gate review, codex + Opus).
 */
export function dollarsToDong(line: string, vndPerUsd: number): string | null {
  if (DOLLAR_RANGE.test(line)) return null
  const out = line.replace(DOLLARS, (_m, a?: string, b?: string) => `about ${dong(usdToVnd(Number((a ?? b ?? '0').replace(/[,.]/g, '')), vndPerUsd))}`)
  return DOLLAR_LEFT.test(out) || /about [\d,]+ đ\s?[-–]\s?\d/.test(out) ? null : out
}

/**
 * Every đồng amount the agency's text states: "VND 16 million", "16,000,000 VND", "70 triệu VNĐ", "Rent: 12 million/month",
 * "VND 2.3 million". A bare number with no đồng mark and no "million" before a month is not read.
 */
// The number, then "million"/"triệu" (plural too) only as a whole word; the đồng mark may touch it ("16.000.000đ").
const DONG_AMOUNT = /(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d{1,2})?)(?:\s?(millions?|mil|triệu|tr)(?![\p{L}]))?(?![\d])/giu
const DONG_MARK = /(?:^|[^\p{L}])(?:vnd|vnđ|đồng|dong|đ)(?![\p{L}])/iu
export function dongFigures(text: string): number[] {
  const out: number[] = []
  for (const m of text.matchAll(DONG_AMOUNT)) {
    const [whole, num, mult] = m
    const at = m.index ?? 0
    const near = text.slice(Math.max(0, at - 6), at) + ' ' + text.slice(at + whole.length, at + whole.length + 6)
    if (/^[.,]?\d/.test(text.slice(at + whole.length))) continue
    const monthly = /^\s?(?:vnd|vnđ)?\s?(?:\/\s?(?:month|mo|tháng)|per month|a month|mỗi tháng)/iu.test(text.slice(at + whole.length))
    if (!DONG_MARK.test(near) && !(mult && monthly)) continue
    if (mult) {
      if (/[.,]\d{3}/.test(num)) continue // "1,200 million" is not a rent
      out.push(Math.round(Number(num.replace(',', '.')) * 1_000_000))
    } else {
      // Grouped ("16,000,000", "16.000.000") or plain digits ("16000000") — a plain run only beside a đồng mark (checked above).
      const grouped = /[.,]\d{3}/.test(num)
      if (!grouped && /[.,]/.test(num)) continue
      out.push(Number(num.replace(/[.,]/g, '')))
    }
  }
  return out.filter((n) => n >= VND_BAND.min && n <= VND_BAND.max)
}
/**
 * How far the card, at the run's rate, may sit from a rent the text states. Measured 2026-11-23 on CVR's 100 rentals:
 * 40 of the 42 stated rents sit within 3 % of the card (its rate is weeks old); the two at 7 % and 9 % are held — the
 * headline must not sit far from the agency's own figure (commit-gate review, Opus).
 */
export const STATED_TOLERANCE = 0.05

/** A line about the rent ("Rent:", "Giá thuê", "… /month"). */
const RENT_LINE = /\brent(?:al)?\b|\bprice\b|\blease\b|giá|thuê|\/\s?(?:month|mo|tháng)\b|per month|a month|mỗi tháng/iu

/**
 * The đồng rents the text states that the card does not match, or null. Every figure on a line about the rent counts as a
 * candidate (a deposit beside it, a second unit's rent too); the listing is held only when NONE is near the card — so a
 * misread figure can only fail to hold, or hold, never set a price.
 */
export function rentConflict(p: HousingPartner, r: HousingRecord, vndPerUsd: number): number[] | null {
  if (!p.statesDong) return null
  const card = usdToVnd(r.priceUsd ?? 0, vndPerUsd)
  const stated = [...new Set([r.title, ...r.description].filter((l) => RENT_LINE.test(l)).flatMap(dongFigures))]
  return stated.length && !stated.some((n) => Math.abs(n - card) <= card * STATED_TOLERANCE) ? stated : null
}

/** Mostly Vietnamese text: the description slot is English (Haiku writes the rest from it), so such a listing is held. */
const VI_LETTER = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/giu
// Vietnamese prose marks a fifth or more of its letters; English naming places (Thảo Điền, Tây Hồ) a few in a hundred.
export const looksVietnamese = (t: string) => (t.match(VI_LETTER)?.length ?? 0) > Math.max(12, (t.match(/\p{L}/gu)?.length ?? 0) * 0.1)

/** Visa / work-permit / immigration / agency-perk lines: not carried on eno.vn (CLAUDE.md's legal boundary). */
const PERK = /\bvisa|work ?permit|temporary residence (card|permit)|\btrc\b|immigration|airport (pick|transfer)|cash ?back|commission/i

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * What the unit is, in each language, and its aisle. ⚠️ [en, vi] pairs, not `{ en, vi }` literals: gen-ui-strings.mjs
 * harvests those as interface copy, and these are listing text.
 */
type HousingAisle = 'apartment-rental' | 'house-rental' | 'office-rental'
const NOUNS: Record<HousingRecord['kind'], [string, string, HousingAisle]> = {
  villa: ['villa', 'Biệt thự', 'house-rental'],
  house: ['house', 'Nhà nguyên căn', 'house-rental'],
  serviced: ['serviced apartment', 'Căn hộ dịch vụ', 'apartment-rental'],
  penthouse: ['penthouse', 'Căn hộ penthouse', 'apartment-rental'],
  studio: ['apartment', 'Căn hộ', 'apartment-rental'],
  apartment: ['apartment', 'Căn hộ', 'apartment-rental'],
  office: ['office space', 'Văn phòng', 'office-rental'],
  commercial: ['commercial space', 'Mặt bằng', 'office-rental'],
}
/** A place to live (rooms count) — not an office or a shop front. */
const isHome = (r: HousingRecord) => r.kind !== 'office' && r.kind !== 'commercial'
function noun(r: HousingRecord): { en: string; vi: string; aisle: HousingAisle } {
  const [en, vi, aisle] = NOUNS[r.kind] ?? NOUNS.apartment
  return { en, vi, aisle }
}

export function housingTitles(r: HousingRecord, place: HousingPlace, area: number | null): { title: string; titleVi: string } {
  const n = noun(r)
  const studio = isHome(r) && (r.kind === 'studio' || (/\bstudio\b/i.test(r.title) && (r.beds ?? 1) <= 1))
  const rooms = studio ? 'studio' : isHome(r) && r.beds && r.beds >= 1 ? Math.min(r.beds, 10) : null
  const spot = place.building?.name ?? place.compound
  const where = (d: string) => [spot, d].filter(Boolean).join(', ')
  return {
    title: `${cap(`${rooms === 'studio' ? 'studio ' : rooms ? `${rooms}-bedroom ` : ''}${n.en}`)}${area ? `, ${area} m²` : ''} · ${where(place.district.en)}`,
    titleVi: `${n.vi}${rooms === 'studio' ? ' studio' : rooms ? ` ${rooms}PN` : ''}${area ? ` ${area} m²` : ''} · ${where(place.district.vi)}`,
  }
}

// ─── the row ────────────────────────────────────────────────────────────────────────────────────

export type HousingRow = {
  externalId: string
  title: string
  titleVi: string
  description: string
  /** ⛔ NULL: Reach's Haiku job writes the Vietnamese (a value here would block it — mt-job.ts). */
  descriptionVi: null
  price: number
  priceUnit: string
  currency: '₫'
  negotiable: false
  listingType: 'rent'
  subcategorySlug: HousingAisle
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

export type HousingRefusal = { ok: false; kind: 'drop' | 'hold'; reason: string; detail: string }
const drop = (reason: string, detail: string): HousingRefusal => ({ ok: false, kind: 'drop', reason, detail })
const hold = (reason: string, detail: string): HousingRefusal => ({ ok: false, kind: 'hold', reason, detail })

const AREA_MIN_M2 = 10
const AREA_MAX_M2 = 5000
const DESCRIPTION_MAX = 5000
const TITLE_MAX = 140
const FEATURES_MAX = 24

export type HousingMapOptions = { vndPerUsd: number; now: number; buildings?: Record<string, ReverBuilding> }

/** One record → the row create() writes (storefront, category, photos, status and rank are the script's), or why not. */
export function mapHousingRecord(p: HousingPartner, r: HousingRecord, opts: HousingMapOptions): { ok: true; row: HousingRow; postedAt: Date } | HousingRefusal {
  if (r.status && /rented|leased|occupied|\blet\b|sold|pending/i.test(r.status)) return drop('rented', `status "${r.status}"`)
  // A sale filed among the rentals ("… FOR SALE", not "for sale or rent"), or — for an office or shop — a business
  // transfer ("Lease / Transfer", "Café for Transfer"); a home's "airport transfer" is a perk, not a sale.
  if (/\bfor sale\b(?!\s*(?:or|\/|&|and)\s*(?:for\s+)?rent)|sang nhượng/i.test(r.title) || (!isHome(r) && /\btransfer\b/i.test(r.title))) return drop('notForRent', r.title)
  if (!r.priceUsd || r.unit !== 'month') return drop('noMonthlyPrice', `price ${r.priceUsd ?? '(none)'} / ${r.unit ?? '(none)'}`)
  if (r.priceUsd < USD_MONTHLY_BAND.min || r.priceUsd > 20_000) return hold('priceBand', `US$${r.priceUsd} a month`)
  // A whole residential building let to an operator is not a home to rent.
  if (isHome(r) && (/\bapartment building\b|\b\d+-unit\b|\b(?:whole|entire) building\b/i.test(r.title) || (r.beds ?? 0) > 8)) return hold('wholeBuilding', r.title)
  // The agency's own title says how many bedrooms ("HIGH-FLOOR 3-BEDROOM APARTMENT"); a bedroom field that disagrees
  // would print a wrong count in the title eno composes.
  const titleBeds = isHome(r) ? /\b(\d{1,2})\s?-?\s?(?:bed(?:room)?s?|br|bdr|pn)\b/i.exec(r.title) : null
  if (titleBeds && r.beds != null && Number(titleBeds[1]) !== r.beds) return hold('bedsConflict', `title "${titleBeds[0]}" vs ${r.beds} bedroom(s)`)
  const vnd = usdToVnd(r.priceUsd, opts.vndPerUsd)
  const conflict = rentConflict(p, r, opts.vndPerUsd)
  if (conflict) return hold('priceConflict', `US$${r.priceUsd} (${dong(vnd)}) vs the text's ${conflict.map(dong).join(' / ')}`)
  if (vnd < VND_BAND.min || vnd > VND_BAND.max) return hold('vndBand', `${vnd} đ`)
  if (looksVietnamese(r.description.join(' '))) return hold('notEnglish', r.title)
  const postedAt = nhatotPostedAt(wpDateMs(r.date), opts.now)
  if (!postedAt) return hold('noDate', `posted "${r.date}"`)
  const place = housingPlace(p, r, opts.buildings)
  if (!place) return hold('noPlace', `district "${r.district ?? '(none)'}"${r.districtTax?.length ? `, tags ${r.districtTax.join(' / ')}` : ''}`)

  const area = r.areaM2 && r.areaM2 >= AREA_MIN_M2 && r.areaM2 <= AREA_MAX_M2 ? r.areaM2 : null
  const { title, titleVi } = housingTitles(r, place, area)
  if (title.length > TITLE_MAX || titleVi.length > TITLE_MAX) return hold('titleTooLong', title)
  const n = noun(r)
  const cityEn = CITY_NAME_EN[p.city]
  const where = [place.building?.name ?? place.compound, place.district.en].filter(Boolean).join(', ')
  const home = isHome(r)
  const rooms = [home && r.beds ? `${r.beds} bedroom${r.beds === 1 ? '' : 's'}` : null, home && r.baths ? `${r.baths} bathroom${r.baths === 1 ? '' : 's'}` : null, area ? `${area} m²` : null].filter(Boolean).join(', ')
  const intro = `${cap(n.en)} for rent ${place.building || place.compound ? 'at' : 'in'} ${where}, ${cityEn}${rooms ? `: ${rooms}` : ''}.`
  // The agency's lines; the short ones after a "…included:" line are its list, so they stay a list.
  // A list ends at its 15th item or at a full sentence of prose (> 60 characters ending in a full stop).
  const body: string[] = []
  let listed = -1
  for (const raw of r.description) {
    const l = dollarsToDong(raw, opts.vndPerUsd)
    if (!l || l.length < 2 || PERK.test(l)) continue
    const prose = l.length > 60 && /[.!?]$/.test(l)
    if (listed >= 0 && listed < 15 && l.length <= 120 && !l.endsWith(':') && !prose) { body.push(`- ${l.replace(/^[-–•*]\s*/, '')}`); listed++; continue }
    listed = l.endsWith(':') ? 0 : -1
    body.push(l)
  }
  // The agency's feature words, screened as its text is (a fee or a visa perk among them is not published).
  const feats = [...new Set(r.features.map((f) => dollarsToDong(f.trim(), opts.vndPerUsd)).filter((f): f is string => !!f && !PERK.test(f)))].slice(0, FEATURES_MAX)
  const rate = formatMoneyFull(opts.vndPerUsd, '₫', 'en')
  // A list item joins the line before it with one newline (one list); every other line is its own paragraph.
  const joinBody = (lines: string[]) => lines.map((l, i) => (i && l.startsWith('- ') ? `\n${l}` : `${i ? '\n\n' : ''}${l}`)).join('')
  const compose = (lines: string[]) => [
    intro,
    ...(lines.length ? [joinBody(lines)] : []),
    ...(feats.length ? [`# Features\n${feats.join(' · ')}`] : []),
    `# Price\n- Rent: ${dong(vnd)} a month\n${p.terms.map((t) => `- ${t}\n`).join('')}- Prices the agency sets in US dollars are shown in đồng at ${rate} per US dollar, so they are approximate.`,
    `Listed by ${p.name} on ${listedDay(r.date)}. Message ${p.name} here on eno to check availability and book a viewing.`,
  ].join('\n\n')
  let lines = body
  let description = compose(lines)
  while (description.length > DESCRIPTION_MAX && lines.length > 3) { lines = lines.slice(0, -1); description = compose(lines) }
  if (description.length > DESCRIPTION_MAX) return hold('descriptionTooLong', `${description.length} characters`)

  const location = `${place.district.vi}${place.compound && !place.building ? ` (${place.compound})` : ''}`
  try {
    assertCleanTexts([title, titleVi, location, description])
  } catch (e) {
    if (e instanceof PublishBlockedError) return hold(e.code === 'banned_words' ? 'bannedWords' : 'contactInText', `${e.code}${e.message ? `: ${e.message}` : ''}`)
    throw e
  }

  /** ⛔ ALL STRINGS — attr-match.ts filters with a substring `"key":"value"`. */
  const attrs = home ? JSON.parse(roomAttributes({ bedrooms: r.beds, bathrooms: r.baths }) ?? '{}') as Record<string, string> : {}
  if (r.kind === 'serviced') attrs.aptType = 'serviced'
  const money = listingMoneyFor({ categorySlug: 'rentals', listingType: 'rent', rentalPeriod: 'monthly' })
  return {
    ok: true,
    postedAt,
    row: {
      externalId: housingExternalId(p, r.id),
      title, titleVi, description, descriptionVi: null,
      price: vnd, priceUnit: money.priceUnit, currency: '₫', negotiable: false, listingType: 'rent',
      subcategorySlug: n.aisle,
      city: CITY_NAME[p.city],
      district: place.district.vi,
      location,
      lat: place.building?.lat ?? null,
      lng: place.building?.lng ?? null,
      buildingKey: place.building?.slug ?? null,
      areaM2: area,
      attributes: Object.keys(attrs).length ? JSON.stringify(attrs) : null,
      facetTokens: null,
      /** ⚠️ title and titleVi FIRST, as every importer writes it (import-i18n.ts rebaseSearchText relies on it). */
      searchText: buildSearchText([title, titleVi, location, place.district.vi, place.district.en, place.compound, place.building?.name, p.name,
        n.aisle === 'office-rental' ? 'office commercial space shop văn phòng mặt bằng cho thuê' : n.aisle === 'house-rental' ? 'villa house biệt thự nhà nguyên căn' : r.kind === 'serviced' ? 'serviced apartment căn hộ dịch vụ' : 'apartment căn hộ chung cư']),
    },
  }
}

export type HousingSeller = { id: string; ownerId: string | null; ownerEmail: string | null; officialPartner: boolean; trustScore: number }

/** Why these rows must not go on this storefront, or null — handle AND owner email AND official partner. */
export function housingSellerRefusal(p: HousingPartner, seller: HousingSeller | null): string | null {
  if (!seller) return `no storefront with the handle "${p.handle}" — register it first (scripts/register-partner-seller.mjs ${p.handle} --apply)`
  if (!seller.ownerId) return `the "${p.handle}" storefront (${seller.id}) has no owning account`
  if ((seller.ownerEmail ?? '').toLowerCase() !== p.email) return `the "${p.handle}" storefront (${seller.id}) is owned by ${seller.ownerEmail ?? 'an account with no email'}, not ${p.email}`
  if (!seller.officialPartner) return `the "${p.handle}" storefront (${seller.id}) is not an official partner yet`
  return null
}
