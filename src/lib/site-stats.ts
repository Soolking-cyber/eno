import { createHash, randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { kv } from '@/lib/ratelimit'
import { IS_SERVICES } from '@/lib/edition'
import { scopedListingWhere } from '@/lib/edition-scope'
import { logError } from '@/lib/log'
import { HEARTBEAT_MS, coarseUserAgent, type SiteStats } from '@/lib/site-stats-shared'

/**
 * The four numbers under the footer: how many people have ever been here, how many are here right
 * now, how many people outside eno have an account, and how many storefronts are trading here.
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

/**
 * eno's own operational identities, excluded from the public member count. Edition-independent on
 * purpose — see the note in communityCounts().
 */
const ENO_STAFF_EMAILS = ['support@eno.vn', 'support@eno.forum'] as const
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
 * ⚠️ CACHED, because the footer is on every page and these are two aggregates over tables that
 * change a handful of times a day. 60s is far fresher than the numbers move.
 *
 * ⛔ THE SELLER COUNT IS "STOREFRONTS YOU CAN BROWSE HERE", NOT "ACCOUNTS THAT COULD SELL". It was
 * `ownerId IS NOT NULL` — an ownerless Seller row meant a guest or an imported catalogue, so the
 * reasoning went, and counting one would report a shopfront nobody signed up for. That was true
 * while the imported rows were a mock catalogue. It stopped being true, and the number went wrong
 * in BOTH directions at once (measured 2026-09-08):
 *   · It counted `sky` and `ENO COMPANY LIMITED`, which between them have ZERO listings — accounts
 *     with a login and no shop.
 *   · It excluded all 19 merchant storefronts, including HShop's 1,086 live listings and
 *     CellphoneS's 9,726, every one of them now an `officialPartner` with a real catalogue.
 * A visitor reading "5 sellers" under a marketplace showing twenty branded storefronts is being
 * told something plainly false, and the footer said 5 while /sellers listed 22.
 *
 * So the question the count asks is now the question the reader is asking: how many storefronts
 * have something I can actually see. `scopedListingWhere` is the SAME predicate the feed and the
 * product feeds use, so the figure cannot drift from what the site shows, and the edition boundary
 * comes along for free — the desk counts on eno.forum and not on eno.vn, which is what the old
 * `editionHiddenSellerIds` call was there for.
 *
 * ⚠️ THE TWO `eno Support` ROWS STAY OUT, AND NOT BY ACCIDENT. src/lib/support-thread.ts keeps them
 * `ownerId = null` EXPLICITLY so they miss this count; that reasoning no longer applies, but they
 * have no listings either, so the new rule excludes them for a reason that will not rot. Read that
 * file's note before giving them one.
 */
async function communityCounts(): Promise<{ members: number; sellers: number }> {
  // ⛔ SCOPED BY SITE_KEY, AND IT WAS NOT — THE ONE LEAK ALL THREE REVIEWERS FOUND INDEPENDENTLY.
  // kv_store lives in the single shared database, so an unscoped key means whichever edition
  // refills the 60s cache wins for BOTH: for up to a minute after any eno.forum heartbeat, eno.vn
  // would print the forum's seller count — the one that includes the visa/trip desk. The exclusion
  // three lines below was real and the cache in front of it handed the excluded number back.
  const cacheKey = `site-stats:community:${SITE_KEY}`
  // ⚠️ A cache miss is fine and a cache FAULT is not the same thing — the read still falls through
  // to the real counts either way, but a kv_store that has started failing should be visible rather
  // than showing up as a permanently cold cache nobody investigates.
  const cached = await kv
    .get<{ members: number; sellers: number }>(cacheKey)
    .catch((e) => { logError(e, { op: 'site-stats.cache-read' }); return null })
  if (cached) return cached
  // ⛔ EDITION-SCOPED, AND edition-lint CAUGHT THIS RATHER THAN ME. The visa/trip desk is a Seller
  // row WITH an owner, so an unscoped count reports it as one of eno.vn's sellers — the licensed
  // marketplace publishing a headcount that includes a storefront it may not carry. It is only a
  // number, not a link, which is precisely why it would never have been noticed. Excluding whatever
  // this edition hides keeps the figure true on both: the desk counts on eno.forum and not here.
  // groupBy, not findMany+distinct: the DISTINCT happens in Postgres, so this stays one aggregate
  // instead of dragging ~19k listing rows into the process to deduplicate them here.
  /**
   * ⛔ eno'S OWN STAFF ACCOUNTS ARE NOT COMMUNITY MEMBERS. This was a bare `profile.count()`, and
   * MEASURED 2026-09-08 two of the thirteen it reported are `support@eno.vn` and
   * `support@eno.forum` — the addresses that operate the site and own eno's own storefronts. A
   * public "13 members" that is really eleven members and two operators overstates the community
   * by the exact accounts with the least right to be counted in it.
   *
   * ⛔ AND THE LIST IS A CONSTANT HERE, NOT `ADMIN_EMAILS`. Reusing the admin gate's allowlist was
   * the obvious move and it is wrong twice over: ADMIN_EMAILS is a PER-CONTAINER secret
   * (`eno-root-env` vs the services env), so the two editions would exclude different sets and
   * print different member counts off ONE shared Profile table — and the box is recorded as
   * carrying `support@eno.forum` ALONE, which would leave `support@eno.vn` counted as a member of
   * the community it administers. Who eno's own staff are is a fact about the business, identical
   * on both editions and not something a deployment secret should be able to change; whether a
   * session may reach the admin console is a different question with a different answer.
   *
   * ⚠️ DELIBERATELY NOT EDITION-SCOPED, unlike the seller count beside it. A Profile is ONE
   * identity across eno.vn and eno.forum by design — there is no such thing as a member of one
   * edition — so both footers report the same figure. The constant above is what MAKES that true.
   *
   * ⛔ `OR email IS NULL`, AND IT IS NOT DEFENSIVE PADDING. SQL `NOT IN` is three-valued: a NULL
   * email is neither in the list nor out of it, so a bare `notIn` drops every phone-only member on
   * top of the two staff accounts. Reproduced against this repo's own Prisma client on a scratch
   * database — 2 staff + 2 real + 2 NULL-email rows returned 2, not 4. `Profile.email` is nullable
   * and live code writes NULL into it (profile.ts writes `user.email ?? null`; the WhatsApp bridge
   * creates a phone-only profile with no email key at all), so this is a silent undercount waiting
   * for the first phone-only signup — and a counter that fails to move reads as normal.
   */
  const [members, sellers] = await Promise.all([
    db.profile.count({ where: { OR: [{ email: null }, { email: { notIn: [...ENO_STAFF_EMAILS] } }] } }),
    /**
     * ⚠️ `some`, NOT A groupBy OVER Listing. Both answer "how many storefronts have something a
     * visitor can see here" and both returned 22, but the shapes are not close: the aggregate is a
     * sequential scan of every listing to produce one integer (63.8ms, 4,903 buffers, MEASURED),
     * while this is a semi-join that stops at each seller's FIRST live listing on an index already
     * present (1.5ms, 129 buffers). Behind a 60s cache the aggregate would have been survivable
     * right up until a cache miss under load ran it concurrently — and the catalogue only grows.
     */
    db.seller.count({ where: { listings: { some: await scopedListingWhere({ verified: true, status: 'active' }) } } }),
  ])
  const value = { members, sellers }
  await kv.set(cacheKey, value, { ex: COUNTS_TTL_SEC }).catch((e) => logError(e, { op: 'site-stats.cache-write' }))
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
