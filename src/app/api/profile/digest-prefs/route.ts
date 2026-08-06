import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET: current weekly-digest preference. POST { weeklyDigestOptIn }: update it.
// (Logged-in settings toggle; the email footer's token link handles logged-out opt-out.)
//
// ⚠️ WS6 MIGRATION — the auth preamble only, on both verbs. Codes unchanged: 401 `auth_required`,
// 400 `Invalid body` on malformed JSON, 400 `invalid` on a non-boolean, 200 `{ok,weeklyDigestOptIn}`.
//
// ⚠️ `auth: 'profile'` ON BOTH, INCLUDING POST. GET genuinely needs the row (it returns a column off
// it). POST only uses `profile.id`, so `'userId'` looks like the cheaper mode — but the old code
// called `getCurrentProfile()`, which lazily PROVISIONS a missing Profile row, and the update below
// depends on that row existing. Swapping in `getCurrentProfileId()` would hand back an id with no
// row and turn a first-write into a P2025 throw. This is a settings toggle, not a hot path, so the
// extra read costs nothing that matters.
//
// ⚠️ NO `body:` SCHEMA. The malformed-JSON branch answers `{"error":"Invalid body"}` — a
// space-and-capital string that is NOT an ApiErrorCode, so it cannot be expressed as
// `invalidBodyCode` and must not be "tidied" into `invalid_body`. The parse therefore stays in the
// handler and returns that Response verbatim; route() passes a returned Response through untouched.
//
// ⚠️ ONE BRANCH IS NOT BYTE-IDENTICAL: the `db.profile.update` was unguarded, so a DB rejection was
// an unhandled throw and Next answered its own default 500. route() now catches it and returns
// `{"error":"internal_error"}` 500 — an improvement, but a wire change on the failure path.
export const GET = route({ auth: 'profile' }, async ({ profile }) => ({
  weeklyDigestOptIn: profile.weeklyDigestOptIn,
}))

export const POST = route({ auth: 'profile' }, async ({ req, profile }) => {
  let body: { weeklyDigestOptIn?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  if (typeof body.weeklyDigestOptIn !== 'boolean') throw new ApiError('invalid', 400)
  await db.profile.update({ where: { id: profile.id }, data: { weeklyDigestOptIn: body.weeklyDigestOptIn } })
  return { ok: true, weeklyDigestOptIn: body.weeklyDigestOptIn }
})
