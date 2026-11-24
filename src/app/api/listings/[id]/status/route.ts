import { NextRequest, NextResponse } from 'next/server'
import { checkListingOwner } from '@/lib/listing-owner'
import { setStatusCore } from '@/lib/core/listings'
import { isIdentityBlockCode, publishBlockedJson, PUBLISH_BLOCKED_STATUS } from '@/lib/compliance/publish-block-response'
import { LICENCE_CHECK_REQUIRED_COPY } from '@/lib/licence-check-copy'
import { isJobTextBlockCode } from '@/lib/publish-guard'
import { JOB_TEXT_REFUSAL } from '@/lib/job-listing'
import { REVIEW_SEAT_LISTING_COPY } from '@/lib/review-seat-accounts'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { LICENCE_HELD_NOTE } from '@/lib/licence-stamp'
import { isListingViewable } from '@/app/[lang]/listings/[id]/(pdp)/get-listing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A seller sets the availability of their OWN listing: 'active' (live),
// 'sold' or 'hidden' (pulled from the public feed, kept in the dashboard).
// auth → core → respond (the core is shared with the future /api/v1).
//
// ⚠️ WS6 — NOT MIGRATED. Authorization is `checkListingOwner()`, which resolves the caller itself
// (`getCurrentProfile()`) and answers FOUR outcomes — 401 auth_required · 403 no_storefront ·
// 404 not_found · 403 forbidden. `auth: 'profile'` reproduces only the 401 and would call
// `getCurrentProfile()` a second time (an extra auth-server round-trip + an extra Profile read)
// on every mark-sold/hide tap, for no change on the wire; `auth: 'public'` leaves all four
// options empty, which is churn. See the long note in ../route.ts for the one-parameter unlock
// in src/lib/listing-owner.ts (shared with confirm/ and buyers/, so not touched from here).
//
// No `body:` schema either, independently of auth: malformed JSON answers `{"error":"Invalid
// body"}`, which is not an ApiErrorCode and so cannot be an `invalidBodyCode`; and `String(body
// .status || '')` accepts a number or null where zod would 400. `setStatusCore` also returns
// `invalid_status` through `r.error`, a code absent from the ApiErrorCode union.
/** What the listing page's 404 tells its OWNER (GET below). */
export type OwnListingState = 'pending' | 'held' | 'hidden' | 'off' | 'live' | 'sold'

/**
 * GET — THE OWNER'S VIEW OF A LISTING THE PUBLIC PAGE WILL NOT SHOW (owner, 2026-11-24, from the iOS app: "when i click on
 * products … this page has moved on … it was my uploaded product clicked through my listings, same in teacher job links").
 * The listing page renders only verified active/sold rows, for everyone and from cache (page.tsx), so a seller opening their
 * own pending, held or hidden listing — from My listings, the step after posting, a notification — got "This page has moved
 * on." (nginx 2026-11-24: 27 such 404s from /dashboard/listings, 3 from /post). The 404 page asks this route from the browser
 * and, for the owner only, says why the listing is not public and links Edit / My listings (not-found-body.tsx).
 * Refusals: 401 signed out, 404 for everything else (not yours, no shop, gone); no-store — it is one person's view.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const noStore = { 'Cache-Control': 'private, no-store' }
  const auth = await checkListingOwner(id)
  // Signed out stays 401. Every other refusal — not your listing, no shop, no such listing — is the same 404, so this read
  // (asked from every signed-in listing 404) cannot be used to learn whether someone else's hidden listing exists.
  if (!auth.ok) {
    return auth.code === 401
      ? NextResponse.json({ error: auth.error }, { status: 401, headers: noStore })
      : NextResponse.json({ error: 'not_found' }, { status: 404, headers: noStore })
  }
  const row = await db.listing.findFirst({
    where: await scopedListingWhere({ id }, { teachers: true }),
    select: { status: true, verified: true, identityHold: true, verificationNotes: true },
  })
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: noStore })
  const held = row.identityHold || row.verificationNotes === LICENCE_HELD_NOTE
  // `live` only when the listing page's own rule says so (isListingViewable, the same cached read the page makes), never a
  // second copy of it here: a row that looks public by these columns but fails the page's rule reads `off`.
  const state: OwnListingState =
    row.status === 'hidden' ? 'hidden'
      : row.status === 'sold' ? 'sold'
        : row.status !== 'active' ? 'off'
          : held ? 'held'
            : !row.verified ? 'pending'
              : (await isListingViewable(id)) ? 'live' : 'off'
  return NextResponse.json({ state }, { headers: noStore })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await checkListingOwner(id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.code })

  let body: { status?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const r = await setStatusCore(id, String(body.status || ''))
  // A relist the identity gate refused (gate on only): the structured 403, `error` still the code.
  if (!r.ok && isIdentityBlockCode(r.error)) return NextResponse.json(publishBlockedJson(r.error), { status: PUBLISH_BLOCKED_STATUS })
  // A relist of an e-Visa / Legal & permits listing eno has not checked (409, 2026-10-14) carries its bilingual sentence
  // for the native dashboards, which call this same route; so does a relist of a hiring post whose stored text the job-text
  // screen refuses (400, 2026-10-19), with `detail` '<field>:<snippet>' — the words to take out in the editor first; and so
  // does a relist of a store-review seat's listing (403 review_seat_listing, round 5 — review-seat-accounts.ts).
  if (!r.ok) {
    return NextResponse.json({
      error: r.error,
      ...(r.detail ? { detail: r.detail } : {}),
      ...(r.error === 'licence_check_required' ? { message: LICENCE_CHECK_REQUIRED_COPY }
        : r.error === 'review_seat_listing' ? { message: REVIEW_SEAT_LISTING_COPY }
          : isJobTextBlockCode(r.error) ? { message: JOB_TEXT_REFUSAL[r.error] } : {}),
    }, { status: r.code })
  }
  return NextResponse.json({ ok: true, status: r.status })
}
