import { NextRequest, NextResponse } from 'next/server'
import { checkListingOwner } from '@/lib/listing-owner'
import { setStatusCore } from '@/lib/core/listings'

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
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await checkListingOwner(id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.code })

  let body: { status?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const r = await setStatusCore(id, String(body.status || ''))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code })
  return NextResponse.json({ ok: true, status: r.status })
}
