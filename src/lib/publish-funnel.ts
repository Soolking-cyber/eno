import 'server-only'
import { db } from '@/lib/db'

// ── What happens when somebody taps Publish ───────────────────────────────────────
//
// One counter per (UTC day, outcome), on the `publish_funnel` table + `publish_log()`
// function in scripts/rate-limit-pg.mjs. Same shape and the same fail-open contract as
// trending.ts, which is the precedent this follows.
//
// ⚠️ WHY IT EXISTS. Until 2026-07-28 the post wizard emitted an analytics event ONLY on
// success (`trackPostListing`), so a refused listing left no trace anywhere. That made
// "the marketplace's problem is supply, not code" unfalsifiable — not wrong, unfalsifiable,
// because the data that could have tested it was never collected. Finding anything at all
// about this funnel took hand-written SQL against production.
//
// ⚠️ IT COUNTS, IT DOES NOT LOG. No user id, no listing id, no title, no free text — an
// aggregate counter cannot leak what it never held, and this table sits alongside the
// listings it describes. If you ever need "which seller hit photos_min", that is a
// different feature with a different privacy question; do not grow this one into it.
//
// ⚠️ EVERY CALL FAILS OPEN. A counter must never be able to turn a successful publish into
// an error, so the write is fire-and-forget and swallows everything. A dropped event beats
// a broken publish, exactly as analytics.ts puts it.

/** Bounded — the same 40 chars publish_log() clamps to. Keeps the counter from becoming a string sink. */
const MAX_OUTCOME_LEN = 40

// ⚠️ THE CLIENT-REPORTED CODES MOVED to lib/publish-funnel-codes.ts, and re-exporting them from
// here would defeat the point: this module is `import 'server-only'`, so anything routed through
// it is unreachable from post-wizard.tsx. Import them from publish-funnel-codes directly.

/**
 * The outcome label for a finished publish attempt, derived from the response the route is
 * about to return. PURE, so the mapping is testable without a database or a request.
 *
 * ⚠️ DERIVED FROM THE RESPONSE, NOT SPRINKLED THROUGH THE HANDLER. POST /api/listings has
 * eight or so exit points (rate limit, invalid input, contact-in-text, banned words, unknown
 * category, the seller resolver, the enforcement gate, PublishBlockedError, success). Calling
 * a recorder at each one guarantees the day someone adds a ninth and forgets — and a funnel
 * with a silently missing branch is worse than no funnel, because it reads as zero.
 *
 * `errorCode` is the `error` field the route already puts in its JSON body; it is a
 * server-authored constant in every branch, never client input.
 */
export function publishOutcome(status: number, errorCode?: unknown): string {
  if (status >= 200 && status < 300) return 'published'
  const code = typeof errorCode === 'string' ? errorCode.trim() : ''
  // An unlabelled failure is still a failure worth counting — bucketed by status so it
  // shows up as something to go and name, rather than vanishing.
  if (!code) return `http_${status}`
  return code.slice(0, MAX_OUTCOME_LEN)
}

/**
 * Bump today's counter. Fire-and-forget: callers need not await, and errors are swallowed.
 */
export async function recordPublishOutcome(outcome: string): Promise<void> {
  if (!outcome) return
  try {
    await db.$queryRaw`select publish_log(${outcome.slice(0, MAX_OUTCOME_LEN)})`
  } catch {
    /* fail-open: instrumentation must never surface an error to a publish */
  }
}
