/**
 * COVER LESSONS — the ONE definition of a teacher's cover availability (owner, 2026-10-07: "if the toggle
 * open to cover lessons too new fields added … schools can find them see their availability and message
 * them to take on the cover in areas they selected by district").
 *
 * An ADD-ON to the job-seeking profile, never a profile of its own: weekly free periods picked by tap
 * (day × morning/afternoon/evening), one hourly rate in VND, and the areas the teacher will travel to.
 * Stored on TeacherProfile (coverOpen/coverSlots/coverAreas/coverRateVnd) and projected, ONLY while cover
 * is open, into the teacher Listing's `facetTokens` as `cover:open`, `coverSlot:<slot>`, `coverArea:<key>`.
 *
 * Pure and import-light: the form, the publish core, the attr filter (src/lib/attr-match.ts) and the
 * taxonomy all read it. ⛔ It must NOT import the taxonomy — the taxonomy builds its cover facets from here.
 */
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'

export const COVER_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export const COVER_PARTS = ['am', 'pm', 'eve'] as const
export type CoverDay = (typeof COVER_DAYS)[number]
export type CoverPart = (typeof COVER_PARTS)[number]

/**
 * ⛔ ONE COMBINED KEY PER SLOT — `mon-am`, never a day token plus a part token. Attribute filters AND across
 * keys and take one value per key (attr-match.ts `attrFiltersFrom`), so separate `day:mon` + `part:am`
 * tokens would let a teacher free on Monday AFTERNOON and Tuesday MORNING match "Monday morning".
 */
export const COVER_SLOTS: readonly string[] = COVER_DAYS.flatMap((d) => COVER_PARTS.map((p) => `${d}-${p}`))

// ⚠️ `enShort`/`viShort` are deliberately NOT an `…En`/`…Vi` pair: gen-ui-strings would harvest them, and a bare "Mon" or
// "Sun" through machine translation came back as ko "my" and "the sun" (preview check, 2026-10-07). The other UI languages
// get their weekday names from Intl instead — coverDayShort below.
export const COVER_DAY_LABELS: Record<CoverDay, { en: string; vi: string; enShort: string; viShort: string }> = {
  mon: { en: 'Monday', vi: 'Thứ 2', enShort: 'Mon', viShort: 'T2' },
  tue: { en: 'Tuesday', vi: 'Thứ 3', enShort: 'Tue', viShort: 'T3' },
  wed: { en: 'Wednesday', vi: 'Thứ 4', enShort: 'Wed', viShort: 'T4' },
  thu: { en: 'Thursday', vi: 'Thứ 5', enShort: 'Thu', viShort: 'T5' },
  fri: { en: 'Friday', vi: 'Thứ 6', enShort: 'Fri', viShort: 'T6' },
  sat: { en: 'Saturday', vi: 'Thứ 7', enShort: 'Sat', viShort: 'T7' },
  sun: { en: 'Sunday', vi: 'Chủ nhật', enShort: 'Sun', viShort: 'CN' },
}

/** Evening is not an afterthought: Vietnam's language centres teach most of their classes 17:30–21:00. */
export const COVER_PART_LABELS: Record<CoverPart, { en: string; vi: string; hours: string }> = {
  am: { en: 'Morning', vi: 'Sáng', hours: '7–12' },
  pm: { en: 'Afternoon', vi: 'Chiều', hours: '12–17' },
  eve: { en: 'Evening', vi: 'Tối', hours: '17–21' },
}

export function parseCoverSlot(slot: string): { day: CoverDay; part: CoverPart } | null {
  const [d, p] = slot.split('-')
  return (COVER_DAYS as readonly string[]).includes(d) && (COVER_PARTS as readonly string[]).includes(p)
    ? { day: d as CoverDay, part: p as CoverPart }
    : null
}

/**
 * A weekday's short name in the reader's language: the authored labels for English and Vietnamese, and for every
 * machine-translated UI language its own name from Intl — never MT, which read a bare "Mon"/"Wed"/"Sun" as ko "my",
 * "marriage", "the sun" (preview check, 2026-10-07). 2024-01-01 was a Monday.
 */
export function coverDayShort(day: CoverDay, lang: string): string {
  const own = COVER_DAY_LABELS[day]
  if (lang === 'vi') return own.viShort
  if (lang === 'en') return own.enShort
  try {
    return new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + COVER_DAYS.indexOf(day))))
  } catch {
    return own.enShort
  }
}

/** "Monday morning" / "Sáng Thứ 2" — Vietnamese names the part of the day first. */
export function coverSlotLabel(slot: string, lang: string): string {
  const s = parseCoverSlot(slot)
  if (!s) return slot
  const day = COVER_DAY_LABELS[s.day]
  const part = COVER_PART_LABELS[s.part]
  return lang === 'vi' ? `${part.vi} ${day.vi}` : `${day.en} ${part.en.toLowerCase()}`
}

export const COVER_LIMITS = {
  rateMin: 50_000,
  rateMax: 2_000_000,
  slots: COVER_SLOTS.length,
  /** ≥ every area there is (12 city-wide + HCMC's districts = 38), so normalisation never silently cuts a pick. */
  areas: 40,
} as const

/** Quick picks for the rate field (VND per hour). */
export const COVER_RATE_PRESETS = [200_000, 300_000, 400_000, 500_000] as const

/**
 * The version of the cover-publication notice a teacher agrees to (TeacherProfile.coverConsentVersion).
 * ⛔ BUMP IT WHENEVER THE NOTICE'S MEANING CHANGES — what is shown, to whom, or for how long — so the
 * record says which words each teacher actually accepted (VN PDP Law 91/2025: consent must be provable).
 * ⚠️ A BUMP HIDES OLD GRANTS ON THE PROFILE AT ONCE (teacher-profile-view.tsx checks the version) and makes every
 * cover save ask for the new tick — but the search TOKENS of teachers who never come back stay until re-projected.
 * So a bump must ship with a one-off re-projection: for every profile whose coverConsentVersion is older, rebuild
 * the listing's facetTokens without the cover tokens (teacherFacetTokens with coverConsent false).
 */
export const COVER_CONSENT_VERSION = '2026-10-07'

/**
 * The cities a teacher can pick cover areas in — the taxonomy's `workIn` cities, minus `anywhere` and
 * `online` (a test pins the two lists together). Each one is also a CITY-WIDE area key ("anywhere in
 * Hanoi"). Only Hồ Chí Minh City is split into districts: Vietnam abolished the district tier on
 * 2025-07-01 and the curated, still-colloquial district list exists for HCMC alone (owner sign-off is
 * needed for any other city's list — plan review, 2026-10-07).
 */
export const COVER_CITIES = [
  { key: 'ho-chi-minh-city', en: 'Ho Chi Minh City', vi: 'TP. Hồ Chí Minh' },
  { key: 'ha-noi', en: 'Hanoi', vi: 'Hà Nội' },
  { key: 'da-nang', en: 'Da Nang', vi: 'Đà Nẵng' },
  { key: 'hai-phong', en: 'Hai Phong', vi: 'Hải Phòng' },
  { key: 'can-tho', en: 'Can Tho', vi: 'Cần Thơ' },
  { key: 'hue', en: 'Hue', vi: 'Huế' },
  { key: 'khanh-hoa', en: 'Nha Trang', vi: 'Nha Trang' },
  { key: 'lam-dong', en: 'Da Lat', vi: 'Đà Lạt' },
  { key: 'dong-nai', en: 'Dong Nai / Bien Hoa', vi: 'Đồng Nai / Biên Hòa' },
  { key: 'binh-duong', en: 'Binh Duong', vi: 'Bình Dương' },
  { key: 'vung-tau', en: 'Vung Tau', vi: 'Vũng Tàu' },
  { key: 'phu-quoc', en: 'Phu Quoc', vi: 'Phú Quốc' },
] as const

const HCMC = 'ho-chi-minh-city'

export type CoverArea = {
  key: string
  /** the COVER_CITIES key this area belongs to (a city-wide area belongs to itself) */
  city: string
  en: string
  vi: string
  /** true for the "anywhere in <city>" entry */
  cityWide?: true
  /** an umbrella's narrower areas — Thủ Đức keeps the abolished Districts 2 and 9 */
  parts?: readonly string[]
}

/**
 * ⛔ HCMC DISTRICTS ARE THE CURATED `DISTRICTS` TABLE, IMPORTED — never copied, never extended. The rent
 * index fingerprints that table's entries (src/lib/rent-index.ts), so a cover-only addition there would
 * move published figures. Thủ Đức stays the umbrella of d2/d9, exactly as the explorer treats it.
 */
const HCMC_DISTRICTS: CoverArea[] = DISTRICTS.filter((d) => d.slug !== 'all').map((d) => ({
  key: d.slug,
  city: HCMC,
  en: d.nameEn,
  vi: d.name,
  ...(d.slug === 'thu-duc' ? { parts: ['d2', 'd9'] as const } : {}),
}))

/** Every area a teacher can pick: each city's "anywhere in" entry, then (HCMC) its districts. */
export const COVER_AREAS: readonly CoverArea[] = COVER_CITIES.flatMap((c) => [
  { key: c.key, city: c.key, en: `All of ${c.en}`, vi: `Toàn ${c.vi}`, cityWide: true as const },
  ...(c.key === HCMC ? HCMC_DISTRICTS : []),
])

export const COVER_AREA_BY_KEY: ReadonlyMap<string, CoverArea> = new Map(COVER_AREAS.map((a) => [a.key, a]))
export const COVER_AREA_KEYS: readonly string[] = COVER_AREAS.map((a) => a.key)

/**
 * A place name, never machine-translated (PlaceName's rule — gen-ui-strings.mjs keeps district tables out of
 * the harvest): Vietnamese for `vi`, the English name for every other language.
 */
export function coverAreaLabel(key: string, lang: string): string {
  const a = COVER_AREA_BY_KEY.get(key)
  if (!a) return key
  return lang === 'vi' ? a.vi : a.en
}

/**
 * The teacher's own cities — where they live and where they want to work (every city for "anywhere") — which the form
 * shows FIRST. ⛔ ORDERING ONLY, NEVER A FILTER (gate review, 2026-10-07): areas are their own choice, and every city
 * stays pickable, so a pick can never become invisible on the form or be silently dropped by the server when the
 * teacher's cities change — the two ways the earlier filter made the stored and the shown cover disagree.
 */
export function coverCitiesFor(currentCity: string, preferredCities: readonly string[]): string[] {
  if (preferredCities.includes('anywhere')) return COVER_CITIES.map((c) => c.key)
  const wanted = new Set([currentCity, ...preferredCities])
  return COVER_CITIES.map((c) => c.key).filter((k) => wanted.has(k))
}

/**
 * A stamp of the whole cover state — what an edit-mode save sends as `coverBase` (the state it loaded), and what the
 * server compares under the account lock: any difference, not just on/off, means another window saved first.
 */
export function coverStamp(c: { coverOpen: boolean; coverSlots?: readonly string[] | null; coverAreas?: readonly string[] | null; coverRateVnd: number | null }): string {
  // SORTED: the form keeps tap order and the server stores canonical order — the same set must stamp the same.
  return [c.coverOpen ? 1 : 0, [...(c.coverSlots ?? [])].sort().join(','), [...(c.coverAreas ?? [])].sort().join(','), c.coverRateVnd ?? ''].join('|')
}

/** The cover as last SAVED, as an edit form holds it (teacher-form `savedCover`): the stale-window base. `consentCurrent`:
 *  saved under today's notice (COVER_CONSENT_VERSION). */
export type SavedCover = { coverOpen: boolean; coverSlots: string[]; coverAreas: string[]; coverRateVnd: number | null; consentCurrent: boolean }
type CoverForm = { coverOpen: boolean; coverSlots: string[]; coverAreas: string[]; coverRateVnd: number | null; coverConsent: boolean }
const NO_COVER: SavedCover = { coverOpen: false, coverSlots: [], coverAreas: [], coverRateVnd: null, consentCurrent: false }

/**
 * ⛔ A STALE WINDOW'S RE-READ: WHAT THE TEACHER DID NOT TOUCH FOLLOWS THE SERVER; WHAT THEY CHANGED STAYS THEIRS — field
 * by field (gate reviews, 2026-10-07). After a 409 cover_changed the form re-reads the saved cover (`fresh`) and merges
 * it with what it shows (`cur`) against what it loaded (`base`; null = loaded no profile, i.e. no cover). Judged for the
 * whole section, an edited rate kept stale areas too and the next save overwrote another window's areas.
 * The tick follows the same rule with one more: it NEVER CROSSES A WITHDRAWAL — given or removed here it stays the
 * teacher's, unless cover was switched off in another window since this one loaded (a tick shown here cannot have
 * answered that); untouched, it follows whether the saved consent stands. Never a consent recorded after a withdrawal
 * the teacher did not see, never a tick they removed put back.
 */
export function mergeStaleCover(cur: CoverForm, base: SavedCover | null, fresh: SavedCover): {
  cover: CoverForm
  /** Nothing differs from what was loaded, the tick included — the form now simply shows the saved version. */
  untouched: boolean
  /** Cover stays on in the form but the tick was taken away: the line must ask for it again. */
  reconsent: boolean
} {
  const b = base ?? NO_COVER
  const sameList = (x: readonly string[], y: readonly string[]) => [...x].sort().join(',') === [...y].sort().join(',')
  const baseTick = b.coverOpen && b.consentCurrent
  const withdrawn = b.coverOpen && !fresh.coverOpen
  const cover: CoverForm = {
    coverOpen: cur.coverOpen === b.coverOpen ? fresh.coverOpen : cur.coverOpen,
    coverSlots: sameList(cur.coverSlots, b.coverSlots) ? fresh.coverSlots : cur.coverSlots,
    coverAreas: sameList(cur.coverAreas, b.coverAreas) ? fresh.coverAreas : cur.coverAreas,
    coverRateVnd: (cur.coverRateVnd ?? null) === (b.coverRateVnd ?? null) ? fresh.coverRateVnd : cur.coverRateVnd,
    coverConsent: cur.coverConsent === baseTick ? fresh.coverOpen && fresh.consentCurrent : cur.coverConsent && !withdrawn,
  }
  return {
    cover,
    // The tick counts: a consent given or removed here is the teacher's change, and the line must say so (gate review).
    untouched: coverStamp(cur) === coverStamp(b) && cur.coverConsent === baseTick,
    reconsent: cover.coverOpen && cur.coverConsent && !cover.coverConsent,
  }
}

/** The areas the form offers for those cities, in display order. */
export function coverAreasForCities(cities: readonly string[]): CoverArea[] {
  const set = new Set(cities)
  return COVER_AREAS.filter((a) => set.has(a.city))
}

/**
 * What a SCHOOL's area filter matches (`attr_coverArea=<key>`), so a search reads the way people mean it:
 *   · a district          → that district, its umbrella (d2/d9 → Thủ Đức) and its city's "anywhere" key;
 *   · an umbrella         → itself, its parts and the city's "anywhere" key;
 *   · a city-wide key     → the city's "anywhere" key and every one of its districts.
 * Read by `attrNeedles` (attr-match.ts), so the feed and the Filter panel's counts expand identically.
 */
export function coverAreaFilterKeys(value: string): string[] {
  const a = COVER_AREA_BY_KEY.get(value)
  if (!a) return [value]
  if (a.cityWide) return [a.key, ...COVER_AREAS.filter((x) => x.city === a.key && !x.cityWide).map((x) => x.key)]
  const umbrellas = COVER_AREAS.filter((x) => x.parts?.includes(a.key)).map((x) => x.key)
  return [a.key, ...(a.parts ?? []), ...umbrellas, a.city]
}
