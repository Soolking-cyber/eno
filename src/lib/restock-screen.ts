import { screenImportRow } from './import-screen'

/**
 * ── THE CONTENT SCREEN ON A RESTOCK (sold → active) ─────────────────────────────────────────────
 *
 * The two nightly stock jobs — /api/cron/partner-stock (the scraped partner shops) and
 * /api/cron/affiliate-prices (the AccessTrade merchants) — move imported rows between `active` and
 * `sold` to match the source. A RESTOCK puts a row back in front of buyers, i.e. advertises it again,
 * and those rows were imported before the content screen (src/lib/import-screen.ts) existed. So a
 * restock is screened exactly as an importer screens an existing row (2026-10-01):
 *
 *   · banned word or ad classifier 'ban' → NOT restocked, and HIDDEN: a `sold` row is still public
 *     (the PDP renders a 200 "this item has been sold" page for verified + sold — get-listing.ts
 *     listingIsViewable), and the import screen's contract hides an existing live banned row. The
 *     jobs only ever move rows between active and sold, so the hide sticks until a human restores it.
 *   · 'review' → restocked as normal and REPORTED. An ambiguous row is never taken down on its own
 *     (the classifier's contract); it is already live, a human decides.
 *   · 'ok' → restocked.
 *
 * ⛔ A TOMBSTONE ('removed') IS NEVER A CANDIDATE: both jobs restock only rows they read as `sold`, and
 * every write re-states `status = 'sold'` in its WHERE, so a removal that lands between the read and the
 * write is not revived (and not hidden either — it stays a tombstone).
 */

/** The listing text the screen reads, as the jobs select it. */
export type RestockRow = {
  id: string
  title: string
  titleVi: string | null
  description: string | null
  descriptionVi: string | null
  subcategorySlug: string | null
  category: { slug: string } | null
}

export type RestockFlag = { id: string; reason: 'banned_word' | 'ad_banned' | 'ad_review'; rule: string; matched: string }

export type RestockDecision = {
  /** May go sold → active. Includes the 'review' rows. */
  restock: string[]
  /** Refused: never restocked, hidden. */
  hide: RestockFlag[]
  /** Restocked, and listed for a human. */
  review: RestockFlag[]
}

/** Pure: the decision for every candidate. A candidate whose text could not be read is NOT restocked. */
export function partitionRestock(candidateIds: string[], rows: RestockRow[], merchant: string | null): RestockDecision {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const out: RestockDecision = { restock: [], hide: [], review: [] }
  for (const id of candidateIds) {
    const r = byId.get(id)
    // Not readable (gone, or no longer `sold` when the screen read it) — nothing to restock.
    if (!r) continue
    const s = screenImportRow({
      title: r.title, titleVi: r.titleVi, description: r.description, descriptionVi: r.descriptionVi,
      category: r.category?.slug ?? null, subcategory: r.subcategorySlug, merchant,
    })
    if (s.action === 'import') { out.restock.push(id); continue }
    const flag: RestockFlag = { id, reason: s.reason, rule: s.rule, matched: s.matched }
    if (s.reason === 'ad_review') { out.review.push(flag); out.restock.push(id) }
    else out.hide.push(flag)
  }
  return out
}

/** The database surface the screen needs — a PrismaClient satisfies it. */
export type RestockDb = {
  listing: {
    findMany(args: {
      where: { id: { in: string[] }; status: 'sold' }
      select: { id: true; title: true; titleVi: true; description: true; descriptionVi: true; subcategorySlug: true; category: { select: { slug: true } } }
    }): Promise<RestockRow[]>
    updateMany(args: { where: { id: { in: string[] }; status: 'sold' }; data: { status: 'hidden' } }): Promise<{ count: number }>
  }
}

const CHUNK = 1000

/**
 * Read the candidates' text (still `sold`), screen them, and HIDE the refused ones — conditionally on
 * their still being `sold`, so nothing else (a tombstone, a row a human moved) is touched. Returns the
 * decision and how many rows the hide actually changed. The restock write itself stays with the caller.
 */
export async function screenRestock(db: RestockDb, candidateIds: string[], merchant: string | null): Promise<RestockDecision & { hidden: number }> {
  const ids = [...new Set(candidateIds)]
  const rows: RestockRow[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    // edition-lint-allow: a write job's read of rows it already holds by id (ownerless import
    // storefronts only — the callers' seller lookup pins ownerId: null); never rendered.
    rows.push(...(await db.listing.findMany({
      where: { id: { in: ids.slice(i, i + CHUNK) }, status: 'sold' },
      select: { id: true, title: true, titleVi: true, description: true, descriptionVi: true, subcategorySlug: true, category: { select: { slug: true } } },
    })))
  }
  const decision = partitionRestock(ids, rows, merchant)
  let hidden = 0
  const hideIds = decision.hide.map((f) => f.id)
  for (let i = 0; i < hideIds.length; i += CHUNK) {
    hidden += (await db.listing.updateMany({ where: { id: { in: hideIds.slice(i, i + CHUNK) }, status: 'sold' }, data: { status: 'hidden' } })).count
  }
  return { ...decision, hidden }
}

/** What a job puts in its results: counts, plus enough of each flagged row for a human (and a rollback). */
export function restockReport(d: RestockDecision & { hidden: number }) {
  if (!d.hide.length && !d.review.length) return {}
  return {
    restockScreen: {
      hidden: d.hidden,
      // Rollback of a wrong hide: UPDATE "Listing" SET status='sold' WHERE id = ANY(<ids>) AND status='hidden'
      hiddenRows: d.hide.slice(0, 50),
      review: d.review.length,
      reviewRows: d.review.slice(0, 50),
    },
  }
}
