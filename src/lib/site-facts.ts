import 'server-only'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { provinceWhere } from '@/lib/province-match'

/**
 * LIVE FACTS ABOUT THE CATALOGUE, FOR THE PAGES THAT DESCRIBE THE SITE TO PEOPLE AND MACHINES —
 * /about's "At a glance" block and /llms.txt.
 *
 * ⛔ WHY THESE ARE COMPUTED AND NEVER TYPED. /llms.txt told every agent that asked that eno.vn has
 * housing in Hanoi and Da Nang, sent housing to /c/property, and advertised motorbikes and moving
 * sales. Measured 2026-09-27 on the public API: 25,502 rentals, ALL in Ho Chi Minh City; /c/property,
 * motorbikes and /c/moving-sale all ZERO. Every one of those sentences was true of some earlier plan
 * and false of the shelf. A sentence built from a count cannot drift that way.
 *
 * ⚠️ THE CITY COUNTS USE `provinceWhere` — THE AREA FILTER'S OWN PREDICATE — so a number printed here is
 * the number a reader gets by picking that city in the filter (/api/listings `facets.province`). A
 * hand-rolled `city: 'Hồ Chí Minh'` would disagree with it on every row stored as 'Ho Chi Minh City'.
 *
 * ⚠️ "LINKED" MEANS `affiliateUrl` IS SET, and that is the same test the listing card uses
 * (`isPartnerBooking`, src/lib/serialize.ts): the listing page swaps its chat button for an outbound
 * link to the site the listing came from. Imported rentals (Nhatot, Muaban, Batdongsan, Rever,
 * Honeycomb) and partner products are all this shape. Measured 2026-09-27 on 100-card samples:
 * 100/100 rentals, 100/100 electronics, 39/39 jobs, 98/100 furniture — which is why the pages must say
 * so instead of implying every listing is answered in-app.
 */

const LIVE = { verified: true, status: 'active' } as const

/** vn-units `nameEn` — the exact `?province=` values /api/listings counts, so the numbers agree. */
export const CITY_PROVINCES = { hcmc: 'Ho Chi Minh', hanoi: 'Ha Noi', daNang: 'Da Nang' } as const
export type CityKey = keyof typeof CITY_PROVINCES
export const CITY_KEYS = Object.keys(CITY_PROVINCES) as CityKey[]
/** English display names, for prose. */
export const CITY_NAMES: Record<CityKey, string> = { hcmc: 'Ho Chi Minh City', hanoi: 'Hanoi', daNang: 'Da Nang' }

export type SiteFacts = {
  /** Live listings on THIS edition (verified, active, edition-scoped). */
  live: number
  /** …of which open on a partner's site rather than in chat here. */
  linked: number
  /** Live listings per category slug; a category with none is absent, never 0. */
  byCategory: Record<string, number>
  /** Live motorbikes (vehicles › motorbike) — the claim /llms.txt used to make with no stock behind it. */
  motorbikes: number
  /** Per city: live listings per category slug, on the Area filter's predicate. */
  byCity: Record<CityKey, Record<string, number>>
}

type Grouped = { categoryId: string; _count: { _all: number } }[]

/** groupBy rows keyed by category id → a slug-keyed count map, dropping empties and unknown ids. */
function bySlug(rows: Grouped, slugOf: Map<string, string>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) {
    const slug = slugOf.get(r.categoryId)
    if (!slug || r._count._all <= 0) continue
    out[slug] = (out[slug] ?? 0) + r._count._all
  }
  return out
}

const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0)

/** Each count limited to the same key's count in `whole`; keys absent from `whole` drop out. */
function capBy(part: Record<string, number>, whole: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, n] of Object.entries(part)) {
    const v = Math.min(n, whole[k] ?? 0)
    if (v > 0) out[k] = v
  }
  return out
}

/** Pure assembly of the query results — exported for tests, which cannot reach a database. */
export function assembleFacts(input: {
  categories: { id: string; slug: string }[]
  live: Grouped
  linked: Grouped
  motorbikes: number
  byCity: Record<CityKey, Grouped>
}): SiteFacts {
  const slugOf = new Map(input.categories.map((c) => [c.id, c.slug]))
  const byCategory = bySlug(input.live, slugOf)
  const live = sum(byCategory)
  return {
    live,
    // ⚠️ SAME DENOMINATOR AS `live`, OR shareOf LIES. `live` keeps only listings in a known category,
    // so a raw linked count would include orphans `live` dropped and could exceed it — and shareOf
    // answers 'all' ("every listing is linked") for part ≥ whole. Grouping linked the same way keeps
    // it a subset; the min() covers the two reads landing either side of an import (agy + opus,
    // 2026-09-27).
    linked: Math.min(sum(bySlug(input.linked, slugOf)), live),
    byCategory,
    motorbikes: input.motorbikes,
    // ⚠️ AND EVERY CITY COUNT IS BOUNDED BY ITS CATEGORY'S. The city scans run in the second wave, so
    // an import landing between the waves could put HCMC above `live` — and shareOf would then print
    // "everything listed is in Ho Chi Minh City" while Hanoi holds stock. The invariant is the one
    // `linked` keeps: a part never exceeds its whole, enforced here, where every total is assembled.
    byCity: Object.fromEntries(CITY_KEYS.map((k) => [k, capBy(bySlug(input.byCity[k], slugOf), byCategory)])) as SiteFacts['byCity'],
  }
}

/** Live listings in a city, optionally within one category. */
export function inCity(facts: SiteFacts, city: CityKey, categorySlug?: string): number {
  const m = facts.byCity[city]
  return categorySlug ? m[categorySlug] ?? 0 : sum(m)
}

/**
 * How much of a whole a part is, in the four words the pages are allowed to use.
 * ⚠️ 'most' is a strict majority and 'almost' is ≥ 90%: the prose says "most" and "almost
 * everything", and each word has to stay true at its boundary, not merely near it.
 */
export type Share = 'all' | 'almost' | 'most' | 'some' | 'none'
export function shareOf(part: number, whole: number): Share | null {
  if (!(whole > 0)) return null
  if (part >= whole) return 'all'
  if (part * 10 >= whole * 9) return 'almost'
  if (part * 2 > whole) return 'most'
  return part > 0 ? 'some' : 'none'
}

/**
 * ⚠️ MEMOIZED, BECAUSE ONE CALLER IS PER-REQUEST. /about and /llms.txt are ISR, but /md/home and
 * /md/index are force-dynamic and re-serve /llms.txt's bytes on every `Accept: text/markdown` hit, and
 * these are full-table aggregates. Ten minutes of drift in a sentence like "every rental is in Ho Chi
 * Minh City" is invisible; a database round of aggregates per agent request is not. Same shape as the
 * demand cache in src/lib/categories.ts: a failed read is never cached, and concurrent callers share
 * one read. One entry, because each edition is its own process and the scope is resolved inside.
 */
const TTL_MS = 10 * 60_000
/** How long a caller waits for the counts before describing the site without them. */
export const READ_BUDGET_MS = 8_000
let memo: { at: number; facts: SiteFacts } | null = null
let inFlight: Promise<SiteFacts> | null = null

async function readFacts(): Promise<SiteFacts> {
  // ⚠️ EVERY PREDICATE IS SCOPED UP FRONT, IN PARALLEL. Written as `where: await scopedListingWhere(…)`
  // inside the query arrays below, each await would hold up constructing the rest of the array — the
  // serialisation src/app/[lang]/(home)/page.tsx documents — and outside a React render the scope's
  // seller lookups are not request-cached, so that is one desk round trip per query, in a row.
  const [liveWhere, linkedWhere, motorbikeWhere, hcmcWhere, hanoiWhere, daNangWhere] = await Promise.all([
    scopedListingWhere(LIVE),
    scopedListingWhere({ ...LIVE, affiliateUrl: { not: null } }),
    scopedListingWhere({ ...LIVE, category: { slug: 'vehicles' }, subcategorySlug: 'motorbike' }),
    scopedListingWhere({ ...LIVE, ...provinceWhere(CITY_PROVINCES.hcmc) }),
    scopedListingWhere({ ...LIVE, ...provinceWhere(CITY_PROVINCES.hanoi) }),
    scopedListingWhere({ ...LIVE, ...provinceWhere(CITY_PROVINCES.daNang) }),
  ])
  // Two waves, not one Promise.all of seven: node-postgres runs a pool of 10 (src/lib/db.ts), and
  // these are full scans — firing all of them at once would queue the feed behind an about page.
  // The per-city `contains` scans are the heavy half and go second.
  const [categories, live, linked, motorbikes] = await Promise.all([
    db.category.findMany({ select: { id: true, slug: true } }),
    db.listing.groupBy({ by: ['categoryId'], where: liveWhere, _count: { _all: true } }),
    db.listing.groupBy({ by: ['categoryId'], where: linkedWhere, _count: { _all: true } }),
    db.listing.count({ where: motorbikeWhere }),
  ])
  const [hcmc, hanoi, daNang] = await Promise.all([
    db.listing.groupBy({ by: ['categoryId'], where: hcmcWhere, _count: { _all: true } }),
    db.listing.groupBy({ by: ['categoryId'], where: hanoiWhere, _count: { _all: true } }),
    db.listing.groupBy({ by: ['categoryId'], where: daNangWhere, _count: { _all: true } }),
  ])
  return assembleFacts({ categories, live, linked, motorbikes, byCity: { hcmc, hanoi, daNang } })
}

/**
 * The facts, or `null` when they cannot be read.
 *
 * ⚠️ NULL IS AN ANSWER THE CALLERS HANDLE, NOT AN ERROR THEY SEE: every sentence built from these
 * facts is omitted when they are missing, so an outage makes the pages say LESS, never something
 * false. That includes a DeskResolutionError — the scope failing to resolve means no count was taken
 * at all, so nothing can leak; it is logged loudly rather than 500ing the About page.
 */
export async function loadSiteFacts(): Promise<SiteFacts | null> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.facts
  if (!inFlight) {
    inFlight = readFacts()
      .then((facts) => {
        memo = { at: Date.now(), facts }
        return facts
      })
      .finally(() => {
        inFlight = null
      })
  }
  // ⚠️ A READ THAT NEVER SETTLES IS AN OUTAGE TOO. `null` covers the outages that throw; a stuck scan
  // would otherwise hold /llms.txt's stream (and the per-request /md/home and /md/index that re-serve
  // it) open indefinitely, every concurrent caller sharing the same hung read. After the budget the
  // caller gets `null` and the page says less; the read itself runs on and memoizes if it finishes.
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      inFlight,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          console.error(`[site-facts] live counts took over ${READ_BUDGET_MS}ms — describing the site without them`)
          resolve(null)
        }, READ_BUDGET_MS)
      }),
    ])
  } catch (e) {
    console.error('[site-facts] live counts unavailable — describing the site without them', e)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Test hook: forget the memo. */
export function resetSiteFactsMemo() {
  memo = null
  inFlight = null
}
