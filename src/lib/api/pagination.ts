import 'server-only'

// Keyset (cursor) pagination for /api/v1 list endpoints. Stable + O(1)-per-page (no
// OFFSET scan): order by a deterministic key with a unique tiebreaker (id), page with a
// Prisma cursor. The opaque `cursor` is just the last item's id, base64url-wrapped.

export const PAGE_DEFAULT = 50
export const PAGE_MAX = 100

export function parsePageParams(searchParams: URLSearchParams): { limit: number; cursorId: string | null } {
  const reqLimit = parseInt(searchParams.get('limit') || '', 10)
  const limit = Number.isFinite(reqLimit) ? Math.min(Math.max(reqLimit, 1), PAGE_MAX) : PAGE_DEFAULT
  const cursor = searchParams.get('cursor')
  let cursorId: string | null = null
  if (cursor) {
    try { cursorId = Buffer.from(cursor, 'base64url').toString('utf8') || null } catch { cursorId = null }
  }
  return { limit, cursorId }
}

// Prisma fragment for cursor paging: fetch limit+1 to detect "has more" without a count.
export function pageQuery(limit: number, cursorId: string | null): { take: number; cursor?: { id: string }; skip?: number } {
  return cursorId ? { take: limit + 1, cursor: { id: cursorId }, skip: 1 } : { take: limit + 1 }
}

// Trim the limit+1 result to `limit` and emit the opaque next_cursor (null = last page).
export function buildPage<T extends { id: string }>(rows: T[], limit: number): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]
  return { items, nextCursor: hasMore && last ? Buffer.from(last.id, 'utf8').toString('base64url') : null }
}
