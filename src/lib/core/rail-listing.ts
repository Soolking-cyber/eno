import type { SerializedListing } from '@/lib/types'

/** A home rail's listing: the full serialized row without its description, which no rail card reads. */
export type RailListing = Omit<SerializedListing, 'description' | 'descriptionVi'>

/**
 * The "Outstanding businesses" and "Trending" rails (business-rail.ts, trending-rail.ts) draw only <ListingCard>, and the
 * card never reads `description` or `descriptionVi` (home-rails.card-reads.test.tsx). Both still rode along: in the home
 * page's RSC props (EN and VI) and in /api/businesses/top and /api/recommendations, which share these loaders — ~22.5 KB
 * raw, ~9 KB br, 15% of the live home document (speed plan R20, 2026-11-10).
 * ⚠️ ONLY THESE TWO GO, NOT A SWITCH TO serializeListingCard: the card projection ADDS fields (`seller.chatOnlyPartner`,
 * `jobType`, `buildingKey`, `goodPrice`), and each one changes what a rail card shows. Every other field stays as it was.
 */
export function railListing(l: SerializedListing): RailListing {
  const { description: _description, descriptionVi: _descriptionVi, ...card } = l
  return card
}
