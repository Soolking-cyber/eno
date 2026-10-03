/**
 * Re-derive `Brand.listingCount` from the live catalogue.
 *
 * ⚠️ WHY THIS EXISTS: the count is only ever INCREMENTED (src/lib/brand.ts `bumpBrandCount`, on publish)
 * and nothing decrements it — not a sale, not a hide, not a removal. After the second-hand focus hid the
 * new-goods catalogues (2026-10-03), 314 brands still showed a positive count with nothing live behind
 * them (Σ 15,438 counted vs 3,371 live, measured), and `/brands` and the search suggestions filter on
 * `listingCount > 0` — so they advertised brands with nothing to show.
 *
 * ⛔ THE DEFINITION IS THE ADMIN MERGE'S OWN (src/app/api/admin/brands/route.ts): verified AND active
 * listings carrying the brand slug. One definition, so a merge and a recount can never disagree.
 *
 * ⛔ THE WRITE IS CONDITIONAL ON THE VALUE IT REPLACES (`listingCount = prior`): a `bumpBrandCount` that
 * lands between the read and the write is not overwritten — that brand is reported as changed since and
 * left for the next run. `Brand` has no `updatedAt`, so the journal ({slug, prior, next}, on disk first)
 * is the whole record, and the rollback is conditional the other way (`listingCount = next`).
 */

export const LIVE_BRAND_COUNTS_SQL =
  `SELECT "brandSlug" AS slug, count(*)::int AS n FROM "Listing" ` +
  `WHERE verified = true AND status = 'active' AND "brandSlug" IS NOT NULL GROUP BY 1`

/**
 * ⛔ ONE STATEMENT, ONE SNAPSHOT (commit-gate review): the stored and the live count were two concurrent
 * queries, so a publish landing between them could be seen by one and not the other — stored 6, live 5 —
 * and the conditional write (stored still 6) would then erase that publish's increment. Read in a single
 * statement, both sides come from the same MVCC snapshot; a publish after it moves `listingCount` off the
 * journaled prior, and the write skips that brand.
 */
export const BRAND_RECOUNT_READ_SQL =
  `SELECT b.slug, b."listingCount", COALESCE(live.n, 0)::int AS live FROM "Brand" b ` +
  `LEFT JOIN (${LIVE_BRAND_COUNTS_SQL}) live ON live.slug = b.slug`

/** The single read split into the two inputs `brandCountChanges` takes. */
export function splitRecountRead(rows: { slug: string; listingCount: number; live: number }[]) {
  return {
    brands: rows.map((r) => ({ slug: r.slug, listingCount: Number(r.listingCount) })),
    live: rows.filter((r) => Number(r.live) > 0).map((r) => ({ slug: r.slug, n: Number(r.live) })),
  }
}

export type BrandCountChange = { slug: string; prior: number; next: number }

/** Every brand whose stored count differs from its live count. A brand with no live row goes to 0. */
export function brandCountChanges(brands: { slug: string; listingCount: number }[], live: { slug: string; n: number }[]): BrandCountChange[] {
  const liveBy = new Map(live.map((r) => [r.slug, Number(r.n)]))
  return brands
    .map((b) => ({ slug: b.slug, prior: Number(b.listingCount), next: liveBy.get(b.slug) ?? 0 }))
    .filter((c) => c.prior !== c.next)
    .sort((a, b) => Math.abs(b.next - b.prior) - Math.abs(a.next - a.prior) || a.slug.localeCompare(b.slug))
}

export function summarizeBrandChanges(changes: BrandCountChange[]) {
  return {
    brands: changes.length,
    toZero: changes.filter((c) => c.next === 0 && c.prior > 0).length,
    up: changes.filter((c) => c.next > c.prior).length,
    down: changes.filter((c) => c.next < c.prior).length,
    priorTotal: changes.reduce((n, c) => n + c.prior, 0),
    nextTotal: changes.reduce((n, c) => n + c.next, 0),
  }
}

/** $1 slugs, $2 priors, $3 nexts. Lands only where the stored count is still the journaled prior. */
export const BRAND_RECOUNT_SQL =
  `UPDATE "Brand" b SET "listingCount" = j.next FROM unnest($1::text[], $2::int[], $3::int[]) AS j(slug, prior, next) ` +
  `WHERE b.slug = j.slug AND b."listingCount" = j.prior RETURNING b.slug`

/** The inverse: back to the journaled prior, only where the count is still what the recount wrote. */
export const BRAND_RECOUNT_ROLLBACK_SQL =
  `UPDATE "Brand" b SET "listingCount" = j.prior FROM unnest($1::text[], $2::int[], $3::int[]) AS j(slug, prior, next) ` +
  `WHERE b.slug = j.slug AND b."listingCount" = j.next RETURNING b.slug`

export type BrandRecountJournal = { kind: 'brand-recount'; createdAt: string; rows: BrandCountChange[] }

export function parseBrandRecountJournal(text: string): BrandRecountJournal {
  const j = JSON.parse(text) as Partial<BrandRecountJournal>
  if (j.kind !== 'brand-recount' || typeof j.createdAt !== 'string' || !Array.isArray(j.rows)) throw new Error('not a brand-recount journal')
  for (const r of j.rows) {
    if (typeof r?.slug !== 'string' || !Number.isInteger(r.prior) || !Number.isInteger(r.next)) throw new Error(`bad journal row ${JSON.stringify(r)}`)
  }
  return j as BrandRecountJournal
}

export const brandColumns = (rows: BrandCountChange[]) => [rows.map((r) => r.slug), rows.map((r) => r.prior), rows.map((r) => r.next)] as const

/**
 * ⛔ A ROLLBACK NEVER UNDOES A LATER RECOUNT (commit-gate review). Recount A writes 100→10, a publish makes
 * it 11, recount B settles it back to 10 — A's rollback guard (`listingCount = next`) then passes and writes
 * 100 over B. So a rollback refuses while a later brand-recount journal sits beside it: roll that one back
 * first. Returns the later journals' file names.
 */
export function laterRecountJournals(self: { name: string; createdAt: string }, siblings: { name: string; text: string }[]): string[] {
  const at = Date.parse(self.createdAt)
  return siblings.filter((f) => {
    if (f.name === self.name) return false
    try { const j = parseBrandRecountJournal(f.text); return Date.parse(j.createdAt) > at } catch { return false }
  }).map((f) => f.name).sort()
}
