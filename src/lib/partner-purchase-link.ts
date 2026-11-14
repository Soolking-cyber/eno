import type { Prisma } from '../generated/prisma/client'
type Sql = ReturnType<typeof Prisma.sql>

/**
 * ── THE STAFF-ONLY PURCHASE LINK OF AN ENO-RUN PARTNER'S LISTING (owner, 2026-11-14) ────────────────────────────────────
 *
 * "same as other partners users just text our admins to buy we buy and send seperately no links that lead to another
 * website" + "only admins should see the link to purchase devices for users" + "and send in chat if needed".
 *
 * For a storefront eno runs (src/lib/eno-run-partners.ts) the AccessTrade purchase link is kept in "PartnerPurchaseLink",
 * and the public `Listing.affiliateUrl` stays NULL — so every public surface (cards, PDP, feeds, sitemap, search, MCP,
 * JSON-LD; ~60 readers) shows an ordinary partner listing with chat, by construction rather than by gating each reader.
 *
 * ⛔ WHO READS IT: the staff endpoint (GET /api/listings/[id]/purchase-link — an admin, or the listing's pinned eno-held
 * owner; `private, no-store`), the nightly affiliate-prices job and the AccessTrade importer. Never serialized, never in a
 * server-rendered (ISR/edge-cached) page. The table has RLS on and no policy: PostgREST's anon key reads nothing.
 */

/** Insert or refresh links; a row whose url did not change is left alone (no updatedAt churn). Returns rows written. */
export async function upsertPurchaseLinks(
  dbc: { $executeRaw: (q: Sql) => Promise<number> },
  sql: { sql: typeof Prisma.sql; join: typeof Prisma.join },
  links: { listingId: string; url: string }[],
): Promise<number> {
  let written = 0
  for (let i = 0; i < links.length; i += 500) {
    const chunk = links.slice(i, i + 500)
    const values = sql.join(chunk.map((l) => sql.sql`(${l.listingId}, ${l.url})`))
    written += await dbc.$executeRaw(sql.sql`
      INSERT INTO "PartnerPurchaseLink" ("listingId", url, "updatedAt")
      SELECT v.id, v.url, (now() AT TIME ZONE 'UTC') FROM (VALUES ${values}) AS v(id, url)
      ON CONFLICT ("listingId") DO UPDATE SET url = EXCLUDED.url, "updatedAt" = EXCLUDED."updatedAt"
      WHERE "PartnerPurchaseLink".url IS DISTINCT FROM EXCLUDED.url
    `)
  }
  return written
}

/**
 * Move a pinned partner's PUBLIC links into the staff table — ONE statement, so nothing can land between the read and the
 * write (commit gate, codex 2026-11-14: a move that upserted a url read earlier could overwrite a fresher one the nightly
 * job had written). The public rows are locked (FOR UPDATE), nulled, and each one's url goes to the staff table ONLY if it
 * has no row there yet — a staff link already present is the newer one and is kept. A LIVE row's `updatedAt` moves (commit
 * gate, codex): the nightly job's 48-hour sweep (flushRecent) then re-purges its page even if every immediate purge failed,
 * so a cached page cannot keep the link. A hidden row keeps its `updatedAt` — its journaled rollback still matches (it is
 * not served, so nothing of it is cached). The restore/import undo windows close at the translate step anyway (RUNBOOK).
 * Returns the listing ids whose public link went NULL (their pages must be purged). Used by the nightly affiliate-prices job for every pinned seller — the "public column stays NULL" invariant
 * enforces itself — and by scripts/move-partner-purchase-links.ts for an immediate run.
 */
export async function movePublicLinksToStaff(
  dbc: { $queryRaw: <T>(q: Sql) => Promise<T> },
  sql: { sql: typeof Prisma.sql },
  sellerId: string,
  /** The move script's journaled snapshot: only these (id, url) pairs move, so the journal covers every row changed (codex). */
  only?: { ids: string[]; urls: string[] },
): Promise<string[]> {
  const snapshot = only
    ? sql.sql`AND (id, "affiliateUrl") IN (SELECT * FROM unnest(${only.ids}::text[], ${only.urls}::text[]))`
    : sql.sql``
  const rows = await dbc.$queryRaw<{ id: string }[]>(sql.sql`
    WITH old AS (
      SELECT id, "affiliateUrl" AS url FROM "Listing" WHERE "sellerId" = ${sellerId} AND "affiliateUrl" IS NOT NULL ${snapshot} FOR UPDATE
    ), staff AS (
      INSERT INTO "PartnerPurchaseLink" ("listingId", url, "updatedAt")
      SELECT old.id, old.url, (now() AT TIME ZONE 'UTC') FROM old
      ON CONFLICT ("listingId") DO NOTHING
    )
    UPDATE "Listing" l SET "affiliateUrl" = NULL,
      "updatedAt" = CASE WHEN l.status IN ('active', 'sold') THEN (now() AT TIME ZONE 'UTC') ELSE l."updatedAt" END
    FROM old WHERE l.id = old.id RETURNING l.id
  `)
  return rows.map((r) => r.id)
}
