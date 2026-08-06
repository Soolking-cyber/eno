import { db } from '@/lib/db'
import { after } from 'next/server'
import { syncBadgeToProfile } from '@/lib/native-push'
import { route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST: mark notifications read. { ids: [...] } marks those; empty/no body marks
// ALL of the current user's unread notifications read.
//
// ⚠️ WS6 MIGRATION — AND THE BODY IS DELIBERATELY *NOT* HANDED TO THE WRAPPER.
// route()'s `body:` option answers 400 on malformed JSON, but this endpoint's contract is that a
// missing, empty or unparseable body means "mark ALL read" — the client calls it with no body at
// all when the user taps the bell. Giving it a schema would turn that success into a 400 and stop
// the badge ever clearing, which is precisely the silent wire change this migration forbids. So the
// wrapper takes the auth preamble only, and the tolerant parse stays here verbatim.
//
// Branches checked against the handler this replaces: guest → 401 `{"error":"auth_required"}`;
// no body / malformed JSON / `{}` / `{ids:[]}` → mark all, 200 `{"ok":true}`; `{ids:[…]}` → mark
// those, 200 `{"ok":true}`. `auth: 'userId'` is the same getCurrentProfileId() the old code called.
//
// ⚠️ ONE BRANCH IS *NOT* BYTE-IDENTICAL, AND SAYING SO IS THE POINT. There is no `.catch()` on the
// updateMany, so a DB rejection used to be an unhandled throw and Next answered its own default
// 500. route() now catches it, logs with an `op`, and answers `{"error":"internal_error"}` 500.
// That is a deliberate improvement — a structured code rather than an error page, and never the
// exception text, which can carry a Prisma query or a phone number — but it IS a wire change on the
// failure path. The review caught this as an overclaim in the first draft; it is pinned by a test.
export const POST = route({ auth: 'userId' }, async ({ req, userId }) => {
  let body: { ids?: string[] } = {}
  try { body = await req.json() } catch { /* empty body → mark all */ }

  if (Array.isArray(body.ids) && body.ids.length) {
    await db.notification.updateMany({ where: { recipientId: userId, id: { in: body.ids } }, data: { read: true } })
  } else {
    await db.notification.updateMany({ where: { recipientId: userId, read: false }, data: { read: true } })
  }
  // Reading is the ONLY moment the badge should go DOWN, and no ordinary push fires here —
  // without this the circle would sit on the icon after the bell was already cleared.
  // after() so the user's request never waits on APNs.
  after(() => syncBadgeToProfile(userId))
  return { ok: true }
})
