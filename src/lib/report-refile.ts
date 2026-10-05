/**
 * THE REFILE COOLDOWN — shared by every report surface: POST /api/report (listing, chat, storefront) and
 * the content reports of src/lib/reported-content.ts (review, help comment, help post). Moved here from
 * src/app/api/report/route.ts, which re-exports it unchanged, so the two paths cannot drift apart.
 *
 * How long a REJECTED report suppresses another against the same surface by the same
 * reporter. 24h is long enough to break a withdraw-refile loop (the reachable abuse
 * is minutes, not days) and short enough that a genuine second incident the next day
 * still gets through.
 */
export const REFILE_COOLDOWN_MS = 24 * 60 * 60 * 1000

/** Statuses that mean the report was REJECTED. `confirmed` is deliberately absent. */
export const REFILE_COOLDOWN_STATUSES = ['dismissed', 'abusive'] as const

/**
 * True while a rejected report still suppresses a refile against the same surface.
 *
 * ⚠️ TAKES THE LATEST SETTLED TIME, NOT THE LATEST CREATED ROW. The first version
 * ordered by createdAt and measured resolvedAt, so a case filed two days ago and
 * dismissed a minute ago lost to a newer row dismissed last week — the cooldown
 * silently did nothing. All three reviewers found it independently.
 */
export function refileSuppressed(
  rows: { resolvedAt: Date | null; createdAt: Date }[],
  now: number = Date.now(),
): boolean {
  // resolvedAt is nullable on rows predating it; createdAt is the conservative
  // fallback, never later than resolution, so the window can only come out shorter.
  const settled = rows.map((r) => (r.resolvedAt ?? r.createdAt).getTime())
  if (settled.length === 0) return false
  return now - Math.max(...settled) < REFILE_COOLDOWN_MS
}
