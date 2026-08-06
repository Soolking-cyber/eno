import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ⚠️ WS6 MIGRATION — `auth: 'profile'` to match the sibling collection route and the code it
// replaces (getCurrentProfile()). Both handlers only need the id for owner scoping, but dropping to
// 'userId' would answer an unprovisioned caller 200 where they used to be provisioned first; these
// are low-frequency dashboard calls, so there is no hot path to protect. Guest → 401 `auth_required`.

const Body = z.unknown()

// DELETE: remove one of the user's saved searches (owner-scoped).
//
// ⚠️ Error-path change, deliberate: an unhandled deleteMany rejection used to be Next's default 500
// and is now `{"error":"internal_error"}` 500. The success body `{ ok: <bool> }` is unchanged.
export const DELETE = route({ auth: 'profile' }, async ({ params, profile }) => {
  // deleteMany scoped by profileId → a cross-user id simply deletes nothing (no 404 oracle).
  const res = await db.savedSearch.deleteMany({ where: { id: params.id, profileId: profile.id } })
  return { ok: res.count > 0 }
})

// PATCH { notify }: toggle alerts for one saved search (owner-scoped).
//
// ⚠️ TWO DISTINCT 400 CODES, AND THE SCHEMA ONLY OWNS ONE OF THEM. Malformed JSON is `invalid_body`
// (invalidBodyCode); a parseable body whose `notify` is not a boolean is `invalid` — a different
// string on the wire. So the schema stays `z.unknown()` and the type check stays in the handler,
// where it can throw the right code. A `z.object({ notify: z.boolean() })` would have collapsed both
// branches onto one code.
export const PATCH = route({ auth: 'profile', body: Body, invalidBodyCode: 'invalid_body' }, async ({ params, profile, body }) => {
  // Cast, not `?? {}`: a literal `null` body threw here before (500) and must not become a 400.
  const b = body as { notify?: unknown }
  if (typeof b.notify !== 'boolean') throw new ApiError('invalid', 400)
  const res = await db.savedSearch.updateMany({ where: { id: params.id, profileId: profile.id }, data: { notify: b.notify } })
  return { ok: res.count > 0 }
})
