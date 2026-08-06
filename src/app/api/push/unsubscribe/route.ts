import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Remove a browser's push subscription (owner-scoped — you can only delete your
// own endpoint).
//
// ⚠️ WS6 MIGRATION — `auth: 'profile'` because the old code called getCurrentProfile(): same
// getUser() revalidation, so the 401 branch is unchanged. No FK is written (deleteMany only), but
// 'userId' would still widen the auth window past revocation, which is not a free swap.
//
// ⚠️ NO `body:` SCHEMA. Malformed JSON answers `{"error":"Invalid body"}` (not an ApiErrorCode —
// reported, not added), and an empty/missing endpoint is a 200 no-op that a schema would turn into a
// 400. Tolerant parse stays; the 400 rides the wrapper's Response escape hatch.
//
// ⚠️ NOT BYTE-IDENTICAL ON ONE BRANCH: deleteMany has no `.catch()`, so a DB rejection was an
// unhandled throw (Next's default 500) and is now `{"error":"internal_error"}` 500.
export const POST = route({ auth: 'profile' }, async ({ req, profile }) => {
  let body: { endpoint?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const endpoint = String(body.endpoint || '')
  if (endpoint) await db.pushSubscription.deleteMany({ where: { endpoint, profileId: profile.id } })
  return { ok: true }
})
