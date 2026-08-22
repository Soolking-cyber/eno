import 'server-only'
import { db } from '@/lib/db'
import { parsePageParams, pageQuery, buildPage } from '@/lib/api/pagination'

const DAY_MS = 86_400_000
const MAX_RANGE_DAYS = 92
const isoDay = (d: Date) => d.toISOString().slice(0, 10)

function parseDay(s: string | null | undefined): Date | null {
  if (!s) return null
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Per-listing daily views/leads (DELTAS) over a date range + current totals, keyset-paged
 * by listing. Shared by GET /api/v1/analytics/listings and the MCP analytics tool. Diffs
 * consecutive cumulative snapshots; a pre-`from` baseline seeds the first in-range delta,
 * and a first observation with no baseline reports 0 (a daily delta is unknown there).
 */
export async function getListingAnalytics(
  sellerId: string,
  opts: { from?: string; to?: string; limit?: string | number; cursor?: string } = {},
): Promise<{ range: { from: string; to: string }; listings: unknown[]; next_cursor: string | null } | { error: { code: string; message: string } }> {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0)
  const to = parseDay(opts.to) ?? today
  let from = parseDay(opts.from) ?? new Date(to.getTime() - 30 * DAY_MS)
  if (from.getTime() > to.getTime()) return { error: { code: 'invalid_input', message: '`from` must be on or before `to`.' } }
  if ((to.getTime() - from.getTime()) / DAY_MS > MAX_RANGE_DAYS) from = new Date(to.getTime() - MAX_RANGE_DAYS * DAY_MS)
  const baseline = new Date(from.getTime() - DAY_MS)

  const sp = new URLSearchParams()
  if (opts.limit != null) sp.set('limit', String(opts.limit))
  if (opts.cursor) sp.set('cursor', opts.cursor)
  const { limit, cursorId } = parsePageParams(sp)

  const rows = await db.listing.findMany({
    where: { sellerId },
    orderBy: { id: 'desc' },
    ...pageQuery(limit, cursorId),
    select: { id: true, title: true, status: true, views: true, contactCount: true, externalId: true },
  })
  const { items, nextCursor } = buildPage(rows, limit)
  const ids = items.map((l) => l.id)

  const stats = ids.length
    ? await db.listingDailyStat.findMany({
        where: { listingId: { in: ids }, day: { gte: baseline, lte: to } },
        orderBy: [{ listingId: 'asc' }, { day: 'asc' }],
        select: { listingId: true, day: true, views: true, leads: true },
      })
    : []

  const byListing = new Map<string, { day: Date; views: number; leads: number }[]>()
  for (const s of stats) {
    const arr = byListing.get(s.listingId) ?? []
    arr.push(s)
    byListing.set(s.listingId, arr)
  }
  const fromMs = from.getTime()
  const seriesFor = (listingId: string) => {
    const snaps = byListing.get(listingId) ?? []
    const out: { day: string; views: number; leads: number }[] = []
    for (let i = 0; i < snaps.length; i++) {
      const cur = snaps[i]
      if (cur.day.getTime() < fromMs) continue // baseline only
      const prev = snaps[i - 1]
      out.push({
        day: isoDay(cur.day),
        views: prev ? Math.max(0, cur.views - prev.views) : 0,
        leads: prev ? Math.max(0, cur.leads - prev.leads) : 0,
      })
    }
    return out
  }

  return {
    range: { from: isoDay(from), to: isoDay(to) },
    listings: items.map((l) => ({
      id: l.id,
      external_id: l.externalId,
      title: l.title,
      status: l.status,
      views_total: l.views,
      leads_total: l.contactCount,
      daily: seriesFor(l.id),
    })),
    next_cursor: nextCursor,
  }
}

// Per-listing daily analytics (Phase 3, partner API). Once a day the cron snapshots every
// live listing's CUMULATIVE views + leads (contactCount) into ListingDailyStat; the
// GET /api/v1/analytics/listings endpoint diffs consecutive snapshots into per-day deltas.
// One UPSERT covers the whole table. gen_random_uuid()::text fills the PK (Prisma's cuid
// default is app-side, so a raw INSERT must supply the id itself).
export async function rollupListingDailyStats(): Promise<number> {
  // ⛔ $executeRaw, NOT $executeRawUnsafe. The SQL is static today, so this is not a
  // live injection — it is the guarantee. `Unsafe` takes a plain string, so the day
  // someone adds a `${...}` here it concatenates silently and nothing complains; the
  // tagged template makes that same edit a parameterised bind instead. Keeping the
  // safe form costs nothing while the statement is static and costs everything later.
  return db.$executeRaw`
      INSERT INTO "ListingDailyStat" ("id", "listingId", "day", "views", "leads", "createdAt")
      SELECT gen_random_uuid()::text, "id", CURRENT_DATE, "views", "contactCount", now()
      FROM "Listing" WHERE "verified" = true AND "status" = 'active'
      ON CONFLICT ("listingId", "day") DO UPDATE SET "views" = EXCLUDED."views", "leads" = EXCLUDED."leads"
    `.catch(() => 0)
}
