import { vietnameseWordShare } from '@/lib/detect-lang'

/**
 * THE VIETNAMESE HUB OPENS ON VIETNAMESE TITLES (OpenSEO audit 2026-11-26, Reach finding #4: /thue-xe-may-tphcm opened on
 * "🛵 MOTORBIKE RENTAL IN SAIGON – ONLY 100,000 VND / DAY!", an English all-caps title, above 21 bikes titled in Vietnamese).
 *
 * A STABLE PARTITION OF THE SAME CARDS, NOT A NEW ORDER: the hub reads the explorer's own order (vehicle-hubs.ts, rankScore) so it
 * and "See all" open on the same set, and that holds — the same rows, each half still in rank order, only the Vietnamese-titled
 * half first. A title counts as Vietnamese when the row has an authored `titleVi` (what the card shows on /vi), or when at least a
 * fifth of its words carry a Vietnamese mark (VI_SHARE). Not `looksVietnamese`: that is the translator's strict test, and "Cho thuê
 * xe máy Honda ADV 160 (2026)" fails it on the model name's unmarked run. Measured on the live hub: the Vietnamese titles score
 * 0.23–0.33, the English one 0 — and not "> 0", so an English all-caps ad cannot jump the queue by naming "SÀI GÒN" (commit gate).
 * ⚠️ THE FIRST PAGE ONLY, ON PURPOSE: it is what the server renders and a crawler reads. "Show more" pages by offset over the
 * same set and dedupes by id (seller-listings.tsx), so nothing repeats or goes missing; the rows it appends keep rank order.
 * `featured`, the one rank input not earned, is admin-set and on none of the hub's rows today.
 */
const VI_SHARE = 0.2
export function vietnameseTitlesFirst<T extends { title: string; titleVi?: string | null }>(listings: readonly T[]): T[] {
  const vi = (l: T) => !!l.titleVi?.trim() || vietnameseWordShare(l.title) >= VI_SHARE
  return [...listings.filter(vi), ...listings.filter((l) => !vi(l))]
}
