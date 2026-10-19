/**
 * The "Has video" (Có video) filter on apartment rentals — GoPlus partnership, owner 2026-10-19 ("also fetch videos
 * from available properties"; GoPlus's own browse has a "Có video" switch). Modelled on the Posted filter
 * (src/lib/posted-filter.ts), which is the precedent for a taxonomy facet that filters a COLUMN.
 *
 * ⚠️ A FACET IN THE TAXONOMY, A COLUMN ON THE SERVER. Declared as an ordinary one-option toggle (key `hasVideo`,
 * src/lib/taxonomy.ts) so the Filter panel, the active chips, the URL round-trip (`attr_hasVideo=yes`), saved searches and
 * the chip counts handle it with no new plumbing — but its value is never stored in `Listing.attributes`.
 * `attrWhere` (src/lib/attr-match.ts) turns it into `video IS NOT NULL` — the same clause as the video feed's
 * `hasVideo=1` (feed-query.ts), so "has a video" means one thing on the whole site.
 * ⚠️ COUNTED WITHOUT A QUERY OF ITS OWN. The attribute rails are classified in memory from ONE groupBy over
 * (attributes, facetTokens) (facet-counts.ts); that groupBy also counts each bucket's non-null `video`, which is exactly
 * this chip's number, and — while the filter is on — the weight every other chip is counted with. Posted needs its own
 * counts because a time window cannot be read off a non-null count; this can.
 * ⚠️ ONLY WHERE THE VIEW OFFERS IT (`videoOffered`) — a stale `attr_hasVideo=yes` on a view whose Filter panel has no
 * "Has video" control must not narrow a feed it gives no way to clear.
 */

import { facetsFor } from '@/lib/taxonomy'

/**
 * ⚠️ `hasVideo`, NOT `video`: the teachers category already owns a `video` facet ("Intro video", value `has-video`), a
 * TOKEN the teacher publish core writes (teachers/profile.ts) — the same key here would turn that filter into this
 * column clause on the teachers view. One key, one meaning, across the taxonomy.
 */
export const VIDEO_FACET_KEY = 'hasVideo'
/** The one option value (`attr_hasVideo=yes`). Anything else is no filter, never an error. */
export const VIDEO_FACET_ON = 'yes'

/** Whether the view (category, subcategory) offers the Has-video filter — the taxonomy is the one answer. */
export function videoOffered(category: string | null | undefined, subcategory: string | null | undefined): boolean {
  if (!category || category === 'all') return false
  return facetsFor(category, subcategory && subcategory !== 'all' ? subcategory : null).some((f) => f.key === VIDEO_FACET_KEY)
}

/** Whether `attr_hasVideo=<value>` asks for listings with a video. */
export function videoFilterOn(value: string | null | undefined): boolean {
  return value === VIDEO_FACET_ON
}
