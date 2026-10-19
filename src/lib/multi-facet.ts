/**
 * THE ONE READING OF A MULTI-SELECT FACET'S VALUE — `attr_amenities=no-landlord,car-alley` (GoPlus partnership, owner
 * 2026-10-19: "add more filter chips so they can search one with no landlord, with car access etc").
 *
 * ⛔ A MULTI FACET'S URL VALUE IS A LIST, AND EVERY READER MUST SPLIT IT THE SAME WAY. The feed and the saved-search
 * alert (attr-match.ts attrWhere), the chip counts (attrMatcher, facet-counts.ts), the Filter panel's toggles
 * (facet-bar.tsx), the explorer's URL round-trip (explorer-url.ts) and its active chips (listings-explorer.tsx) all call
 * these functions, so a value cannot mean "both amenities" to the grid and "neither" to the count beside the chip.
 *
 * THE RULES, each for a reason:
 *  · AND, NOT OR. A renter picking "No live-in landlord" and "Car access" wants a room with both — GoPlus's own
 *    amenity filter (`ti=a,b`) narrows the same way. OR would make every extra pick WIDEN the feed, which no chip row
 *    on this site does.
 *  · CANONICAL ORDER = TAXONOMY ORDER, deduplicated. `car-alley,no-landlord` and `no-landlord,car-alley` are one
 *    search, so they must be one URL, one memo key in facet-counts.ts and one saved-search row.
 *  · UNKNOWN PARTS ARE DROPPED, NEVER AN ERROR. A stale link (an option renamed), a hand-typed value or a saved search
 *    truncated by an older build keeps the parts that still mean something; a list with nothing left is NO FILTER —
 *    never a clause that matches nothing, which would empty the feed with no chip to explain it.
 *  · ONLY TAXONOMY VALUES, so a value can never smuggle a token delimiter into a `facetTokens` needle
 *    (attr-match.ts TOKENABLE has the same job for single facets).
 *
 * Client-safe on purpose: the Filter panel and the explorer import it.
 */
import { TAXONOMY } from '@/lib/taxonomy'
import { VIDEO_FACET_KEY, VIDEO_FACET_ON, videoFilterOn } from '@/lib/video-filter'

/** The separator inside a multi facet's value. A comma: URL-safe once encoded, and never inside a taxonomy slug. */
export const MULTI_SEP = ','

/** key → its option values in taxonomy order, for every facet declared `multi`. */
const MULTI_OPTIONS: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, string[]>()
  for (const c of TAXONOMY) {
    for (const f of c.facets) {
      if (!f.multi) continue
      // Two categories declaring the same multi key would share one URL param; the union keeps either's value valid.
      const prev = m.get(f.key) ?? []
      m.set(f.key, [...prev, ...f.options.map((o) => o.value).filter((v) => !prev.includes(v))])
    }
  }
  return m
})()

/** Whether `key` is a multi-select facet anywhere in the taxonomy. */
export function isMultiFacetKey(key: string): boolean {
  return MULTI_OPTIONS.has(key)
}

/**
 * The picked values of multi facet `key`, in canonical order: the comma list split, trimmed, deduplicated and filtered to
 * the taxonomy's options. Empty for a value with nothing valid in it, for `'all'`, and for a key that is not multi.
 */
export function multiFacetValues(key: string, raw: string | null | undefined): string[] {
  const options = MULTI_OPTIONS.get(key)
  if (!options || !raw) return []
  const picked = new Set(raw.split(MULTI_SEP).map((s) => s.trim()).filter(Boolean))
  return options.filter((o) => picked.has(o))
}

/** The canonical value for a set of picks of multi facet `key`, or null when none is valid (= no filter). */
export function multiFacetValue(key: string, values: Iterable<string>): string | null {
  const list = multiFacetValues(key, [...values].join(MULTI_SEP))
  return list.length ? list.join(MULTI_SEP) : null
}

/** `raw` with `value` added when absent, removed when present — the toggle a chip tap performs. Null = nothing left. */
export function toggleMultiFacetValue(key: string, raw: string | null | undefined, value: string): string | null {
  const now = multiFacetValues(key, raw)
  return multiFacetValue(key, now.includes(value) ? now.filter((v) => v !== value) : [...now, value])
}

/**
 * A filter value as the explorer keeps it: a multi facet's list canonicalised (null when nothing valid is left, so the
 * filter is dropped rather than kept as a chip that filters nothing), any other facet's value as given.
 */
export function canonicalFacetValue(key: string, raw: string): string | null {
  // ⚠️ "Has video" has ONE meaningful value, and anything else is NO FILTER in the feed (attr-match.ts) — so a stale or
  // hand-typed `attr_hasVideo=maybe` is dropped here too, never kept as a chip (or a saved alert) that filters nothing.
  if (key === VIDEO_FACET_KEY) return videoFilterOn(raw) ? VIDEO_FACET_ON : null
  return isMultiFacetKey(key) ? multiFacetValue(key, raw.split(MULTI_SEP)) : raw
}

/** `raw` with `value` taken out — IDEMPOTENT, unlike the toggle: an active chip's ✕ delivered twice must never put the
 *  pick back. Null = nothing left (no filter). */
export function removeMultiFacetValue(key: string, raw: string | null | undefined, value: string): string | null {
  return multiFacetValue(key, multiFacetValues(key, raw).filter((v) => v !== value))
}
