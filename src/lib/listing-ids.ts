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

/** Split `ids` into request-sized batches, preserving order. */
export function chunkListingIds(ids: string[], size = IDS_FAST_PATH_MAX): string[][] {
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size))
  return out
}
