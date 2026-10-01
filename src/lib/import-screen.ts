import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { findBannedWordAccentAware } from './publish-guard'
import { classifyAdBanned, isBookListing, type AdBanInput } from './ad-banned'
import { journaledHide, type HideJournal, type HideJournalRow } from './journaled-hide'

/**
 * ── THE CONTENT SCREEN EVERY IMPORTER RUNS BEFORE IT WRITES A ROW ─────────────────────────────────
 *
 * Imported rows are published as LINKED reference listings — eno.vn did not write them and is not the
 * seller, but it does publish them, and publishing is advertising. Two screens, in order:
 *
 *   1. The illegal-goods word list a seller's own post is held to (publish-guard.ts), on the TITLES and
 *      the short public texts (`extraTexts`: a location, an employer) — read WITH ACCENTS
 *      (findBannedWordAccentAware).
 *      ⛔ NOT ON DESCRIPTIONS, AND NOT FOLDED (2026-10-01, review). The folded screen over titles AND
 *      descriptions refused 266 of 98,802 live imported rows (measured 2026-10-01, read-only), nearly
 *      all folding collisions in merchant copy: "thuộc phiên bản" → "thuoc phien" (opium) on Casper/
 *      Daikin air conditioners, "mật mã tùy thích" → "ma tuy" on a padlock, "cao hỗ trợ" → "cao ho" on
 *      an HP laptop, "xanh cô ban đậm" → "ban dam" in a title. A refusal froze a live row on stale text
 *      and price. What a merchant catalogue sells is in its title; the ad classifier below still reads
 *      descriptions, for 'review'.
 *      ⛔ AND NOT ON A BOOK (isBookListing): a book about weapons or opium is not weapons or opium.
 *      With both, the same rows give 11: ten NexGard/Bravecto (veterinary prescription drugs — also
 *      'ban' in the ad classifier) and one nunchaku training book whose title carries no book marker.
 *      ⚠️ WITHOUT the contact-info check: a linked row legitimately names its source and carries the
 *      source's link in `affiliateUrl`, and the importers that need the contact screen (nhatot, jobs)
 *      already run assertCleanTexts themselves.
 *   2. classifyAdBanned — goods that may not be ADVERTISED (src/lib/ad-banned.ts).
 *
 * ⛔ WHAT A REFUSAL DOES DEPENDS ON WHETHER THE ROW ALREADY EXISTS — A LIVE ROW IS NEVER SILENTLY FROZEN.
 *   · new row, any refusal              → not created.
 *   · existing row, banned word or 'ban' → not refreshed, and HIDDEN if it is live (active or sold —
 *     a sold PDP still renders): applyHides() journals {id, priorStatus, updatedAt} BEFORE a raw-SQL
 *     hide (no updatedAt bump — src/lib/journaled-hide.ts), and `npx tsx scripts/hide-ad-banned.ts
 *     --rollback <journal>` restores it while nobody has touched it since.
 *   · existing LIVE row, 'review'       → REFRESHED as normal (it is already live; freezing it would
 *     leave a stale price and stock up) and listed in the review file for a human. The same rule
 *     scripts/hide-ad-banned.ts follows: an ambiguous row is never taken down on its own.
 *   · existing row that is NOT live — a tombstone ('removed'), a row a human hid or holds as a draft —
 *     → left exactly as it is, 'review' included: not refreshed, not hidden (2026-10-01, review: a
 *     held row is a human's decision, and refreshing its text, price or photos rewrites what they held).
 * EVERY refusal — banned word included — is written to the review file
 * (scripts/journals/import-review-<importer>-<time>.json) with what was done about it.
 */

export type ImportScreenRow = AdBanInput & {
  /** Any other publicly rendered short text the importer writes (location, employer, brand…). */
  extraTexts?: (string | null | undefined)[]
  /** For the review file and the existing-row lookup: the row's key at the source (the upsert key). */
  externalId?: string | null
  url?: string | null
}

export type ImportScreenOutcome =
  | { action: 'import' }
  | { action: 'skip'; reason: 'banned_word' | 'ad_banned' | 'ad_review'; rule: string; matched: string }

/** Pure: the decision for one row, before anything is known about the database. */
export function screenImportRow(row: ImportScreenRow): ImportScreenOutcome {
  // A BOOK whose title names a weapon, a drug or a crime is a book (isBookListing — "Bách Khoa Thư Các
  // Loại Vũ Khí", the novel "Làm Đĩ"): 22 of the 33 live title hits left after the accent fix were
  // Tiki books, and a live one would now be HIDDEN, not merely frozen.
  const book = isBookListing(row)
  for (const t of book ? [] : [row.title, row.titleVi, ...(row.extraTexts ?? [])]) {
    const w = findBannedWordAccentAware(t)
    if (w) return { action: 'skip', reason: 'banned_word', rule: 'banned_word', matched: w }
  }
  const r = classifyAdBanned(row)
  if (r.verdict === 'ban') return { action: 'skip', reason: 'ad_banned', rule: r.rule ?? 'ad_banned', matched: r.matched ?? '' }
  if (r.verdict === 'review') return { action: 'skip', reason: 'ad_review', rule: r.rule ?? 'ad_review', matched: r.matched ?? '' }
  return { action: 'import' }
}

/** The row already in the database under this externalId, if the importer knows it. */
export type ExistingRow = { id: string; status: string; sellerId?: string } | null

/** What the screen did with a refused (or review) row — recorded in the review file. */
export type ScreenAction =
  | 'not_created' // new row, refused
  | 'hide' // existing live row, banned → hidden by finish() (dry run: would be)
  | 'left_as_is' // existing row that is not live (hidden by a human, a draft, a tombstone…) — untouched
  | 'refreshed_for_review' // existing LIVE row, ambiguous → refreshed as normal, a human decides

type ReviewEntry = {
  externalId: string | null; listingId: string | null; existingStatus: string | null
  title: string; reason: string; rule: string; matched: string; url: string | null; action: ScreenAction
}

/** Statuses a reader can still see: active is the feed, sold is the 200 sold page. */
const LIVE = new Set(['active', 'sold'])

/** The minimal database surface the screen needs — a PrismaClient satisfies it. */
export type ScreenDb = {
  listing: { findMany(args: { where: Record<string, unknown>; select: { id: true; status: true; externalId: true; sellerId: true } }): Promise<{ id: string; status: string; externalId: string | null; sellerId: string }[]> }
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
}

/** The journal applyHides() writes before it hides — the format scripts/hide-ad-banned.ts --rollback
 *  reads (src/lib/journaled-hide.ts: each row's prior status AND updatedAt, read just before the hide). */
export type ImportHideJournal = HideJournal & { kind: 'import-screen-hide'; importer: string }

/** A live banned row queued for applyHides(): its storefront when known (for the `sellerIds` filter). */
type HideEntry = Omit<HideJournalRow, 'priorStatus' | 'updatedAt'> & { sellerId: string | null }

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')

/**
 * A per-run tally. `await check(row, existing?)` returns true when the row may be written (created or
 * refreshed); report() prints the summary and writes the review file; applyHides() (--apply only)
 * hides the live banned rows; finish() is both. Pass `existing` when the importer has already read the row (null = it
 * does not exist); leave it out and a REFUSED row is looked up by externalId (scoped to `sellerIds`
 * when given) — an accepted row costs no query.
 */
export class ImportScreen {
  readonly counts = { banned_word: 0, ad_banned: 0, ad_review: 0 }
  readonly byRule = new Map<string, number>()
  readonly reviews: ReviewEntry[] = []
  /** Existing live rows refused as banned — applyHides() hides them. */
  readonly toHide: HideEntry[] = []
  private readonly dir: string
  private readonly db: ScreenDb | null
  private readonly sellerIds: string[] | null

  constructor(readonly importer: string, opts: { db?: ScreenDb | null; sellerIds?: string[] | null; dir?: string } = {}) {
    this.dir = opts.dir ?? join(process.cwd(), 'scripts', 'journals')
    this.db = opts.db ?? null
    this.sellerIds = opts.sellerIds?.length ? opts.sellerIds : null
  }

  private async lookup(externalId: string | null | undefined): Promise<ExistingRow> {
    if (!externalId || !this.db) return null
    // edition-lint-allow: an importer's own write-side lookup by its source key (in its own storefronts
    // where it names them, ownerless always) — never rendered, never published by this read.
    const rows = await this.db.listing.findMany({
      // ⛔ ONLY AN OWNERLESS (IMPORT) STOREFRONT'S ROW. An importer never writes into a storefront a real
      // account owns, so the screen never hides one either — whatever key it happens to share.
      where: { externalId, seller: { ownerId: null }, ...(this.sellerIds ? { sellerId: { in: this.sellerIds } } : {}) },
      select: { id: true, status: true, externalId: true, sellerId: true },
    })
    // Several sellers can share a key only across storefronts; the live one is the one that matters.
    return rows.find((r) => LIVE.has(r.status)) ?? rows[0] ?? null
  }

  async check(row: ImportScreenRow, existing?: ExistingRow): Promise<boolean> {
    const out = screenImportRow(row)
    if (out.action === 'import') return true
    const ex = existing === undefined ? await this.lookup(row.externalId) : existing
    const title = String(row.titleVi || row.title || '').slice(0, 160)
    const live = !!ex && LIVE.has(ex.status)
    // ⛔ ONLY A LIVE ROW IS REFRESHED FOR REVIEW: a hidden/draft row is a human's hold and a tombstone is
    // the record — 'review' leaves both exactly as they are, like every other refusal.
    const action: ScreenAction = !ex ? 'not_created'
      : !live ? 'left_as_is'
      : out.reason === 'ad_review' ? 'refreshed_for_review'
      : 'hide'
    this.counts[out.reason]++
    const key = `${out.reason}:${out.rule}`
    this.byRule.set(key, (this.byRule.get(key) ?? 0) + 1)
    this.reviews.push({
      externalId: row.externalId ?? null, listingId: ex?.id ?? null, existingStatus: ex?.status ?? null,
      title, reason: out.reason, rule: out.rule, matched: out.matched, url: row.url ?? null, action,
    })
    if (action === 'hide') this.toHide.push({ id: ex!.id, sellerId: ex!.sellerId ?? null, rule: out.rule, matched: out.matched || null, title })
    // An ambiguous row that is already up is refreshed — never frozen on stale text, price or stock.
    return action === 'refreshed_for_review'
  }

  get total(): number {
    return this.counts.banned_word + this.counts.ad_banned + this.counts.ad_review
  }

  /** The summary lines (also what finish() prints). */
  summary(): string[] {
    const n = (a: ScreenAction) => this.reviews.filter((r) => r.action === a).length
    const lines = [
      `content screen (${this.importer}): ${this.total} refused — ${this.counts.banned_word} banned word, ${this.counts.ad_banned} ad-banned, ${this.counts.ad_review} held for review`,
      `    ${n('not_created')} not created · ${n('hide')} live row(s) to hide · ${n('refreshed_for_review')} already live, refreshed, listed for review · ${n('left_as_is')} left as they are`,
    ]
    for (const [k, c] of [...this.byRule].sort((a, b) => b[1] - a[1])) lines.push(`    ${String(c).padStart(5)}  ${k}`)
    for (const s of this.reviews.slice(0, 10)) lines.push(`      · [${s.reason}/${s.rule} → ${s.action}] ${s.title}  ← ${s.matched}`)
    return lines
  }

  /**
   * Print the summary and write the review file (dry run and apply alike). Hides NOTHING — a live
   * banned row is only reported here; applyHides() takes it down. Returns the review file's path.
   */
  report(log: (line: string) => void = console.log): string | null {
    for (const l of this.summary()) log(l)
    if (this.toHide.length) log(`    ${this.toHide.length} live row(s) to hide — hidden on --apply (status → 'hidden', journaled, reversible)`)
    if (!this.reviews.length) return null
    mkdirSync(this.dir, { recursive: true })
    const review = join(this.dir, `import-review-${this.importer}-${stamp()}.json`)
    writeFileSync(review, JSON.stringify({ importer: this.importer, createdAt: new Date().toISOString(), rows: this.reviews }, null, 2))
    log(`    review file: ${review} (${this.reviews.length} rows)`)
    return review
  }

  /**
   * --apply only: hide the live banned rows. ⛔ Call it AFTER the importer's own storefront refusals
   * (an owned or misnamed storefront is refused before anything is written, and so are its rows) — and
   * pass `sellerIds` when those refusals are per storefront (import-esim.ts): a row whose storefront is
   * not in the list, or unknown, is NOT hidden.
   * ⛔ Through journaledHide (src/lib/journaled-hide.ts): only an ownerless storefront's imported row;
   * its status and updatedAt read just before the hide and journaled BEFORE any row changes; the hide
   * conditional on both; raw SQL, so `updatedAt` is not bumped and --rollback can tell a later human
   * write apart. A row that left active|sold since the check is skipped. Returns the journal path (null
   * when nothing was hidden).
   */
  async applyHides(log: (line: string) => void = console.log, opts: { sellerIds?: readonly string[] } = {}): Promise<{ journal: string | null; hidden: number }> {
    const allowed = opts.sellerIds ? new Set(opts.sellerIds) : null
    const go = allowed ? this.toHide.filter((r) => r.sellerId !== null && allowed.has(r.sellerId)) : this.toHide
    if (allowed && go.length < this.toHide.length) log(`    ${this.toHide.length - go.length} live row(s) to hide are in a storefront this run refused or never vetted — NOT hidden`)
    if (!go.length) return { journal: null, hidden: 0 }
    if (!this.db) throw new Error('ImportScreen.applyHides needs the database (construct it with { db })')
    const path = join(this.dir, `import-hide-${this.importer}-${stamp()}.json`)
    const out = await journaledHide(this.db, go.map(({ sellerId: _s, ...c }) => c), { path, kind: 'import-screen-hide', importer: this.importer })
    if (!out.journal) { log(`    0 of ${go.length} row(s) to hide are still live — nothing hidden`); return { journal: null, hidden: 0 } }
    log(`    HIDDEN ${out.hidden.length} of ${go.length} live row(s) the content screen refused. Journal: ${out.journal}`)
    log(`    ROLLBACK: npx tsx scripts/hide-ad-banned.ts --rollback ${out.journal} --apply`)
    log('    NEXT: purge the baked PDPs — node scripts/purge-isr-listings.mjs')
    return { journal: out.journal, hidden: out.hidden.length }
  }

  /** report() and, with `apply`, applyHides() — for an importer with no storefront refusal after its screen. */
  async finish(opts: { apply: boolean; log?: (line: string) => void }): Promise<{ review: string | null; journal: string | null; hidden: number }> {
    const review = this.report(opts.log)
    const { journal, hidden } = opts.apply ? await this.applyHides(opts.log) : { journal: null, hidden: 0 }
    return { review, journal, hidden }
  }
}
