import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { postingGate } from '@/lib/enforcement'
import { rateLimit } from '@/lib/ratelimit'
import { bulkImportCore, BULK_MAX_ROWS, type BulkRow } from '@/lib/core/bulk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Bulk listing upload (business tier). Each row is RE-VALIDATED server-side; image URLs
// are re-hosted; listings are created under the caller's OWN storefront with the same
// auto-publish gate as single posts. auth → core → respond (the import logic is the
// shared bulkImportCore, reused by the future /api/v1/listings/bulk).
export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })
  if (profile.accountType !== 'business') return NextResponse.json({ error: 'business_only' }, { status: 403 })

  // Rate-limit by account. Fail OPEN — an authenticated, accountable business shouldn't
  // be blocked from importing on a Redis blip; the cap only stops a runaway loop / abuse.
  // ⚠️ strict: FAIL CLOSED. Each row fans out to paid third parties (moderation, translation,
  // embedding) and does an outbound rehost() of a caller-supplied image URL, x200 rows x unbounded
  // requests if rl_check errors. A batch importer is a deliberate, retryable back-office action —
  // a 429 during a limiter outage costs one retry; the open version costs a bill.
  const rl = await rateLimit('bulk-import', profile.id, 10, '1 h', { strict: true })
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const seller = await db.seller.findUnique({ where: { ownerId: profile.id }, select: { id: true, ownerId: true, trustTier: true, trustScore: true } })
  if (!seller) return NextResponse.json({ error: 'no_storefront' }, { status: 403 })

  // Enforcement ladder — same gate as single-listing POST (stable codes the wizard
  // already maps: account_held | account_suspended | probation_listing_cap). Without
  // it, a scam-held/suspended seller could mass-restore their pulled catalog through
  // bulk import, defeating the exact scenario the ladder exists for (audit P0 #3).
  const gate = await postingGate(profile.id, seller.id)
  if (gate) return NextResponse.json(gate, { status: 403 })

  let body: { rows?: BulkRow[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, BULK_MAX_ROWS) : []
  if (rows.length === 0) return NextResponse.json({ error: 'no_rows' }, { status: 400 })
  if (Array.isArray(body.rows) && body.rows.length > BULK_MAX_ROWS) {
    // Surface the cap rather than silently dropping the tail.
    return NextResponse.json({ error: 'too_many_rows', max: BULK_MAX_ROWS }, { status: 400 })
  }

  return NextResponse.json(await bulkImportCore(seller, rows))
}
