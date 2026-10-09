/**
 * THE PUBLIC PROFILE'S PLACE LINES (teacher onboarding redesign, owner, 2026-10-08) — pure, so the server component
 * (src/components/teachers/teacher-profile-view.tsx), its JSON-LD and their tests read ONE derivation of the v2 columns:
 *   · livesInLine — where the teacher lives, in the page's language: "District 7 (Phu My Hung), Ho Chi Minh City" /
 *     "Hanoi" / "Gia Lai" / abroad ("Not in Vietnam yet", + Online) — ⛔ never an empty city and never the old
 *     `?? 'Hồ Chí Minh'` fallback (the card's Listing.location says the same thing: projection.ts teacherHome, and a
 *     test pins the two together);
 *   · teachAreaRows — "Can teach in" (the places near home, and Online) and "Would move to" (other cities, or Anywhere
 *     in Vietnam): the ONE teach-area list (places.ts), split by the home area so a school reads which places need a
 *     move. The school filter "Can teach in" matches the whole list — this only says which part is a move;
 *   · homeLocationName — the JSON-LD homeLocation, ⛔ ONLY for a teacher who lives in Vietnam (abroad, or unanswered:
 *     none — never ", Vietnam" around an empty city, never a city the teacher does not live in).
 * ⛔ PLACE NAMES ARE NEVER MACHINE-TRANSLATED (places.ts placeLabel — PlaceName's rule): Vietnamese for `vi`, English
 * for every other language. The two WORDS among the keys, Online and Anywhere in Vietnam, are the caller's to
 * translate.
 * ⛔ ONE SHAPE (plan review D1): the v2 columns only — no legacy adapter. A row whose "Where are you now?" is
 * unanswered (livesIn NULL — the backfill may leave it so) says nothing about where the teacher lives, rather than
 * guess, and its places are one "Can teach in" list (with no home there is no "move").
 */
import { intlLocale, isMtLanguage } from '@/lib/i18n/langs'
import {
  HCMC, LIVES_IN, ONLINE, homeAreaKeys, isHcmcDistrict, isHub, isPickableProvince, isPlaceKey, placeLabel,
  provinceName, type LivesIn,
} from '@/lib/teachers/places'

export type PublicSituation = {
  livesIn: LivesIn | null
  currentCity: string
  currentDistrictKey: string
  currentProvince: string
  teachAreas: readonly string[]
}

/**
 * A stored row's situation columns, NULL-safe — a NULL array or a value written outside the app must not crash the
 * public page; an unknown livesIn reads as unanswered and an unknown place key is dropped (never printed raw).
 */
export function publicSituation(row: {
  livesIn?: string | null
  currentCity?: string | null
  currentDistrictKey?: string | null
  currentProvince?: string | null
  teachAreas?: readonly string[] | null
}): PublicSituation {
  return {
    livesIn: (LIVES_IN as readonly unknown[]).includes(row.livesIn) ? (row.livesIn as LivesIn) : null,
    currentCity: row.currentCity ?? '',
    currentDistrictKey: row.currentDistrictKey ?? '',
    currentProvince: row.currentProvince ?? '',
    teachAreas: (row.teachAreas ?? []).filter(isPlaceKey),
  }
}

/** Where the teacher lives: a place name, abroad (with or without Online), or nothing to say. */
export type LivesInLine = { kind: 'place'; place: string } | { kind: 'abroad'; online: boolean } | null

/**
 * "Lives in …" — the district (HCMC only, from the curated DISTRICTS name, never the raw key) then the city; the
 * province for "somewhere else in Vietnam"; abroad its own line. A situation that does not hold together (a city
 * answer with no valid city, 'elsewhere' with no valid province) says nothing — never an empty place.
 */
export function livesInLine(t: PublicSituation, lang: string): LivesInLine {
  if (t.livesIn === 'city' && isHub(t.currentCity)) {
    const city = placeLabel(t.currentCity, lang)
    const district = t.currentCity === HCMC && isHcmcDistrict(t.currentDistrictKey) ? placeLabel(t.currentDistrictKey, lang) : ''
    return { kind: 'place', place: district ? `${district}, ${city}` : city }
  }
  if (t.livesIn === 'elsewhere' && isPickableProvince(t.currentProvince)) return { kind: 'place', place: provinceName(t.currentProvince, lang) }
  if (t.livesIn === 'abroad') return { kind: 'abroad', online: t.teachAreas.includes(ONLINE) }
  return null
}

/**
 * The teach areas, split by the home area (places.ts homeAreaKeys — the home province's places):
 *   · canTeachIn — Online and the places in the home area ("near you" on the form);
 *   · wouldMoveTo — everything else: other cities, or 'anywhere'. A teacher abroad has no home area, so every city is
 *     a move — "Not in Vietnam yet", "Can teach in: Online", "Would move to: Anywhere in Vietnam".
 * Both in the stored (canonical) order. Unanswered livesIn: one list, nothing called a move.
 */
export function teachAreaRows(t: PublicSituation): { canTeachIn: string[]; wouldMoveTo: string[] } {
  const areas = t.teachAreas.filter(isPlaceKey)
  if (!t.livesIn) return { canTeachIn: areas, wouldMoveTo: [] }
  const home = new Set(homeAreaKeys(t))
  return {
    canTeachIn: areas.filter((k) => k === ONLINE || home.has(k)),
    wouldMoveTo: areas.filter((k) => k !== ONLINE && !home.has(k)),
  }
}

/**
 * The JSON-LD homeLocation's name, in English (structured data is not localised): the city for a teacher living in a
 * city (city level only — the page's own "Lives in" line is the finer one), the province for "somewhere else". ⛔ null
 * for a teacher abroad or unanswered — the field is then left out, never filled with a place they do not live in.
 */
export function homeLocationName(t: PublicSituation): string | null {
  const line = t.livesIn === 'city' && isHub(t.currentCity) ? placeLabel(t.currentCity, 'en')
    : t.livesIn === 'elsewhere' && isPickableProvince(t.currentProvince) ? provinceName(t.currentProvince, 'en')
    : ''
  return line || null
}

// ── "Available from" — a MONTH (profile.ts stores the month's first day) ───────────────────────────────────────────

/**
 * The stored start as a DAY, 'YYYY-MM-DD' (from the Date Prisma reads — every writer stores UTC midnight, publish.ts
 * `T00:00:00Z` — or a 'YYYY-MM[-DD]' string); null for nothing or a non-date. The page NAMES its month
 * (availableMonthLabel); the day only decides when it reads "Now".
 * ⚠️ THE DAY IS KEPT, NOT ROUNDED TO THE MONTH (gate review, 2026-10-08). The new form asks a month and stores its 1st,
 * but a row the OLD form saved holds any day ('2026-11-20' — profile.ts accepted a full date until 2026-10-08) and the
 * backfill never rewrites a value (plan review D4): read as a month, that teacher turned "Available: Now" on 1 November,
 * nineteen days before they said they could start.
 */
export function availableStart(from: Date | string | null | undefined): string | null {
  const iso = from instanceof Date ? (Number.isFinite(from.getTime()) ? from.toISOString() : '') : from ?? ''
  const m = /^(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?/.exec(iso)
  return m ? `${m[1]}-${m[2]}-${m[3] ?? '01'}` : null
}

const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const

/**
 * A start month the way the reader writes it — 'November 2026' (en), 'tháng 11/2026' (vi), the reader's own month
 * name in the nine machine-translated languages (which render only in the browser).
 * ⛔ NO Intl FOR en / vi AND NO CLOCK (calendar-day.ts's rule): this is in the FIRST render of an ISR-cached page,
 * where the server's HTML and the browser's first paint must be byte-identical — a month table answers the same
 * everywhere. A value that is not a 'YYYY-MM' comes back unchanged.
 */
export function availableMonthLabel(ym: string, lang: string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym)
  if (!m) return ym
  const y = +m[1]
  const mo = +m[2]
  if (isMtLanguage(lang)) {
    try {
      return new Intl.DateTimeFormat(intlLocale(lang), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, mo - 1, 1))
    } catch { /* fall through to the English form */ }
  }
  return lang === 'vi' ? `tháng ${mo}/${y}` : `${EN_MONTHS[mo - 1]} ${y}`
}

/** Vietnam's clock: UTC+7, no DST — every job here is in Vietnam. */
const VN_OFFSET_MS = 7 * 3600_000
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Has the start DAY ('YYYY-MM-DD', availableStart) begun, on Vietnam's calendar? `now` is the READER's clock — ⛔ call
 * it only after mount (src/components/teachers/teacher-available-from.tsx): the server must never freeze a "now" into
 * the cached HTML. Exactly when msUntilStart has nothing left to wait for.
 */
export function startHasBegun(day: string, now: number): boolean {
  return DAY.test(day) && new Date(now + VN_OFFSET_MS).toISOString().slice(0, 10) >= day
}

/**
 * How long until the start day begins — Vietnam's midnight — in ms; null once it has (or for a non-day). What the
 * after-mount timer waits for, so a profile left open across that midnight turns into "Now" without a reload (gate
 * review, 2026-10-08: it said "From November 2026" until the reader reloaded).
 */
export function msUntilStart(day: string, now: number): number | null {
  const m = DAY.exec(day)
  if (!m) return null
  const at = Date.UTC(+m[1], +m[2] - 1, +m[3]) - VN_OFFSET_MS
  return at > now ? at - now : null
}
