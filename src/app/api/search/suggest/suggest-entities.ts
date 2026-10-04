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
import { TAXONOMY, isVisaProductSlot, subcategoriesFor } from '@/lib/taxonomy'
import { fold } from '@/lib/fold'
import { SYNONYM_GROUPS, conditionWordMask } from '@/lib/search-synonyms'
import { wordStart, type ParsedQuery } from '@/lib/text-relevance'
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
 * ⛔ ONLY BRANDS WITH LIVE LISTINGS (`liveSlugs`, src/lib/live-brands.ts) — a chip opens `/?brand=<slug>`,
 * so a brand with nothing live is a chip into an empty feed. This read `listingCount > 0`, a counter that a
 * sale or a hide never lowers, so a brand sold out since the last recount kept its chip.
 */
export function brandWhere(brandKey: string, liveSlugs: readonly string[]): Prisma.BrandWhereInput {
  return {
    status: 'active',
    slug: { in: [...liveSlugs] },
    OR: [{ normalized: { startsWith: brandKey } }, ...(brandKey.length >= 5 ? [{ normalized: { contains: brandKey } }] : [])],
  }
}

/** Prefix hits first, then the most live listings — the two the chip group shows. */
export function rankBrands<B extends { slug: string; normalized: string }>(rows: readonly B[], brandKey: string, live: ReadonlyMap<string, number>, take = 2): B[] {
  const prefix = (b: B) => (b.normalized.startsWith(brandKey) ? 0 : 1)
  const count = (b: B) => live.get(b.slug) ?? 0
  return [...rows].sort((a, b) => prefix(a) - prefix(b) || count(b) - count(a)).slice(0, take)
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
 * The taxonomy's names and keywords and the synonym terms that are ONE word, lowercased WITH their marks —
 * the words a reader may stop typing on ("tv", "tủ", "bàn" are whole words at two or three letters).
 * ⚠️ WHOLE ENTRIES ONLY, NEVER THE WORDS OF A PHRASE: "xe số" would make "số" one, and "camera ip" `ip`.
 * ⚠️ MARKS KEPT, NOT FOLDED: folded, the notebook keyword "sổ" is `so`, the start of "sofa".
 * (The synonym groups are stored folded, so only their unmarked one-word terms — "tv", "sofa" — count.)
 */
const KNOWN_WORDS: ReadonlySet<string> = (() => {
  const words = new Set<string>()
  const put = (s: string) => { const w = s.normalize('NFC').toLowerCase().trim(); if (w && !/\s/.test(w)) words.add(w) }
  for (const cat of TAXONOMY) {
    put(cat.name); put(cat.nameVi)
    for (const sub of cat.subcategories) for (const k of [sub.name, sub.nameVi, ...sub.keywords]) put(k)
  }
  for (const g of SYNONYM_GROUPS) for (const t of g) put(t)
  return words
})()

/**
 * ⛔ THE SCOPED ROW WAITS FOR A WORD (disc-08(a), UX program 2). Mid-word, a fragment is an aisle's
 * worth of unrelated rows: "may gi" (on its way to "máy giặt") offered "Cameras", because `gi` begins
 * a camera's word too. The row appears once the last word is 3+ characters, carries a digit (a model:
 * "iphone 13", "s24"), is already a whole word the catalogue knows ("tv", "tủ", "bàn"), or ends a
 * condition phrase. The listings and the chips are not gated — they are previews, not a destination.
 * ⚠️ A CONDITION WORD IS A COMPLETE WORD (review, 2026-10-04): folded, "cũ" is the two letters `cu`, so
 * "iphone 13 pro max cũ", "xe máy cũ" and "tủ lạnh cũ" lost the row they had before this gate. Read as
 * typed (search-synonyms.ts conditionWordMask — accents kept, so a bare `cu` is still a fragment), on
 * the words themselves: the caller's `q` keeps its district words, which its own reading needs.
 */
export function scopeQueryReady(q: string): boolean {
  const words = q.normalize('NFC').toLowerCase().split(/\s+/).filter(Boolean)
  const last = words.at(-1) ?? ''
  return fold(last).length >= 3 || /\d/.test(last) || KNOWN_WORDS.has(last) || (conditionWordMask(words).at(-1) ?? false)
}

/** What `aisleEvidence` reads from a candidate row (RANK_SELECT has all of it). */
export type EvidenceRow = { title: string; titleVi: string | null; subcategorySlug: string | null; category: { slug: string } }

/**
 * A typed unit that carries Vietnamese marks — fold() would make it ambiguous ("tủ"/"tự" → `tu`).
 * ⚠️ CASE IS NOT A MARK (commit gate, 2026-10-04): fold() also lowercases, so comparing it with the raw
 * text called "Sofa" and "iPhone" (a phone keyboard's capital) marked, and the scoped row then
 * demanded a capitalised word in lowercased titles. Both sides are lowercased (NFC) first.
 */
export const hasMarks = (typed: string) => {
  const t = typed.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
  return fold(t) !== t
}

/** `typed` at a word start of `text`, marks kept — both sides NFC and lowercased; Unicode-aware, unlike wordStart. */
function markedWordStart(text: string | null, typed: string): boolean {
  if (!text || !typed) return false
  const hay = text.normalize('NFC').toLowerCase()
  const needle = typed.normalize('NFC').toLowerCase()
  let at = hay.indexOf(needle)
  while (at >= 0) {
    if (at === 0 || !/[\p{L}\p{N}]/u.test(hay[at - 1])) return true
    at = hay.indexOf(needle, at + 1)
  }
  return false
}

/**
 * The aisles whose candidate rows NAME the query in their title, counted per `category|subcategory`
 * (tủ/ban, UX program 2). A unit typed WITH marks must appear with those marks ("tủ" is not "tự", the
 * "tự lái" of every self-drive car — measured: "tủ" offered Rentals › Car) or as one of its
 * unambiguous synonyms ("tủ lạnh" → "fridge"); a unit typed without marks may appear as any of its
 * terms at a word start. Read from the typeahead's own ≤80 ranked candidates — no extra query.
 */
export function aisleEvidence(rows: readonly EvidenceRow[], query: ParsedQuery): Map<string, number> {
  const hits = new Map<string, number>()
  // No units (a condition-words-only query): nothing to be named, and `every` over none would count every row.
  if (query.units.length === 0) return hits
  for (const r of rows) {
    if (!r.subcategorySlug) continue
    const title = fold(r.title || '')
    const titleVi = fold(r.titleVi || '')
    const named = query.units.every((u, i) => {
      const typed = query.typed[i] ?? ''
      const marked = hasMarks(typed)
      if (marked && (markedWordStart(r.title, typed) || markedWordStart(r.titleVi, typed))) return true
      const terms = marked ? u.terms.filter((t) => t !== fold(typed)) : u.terms
      return terms.some((t) => wordStart(title, t) || wordStart(titleVi, t))
    })
    if (!named) continue
    const key = `${r.category.slug}|${r.subcategorySlug}`
    hits.set(key, (hits.get(key) ?? 0) + 1)
  }
  return hits
}

/**
 * The aisle (category › subcategory) that holds most of the query's matches — at least ENTITY_MIN
 * rows and SCOPE_SHARE of all of them — and that the taxonomy still offers.
 * ⛔ NEVER THE VISA PRODUCT SLOT (taxonomy.ts isVisaProductSlot), ON EITHER EDITION. The typeahead is
 * a promotional surface under every keystroke; the visa listings stay findable by search and by
 * browsing, but this row does not advertise them.
 * ⚠️ `subcategoriesFor(cat)` IS THE GATE, NOT THE DATA: a slug that only the database still carries
 * (a retired aisle) would land on a filter the explorer cannot show.
 */
export function pickScope(
  groups: readonly ScopeGroup[],
  categoriesById: ReadonlyMap<string, { slug: string; name: string; nameVi: string }>,
  /**
   * What the typed words themselves say (tủ/ban, UX program 2) — all optional, so a caller without
   * them gets the count-only rule above:
   *  · `q`: the row waits for a whole word (scopeQueryReady);
   *  · `evidence` (aisleEvidence): aisles whose rows NAME the words lead, before raw count, and once
   *    any aisle has such a row an aisle with none is not offered; `marked` says the words carried
   *    Vietnamese marks, and then an aisle no row names is never offered (the count is of the folded,
   *    ambiguous spelling);
   *  · `topCategories`: the categories of the first listing suggestions — an aisle in a different
   *    category from every one of them is not where the query's best matches are.
   */
  opts: { q?: string; evidence?: ReadonlyMap<string, number>; marked?: boolean; topCategories?: readonly string[] } = {},
): ScopeRow | null {
  if (opts.q !== undefined && !scopeQueryReady(opts.q)) return null
  const total = groups.reduce((n, g) => n + g._count._all, 0)
  const evidence = opts.evidence
  const named = evidence ? [...evidence.values()].reduce((n, v) => n + v, 0) : 0
  if (evidence && opts.marked && named === 0) return null
  const hitsOf = (g: ScopeGroup) => evidence?.get(`${categoriesById.get(g.categoryId)?.slug}|${g.subcategorySlug}`) ?? 0
  // A STABLE sort: with no evidence every group ties and the database's count order stands.
  const ordered = named > 0 ? [...groups].sort((a, b) => hitsOf(b) - hitsOf(a)) : groups
  for (const g of ordered) {
    if (!g.subcategorySlug || g._count._all < ENTITY_MIN || g._count._all < total * SCOPE_SHARE) continue
    if (named > 0 && hitsOf(g) === 0) continue
    const cat = categoriesById.get(g.categoryId)
    if (!cat || isVisaProductSlot(cat.slug, g.subcategorySlug)) continue
    if (opts.topCategories?.length && !opts.topCategories.includes(cat.slug)) continue
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
