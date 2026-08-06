import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route } from '@/lib/api/handler'
import { normalizeParams, describeParams, toUrlParams } from '@/lib/saved-search'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_PER_USER = 20

// ⚠️ WS6 MIGRATION — `auth: 'profile'`, NOT `'userId'`, AND THAT IS NOT A REACH FOR THE OBVIOUS MODE.
// The old code called getCurrentProfile(), which LAZILY PROVISIONS the Profile row. POST writes
// SavedSearch.profileId, an FK to that row, so a user whose Profile does not exist yet must be
// provisioned here or the create fails; and swapping in getCurrentProfileId() would also flip an
// unprovisioned caller from 401 to a 500 on the FK. Same DB read as before, so no path gets slower.
//
// ⚠️ NO `body:` SCHEMA BEYOND `z.unknown()`. The old handler accepted ANY parseable JSON and
// hand-coerced (`typeof body.label === 'string' ? … : describeParams(params)`), so a body of `[]`,
// `5` or `"x"` currently succeeds with generated defaults. A real object schema would turn those
// into 400s — a wire change. `z.unknown()` reproduces the only rejection the old code had, the
// malformed-JSON one, with its own code: `invalid_body` 400, not the wrapper's default bad_request.

const Body = z.unknown()

// GET: the signed-in user's saved searches (newest first), each with a ready-to-run URL.
export const GET = route({ auth: 'profile' }, async ({ profile }) => {
  const rows = await db.savedSearch.findMany({ where: { profileId: profile.id }, orderBy: { createdAt: 'desc' } })
  const searches = rows.map((r) => {
    const params = (() => { try { return JSON.parse(r.params) } catch { return {} } })()
    return { id: r.id, label: r.label, notify: r.notify, createdAt: r.createdAt.toISOString(), url: `/?${toUrlParams(params)}` }
  })
  return { searches }
})

// POST { label?, params }: save the current filter set. Caps per user; label falls
// back to a generated summary. lastNotifiedAt starts now so only FUTURE matches alert.
//
// ⚠️ TWO BRANCHES RETURN A Response RATHER THAN AN OBJECT, both because the wrapper cannot express
// them: the created row is a 201 (a returned object is always 200), and `limit_reached` carries an
// extra `max` field alongside the code, which ApiError's `{ error }` body has no room for.
// The idempotent-hit and P2002-race branches stay plain 200 objects, exactly as before.
//
// ⚠️ ERROR-PATH CHANGE, DELIBERATE: the `throw e` on a non-P2002 create failure (and any other DB
// rejection) used to surface as Next's default 500; route() now logs it and answers
// `{"error":"internal_error"}` 500.
export const POST = route({ auth: 'profile', body: Body, invalidBodyCode: 'invalid_body' }, async ({ profile, body }) => {
  // Cast, not `?? {}`: a literal `null` body threw a TypeError here before (Next 500) and must not
  // start succeeding as an empty object.
  const b = body as { label?: unknown; params?: unknown }
  const params = normalizeParams(b.params)
  const paramsJson = JSON.stringify(params)

  // Idempotent: re-saving the SAME filter set returns the existing row instead of
  // creating a duplicate (which the alerts cron would amplify into repeated push/
  // notifications forever). Covers double-tap, concurrent, and multi-device saves.
  const existing = await db.savedSearch.findFirst({ where: { profileId: profile.id, params: paramsJson } })
  if (existing) return { id: existing.id, label: existing.label, url: `/?${toUrlParams(params)}` }

  const count = await db.savedSearch.count({ where: { profileId: profile.id } })
  if (count >= MAX_PER_USER) return NextResponse.json({ error: 'limit_reached', max: MAX_PER_USER }, { status: 409 })

  const label = (typeof b.label === 'string' && b.label.trim() ? b.label.trim() : describeParams(params)).slice(0, 120)
  try {
    const created = await db.savedSearch.create({
      data: { profileId: profile.id, label, params: paramsJson, notify: true },
    })
    return NextResponse.json({ id: created.id, label: created.label, url: `/?${toUrlParams(params)}` }, { status: 201 })
  } catch (e) {
    // Concurrent double-save raced past the findFirst → the unique index caught it.
    // Return the row that won instead of erroring.
    if ((e as { code?: string })?.code === 'P2002') {
      const row = await db.savedSearch.findFirst({ where: { profileId: profile.id, params: paramsJson } })
      if (row) return { id: row.id, label: row.label, url: `/?${toUrlParams(params)}` }
    }
    throw e
  }
})
