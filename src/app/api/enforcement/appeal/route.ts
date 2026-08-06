import { db } from '@/lib/db'
import { FLAG_REASONS } from '@/lib/enforcement'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/enforcement/appeal — the ONE-SHOT appeal against the caller's ACTIVE
// enforcement action (DSA due process: every action is appealable, once). Owner-gated:
// the appeal attaches only to the authenticated profile's own action — no ids are
// accepted from the client. Surfaces in GET /api/admin/enforcement (pending appeals).
//
// ⚠️ WS6 MIGRATION — auth + rate limit hoisted into route(); the order the wrapper runs them in
// (auth → rateLimit → handler) is the order they were written in here, so no branch changes place.
// `auth: 'userId'` because the old code called getCurrentProfileId() and the id is only ever a query
// predicate — no Profile row is read, and `'profile'` would add an auth round trip + a DB read.
// NOT `strict`: the original was fail-open and this is a due-process appeal — denying it during a
// limiter blip would silently close the seller's one channel.
//
// ⚠️ `body:` DELIBERATELY OMITTED. The parse stays here because the old code hand-coerces
// (`String(body.text || '')`), so a non-object JSON body (`[]`, `"x"`, a number) currently falls
// through to 400 `missing_fields`. A zod object schema rejects those as 400 `bad_request` — same
// status, different string, i.e. exactly the silent wire change this migration exists to avoid. The
// malformed-JSON branch keeps its own `bad_request` verbatim.
//
// Branches unchanged: 401 `auth_required` · 429 `rate_limited` · 400 `bad_request` · 400
// `missing_fields` · 404 `no_active_action` · 409 `already_appealed` · 200 {"ok":true}.
//
// ⚠️ FAILURE-PATH WIRE CHANGE, DELIBERATE: findFirst/update are unguarded, so a DB error was Next's
// default 500 and is now `{"error":"internal_error"}` 500.
export const POST = route(
  { auth: 'userId', rateLimit: { bucket: 'enforcement-appeal', limit: 5, window: '1 h' } },
  async ({ req, userId: meId }) => {
  let body: { text?: string }
  try { body = await req.json() } catch { throw new ApiError('bad_request', 400) }
  const text = String(body.text || '').trim().slice(0, 2000)
  if (text.length < 5) throw new ApiError('missing_fields', 400)

  // Silent review flags EXCLUDED (Phase 3): a flag row is invisible to the seller,
  // so it can be neither the target of their appeal nor allowed to shadow the real
  // action they're appealing against.
  const action = await db.enforcementAction.findFirst({
    where: { profileId: meId, status: 'active', reason: { notIn: [...FLAG_REASONS] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, appealedAt: true },
  })
  if (!action) throw new ApiError('no_active_action', 404)
  // One-shot: a second submission while (or after) the first is pending is refused —
  // the appeal is the seller's single considered statement, not a chat channel.
  if (action.appealedAt) throw new ApiError('already_appealed', 409)
  await db.enforcementAction.update({ where: { id: action.id }, data: { appealText: text, appealedAt: new Date() } })
  return { ok: true }
  },
)
