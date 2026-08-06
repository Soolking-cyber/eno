import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { postingGate } from '@/lib/enforcement'
import { rateLimit } from '@/lib/ratelimit'
import { bulkImportCore, BULK_MAX_ROWS, type BulkRow } from '@/lib/core/bulk'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Bulk listing upload (business tier). Each row is RE-VALIDATED server-side; image URLs
// are re-hosted; listings are created under the caller's OWN storefront with the same
// auto-publish gate as single posts. auth → core → respond (the import logic is the
// shared bulkImportCore, reused by the future /api/v1/listings/bulk).
//
// ⚠️ WS6 MIGRATION — AUTH PREAMBLE ONLY. `auth: 'profile'` because the tier check reads the Profile
// ROW (`accountType !== 'business'`), which `getCurrentProfileId()` cannot answer; this is the same
// getCurrentProfile() the old code called, not an upgrade.
//
// ⚠️ THE LIMITER IS DELIBERATELY NOT `rateLimit:` ON THE WRAPPER. route() rate-limits straight after
// auth, which would put it ABOVE the `business_only` check — a personal-tier caller would then start
// consuming the bucket and eventually see 429 instead of the 403 they get today. The strict/fail-closed
// reasoning below is unchanged and still belongs where it is.
//
// ⚠️ TWO BODIES CANNOT GO THROUGH ApiError AND ARE RETURNED RAW: the enforcement `gate` object
// carries its own fields (`limit` on probation_listing_cap), `too_many_rows` carries `max`, and
// `Invalid body` is not an ApiErrorCode at all (errors.ts is not mine to extend). Returning the
// NextResponse keeps every byte the wizard already branches on — bulk-upload-panel.tsx tests
// `d.error === 'business_only'` and reads `max`.
//
// ⚠️ ONE BRANCH IS NOT BYTE-IDENTICAL: bulkImportCore() and the DB reads have no try/catch, so a
// throw used to surface as Next's default 500. route() catches it and answers
// {"error":"internal_error"} 500 instead. Accepted improvement, called out because it is a change.
export const POST = route({ auth: 'profile' }, async ({ req, profile }) => {
  if (profile.accountType !== 'business') throw new ApiError('business_only', 403)

  // Rate-limit by account. Fail OPEN — an authenticated, accountable business shouldn't
  // be blocked from importing on a Redis blip; the cap only stops a runaway loop / abuse.
  // ⚠️ strict: FAIL CLOSED. Each row fans out to paid third parties (moderation, translation,
  // embedding) and does an outbound rehost() of a caller-supplied image URL, x200 rows x unbounded
  // requests if rl_check errors. A batch importer is a deliberate, retryable back-office action —
  // a 429 during a limiter outage costs one retry; the open version costs a bill.
  const rl = await rateLimit('bulk-import', profile.id, 10, '1 h', { strict: true })
  if (!rl.success) throw new ApiError('rate_limited', 429)

  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true, ownerId: true, trustTier: true, trustScore: true } })
  if (!seller) throw new ApiError('no_storefront', 403)

  // Enforcement ladder — same gate as single-listing POST (stable codes the wizard
  // already maps: account_held | account_suspended | probation_listing_cap). Without
  // it, a scam-held/suspended seller could mass-restore their pulled catalog through
  // bulk import, defeating the exact scenario the ladder exists for (audit P0 #3).
  const gate = await postingGate(profile.id, seller.id)
  if (gate) return NextResponse.json(gate, { status: 403 })

  let body: { rows?: BulkRow[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, BULK_MAX_ROWS) : []
  if (rows.length === 0) throw new ApiError('no_rows', 400)
  if (Array.isArray(body.rows) && body.rows.length > BULK_MAX_ROWS) {
    // Surface the cap rather than silently dropping the tail.
    return NextResponse.json({ error: 'too_many_rows', max: BULK_MAX_ROWS }, { status: 400 })
  }

  return await bulkImportCore(seller, rows)
})
