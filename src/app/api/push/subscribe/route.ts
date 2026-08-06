import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'
import { isAllowedPushEndpoint } from '@/lib/ssrf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Store (or refresh) a browser's Web Push subscription for the signed-in user.
// Endpoint is unique — re-subscribing the same browser upserts (and re-homes it
// to the current account if the device switched users).
//
// ⚠️ WS6 MIGRATION — `auth: 'profile'`, NOT `'userId'`. The old code called getCurrentProfile(), and
// the upsert's create branch writes `profileId` as an FK to the row that call lazily provisions;
// getCurrentProfile() also revalidates with getUser(), so a revoked session still 401s immediately.
// 'userId' would change both, on a route that writes an FK.
//
// ⚠️ NO `body:` SCHEMA. Malformed JSON answers `{"error":"Invalid body"}` — not an ApiErrorCode
// (reported, not added), so the tolerant parse stays and the 400 goes back as a raw Response. A zod
// schema would also have rejected non-object JSON as a different code than the `invalid_subscription`
// the hand-coercion produces today.
//
// ⚠️ NOT BYTE-IDENTICAL ON ONE BRANCH: the upsert has no `.catch()`, so a DB rejection was an
// unhandled throw (Next's default 500) and is now `{"error":"internal_error"}` 500.
export const POST = route({ auth: 'profile' }, async ({ req, profile }) => {
  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const endpoint = String(body.endpoint || '')
  const p256dh = String(body.keys?.p256dh || '')
  const auth = String(body.keys?.auth || '')
  // The endpoint is later fetched server-side by web-push, so it must belong to a
  // real push service — never an arbitrary (internal) URL (SSRF).
  if (!isAllowedPushEndpoint(endpoint) || !p256dh || !auth) {
    throw new ApiError('invalid_subscription', 400)
  }

  const userAgent = req.headers.get('user-agent')?.slice(0, 255) || null
  await db.pushSubscription.upsert({
    where: { endpoint },
    create: { profileId: profile.id, endpoint, p256dh, auth, userAgent },
    update: { profileId: profile.id, p256dh, auth, userAgent },
  })
  return { ok: true }
})
