import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET: current reminder preference. POST { dailyReminderOptIn }: update it.
//
// ⚠️ WS6 MIGRATION — auth preamble only, both verbs; same shape as the sibling digest-prefs route.
// Codes unchanged: 401 `auth_required`, 400 `Invalid body`, 400 `invalid`, 200 `{ok,dailyReminderOptIn}`.
//
// ⚠️ `auth: 'profile'` ON BOTH. GET returns a column off the row. POST only needs `profile.id`, but
// the old code called `getCurrentProfile()`, which lazily PROVISIONS a missing Profile row that the
// update below depends on — `'userId'` would hand back an id with no row and P2025 the first write.
//
// ⚠️ NO `body:` SCHEMA: the malformed-JSON branch answers `{"error":"Invalid body"}`, which is not an
// ApiErrorCode and so cannot go through `invalidBodyCode`. The tolerant parse stays in the handler
// and returns that Response verbatim rather than being "tidied" into `invalid_body`.
//
// ⚠️ ONE BRANCH IS NOT BYTE-IDENTICAL: the `db.profile.update` was unguarded, so a DB rejection was
// an unhandled throw and Next answered its own default 500. route() now catches it and returns
// `{"error":"internal_error"}` 500 — an improvement, but a wire change on the failure path.
export const GET = route({ auth: 'profile' }, async ({ profile }) => ({
  dailyReminderOptIn: profile.dailyReminderOptIn,
}))

export const POST = route({ auth: 'profile' }, async ({ req, profile }) => {
  let body: { dailyReminderOptIn?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  if (typeof body.dailyReminderOptIn !== 'boolean') throw new ApiError('invalid', 400)
  await db.profile.update({ where: { id: profile.id }, data: { dailyReminderOptIn: body.dailyReminderOptIn } })
  return { ok: true, dailyReminderOptIn: body.dailyReminderOptIn }
})
