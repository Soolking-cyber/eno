// The listings console's filters — a plain module, so the server catalogue page can whitelist a deep link's values
// (an array exported from the 'use client' console would reach a server component as a client reference, not data).
export const LISTING_STATUS = [
  { v: 'all', label: 'All' }, { v: 'active', label: 'Active' }, { v: 'hidden', label: 'Hidden' }, { v: 'sold', label: 'Sold' },
  // Tombstones (src/lib/listing-removed.ts): kept as evidence, invisible everywhere else.
  { v: 'removed', label: 'Removed' },
]
export const LISTING_VERIFIED = [
  { v: 'all', label: 'Any' }, { v: 'true', label: 'Live' }, { v: 'false', label: 'Held' },
]
/** The values a deep link may open on (the Overview's "awaiting review" tile: Active + Held, its own count). */
export const LISTING_STATUS_FILTERS: readonly string[] = LISTING_STATUS.map((o) => o.v)
export const LISTING_VERIFIED_FILTERS: readonly string[] = LISTING_VERIFIED.map((o) => o.v)
