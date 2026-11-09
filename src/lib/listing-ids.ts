/**
 * The `GET /api/listings?ids=` contract, in a file with NO server imports so the client that has
 * to honour it can read the same number the route enforces.
 *
 * ⛔ ONE REQUEST ANSWERS AT MOST THIS MANY IDS, AND THE ANSWER SAYS WHICH ONES. The route used to
 * truncate a longer list silently, and FavoritesContext reads "requested but not returned" as
 * "deleted" — so the 201st saved listing on a device was erased from the device on the next visit
 * to /saved, with a 200 OK and nothing to see. A caller with more ids than this MUST chunk, and
 * must prune only ids the response reports as `evaluated`.
 */
export const IDS_FAST_PATH_MAX = 200

/**
 * The statuses a SAVED id is kept in: live, or ended through its own lifecycle (sold; the apartment rules' expired /
 * stale). Anything else — hidden, removed — is `gone`. One list for the public saved-ids path (feed-query.ts) and the
 * account's saved list (src/lib/saved-listings.ts), so an account never keeps what the device would prune.
 */
export const SAVED_KEEPABLE_STATUSES = ['active', 'sold', 'expired', 'stale'] as const

/** The most ids one write to /api/saved-listings may name — a device's saves move to the account in chunks of this. */
export const SAVED_IDS_PER_WRITE = 200
/** What a listing id may look like on that wire (cuid today) — anything else is refused before a query sees it. */
export const SAVED_LISTING_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** Split `ids` into request-sized batches, preserving order. */
export function chunkListingIds(ids: string[], size = IDS_FAST_PATH_MAX): string[][] {
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size))
  return out
}
