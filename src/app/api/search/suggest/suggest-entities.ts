/**
 * THE TYPEAHEAD'S ENTITY ROWS — brands, product lines and the scoped row (S-TYPEAHEAD, 2026-09-29).
 *
 * The dropdown used to offer only a raw query, brand chips, category chips and six listings. Three
 * things were measured wrong on production (headless, 1366×900 and the API itself):
 *  · "iph" offered the brand "Qui Phúc" — the brand group matched the typed key ANYWHERE in the
 *    normalized name ("quiphuc" holds "iph"), and "ren" offered "Serenys" the same way.
 *  · "iphone" had no way to say "every iPhone": the `?brand=&line=` filter already existed (the brand
 *    cascade writes it) but the typeahead had no entity for it.
 *  · "sofa" had no way to say "sofas in the Sofa aisle", the one-tap narrowing a shopper wants.
 *
 * ⛔ EVERY COUNT HERE IS THE NUMBER THE CLICK RETURNS. A row that promises one number and lands on
 * another (or on 0) is worse than no row. So the line count is taken from the FEED'S OWN WHERE
 * (`buildFeedFilters`, the builder /api/listings reads) for exactly `brand` + `line`.
 * ⚠️ THE ROW'S URL ALSO NAMES A CATEGORY, AND IT DOES NOT NARROW THE COUNT. With a brand and no model
 * or aisle, the explorer sends the category as `priorityCategory` — a boost, never a filter
 * (listings-explorer.tsx: "Apple" must not hide Apple listings that sit elsewhere). Measured on
 * production data 2026-09-29: the explorer lands on 972 for Apple's iPhone line with or without it,
 * while a HARD `category=electronics` would be 943. The category is there so the rail lights the
 * line's own category on arrival — without it the brand-heal fetch picks the BRAND's category a beat
 * later (and arms the explorer's fold late, its own ⚠️ KNOWN EDGE).
 *
 * ⚠️ BOTH ENTITIES ARE OPTIONAL, SO BOTH FAIL SOFT. A DB error in either returns no row; the query
 * row, the listings and the chips still answer. The route's own reads keep their 500 contract.
 */
import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { MODEL_LINEAGE } from '@/generated/model-lineage'
import { isVisaProductSlot, subcategoriesFor } from '@/lib/taxonomy'
import { buildFeedFilters } from '@/app/api/listings/feed-query'
import { SCOPE_BUDGET_MS, SCOPE_MAX_IN_FLIGHT, aisleDb, isStatementTimeout } from './aisle-db'

/** Fewer live rows than this and a line or an aisle is noise, not a shortcut. */
export const ENTITY_MIN = 3

// ── Brands ────────────────────────────────────────────────────────────────────────────────────

/**
 * The brand group's WHERE: a brand whose matching key STARTS with the typed key, plus — only once
 * the key is 5+ characters long — one that merely CONTAINS it.
 * ⚠️ THE 5 IS ABOUT SYLLABLES. A 3-4 character key is a fragment of a word and lives inside
 * unrelated names ("iph" in "quiphuc", "ren" in "serenys"); by five characters an infix is almost
 * always the brand itself spelled with a prefix ("vuitton" → "louisvuitton").
 */
export function brandWhere(brandKey: string): Prisma.BrandWhereInput {
  return {
    status: 'active',
    listingCount: { gt: 0 },
    OR: [{ normalized: { startsWith: brandKey } }, ...(brandKey.length >= 5 ? [{ normalized: { contains: brandKey } }] : [])],
  }
}

/** Prefix hits first, then the most-listed — the two the chip group shows. */
export function rankBrands<B extends { normalized: string; listingCount: number }>(rows: readonly B[], brandKey: string, take = 2): B[] {
  const prefix = (b: B) => (b.normalized.startsWith(brandKey) ? 0 : 1)
  return [...rows].sort((a, b) => prefix(a) - prefix(b) || b.listingCount - a.listingCount).slice(0, take)
}

// ── Product lines ─────────────────────────────────────────────────────────────────────────────

export type LineCandidate = { brand: string; line: string }

/**
 * The key a line and a query are compared on: case and spacing folded, ACCENTS KEPT.
 * ⛔ NOT fold(). fold() strips Vietnamese tone marks, and line names are Latin product names, so a
 * folded Vietnamese word can prefix one: "bàn" (a table) folds to "ban" and offered "Band · Huawei"
 * (measured on production data, 2026-09-29). A line never carries a Vietnamese mark, so a query
 * that does cannot be naming one — and every query that CAN ("iphone", "ipad", "macbook") matches
 * exactly as before.
 */
export function lineKey(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * The product lines (src/generated/model-lineage.ts) a query names: the query is the start of the
 * line ("iph" → iPhone, iPhone SE) or the line followed by more words ("iphone 17" → iPhone).
 * Nothing under 3 characters — "ip" is every iPad and iPhone at once and names neither.
 *
 * ⚠️ AT MOST `max` CANDIDATES, AND THE ORDER DECIDES WHICH. Each one costs a grouped count (memoized),
 * and a short prefix can name many lines ("gal" names fourteen Samsung Galaxy lines). A line the
 * query names in full comes first, then the SHORTEST completion — the most general line, which is
 * the one a person who stopped typing there most plausibly means ("iPad" before "iPad Mini").
 */
export function lineCandidates(query: string, max = 3): LineCandidate[] {
  const q = lineKey(query)
  if ([...q].length < 3) return []
  const hits: { brand: string; line: string; full: boolean; len: number }[] = []
  for (const [brand, { lines }] of Object.entries(MODEL_LINEAGE)) {
    for (const line of lines) {
      const lk = lineKey(line)
      const full = lk === q || q.startsWith(`${lk} `)
      if (full || lk.startsWith(q)) hits.push({ brand, line, full, len: lk.length })
    }
  }
  return hits
    .sort((a, b) => Number(b.full) - Number(a.full) || a.len - b.len || a.line.localeCompare(b.line) || a.brand.localeCompare(b.brand))
    .slice(0, max)
    .map(({ brand, line }) => ({ brand, line }))
}

/** `count` is every live row of the line; `categoryId` is where most of them are. */
export type LineStats = { brandName: string; categoryId: string; count: number }

const LINE_TTL = 5 * 60_000
const LINE_CACHE_MAX = 500
const lineCache = new Map<string, { at: number; value: Promise<LineStats | null> }>()

/**
 * A line's live listings: the brand's display name, the category holding most of them, and how many
 * there are in all — the total the row's URL returns (the category rides along as a boost, above).
 * Memoized per brand|line for five minutes (a line's size moves slowly; the feed's own count cache is
 * one minute), shared in flight, never caching a failure. null = fewer than ENTITY_MIN live rows
 * ("iPhone SE · Apple 1" is a listing, not a line worth a row), or a hidden brand.
 */
export function lineStats(c: LineCandidate): Promise<LineStats | null> {
  const key = `${c.brand}|${c.line}`
  const hit = lineCache.get(key)
  if (hit && Date.now() - hit.at < LINE_TTL) return hit.value
  const value = (async () => {
    const { where } = await buildFeedFilters(new URLSearchParams({ brand: c.brand, line: c.line }))
    const [groups, brand] = await Promise.all([
      // edition-lint-allow: `where` is buildFeedFilters' own, which pushes marketplaceListingScope()
      // into its AND as a separate element — the exact scope /api/listings applies to this click.
      db.listing.groupBy({ by: ['categoryId'], where, _count: { _all: true }, orderBy: { _count: { categoryId: 'desc' } } }),
      db.brand.findUnique({ where: { slug: c.brand }, select: { name: true, status: true } }),
    ])
    const count = groups.reduce((n, g) => n + (g._count?._all ?? 0), 0)
    const top = groups[0]
    if (!top || !brand || brand.status !== 'active' || count < ENTITY_MIN) return null
    return { brandName: brand.name, categoryId: top.categoryId, count }
  })()
  if (lineCache.size >= LINE_CACHE_MAX) lineCache.delete(lineCache.keys().next().value!)
  lineCache.set(key, { at: Date.now(), value })
  value.catch(() => lineCache.delete(key))
  return value
}

// ── The scoped row ────────────────────────────────────────────────────────────────────────────

export type ScopeGroup = { categoryId: string; subcategorySlug: string | null; _count: { _all: number } }
export type ScopeRow = {
  category: string
  subcategory: string
  categoryName: string
  categoryNameVi: string
  subName: string
  subNameVi: string
  count: number
}

/**
 * The share of the query's matches an aisle must hold before the typeahead offers it as THE place to
 * look. ⛔ A COUNT FLOOR ALONE WAS NOT ENOUGH, MEASURED ON PRODUCTION DATA 2026-09-29: for "xe máy"
 * the three biggest non-empty aisles were Kitchenware 3, Storage 2 and Tables 2 — the motorbikes
 * themselves carry no aisle — so a floor of 3 offered "“xe máy” in Home › Kitchenware". Shares across
 * the golden queries: sofa 91%, apartment 96%, fridge 87%, laptop 69%, tv 65%, iphone 45% (phones;
 * cases are 34%) — and xe máy 3%, bàn 6%, sam 19%, samsung 26% (cases ahead of phones), bike 37%
 * (sportswear). 40% keeps every row that names the aisle a shopper means and drops every one that
 * doesn't. The denominator counts rows with NO aisle too, so a query whose matches are mostly
 * unfiled never gets a row from its filed minority.
 */
export const SCOPE_SHARE = 0.4

/**
 * The aisle (category › subcategory) that holds most of the query's matches — at least ENTITY_MIN
 * rows and SCOPE_SHARE of all of them — and that the taxonomy still offers.
 * ⛔ NEVER THE VISA PRODUCT SLOT (taxonomy.ts isVisaProductSlot), ON EITHER EDITION. The typeahead is
 * a promotional surface under every keystroke; the visa listings stay findable by search and by
 * browsing, but this row does not advertise them.
 * ⚠️ `subcategoriesFor(cat)` IS THE GATE, NOT THE DATA: a slug that only the database still carries
 * (a retired aisle) would land on a filter the explorer cannot show.
 */
export function pickScope(groups: readonly ScopeGroup[], categoriesById: ReadonlyMap<string, { slug: string; name: string; nameVi: string }>): ScopeRow | null {
  const total = groups.reduce((n, g) => n + g._count._all, 0)
  for (const g of groups) {
    if (!g.subcategorySlug || g._count._all < ENTITY_MIN || g._count._all < total * SCOPE_SHARE) continue
    const cat = categoriesById.get(g.categoryId)
    if (!cat || isVisaProductSlot(cat.slug, g.subcategorySlug)) continue
    const sub = subcategoriesFor(cat.slug).find((s) => s.slug === g.subcategorySlug)
    if (!sub) continue
    return {
      category: cat.slug, subcategory: sub.slug,
      categoryName: cat.name, categoryNameVi: cat.nameVi,
      subName: sub.name, subNameVi: sub.nameVi,
      count: g._count._all,
    }
  }
  return null
}

const SCOPE_TTL = 60_000
const SCOPE_CACHE_MAX = 500
const scopeCache = new Map<string, { at: number; value: Promise<ScopeGroup[]> }>()

/**
 * ⛔ THE AISLE COUNT IS BOUNDED ON THE DATABASE, NOT JUST AWAITED WITH A DEADLINE (review, 2026-09-29).
 * It is a grouped count over EVERY match — no LIMIT to stop early — and it runs on every new prefix:
 * 0.5-3.4 s of server time for a broad one ("ca" 730-830 ms, "can ho" 3,300+) against ~2-6 ms for
 * the typeahead's own `ORDER BY rankScore LIMIT 40` read of the same where (aisle-db.ts). A deadline
 * on the AWAIT alone let every abandoned count run to the end on the app's pool, for a memo the next
 * keystroke's new prefix never reads. So:
 *  · It runs on its OWN two-connection client (aisle-db.ts) whose connections carry a
 *    `statement_timeout` of SCOPE_BUDGET_MS: Postgres cancels it there, and it can never take a
 *    connection a page or another API read is waiting for.
 *  · A count cancelled by that budget is an ANSWER, not a failure: "too broad for an aisle row". It
 *    is memoized as no row for the same minute, so the same prefix from anyone costs nothing more.
 *    (Any other error is not cached — the next request asks again.)
 *  · At most SCOPE_MAX_IN_FLIGHT of these counts run at once per instance; past that a keystroke
 *    gets no aisle row and starts nothing (and memoizes nothing) — it does not queue behind the two.
 * ⚠️ THE COST OF THE BOUND: a query whose count outruns the budget gets no scoped row even when one
 * aisle dominates it — "can ho" / "apartment" (96% apartments, 14.6k rows, 2.5-3.3 s) and "điện
 * thoại" (51% phones, ~0.77 s). None of them could have made the 150 ms grace below on the keystroke
 * that asked; they were only ever shown from a warm memo.
 * ⚠️ NOT A LENGTH GATE, AND NOT A GATE ON THE LISTING READ'S CANDIDATES — both were measured on
 * production data and both are wrong here. A short-syllable gate drops the Vietnamese rows that most
 * deserve one ("tủ lạnh" 87% fridges, "máy giặt" 94%, "điều hòa" 75%) and "tv" (65%). The ≤80
 * ranked candidates are led by high-rankScore eSIMs for exactly the broad prefixes ("ca" 88% eSIM,
 * "ban" / "so" / "nha" ~50%), so a gate on them would PASS the expensive scans, and it names the
 * wrong aisle for "iphone" (cases) and "tv" (laptops).
 */
export { SCOPE_BUDGET_MS, SCOPE_MAX_IN_FLIGHT, isStatementTimeout }
let scopeInFlight = 0
/** Bumped by the test seam, so a count still settling from an earlier test cannot decrement a fresh tally. */
let scopeGen = 0

/**
 * The query's matches per aisle, biggest first, counted over the typeahead's OWN where — the same
 * text units and the same district reading the listing rows use, so the number is what the scoped
 * click returns (the feed reads `q` + `category` + `subcategory` through the same predicate,
 * search-match.ts). Grouped by category AND subcategory because aisle slugs repeat across categories
 * ("storage"). No `take`: pickScope needs the total, and there are only ever a few dozen aisles
 * (66 for "bàn", the widest of the golden queries). Memoized per where for a minute — the feed's own
 * count window — and shared in flight. Bounded as described above: [] when it is over budget or when
 * too many are already running.
 */
export function scopeGroups(where: Prisma.ListingWhereInput): Promise<ScopeGroup[]> {
  const key = JSON.stringify(where)
  const hit = scopeCache.get(key)
  if (hit && Date.now() - hit.at < SCOPE_TTL) return hit.value
  if (scopeInFlight >= SCOPE_MAX_IN_FLIGHT) return Promise.resolve([])
  scopeInFlight++
  const gen = scopeGen
  // `client`, not a bare name, so edition-lint still reads this as a listing read (its READ_RE).
  const client = aisleDb()
  // edition-lint-allow: `where` is the route's suggestWhere, built by scopedListingWhere (route.ts).
  const value = client.listing
    .groupBy({
      by: ['categoryId', 'subcategorySlug'],
      where,
      _count: { _all: true },
      // Counting the SLUG, not every row: a group whose aisle is null counts 0 here and sinks.
      orderBy: { _count: { subcategorySlug: 'desc' } },
    })
    .then((rows) => rows.map((r) => ({ categoryId: r.categoryId, subcategorySlug: r.subcategorySlug, _count: { _all: r._count?._all ?? 0 } })))
    .catch((e: unknown): ScopeGroup[] => {
      if (isStatementTimeout(e)) return []
      throw e
    })
    .finally(() => { if (gen === scopeGen) scopeInFlight-- })
  if (scopeCache.size >= SCOPE_CACHE_MAX) scopeCache.delete(scopeCache.keys().next().value!)
  scopeCache.set(key, { at: Date.now(), value })
  value.catch(() => scopeCache.delete(key))
  return value
}

/**
 * How long the dropdown will wait for its entity rows AFTER its own reads (listings, chips) are in.
 * ⚠️ THE ROWS CAN DELAY THE DROPDOWN BY AT MOST THIS MUCH, and only on a keystroke whose line or
 * aisle read is still running when the listing read lands — a memo hit, or a read that finished
 * first, adds nothing. A row that is not ready in time is not shown on that keystroke; its read
 * finishes within its own budget (SCOPE_BUDGET_MS for the aisle; a line is an indexed count of
 * ≤25 ms, measured 2026-09-29) and fills the memo above, so the same query from anyone in the next minute (or five, for
 * a line) gets it.
 */
export const ENTITY_GRACE_MS = 150

/** `p` if it settles within `ms`, else `fallback` — the late result still lands in its memo. */
export function settledWithin<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms) })
  return Promise.race([p, late]).finally(() => clearTimeout(timer))
}

/** Test seam: forget every memoized line and aisle. */
export function __resetSuggestEntityCaches() {
  lineCache.clear()
  scopeCache.clear()
  scopeInFlight = 0
  scopeGen++
}
