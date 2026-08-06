import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Store (or re-home) a native FCM/APNs device token for the signed-in user. Token is unique —
// re-registering the same device upserts and re-homes it to the current account if it switched
// users. Sends fan out via src/lib/native-push (see sendPushToProfile). Dormant on the send side
// until FCM/APNs env is configured, but tokens are captured now.
//
// ⚠️ WS6 MIGRATION — `auth: 'profile'`, NOT `'userId'`, and that is not the wrapper's default for a
// reason. The old code called getCurrentProfile(), which (a) revalidates with getUser() so a revoked
// session 401s immediately rather than at token expiry, and (b) LAZILY PROVISIONS the Profile row.
// The upsert's create branch writes `profileId` as an FK to that row, so 'userId' would both widen
// the auth window and turn a never-provisioned user's first device registration into an FK error.
//
// ⚠️ NO `body:` SCHEMA. Malformed JSON here answers `{"error":"Invalid body"}` — capital I, a space,
// and NOT a member of ApiErrorCode (errors.ts is off-limits in this pass; the code is reported, not
// added). The tolerant parse therefore stays in the handler and the 400 goes back as a raw Response
// through the wrapper's escape hatch, byte-identical to before. A zod schema would also have changed
// the `invalid_token` branch for non-object JSON, which the hand-coercion below accepts today.
//
// ⚠️ ONE BRANCH IS NOT BYTE-IDENTICAL. The upsert has no `.catch()`, so a DB rejection used to be an
// unhandled throw and Next answered its own default 500; route() now answers
// `{"error":"internal_error"}` 500. Same for a literal `null` body (`body.token` on null throws).
export const POST = route({ auth: 'profile' }, async ({ req, profile }) => {
  let body: { token?: string; platform?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const token = String(body.token || '').trim()
  const platform = body.platform === 'ios' ? 'ios' : body.platform === 'android' ? 'android' : ''
  if (!token || !platform) throw new ApiError('invalid_token', 400)

  await db.nativePushToken.upsert({
    where: { token },
    create: { profileId: profile.id, token, platform },
    update: { profileId: profile.id, platform },
  })
  return { ok: true }
})
