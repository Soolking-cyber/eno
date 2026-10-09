/**
 * THE TEACHER LISTING PROJECTION — ONE pure builder for the full save, the cover save and the one-off backfill (plan
 * review D7, 2026-10-08): the Listing's city / district / location, its search text, its facet tokens (profile.ts), the
 * old TeacherProfile columns kept as MIRRORS, and the backfill's per-row plan. publish.ts and
 * scripts/teachers-backfill.ts both call these, so a migrated row and a freshly saved one can never disagree.
 *
 * ⛔ PURE: no 'server-only', no Next, no database, no node: modules — `npx tsx` imports it (the backfill) and the
 * vitest suite tests it directly. The backfill's hashing lives in the script (node:crypto); the canonical JSON it
 * hashes is built here (stableStringify).
 */
import { DISTRICTS } from '@/components/marketplace/listings-explorer.constants'
import { parseFacetTokens } from '@/lib/facet-tokens'
import { buildSearchText, fold } from '@/lib/fold'
import { countryName } from '@/lib/teachers/countries'
import { COVER_CONSENT_VERSION } from '@/lib/teachers/cover'
import {
  ANYWHERE, CITY_PROVINCE, HCMC, ONLINE, coverReachOf, isHcmcDistrict, isHub, isPickableProvince, mirrorCities, placeLabel,
  provinceCodeOfKey, provinceName, type LivesIn,
} from '@/lib/teachers/places'
import {
  BAND_FLOOR, TEACHER_OPTIONS, TEACHER_SITUATION_VERSION, coverIsPublic, englishMedium, experienceBucket, fromLegacyTeacher,
  normalizeForSave, normalizeTeacherInput, teacherFacetTokens, teacherListingDescription, teacherSubcategory,
  type TeacherInput,
} from '@/lib/teachers/profile'

const DISTRICT_BY_KEY = new Map(DISTRICTS.filter((d) => d.slug !== 'all').map((d) => [d.slug, d]))

/**
 * The location a teacher abroad shows (plan review D8): never a relocation city, which would read as where they live.
 * Stored in English like every teacher `location` — the card translates it; its curated Vietnamese is "Chưa ở Việt Nam"
 * (src/generated/vi-overrides.ts, added at the integration merge, with "Not in Vietnam yet · Online").
 */
export const NOT_IN_VIETNAM = 'Not in Vietnam yet'

export type TeacherHome = { city: string; district: string | null; location: string }

/**
 * WHERE THE TEACHER LIVES, as the Listing stores it — what the Area filter, the /c/teachers "By area" chips, the
 * district pages and the sitemap read:
 *   · city — the vn-units province name (CITY_PROVINCE for a chip, the picked province for "somewhere else") or ''
 *     abroad. ⛔ No `?? 'Hồ Chí Minh'` fallback any more (publish.ts had one): a teacher abroad is in no city;
 *   · district — the curated Vietnamese DISTRICTS name ("Quận 7 (Phú Mỹ Hưng)", "TP Thủ Đức"), which
 *     district-canonical resolves back to its own slug for all 24 (projection.test.ts) — or null;
 *   · location — "<district nameEn>, <city>" | "<city>" | "<province nameEn>" | "Not in Vietnam yet[ · Online]".
 */
export function teacherHome(t: Pick<TeacherInput, 'livesIn' | 'currentCity' | 'currentDistrictKey' | 'currentProvince' | 'teachAreas'>): TeacherHome {
  if (t.livesIn === 'city' && isHub(t.currentCity)) {
    const d = t.currentCity === HCMC ? DISTRICT_BY_KEY.get(t.currentDistrictKey) : undefined
    const cityEn = placeLabel(t.currentCity, 'en')
    return { city: CITY_PROVINCE[t.currentCity], district: d?.name ?? null, location: d ? `${d.nameEn}, ${cityEn}` : cityEn }
  }
  if (t.livesIn === 'elsewhere' && isPickableProvince(t.currentProvince)) {
    return { city: provinceName(t.currentProvince, 'vi'), district: null, location: provinceName(t.currentProvince, 'en') }
  }
  if (t.livesIn === 'abroad') {
    return { city: '', district: null, location: t.teachAreas.includes(ONLINE) ? `${NOT_IN_VIETNAM} · Online` : NOT_IN_VIETNAM }
  }
  return { city: '', district: null, location: '' }
}

/** ⚠️ The cover words go LAST in a teacher's search text — here, and in the builder before the redesign, word for word —
 *  which is what lets withoutCoverFacets take exactly them off a row the backfill has not migrated. */
const COVER_WORDS = ['cover lessons', 'cover teacher', 'substitute teacher', 'dạy thay', 'giáo viên dạy thay']
const ONLINE_WORDS = ['online', 'trực tuyến', 'online teacher', 'dạy online', 'dạy trực tuyến']
const labelsOf = (opts: readonly { value: string; label: string; labelVi: string }[], v: string) => {
  const o = opts.find((x) => x.value === v)
  return o ? [o.label, o.labelVi] : []
}

/**
 * The listing's searchable text — ONE builder for every writer. What a school types and should find: the teacher's
 * words, nationality (English and Vietnamese names), employers, spoken and taught languages, what they teach and to
 * whom, job types, the CITY level of where they live and can teach (both languages), their province, Online, and the
 * cover words while cover is public.
 * ⛔ NEVER A DISTRICT NAME: district-query would read it as the teacher's HOME district (that is `Listing.district`);
 * a district pick contributes its city ("Ho Chi Minh City") only.
 */
export function teacherSearchText(t: TeacherInput, category: { name: string; nameVi: string | null }): string {
  const cities = [...new Set([...(t.livesIn === 'city' && isHub(t.currentCity) ? [t.currentCity] : []), ...mirrorCities(t.teachAreas).filter(isHub)])]
  const provinces = [...new Set([
    ...(t.livesIn === 'elsewhere' && isPickableProvince(t.currentProvince) ? [t.currentProvince] : []),
    ...t.teachAreas.map(provinceCodeOfKey).filter((c): c is string => !!c),
  ])]
  return buildSearchText([
    t.fullName, t.headline, t.bio, t.degreeMajor, t.degreeInstitution,
    ...t.languages, ...t.teachLanguages,
    ...(t.nationality ? [countryName(t.nationality, 'en'), countryName(t.nationality, 'vi')] : []),
    ...t.experience.map((x) => x.employer),
    ...t.subjects, ...t.certificates.map((c) => c.type),
    ...t.jobTypes.flatMap((j) => labelsOf(TEACHER_OPTIONS.jobType, j)),
    ...t.ageGroups.flatMap((a) => labelsOf(TEACHER_OPTIONS.ageGroup, a)),
    ...cities.flatMap((k) => [placeLabel(k, 'en'), placeLabel(k, 'vi')]),
    ...provinces.flatMap((c) => [provinceName(c, 'en'), provinceName(c, 'vi')]),
    ...(t.teachAreas.includes(ONLINE) ? ONLINE_WORDS : []),
    category.name, category.nameVi,
    ...(coverIsPublic(t) ? COVER_WORDS : []),
  ])
}

/** The facets a cover save owns (profile.ts teacherFacetTokens: `cover:`, `coverSlot:`, `coverArea:`). */
const COVER_FACET_KEYS: ReadonlySet<string> = new Set(['cover', 'coverSlot', 'coverArea'])
const COVER_SEARCH_TAIL = ` ${fold(COVER_WORDS.join(' '))}`

/**
 * A teacher listing's facet tokens and search text WITHOUT their cover part — what a cover save writes over a row the
 * backfill has not migrated (publish.ts saveTeacherCover; situationVersion NULL: a profile the old code wrote after
 * --apply). ⛔ NEVER A RE-PROJECTION: such a row has no v2 answers, and rebuilt from them its listing lost every place,
 * native, experience and city facet (gate review, 2026-10-09); reading the old columns as answers instead is the runtime
 * adapter D1 rules out. So only the cover tokens and the trailing cover words go — everything else stays exactly as the
 * old code wrote it until the backfill migrates the row. Search text that does not end in the cover words keeps them.
 */
export function withoutCoverFacets(listing: { facetTokens: string | null; searchText: string | null }): { facetTokens: string | null; searchText: string } {
  const kept = parseFacetTokens(listing.facetTokens).filter((p) => !COVER_FACET_KEYS.has(p.key))
  const text = listing.searchText ?? ''
  return {
    facetTokens: kept.length ? `|${kept.map((p) => `${p.key}:${p.value}`).join('|')}|` : null,
    searchText: text.endsWith(COVER_SEARCH_TAIL) ? text.slice(0, -COVER_SEARCH_TAIL.length) : text,
  }
}

export type TeacherListingProjection = TeacherHome & {
  title: string
  description: string
  subcategorySlug: string
  facetTokens: string | null
  searchText: string
  /** the expected salary — full-time only (normalizeForSave drops it otherwise) */
  salaryM: number | null
}

/** Everything a teacher's Listing row derives from the profile (status, verified and media are the caller's). */
export function teacherListingProjection(t: TeacherInput, category: { name: string; nameVi: string | null }): TeacherListingProjection {
  return {
    ...teacherHome(t),
    title: t.fullName,
    description: teacherListingDescription(t),
    subcategorySlug: teacherSubcategory(t),
    facetTokens: teacherFacetTokens(t),
    searchText: teacherSearchText(t, category),
    salaryM: t.expectedSalaryM,
  }
}

export type TeacherMirrors = {
  preferredCities: string[]
  openToOnline: boolean
  coverAreas: string[]
  nativeSpeaker: boolean
  yearsExperience: number
  currentDistrict: string | null
}

/**
 * ⛔ THE OLD COLUMNS, KEPT AS WRITTEN MIRRORS (plan review B3/D1, 2026-10-08) — rewritten on EVERY save from the v2
 * answers and never read back as answers, so the old code (a rollback, or the minutes between the backfill and the
 * deploy), the external matcher (scripts/teachers-match.ts, MATCH_IO_VERSION 1), the account export and every old
 * reader keep their meaning. Retiring them is a separate change that needs the owner.
 *   · preferredCities — the city level of the teach areas (places.ts mirrorCities);
 *   · openToOnline — 'online' is a teach area;
 *   · coverAreas — the derived cover reach (the DB CHECK reads it while cover is on);
 *   · nativeSpeaker — the English level is Native;
 *   · yearsExperience — the stored number while it still falls in the answered band (no precision thrown away),
 *     else the band's lower bound;
 *   · currentDistrict — the curated Vietnamese display name of the district key (what Listing.district holds).
 */
export function teacherMirrors(t: TeacherInput, stored: { yearsExperience?: number | null } | null): TeacherMirrors {
  const years = stored?.yearsExperience
  return {
    preferredCities: mirrorCities(t.teachAreas),
    openToOnline: t.teachAreas.includes(ONLINE),
    coverAreas: coverReachOf(t),
    nativeSpeaker: t.englishLevel === 'native',
    yearsExperience: t.experienceBand
      ? (typeof years === 'number' && experienceBucket(years) === t.experienceBand ? years : BAND_FLOOR[t.experienceBand] ?? 0)
      : (typeof years === 'number' ? years : 0),
    currentDistrict: (t.livesIn === 'city' && t.currentCity === HCMC && DISTRICT_BY_KEY.get(t.currentDistrictKey)?.name) || null,
  }
}

/** A stored TeacherProfile row as far as the projection reads it (Prisma's row or `pg`'s — both name columns alike). */
export type TeacherRow = Record<string, unknown> & {
  availableFrom?: Date | string | null
  coverOpen?: boolean
  coverConsentVersion?: string | null
  teachAreasConfirmedAt?: Date | string | null
}

/**
 * A stored, MIGRATED row as a TeacherInput — what the cover-only save rebuilds the tokens from. ⛔ Not a legacy adapter
 * (plan review D1): it reads the v2 columns; a row the backfill has not reached yet (situationVersion NULL, empty
 * teachAreas) simply has no places, and cover cannot be switched on for it until the teacher saves the form.
 * ⚠️ `coverConsent` IS NOT A COLUMN: it is the stored grant under today's notice (coverConsentVersion ===
 * COVER_CONSENT_VERSION) — anything else and the teacher would silently drop out of cover search, or stay in it under
 * words they never saw.
 */
export function teacherInputOfRow(row: TeacherRow): TeacherInput {
  const from = row.availableFrom instanceof Date ? row.availableFrom.toISOString().slice(0, 10) : row.availableFrom ?? null
  return normalizeTeacherInput({
    ...row,
    teachAreas: Array.isArray(row.teachAreas) ? row.teachAreas : [],
    availableFrom: from,
    coverConsent: row.coverOpen === true && row.coverConsentVersion === COVER_CONSENT_VERSION,
    teachAreasConfirmed: !!row.teachAreasConfirmedAt,
  })
}

// ── THE ONE-OFF BACKFILL (scripts/teachers-backfill.ts) ─────────────────────────────────────────────────────────────

/** The owner's call on "Where are you now?" for one old row (plan review D3: proposed, never silently defaulted). */
export type BackfillDecision = { livesIn: LivesIn | null; currentProvince?: string }

/**
 * The PROPOSAL the dry run prints: 'city' from the old form's city. ⚠️ Only a proposal — the old form forced a hub city
 * even on teachers abroad, so the owner confirms it per row (or decides otherwise) before --apply.
 */
export function proposeBackfillDecision(row: TeacherRow): BackfillDecision {
  return { livesIn: typeof row.currentCity === 'string' && isHub(row.currentCity) ? 'city' : null }
}

export type BackfillListing = { id: string; city: string; district: string | null; location: string; facetTokens: string | null; searchText: string }

export type BackfillPlan = {
  /** the new TeacherProfile columns — the backfill writes these and nothing else on the profile */
  profile: {
    livesIn: LivesIn | null
    currentProvince: string | null
    currentDistrictKey: string | null
    teachAreas: string[]
    teachLanguages: string[]
    englishLevel: string | null
    experienceBand: string | null
    situationVersion: number
  }
  /** the re-projected Listing columns (never status, verified, media or price) — null when the row has no listing */
  listing: Omit<BackfillListing, 'id'> | null
  /** the judgement calls the owner reads before --apply — nothing is dropped silently */
  flags: string[]
}

/**
 * ONE OLD ROW → ITS v2 COLUMNS AND ITS LISTING, as the new code would have written them — through the SAME builders a
 * save uses (fromLegacyTeacher, normalizeTeacherInput, normalizeForSave, teacherListingProjection), so the backfill
 * cannot project a row differently from publish.ts.
 * ⛔ NEVER REWRITES AN EXISTING VALUE (plan review D4): it fills only the new columns; the old columns (currentCity,
 * currentDistrict, preferredCities, openToOnline, coverAreas, nativeSpeaker, yearsExperience, jobTypes, ageGroups,
 * languages) stay exactly as stored — the old code keeps reading them until the deploy — and status, verified, consent,
 * cover and video columns are not touched. The Listing's facet tokens apply today's cover notice
 * (coverConsentVersion === COVER_CONSENT_VERSION), which is the re-projection cover.ts asks of a version bump.
 */
export function planTeacherBackfill(row: TeacherRow, category: { name: string; nameVi: string | null }, decision: BackfillDecision, hasListing: boolean): BackfillPlan {
  const flags: string[] = []
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  const mapped = fromLegacyTeacher({ ...row, teachAreas: undefined })
  const livesIn = decision.livesIn
  const situation = {
    livesIn,
    currentCity: livesIn === 'city' ? String(mapped.currentCity ?? '') : '',
    currentProvince: livesIn === 'elsewhere' ? String(decision.currentProvince ?? '') : '',
  }
  const t = normalizeForSave(normalizeTeacherInput({
    ...mapped,
    ...situation,
    availableFrom: row.availableFrom instanceof Date ? row.availableFrom.toISOString().slice(0, 10) : row.availableFrom ?? null,
    coverConsent: row.coverOpen === true && row.coverConsentVersion === COVER_CONSENT_VERSION,
  }))
  // ⚠️ teachAreasConfirmedAt stays NULL: the old form's places were the teacher's own explicit picks, so they stay public
  // as "Can teach in" (plan review C3) — but no confirmation stamp is invented for them (D: no legacy-row stamps).
  const proposed = proposeBackfillDecision(row)
  const cityName = CITY_PROVINCE[String(row.currentCity)] ?? String(row.currentCity ?? '')

  // ── the judgement calls ──
  if (livesIn === 'city' && proposed.livesIn === 'city') {
    flags.push(`livesIn 'city' (${cityName}) is PROPOSED from the old form, which made every teacher pick a city even from abroad — confirm it, or decide abroad / elsewhere:<code> / none`)
  }
  if (livesIn === 'elsewhere' && !t.currentProvince) flags.push(`livesIn 'elsewhere' needs a province code (the 27 of places.ts PROVINCE_PLACES) — none valid given`)
  if (!livesIn) flags.push('livesIn left unanswered: no "In Vietnam now" token, no home area (no cover, no relocation), the edit page asks again')
  const districtText = typeof row.currentDistrict === 'string' ? row.currentDistrict.trim() : ''
  if (districtText && !t.currentDistrictKey) {
    flags.push(t.livesIn === 'city' && t.currentCity === HCMC
      ? `district text "${districtText}" names no curated HCMC district — left unanswered`
      : `district text "${districtText}" dropped: a district is asked only of teachers living in HCMC`)
  } else if (districtText) {
    flags.push(`district text "${districtText}" → ${t.currentDistrictKey} (Listing.district becomes "${DISTRICT_BY_KEY.get(t.currentDistrictKey)?.name}")`)
  }
  const oldAges = arr(row.ageGroups)
  if (oldAges.includes('business')) {
    flags.push(`age group 'business' reads as 'adults' in the new form${t.subjects.includes('business-english') ? '' : ' — and with no Business English subject the ageGroup:business token is DROPPED'} (the stored column keeps 'business')`)
  }
  if (arr(row.jobTypes).includes(ONLINE)) flags.push(`job type 'online' → Online is now a teach area${t.teachAreas.includes(ONLINE) ? '' : ' — DROPPED by the decided situation'} (the stored column keeps 'online')`)
  if (!t.jobTypes.length && !coverIsPublic(t)) {
    flags.push('no job goal left (no full-time / part-time / private, no public cover): the listing stays as it is now, but the teacher\'s next save must pick the work they want or switch cover on — otherwise that save HIDES the profile (D6)')
  }
  if (!t.experienceBand) flags.push('0 years and no teaching history: the experience band is left unanswered ("Needs an answer" on the edit page)')
  if (englishMedium(t.subjects) && !t.englishLevel) flags.push('not marked a native speaker (maybe the untouched default): the English level is left unanswered — the native:non-native token goes until it is answered')
  if (!englishMedium(t.subjects) && row.nativeSpeaker === true) flags.push('marked a native speaker but teaches no English-medium subject: no English level is asked or stored')
  if (t.subjects.includes('other-language')) flags.push('teaches "Other language": which language is unknown (teachLanguages "Needs an answer")')
  const candidate = arr(mapped.teachAreas)
  const kept = new Set(t.teachAreas)
  const lost = [...new Set(candidate)].filter((k) => !kept.has(k))
  if (lost.length) {
    const why = (k: string) => {
      if (isHcmcDistrict(k)) {
        return t.teachAreas.includes(HCMC) ? `${k} (inside "all of HCMC": the whole city wins)` : `${k} (a district is listed only by a teacher living in the HCMC area)`
      }
      if (isHub(k) && t.teachAreas.includes(ANYWHERE)) return `${k} (covered by "anywhere")`
      if (isHub(k) || k === ANYWHERE) return `${k} (away from home: needs a full-time/part-time goal in Vietnam, or a teacher abroad)`
      return k
    }
    flags.push(`teach areas the new rules drop: ${lost.map(why).join(', ')}`)
  }
  if (row.coverOpen === true && row.coverConsentVersion !== COVER_CONSENT_VERSION) {
    flags.push(`cover was ON under notice ${row.coverConsentVersion ?? '(none)'}: it leaves cover search until the teacher switches it on again under ${COVER_CONSENT_VERSION} (the stored cover columns are kept)`)
  }
  const reach = coverReachOf(t)
  const storedAreas = arr(row.coverAreas)
  if (row.coverOpen === true && reach.join() !== storedAreas.join()) {
    flags.push(`cover reach becomes [${reach.join(', ') || 'none'}] (stored areas [${storedAreas.join(', ')}] stay as written until the next save)`)
  }

  const p = teacherListingProjection(t, category)
  return {
    profile: {
      livesIn: t.livesIn,
      currentProvince: t.currentProvince || null,
      currentDistrictKey: t.currentDistrictKey || null,
      teachAreas: t.teachAreas,
      teachLanguages: t.teachLanguages,
      englishLevel: t.englishLevel,
      experienceBand: t.experienceBand,
      situationVersion: TEACHER_SITUATION_VERSION,
    },
    listing: hasListing ? { city: p.city, district: p.district, location: p.location, facetTokens: p.facetTokens, searchText: p.searchText } : null,
    flags,
  }
}

/**
 * Canonical JSON — sorted keys, Dates as ISO strings — so the dry run and --apply hash the same row identically and a
 * changed row (any column the plan read, or any Listing column it overwrites) changes the hash (plan review B8).
 */
export function stableStringify(v: unknown): string {
  if (v instanceof Date) return JSON.stringify(v.toISOString())
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x === undefined ? null : x)).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}
