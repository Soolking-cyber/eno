import { createHash, randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { kv } from '@/lib/ratelimit'
import { IS_SERVICES } from '@/lib/edition'
import { editionHiddenSellerIds } from '@/lib/edition-scope'
import { HEARTBEAT_MS, coarseUserAgent, type SiteStats } from '@/lib/site-stats-shared'

/**
 * The four numbers under the footer: how many people have ever been here, how many are here right
 * now, how many have an account, and how many of those opened a storefront.
 *
 * ⛔ THE VISITOR IS NEVER STORED, ONLY A DIGEST THAT EXPIRES. There is no cookie, no localStorage
 * and no identifier that outlives the day: a visitor is sha256(ip + user-agent + a salt that is
 * regenerated every UTC day and kept for 36h). Yesterday's digests cannot be recomputed once the
 * salt is gone, so the rows left behind cannot be joined back to a person or across days — which is
 * the property that makes this defensible under the PDPL filing rather than merely undocumented.
 * ⚠️ Do NOT "improve" the salt by deriving it from a stable secret. A fixed salt turns the digest
 * into a permanent pseudonymous ID for an IP/UA pair, which is the thing this design exists to
 * avoid.
 *
 * ⚠️ WHAT THIS NUMBER IS NOT, STATED PLAINLY, because both errors are inherent to the choice above
 * rather than bugs to be fixed later:
 *  · IT UNDER-COUNTS SHARED NETWORKS. A school, an office or a mobile carrier NAT puts hundreds of
 *    real people on one IP; with the same browser and platform they are ONE visitor to this. That
 *    is the direct cost of having no cookie, and in Vietnam — heavily carrier-NAT'd — it is not a
 *    small cost. The figure is a floor, not a census.
 *  · IT IS FORGEABLE, BOUNDEDLY. The identity is IP + a coarse browser shape, so one address can
 *    manufacture at most families x platforms (42) visits per day by varying a header. That is a
 *    deliberate ceiling rather than a defence: authenticating a decorative footer counter would
 *    cost more than the number is worth. Do not promote this figure into anything that matters
 *    (pricing, ad claims, investor reporting) without a real identity behind it.
 */

/** How recently someone must have been seen to count as here NOW. */
export const PRESENCE_WINDOW = '5 minutes'
// HEARTBEAT_MS and SiteStats live in site-stats-shared so the footer widget can read them without
// dragging node:crypto and Prisma into the browser bundle. Re-exported here so server callers have
// one import.
export { HEARTBEAT_MS, coarseUserAgent }
export type { SiteStats }
/** eno.vn and eno.forum share one database — every key is scoped or they pool each other's traffic. */
export const SITE_KEY = IS_SERVICES ? 'services' : 'marketplace'

let warned = false
const SALT_TTL_SEC = 60 * 60 * 36
const COUNTS_TTL_SEC = 60

/**
 * ⚠️ NX, so a burst of first-of-the-day requests cannot each mint a different salt and split the
 * day's visitors into several buckets. The loser of the race reads the winner's value back.
 * ⚠️ kv_store is UNLOGGED: an unclean shutdown truncates it and today's salt changes. The cost is
 * bounded and self-healing — some of today's visitors get counted a second time, once — which is
 * exactly why the durable totals do NOT live there.
 */
async function dailySalt(): Promise<string> {
  const key = `site-stats:salt:${new Date().toISOString().slice(0, 10)}`
  const fresh = randomBytes(32).toString('base64')
  const won = await kv.set(key, fresh, { nx: true, ex: SALT_TTL_SEC })
  if (won === 'OK') return fresh
  return (await kv.get<string>(key)) ?? fresh
}


/** Opaque, day-scoped, one-way. */
export async function visitorDigest(ip: string, userAgent: string): Promise<Buffer> {
  const salt = await dailySalt()
  return createHash('sha256').update(`${salt} ${ip} ${coarseUserAgent(userAgent)}`).digest()
}

/**
 * One statement: record the heartbeat, count today's visitor once, and read both numbers back.
 * See scripts/site-stats-ddl.mjs for why this is a function rather than three round trips.
 */
async function touch(digest: Buffer): Promise<{ visits: number; now: number }> {
  const rows = await db.$queryRaw<Array<{ visitors: bigint | number; now_count: number }>>`
    select * from site_touch(${SITE_KEY}, ${digest}, ${PRESENCE_WINDOW}::interval)`
  const r = rows[0]
  return { visits: Number(r?.visitors ?? 0), now: Number(r?.now_count ?? 0) }
}

/**
 * ⚠️ CACHED, because the footer is on every page and these are two COUNT(*)s over tables that
 * change a handful of times a day. 60s is far fresher than the numbers move.
 * ⚠️ `ownerId IS NOT NULL` is the honest seller count: a Seller row with no owner is a guest or
 * imported storefront (the affiliate catalogue is one), and counting those would report a shopfront
 * nobody signed up for as a member of the community.
 */
async function communityCounts(): Promise<{ members: number; sellers: number }> {
  // ⛔ SCOPED BY SITE_KEY, AND IT WAS NOT — THE ONE LEAK ALL THREE REVIEWERS FOUND INDEPENDENTLY.
  // kv_store lives in the single shared database, so an unscoped key means whichever edition
  // refills the 60s cache wins for BOTH: for up to a minute after any eno.forum heartbeat, eno.vn
  // would print the forum's seller count — the one that includes the visa/trip desk. The exclusion
  // three lines below was real and the cache in front of it handed the excluded number back.
  const cacheKey = `site-stats:community:${SITE_KEY}`
  const cached = await kv.get<{ members: number; sellers: number }>(cacheKey).catch(() => null)
  if (cached) return cached
  // ⛔ EDITION-SCOPED, AND edition-lint CAUGHT THIS RATHER THAN ME. The visa/trip desk is a Seller
  // row WITH an owner, so an unscoped count reports it as one of eno.vn's sellers — the licensed
  // marketplace publishing a headcount that includes a storefront it may not carry. It is only a
  // number, not a link, which is precisely why it would never have been noticed. Excluding whatever
  // this edition hides keeps the figure true on both: the desk counts on eno.forum and not here.
  const hidden = await editionHiddenSellerIds()
  const [members, sellers] = await Promise.all([
    db.profile.count(),
    db.seller.count({ where: { ownerId: { not: null }, id: { notIn: hidden } } }),
  ])
  const value = { members, sellers }
  await kv.set(cacheKey, value, { ex: COUNTS_TTL_SEC }).catch(() => {})
  return value
}

/**
 * ⚠️ FAILS OPEN TO ZEROS, never throws. This is decoration at the bottom of every page; a database
 * hiccup must not turn into a 500 on the page it decorates. The client renders nothing for a zero.
 */
export async function recordAndRead(ip: string, userAgent: string): Promise<SiteStats> {
  try {
    const digest = await visitorDigest(ip, userAgent)
    const [live, community] = await Promise.all([touch(digest), communityCounts()])
    return { ...live, ...community }
  } catch {
    // ⚠️ SAY SO ONCE. The whole feature depends on DDL that is applied by hand
    // (scripts/site-stats-ddl.mjs); without it every call lands here, the widget renders nothing,
    // and the footer looks intentionally quiet rather than broken. One line in the log is the
    // difference between "not deployed yet" and an afternoon of wondering.
    if (!warned) { warned = true; console.error('[site-stats] read failed — has scripts/site-stats-ddl.mjs been run on this database?') }
    return { visits: 0, now: 0, members: 0, sellers: 0 }
  }
}
