import { NextRequest, NextResponse } from 'next/server'
import { checkListingOwner } from '@/lib/listing-owner'
import { setStatusCore } from '@/lib/core/listings'
import { isIdentityBlockCode, publishBlockedJson, PUBLISH_BLOCKED_STATUS } from '@/lib/compliance/publish-block-response'
import { LICENCE_CHECK_REQUIRED_COPY } from '@/lib/licence-check-copy'
import { isJobTextBlockCode } from '@/lib/publish-guard'
import { JOB_TEXT_REFUSAL } from '@/lib/job-listing'

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
  // A relist the identity gate refused (gate on only): the structured 403, `error` still the code.
  if (!r.ok && isIdentityBlockCode(r.error)) return NextResponse.json(publishBlockedJson(r.error), { status: PUBLISH_BLOCKED_STATUS })
  // A relist of an e-Visa / Legal & permits listing eno has not checked (409, 2026-10-14) carries its bilingual sentence
  // for the native dashboards, which call this same route; so does a relist of a hiring post whose stored text the job-text
  // screen refuses (400, 2026-10-19), with `detail` '<field>:<snippet>' — the words to take out in the editor first.
  if (!r.ok) {
    return NextResponse.json({
      error: r.error,
      ...(r.detail ? { detail: r.detail } : {}),
      ...(r.error === 'licence_check_required' ? { message: LICENCE_CHECK_REQUIRED_COPY } : isJobTextBlockCode(r.error) ? { message: JOB_TEXT_REFUSAL[r.error] } : {}),
    }, { status: r.code })
  }
  return NextResponse.json({ ok: true, status: r.status })
}
