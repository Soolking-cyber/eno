/**
 * WHERE A TEACHER LIVES AND CAN TEACH — the ONE place vocabulary of the teacher profile (teacher onboarding redesign,
 * owner, 2026-10-08). One "Where you can teach" list (`TeacherProfile.teachAreas`) replaces the four old place
 * questions (currentCity, preferredCities, openToOnline, coverAreas); cover lessons reuse it. The form, the publish
 * core, the school filter (attr-match.ts), the taxonomy and the one-off backfill (scripts/teachers-backfill.ts) read it.
 *
 * ⛔ PURE AND IMPORT-LIGHT: no 'server-only', no Next, and NEVER the taxonomy (the taxonomy builds its "Can teach in"
 * options from here — importing it back would be a cycle) nor data/vn-units.json (190 KB; the client-safe
 * VN_PROVINCES table is pinned to it by vn-areas.test.ts). `npx tsx` runs it (the backfill), and so does the browser.
 *
 * THE KEYS (PLACE_KEYS, in this canonical order):
 *   · 'online' — the only place Online is asked (plan review, 2026-10-08: "Online is asked once");
 *   · the 12 hub slugs (= cover.ts COVER_CITIES), each followed — for Ho Chi Minh City — by the 24 curated HCMC
 *     districts, which are cover.ts COVER_AREAS (themselves the explorer's DISTRICTS table: IMPORTED, never copied);
 *   · 'p-<code>' — a vn-units province that no city chip covers whole (27 of the 34), offered only as the teacher's
 *     OWN home province;
 *   · 'anywhere' — "will move anywhere in Vietnam".
 * ⚠️ The order IS the stored order: facet tokens, coverStamp and the mirrors are built from it, so the same set must
 * always serialise the same way.
 */
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { VN_PROVINCES } from '@/lib/vn-areas'
import { COVER_AREAS, COVER_AREA_BY_KEY, COVER_AREA_KEYS, COVER_CITIES, coverAreaFilterKeys } from '@/lib/teachers/cover'

export const ONLINE = 'online'
export const ANYWHERE = 'anywhere'
export const HCMC = 'ho-chi-minh-city'

/** "Where are you now?" — NULL in the row means not answered (plan review D3, 2026-10-08: never defaulted). */
export type LivesIn = 'city' | 'elsewhere' | 'abroad'
export const LIVES_IN: readonly LivesIn[] = ['city', 'elsewhere', 'abroad']

/**
 * What the place rules read about a teacher — a structural subset of TeacherInput, so this module never imports
 * profile.ts (profile.ts imports this one).
 */
export type PlaceSituation = {
  livesIn: LivesIn | null
  /** a hub slug when livesIn is 'city', else '' */
  currentCity: string
  /** a PROVINCE_PLACES code when livesIn is 'elsewhere', else '' */
  currentProvince: string
  jobTypes?: readonly string[]
}

/** The 12 city chips — cover.ts COVER_CITIES, in its order. */
export const HUBS: readonly string[] = COVER_CITIES.map((c) => c.key)
const HUB_SET: ReadonlySet<string> = new Set(HUBS)

/**
 * Each hub's vn-units province (the 2025 two-tier units). Bình Dương and Vũng Tàu were merged into Hồ Chí Minh and
 * Phú Quốc sits in An Giang — the chip keeps the name people use, the province is the unit the area filter knows.
 * ⛔ HCMC, Bình Dương and Vũng Tàu are therefore ONE home area (owner, 2026-10-08: cover reach = the home province);
 * Đồng Nai stands alone (Biên Hòa next door does not make Thủ Đức "near home").
 */
export const HUB_PROVINCE: Readonly<Record<string, string>> = {
  'ho-chi-minh-city': '79',
  'ha-noi': '01',
  'da-nang': '48',
  'hai-phong': '31',
  'can-tho': '92',
  hue: '46',
  'khanh-hoa': '56',
  'lam-dong': '68',
  'dong-nai': '75',
  'binh-duong': '79',
  'vung-tau': '79',
  'phu-quoc': '91',
}

/**
 * Provinces a city chip covers WHOLE: Hà Nội, Hải Phòng, Huế, Đà Nẵng, Đồng Nai ("Dong Nai / Bien Hoa"), Cần Thơ and
 * Hồ Chí Minh (whose three chips — HCMC, Bình Dương, Vũng Tàu — cover the merged province between them). A teacher
 * there taps the chip. ⚠️ Khánh Hoà, Lâm Đồng and An Giang are NOT here: their chips are one town (Nha Trang, Đà Lạt,
 * Phú Quốc), and someone in Cam Ranh, Phan Thiết (Bình Thuận is Lâm Đồng since 2025) or Long Xuyên lives in the
 * province, not the town — so those three have a province key too, and B5 makes the key and the town find each other.
 */
const CHIP_PROVINCES: ReadonlySet<string> = new Set(['01', '31', '46', '48', '75', '79', '92'])

export type ProvincePlace = { key: string; code: string; name: string; nameEn: string }
/** The 27 provinces a teacher may pick under "Somewhere else in Vietnam" — vn-units codes and names (VN_PROVINCES). */
export const PROVINCE_PLACES: readonly ProvincePlace[] = VN_PROVINCES.filter((p) => !CHIP_PROVINCES.has(p.code)).map((p) => ({
  key: `p-${p.code}`,
  code: p.code,
  name: p.name,
  nameEn: p.nameEn,
}))
const PROVINCE_BY_KEY: ReadonlyMap<string, ProvincePlace> = new Map(PROVINCE_PLACES.map((p) => [p.key, p]))
const PROVINCE_BY_CODE: ReadonlyMap<string, ProvincePlace> = new Map(PROVINCE_PLACES.map((p) => [p.code, p]))

/** The 24 curated HCMC districts (cover.ts COVER_AREAS = the explorer's DISTRICTS, minus `all`). */
export const HCMC_DISTRICT_KEYS: readonly string[] = COVER_AREAS.filter((a) => a.city === HCMC && !a.cityWide).map((a) => a.key)
const DISTRICT_SET: ReadonlySet<string> = new Set(HCMC_DISTRICT_KEYS)

/** Every teach-area key, in the canonical (stored) order. */
export const PLACE_KEYS: readonly string[] = [ONLINE, ...COVER_AREAS.map((a) => a.key), ...PROVINCE_PLACES.map((p) => p.key), ANYWHERE]
const PLACE_INDEX: ReadonlyMap<string, number> = new Map(PLACE_KEYS.map((k, i) => [k, i]))

/**
 * ≥ every legal list, so normalisation never cuts a teacher's picks (the most reachable is 35: Online, Bình Dương,
 * Vũng Tàu, 23 HCMC districts and the 9 other hubs). The database CHECK `TeacherProfile_teach_bounds`
 * (scripts/teachers-ddl.mjs) holds the same number — places.test.ts reads that file.
 */
export const MAX_TEACH_AREAS = 40

export const isHub = (k: string): boolean => HUB_SET.has(k)
export const isHcmcDistrict = (k: string): boolean => DISTRICT_SET.has(k)
export const isPlaceKey = (k: unknown): k is string => typeof k === 'string' && PLACE_INDEX.has(k)
/** A province key's code ('p-52' → '52'), or null for anything else. */
export const provinceCodeOfKey = (k: string): string | null => PROVINCE_BY_KEY.get(k)?.code ?? null
/** The province key for a vn-units code, or null when a city chip covers that province whole. */
export const provinceKeyOf = (code: string): string | null => PROVINCE_BY_CODE.get(code)?.key ?? null
export const isPickableProvince = (code: unknown): code is string => typeof code === 'string' && PROVINCE_BY_CODE.has(code)
/** The hubs inside a province — 56 → Nha Trang, 79 → HCMC, Bình Dương and Vũng Tàu. */
export const hubsInProvince = (code: string): string[] => HUBS.filter((h) => HUB_PROVINCE[h] === code)

/** The vn-units province a place key lies in (hub, HCMC district or province key), or null (online / anywhere). */
export function provinceOfPlace(k: string): string | null {
  if (HUB_SET.has(k)) return HUB_PROVINCE[k]
  if (DISTRICT_SET.has(k)) return HUB_PROVINCE[HCMC]
  return provinceCodeOfKey(k)
}

/** In canonical order, deduplicated. */
const canonical = (keys: Iterable<string>): string[] =>
  [...new Set(keys)].filter((k) => PLACE_INDEX.has(k)).sort((a, b) => PLACE_INDEX.get(a)! - PLACE_INDEX.get(b)!)

/** The teacher's home province code: their chip's province, or the province they picked; null abroad / unanswered. */
export function homeProvince(s: PlaceSituation): string | null {
  if (s.livesIn === 'city') return HUB_PROVINCE[s.currentCity] ?? null
  if (s.livesIn === 'elsewhere') return isPickableProvince(s.currentProvince) ? s.currentProvince : null
  return null
}

/**
 * THE HOME AREA — every place in the teacher's home province: its hubs (HCMC with its districts) and its province key
 * when it has one. HCMC, Bình Dương and Vũng Tàu are one home area (the 2025 merger); a Nha Trang teacher's home is
 * Nha Trang + Khánh Hoà, and a Cam Ranh teacher's ('elsewhere', Khánh Hoà) is the same two (plan review B5). Teachers
 * abroad, and anyone who has not answered "Where are you now?", have none.
 * The form's "Near you" group; the only keys cover can reach; the only keys a province key or a district may be.
 */
export function homeAreaKeys(s: PlaceSituation): string[] {
  const p = homeProvince(s)
  if (!p) return []
  return PLACE_KEYS.filter((k) => k !== ONLINE && k !== ANYWHERE && provinceOfPlace(k) === p)
}

const RELOCATING_JOBS: ReadonlySet<string> = new Set(['fulltime', 'parttime'])
/**
 * May the teacher list places away from home ("Would you move for a job?")? Only full-time / part-time job seekers in
 * Vietnam — a private tutor or a cover teacher works where they live — and every teacher abroad, for whom every city
 * is "away". A hidden question's answer is never stored, so the form and the server both prune by this.
 */
export function relocationAllowed(s: PlaceSituation): boolean {
  if (s.livesIn === 'abroad') return true
  if (s.livesIn !== 'city' && s.livesIn !== 'elsewhere') return false
  return (s.jobTypes ?? []).some((j) => RELOCATING_JOBS.has(j))
}

/** The hubs outside the teacher's home area — "Other cities (whole city only)". */
export function otherCityKeys(s: PlaceSituation): string[] {
  const home = new Set(homeAreaKeys(s))
  return HUBS.filter((h) => !home.has(h))
}

/**
 * The ONE normaliser of a teach-area list: known keys only, canonical order, and no double selection —
 *   · "Anywhere in HCMC" drops HCMC's districts (B2: whole-city wins — never shrink a stated reach);
 *   · Thủ Đức drops District 2 and 9 (its umbrella keeps them, cover.ts COVER_AREAS `parts`);
 *   · 'anywhere' drops the other cities (it already means all of them).
 * With the teacher's situation answered, also what they may list at all:
 *   · Online, always; their home area (districts and the province key only there);
 *   · other cities (whole city only) and 'anywhere' only when relocationAllowed.
 * ⚠️ Unanswered ("Where are you now?" still NULL — a restored old draft) keeps every known key: the context to judge
 * them by does not exist yet, and nothing is saved before it is answered (validateTeacherInput requires it); the
 * pruning then runs on the answer. Throwing the draft's cities away first would lose what the teacher typed.
 */
export function normalizeTeachAreas(raw: unknown, s: PlaceSituation): string[] {
  let keys = canonical(Array.isArray(raw) ? raw.filter(isPlaceKey) : [])
  if (keys.includes(HCMC)) keys = keys.filter((k) => !DISTRICT_SET.has(k))
  for (const a of COVER_AREAS) if (a.parts && keys.includes(a.key)) keys = keys.filter((k) => !a.parts!.includes(k))
  if (s.livesIn !== null && s.livesIn !== undefined) {
    const home = new Set(homeAreaKeys(s))
    const away = relocationAllowed(s)
    keys = keys.filter((k) => k === ONLINE || home.has(k) || (away && (k === ANYWHERE || (HUB_SET.has(k) && !home.has(k)))))
    if (keys.includes(ANYWHERE)) keys = keys.filter((k) => !(HUB_SET.has(k) && !home.has(k)))
  }
  return keys.slice(0, MAX_TEACH_AREAS)
}

/**
 * COVER REACH — where schools find the teacher for cover: the teach areas inside the home area that are cover areas
 * (owner, 2026-10-08: "cover reach = the home province"). Never a relocation city, Online or 'anywhere'. Derived on
 * every save into TeacherProfile.coverAreas (a mirror) and the `coverArea:` tokens — the teacher no longer picks
 * cover areas separately. In COVER_AREA_KEYS order, whatever order it is handed, so the stored list is stable.
 */
export function coverReachOf(t: PlaceSituation & { teachAreas: readonly string[] }): string[] {
  const home = new Set(homeAreaKeys(t))
  const picked = new Set(t.teachAreas)
  return COVER_AREA_KEYS.filter((k) => home.has(k) && picked.has(k))
}

/** Does the home area hold a cover area — the Cover step exists only then (so in v1 cover stays in the 12 cities). */
export function homeHasCover(s: PlaceSituation): boolean {
  return homeAreaKeys(s).some((k) => COVER_AREA_BY_KEY.has(k))
}

/**
 * What a SCHOOL's "Can teach in" filter (`attr_workIn=<key>`) matches — read by attrNeedles (attr-match.ts), so the
 * feed and the Filter panel's counts expand identically:
 *   · a hub            → itself, its districts (HCMC), its province key (B5: Nha Trang ↔ Khánh Hoà) and 'anywhere';
 *   · a district       → cover.ts coverAreaFilterKeys (itself, its umbrella or parts, HCMC) and 'anywhere';
 *   · a province key   → itself, the hubs inside it (B5) and 'anywhere';
 *   · 'online', 'anywhere' → exactly themselves.
 * ⛔ The 14 values the old facet had (12 cities, 'anywhere', 'online') keep working, so every old link and saved search
 * does (plan review B10) — and a city filter now also finds a teacher who picked one of its districts or 'anywhere'.
 */
export function workInFilterKeys(value: string): string[] {
  if (value === ONLINE || value === ANYWHERE) return [value]
  const code = provinceCodeOfKey(value)
  if (code) return [...new Set([value, ...hubsInProvince(code), ANYWHERE])]
  const area = COVER_AREA_BY_KEY.get(value)
  if (!area) return [value]
  const pKey = provinceKeyOf(HUB_PROVINCE[area.city])
  return [...new Set([...coverAreaFilterKeys(value), ...(pKey ? [pKey] : []), ANYWHERE])]
}

/**
 * The CITY level of a teach-area list — the `preferredCities` mirror (an HCMC district → HCMC; province keys dropped;
 * 'anywhere' and 'online' kept), in the old workIn order (12 hubs, anywhere, online). It keeps the old readers, the
 * external matcher and a rollback reading what they always read.
 */
export function mirrorCities(teachAreas: readonly string[]): string[] {
  const set = new Set(teachAreas.map((k) => (DISTRICT_SET.has(k) ? HCMC : k)))
  return [...HUBS.filter((h) => set.has(h)), ...(set.has(ANYWHERE) ? [ANYWHERE] : []), ...(set.has(ONLINE) ? [ONLINE] : [])]
}

const DISTRICT_BY_KEY = new Map(DISTRICTS.filter((d) => d.slug !== 'all').map((d) => [d.slug, d]))
const HUB_BY_KEY = new Map<string, (typeof COVER_CITIES)[number]>(COVER_CITIES.map((c) => [c.key, c]))

/**
 * A place's name — NEVER machine-translated (PlaceName's rule): Vietnamese for `vi`, English for every other language.
 * Hubs as their chips say them (Nha Trang, Đà Lạt), districts by the curated DISTRICTS names, provinces by vn-units.
 * ⚠️ Not a `{ en, vi }` pair table on purpose: gen-ui-strings harvests such pairs into the MT catalogue.
 */
export function placeLabel(key: string, lang: string): string {
  const vi = lang === 'vi'
  if (key === ONLINE) return vi ? 'Trực tuyến' : 'Online'
  if (key === ANYWHERE) return vi ? 'Bất kỳ đâu tại Việt Nam' : 'Anywhere in Vietnam'
  const hub = HUB_BY_KEY.get(key)
  if (hub) return vi ? hub.vi : hub.en
  const d = DISTRICT_BY_KEY.get(key)
  if (d) return vi ? d.name : d.nameEn
  const p = PROVINCE_BY_KEY.get(key)
  if (p) return vi ? p.name : p.nameEn
  return key
}

/** A province code's name ('52' → Gia Lai), from VN_PROVINCES; '' for an unknown code. */
export function provinceName(code: string, lang: string): string {
  const p = VN_PROVINCES.find((x) => x.code === code)
  return p ? (lang === 'vi' ? p.name : p.nameEn) : ''
}

/**
 * `currentCity` slug → the province string `Listing.city` stores (vn-units `name`, the Vietnamese one — the area
 * filter matches it, see src/lib/province-match.ts). Bình Dương and Vũng Tàu are Hồ Chí Minh, Phú Quốc is An Giang.
 * Derived from HUB_PROVINCE + VN_PROVINCES, so it cannot disagree with either.
 */
export const CITY_PROVINCE: Readonly<Record<string, string>> = Object.fromEntries(HUBS.map((h) => [h, provinceName(HUB_PROVINCE[h], 'vi')]))

/**
 * Towns people type that are not a chip or a province name (plan, 2026-10-08) — the province search finds them.
 * `to` is a hub (the alias switches the answer to that city chip) or a province key. Facts of the 2025 merger:
 * Quảng Nam is Đà Nẵng, Bình Định is Gia Lai, Bình Thuận is Lâm Đồng, Bình Dương is Hồ Chí Minh.
 */
export const TOWN_ALIASES: readonly { name: string; nameEn: string; to: string }[] = [
  { name: 'Hội An', nameEn: 'Hoi An', to: 'da-nang' },
  { name: 'Quy Nhơn', nameEn: 'Quy Nhon', to: 'p-52' },
  { name: 'Vinh', nameEn: 'Vinh', to: 'p-40' },
  { name: 'Hạ Long', nameEn: 'Ha Long', to: 'p-22' },
  { name: 'Phan Thiết', nameEn: 'Phan Thiet', to: 'p-68' },
  { name: 'Biên Hòa', nameEn: 'Bien Hoa', to: 'dong-nai' },
  { name: 'Thủ Dầu Một', nameEn: 'Thu Dau Mot', to: 'binh-duong' },
]

/** The "Where are you now?" answer a hub or province key stands for — what a town alias switches the form to. */
export function situationForPlace(key: string): { livesIn: 'city'; currentCity: string } | { livesIn: 'elsewhere'; currentProvince: string } | null {
  if (HUB_SET.has(key)) return { livesIn: 'city', currentCity: key }
  const code = provinceCodeOfKey(key)
  return code ? { livesIn: 'elsewhere', currentProvince: code } : null
}
