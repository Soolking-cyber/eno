import 'server-only'
import { db } from './db'
import { Prisma } from '@/generated/prisma/client'
import {
  FEED_DIVERSITY_WINDOW, GOODS_CATEGORY_SLUGS, GOODS_SEAT_ROWS, SHARED_SEAT_SELLERS, SHARED_SEAT_SUBCATEGORIES,
  diversifyBySeller, isSecondHandGoods, mergeRoundRobin, type Diversifiable, type SeatOptions,
} from './feed-diversity'
import { scopedListingWhere } from './edition-scope'

/**
 * THE DEFAULT FEED'S WINDOW, SELECTED SO IT CONTAINS MORE THAN ONE SELLER.
 *
 * ⛔ THE OLD WINDOW WAS "TOP 60 BY rankScore", AND THAT IS WHY THE FRONT PAGE BECAME ONE SHOP.
 * `diversifyBySeller` can only interleave sellers who are already in the window it is handed.
 * Measured on production 2026-09-08 — 10,215 listings, seven sellers — one seller's 152 imported
 * rows carried an identical rankScore of 0.5772, took all 60 slots, and the round-robin returned
 * them untouched because there was nothing to interleave. All 48 cards of the first page were one
 * catalogue.
 *
 * ⛔ AND THE FIX IS NOT A BIGGER NUMBER. `feed-diversity.ts` says so in its own words: "Do not
 * simply raise this to keep up with the catalogue." A larger window buys a little time and fails
 * again at the next import. What is needed is each seller's BEST rows, then a merge.
 *
 * ⚠️ PRISMA, NOT RAW SQL, AND THAT IS A SAFETY DECISION RATHER THAN A STYLE ONE. The file's note
 * proposes `ROW_NUMBER() OVER (PARTITION BY "sellerId" …)` as the ORDER BY, which is the right
 * shape — but expressing it means rebuilding the whole `where` in SQL, and that `where` is what
 * `scopedListingWhere` puts the LICENSING BOUNDARY into. A hand-written SQL predicate that drifts
 * from it puts e-visa listings on a licensed sàn TMĐT. One query per seller costs a few round trips
 * and keeps the caller's `where` intact, byte for byte.
 *
 * ⚠️ IT COMPOSES WITH `AND`, NEVER BY SPREADING. `{ ...where, sellerId }` would overwrite a
 * `sellerId` the scope had already set — the exact trap `feed-query.ts` and the storefront page
 * both carry warnings about. `{ AND: [where, { sellerId }] }` can only ever narrow.
 */

/**
 * ⛔ THE FAN-OUT IS BOUNDED, AND THE FIRST CUT SET IT AT 40 — which is 41 queries on the busiest
 * public endpoint in the app. A reviewer priced it correctly: one anonymous feed read became up to
 * 42 database round trips. Twelve is enough to fill a 60-row window with five rows each and keep
 * the cost inside one digit; sellers past the twelfth are still reachable through natural order
 * below the window.
 */
const MAX_SELLER_FANOUT = 12

/**
 * ⛔ THE WINDOW IS MEMOIZED — A FAST PATH, AND THE COMMENT USED TO CALL IT A GUARANTEE. It is not
 * one, and four reviewers were right to refuse that wording.
 *
 * WHAT IT IS FOR: the diverse path now owns every offset (see the route), and the window depends on
 * neither `offset` nor `limit` — it is a pure function of the predicate. Recomputing it per page
 * made a reader's fifth page pay the groupBy + up-to-12 fan-out + top-up a fifth time, on the app's
 * busiest unauthenticated endpoint. One computation, reused, is the whole point.
 *
 * WHAT IT IS NOT: it is NOT what makes pages agree with each other. That comes from the window
 * being DETERMINISTIC — the database ranks and caps the sellers (see the groupBy below), the merge
 * is pure, and the top-up is ordered — so two computations over the same data give the same head
 * whether or not either was cached. What the memo adds is that a reader's scroll does not have to
 * re-derive it.
 *
 * ⚠️ THE RESIDUAL, STATED PLAINLY: a reader whose later page is built from a DIFFERENT head than
 * their first — because the data moved, the entry expired or was evicted, or a deploy swapped the
 * process — can see a row twice. That is not a new exposure: plain `skip`/`take` over changing data
 * has always repeated and skipped rows the same way, which is why every sort here ends in a unique
 * `id` tiebreaker. Closing it properly needs a cursor or a client-sent seen-set, not a longer TTL.
 *
 * ⚠️ THE IN-FLIGHT PROMISE IS CACHED, NOT JUST THE RESULT. The home page's server render and the
 * client explorer's first fetch land together; caching only on completion lets both miss and both
 * fan out. TTL matches the feed's own `s-maxage=60`, so a memoized head is never staler than the
 * edge copy of the page it feeds.
 *
 * ⚠️ AND IT ADDS TAKEDOWN LATENCY, WHICH IS THE PRICE AND IS WORTH STATING. Head rows are served
 * from memory without re-checking `status`/`verified`, so a listing the seller hid or an admin
 * removed can stay on the first pages for up to a minute BEYOND the edge TTL — roughly doubling the
 * old window. Accepted deliberately: the tail is always live, and anything needing immediate
 * removal goes through the seller's own hide/delete, which the TAIL reflects immediately.
 *
 * ⛔ AND A CLOUDFLARE PURGE DOES NOT CLEAR THIS — an earlier draft of this note said it did, which
 * was simply wrong. The memo is PROCESS-LOCAL: a purge empties the edge, the next origin request
 * refills it from whatever the memo still holds, and only the 60s expiry or a container restart
 * clears it. So the true bound on a takedown is the memo TTL plus the edge TTL, not the edge alone.
 * If a listing must vanish faster than that, restart the container — that is the honest answer.
 *
 * ⚠️ AND A FALLBACK WINDOW IS NEVER CACHED — see `buildWindow`'s `diverse` flag. A transient
 * groupBy or fan-out failure yields the natural top 60, which is a DIFFERENT head; storing it for a
 * minute would make every following page exclude a set the reader never saw. Two reviewers found
 * this independently. A failure now costs one uncached request, not a minute of mismatched pages.
 */
const WINDOW_TTL = 60_000
const WINDOW_CACHE_MAX = 32
/**
 * The cache is shared across projections, so it stores rows opaquely — but the KEY carries `select`
 * (see below), which is what makes the cast back to the caller's payload type sound rather than a
 * hope. Erasing the type outright was worse: it cost `(home)/page.tsx` its concrete card row.
 */
type WindowRow = Record<string, unknown>
/** A built window and whether it may be memoized — see `buildWindow`. */
type WindowBuild = { rows: unknown[]; diverse: boolean }
const windowCache = new Map<string, { at: number; rows: Promise<WindowRow[]> }>()

/**
 * ⛔ THIS FUNCTION RANKS SELLER GROUPS BY `rankScore`, SO IT SERVES ONLY THE SORT THAT ORDERS BY IT.
 * `diversityAppliesTo()` gates the call sites to the default sort today, and this assertion is what
 * keeps that true if anyone widens it: on any other ordering the group ranking would be computed
 * from a field the rows are not sorted by, silently. Falling back to the single-query window is the
 * honest answer — no diversity, but an order that matches what the caller asked for.
 */
function ranksByRankScoreDesc(orderBy: Prisma.ListingOrderByWithRelationInput[]): boolean {
  const first = orderBy[0] as Record<string, unknown> | undefined
  return !!first && first.rankScore === 'desc'
}

/**
 * A projection the goods seats can read: isSecondHandGoods needs the row's type, condition and category slug.
 * Under a narrower `select` every row would read as "not goods" and the seats would silently do nothing,
 * so the type refuses `goodsSeats: true` there — the same reasoning as the `id: true` constraint below.
 * ⚠️ `[S] extends [GoodsReadable]`, NOT `S extends …`: a bare conditional DISTRIBUTES over a union `select`
 * and would accept the seats when only one member can read goods. (An `any` select still passes — nothing
 * a type can do about `any`.)
 */
type GoodsReadable = { listingType: true; condition: true; category: { select: { slug: true } } }

type WindowOptions<S> = SeatOptions & {
  /**
   * Keep teacher profiles in the window — ONLY for a caller whose `where` already made the teacher
   * decision (/c/teachers, the API under `category=teachers`). Omitted, the default exclusion applies
   * exactly as before (home, storefronts): re-applying the scope without it emptied /c/teachers even
   * though the page passed `{ teachers: true }` to its own scopedListingWhere (disc-03 / rentals-01).
   */
  teachers?: boolean
} & ([S] extends [GoodsReadable] ? unknown : { goodsSeats?: false })

/**
 * ⛔ THE PROJECTION MUST CARRY `id`, AND THE TYPE SAYS SO RATHER THAN TRUSTING THE CALLER. The
 * under-filled path builds the top-up's `notIn` out of `row.id`; a caller passing `{ title: true }`
 * would hand Prisma a list of `undefined` and either error or silently exclude nothing. Both real
 * callers pass LISTING_CARD_SELECT, which is exactly what kept this invisible — a reviewer found it
 * in the exported signature, not in the behaviour.
 */
export async function diverseFeedWindow<S extends Prisma.ListingSelect & { id: true }>(
  where: Prisma.ListingWhereInput,
  orderBy: Prisma.ListingOrderByWithRelationInput[],
  select: S,
  opts?: WindowOptions<S>,
): Promise<Prisma.ListingGetPayload<{ select: S }>[]> {
  /**
   * ⛔ THE SCOPE IS RE-APPLIED HERE, NOT ASSUMED FROM THE CALLER — and `edition-lint` is why. Both
   * call sites already pass a `where` built by `scopedListingWhere`, so these reads were in fact
   * safe; the lint could not see that and failed the build, which is the correct outcome for a rule
   * guarding a licensing boundary. An ALLOW entry was the alternative, and a reviewer has already
   * rejected that reasoning once on `catalogue-seller.ts`: an ALLOW key is a FILE PATH, i.e. a
   * permanent promise about code that will change.
   *
   * ⚠️ APPLYING IT TWICE IS A NO-OP. `scopedListingWhere` returns the predicate untouched (services
   * edition) or `{ AND: [predicate, { sellerId: { notIn } }] }`, so a second application nests one
   * more AND with the same exclusion.
   *
   * ⚠️ IT IS ALSO PART OF THE CACHE KEY, WHICH IS THE POINT OF COMPUTING IT BEFORE THE LOOKUP. The
   * two editions differ ONLY by this exclusion, so keying on the caller's raw `where` would let the
   * marketplace serve a window built for the services edition — a licensing breach out of a cache.
   */
  const scoped = await scopedListingWhere(where, opts?.teachers ? { teachers: true } : undefined)
  /**
   * ⚠️ `select` IS PART OF THE KEY, AND LEAVING IT OUT WAS A REAL DEFECT — three reviewers named
   * it. The memo stores ROWS, so a caller asking for a narrower projection would otherwise be
   * served another caller's shape, or worse, poison the entry for the caller that needs the full
   * card. Both call sites pass LISTING_CARD_SELECT today, which is exactly what made it invisible.
   */
  // ⚠️ The seat rules are part of the key: the same predicate with and without shared seats (or the
  // goods seats' candidates) is two different windows, and the SSR head must match the API head for
  // the SAME rules (sharedSeatsFor, goodsSeatsFor).
  const sharedSeats = !!opts?.sharedSeats
  const goodsSeats = !!opts?.goodsSeats
  const key = JSON.stringify([scoped, orderBy, select, sharedSeats, goodsSeats])
  const hit = windowCache.get(key)
  /**
   * ⚠️ EVERY CALLER GETS ITS OWN ARRAY. The memo holds one array that would otherwise be handed by
   * reference to every concurrent request and to the home render — the old route pointedly passed
   * `rows.slice(0, 60)` for exactly this reason. `diversifyBySeller` is pure (readonly in, new array
   * out) so nothing mutates it today; a one-element-per-row copy is cheap enough that the invariant
   * should not depend on that staying true. The ROWS are still shared, and are read-only by
   * contract — `serializeListingCard` and `localizeListingTitles` both build new objects.
   */
  if (hit && Date.now() - hit.at < WINDOW_TTL) {
    // ⚠️ A HIT MOVES THE KEY BUT DOES NOT REFRESH `at`. Re-inserting makes eviction least-recently-
    // USED rather than least-recently-written, so a crawler rotating filter params can no longer
    // evict the root feed's window just by arriving 32 times; keeping `at` means a hit still cannot
    // extend a window's life past its TTL, which is what bounds how stale a served row can be.
    windowCache.delete(key)
    windowCache.set(key, hit)
    return hit.rows.then((r) => r.slice()) as Promise<Prisma.ListingGetPayload<{ select: S }>[]>
  }
  const built: Promise<WindowBuild> = buildWindow(scoped, orderBy, select, sharedSeats)
    .then((w) => (goodsSeats ? withGoodsCandidates(w, scoped, orderBy, select) : w))
  const rows = built.then((r) => r.rows as WindowRow[])
  // Neither a rejection nor a fallback window may stay cached — the next request must be free to
  // try again rather than inherit a head that no other page agrees with.
  built.then((r) => { if (!r.diverse) windowCache.delete(key) }, () => windowCache.delete(key))
  // ⚠️ DELETE BEFORE SET, OR THE HOTTEST ENTRY IS EVICTED FIRST. `Map.set` on an existing key keeps
  // its ORIGINAL insertion slot, so the root feed — inserted first and refreshed every minute —
  // would be the first thing dropped once 32 filtered predicates arrive. Re-inserting makes the
  // eviction order least-recently-REFRESHED, which is what "evict oldest" was meant to say.
  windowCache.delete(key)
  if (windowCache.size >= WINDOW_CACHE_MAX) windowCache.delete(windowCache.keys().next().value!)
  windowCache.set(key, { at: Date.now(), rows })
  return rows as Promise<Prisma.ListingGetPayload<{ select: S }>[]>
}

/**
 * THE DEFAULT FEED'S HEAD — the window, dealt by the seat rules (diversifyBySeller: the seller
 * round-robin, the shared seats and, on the home feed, the goods seats).
 *
 * ⛔ ONE FUNCTION FOR THE HOME PAGE'S SERVER RENDER AND FOR /api/listings. The home page renders the
 * head's first twelve and the explorer fetches page 2 from the API, which cuts it from ITS head; if the
 * two heads were assembled by two copies of "window, then diversify", one copy gaining a rule (the goods
 * seats did) would make page 2 repeat a card the server rendered and skip another. Same function, same
 * rules (HOME_FEED_SEATS there, sharedSeatsFor + goodsSeatsFor here), same head.
 * ⚠️ `diversifyBySeller` STILL RUNS OVER A WINDOW THAT IS ALREADY A ROUND-ROBIN, AND IT IS NOT
 * REDUNDANT: the window decides WHICH rows (each seller's best, merged); this deals whatever came back,
 * which matters on the fallback paths inside it — a groupBy failure, one seller, or a window the fan-out
 * under-filled all return the plain top-N — and it is where the goods seats are reserved.
 */
export async function diverseFeedHead<S extends Prisma.ListingSelect & { id: true }>(
  where: Prisma.ListingWhereInput,
  orderBy: Prisma.ListingOrderByWithRelationInput[],
  select: S,
  opts?: WindowOptions<S>,
): Promise<Prisma.ListingGetPayload<{ select: S }>[]> {
  const win = await diverseFeedWindow(where, orderBy, select, opts)
  // The seat rules read only id / sellerId / subcategorySlug / listingType / category.slug, and a field
  // the projection lacks reads as "no shared seat" / "not goods" — so the cast through the rule's own
  // row type is sound for any `S`; the rows themselves come back untouched, in a new order.
  const seats: SeatOptions = { sharedSeats: !!opts?.sharedSeats, goodsSeats: !!opts?.goodsSeats }
  return diversifyBySeller(win as unknown as Diversifiable[], seats) as unknown as typeof win
}

/** `diverse: false` marks a fallback window — a natural top-60, which must never be memoized. */
async function buildWindow(
  scoped: Prisma.ListingWhereInput,
  orderBy: Prisma.ListingOrderByWithRelationInput[],
  select: Prisma.ListingSelect,
  sharedSeats = false,
) {
  const size = FEED_DIVERSITY_WINDOW
  // edition-lint-allow: every read in this function uses `scoped` — the value the exported
  // wrapper above produced from scopedListingWhere(where) before it computed the cache key.
  // Rule A counts guard MENTIONS against reads; this file deliberately resolves the scope ONCE
  // so that the cache key and every query are provably the same predicate. Extra calls would
  // exist only to satisfy a count, and a second resolution is the thing that could drift.
  const single = async () => ({ rows: await db.listing.findMany({ where: scoped, orderBy, take: size, select }), diverse: false })
  if (!ranksByRankScoreDesc(orderBy)) return single()

  /**
   * SHARED SEATS (feed-diversity.ts, SHARED_SEAT_SUBCATEGORIES and SHARED_SEAT_SELLERS): a shared
   * catalogue's rows never take a SELLER seat — nine carriers, or eighteen job boards, would otherwise
   * take most of the twelve — and each catalogue comes back below as ONE group. ⚠️ `subcategorySlug:
   * null` is named explicitly: SQL `NULL NOT IN ('esim')` is NULL, so a bare `notIn` would silently
   * drop every listing that has no subcategory from the fan-out. (`sellerId` is never null.)
   * With the rule off, `sellerScope` IS `scoped`, `seatDefs` is empty, and every query below is
   * exactly what it was.
   */
  const sharedSellerIds = Object.values(SHARED_SEAT_SELLERS).flat()
  const sellerScope: Prisma.ListingWhereInput = sharedSeats
    ? { AND: [scoped, { OR: [{ subcategorySlug: null }, { subcategorySlug: { notIn: [...SHARED_SEAT_SUBCATEGORIES] } }] }, { sellerId: { notIn: sharedSellerIds } }] }
    : scoped
  /**
   * One definition per shared seat: the eSIM aisle, then each seller set. `freeFirst` is the eSIM
   * seat's inner order (seatOrder: the free tourist plan leads, owner 2026-09-27); on a job a price of
   * 0 means "Salary: see details", not free, so the boards take plain turns.
   */
  const seatDefs: { where: Prisma.ListingWhereInput; freeFirst: boolean }[] = sharedSeats
    ? [
        { where: { subcategorySlug: { in: [...SHARED_SEAT_SUBCATEGORIES] } }, freeFirst: true },
        ...Object.values(SHARED_SEAT_SELLERS).map((ids) => ({ where: { sellerId: { in: [...ids] } }, freeFirst: false })),
      ]
    : []

  /**
   * ⛔ THE DATABASE PICKS AND ORDERS THE SELLERS — the first cut asked for every seller unordered
   * and then took `slice(0, 12)` of whatever Postgres happened to return. Two defects in one line,
   * both found by all four reviewers. (1) `groupBy` carries NO ordering guarantee, so with a
   * thirteenth seller the site's top-ranked listing could be dropped from the window entirely
   * because its seller landed thirteenth, and the SSR render and the API call could select
   * DIFFERENT twelve — a head that differs between the two is the hydration reshuffle this window
   * exists to prevent. (2) The groups were then re-sorted in JS by `row[0].rankScore`, a field
   * `LISTING_CARD_SELECT` does not select: measured, it is `undefined` on every row, so `?? 0` made
   * every group tie and the entire ordering silently collapsed to ascending `id`.
   *
   * `_max: { rankScore: true }` answers both. The aggregate is computed where the data is, so the
   * twelve sellers kept are the twelve whose BEST listing ranks highest — which is the intended
   * selection, not merely a deterministic one — and no JS comparator reads a field that is not on
   * the row. `sellerId` breaks ties so the order is total.
   */
  // edition-lint-allow: `scoped`, as above — this aggregate reads the same predicate.
  const sellers = await db.listing.groupBy({
    by: ['sellerId'],
    where: sellerScope,
    _max: { rankScore: true },
    orderBy: [{ _max: { rankScore: 'desc' } }, { sellerId: 'desc' }],
    take: MAX_SELLER_FANOUT,
  }).catch((e: unknown) => {
    // ⚠️ LOUD, BECAUSE THIS CATCH HIDES PERMANENT FAILURES AS READILY AS TRANSIENT ONES. A Prisma
    // validation error on the `_max` ordering would send every request down `single()` for ever —
    // the seller monopoly back, with no signal anywhere. Falling back is right; doing it silently
    // is what made the original bug survive a month.
    console.error('[feed-window] seller groupBy failed — serving the undiversified window', e)
    return null
  })
  // A groupBy failure must not take the home page down — fall back to the behaviour that shipped.
  if (!sellers) return single()

  // Each shared seat, when the rule is on: its best rank (to place it among the sellers) and its rows.
  // edition-lint-allow: `scoped` AND-ed with the seat's own clause — narrowing only.
  const seatBests = await Promise.all(seatDefs.map((def) =>
    db.listing.aggregate({ where: { AND: [scoped, def.where] }, _max: { rankScore: true } })
      .then((a) => a._max.rankScore, (e: unknown) => {
        console.error('[feed-window] catalogue aggregate failed — serving the undiversified window', e)
        return undefined
      })))
  // `undefined` = the read FAILED (fall back, like a failed fan-out); `null` = no rows in that seat.
  if (seatBests.some((b) => b === undefined)) return single()
  const liveSeats = seatDefs.flatMap((def, i) => (seatBests[i] != null ? [{ ...def, best: seatBests[i] as number }] : []))
  const seats = sellers.length + liveSeats.length
  if (seats < 2) return single()

  const perSeller = Math.max(1, Math.ceil(size / seats) + 2)
  /**
   * ⚠️ A PARTIAL FAN-OUT IS NOT A WINDOW. `Promise.all` rejects on the first failure, and a
   * per-query `.catch(() => [])` would be worse than the rejection: it would silently drop a seller
   * and hand back a head that no other request agrees with, which is exactly the exclusion-set
   * mismatch above. All twelve or none — and "none" means the single-query window, not an error.
   */
  // edition-lint-allow: `scoped` AND-ed with one sellerId — narrowing only, never widening.
  const candidates = await Promise.all([
    ...sellers.map((s) =>
      db.listing.findMany({ where: { AND: [sellerScope, { sellerId: s.sellerId }] }, orderBy, take: perSeller, select })),
    ...liveSeats.map((seat) => catalogueGroup({ AND: [scoped, seat.where] }, orderBy, select, perSeller, seat.freeFirst)),
  ]).catch((e: unknown) => {
    console.error('[feed-window] seller fan-out failed — serving the undiversified window', e)
    return null
  })
  if (!candidates) return single()

  // Groups keep the order the database ranked their sellers in — see the groupBy note above. Each
  // shared seat is placed by its best row among them: a STABLE sort by best rank, sellers first on a
  // tie, seats in definition order — so a seat leads exactly when its best listing would have led, and
  // with one seat this is the splice it replaced (before the first seller whose best ranks BELOW it).
  const ordered = liveSeats.length
    ? [
        ...sellers.map((s, i) => ({ best: s._max.rankScore ?? -Infinity, rows: candidates[i] })),
        ...liveSeats.map((seat, i) => ({ best: seat.best, rows: candidates[sellers.length + i] })),
      ].sort((a, b) => (a.best === b.best ? 0 : b.best > a.best ? 1 : -1)).map((g) => g.rows)
    : candidates
  const groups = ordered.filter((g) => g.length > 0)
  const merged = mergeRoundRobin(groups)
  /**
   * ⛔ AN UNDER-FILLED WINDOW IS TOPPED UP, NOT ABANDONED. The first cut fell back to `single()`
   * whenever the fan-out returned fewer than `size` rows — which, with one deep seller and eight
   * shallow ones, meant returning sixty consecutive rows from the deep seller and reinstating the
   * exact monopoly this function exists to remove. Three reviewers found it. Topping up from
   * natural order keeps the diverse head and fills the tail with what would have been there anyway.
   */
  /**
   * ⛔ `groups.length >= 2`, NOT `true` — this return said `true` unconditionally while its sibling
   * below tested the groups, and a reviewer caught the asymmetry. If the groupBy names several
   * sellers but only one of them actually yields rows, `merged` is sixty rows of ONE catalogue: the
   * monopoly this function exists to break, flagged as diverse and then memoized for a minute.
   * A window earns the flag by containing more than one seller, on both paths.
   */
  if (merged.length >= size) return { rows: merged.slice(0, size), diverse: groups.length >= 2 }
  const have = new Set(merged.map((r) => (r as { id: string }).id))
  // edition-lint-allow: `scoped` again — the top-up shares the one scopedListingWhere computed by
  // the caller above, and additionally excludes ids already merged. Same constraint as the groupBy
  // above: the scope is computed once for every read in this file.
  const top = await db.listing.findMany({
    where: { AND: [scoped, { id: { notIn: [...have] } }] },
    orderBy, take: size - merged.length, select,
  })
  /**
   * ⛔ `diverse` IS NOT UNCONDITIONALLY TRUE HERE. If every fan-out came back empty, `merged` is
   * empty and this window is 60 rows of pure natural order — a fallback wearing the diverse flag,
   * which would then be memoized for a minute and make the following pages exclude a head no
   * reader ever saw. That is the 23-repeat regression, reintroduced by the cache meant to prevent
   * it. A window is diverse only if the round-robin actually contributed more than one seller.
   */
  return { rows: [...merged, ...top], diverse: groups.length >= 2 }
}

/** The goods seats' rows as a predicate — feed-diversity.ts isSecondHandGoods: used, for sale, in a category of things. */
const GOODS_WHERE: Prisma.ListingWhereInput = { listingType: 'sell', condition: 'used', category: { slug: { in: [...GOODS_CATEGORY_SLUGS] } } }

type SeatFields = Diversifiable & { sellerId: string }

/**
 * THE GOODS SEATS' CANDIDATES (feed-diversity.ts GOODS_SEATS, home feed only). reserveGoodsSeats can only
 * move goods rows the window holds, and the window is the twelve best-ranked SELLERS — on a day the rental
 * importers, the job employers and the shared catalogues hold the top of the ranking it can hold no
 * second-hand goods at all, and the seats would stay empty while thousands of goods rows wait below it.
 *
 * So a window offering goods from fewer than GOODS_SEAT_ROWS sellers gets the best goods row of each
 * best-ranked goods seller it lacks — ONE per seller, so four seats can be four shops (the round-robin's
 * own rule; a tie-clustered top-N would hand all four to one importer) — and, while that still makes fewer
 * than GOODS_SEAT_ROWS goods rows (a catalogue with one or two goods sellers), the next goods rows in rank
 * order. ⚠️ APPENDED, NEVER SPLICED: the window's own rows keep their order; diversifyBySeller deals the
 * newcomers into their sellers' turns and the reservation lifts only what a seat needs. The head can
 * therefore run a few rows past FEED_DIVERSITY_WINDOW — feedPagePlan takes any head length, and the API's
 * tail excludes every head row, so nothing is served twice.
 * ⚠️ USUALLY NO QUERY AT ALL: measured read-only 2026-10-05, seven of the window's twelve sellers sell goods,
 * so this returns before reading anything. Otherwise a groupBy and at most five reads — once per memoized
 * window, never per page — all narrowing the one `scoped` predicate.
 * ⚠️ A FAILED READ IS NOT A SMALLER WINDOW TO KEEP: it marks the window `diverse: false`, which the memo
 * refuses, exactly like a failed fan-out — the next request builds the real one.
 */
async function withGoodsCandidates(
  base: WindowBuild,
  scoped: Prisma.ListingWhereInput,
  orderBy: Prisma.ListingOrderByWithRelationInput[],
  select: Prisma.ListingSelect,
): Promise<WindowBuild> {
  const rows = base.rows as SeatFields[]
  // A window short of FEED_DIVERSITY_WINDOW is the whole catalogue — the top-up (or the single query)
  // ran dry — so every goods row is already in it and there is nothing to fetch.
  if (rows.length < FEED_DIVERSITY_WINDOW) return base
  const inWindow = rows.filter(isSecondHandGoods)
  const sellers = new Set(inWindow.map((r) => r.sellerId))
  if (sellers.size >= GOODS_SEAT_ROWS) return base
  const goodsScope: Prisma.ListingWhereInput = { AND: [scoped, GOODS_WHERE] }
  try {
    // edition-lint-allow: `scoped` AND-ed with the goods clause — narrowing only, like the seats above.
    const top = await db.listing.groupBy({
      by: ['sellerId'],
      where: goodsScope,
      _max: { rankScore: true },
      orderBy: [{ _max: { rankScore: 'desc' } }, { sellerId: 'desc' }],
      take: GOODS_SEAT_ROWS + sellers.size,
    })
    const lacking = top.map((g) => g.sellerId).filter((s) => !sellers.has(s)).slice(0, GOODS_SEAT_ROWS - sellers.size)
    // ⚠️ `notIn` the window even here, where no row SHOULD match it: a listing re-typed to goods between the
    // window's read and this one (it was in the window as a rental) would otherwise be appended a second
    // time — one card twice, memoized for a minute or baked into the 6h ISR home (review, 2026-10-05).
    const windowIds = rows.map((r) => r.id)
    const firsts = (await Promise.all(lacking.map((sellerId) =>
      // edition-lint-allow: the goods scope AND-ed with one sellerId — narrowing only.
      db.listing.findMany({ where: { AND: [goodsScope, { sellerId }, { id: { notIn: windowIds } }] }, orderBy, take: 1, select })))).flat() as unknown[]
    const short = GOODS_SEAT_ROWS - inWindow.length - firsts.length
    if (short <= 0) return { rows: [...base.rows, ...firsts], diverse: base.diverse }
    const held = [...windowIds, ...(firsts as SeatFields[]).map((r) => r.id)]
    // edition-lint-allow: the goods scope minus the rows already held — narrowing only.
    const more = await db.listing.findMany({ where: { AND: [goodsScope, { id: { notIn: held } }] }, orderBy, take: short, select })
    return { rows: [...base.rows, ...firsts, ...more], diverse: base.diverse }
  } catch (e) {
    console.error('[feed-window] goods-seat candidates failed — serving the window without them, unmemoized', e)
    return { rows: base.rows, diverse: false }
  }
}

/**
 * The shared seat's rows: the catalogue's best, INTERLEAVED BY SELLER inside the seat, so the seat's
 * first card is one carrier's best, its second another carrier's, and so on — not seven plans from
 * whichever carrier's ids sort first when their scores tie (nine carriers imported together all score
 * the same). Fetches the catalogue (up to CATALOGUE_FETCH), interleaves it, keeps one seat's worth.
 * Deterministic: same rows in, same order out, on the SSR render and the API call.
 */
/** Upper bound on the rows ONE shared seat interleaves (the eSIM catalogue is 63 today). */
const CATALOGUE_FETCH = 240

async function catalogueGroup(
  where: Prisma.ListingWhereInput,
  orderBy: Prisma.ListingOrderByWithRelationInput[],
  select: Prisma.ListingSelect,
  take: number,
  freeFirst = true,
) {
  // edition-lint-allow: `where` is `scoped` AND-ed with one shared seat's clause (buildWindow).
  // ⛔ NOT `take * 4`. Rows imported together tie on rankScore and then sort by id, i.e. in CLUSTERS
  // of one seller: with 9 carriers x 7 plans, the first 28 rows were the four most recently imported
  // carriers, and the other five could never reach the window (a reviewer's catch). The whole
  // catalogue slice is fetched — bounded, card-sized rows, once per memoized window — so every seller
  // gets its turn inside the seat.
  const rows = await db.listing.findMany({ where, orderBy, take: CATALOGUE_FETCH, select })
  return seatOrder(rows, { freeFirst }).slice(0, take)
}

/**
 * The order INSIDE the shared seat: still one turn per seller, but a seller with a FREE plan takes its
 * turn first and leads with that plan. ⛔ Owner, 2026-09-27: "remove sim fpt from homepage and show
 * mobifone free 10gb instead" — the seat is the feed's first card whenever the catalogue holds the top
 * rankScore, and nine carriers imported together tie on it, so card one went to whichever carrier's ids
 * sorted first (SIM FPT). A free tourist eSIM is the most useful first card for this audience. Free rows
 * stay inside the round-robin, so several free plans from one carrier cannot take the seat's first
 * turns. Only the seat's INNER order changes: its place in the feed and every rankScore are untouched.
 * `price` is a Float in the card select, so `=== 0` holds. Pure, so SSR and API agree.
 */
export function seatOrder<R extends { id: string; sellerId?: string | null; price?: number | null }>(
  rows: readonly R[],
  { freeFirst = true }: { freeFirst?: boolean } = {},
): R[] {
  const isFree = (r: R) => freeFirst && r.price === 0
  const bySeller = new Map<string, R[]>()
  for (const r of rows) {
    const k = r.sellerId ?? r.id
    const b = bySeller.get(k)
    if (b) b.push(r)
    else bySeller.set(k, [r])
  }
  // Stable sorts: rank order survives among the free and among the rest.
  const groups = [...bySeller.values()].map((g) => [...g.filter(isFree), ...g.filter((r) => !isFree(r))])
  const withFree = groups.filter((g) => isFree(g[0]))
  return mergeRoundRobin([...withFree, ...groups.filter((g) => !isFree(g[0]))])
}

/**
 * ⛔ THE PAGE ARITHMETIC, EXTRACTED SO IT CAN BE TESTED — because two of the three measured defects
 * in this whole change lived here, in route code no test could reach.
 *
 * ⛔ DEFECT ONE: the offset was counted TWICE. The first cut fetched the tail at `skip: offset - 60`
 * and then indexed `[...head, ...tail].slice(offset, …)`, which serves rows 120-179 where 60-119
 * belong. Measured before and after that attempt: 240 rows holding 217 distinct listings, 23
 * repeats, unchanged. The head and the tail are TWO INDEX SPACES and only one may carry the offset.
 *
 * ⛔ DEFECT TWO: pages past the window took a plain `findMany` with no exclusion, re-serving the
 * rows the window had pulled UP from below rank 60 — the same 23 repeats, this time between page 1
 * and pages 3-4 while page 2 stayed clean, which is precisely how it hid.
 *
 * The contract: `fromHead` is a half-open range into the ALREADY-REORDERED head, `tailSkip` is
 * measured from the END of the head (the head's rows are excluded from that query, so the two
 * spaces line up), and `tailTake` is whatever the head could not supply.
 */
export function feedPagePlan(headLength: number, offset: number, limit: number) {
  if (offset >= headLength) {
    return { fromHead: null, tailSkip: offset - headLength, tailTake: limit }
  }
  const end = Math.min(offset + limit, headLength)
  const fromHead = { start: offset, end }
  const taken = end - offset
  // Straddles the boundary: the remainder is the very START of the tail, never `offset` into it.
  return { fromHead, tailSkip: 0, tailTake: limit - taken }
}

/** Testing seam: the window is memoized for a minute, which a test must be able to reset. */
export function __resetFeedWindowCache() {
  windowCache.clear()
}
