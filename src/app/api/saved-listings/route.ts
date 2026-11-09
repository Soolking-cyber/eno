import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, route } from '@/lib/api/handler'
import { isMissingTable } from '@/lib/user-blocks'
import { SAVED_IDS_PER_WRITE, SAVED_LISTING_ID_RE, savedListingIds, writeSavedListings } from '@/lib/saved-listings'

/**
 * A SIGNED-IN PERSON'S SAVED LISTINGS (owner, 2026-11-09: "3 ok") — src/lib/saved-listings.ts holds the rules, and
 * src/lib/saved-sync.ts is the one caller.
 *
 * ⛔ NEVER CACHED: per-person answers carry `private, no-store` (the edge Worker never runs on /api/*, and this makes sure
 * no other cache keeps one either).
 * ⚠️ TOLERATES A DATABASE WITHOUT THE TABLE (scripts/saved-listings-ddl.mjs runs before the deploy, but a rollback or a
 * fresh restore can lack it): the GET answers `available: false` and the browser keeps saving on the device, as before;
 * a write answers 503 `saved_listings_unavailable`.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * `auth: 'userId'` — the token alone, no DB for the caller (this runs on every load of a signed-in tab).
 * ⛔ THE ANSWER NAMES ITS ACCOUNT (`uid`): the cookie is shared by every tab, so another tab's sign-in can change whose list
 * a request reads while it is in flight — the browser drops an answer for an account it did not ask about (commit review).
 */
export const GET = route({ auth: 'userId' }, async ({ userId }) => {
  try {
    return NextResponse.json({ uid: userId, ids: await savedListingIds(userId!) }, { headers: NO_STORE })
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ uid: userId, ids: [], available: false }, { headers: NO_STORE })
    throw e
  }
})

const ids = z.array(z.string().regex(SAVED_LISTING_ID_RE)).max(SAVED_IDS_PER_WRITE)
const bodySchema = z
  .object({
    /**
     * ⛔ THE ACCOUNT THE BROWSER MEANT (plan review, 2026-11-09). A write queued under one account must never land in another
     * — a sign-out and a sign-in can happen between the tap and the request, and the cookie then names the new account.
     */
    uid: z.string().uuid(),
    add: ids.optional(),
    remove: ids.optional(),
  })
  .refine((b) => (b.add?.length ?? 0) + (b.remove?.length ?? 0) > 0, { message: 'nothing to write' })
  .refine((b) => !b.add || !b.remove || !b.add.some((id) => b.remove!.includes(id)), { message: 'an id both added and removed' })

/** `auth: 'profile'` — provisions the Profile row the foreign key needs. Same-origin is the proxy's (every mutating /api/*). */
export const POST = route(
  { auth: 'profile', body: bodySchema, invalidBodyCode: 'invalid_body', rateLimit: { bucket: 'saved-listings', limit: 600, window: '1 h' } },
  async ({ profile, body }) => {
    if (body.uid !== profile!.id) throw new ApiError('account_changed', 409)
    let w: Awaited<ReturnType<typeof writeSavedListings>>
    try {
      w = await writeSavedListings(profile!.id, { add: body.add, remove: body.remove })
    } catch (e) {
      if (isMissingTable(e)) throw new ApiError('saved_listings_unavailable', 503)
      throw e
    }
    if (w.result === 'limit_reached') throw new ApiError('limit_reached', 409)
    // `notStored`: added ids this edition does not show (hidden, held, removed, unknown) — the browser puts those hearts back.
    return NextResponse.json({ ok: true, notStored: w.notStored }, { headers: NO_STORE })
  },
)
