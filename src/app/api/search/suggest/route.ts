import { scopedListingWhere } from '@/lib/edition-scope'
import { NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { db } from '@/lib/db'
import { fold } from '@/lib/fold'
import { normalizeBrand } from '@/lib/brand-normalize'
import { rateLimit } from '@/lib/ratelimit'
import { route } from '@/lib/api/handler'
import { hasPlainTextFallback, inferDistrictFromQuery, type DistrictInference } from '@/lib/district-query'
import { districtScopeForSlug } from '@/lib/district-slug'
import { textClauses } from '@/lib/search-match'
import { parseSearchQuery } from '@/lib/text-relevance'
import { splitConditionWords } from '@/lib/search-synonyms'
import { diversifyRail } from '@/lib/feed-diversity'
import { displayPriceUnit } from '@/lib/price-unit'
import { UNLINKED_CATEGORIES } from '@/lib/retired-categories'
import { liveBrandCounts } from '@/lib/live-brands'
import { RANK_SELECT, rankCandidates, relevanceOrder } from '@/app/api/listings/keyword-rank'
import type { Prisma } from '@/generated/prisma/client'
import { ENTITY_GRACE_MS, aisleEvidence, brandWhere, hasMarks, lineCandidates, lineStats, pickScope, rankBrands, scopeGroups, settledWithin, type ScopeGroup } from './suggest-entities'
import { correctQuery } from '@/lib/spell-correct'

export const runtime = 'nodejs'

// Instant-match suggestions for the search bars (debounced typeahead, mobile +
// desktop). Queries the folded, accent-insensitive `searchText` (pg_trgm GIN
// index) for live listings + a few matching categories. Public → verified+active
// only, same gate as the browse feed. Intentionally lightweight (minimal select,
// small take) so it's fast enough to hit on every keystroke.
//
// ⚠️ WS6 MIGRATION. `auth: 'public'` — the typeahead runs for logged-out visitors on every page.
//
// ⛔ THE RATE LIMIT IS **NOT** HANDED TO THE WRAPPER, AND THAT IS THE WHOLE CARE POINT HERE.
// `route()`'s `rateLimit:` option answers 429 `{"error":"rate_limited"}`. This route does the
// opposite on purpose: when the IP limit trips it returns **200** with an empty suggestion set, so a
// throttled keystroke silently shows no dropdown instead of erroring the search bar. Moving it into
// the option would turn a 200 into a 429 on a path the client does not handle — a wire change on
// every fast typist. The `rateLimit('search-suggest', ip, 120, '1 m')` call therefore stays inline,
// verbatim, including `clientIp(req)` (same helper the wrapper would have used for the key).
//
// ⚠️ `NextRequest` → `Request`: `req.nextUrl.searchParams` became `new URL(req.url).searchParams`.
// Same string in, same `q` out — `nextUrl` is a NextURL over the identical url, and nothing here
// touched a Next-only field.
//
// Branches, all unchanged: q < 2 chars → 200 `{q,listings:[],categories:[],brands:[]}` and NO cache
// header (as before); rate-limited → the same uncached 200 empty payload; hit → 200 with the
// max-age=10 header. Accepted wire change on the failure path only: the Promise.all of three
// unguarded DB reads (and `scopedListingWhere()`) used to throw into Next's default 500 and now
// answers `{"error":"internal_error"}` 500.
// ⚠️ ADDITIVE WIRE CHANGE, 2026-09-29 (S-TYPEAHEAD): every payload, the empty ones included, also
// carries `lines` ([] when none) and `scope` (null when none). Both are optional rows and fail soft —
// a failed line or aisle read drops the row, never the response (suggest-entities.ts).
// ⚠️ ADDITIVE WIRE CHANGE, 2026-10-04 (UX program 2): every payload also carries `didYouMean` (null when
// none) — a corrected query for a typo that suggests nothing. Optional like the rows above; fails soft.
export const GET = route({ auth: 'public' }, async ({ req }) => {
  const q = (new URL(req.url).searchParams.get('q') || '').trim().slice(0, 80)
  if (q.length < 2) return NextResponse.json({ q, listings: [], categories: [], brands: [], lines: [], scope: null, didYouMean: null })

  // Public + unindexed-ILIKE per keystroke → IP throttle to bound DB amplification.
  const ip = clientIp(req)
  const rl = await rateLimit('search-suggest', ip, 120, '1 m')
  if (!rl.success) return NextResponse.json({ q, listings: [], categories: [], brands: [], lines: [], scope: null, didYouMean: null })

  const folded = fold(q)
  /**
   * ⛔ A DISTRICT IN THE QUERY IS THE FEED'S DISTRICT SCOPE HERE TOO (src/lib/district-query.ts).
   * The typeahead matched "Quận 1" as the lone token `quan` — its six listings were the same six for
   * every numbered district, and 0 of them were in Quận 1. The dropdown is the preview of what Enter
   * returns, so it reads the query the way the feed now does: district scope, remaining words as text.
   */
  const inferred = inferDistrictFromQuery(q)
  /**
   * The words the typeahead searches for, read with its district (`reading`) or as plain words (null),
   * WITHOUT the condition words — the feed's own split (feed-query.ts, search-synonyms.ts
   * splitConditionWords): "second hand furniture" previews "furniture", whatever its condition.
   */
  const textFor = (reading: DistrictInference | null) => splitConditionWords(reading ? reading.rest : q).rest
  const askedCondition = splitConditionWords(q).used
  /** The typeahead's WHERE for the query read with its district (`reading`) or as plain words (null). */
  const whereFor = async (reading: DistrictInference | null) => {
    // ⛔ THE FEED'S OWN TEXT FILTER (src/lib/search-match.ts): one clause per unit — a short token at
    // a word start, a synonym phrase as one unit — ANDed so multi-word typeahead narrows exactly as
    // Enter does.
    const searchAnd: Prisma.ListingWhereInput[] = textClauses(fold(textFor(reading)))
    // Condition words filter nothing; ALONE they are the feed's goods browse — the items for sale
    // (feed-query.ts `saleScopeFromWords`; no explicit type chip exists here).
    if (askedCondition && !textFor(reading)) searchAnd.push({ listingType: 'sell' })
    const districtScope = reading ? await districtScopeForSlug(reading.slug) : null
    if (districtScope) searchAnd.push(districtScope)
    return scopedListingWhere({ verified: true, status: 'active', AND: searchAnd })
  }
  /**
   * ⛔ THE SIX ROWS ARE RANKED THE WAY ENTER RANKS THEM (keyword-rank.ts), so the dropdown is a preview
   * of the results page. It used to take the six best by rankScore alone — for "iphone" that meant an
   * eSIM and a tote bag above the phones (a passing mention in their descriptions). Now: the best 40
   * matches by rankScore plus up to 40 title hits, scored by text-relevance.ts, STRONG rows first by
   * the owner's searchScore, then the rest by rankScore. Then one row per model across the six and no
   * two with the same cover photo (diversifyRail — no seller interleave: the order is relevance).
   * The extra fields ranking reads (seller, brand, model) never reach the wire.
   */
  const SUGGEST_SELECT = {
    ...RANK_SELECT,
    price: true, currency: true, priceUnit: true, location: true, images: true, listingType: true, affiliateUrl: true,
  } as const
  const suggestFor = async (where: Prisma.ListingWhereInput, text: string) => {
    const query = parseSearchQuery(text)
    const rows = await rankCandidates(where, query, { takeA: 40, takeB: 40, select: SUGGEST_SELECT })
    const { strong, weak } = relevanceOrder(rows, query, Date.now())
    const withCovers = [...strong, ...weak].map((l) => {
      let images: string[] = []
      try { images = JSON.parse(l.images || '[]') } catch { /* ignore */ }
      return { ...l, images: Array.isArray(images) ? images : [] }
    })
    return {
      picked: diversifyRail(withCovers, { take: 6, perSeat: Infinity, modelScope: 'global', sharedSeats: false, interleave: false }),
      // Which aisles' candidates NAME the words in their title — the scoped row's ranking (pickScope).
      evidence: aisleEvidence(rows, query),
      marked: query.typed.some(hasMarks),
    }
  }
  // Brand matching key ("Louis V" → "louisv") so a spaced prefix still hits "louisvuitton".
  const brandKey = normalizeBrand(q)

  // Hoisted above the Promise.all: an await inside an array element would serialise the reads
  // that this Promise.all exists to overlap.
  const suggestWhere = await whereFor(inferred)
  /**
   * The ENTITY rows (suggest-entities.ts): product lines, each with the count its link returns, and
   * the query's aisles for the scoped row. Started first so they overlap the reads below; awaited
   * AFTER them with a short grace: an optional row delays the response by at most ENTITY_GRACE_MS,
   * and only when its read is still running once the reads below are in. The aisle count is also
   * bounded ON THE DATABASE: it runs on its own two-connection client with a statement budget
   * (aisle-db.ts), so a count this keystroke abandons is cancelled by Postgres and never holds a
   * connection the reads below need. Both fail soft: a failed read drops the row, never the response.
   */
  const linesP = Promise.all(lineCandidates(q).map((c) => lineStats(c).then((s) => (s ? { ...c, ...s } : null), () => null)))
  const groupsP = scopeGroups(suggestWhere).catch((): ScopeGroup[] => [])
  /**
   * The "Brands" group — brands with LIVE listings whose matching key STARTS with the typed key
   * ("hon" → Honda), most-listed first. ⛔ A PREFIX, NOT A SUBSTRING (suggest-entities.ts brandWhere):
   * "iph" used to offer "Qui Phúc" and "ren" "Serenys". ⛔ LIVE, NOT `listingCount` (src/lib/live-brands.ts,
   * memoized for a minute): every match is read and ranked in JS — the matches are bounded by the live
   * set (brands with a live row, not the catalogue), and a `take` before the ranking could cut the brand
   * that should lead.
   * ⚠️ OPTIONAL, LIKE THE ENTITY ROWS ABOVE, AND FOR THE SAME REASON (commit-gate review): the live set is
   * a grouped read over listings, and once a minute per process it misses its memo. Started
   * here so it overlaps the reads below, and awaited with the same grace — a slow read holds the dropdown
   * by at most ENTITY_GRACE_MS, skips the chips on that keystroke and fills the memo for the next. A
   * failed read (either one) drops the chips, never the response.
   */
  const brandsP: Promise<{ slug: string; name: string; normalized: string }[]> = brandKey.length >= 2
    ? liveBrandCounts()
        .then(async (live) => rankBrands(
          await db.brand.findMany({ where: brandWhere(brandKey, [...live.keys()]), select: { slug: true, name: true, normalized: true } }),
          brandKey,
          live,
        ))
        .catch((e: unknown) => { console.error('[suggest] brand chips read failed — no brand chips', e); return [] })
    : Promise.resolve([])
  const [{ picked: listings, evidence, marked }, allCategories] = await Promise.all([
    /**
     * ⛔ THE FEED'S SAFETY NET, HERE TOO (resolveFeedFilters in feed-query.ts): a district reading that
     * suggests nothing while the plain words would ("Hồi ức Phú Nhuận", a book) falls back to the
     * plain words, so the preview never shows less than Enter returns. A second query only on that
     * empty path; never for a bare numbered district (hasPlainTextFallback).
     */
    suggestFor(suggestWhere, textFor(inferred)).then(async (res) =>
      res.picked.length === 0 && inferred && hasPlainTextFallback(inferred) ? suggestFor(await whereFor(null), textFor(null)) : res),
    // Categories are a tiny fixed set — fetch once and match on FOLDED text in JS
    // so accent-free input ("can ho") matches "Căn hộ", consistent with the
    // accent-insensitive listing search (and one fewer DB round-trip per keystroke).
    // `id` too: the line and scope rows are grouped by categoryId and name the category by slug.
    db.category.findMany({ select: { id: true, slug: true, name: true, nameVi: true } }),
  ])
  const [lines, groups, brands] = await Promise.all([
    settledWithin(linesP, ENTITY_GRACE_MS, []),
    settledWithin(groupsP, ENTITY_GRACE_MS, []),
    settledWithin(brandsP, ENTITY_GRACE_MS, []),
  ])

  // ⛔ A retired or empty shelf is not suggested (second-hand focus, 2026-10-03): the header routes a category
  // suggestion to /c/<slug>, and /c/vehicles now redirects to a rental hub. The same set the footer and the
  // "Other categories" chips leave out (UNLINKED_CATEGORIES). Their LISTINGS still match below.
  const categories = allCategories
    .filter((c) => !UNLINKED_CATEGORIES.has(c.slug))
    .filter((c) => fold(c.name).includes(folded) || fold(c.nameVi).includes(folded))
    .slice(0, 4)
  const categoriesById = new Map(allCategories.map((c) => [c.id, c]))
  /**
   * At most two lines, most-listed first, each named with the category most of it lives in — the
   * explorer's category BOOST for a brand, which does not narrow the count (suggest-entities.ts).
   */
  const lineRows = lines
    .flatMap((l) => {
      const cat = l && categoriesById.get(l.categoryId)
      return l && cat ? [{ brand: l.brand, brandName: l.brandName, line: l.line, category: cat.slug, count: l.count }] : []
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
  /**
   * ⛔ THE AISLE MUST BE ONE THE WORDS NAME (disc-08(a), tủ/ban — UX program 2). By count alone, "tủ"
   * (a cabinet) offered Rentals › Car: folded to `tu` it is the "tự" of every "thuê xe tự lái", and
   * 6,000 self-drive cars outnumber every cabinet. The row now waits for a whole word, prefers the
   * aisles whose rows say the words as typed (marks kept), and is dropped when the best listing
   * suggestions all sit in another category.
   */
  const topCategories = [...new Set(listings.slice(0, 3).map((l) => l.category.slug))]
  // ⛔ A QUERY OF CONDITION WORDS ONLY ("đồ cũ", "second hand") GETS NO AISLE ROW: nothing names an aisle, and an
  // empty word list would count every row as naming it (commit-gate review 2026-10-04). Judged on the RAW typed
  // words — a district-only query ("Quận 7") also leaves no text units, and it keeps its row.
  const conditionOnly = (() => { const s = splitConditionWords(q); return s.used && !s.rest.trim() })()
  const scope = conditionOnly ? null : pickScope(groups, categoriesById, { q, evidence, marked, topCategories })
  /**
   * "DID YOU MEAN" — a typo that finds nothing (research-typeahead: "iphnoe", "samsng" offered no row
   * at all). ⛔ ONLY WHEN NOTHING ELSE MATCHED: no listing, no brand, no category, no product line, no
   * scoped row — and never for a district query (its words are district-query.ts's). A correction must
   * itself find a live row: the feed's own corrector (src/lib/spell-correct.ts — what /api/listings
   * answers a zero with), one cached vocabulary, one LIMIT-1 read. O-44 holds: nothing is logged.
   * Fails soft to no row.
   * ⚠️ THE CHECK READS THE CORRECTION THE WAY ENTER WILL: condition words out of the text, filtering
   * nothing (splitConditionWords, as `whereFor` above). The corrector keeps every word it did not
   * correct exactly as typed ("tủ lạnh samsng" → "tủ lạnh samsung"), so the row reads in the reader's
   * own spelling.
   */
  const nothingElse = listings.length === 0 && brands.length === 0 && categories.length === 0
    && lineRows.length === 0 && !scope && !inferred
  const didYouMean = nothingElse
    ? await correctQuery(q)
        .then(async (fixed) => {
          if (!fixed || fold(fixed) === folded) return null
          const words = splitConditionWords(fixed)
          const hit = await db.listing.findFirst({
            where: await scopedListingWhere({ verified: true, status: 'active', AND: textClauses(fold(words.rest)) }),
            select: { id: true },
          })
          return hit ? fixed : null
        })
        .catch((e: unknown) => { console.error('[suggest] did-you-mean failed — no row', e); return null })
    : null

  return NextResponse.json(
    {
      q,
      listings: listings.map((l) => ({
        id: l.id, title: l.title, titleVi: l.titleVi, price: l.price,
        // The display unit (price-unit.ts): Batdongsan/Rever's bare 'VND' reads 'VND/month'.
        currency: l.currency, priceUnit: displayPriceUnit(l.priceUnit, l.sellerId), location: l.location,
        image: typeof l.images[0] === 'string' ? l.images[0] : null, categorySlug: l.category.slug, listingType: l.listingType,
        // A boolean, never the url: <Price> only needs to tell a linked job ("Salary: see details") from
        // an employer's own one at 0 ("Salary: negotiable"), as serialize's isPartnerBooking does.
        linked: Boolean(l.affiliateUrl),
      })),
      categories: categories.map((c) => ({ slug: c.slug, name: c.name, nameVi: c.nameVi })),
      brands: brands.map((b) => ({ slug: b.slug, name: b.name })),
      lines: lineRows,
      scope,
      // ⚠️ ADDITIVE WIRE FIELD (UX program 2): the corrected, folded query, or null.
      didYouMean,
    },
    // Public verified+active data only → safe to let the CDN absorb repeat
    // prefixes (hot terms like "ho"/"xe"), matching the /api/listings policy.
    { headers: { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=30' } },
  )
})
