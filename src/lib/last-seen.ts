// Seller/profile presence — DAY-coarse, bucket-only, suppress-when-stale.
//
// Deliberately NOT 'server-only': the PDP is ISR with revalidate=30d, so a bucket
// computed on the server would freeze ("Active today" wrong for a month). Instead the
// server emits only a day-coarse date (dayCoarse) and the CLIENT computes the bucket
// at render time — a stale ISR page can then only UNDER-claim presence (the seller
// looks less recently active than truth), never over-claim. That asymmetry is the
// honesty contract; don't "fix" it by shipping the raw timestamp.
//
// Timezone: the day string is pinned to UTC on BOTH ends (toISOString slice on the
// server, an explicit Z suffix in the parse here) so every client agrees on the same
// calendar day. Vietnam being UTC+7 skews the floor toward "older" — again the
// under-claim direction.

export type LastSeenBucket = {
  key: 'today' | 'week' | 'month' | null
  en: string
  vi: string
}

const SUPPRESS: LastSeenBucket = { key: null, en: '', vi: '' }
const DAY_MS = 86_400_000

/** Full timestamp → UTC day string ('YYYY-MM-DD'), the ONLY presence shape that may
 *  leave the server. Null in → null out (never-seen profiles surface nothing). */
export function dayCoarse(at: Date | string | null | undefined): string | null {
  if (!at) return null
  const d = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

/**
 * Coarse presence label from a day-coarse date. >30 days (or null/garbage) →
 * key:null, render NOTHING — staleness is suppressed, never advertised.
 */
export function lastSeenBucket(day: string | null | undefined): LastSeenBucket {
  if (!day) return SUPPRESS
  const t = new Date(`${day}T00:00:00Z`).getTime()
  if (Number.isNaN(t)) return SUPPRESS
  const days = (Date.now() - t) / DAY_MS
  if (days < 1) return { key: 'today', en: 'Active today', vi: 'Hoạt động hôm nay' }
  if (days < 7) return { key: 'week', en: 'Active this week', vi: 'Hoạt động tuần này' }
  if (days < 30) return { key: 'month', en: 'Active this month', vi: 'Hoạt động tháng này' }
  return SUPPRESS
}
