import 'server-only'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { CHANNELS, type ChannelResult } from './channels'
import type { PostInput } from './caption'

/**
 * THE DAILY POST — one listing per channel per run.
 *
 * ⚠️ THIS IS A DIFFERENT TRIGGER FROM `syndicateListing`, NOT A REPLACEMENT FOR IT. That one fires
 * once, when a listing is published (listings.ts). This one runs on a schedule and exists because a
 * marketplace that publishes nothing on a given day still needs a post that day — an empty feed is
 * the thing social algorithms punish. Both stay: publish-time is timely, daily is a floor.
 *
 * ⛔ ONE LISTING PER CHANNEL PER RUN, AND NEVER THE SAME LISTING TWICE ON A CHANNEL. Both halves are
 * enforced in `social_posts` (see scripts/social-ddl.mjs), not in this file — a filter in a query
 * is a race, a UNIQUE index is a decision.
 */

/** How far back a listing may be and still be worth posting. Older stock reads as a dead feed. */
const MAX_AGE_DAYS = 120

/**
 * How many listings to consider before giving up for the day.
 *
 * ⚠️ A WINDOW, NOT A SINGLE PICK — see the note in `pickFor`. It has to be big enough that a run of
 * photo-less listings cannot block a channel, and small enough that the query stays trivial. Every
 * candidate is already filtered to `status = 'active'` and inside MAX_AGE_DAYS.
 */
const CANDIDATE_WINDOW = 25

export type DailyReport = { channel: string; listingId: string | null; result: ChannelResult | null; error?: string }

/**
 * Pick the best not-yet-posted listing for one channel.
 *
 * ⚠️ NEWEST FIRST, WITH A PHOTO, AND ACTIVE — in that order of importance. A photo is not a nicety:
 * Instagram REFUSES a post without one, and on every other channel an image post materially
 * outperforms a link. Sorting newest-first means the daily post is the freshest thing not yet shown
 * on that channel, so the backlog drains in a sensible order rather than randomly.
 */
/**
 * ⛔ PRISMA FOR THE LISTING, RAW SQL ONLY FOR `social_posts`, AND THAT SPLIT IS A SCAR.
 *
 * The first version of this function was one hand-written SQL statement, and it was wrong in THREE
 * ways that tsc cannot see and the unit tests (which mock fetch, not the database) never touch:
 *   · `l.category` does not exist — the column is `categoryId`, a cuid FK;
 *   · `images` is a TEXT column holding a JSON array, so `array_length(images,1)` and `images[1]`
 *     are both type errors at runtime, not merely wrong values;
 *   · the category NAME lives on the joined `Category` row, not on Listing at all.
 * It would have failed on the first scheduled run, at 02:00, with nobody watching. Prisma knows the
 * schema; a template literal does not. Raw SQL survives only where Prisma cannot go — `social_posts`
 * is deliberately outside the schema (see scripts/social-ddl.mjs).
 */
async function postedListingIds(channel: string): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ listing_id: string }>>`
    select listing_id from social_posts where channel = ${channel}
  `
  return rows.map((r) => r.listing_id)
}

/**
 * Pick the best not-yet-posted listing for one channel.
 *
 * ⚠️ NEWEST FIRST, WITH A PHOTO, AND ACTIVE — in that order of importance. A photo is not a nicety:
 * Instagram REFUSES a post without one, and everywhere else an image post materially outperforms a
 * bare link. Newest-first means the daily post is the freshest thing that channel has not shown,
 * so a backlog drains in a sensible order instead of randomly.
 */
async function pickFor(channel: string): Promise<PostInput | null> {
  const already = await postedListingIds(channel)
  const since = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000)
  /**
   * ⛔ `scopedListingWhere`, NEVER A BARE PREDICATE — CAUGHT BY edition-lint, AND IT WAS A REAL LEAK.
   * The e-visa SKUs are ORDINARY `Listing` rows owned by one desk seller, so an unscoped read puts
   * them in scope here exactly as it would in the feed or the sitemap. The consequence is worse on
   * this path than on any of those: a licensed sàn TMĐT would have BROADCAST a visa service from its
   * own Facebook and LinkedIn Pages, on a schedule, to an audience — the most public possible form
   * of the thing the edition split exists to prevent.
   * ⚠️ It is `await`ed and SPREAD FIRST so my own keys cannot collide with it; spreading the scope
   * beside `sellerId` is the documented way to lose the exclusion silently.
   */
  const rows = await db.listing.findMany({
    where: await scopedListingWhere({ status: 'active', createdAt: { gt: since }, id: { notIn: already } }),
    orderBy: { createdAt: 'desc' },
    /**
     * ⛔ `findMany` + take, NOT `findFirst` — REVIEWER-CAUGHT DEADLOCK, AND IT WOULD HAVE BEEN
     * PERMANENT. The first version took the single newest listing and then returned null if it had
     * no usable image. Because a listing that is never posted is also never CLAIMED, the next run
     * picked the same one, and the next: ONE photo-less listing parked every channel for up to
     * MAX_AGE_DAYS. The daily poster would simply have stopped, silently, and the failure would
     * have looked like "no new listings" rather than a bug.
     * Scanning a window and taking the first USABLE candidate steps over it instead.
     */
    take: CANDIDATE_WINDOW,
    select: {
      id: true, title: true, price: true, currency: true, location: true, district: true,
      images: true, category: { select: { name: true } },
    },
  })
  for (const row of rows) {
    // `images` is a JSON string, never an array — see the note above. A malformed value skips this
    // candidate rather than throwing and killing the channel's run.
    let image: string | null = null
    try {
      const parsed: unknown = JSON.parse(row.images || '[]')
      if (Array.isArray(parsed) && typeof parsed[0] === 'string') image = parsed[0]
    } catch { image = null }
    if (!image) continue
    return {
      id: row.id, title: row.title, price: row.price, currency: row.currency,
      location: row.location, district: row.district, image,
      categoryName: row.category?.name ?? '',
    }
  }
  return null
}

/**
 * Claim a (listing, channel) pair BEFORE posting.
 *
 * ⛔ THE ORDER IS THE POINT AND IT IS COUNTER-INTUITIVE. Writing the row after a successful post is
 * what everyone writes first, and it is wrong here: a post that succeeds and then fails to record
 * goes out again tomorrow, and every day after, on a public Page. Claiming first means the worst
 * case is a listing silently skipped — invisible and harmless — instead of a repeating post that
 * looks like a bot and gets the account limited.
 *
 * Returns false when another run already holds the claim, which is exactly what the UNIQUE index is
 * for: `on conflict do nothing` makes two concurrent runs collapse into one post, in the database,
 * with no lock held by this process.
 */
async function claim(listingId: string, channel: string): Promise<boolean> {
  const n = await db.$executeRaw`
    insert into social_posts (listing_id, channel, status)
    values (${listingId}, ${channel}, 'posted')
    on conflict (listing_id, channel) do nothing
  `
  return n === 1
}

async function markFailed(listingId: string, channel: string) {
  // ⚠️ The row STAYS on failure, flipped to 'failed'. Deleting it would put the listing straight
  // back in tomorrow's queue, so a listing a platform structurally rejects (a banned word, an image
  // it will not fetch) would be retried daily forever. One attempt per listing per channel.
  await db.$executeRaw`
    update social_posts set status = 'failed'
     where listing_id = ${listingId} and channel = ${channel}
  `
}

/**
 * Run one daily pass over every configured channel.
 *
 * ⚠️ CHANNELS RUN INDEPENDENTLY AND NEVER SHARE A FAILURE. Four of the five cannot post until a
 * platform approves an app, so a rejection from one must not stop the others — and an unconfigured
 * channel returns `skipped: 'not_configured'` rather than throwing, so the daily log stays readable
 * while approvals land one at a time.
 */
export async function tableReady(): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ ok: boolean }>>`select to_regclass('public.social_posts') is not null as ok`
  return rows[0]?.ok === true
}

export async function runDailySocial(): Promise<DailyReport[]> {
  const out: DailyReport[] = []
  for (const [channel, post] of Object.entries(CHANNELS)) {
    let listing: PostInput | null = null
    try {
      listing = await pickFor(channel)
      if (!listing) { out.push({ channel, listingId: null, result: null, error: 'nothing_to_post' }); continue }
      if (!(await claim(listing.id, channel))) {
        out.push({ channel, listingId: listing.id, result: null, error: 'already_claimed' })
        continue
      }
      const result = await post(listing)
      // A channel with no credentials releases its claim: it never posted, and the listing must
      // stay available for the day the credentials arrive.
      if (result.skipped) {
        await db.$executeRaw`delete from social_posts where listing_id = ${listing.id} and channel = ${channel}`
        out.push({ channel, listingId: listing.id, result })
        continue
      }
      if (result.id) {
        await db.$executeRaw`update social_posts set external_id = ${result.id} where listing_id = ${listing.id} and channel = ${channel}`
      }
      out.push({ channel, listingId: listing.id, result })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (listing) await markFailed(listing.id, channel).catch(() => {})
      console.error(`[social:${channel}]`, message)
      out.push({ channel, listingId: listing?.id ?? null, result: null, error: message.slice(0, 200) })
    }
  }
  return out
}
