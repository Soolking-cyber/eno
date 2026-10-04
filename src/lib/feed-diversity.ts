import { JOB_SELLER_IDS } from './job-listing'
import { hammingHex, hashFromUrl } from './image-hash-url'

/**
 * SELLER DIVERSITY FOR THE DEFAULT BROWSE FEED — so the first screen of a marketplace looks like a
 * marketplace and not like one seller's catalogue.
 *
 * ⚠️ THE PROBLEM, MEASURED ON PRODUCTION 2026-08-13, NOT INFERRED. eno.vn had 35 active listings.
 * Fourteen were one partner's e-visa SKUs — the same product in Single/Multiple × 1 Hour /
 * 2 Hours / 1 Day / 2 Days / 3 Days variants — and they occupied positions 0 THROUGH 13 of the
 * feed. Every card in the first viewport, and the second, was the same product from the same
 * seller, while twenty-one genuinely different listings (a MacBook, an apartment, headphones, a
 * backpack) sat below the fold. An outside audit read the home page as "a partner storefront
 * rather than a broad expat marketplace", which is exactly what a first-time visitor sees.
 *
 * The listings are legitimate and stay: VietKite is a licensed partner and those are real products.
 * What was wrong is the ORDER. `rankScore` is a per-listing quality score with no notion of who is
 * selling, so a seller with fourteen strong listings takes fourteen strong slots.
 *
 * ⚠️ IT IS A ROUND-ROBIN, NOT A CAP, SO NOTHING IS DROPPED OR HIDDEN. Every listing keeps its place
 * in the feed and the total is unchanged — which matters structurally, because the home page's
 * `total` seeds the infinite feed's terminator and a count that disagrees with the rows either
 * stops pagination early or never ends it. Sellers are interleaved: every seller's best listing
 * first (in rankScore order), then every seller's second, and so on. With one seller holding 14 of
 * 35 listings, that seller takes slot 1 of the first round instead of the first fourteen slots.
 *
 * ⚠️ RANK ORDER SURVIVES WITHIN EACH ROUND. This is not shuffling and it is not fairness for its own
 * sake: inside a round the listings are still ordered by the score they earned, so a strong listing
 * from a strong seller still leads the page. Only the RUN is broken up.
 */

/**
 * How many rows the reorder is applied to.
 *
 * ⚠️ A WINDOW, NOT THE WHOLE TABLE, AND THE REASON IS PAGINATION COHERENCE RATHER THAN COST. The
 * feed paginates with `skip`/`take`, so a reorder is only safe if every page slices the SAME
 * ordered sequence. Fetching a fixed window, reordering it once and slicing that gives exactly
 * that guarantee for the pages inside the window; past it, the natural rankScore order continues
 * untouched. 60 is five pages of 12 — far more than a visitor reaches before the problem this
 * solves has stopped mattering.
 *
 * ⚠️ THIS IS THE SCALE LIMIT AND IT IS DELIBERATE. At 35 listings the window is the whole
 * catalogue. As inventory grows, diversity past row 60 stops being enforced — which is fine, since
 * a monopolised first screen is the failure mode, not a monopolised page six. If that ever needs to
 * hold globally, the honest fix is a SQL window function
 * (`ROW_NUMBER() OVER (PARTITION BY "sellerId" ORDER BY "rankScore" DESC)`) as the ORDER BY, not a
 * larger number here. Do not simply raise this to keep up with the catalogue.
 */
export const FEED_DIVERSITY_WINDOW = 60

/**
 * The shape this needs. Anything with an id and a seller works — callers pass listing rows.
 * `listingType`, `condition` and `category.slug` are read only by the goods seats (isSecondHandGoods); a
 * row without them is simply never goods.
 */
export type Diversifiable = {
  id: string
  sellerId?: string | null
  subcategorySlug?: string | null
  listingType?: string | null
  condition?: string | null
  category?: { slug?: string | null } | null
}

/**
 * SUBCATEGORIES THAT SHARE ONE SEAT IN THE DEFAULT FEED, however many storefronts sell in them.
 *
 * ⛔ THE ROUND-ROBIN'S UNIT IS THE SELLER, AND A CATALOGUE SPLIT ACROSS SELLERS DEFEATS IT. Measured on
 * production 2026-09-25, the day nine mobile carriers were imported as nine partner storefronts
 * (scripts/import-esim.ts): the window's fan-out takes the twelve best-ranked SELLERS, the nine
 * carriers were the nine freshest, and eSIM plans filled 18 of the first 24 home cards and roughly
 * three-quarters of the first 60 — the same "one catalogue owns the front page" failure this module
 * exists to prevent, arriving through nine doors instead of one. Owner: "one shared seat".
 * So in the default feed every row of these subcategories is ONE seat, positioned by its best row;
 * the carriers still interleave INSIDE that seat. Inside the aisle itself (the feed filtered to the
 * subcategory) the option is off and every carrier is its own seat again — see `sharedSeatsFor`.
 * ⚠️ Not a rank change: rankScore is untouched (it must stay the published formula's output); this
 * decides only the ORDER of a window, exactly as the seller round-robin does.
 */
export const SHARED_SEAT_SUBCATEGORIES: readonly string[] = ['esim']

/**
 * The vehicle import's storefronts (vehicle-rental-listing.ts VEHICLE_SELLERS, pinned by id there).
 * ⚠️ A LITERAL COPY, ON PURPOSE: importing that module would load the importer's pure half — through
 * honeycomb-listing.ts, the administrative-unit table (vn-units.json) and the import translation
 * segments, ~400 KB of JSON and code — into every feed route that reads the seats (the home page,
 * /api/listings, the category pages). feed-diversity.test.ts holds this list equal to VEHICLE_SELLERS,
 * so a storefront the importer adds fails the suite until it is added here.
 */
const VEHICLE_IMPORT_SELLER_IDS: readonly string[] = [
  'vehicle-import-seller-mioto',
  'vehicle-import-seller-bonboncar',
  'vehicle-import-seller-janmotorbike',
  'vehicle-import-seller-theextramile',
  'vehicle-import-seller-dungmotorbikes',
  'vehicle-import-seller-tuanmotorbike',
  'vehicle-import-seller-rentabikevn',
]

/**
 * SELLER SETS THAT SHARE ONE SEAT IN THE DEFAULT FEED — the same failure as the carriers, through a
 * different catalogue. Measured on eno.vn at 390px, 2026-09-29: 7 of the first 12 home cards were
 * linked jobs, from seven different boards, because scripts/import-jobs.ts creates one ownerless
 * storefront per board (job-listing.ts JOB_BOARDS, 18 of them) and fresh boards take the fan-out's
 * seller seats one each. memory eno-esim-carriers anticipated it: any importer that creates many
 * storefronts at once needs a shared seat.
 * ⚠️ KEYED BY SELLER, NOT BY SUBCATEGORY: 'teaching' and 'job-other' also hold members' own job
 * posts, and a member's post keeps its own seat like any other listing.
 * 'vehicle-rentals' is the same failure a third time (UX program 2, home-01): the vehicle import
 * (scripts/import-vehicle-rentals.ts) made seven storefronts at once — Mioto, BonbonCar and five
 * motorbike shops, 6,388 rows at the 2026-09-29 refresh — and they took the fan-out's seats one each:
 * the audit counted 6 vehicle rentals from 6 storefronts in the first 12 'Đề xuất' cards and 0 used
 * goods, so a visitor from Chợ Tốt saw car hire where the used goods should be. Keyed by the import's
 * own seller ids, so a member's own car or motorbike for rent in the same aisles keeps its own seat.
 */
export const SHARED_SEAT_SELLERS: Readonly<Record<string, readonly string[]>> = {
  'job-boards': JOB_SELLER_IDS,
  'vehicle-rentals': VEHICLE_IMPORT_SELLER_IDS,
}

/** sellerId → its shared seat's key, for seatKey's hot loop. */
const SELLER_SEAT = new Map<string, string>(
  Object.entries(SHARED_SEAT_SELLERS).flatMap(([k, ids]) => ids.map((id) => [id, `__catalogue__${k}`] as const)),
)

/**
 * Options for the seat rules. Off unless a caller asks — every pre-existing caller is unchanged.
 * `goodsSeats` is the home feed's goods minimum (GOODS_SEATS below) — only ever on for the unfiltered
 * default feed (HOME_FEED_SEATS, goodsSeatsFor).
 */
export type SeatOptions = { sharedSeats?: boolean; goodsSeats?: boolean }

/**
 * Whether a feed filtered to `subcategory` (and `category`) should collapse the shared seats: only
 * when NO subcategory is chosen, and not inside Jobs. Inside a shared aisle every row is the catalogue
 * and the useful variety is between its sellers — the carriers inside eSIM, the boards inside Jobs;
 * inside any other subcategory there are no catalogue rows, so the rule could only cost a query. One
 * function so the API route and the home page cannot disagree about it.
 * ⚠️ WHAT IT DOES NOT DO: past FEED_DIVERSITY_WINDOW the feed is plain rank order (the module's
 * documented limit), so a tied catalogue's rows beyond its window share arrive together there — on
 * 2026-09-25, rows ~60-115 of the home feed — until their recency component decays. The first screen
 * is the failure this prevents; "a monopolised page six" is the accepted cost, as above.
 */
export function sharedSeatsFor(subcategory: string | null | undefined, category?: string | null): boolean {
  return !subcategory && category !== 'jobs'
}

/** The seat a row competes for: its seller's, or its catalogue's when the shared-seat rule is on. */
export function seatKey(row: Diversifiable, opts?: SeatOptions): string {
  if (opts?.sharedSeats && row.subcategorySlug && SHARED_SEAT_SUBCATEGORIES.includes(row.subcategorySlug)) {
    return `__catalogue__${row.subcategorySlug}`
  }
  if (opts?.sharedSeats && row.sellerId) {
    const shared = SELLER_SEAT.get(row.sellerId)
    if (shared) return shared
  }
  // `?? row.id` gives an unattributed row its own bucket; see diversifyBySeller.
  return row.sellerId ?? `__no-seller__${row.id}`
}

/**
 * Interleave by seller, preserving relative rank inside each round.
 *
 * ⚠️ PURE AND DETERMINISTIC, WHICH IS A CORRECTNESS REQUIREMENT AND NOT A STYLE PREFERENCE. The
 * home page server-renders the first 12 cards and the client explorer then fetches the same feed
 * from /api/listings; `(home)/page.tsx` documents that the two must agree EXACTLY or the feed
 * reshuffles under the reader on hydration. Same input, same output, both sides — so both call this
 * one function over the same window rather than each sorting for itself.
 *
 * Rows without a sellerId are treated as their own singleton seller: they can never be the cause of
 * a run, so grouping them together would be the one case where this reorder INVENTS a monopoly.
 *
 * With `goodsSeats` (the home page's unfiltered default feed only), the dealt order then reserves the
 * goods seats — reserveGoodsSeats, below. It runs HERE, inside the one function both the home render
 * and /api/listings call over the same window, so the SSR head and the API's head cannot disagree
 * about where a goods card sits.
 */
export function diversifyBySeller<T extends Diversifiable>(rows: readonly T[], opts?: SeatOptions): T[] {
  const dealt = dealBySeat(rows, opts)
  return opts?.goodsSeats ? reserveGoodsSeats(dealt) : dealt
}

/** The seller round-robin itself — diversifyBySeller without the goods seats. */
function dealBySeat<T extends Diversifiable>(rows: readonly T[], opts?: SeatOptions): T[] {
  if (rows.length < 3) return [...rows]

  // Preserve arrival order within each seller — the caller has already sorted by rankScore.
  // ⚠️ With `sharedSeats`, a catalogue's rows share ONE bucket and keep their arrival order inside
  // it — which, from diverseFeedWindow, is already interleaved by carrier (see catalogueGroup).
  const bySeller = new Map<string, T[]>()
  for (const row of rows) {
    const key = seatKey(row, opts)
    const bucket = bySeller.get(key)
    if (bucket) bucket.push(row)
    else bySeller.set(key, [row])
  }

  // One seller (or none) cannot be un-diversified; return the input untouched rather than paying
  // for a rebuild that cannot change anything.
  if (bySeller.size < 2) return [...rows]

  // ⚠️ THE BUCKETS ARE ALREADY IN RANK ORDER — Map preserves insertion order, and insertion order
  // is the order the rows arrived, i.e. rankScore desc. So round 1 emits sellers in the order their
  // BEST listing ranked, which is what keeps this from flattening the feed into arbitrary fairness.
  const buckets = [...bySeller.values()]
  const out: T[] = []
  for (let round = 0; out.length < rows.length; round++) {
    for (const bucket of buckets) {
      if (round < bucket.length) out.push(bucket[round])
    }
  }
  return out
}

/**
 * Whether the seller round-robin applies to a given sort.
 *
 * ⛔ ONLY THE DEFAULT BLEND. Diversity is a MERCHANDISING rule: it decides what a visitor who has
 * expressed no preference should meet first. The moment a reader picks "Cheapest first" they HAVE
 * expressed one, and interleaving by seller silently overrules it — which is the same argument the
 * route already makes for semantic results ("their order IS the relevance answer").
 *
 * ⚠️ THIS WAS A REAL, VISIBLE BUG, MEASURED ON PRODUCTION 2026-08-24, NOT A THEORETICAL ONE. With
 * two sellers in the catalogue — a visa desk and a ticket partner — `sort=price-low` returned
 * 0, 30k, 790k, 50k, 1.24M, 60k, 1.32M, 100k: two individually-ascending lists zipped together.
 * Every row was sorted and the feed was not, so the cheapest listing on screen sat in row 2 and
 * the second-cheapest in row 4. The reader reads that as "the sort is broken", and they are right.
 *
 * The default keeps the round-robin: that feed's whole job is to look like a marketplace.
 */
export function diversityAppliesTo(sort: string): boolean {
  return sort === DEFAULT_FEED_SORT
}

/**
 * The sort key that means "no preference" — the balanced relevance blend the browse feed opens on.
 * Named rather than inlined because three files have to agree on it: this module, the API route,
 * and the home page's server render.
 * ⚠️ It is the legacy string 'newest' and does NOT mean "most recent" — that is 'recent'.
 */
export const DEFAULT_FEED_SORT = 'newest'

/**
 * ── THE HOME FEED'S GOODS SEATS (UX program 2, plan C7; owner 2026-10-05: "apply best recommended") ──
 *
 * On the home page's DEFAULT feed — / and /vi, "Đề xuất / For you", default order, no category, no
 * filter, no words — at least two of the first four cards and four of the first twelve are second-hand
 * goods for sale, whenever the feed holds that many (GOODS_SEATS).
 *
 * ⚠️ WHY, MEASURED READ-ONLY ON PRODUCTION 2026-10-05: about three live listings in four are rentals
 * (23,314 rentals against 7,885 goods for sale), and every seat the round-robin deals first belongs to a
 * rental importer or a shared catalogue — Batdongsan, the job boards' seat, the vehicle shops' seat, the
 * eSIM seat, Nhatot, Muaban, Rever, Honeycomb — so the first goods card was the ninth: 0 of the first
 * four. The home page takes 62% of organic arrivals, and a visitor from Chợ Tốt or Facebook Marketplace
 * read it as a rentals board.
 *
 * ⛔ SEATS ONLY. rankScore and its weights are untouched (the owner's formula, 2026-07-05, published at
 * /legal/ranking): this decides only WHERE in the head a goods row the window already holds is dealt —
 * the same kind of decision as the seller round-robin and the shared seats. Nothing is dropped or hidden.
 * ⛔ THE HOME DEFAULT ONLY. A category, a subcategory, a filter, a search or another sort is a preference
 * the reader expressed, and a reservation would overrule it (diversityAppliesTo's argument). The home
 * render passes HOME_FEED_SEATS; /api/listings asks goodsSeatsFor whether it is serving that same feed.
 */

/**
 * THE CATEGORIES OF THINGS — what "second-hand goods" means to the seats. A row is goods when it is USED
 * (`condition: 'used'`) and FOR SALE (`listingType: 'sell'`, the goods browse's own scope — feed-query.ts
 * `saleScopeFromWords`) in one of these.
 * ⚠️ AN ALLOW-LIST, NOT "every category that takes `sell`". property (real estate), tickets-travel
 * (VinWonders' tickets are `sell` rows — new-retail-retire.ts protects them for the same reason),
 * food-drink (consumables) and pets (animals) take `sell` and are not second-hand goods; rentals, jobs,
 * teachers and services never take it. feed-diversity.test.ts classifies every TAXONOMY category that
 * takes `sell`, so a new one fails the suite until somebody puts it on one side or the other.
 * ⛔ `condition: 'used'` IS WHAT MAKES THE PUBLISHED SENTENCE TRUE. /legal/ranking and /regulations Article 14
 * promise "second-hand goods" / "đồ đã qua sử dụng" in these seats, and only the stored condition says so: the
 * commit gate (codex + opus, 2026-10-05) refuted the first version, which counted any `sell` row here, because
 * one new-stock shop or a new car would have taken a seat the regulations call second-hand. A like-new item
 * (the wizard stores "Mới / Như mới" as `new`) still ranks exactly where it ranked — it just cannot claim a
 * reserved seat. Measured read-only 2026-10-05: 7,763 of the 7,885 live goods rows are `used` (55 `new`, 67
 * unset), and every top-ranked goods shop is entirely `used`, so the seats always fill. (Search is a different
 * call: feed-query.ts deliberately does NOT filter "đồ cũ" by condition — recall there, a promise here.)
 */
export const GOODS_CATEGORY_SLUGS: readonly string[] = [
  'electronics', 'furniture-appliances', 'fashion-beauty', 'baby-kids', 'moving-sale',
  'books-stationery', 'hobbies-sports', 'sports', 'vehicles',
]

/** A second-hand goods row, for the seats: used, for sale, in a category of things. */
export function isSecondHandGoods(row: Pick<Diversifiable, 'listingType' | 'condition' | 'category'>): boolean {
  const slug = row.category?.slug
  return row.listingType === 'sell' && row.condition === 'used' && !!slug && GOODS_CATEGORY_SLUGS.includes(slug)
}

/**
 * The minimums, as prefixes of the head: at least `min` goods cards within the first `within`.
 * ⚠️ /legal/ranking states them in words — "at least two of the first four and four of the first twelve" —
 * and legal-copy.test.tsx holds the words to these numbers. ⚖️ /regulations Article 14 must state them too
 * (Quy chế v3, same commit); change the numbers and both texts follow.
 */
export const GOODS_SEATS: readonly { readonly within: number; readonly min: number }[] = [
  { within: 4, min: 2 },
  { within: 12, min: 4 },
]

/** How many goods rows the window must offer for every seat to be fillable: the largest minimum. */
export const GOODS_SEAT_ROWS = Math.max(...GOODS_SEATS.map((s) => s.min))

/**
 * How many of the first `k` cards must be goods — the LATEST-DEADLINE count: a minimum claims a seat only
 * once the slots left before its deadline equal the goods it is still owed (`min - (within - k)`). Goods
 * the feed already deals early count where they fall, and nothing moves that does not have to.
 */
function goodsDueBy(k: number): number {
  let due = 0
  for (const { within, min } of GOODS_SEATS) due = Math.max(due, k >= within ? min : min - (within - k))
  return due
}

/**
 * Reserve the goods seats in an already-dealt head. Walk the first positions in order: where the goods
 * owed by that position (goodsDueBy) exceed the goods placed so far, the seat takes the next goods row the
 * head deals — preferring a seller with no goods card yet, so four goods seats are four shops whenever the
 * head carries four — and every other position takes the next row in dealt order.
 * ⚠️ LATEST DEADLINE, SO THE TOP CARDS STAY THE FEED'S OWN. With no goods among the first four, the goods
 * take cards 3 and 4 (and 11 and 12 for the second minimum) — never card 1, which the free MobiFone eSIM
 * holds by the owner's call (feed-window.ts seatOrder) whenever its seat ranks first.
 * ⚠️ A PERMUTATION: every input row comes out exactly once, so `total`, the explorer's terminator and the
 * API's `notIn head` exclusion are unchanged. A head with too few goods rows fills the seats it can and
 * deals the rest in order — "whenever enough exist; otherwise fill normally".
 * Pure and deterministic, so the SSR head and the API's head agree.
 */
export function reserveGoodsSeats<T extends Diversifiable>(rows: readonly T[]): T[] {
  const horizon = Math.max(...GOODS_SEATS.map((s) => s.within))
  const sellerOf = (r: T) => r.sellerId ?? `__no-seller__${r.id}`
  const placed = new Set<number>()
  const goodsSellers = new Set<string>()
  const out: T[] = []
  let goods = 0
  let cursor = 0
  const place = (i: number) => {
    placed.add(i)
    out.push(rows[i])
    if (isSecondHandGoods(rows[i])) {
      goods++
      goodsSellers.add(sellerOf(rows[i]))
    }
  }
  for (let pos = 0; pos < horizon && out.length < rows.length; pos++) {
    if (goods < goodsDueBy(pos + 1)) {
      let pick = -1
      let anyGoods = -1
      for (let i = 0; i < rows.length; i++) {
        if (placed.has(i) || !isSecondHandGoods(rows[i])) continue
        if (anyGoods < 0) anyGoods = i
        if (!goodsSellers.has(sellerOf(rows[i]))) { pick = i; break }
      }
      const seat = pick >= 0 ? pick : anyGoods
      if (seat >= 0) { place(seat); continue }
    }
    // Every index below `cursor` is placed, and a row is still unplaced, so this stops on one.
    while (placed.has(cursor)) cursor++
    place(cursor)
  }
  for (let i = 0; i < rows.length; i++) if (!placed.has(i)) out.push(rows[i])
  return out
}

/**
 * The request parameters that change neither WHICH rows the feed holds nor their ORDER: paging, the
 * payload's language and shape, `verified` (ignored — the public feed is verified-only, feed-query.ts),
 * and `spell` / `match`, which act only on words (and a worded feed is not the home feed). `sort` is
 * neutral only at its default.
 */
const NEUTRAL_FEED_PARAMS: ReadonlySet<string> = new Set(['limit', 'offset', 'lang', 'facets', 'verified', 'spell', 'match'])
/**
 * The parameters feed-query.ts reads as "no filter" when their value is `all`. ⚠️ NOT `subcategory`:
 * sharedSeatsFor reads any subcategory value, `all` included, as chosen, and the two rules must describe
 * the same feed — a request the shared seats call filtered is not the home feed for the goods seats either.
 */
const ALL_IS_UNFILTERED: ReadonlySet<string> = new Set(['category', 'district', 'condition', 'type', 'brand', 'model', 'line', 'priorityCategory'])

/**
 * Whether an /api/listings request is the home page's default feed — the one feed the goods seats apply to.
 * ⛔ AN ALLOW-LIST OF PARAMETERS, NOT A LIST OF FILTERS: any parameter not named above — a filter added
 * next month included — turns the seats off, so a new filter fails toward "the feed is unchanged", never
 * toward goods reshuffled into a filtered feed. An empty value is no value (feed-query.ts reads `q=` and
 * `seller=` as absent).
 * ⚠️ THE EXPLORER'S OWN DEFAULT REQUEST MUST STAY INSIDE IT — `sort=newest&verified=true&limit=12&offset=N
 * &lang=…` (listings-explorer.tsx fetchFeedPage). Otherwise page 2 of the home feed is cut from a head
 * without the seats while the server-rendered twelve had them: a card twice, another never.
 * feed-diversity.test.ts holds that request to HOME_FEED_SEATS.
 */
export function goodsSeatsFor(params: URLSearchParams): boolean {
  for (const [key, value] of params) {
    if (key === 'sort') {
      if (value && value !== DEFAULT_FEED_SORT) return false
      continue
    }
    if (!value || NEUTRAL_FEED_PARAMS.has(key)) continue
    if (value === 'all' && ALL_IS_UNFILTERED.has(key)) continue
    return false
  }
  return true
}

/**
 * The home render's seat rules — the shared seats (sharedSeatsFor with nothing chosen) and the goods
 * seats. /api/listings derives the same pair for the explorer's default request (sharedSeatsFor +
 * goodsSeatsFor), which is what keeps page 2 continuous with the server-rendered first page.
 */
export const HOME_FEED_SEATS: Readonly<Required<SeatOptions>> = Object.freeze({ sharedSeats: true, goodsSeats: true })

/**
 * Merge already-sorted per-seller groups by taking one from each in turn.
 *
 * ⛔ THIS IS THE HALF `diversifyBySeller` COULD NOT DO, AND THE REASON IS THE INPUT. That function
 * reorders a window it is HANDED — the top 60 by rankScore — so it can only interleave sellers who
 * are already in that window. Measured on production 2026-09-08 with 10,215 listings across nine
 * sellers: one seller's 152 rows all scored an identical 0.5772, filled the entire window, and the
 * round-robin became a no-op because `bySeller.size < 2`. Every card on the front page was one
 * shop. The file's own note predicted exactly this ("as inventory grows, diversity past row 60
 * stops being enforced") and named the fix.
 *
 * The fix needs each seller's BEST rows fetched separately, then merged here — which is what
 * `diverseFeedWindow` (feed-window.ts) does. This function is the pure, testable half of it.
 *
 * ⚠️ GROUPS ARRIVE IN PRIORITY ORDER AND KEEP IT. Round 1 is groups[0][0], groups[1][0], … so the
 * strongest seller still leads the page; only the RUN is broken up. Empty groups are skipped rather
 * than leaving holes, so a seller with two listings simply stops appearing after round two.
 */
export function mergeRoundRobin<T>(groups: readonly (readonly T[])[]): T[] {
  const out: T[] = []
  const depth = Math.max(0, ...groups.map((g) => g.length))
  for (let i = 0; i < depth; i++) for (const g of groups) if (i < g.length) out.push(g[i])
  return out
}

/** What a rail row needs beyond a seat: its cover (for the hash in its URL) and, when known, its model. */
type RailRow = Diversifiable & { images?: readonly string[] | null; brandSlug?: string | null; model?: string | null }

/**
 * A SHORT RAIL THAT SHOWS DIFFERENT THINGS — Trending, the home category rails, "For you", the
 * typeahead. Measured 2026-09-29 on /api/category-rails: the electronics rail was eight iPhone 18 Pro
 * variants from one seller, all one cover image; sports, kids, vehicles and travel were each 8 of 8
 * from one seller. A rail is a sample, so unlike the feed it may DROP rows:
 *   · the seller round-robin first (`interleave`, the feed's own rule and seats — off for a list that
 *     is already in relevance order, like the typeahead's);
 *   · a row whose cover is the same photo as a kept one (dHash in the URL within Hamming 6 — a
 *     re-encode, not a different shot; image-hash-url.ts) is skipped;
 *   · a row repeating a kept model is skipped — per seller (`modelScope: 'seller'`, two shops' same
 *     phone are two offers) or across the rail (`'global'`);
 *   · each seat keeps at most `perSeat` rows — but only when the rail HAS three or more seats, so a
 *     category one seller fills still gets a full rail.
 * Stops at `take`. ⚠️ Never touches rankScore (memory eno-esim-carriers): it only chooses among the
 * rows the caller ranked. Pure and deterministic, like everything else here.
 * ⛔ `min` IS A FLOOR THE RULES MAY NOT DIG UNDER. A pool that is one photo or one model throughout
 * (a single importer's variants) keeps ONE card under the rules above, and a rail that short is
 * hidden by its client (MIN_RAIL_ITEMS) — where it used to show eight. Below `min`, the skipped
 * rows come back in rail order, after the distinct ones: repetition beats a category vanishing.
 */
export function diversifyRail<T extends RailRow>(
  rows: readonly T[],
  { take, min = 0, perSeat = 2, modelScope = 'seller', sharedSeats = true, interleave = true }: {
    take: number
    min?: number
    perSeat?: number
    modelScope?: 'seller' | 'global'
    sharedSeats?: boolean
    interleave?: boolean
  },
): T[] {
  const opts: SeatOptions = { sharedSeats }
  const ordered = interleave ? diversifyBySeller(rows, opts) : [...rows]
  const cap = new Set(ordered.map((r) => seatKey(r, opts))).size >= 3 ? perSeat : Infinity
  const covers: string[] = []
  const models = new Set<string>()
  const perSeatCount = new Map<string, number>()
  const out: T[] = []
  for (const r of ordered) {
    if (out.length >= take) break
    const cover = r.images?.[0] ? hashFromUrl(r.images[0]) : null
    if (cover && covers.some((c) => hammingHex(c, cover) <= 6)) continue
    const modelKey = r.model
      ? `${modelScope === 'seller' ? `${r.sellerId ?? r.id}|` : ''}${r.brandSlug ?? ''}|${r.model.toLowerCase()}`
      : null
    if (modelKey && models.has(modelKey)) continue
    const seat = seatKey(r, opts)
    const n = perSeatCount.get(seat) ?? 0
    if (n >= cap) continue
    out.push(r)
    perSeatCount.set(seat, n + 1)
    if (cover) covers.push(cover)
    if (modelKey) models.add(modelKey)
  }
  if (out.length < Math.min(min, take)) {
    const kept = new Set(out)
    for (const r of ordered) {
      if (out.length >= Math.min(min, take)) break
      if (!kept.has(r)) out.push(r)
    }
  }
  return out
}
