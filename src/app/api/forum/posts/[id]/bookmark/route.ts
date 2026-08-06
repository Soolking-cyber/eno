import { z } from 'zod'
import { db } from '@/lib/db'
import { getForumAuth } from '@/lib/forum/auth'
import { forumJson, forumPreflight, isAllowedForumOrigin } from '@/lib/forum/cors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bookmarkSchema = z.object({ saved: z.boolean().optional() })

export function OPTIONS(request: Request) {
  return forumPreflight(request, 'POST, OPTIONS')
}

// ⚠️ WS6 — NOT MIGRATED. Branches: 403 origin_not_allowed · 401 auth_required · 400 invalid_bookmark
// · 404 not_found · 200 {saved}. Four blockers:
//   · A MISSING OR MALFORMED BODY IS DELIBERATELY TOLERATED, NOT A 400. The parse falls back to
//     `{}` (not `null`), the schema's `saved` is optional, and `parsed.data.saved ?? !existing` then
//     makes a body-less POST a TOGGLE. route()'s body step returns
//     `{"error":"<invalidBodyCode>"}` 400 the moment `req.json()` throws, so a caller sending no
//     body at all would go from 200 {saved:…} to 400. `invalid_bookmark` only ever reaches the wire
//     for a body that parses as JSON but fails the schema (e.g. `{"saved":"yes"}`).
//   · THE ORIGIN GUARD RUNS BEFORE AUTH (403 origin_not_allowed to a guest, not 401).
//   · CORS ON EVERY RESPONSE: Access-Control-Allow-Methods: 'POST, OPTIONS', -Allow-Headers and
//     -Max-Age on all five branches (+ -Allow-Origin and Vary: Origin for an allowlisted Origin);
//     route() and apiFail carry none.
//   · AUTH IS getForumAuth() — bearer token or cookie session — which no auth mode expresses.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 }, 'POST, OPTIONS')
  const { id } = await params
  const auth = await getForumAuth(request)
  if (!auth) return forumJson(request, { error: 'auth_required' }, { status: 401 }, 'POST, OPTIONS')
  const parsed = bookmarkSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return forumJson(request, { error: 'invalid_bookmark' }, { status: 400 }, 'POST, OPTIONS')

  const post = await db.forumPost.findFirst({ where: { id, status: { in: ['published', 'locked'] } }, select: { id: true } })
  if (!post) return forumJson(request, { error: 'not_found' }, { status: 404 }, 'POST, OPTIONS')
  const existing = await db.forumBookmark.findUnique({ where: { postId_profileId: { postId: id, profileId: auth.profile.id } } })
  const saved = parsed.data.saved ?? !existing
  // upsert/deleteMany (not create/delete) so a double-tap can't race into a P2002/P2025 500.
  if (saved) {
    await db.forumBookmark.upsert({
      where: { postId_profileId: { postId: id, profileId: auth.profile.id } },
      create: { postId: id, profileId: auth.profile.id },
      update: {},
    })
  } else {
    await db.forumBookmark.deleteMany({ where: { postId: id, profileId: auth.profile.id } })
  }
  return forumJson(request, { saved }, undefined, 'POST, OPTIONS')
}

