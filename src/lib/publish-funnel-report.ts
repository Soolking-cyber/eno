// Turning the raw publish_funnel counters into the numbers the admin page shows.
// PURE — no React, no database — so the arithmetic that a human will act on is unit-tested
// rather than eyeballed. src/app/admin/funnel/page.tsx is the renderer.

/** One grouped row as the page's SQL returns it. */
export type PublishFunnelRow = { outcome: string; total: number }

export type PublishFunnelReport = {
  attempts: number
  published: number
  refused: number
  /** Whole-percent share of attempts that became a live listing. */
  successRate: number
  /** Refusal reasons, biggest first, each with its share OF REFUSALS. */
  reasons: { outcome: string; total: number; share: number }[]
}

/**
 * ⚠️ SHARE IS OF REFUSALS, NOT OF ATTEMPTS, and the distinction is the whole point of the
 * table. "photos_min is 60% of refusals" tells you which rule to go and look at; "photos_min
 * is 6% of attempts" buries it next to a healthy success rate. The success rate above is the
 * number that is a share of attempts, and it is labelled as such on the page.
 */
export function summarisePublishFunnel(rows: readonly PublishFunnelRow[]): PublishFunnelReport {
  // Defensive: the counter is written by a fail-open path, so a malformed or negative row is
  // possible in principle and must not produce NaN on an operator's screen.
  const clean = rows
    .filter((r) => typeof r.outcome === 'string' && r.outcome.length > 0)
    .map((r) => ({ outcome: r.outcome, total: Number.isFinite(r.total) && r.total > 0 ? Math.trunc(r.total) : 0 }))
    .filter((r) => r.total > 0)

  const published = clean.find((r) => r.outcome === 'published')?.total ?? 0
  const refusals = clean.filter((r) => r.outcome !== 'published')
  const refused = refusals.reduce((sum, r) => sum + r.total, 0)
  const attempts = published + refused

  return {
    attempts,
    published,
    refused,
    successRate: attempts === 0 ? 0 : Math.round((published / attempts) * 100),
    reasons: refusals
      .slice()
      .sort((a, b) => b.total - a.total || a.outcome.localeCompare(b.outcome))
      .map((r) => ({ ...r, share: refused === 0 ? 0 : Math.round((r.total / refused) * 100) })),
  }
}

/**
 * Operator-facing wording for each outcome code. A code with no entry falls back to the raw
 * string, which is why the page also prints the code itself underneath — a new refusal reason
 * shows up as an unfamiliar label rather than disappearing.
 */
export const PUBLISH_OUTCOME_COPY: Record<string, string> = {
  rate_limited: 'Hit the posting rate limit',
  invalid_input: 'Missing or malformed required fields',
  unknown_category: 'Category did not exist',
  contact_in_text: 'Phone / email / link in the title or description',
  contact_in_name: 'Phone / email / link in the seller name',
  banned_words: 'Contained a banned word',
  photo_required: 'No photo at all',
  photos_min: 'Not enough DIFFERENT-ANGLE photos',
  duplicate_listing: 'Duplicate of a listing already live',
  account_restricted: 'Account restricted by the trust gate',
  location_required: 'No location set',
  // ⚠️ These four come from branches OUTSIDE publish-guard — resolve-seller.ts and the
  // enforcement gate in enforcement.ts. A reviewer's privacy challenge sent me to read every
  // remaining branch of the route, which is how they were found missing: they would have shown
  // up on the page as bare codes. (That audit also confirmed the privacy claim: every `error`
  // value in every branch is a server-authored constant. The only place user data appears is
  // `detail`, which publishOutcome deliberately never reads.)
  phone_taken: 'Phone number already claimed by another account',
  account_suspended: 'Account suspended',
  account_held: 'Account on hold',
  probation_listing_cap: 'New account hit its active-listing cap',
  exception: 'Server threw before it could answer',
  'Failed to create listing': 'Unhandled server error',

  // ⚠️ THE CLIENT HALF — a Publish tap that never reached the server. These are the five early
  // returns in post-wizard.tsx's submit(), and they are almost certainly the BIGGEST branch of
  // this funnel, because a form bounces people long before a request does. Labelled "Tapped
  // Publish…" so an operator can tell at a glance which side of the network a refusal happened on.
  client_missing_fields: 'Tapped Publish with required fields still empty',
  client_contact_in_name: 'Tapped Publish — contact info in their seller name',
  client_contact_in_text: 'Tapped Publish — contact info in the title or description',
  client_banned_words: 'Tapped Publish — banned word in the listing',
  // ⚠️ READ THIS ONE FIRST. The form was complete and VALID and we asked for an account. A high
  // number here means the listing flow works and account creation is the wall; a low one means
  // people never get that far. Opposite problems, opposite fixes.
  client_signin_required: 'Reached Publish with a valid listing, then hit the sign-in wall',
}
