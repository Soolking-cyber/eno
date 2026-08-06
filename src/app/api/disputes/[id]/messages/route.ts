import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/ratelimit'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'
import { logError } from '@/lib/log'
import {
  DISPUTE_BODY_MAX, DISPUTE_IMAGES_MAX,
  addPartyStatementOnce, isEvidencePath, loadDisputeForParty, partyCanPost, partyHasSubmitted,
} from '@/lib/dispute'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A party posts a statement (and/or evidence) into their case room. Gated on being
// a party, the case being open, and the evidence window not having expired — the
// window is what keeps cases decidable (Binance-style respondent discipline).
// Evidence images arrive as PRIVATE-bucket paths from /api/disputes/[id]/evidence,
// pinned to this case's folder so a message can never reference foreign files.
//
// ⚠️ WS6 MIGRATION — AUTH PREAMBLE ONLY. Neither the rate limit nor the body can move into route(),
// and for the same reason in both cases: the wrapper runs them BEFORE the handler, but here they ran
// AFTER the party/window/one-shot gates. Hoisting either changes which branch a request that trips
// two of them lands on — a non-party would get 429 or 400 instead of 404, which leaks that the case
// id is real. They stay in place, raised as ApiError with the identical code + status.
//
// ⚠️ AND `body:` WOULD TIGHTEN THE WIRE ANYWAY. The old parse hand-coerces (`String(body.body||'')`,
// `Array.isArray(body.images)`), so a body of `[]`, `"x"` or `{}` currently falls through to 400
// `empty`, not to the malformed-body code. A zod object schema rejects the first two as
// `invalid_body`. Same status, different string — exactly the silent change this migration forbids.
//
// `auth: 'userId'` = the getCurrentProfileId() this replaces. Branches unchanged: 401 `auth_required`
// · 404 `not_found` · 409 `window_closed` · 409 `already_submitted` (twice: the cheap pre-check and
// the atomic claim) · 429 `rate_limited` · 400 `invalid_body` · 400 `empty` · 201 {ok,id}.
//
// ⚠️ FAILURE-PATH WIRE CHANGE, DELIBERATE: addPartyStatementOnce() is unguarded (the report.update
// below does have a .catch), so a DB error was Next's default 500 and is now
// `{"error":"internal_error"}` 500.
export const POST = route({ auth: 'userId' }, async ({ req, userId: meId, params }) => {
  const { id } = params

  const loaded = await loadDisputeForParty(id, meId)
  if (!loaded) throw new ApiError('not_found', 404)
  const { report, role } = loaded

  if (!partyCanPost(report)) throw new ApiError('window_closed', 409)
  // One-shot: each side gets exactly ONE statement (text + photos). A cheap pre-check
  // rejects the common repeat; the atomic addPartyStatementOnce below is the real
  // guard against a concurrent double-submit.
  if (await partyHasSubmitted(report.id, meId)) throw new ApiError('already_submitted', 409)

  const rl = await rateLimit('dispute-message', meId, 30, '1 h')
  if (!rl.success) throw new ApiError('rate_limited', 429)

  let body: { body?: string; images?: string[] }
  try { body = await req.json() } catch { throw new ApiError('invalid_body', 400) }

  const text = String(body.body || '').trim().slice(0, DISPUTE_BODY_MAX)
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter((p): p is string => typeof p === 'string' && isEvidencePath(p, report.id))
    .slice(0, DISPUTE_IMAGES_MAX)
  if (!text && images.length === 0) throw new ApiError('empty', 400)

  // Atomic: an advisory lock serializes concurrent same-party posts so exactly one lands.
  const row = await addPartyStatementOnce(report, { senderProfileId: meId, senderRole: role, body: text, images })
  if (!row) throw new ApiError('already_submitted', 409)
  // A respondent's one statement clears the buyer-king SLA flag (the admin
  // "buyer-waiting" queue filters on sellerRespondedAt: null) so they leave that
  // queue. We set ONLY the timestamp, never sellerResponse — the statement lives as
  // the DisputeMessage (which the timeline + AI review already read); mirroring the
  // text would render it twice (legacy sellerResponse item + the real thread row).
  if (role === 'respondent' && !report.sellerRespondedAt) {
    await db.report.update({ where: { id: report.id }, data: { sellerRespondedAt: new Date() } }).catch((e) => logError(e, { op: 'dispute.markSellerResponded' }))
  }
  // 201 (not the wrapper's default 200) → an explicit Response, which route() returns untouched.
  return NextResponse.json({ ok: true, id: row.id }, { status: 201 })
})
