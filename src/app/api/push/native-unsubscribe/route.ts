import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Remove a native push token (sign-out / opt-out).
//
// ⚠️ WS6 MIGRATION — `auth: 'profile'` because the old code called getCurrentProfile(). No FK is
// written here (deleteMany only), but that call revalidates with getUser(), so a revoked session
// 401s now rather than at token expiry; 'userId' would quietly widen the auth window on a sign-out
// path. Keeping the same resolver keeps the 401 branch identical.
//
// ⚠️ NO `body:` SCHEMA. Malformed JSON answers `{"error":"Invalid body"}`, which is not an
// ApiErrorCode (reported, not added), and an EMPTY token is a 200 no-op today — a schema would turn
// that into a 400. Tolerant parse stays; the 400 rides the wrapper's Response escape hatch.
//
// ⚠️ NOT BYTE-IDENTICAL ON ONE BRANCH: deleteMany has no `.catch()`, so a DB rejection was an
// unhandled throw (Next's default 500) and is now `{"error":"internal_error"}` 500.
export const POST = route({ auth: 'profile' }, async ({ req, profile }) => {
  let body: { token?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const token = String(body.token || '').trim()
  if (token) await db.nativePushToken.deleteMany({ where: { profileId: profile.id, token } })
  return { ok: true }
})
