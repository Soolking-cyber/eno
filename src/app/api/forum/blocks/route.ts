import { z } from 'zod'
import { db } from '@/lib/db'
import { getForumAuth } from '@/lib/forum/auth'
import { forumJson, forumPreflight, isAllowedForumOrigin } from '@/lib/forum/cors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const blockSchema = z.object({
  profileId: z.string().uuid(),
  blocked: z.boolean().default(true),
})

// ⚠️ WS6 — NOT MIGRATED, and the first blocker below applies to EVERY export in src/app/api/forum/**.
//   · EVERY RESPONSE CARRIES CORS HEADERS. `forumJson()` (src/lib/forum/cors.ts:65) sets
//     `Access-Control-Allow-Methods: POST, OPTIONS`, `Access-Control-Allow-Headers: Authorization,
//     Content-Type` and `Access-Control-Max-Age: 86400` on all six branches below, plus
//     `Access-Control-Allow-Origin: <origin>` and an appended `Vary: Origin` when the caller's
//     Origin is allowlisted. `route()` returns `NextResponse.json(data)` and `apiFail()` a bare
//     `{error}`; neither can carry a header, so the wrapper's OWN 401 and 400 early-returns would
//     ship without them. Returning `forumJson()` from the handler can restore them on the success
//     path only — which forces `auth:` and `body:` to stay in the handler, leaving all four options
//     empty. The wrapper then buys nothing. These routes serve a SECOND ORIGIN (eno.forum): a
//     dropped header fails in a browser there and in no local test.
//   · THE ORIGIN GUARD RUNS BEFORE AUTH. A guest from a disallowed origin gets 403
//     `{"error":"origin_not_allowed"}` today; route() resolves the caller first, so it would get
//     401 `{"error":"auth_required"}` instead.
//   · AUTH IS `getForumAuth()` — an `Authorization: Bearer` token validated against a second
//     Supabase client, OR a cookie session — and it returns null when that env is ABSENT, which is
//     the real gap. (⚠️ NOT that the wrapper is cookies-only: `getCurrentProfile()` reads a bearer
//     token too, src/lib/admin.ts:78/:138. An earlier draft got this backwards.)
//     None of the wrapper's five modes ('public' | 'userId' | 'profile' | 'admin' | 'cron')
//     expresses that. ('cron' authenticates a shared secret, not a person, so it is no closer.)
// The OPTIONS export is a preflight, not a JSON method handler, and is outside route()'s shape.
export function OPTIONS(request: Request) {
  return forumPreflight(request, 'POST, OPTIONS')
}

// Branches: 403 origin_not_allowed · 401 auth_required · 400 invalid_block · 400 cannot_block_self
// · 404 not_found · 200 {blocked}. All six through forumJson with 'POST, OPTIONS'.
export async function POST(request: Request) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 }, 'POST, OPTIONS')
  const auth = await getForumAuth(request)
  if (!auth) return forumJson(request, { error: 'auth_required' }, { status: 401 }, 'POST, OPTIONS')
  const parsed = blockSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return forumJson(request, { error: 'invalid_block' }, { status: 400 }, 'POST, OPTIONS')
  if (parsed.data.profileId === auth.profile.id) return forumJson(request, { error: 'cannot_block_self' }, { status: 400 }, 'POST, OPTIONS')
  const target = await db.profile.findUnique({ where: { id: parsed.data.profileId }, select: { id: true } })
  if (!target) return forumJson(request, { error: 'not_found' }, { status: 404 }, 'POST, OPTIONS')

  if (parsed.data.blocked) {
    await db.forumUserBlock.upsert({
      where: { blockerProfileId_blockedProfileId: { blockerProfileId: auth.profile.id, blockedProfileId: target.id } },
      create: { blockerProfileId: auth.profile.id, blockedProfileId: target.id },
      update: {},
    })
  } else {
    await db.forumUserBlock.deleteMany({ where: { blockerProfileId: auth.profile.id, blockedProfileId: target.id } })
  }
  return forumJson(request, { blocked: parsed.data.blocked }, undefined, 'POST, OPTIONS')
}

