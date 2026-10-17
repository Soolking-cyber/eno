import { clean, fetchStore, UA, DELAY_MS, type StoreConfig } from './partner-fetch'
import { fold } from './fold'
import { PARTNER_STORES } from './partner-stores'
import { partitionRestock, type RestockRow } from './restock-screen'
import { licenceClearedSql } from './licence-stamp'
import { OFF_SITE } from './secondhand-page'
import {
  CAP_POOL_TABLE, CANDIDATE_BUDGET, RETIRING_REASONS, RULE_DEPENDENT, SHELF_CAPS, SHOWCASE_SHELVES,
  classifyApiRow, classifyFeedRow, classifyFollowUp, classifyProductPage, priceDecision, sameItem, sameItemScore, shelfKey, shelfTarget,
  type ApiRead, type FeedFacts, type PageRead, type Verdict,
} from './secondhand-showcase'

/**
 * ── THE WEEKLY SECOND-HAND SHOWCASE RUN (owner, 2026-10-17 — the rules are in src/lib/secondhand-showcase.ts) ──────
 *
 * Three phases, so nothing is written until every shop has been read:
 *   READ   per shop (four at a time — different hosts, each host at most one request per DELAY_MS): classify every live
 *          partner second-hand row (retire on evidence only; reprice what is on sale).
 *   PLAN   per category shelf, across shops: keep its best row(s) — `shelfTarget` — hide the rest into the cap's pool, and
 *          walk that pool for a replacement when the shelf would be empty, each candidate checked at its own shop.
 *   WRITE  retires, trims and reprices, each conditional on the row being exactly as it was read; then the restores, each
 *          under the shelf's advisory lock with the shelf's live count in the same statement — never past its target,
 *          whatever a person or another run did in between. Then the eSIM and car shelves' regrowth trim (SHELF_CAPS).
 *
 * ⛔ THE ROWS IT MAY TOUCH: live `sell` rows of the ownerless partner storefronts in PARTNER_STORES (not `retired`), and
 * rows of the same storefronts that the cap hid and nothing has touched since; on the capped shelves, live rows of the
 * named ownerless storefronts beyond the cap. Never an owned storefront (a person's listings are not a scrape target —
 * the partner-stock rule), never SDC_store / VinWonders, never a row hidden for any other reason, never a new listing.
 *
 * ⚖️ OUTSIDE THE SELLER IDENTITY GATE BY DESIGN, like /api/cron/partner-stock: ownerless platform storefronts have no person
 * to verify. A restore still ANDs licenceClearedSql — these goods are placed by feed-taxonomy and are never in a licence
 * aisle, and the guard keeps it that way if one ever were.
 */

export type Row = {
  id: string; externalId: string | null; affiliateUrl: string | null; price: number; title: string; titleVi: string | null; upd: string
  category: string | null; subcategory: string | null; created: string; condition: string | null
}
export type PoolRow = Row & { description: string | null; descriptionVi: string | null }

/** One write this run made (or, dry, would make) — the journal a rollback replays backwards. */
export type JournalEntry = {
  action: 'retire' | 'reprice' | 'restore' | 'trim'
  store: string; sellerId: string; listingId: string; title: string; shelf: string
  fromStatus: string; toStatus: string; fromPrice: number; toPrice: number
  /** `updatedAt` as read (text) and as this run stamped it — what a rollback matches on. */
  fromUpdatedAt: string; stamp: string
  reason: string; url: string | null
}

export type ShopResult = {
  store: string
  skipped?: string
  /** Its pool could not be read (no top-up from it) — fails the run. */
  poolError?: boolean
  live: number
  available: number
  unknown: { id: string; reason: string }[]
  retire: { id: string; reason: string }[]
  priceRefused: { id: string; why: string }[]
  held?: string
  notes: string[]
}

export type ShelfResult = {
  shelf: string
  target: number
  live: number
  keep: string[]
  retire: { id: string; reason: string }[]
  trim: string[]
  reprice: { id: string; from: number; to: number }[]
  restore: { id: string; price: number; store: string }[]
  candidatesTried: number
  candidateSkips: Record<string, number>
  liveAfter: number
  short: number
  notes: string[]
}

export type RunDeps = {
  db: RawDb
  /** GET `url` for the shop `shop` (its domain) — a fetch may reach that shop's own hosts only (fetchPageHonest). */
  fetchPage(url: string, shop: string): Promise<PageRead>
  /** The feed's facts for these products (WooCommerce: `include` queries for exactly these ids; Haravan: its collection). */
  fetchFeed(cfg: StoreConfig, ids: string[]): Promise<FeedFacts>
  fetchApi(cfg: StoreConfig, row: Row): Promise<ApiRead>
  now(): Date
  sleep(ms: number): Promise<void>
  log(msg: string): void
  /** Purge the touched listings' pages (the route: revalidatePublicPath; the CLI: PDP tombstones). */
  onTouched(ids: string[]): Promise<void>
  /**
   * Each write just BEFORE it is made (write-ahead; a throw stops the writes) — the CLI appends it to its write log, the
   * route logs it — so a run that dies after some writes (a timeout, a restart, a failed statement) still leaves the record
   * a rollback replays; an entry whose write did not land replays as a no-op (review, 2026-10-17: a journal built only in
   * memory and returned at the end is lost with the response).
   */
  onJournal?(entry: JournalEntry): void
}

/** The Prisma surface the run needs (raw SQL only — every statement is spelled out below and audited). */
export type RawTx = {
  $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T>
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number>
}
export type RawDb = RawTx & { $transaction<T>(fn: (tx: RawTx) => Promise<T>): Promise<T> }

export type RunOptions = {
  apply: boolean
  /**
   * Check only these shop domains (default: every live second-hand shop). The others' rows hold their slots unchecked, so
   * their shelves are retired from only; the capped shelves (SHELF_CAPS) wait for a full run; a domain that is not a live
   * shop is refused.
   */
  stores?: string[]
  /** Explicit retirements with a stated reason — e.g. the owner's own report of an item gone. Journaled like any other. */
  retire?: { id: string; reason: string }[]
  /** Rows to keep on their shelf first (still only while on sale) — e.g. the two iPhones of the owner's clip. */
  keep?: string[]
  /** Refuse a run whose retirements exceed this share of the live rows (a bug guard, not a weekly limit). */
  maxRetireShare?: number
  allowMass?: boolean
  /**
   * Stop checking new shops after this long (their live rows then hold their slots, unchecked — `not-checked`); the pool
   * walks stop at twice this. Default 12 minutes (the route passes 10, to end well inside the box timer's 30-minute curl).
   */
  budgetMs?: number
  concurrency?: number
  /** Skip the eSIM / car regrowth trim (SHELF_CAPS). */
  skipShelfCaps?: boolean
}

/** A model, not a unit: the title folded, without the bracketed serial a shop appends ("(*********24582)"). */
export function modelKey(title: string): string {
  return fold(clean(title)).replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
}

/** An unknown that is a passing failure — the row keeps its slot over a replacement (one bad night must not churn a shelf). */
const TRANSIENT = /^(fetch-error|http-(429|5\d\d)|api-error|api-http-(429|5\d\d)|data-fetch-error|data-http-5|feed-incomplete|feed-failed|feed-unreadable|unconfirmed|stale-build|not-checked)/

/**
 * ⚠️ A COMPUTER FILED ON ANOTHER SHELF never refills that shelf. The importers' taxonomy put some machines on the wrong
 * shelf (2026-10-17: Laptop Trung Hậu laptops under "TV & monitors" and "Storage", a Mac mini under "Storage"); a top-up
 * that copies the mistake shows a laptop as the one example of a monitor.
 */
const COMPUTER = /\b(laptop|notebook|macbook|mac mini|imac|thinkpad|latitude|precision|elitebook|probook|zbook|vivobook|zenbook|ideapad|legion|omen|pavilion|inspiron|vostro|xps|surface pro|aspire|nitro|predator|chromebook|core i[3579]|core ultra|ryzen [3579])\b/
export const misfiledComputer = (key: string, title: string) => key !== 'electronics/laptops-pcs' && COMPUTER.test(fold(title))

/** How long one shelf's pool walk may run (the live rows are always read in full). */
const SHELF_WALK_MS = 6 * 60_000
/** Pool rows a feed shop is asked about with its live rows, in one request (more are asked one by one if a shelf needs them). */
const POOL_ASK = 40

const retiring = new Set<string>(RETIRING_REASONS)

/**
 * Live shops, in an order that rotates weekly so a slow week never starves the same shops twice.
 * ⛔ SECOND-HAND STOREFRONTS ONLY: a new-goods storefront (`condition: 'new'` — every one is retired today) is never this
 * job's to trim. Measured 2026-10-17: the 17 live storefronts' 85 live rows are exactly the 2026-10-16 cap's survivors,
 * 78 labelled `used` and 7 unlabelled (Laptop Giá Rẻ, VN Laptop — no-signal shops the cap held to five as well).
 */
export function liveShops(now: Date, only?: string[]): StoreConfig[] {
  const live = PARTNER_STORES.filter((s) => !s.retired && s.condition !== 'new' && (!only?.length || only.includes(s.domain)))
  const week = Math.floor(now.getTime() / (7 * 86_400_000))
  const k = live.length ? week % live.length : 0
  return [...live.slice(k), ...live.slice(0, k)]
}

const stampOf = (d: Date) => d.toISOString().replace('T', ' ').replace('Z', '')
const isFeedShop = (cfg: StoreConfig) => cfg.adapter === 'woocommerce' || cfg.adapter === 'haravan' || cfg.adapter === 'sapo'
const titleOf = (r: Row) => (r.titleVi ?? r.title).slice(0, 120)

async function sellerOf(db: RawDb, name: string): Promise<{ id?: string; problem?: string }> {
  // ⛔ OWNERLESS ONLY — Seller.name is not unique, and anyone may open a storefront by a shop's name (partner-stock).
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Seller" WHERE name = $1 AND "ownerId" IS NULL`, name)
  if (!rows.length) return { problem: 'no_storefront' }
  if (rows.length > 1) return { problem: 'ambiguous_storefront' }
  return { id: rows[0].id }
}

// edition-lint-allow: a write job's reads of OWNERLESS partner storefronts' rows by seller id (sellerOf pins ownerId NULL) —
// never rendered, and the desk is never one of them.
const ROW_COLUMNS = `l.id, l."externalId", l."affiliateUrl", l.price, l.title, l."titleVi", l."updatedAt"::text AS upd,
       c.slug AS category, l."subcategorySlug" AS subcategory, l."createdAt"::text AS created, l.condition`
const LIVE_SQL = `SELECT ${ROW_COLUMNS}
  FROM "Listing" l LEFT JOIN "Category" c ON c.id = l."categoryId"
  WHERE l."sellerId" = $1 AND l.status = 'active' AND l."listingType" = 'sell'
  ORDER BY l."createdAt" DESC, l.id DESC`

/**
 * ⛔ Still an ownerless storefront — in EVERY write, not only the read: a claim changes Seller.ownerId without touching the
 * listing's updatedAt (journaled-hide.ts's RESTORABLE, the house rule), and nothing here may write into a storefront a person
 * now owns (review, 2026-10-17). For an UPDATE of "Listing" without an alias.
 */
export const OWNERLESS_SQL = `EXISTS (SELECT 1 FROM "Seller" so WHERE so.id = "Listing"."sellerId" AND so."ownerId" IS NULL)`
/**
 * Still fit to show: verified, compliance-clear, no identity hold or hold note, no open report — re-checked in every statement that
 * PUBLISHES (the restore, both rollbacks): a report, and a raw-SQL decision, leave updatedAt alone. Measured 2026-10-17:
 * all 1,035 live partner, eSIM and car rows pass it. For an UPDATE of "Listing" without an alias.
 */
export const STILL_PUBLISHABLE_SQL = `verified AND "complianceStatus" = 'clear' AND NOT "identityHold" AND "verificationNotes" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "Report" rp WHERE rp."listingId" = "Listing".id AND rp.status IN ('open', 'confirmed'))`
/** No compliance decision on the row since `since` (a naive-UTC timestamp expression) — journaled-hide.ts's rule. */
export const noDecisionSinceSql = (since: string) =>
  `NOT EXISTS (SELECT 1 FROM compliance_audit a WHERE a."subjectType" = 'listing' AND a."subjectId" = "Listing".id AND a."occurredAt" >= ${since})`

/**
 * The cap's pool, newest first. ⛔ PROVENANCE, NOT JUST STATUS: the row must still be exactly as the cap left it —
 * `updatedAt` no later than the moment it was hidden — because a row hidden again since (a moderator, the ad-ban hide) is
 * also `hidden` with no notes, and only the cap's reason is one a top-up may undo. Measured 2026-10-17: all 6,920 rows the
 * 2026-10-16 cap hid have updatedAt = hidden_at to the millisecond (one statement stamped both); this run's own trims are
 * added with the same property (the trim and the insert share a transaction, hidden_at after the stamp).
 * And: still verified and compliance-clear, no licence/identity hold, condition `used` (the second-hand focus — a no-signal
 * shop's unlabelled rows are not restored), something to check it against (externalId + URL), no open report, and no
 * compliance decision since the hide (0 of the 6,920 had one, 2026-10-17). The restore re-checks all of it as it publishes.
 */
const POOL_SQL = `SELECT ${ROW_COLUMNS}, l.description, l."descriptionVi"
  FROM "${CAP_POOL_TABLE}" h
  JOIN "Listing" l ON l.id = h.id
  LEFT JOIN "Category" c ON c.id = l."categoryId"
  WHERE l."sellerId" = $1 AND l.status = 'hidden' AND l."listingType" = 'sell'
    AND l.verified AND l."complianceStatus" = 'clear' AND l."verificationNotes" IS NULL AND NOT l."identityHold"
    AND l.condition = 'used' AND l."externalId" IS NOT NULL AND l."affiliateUrl" IS NOT NULL
    AND l."updatedAt" <= (h.hidden_at AT TIME ZONE 'UTC') + interval '1 second'
    AND NOT EXISTS (SELECT 1 FROM "Report" r WHERE r."listingId" = l.id AND r.status IN ('open', 'confirmed'))
    AND NOT EXISTS (SELECT 1 FROM compliance_audit a WHERE a."subjectType" = 'listing' AND a."subjectId" = l.id AND a."occurredAt" >= (h.hidden_at AT TIME ZONE 'UTC'))
  ORDER BY l."createdAt" DESC, l.id DESC
  LIMIT 400`

/** One shop as read: its live rows' verdicts, its pool, and a checker for its pool rows. */
type ShopRead = {
  cfg: StoreConfig
  sellerId: string
  result: ShopResult
  live: Row[]
  pool: PoolRow[]
  verdicts: Map<string, Verdict>
  /**
   * A page of one of this shop's LIVE rows read as its own item this run — the proof a `different-item` retirement needs.
   * ⛔ Fixed once the live rows are read: a pool page read during an earlier shelf's walk never counts, or whether a row
   * is retired would depend on which shelf sorts first (review, 2026-10-17).
   */
  sawAvailable: boolean
  /** Set before planning: the rule proven by a live page or a canary (only asked when a rule-dependent retirement waits). */
  proven: boolean
  /**
   * Set before planning: EVERY live row (two or more) of this checked shop read gone (stated ones aside), none on sale — a site
   * change (a moved catalogue, a deploy's 404s) far more often than a week's sales. Its rows are HIDDEN, never sold.
   */
  wholeShopGone?: boolean
  check(row: PoolRow): Promise<Verdict>
}

/** A shop as the database holds it — read for EVERY live shop, checked or not, so its rows hold their slots. */
type ShopBase = { cfg: StoreConfig; sellerId: string; result: ShopResult; live: Row[]; pool: PoolRow[] }

async function loadShop(cfg: StoreConfig, deps: RunDeps): Promise<ShopBase | ShopResult> {
  const base: ShopResult = { store: cfg.domain, live: 0, available: 0, unknown: [], retire: [], priceRefused: [], notes: [] }
  const seller = await sellerOf(deps.db, cfg.name)
  if (!seller.id) return { ...base, skipped: seller.problem }
  const live = await deps.db.$queryRawUnsafe<Row[]>(LIVE_SQL, seller.id)
  const result: ShopResult = { ...base, live: live.length }
  // The pool table is the cap's own record; without it nothing may be published (fail closed), checks still run.
  const pool = await deps.db.$queryRawUnsafe<PoolRow[]>(POOL_SQL, seller.id).catch((e) => {
    result.notes.push(`pool unreadable (${(e as Error).message.slice(0, 80)}) — no top-up`)
    result.poolError = true
    return [] as PoolRow[]
  })
  return { cfg, sellerId: seller.id, result, live, pool }
}

/**
 * ⛔ A SHOP NOT CHECKED THIS RUN (an error, the time budget, `?store=` naming another) STILL OCCUPIES ITS SHELVES: its
 * live rows hold their slots as `not-checked` — never retired, never trimmed — and it lends nothing from its pool. Leaving
 * it out instead let another shop refill a shelf on top of its row (review, 2026-10-17).
 */
function uncheckedShop(base: ShopBase, why: string): ShopRead {
  base.result.notes.push(`not checked this run: ${why}`)
  const verdicts = new Map<string, Verdict>(base.live.map((r) => [r.id, { state: 'unknown', reason: `not-checked: ${why}` }]))
  return { ...base, pool: [], verdicts, proven: false, sawAvailable: false, check: async () => ({ state: 'unknown', reason: 'not-checked' }) }
}

async function checkShop(b: ShopBase, deps: RunDeps, forced: Map<string, string>): Promise<ShopRead> {
  const { cfg, sellerId, result, live, pool } = b

  let feed: FeedFacts | null = null
  if (isFeedShop(cfg)) {
    const ids = [...live, ...pool.slice(0, POOL_ASK)].map((r) => r.externalId).filter((x): x is string => !!x)
    try { feed = await deps.fetchFeed(cfg, ids) } catch (e) { result.notes.push(`feed failed: ${(e as Error).message.slice(0, 100)}`) }
    if (feed && !feed.complete) result.notes.push(`feed incomplete (${feed.byId.size} products read)`)
  }
  // A feed shop whose feed is refused or empty is read through its product pages only where that was measured to work.
  const pages = !isFeedShop(cfg) || (!!cfg.showcase?.pageFallback && (!feed || feed.byId.size === 0))
  if (pages && isFeedShop(cfg)) result.notes.push('feed unreadable — product pages instead (pageFallback)')

  let sawAvailable = false
  const verdict = async (row: Row, confirmAbsence: boolean): Promise<Verdict> => {
    if (!pages && feed) {
      let v = classifyFeedRow(feed, row.externalId ?? '')
      if (v === 'absent' && !confirmAbsence && row.externalId && cfg.adapter === 'woocommerce' && !feed.seen.has(row.externalId)) {
        // A pool row past the prefetch: one `include` for it alone.
        try {
          const more = await deps.fetchFeed(cfg, [row.externalId])
          for (const [k, x] of more.byId) feed.byId.set(k, x)
          for (const k of more.seen) feed.seen.add(k)
          for (const k of more.soldIds ?? []) (feed.soldIds ??= new Set()).add(k)
          for (const k of more.soldUnknown ?? []) (feed.soldUnknown ??= new Set()).add(k)
          v = more.complete ? classifyFeedRow(feed, row.externalId) : { state: 'unknown', reason: 'feed-incomplete' }
        } catch { return { state: 'unknown', reason: 'feed-failed' } }
      }
      if (v !== 'absent') return v
      if (!confirmAbsence) return { state: 'unknown', reason: 'absent-from-feed' }
      return classifyApiRow(await deps.fetchApi(cfg, row), cfg.showcase)
    }
    if (!pages) return { state: 'unknown', reason: 'feed-unreadable' }
    if (!row.affiliateUrl) return { state: 'unknown', reason: 'no-url' }
    const url = row.affiliateUrl
    const readPage = async (): Promise<Verdict> => {
      const page = await deps.fetchPage(url, cfg.domain)
      const v = classifyProductPage(page, cfg)
      return v.state === 'unknown' && v.followUp ? classifyFollowUp(cfg.domain, page, await deps.fetchPage(v.followUp, cfg.domain)) : v
    }
    const v = await readPage()
    if (v.state !== 'unavailable' || !confirmAbsence) return v
    // ⛔ TWO READS MUST AGREE before a page retires anything — a flapping origin, a cache in front of it.
    await deps.sleep(DELAY_MS * 3)
    const again = await readPage()
    return again.state === 'unavailable' ? v : { state: 'unknown', reason: `unconfirmed: ${v.reason} then ${again.reason}` }
  }

  const verdicts = new Map<string, Verdict>()
  for (const row of live) {
    const forcedReason = forced.get(row.id)
    if (forcedReason) { verdicts.set(row.id, { state: 'unavailable', reason: `stated: ${forcedReason}` }); continue }
    let v = await verdict(row, true)
    if (v.state === 'available' && v.name) {
      // The same URL selling another unit: under 30% of the words shared is a different item (the listed one is gone);
      // between 30 and 60%, unknown — a renamed title is not a sale.
      const score = sameItemScore(row.titleVi ?? row.title, v.name)
      if (score < 0.3) v = { state: 'unavailable', reason: 'different-item', name: v.name }
      else if (score < 0.6) v = { state: 'unknown', reason: `maybe a different item at the URL: "${v.name.slice(0, 60)}"` }
    }
    if (v.state === 'available') { sawAvailable = true; result.available++ }
    verdicts.set(row.id, v)
  }
  return { cfg, sellerId, result, live, pool, verdicts, proven: false, sawAvailable, check: (row) => verdict(row, false) }
}

/**
 * Proof that the shop's rule spares live pages, when no page of the shop read available this run: classify a few
 * products the shop links RIGHT NOW (its first collection page or sitemap). ≤ 4 requests, only when a rule-dependent
 * retirement is waiting.
 */
async function canary(cfg: StoreConfig, deps: RunDeps, known: Set<string>): Promise<boolean> {
  const source = cfg.collections?.[0] ?? cfg.sitemaps?.[0]
  if (!source || !cfg.urlMatch) return false
  const index = await deps.fetchPage(source, cfg.domain)
  if (index.status !== 200) return false
  const match = new RegExp(cfg.urlMatch)
  const urls = new Set<string>()
  for (const m of index.html.matchAll(/(?:href=["']|<loc>\s*)([^"'<\s#?]+)/g)) {
    let u = m[1]
    if (u.startsWith('/')) u = `https://${cfg.domain}${u}`
    if (match.test(u) && !known.has(u)) urls.add(u)
    if (urls.size >= 3) break
  }
  for (const u of urls) if (classifyProductPage(await deps.fetchPage(u, cfg.domain), cfg).state === 'available') return true
  return false
}

function toRestockRow(p: PoolRow): RestockRow {
  return { id: p.id, title: p.title, titleVi: p.titleVi, description: p.description, descriptionVi: p.descriptionVi, subcategorySlug: p.subcategory, category: p.category ? { slug: p.category } : null }
}

type Placed = { row: Row; shop: ShopRead }
type ShelfPlan = {
  key: string
  result: ShelfResult
  retire: (Placed & { v: Verdict })[]
  trim: Placed[]
  reprice: (Placed & { to: number })[]
  restore: { row: PoolRow; shop: ShopRead; price: number; v: Verdict }[]
  /** Would-be retirements of a shop that read gone as a whole (wholeShopGone): hidden instead — counted by the mass guard. */
  held: Placed[]
}

/** Plan one category shelf across the shops read: retire on evidence, keep the best, trim the rest, top up if empty. */
async function planShelf(key: string, placed: Placed[], shops: ShopRead[], deps: RunDeps, pins: Set<string>, consumed: Set<string>, deadline: number): Promise<ShelfPlan> {
  const target = shelfTarget(key)
  const result: ShelfResult = { shelf: key, target, live: placed.length, keep: [], retire: [], trim: [], reprice: [], restore: [], candidatesTried: 0, candidateSkips: {}, liveAfter: 0, short: 0, notes: [] }
  const plan: ShelfPlan = { key, result, retire: [], trim: [], reprice: [], restore: [], held: [] }
  // ⛔ A SHELF NOT FULLY CHECKED THIS RUN (a shop's error, the budget, `?store=`) is only retired from — never trimmed,
  // never refilled: its unchecked rows' real state is unknown, and the shelf may already be full (review, 2026-10-17).
  const partial = placed.some((p) => p.shop.verdicts.get(p.row.id)?.reason.startsWith('not-checked'))
  const available: Placed[] = []
  const unknownRows: Placed[] = []
  for (const p of placed) {
    const v = p.shop.verdicts.get(p.row.id)!
    if (v.state === 'unavailable' && (retiring.has(v.reason) || v.reason.startsWith('stated: '))) {
      if (p.shop.wholeShopGone && !v.reason.startsWith('stated: ')) {
        // ⛔ Not sold on a whole shop's say-so: hidden below (a hide is reversible and invisible; `sold` is neither).
        plan.held.push(p)
        p.shop.result.unknown.push({ id: p.row.id, reason: `held: ${v.reason} — every row of the shop read gone, none on sale` })
        p.shop.result.held = 'every live row of this shop read gone and none read on sale — a site change more likely than sales: hidden, not sold'
        continue
      }
      // `different-item` needs a page of the SAME shop read as its own item (a canary page has no stored title to compare);
      // `zero-stock` (a page-structure rule) is also proven by the canary.
      if (RULE_DEPENDENT.has(v.reason) && !(v.reason === 'different-item' ? p.shop.sawAvailable : p.shop.proven)) {
        // Computed evidence with no live page of the shop read right this run: held — the row keeps its slot.
        unknownRows.push(p)
        p.shop.result.unknown.push({ id: p.row.id, reason: `held: ${v.reason}` })
        p.shop.result.held = 'a retirement on a shop rule held — no page of this shop read as its own item this run, so the rule may be misfiring'
        continue
      }
      plan.retire.push({ ...p, v })
    } else if (v.state === 'available') available.push(p)
    else { unknownRows.push(p); if (v.state === 'unknown') p.shop.result.unknown.push({ id: p.row.id, reason: v.reason }) }
  }
  // The keepers, in this order: pinned, then what is on sale (newest first — the cap's own order); then a row that could
  // not be read for a PASSING reason (a timeout, a 5xx — it keeps its slot rather than churn on one bad night); then, only
  // if the pool has nothing verified to offer, a row we cannot vouch for at all (a bot wall, maybe another item at its
  // URL, re-filed out of the shop's used shelf). Hiding is not "sold": the others go hidden into the pool, never sold.
  const rank = (a: Placed, b: Placed) => Number(pins.has(b.row.id)) - Number(pins.has(a.row.id)) || b.row.created.localeCompare(a.row.created)
  const passing = (p: Placed) => { const v = p.shop.verdicts.get(p.row.id)!; return v.state === 'unknown' && TRANSIENT.test(v.reason) }
  const steady = unknownRows.filter(passing).sort(rank)
  // ⚠️ A SECOND-HAND SHELF SHOWS SECOND-HAND GOODS: a row not labelled `used` (a no-signal shop's, a new-and-used shop's) is
  // kept only when the pool has nothing verified and used to offer (review, 2026-10-17).
  const unvouched = [...available.filter((p) => p.row.condition !== 'used'), ...unknownRows.filter((p) => !passing(p))].sort(rank)
  const keepAvail = available.filter((p) => p.row.condition === 'used').sort(rank).slice(0, target)
  const keepSteady = steady.slice(0, target - keepAvail.length)
  const sure = [...keepAvail, ...keepSteady]
  for (const k of keepAvail) {
    const v = k.shop.verdicts.get(k.row.id)!
    if (v.state !== 'available') continue
    // On sale with no one price read (variants at several prices, a price field missing): nothing written — said.
    if (v.price === undefined) k.shop.result.priceRefused.push({ id: k.row.id, why: 'on sale, but no one price read at the shop — none written' })
    const d = priceDecision(k.row.price, v.price)
    if (d.next !== undefined) plan.reprice.push({ ...k, to: d.next })
    if (d.refused) k.shop.result.priceRefused.push({ id: k.row.id, why: d.refused })
  }
  if (partial) {
    result.notes.push('a shop on this shelf was not checked this run — retirements only, no trim, no refill')
    result.keep = [...available, ...unknownRows, ...plan.held].map((p) => p.row.id)
    result.liveAfter = result.keep.length
    result.short = Math.max(0, target - result.liveAfter)
    return plan
  }
  // The walk: replacements from the cap's pool on this shelf, any shop, newest first.
  const need = Math.max(0, target - sure.length)
  if (need) {
    const onShow = new Set(sure.map((k) => modelKey(titleOf(k.row))))
    const pool = shops.flatMap((shop) => shop.pool.filter((r) => shelfKey(r.category, r.subcategory) === key && !consumed.has(r.id)).map((row) => ({ row, shop })))
      .sort((a, b) => b.row.created.localeCompare(a.row.created))
    const screen = partitionRestock(pool.map((p) => p.row.id), pool.map((p) => toRestockRow(p.row)), null)
    const screenedClean = new Set(screen.restock.filter((id) => !screen.review.some((f) => f.id === id)))
    const skip = (why: string) => { result.candidateSkips[why] = (result.candidateSkips[why] ?? 0) + 1 }
    const repeats: ShelfPlan['restore'] = []
    const until = Math.min(deps.now().getTime() + SHELF_WALK_MS, deadline)
    const errors = new Map<string, number>()
    for (const { row, shop } of pool) {
      if (plan.restore.length >= need || result.candidatesTried >= CANDIDATE_BUDGET) break
      if (deps.now().getTime() > until) { result.notes.push('pool walk stopped: out of time'); break }
      if ((errors.get(shop.cfg.domain) ?? 0) >= 3) { skip('shop-not-answering'); continue }
      if (!screenedClean.has(row.id)) { skip('screen'); continue }
      if (misfiledComputer(key, titleOf(row))) { skip('misfiled-computer'); continue }
      result.candidatesTried++
      const v = await shop.check(row)
      errors.set(shop.cfg.domain, v.state === 'unknown' && /^(fetch-error|http-5|blocked)/.test(v.reason) ? (errors.get(shop.cfg.domain) ?? 0) + 1 : 0)
      if (v.state !== 'available') { skip(v.state === 'unknown' ? `unknown:${v.reason.split(':')[0]}` : v.reason); continue }
      if (!sameItem(row.titleVi ?? row.title, v.name)) { skip('different-item'); continue }
      if (v.price === undefined) { skip('no-fresh-price'); continue }
      const d = priceDecision(row.price, v.price)
      if (d.refused) { skip('price-swing'); continue }
      const pick = { row, shop, price: d.next ?? Math.round(row.price), v }
      // ⚠️ VARIETY: a model already on the shelf waits (Minh Tuấn's pool is the same phone under many serials).
      const mk = modelKey(titleOf(row))
      if (onShow.has(mk)) { repeats.push(pick); skip('same-model-as-shown'); continue }
      onShow.add(mk)
      consumed.add(row.id)
      plan.restore.push(pick)
    }
    while (plan.restore.length < need && repeats.length) { const r = repeats.shift()!; consumed.add(r.row.id); plan.restore.push(r) }
  }
  const keepers = [...sure, ...unvouched.slice(0, Math.max(0, need - plan.restore.length))]
  const kept = new Set(keepers.map((k) => k.row.id))
  for (const p of [...available, ...unknownRows, ...plan.held]) if (!kept.has(p.row.id)) plan.trim.push(p)
  result.keep = keepers.map((k) => k.row.id)
  result.liveAfter = keepers.length + plan.restore.length
  result.short = Math.max(0, target - result.liveAfter)
  return plan
}


/** Every partner storefront this run read — the set a shelf's live count is taken over. */
type Ctx = { stamp: string; partnerIds: string[]; journal: JournalEntry[]; touched: string[]; onJournal?: (e: JournalEntry) => void; journalError?: string }
/**
 * ⛔ WRITE-AHEAD: a write is journaled (onJournal — the durable record) BEFORE it is made, and is not made when that fails
 * (a full disk) — nor is any later one. A rollback replays the record conditionally (the row's status and this run's
 * stamp), so an entry whose write did not land is simply left alone, and no write lands unrecorded (review, 2026-10-17:
 * journaling after the write could lose the one that mattered). The answer's journal lists the writes that landed.
 */
async function journaled(ctx: Ctx, e: JournalEntry, write: () => Promise<number>): Promise<number> {
  if (ctx.journalError) return 0
  try { ctx.onJournal?.(e) } catch (err) { ctx.journalError = `journal: ${(err as Error).message.slice(0, 120)} — no further writes`; return 0 }
  const n = await write()
  if (n) { ctx.journal.push(e); ctx.touched.push(e.listingId) }
  return n
}

function entry(ctx: Ctx, action: JournalEntry['action'], shelf: string, shop: ShopRead, row: Row, from: { status: string; price: number; upd: string }, toStatus: string, toPrice: number, reason: string): JournalEntry {
  return {
    action, store: shop.cfg.domain, sellerId: shop.sellerId, listingId: row.id, title: titleOf(row), shelf,
    fromStatus: from.status, toStatus, fromPrice: from.price, toPrice, fromUpdatedAt: from.upd, stamp: ctx.stamp, reason, url: row.affiliateUrl,
  }
}

async function writeShelf(plan: ShelfPlan, deps: RunDeps, ctx: Ctx) {
  const { db } = deps
  const r = plan.result
  const applied = { retire: [] as ShelfResult['retire'], trim: [] as string[], reprice: [] as ShelfResult['reprice'], restore: [] as ShelfResult['restore'] }
  // The shelf's result names the writes CONFIRMED landed, even when one throws mid-shelf; a write whose confirmation was
  // lost is still in the write-ahead record (onJournal), which a rollback replays conditionally.
  try {
    for (const { row, shop, v } of plan.retire) {
      if (ctx.journalError) break
      const n = await journaled(ctx, entry(ctx, 'retire', plan.key, shop, row, { status: 'active', price: row.price, upd: row.upd }, 'sold', row.price, v.reason), () => db.$executeRawUnsafe(
        `UPDATE "Listing" SET status = 'sold', "updatedAt" = $2::timestamp WHERE id = $1 AND status = 'active' AND "updatedAt"::text = $3 AND ${OWNERLESS_SQL}`,
        row.id, ctx.stamp, row.upd))
      if (n) applied.retire.push({ id: row.id, reason: v.reason })
      else if (!ctx.journalError) r.notes.push(`retire skipped, row changed since the read: ${row.id}`)
    }
    for (const { row, shop } of plan.trim) {
      if (ctx.journalError) break
      // Hidden INTO the pool, in one transaction: a later week may bring it back if its shelf empties (provenance as above).
      const n = await journaled(ctx, entry(ctx, 'trim', plan.key, shop, row, { status: 'active', price: row.price, upd: row.upd }, 'hidden', row.price, 'one per category'), () => db.$transaction(async (tx) => {
        const hid = await tx.$executeRawUnsafe(
          `UPDATE "Listing" SET status = 'hidden', "updatedAt" = $2::timestamp WHERE id = $1 AND status = 'active' AND "updatedAt"::text = $3 AND ${OWNERLESS_SQL}`,
          row.id, ctx.stamp, row.upd)
        // hidden_at FROM THE SAME STAMP as updatedAt — one clock: the pool's provenance test (updatedAt ≤ hidden_at + 1 s)
        // must not depend on the app's and the database's clocks agreeing (review, 2026-10-17).
        if (hid) await tx.$executeRawUnsafe(`INSERT INTO "${CAP_POOL_TABLE}" (id, hidden_at) VALUES ($1, $2::timestamp AT TIME ZONE 'UTC') ON CONFLICT (id) DO UPDATE SET hidden_at = EXCLUDED.hidden_at`, row.id, ctx.stamp)
        return hid
      }))
      if (n) applied.trim.push(row.id)
      else if (!ctx.journalError) r.notes.push(`trim skipped, row changed since the read: ${row.id}`)
    }
    for (const { row, shop, to } of plan.reprice) {
      if (ctx.journalError) break
      const n = await journaled(ctx, entry(ctx, 'reprice', plan.key, shop, row, { status: 'active', price: row.price, upd: row.upd }, 'active', to, 'shop price'), () => db.$executeRawUnsafe(
        `UPDATE "Listing" SET price = $2, "updatedAt" = $3::timestamp WHERE id = $1 AND status = 'active' AND "updatedAt"::text = $4 AND ${OWNERLESS_SQL}`,
        row.id, to, ctx.stamp, row.upd))
      if (n) applied.reprice.push({ id: row.id, from: row.price, to })
      else if (!ctx.journalError) r.notes.push(`reprice skipped, row changed since the read: ${row.id}`)
    }
    for (const { row, shop, price, v } of plan.restore) {
      if (ctx.journalError) break
      const n = await journaled(ctx, entry(ctx, 'restore', plan.key, shop, row, { status: 'hidden', price: row.price, upd: row.upd }, 'active', price, v.reason), () => db.$transaction(async (tx) => {
        // One writer per shelf, and the shelf's live rows counted in the statement that publishes — never past its target.
        // ⛔ The pool read's conditions are re-checked HERE, in the publishing statement — moderation, the storefront, the cap's
        // provenance and no compliance decision since:
        // a report filed during the run's minutes of shop reads leaves updatedAt alone, so the conditional write alone would
        // miss it (review, 2026-10-17).
        // ⚠️ $executeRaw, not $queryRaw: pg_advisory_xact_lock returns `void`, a column Prisma cannot deserialize.
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `secondhand-showcase:${plan.key}`)
        return tx.$executeRawUnsafe(
          `UPDATE "Listing" SET status = 'active', price = $2, "updatedAt" = $3::timestamp
            WHERE id = $1 AND status = 'hidden' AND "updatedAt"::text = $4 AND ${licenceClearedSql()}
              AND ${STILL_PUBLISHABLE_SQL} AND condition = 'used' AND ${OWNERLESS_SQL}
              AND EXISTS (SELECT 1 FROM "${CAP_POOL_TABLE}" h WHERE h.id = "Listing".id AND "Listing"."updatedAt" <= (h.hidden_at AT TIME ZONE 'UTC') + interval '1 second'
                            AND ${noDecisionSinceSql(`(h.hidden_at AT TIME ZONE 'UTC')`)})
              AND (SELECT count(*) FROM "Listing" x WHERE x."sellerId" = ANY($5::text[]) AND x.status = 'active' AND x."listingType" = 'sell'
                     AND x."categoryId" IS NOT DISTINCT FROM "Listing"."categoryId" AND x."subcategorySlug" IS NOT DISTINCT FROM "Listing"."subcategorySlug") < $6`,
          row.id, price, ctx.stamp, row.upd, ctx.partnerIds, r.target)
      }))
      if (n) applied.restore.push({ id: row.id, price, store: shop.cfg.domain })
      else if (!ctx.journalError) r.notes.push(`restore skipped (row changed, or the shelf is already full): ${row.id}`)
    }
  } finally {
    r.retire = applied.retire
    r.trim = applied.trim
    r.reprice = applied.reprice
    r.restore = applied.restore
  }
}

/** The dry run's journal: what --apply would write, in the same shape. */
function journalPlan(plan: ShelfPlan, ctx: Ctx) {
  for (const { row, shop, v } of plan.retire) ctx.journal.push(entry(ctx, 'retire', plan.key, shop, row, { status: 'active', price: row.price, upd: row.upd }, 'sold', row.price, v.reason))
  for (const { row, shop } of plan.trim) ctx.journal.push(entry(ctx, 'trim', plan.key, shop, row, { status: 'active', price: row.price, upd: row.upd }, 'hidden', row.price, 'one per category'))
  for (const { row, shop, to } of plan.reprice) ctx.journal.push(entry(ctx, 'reprice', plan.key, shop, row, { status: 'active', price: row.price, upd: row.upd }, 'active', to, 'shop price'))
  for (const { row, shop, price, v } of plan.restore) ctx.journal.push(entry(ctx, 'restore', plan.key, shop, row, { status: 'hidden', price: row.price, upd: row.upd }, 'active', price, v.reason))
  plan.result.retire = plan.retire.map(({ row, v }) => ({ id: row.id, reason: v.reason }))
  plan.result.trim = plan.trim.map(({ row }) => row.id)
  plan.result.reprice = plan.reprice.map(({ row, to }) => ({ id: row.id, from: row.price, to }))
  plan.result.restore = plan.restore.map(({ row, price, shop }) => ({ id: row.id, price, store: shop.cfg.domain }))
}

export type CapResult = { shelf: string; live: number; trim: { id: string; seller: string; title: string }[]; notes: string[] }

/**
 * The eSIM and car shelves' regrowth trim (SHELF_CAPS): a new import or a revival past the cap goes hidden — the NEWEST
 * listed first, so the earliest-listed, the ones the owner's curation kept, stay. Never a top-up, never a check.
 */
async function capShelves(deps: RunDeps, ctx: Ctx, apply: boolean): Promise<CapResult[]> {
  const out: CapResult[] = []
  for (const cap of SHELF_CAPS) {
    const res: CapResult = { shelf: cap.shelf, live: 0, trim: [], notes: [] }
    const sellers: { id: string; name: string }[] = []
    for (const name of cap.sellers) {
      const s = await sellerOf(deps.db, name)
      if (s.id) sellers.push({ id: s.id, name })
      else res.notes.push(`${name}: ${s.problem}`)
    }
    // edition-lint-allow: ownerless storefronts named in SHELF_CAPS, by id — a write job's read, never rendered.
    const rows = sellers.length ? await deps.db.$queryRawUnsafe<{ id: string; sellerId: string; title: string; upd: string; created: string }[]>(
      `SELECT l.id, l."sellerId", coalesce(l."titleVi", l.title) AS title, l."updatedAt"::text AS upd, l."createdAt"::text AS created
         FROM "Listing" l WHERE l."sellerId" = ANY($1::text[]) AND l.status = 'active' AND l."subcategorySlug" = $2
        ORDER BY l."createdAt" ASC, l.id ASC`, sellers.map((s) => s.id), cap.subcategory) : []
    res.live = rows.length
    const perSeller = new Map<string, number>()
    let total = 0
    const extra: typeof rows = []
    for (const r of rows) {
      const n = perSeller.get(r.sellerId) ?? 0
      if (n >= cap.perSeller || total >= cap.total) { extra.push(r); continue }
      perSeller.set(r.sellerId, n + 1)
      total++
    }
    for (const r of extra) {
      const seller = sellers.find((s) => s.id === r.sellerId)!.name
      const e: JournalEntry = { action: 'trim', store: seller, sellerId: r.sellerId, listingId: r.id, title: r.title.slice(0, 120), shelf: cap.shelf, fromStatus: 'active', toStatus: 'hidden', fromPrice: 0, toPrice: 0, fromUpdatedAt: r.upd, stamp: ctx.stamp, reason: `${cap.shelf} cap (${cap.perSeller} per seller, ${cap.total} in all)`, url: null }
      if (apply) {
        if (ctx.journalError) break
        // A row changed since the read is left for next week's run (a conditional write never picks another in its place).
        const n = await journaled(ctx, e, () => deps.db.$executeRawUnsafe(
          `UPDATE "Listing" SET status = 'hidden', "updatedAt" = $2::timestamp WHERE id = $1 AND status = 'active' AND "updatedAt"::text = $3 AND ${OWNERLESS_SQL}`,
          r.id, ctx.stamp, r.upd))
        if (!n) { if (!ctx.journalError) res.notes.push(`skipped, changed since the read: ${r.id}`); continue }
      } else ctx.journal.push(e)
      res.trim.push({ id: r.id, seller, title: r.title.slice(0, 100) })
    }
    out.push(res)
  }
  return out
}

export type RunResult = {
  ok: boolean
  apply: boolean
  refused?: string
  /** Writes that failed (each shelf's own; the journal holds every write that landed before and after). */
  writeErrors: string[]
  stamp: string
  totals: { live: number; shelves: number; retire: number; trim: number; reprice: number; restore: number; unknown: number; short: number; capTrim: number }
  notReached: string[]
  unmatchedRetire: string[]
  shelves: ShelfResult[]
  shops: ShopResult[]
  caps: CapResult[]
  journal: JournalEntry[]
}

export async function runShowcase(deps: RunDeps, opts: RunOptions): Promise<RunResult> {
  const started = deps.now()
  const forced = new Map((opts.retire ?? []).map((r) => [r.id, r.reason]))
  const pins = new Set(opts.keep ?? [])
  const budget = opts.budgetMs ?? 12 * 60_000
  const deadline = started.getTime() + 2 * budget
  const notReached: string[] = []
  // ⛔ A STORE THE RUN DOES NOT KNOW IS REFUSED, not run as "nothing selected" (a misspelt ?store= answered ok — review).
  const strangers = (opts.stores ?? []).filter((d) => !liveShops(started).some((s) => s.domain === d))
  if (strangers.length) {
    return {
      ok: false, apply: false, refused: `unknown_store: ${strangers.join(', ')} is not a live second-hand shop`, writeErrors: [], stamp: stampOf(started),
      totals: { live: 0, shelves: 0, retire: 0, trim: 0, reprice: 0, restore: 0, unknown: 0, short: 0, capTrim: 0 },
      notReached: [], unmatchedRetire: [], shelves: [], shops: [], caps: [], journal: [],
    }
  }
  // LOAD — every live shop's rows from the database (cheap), checked this run or not.
  const loaded: (ShopBase | ShopResult)[] = []
  for (const cfg of liveShops(started)) loaded.push(await loadShop(cfg, deps))
  const bases = loaded.filter((x): x is ShopBase => 'cfg' in x)
  // ⛔ A LIVE SHOP WHOSE STOREFRONT IS AMBIGUOUS (two ownerless sellers by its name) holds rows nobody can place: its
  // shelves' real counts are unknown, so nothing is written until a person resolves it (review, 2026-10-17).
  const ambiguous = loaded.filter((x): x is ShopResult => !('cfg' in x) && x.skipped === 'ambiguous_storefront').map((x) => x.store)
  // CHECK — the selected shops at their shops, a few at a time (different hosts), within the budget.
  const selected = bases.filter((b) => !opts.stores?.length || opts.stores.includes(b.cfg.domain))
  const read = new Map<string, ShopRead>()
  const checked = new Set<string>()
  for (const b of bases) if (!selected.includes(b)) read.set(b.cfg.domain, uncheckedShop(b, 'not in this run'))
  let next = 0
  const worker = async () => {
    while (next < selected.length) {
      const b = selected[next++]
      if (deps.now().getTime() - started.getTime() > budget) { notReached.push(b.cfg.domain); read.set(b.cfg.domain, uncheckedShop(b, 'time budget')); continue }
      try { read.set(b.cfg.domain, await checkShop(b, deps, forced)); checked.add(b.cfg.domain) } catch (e) {
        b.result.skipped = `error: ${(e as Error).message.slice(0, 120)}`
        read.set(b.cfg.domain, uncheckedShop(b, 'error'))
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker))
  const shops = bases.map((b) => read.get(b.cfg.domain)!)
  // A rule-dependent retirement needs a live page of its shop read right this run; ask a canary only where it waits.
  for (const shop of shops) {
    const waits = [...shop.verdicts.values()].some((v) => v.state === 'unavailable' && v.reason === 'zero-stock')
    shop.proven = shop.sawAvailable || (waits && await canary(shop.cfg, deps, new Set(shop.live.map((r) => r.affiliateUrl ?? ''))))
  }
  for (const shop of shops) {
    if (!checked.has(shop.cfg.domain) || shop.sawAvailable) continue
    // Two rows at least: ONE row read gone cannot tell a sale from a site change, and is retired on its own two reads.
    const vs = shop.live.map((r) => shop.verdicts.get(r.id)!).filter((v) => !v.reason.startsWith('stated: '))
    shop.wholeShopGone = vs.length >= 2 && vs.every((v) => v.state === 'unavailable')
  }
  // PLAN — per shelf, across every shop: the shelves the curation left, plus any shelf a live row sits on.
  const byShelf = new Map<string, Placed[]>(SHOWCASE_SHELVES.map((k) => [k, []]))
  for (const shop of shops) for (const row of shop.live) {
    const k = shelfKey(row.category, row.subcategory)
    ;(byShelf.get(k) ?? byShelf.set(k, []).get(k)!).push({ row, shop })
  }
  const consumed = new Set<string>()
  const plans: ShelfPlan[] = []
  for (const [key, placed] of [...byShelf].sort(([a], [b]) => a.localeCompare(b))) plans.push(await planShelf(key, placed, shops, deps, pins, consumed, deadline))

  // ⛔ The restore's live count spans EVERY partner storefront, checked or not — the shelf's real state.
  // The stamp is taken as the writing starts (seconds before the writes land), not at the run's start up to twenty minutes
  // earlier — a row's updatedAt then says when it changed. One stamp for the run: what a rollback matches. (No reader
  // syncs on an updatedAt cursor today; the trims' hidden_at is written from this same stamp.)
  const ctx: Ctx = { stamp: stampOf(deps.now()), partnerIds: bases.map((b) => b.sellerId), journal: [], touched: [], onJournal: deps.onJournal }
  const liveTotal = shops.reduce((a, s) => a + s.live.length, 0)
  // A whole shop's held rows count as the retirements they would have been: a global outage is still refused.
  const retireTotal = plans.reduce((a, p) => a + p.retire.length + p.held.length, 0)
  // Measured over the rows CHECKED this run: a one-shop run is judged against that shop's rows, not diluted by the rest.
  const checkedLive = shops.filter((s) => checked.has(s.cfg.domain)).reduce((a, s) => a + s.live.length, 0)
  let refused: string | undefined
  // ⛔ A BUG GUARD: more than half the live rows retired in one run (and more than five) is a broken rule or a broken
  // read far more often than a week of sales.
  if (opts.apply && !opts.allowMass && retireTotal > 5 && retireTotal / Math.max(1, checkedLive) > (opts.maxRetireShare ?? 0.5)) {
    refused = `mass_retire: ${retireTotal} of ${checkedLive} live rows checked would be retired — read the plan (dry run), then re-run with allowMass`
  }
  // ⛔ …and hides: a shelf with no subcategory has target 0, so a taxonomy change that empties subcategorySlug would hide
  // every row in one run — "a trim never removes a keeper" does not hold there (review, 2026-10-17). More than ten rows and
  // more than half the live ones hidden at once is refused the same way. (The first, curating run passes allowMass.)
  const trimTotal = plans.reduce((a, p) => a + p.trim.length, 0)
  if (!refused && opts.apply && !opts.allowMass && trimTotal > 10 && trimTotal / Math.max(1, liveTotal) > 0.5) {
    refused = `mass_trim: ${trimTotal} of ${liveTotal} live rows would be hidden — read the plan (dry run), then re-run with allowMass`
  }
  if (!refused && opts.apply && ambiguous.length) refused = `ambiguous_storefront: ${ambiguous.join(', ')} — two ownerless storefronts by one name; nothing written`
  const writing = opts.apply && !refused
  const writeErrors: string[] = []
  // ⛔ PAGES REVALIDATED AS EACH SHELF LANDS, not once at the end: a run that dies later (a restart, a lost connection)
  // leaves no retired or hidden row of an earlier shelf rendering from a 30-day ISR page (review, 2026-10-17).
  let flushed = 0
  const flush = async () => {
    const ids = ctx.touched.slice(flushed)
    flushed = ctx.touched.length
    if (ids.length) await deps.onTouched(ids).catch((e) => writeErrors.push(`revalidate: ${(e as Error).message.slice(0, 120)}`))
  }
  for (const p of plans) {
    if (!writing) { journalPlan(p, ctx); continue }
    if (ctx.journalError) { p.result.notes.push('not written: the journal stopped taking writes'); continue }
    // One shelf's failure (a statement timeout, a lost connection) never costs the journal of what already landed.
    try { await writeShelf(p, deps, ctx) } catch (e) { writeErrors.push(`${p.key}: ${(e as Error).message.slice(0, 120)}`); p.result.notes.push(`write failed: ${(e as Error).message.slice(0, 120)}`) }
    await flush()
  }
  let caps: CapResult[] = []
  // The capped shelves belong to a FULL run: `stores` asks about those shops only (review, 2026-10-17).
  if (!opts.skipShelfCaps && !opts.stores?.length && !ctx.journalError) {
    try { caps = await capShelves(deps, ctx, writing) } catch (e) { writeErrors.push(`caps: ${(e as Error).message.slice(0, 120)}`) }
    if (writing) await flush()
  }
  if (ctx.journalError) writeErrors.push(ctx.journalError)
  const shopResults = [...loaded.filter((x): x is ShopResult => !('cfg' in x)), ...shops.map((s) => s.result)]
  for (const p of plans) for (const r of p.result.retire) shops.find((s) => s.live.some((l) => l.id === r.id))?.result.retire.push(r)
  const shelves = plans.map((p) => p.result)
  const count = (a: JournalEntry['action']) => ctx.journal.filter((j) => j.action === a && byShelf.has(j.shelf)).length
  const totals = {
    live: liveTotal,
    shelves: shelves.length,
    retire: count('retire'),
    trim: count('trim'),
    reprice: count('reprice'),
    restore: count('restore'),
    unknown: shopResults.reduce((a, s) => a + s.unknown.length, 0),
    short: shelves.reduce((a, s) => a + s.short, 0),
    capTrim: caps.reduce((a, c) => a + c.trim.length, 0),
  }
  // A pool that cannot be read (a dropped table, a broken column) drains every shelf week after week: a FAILED run, not a note.
  const failed = shopResults.some((s) => s.skipped?.startsWith('error') || s.poolError) || writeErrors.length > 0
  // A stated retirement that matched no live row did nothing — say so rather than let it read as done.
  const matched = new Set(plans.flatMap((p) => p.retire.map((r) => r.row.id)))
  const unmatchedRetire = [...forced.keys()].filter((id) => !matched.has(id))
  return { ok: !refused && !failed, apply: writing, refused, writeErrors, stamp: ctx.stamp, totals, notReached, unmatchedRetire, shelves, shops: shopResults, caps, journal: ctx.journal }
}

// ── The network side, shared by the route and the CLI ──────────────────────────────────────────────────────────────

const lastHit = new Map<string, number>()
/** Politeness per HOST: at most one request per DELAY_MS, whatever runs in parallel — each caller RESERVES its slot before
 * it sleeps, so two waiting on one host never wake together. */
async function polite(url: string, sleep: (ms: number) => Promise<void>) {
  const host = new URL(url).host
  const slot = Math.max(Date.now(), (lastHit.get(host) ?? 0) + DELAY_MS)
  lastHit.set(host, slot)
  if (slot > Date.now()) await sleep(slot - Date.now())
}

/** The shop's own address — its domain or a subdomain, over http(s), no credentials or port: all a read for it may reach. */
export function shopAddress(raw: string, shop: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  return /^https?:$/.test(u.protocol) && !u.username && !u.password && !u.port && (u.hostname === shop || u.hostname.endsWith(`.${shop}`))
}

/** At most `max` bytes of a body — a product page is well under a megabyte; a hostile one is not read to the end. */
async function cappedText(res: Response, max = 8_000_000): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const parts: Uint8Array[] = []
  for (let n = 0; ;) {
    const { done, value } = await reader.read()
    if (done) break
    n += value.length
    if (n > max) {
      try { await reader.cancel() } catch { /* the rest of the body is abandoned either way */ }
      break
    }
    parts.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(parts))
}

/**
 * ⛔ EVERY REQUEST THIS JOB MAKES GOES TO THE SHOP BEING CHECKED — page, follow-up, canary, feed and API alike, redirects
 * followed by hand (five at most) and each hop checked: a stored URL, a configured endpoint and a shop's redirect may not
 * send the box to loopback, the private network, a metadata endpoint — or another shop, whose page would vouch for this
 * one's listing (reviews, 2026-10-17; measured: all 6,968 partner rows' URLs sit on their own shop's domain). An address
 * off the shop is never fetched (`error: OFF_SITE`). Bodies are read to 8 MB at most. (Haravan's collection walk,
 * fetchStore, is partner-fetch's — shared with the importers — and reads only the shop's configured endpoint.)
 */
async function readWithinShop(url: string, shop: string, accept: string, timeoutMs: number, sleep: (ms: number) => Promise<void>): Promise<PageRead> {
  let current = url
  for (let hop = 0; hop <= 5; hop++) {
    if (!shopAddress(current, shop)) return { url, status: 0, finalUrl: current, html: '', error: OFF_SITE }
    await polite(current, sleep)
    const res = await fetch(current, { headers: { 'User-Agent': UA, Accept: accept }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
    const to = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (!to) return { url, status: res.status, finalUrl: current, html: await cappedText(res) }
    try { await res.body?.cancel() } catch { /* a redirect's body is abandoned either way */ }
    current = new URL(to, current).toString()
  }
  return { url, status: 0, finalUrl: current, html: '', error: 'too many redirects' }
}

/** GET a product page for `shop` with the honest user-agent (readWithinShop's fence); one retry on a network error or a 5xx. */
export async function fetchPageHonest(url: string, shop: string, sleep: (ms: number) => Promise<void>): Promise<PageRead> {
  for (let attempt = 0; ; attempt++) {
    try {
      const read = await readWithinShop(url, shop, 'text/html', 30_000, sleep)
      if (read.status >= 500 && attempt === 0) { await sleep(5_000); continue }
      return read
    } catch (e) {
      if (attempt === 0) { await sleep(5_000); continue }
      return { url, status: 0, finalUrl: url, html: '', error: (e as Error).message }
    }
  }
}

/**
 * The facts a feed shop gives about exactly these products.
 *
 * WooCommerce: the Store API's `include=` filter on the shop's own used-category endpoint — one request per 100 ids, so
 * the answer is authoritative for those ids and immune to the pagination drift a 43-page walk suffers (banghethanhly's
 * X-WP-Total moved 4224 → 4225 mid-read on 2026-10-17, duplicating one row and never reading the new one). Present = in
 * the used categories; absent = confirmed per row. A shop with a sold category is asked a second `include` against it.
 * ⚠️ 60-second timeouts: laptopgiare.vn took 18–32 s per API call.
 *
 * Haravan: its collection through the importer's adapter (≤ 4 pages of 50 — it has no `include`), retried once.
 */
export async function fetchFeedFacts(cfg: StoreConfig, ids: string[], sleep: (ms: number) => Promise<void>): Promise<FeedFacts> {
  if (cfg.adapter !== 'woocommerce') {
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const f = await fetchStore(cfg)
        const byId = new Map(f.products.map((p) => [p.externalId, { inStock: p.inStock, price: p.price, name: p.name }]))
        if (f.complete || attempt === 1) return { complete: f.complete, byId, seen: f.seenExternalIds }
      } catch (e) { lastError = e }
      await sleep(10_000)
    }
    throw lastError instanceof Error ? lastError : new Error('feed read failed')
  }
  const unique = [...new Set(ids)]
  const facts: FeedFacts = { complete: true, byId: new Map(), seen: new Set() }
  const ask = async (endpoint: string, chunk: string[]): Promise<Record<string, unknown>[] | null> => {
    const url = `${endpoint.replace(/([?&])page=\{page\}/, '$1page=1')}&include=${chunk.map(encodeURIComponent).join(',')}`
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await readWithinShop(url, cfg.domain, 'application/json', 60_000, sleep)
        let body: unknown = null
        try { body = JSON.parse(res.html) } catch { /* not JSON: the read is incomplete */ }
        if (res.status >= 200 && res.status < 300 && Array.isArray(body)) return body as Record<string, unknown>[]
      } catch { /* retried once, then the read is incomplete */ }
      await sleep(5_000)
    }
    return null
  }
  const sold = cfg.showcase?.soldCategoryId
  const soldEndpoint = sold === undefined ? null
    : /([?&])category=[^&]*/.test(cfg.endpoint) ? cfg.endpoint.replace(/([?&])category=[^&]*/, `$1category=${sold}`) : `${cfg.endpoint}&category=${sold}`
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100)
    const rows = await ask(cfg.endpoint, chunk)
    if (!rows) { facts.complete = false; continue }
    for (const r of rows) {
      const id = String(r.id ?? '')
      if (!id) continue
      facts.seen.add(id)
      const prices = (r.prices ?? {}) as Record<string, unknown>
      const price = Number(prices.price ?? NaN) / 10 ** (Number(prices.currency_minor_unit ?? 0) || 0)
      if (!(price > 0)) continue // a "Liên hệ" product: listed, nothing to publish or reprice
      // ⛔ A variable product's `prices.price` is its CHEAPEST variation: written only when the range is one price (the
      // onePrice rule of secondhand-page.ts) — on sale either way.
      const range = prices.price_range as { min_amount?: unknown; max_amount?: unknown } | null | undefined
      // One price only on PROOF: no range at all, or both bounds there and equal (an empty range object proves nothing).
      const one = !range || (range.min_amount != null && range.max_amount != null && String(range.min_amount) === String(range.max_amount))
      facts.byId.set(id, { inStock: r.is_in_stock !== false, backorder: r.is_on_backorder === true, price: one ? Math.round(price) : undefined, name: clean(String(r.name ?? '')) })
    }
    if (soldEndpoint) {
      const soldRows = await ask(soldEndpoint, chunk)
      // ⛔ The sold list unread: these products' feed rows prove nothing (banghethanhly lists sold goods as in stock).
      if (!soldRows) { facts.complete = false; for (const id of chunk) (facts.soldUnknown ??= new Set()).add(id); continue }
      facts.soldIds ??= new Set()
      for (const r of soldRows) facts.soldIds.add(String(r.id ?? ''))
    }
  }
  return facts
}

/** The per-product API answer for a row the complete feed did not list (WooCommerce Store API, Haravan product JSON). */
export async function fetchApiHonest(cfg: StoreConfig, row: Row, sleep: (ms: number) => Promise<void>): Promise<ApiRead> {
  let url: string
  if (cfg.adapter === 'woocommerce') url = cfg.endpoint.replace(/\/products\?.*$/, `/products/${encodeURIComponent(row.externalId ?? '')}`)
  else {
    const handle = (row.affiliateUrl ?? '').replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() ?? ''
    url = `https://${cfg.domain}/products/${encodeURIComponent(handle)}.json`
  }
  try {
    const res = await readWithinShop(url, cfg.domain, 'application/json', 60_000, sleep)
    if (res.error) return { status: 0, error: res.error }
    let json: Record<string, unknown> | null = null
    try { json = JSON.parse(res.html) } catch { /* a non-JSON answer is classified by status */ }
    return { status: res.status, json }
  } catch (e) {
    return { status: 0, error: (e as Error).message }
  }
}
