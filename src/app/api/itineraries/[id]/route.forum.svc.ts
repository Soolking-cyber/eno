import { db } from '@/lib/db'
import { getForumAuth } from '@/lib/forum/auth'
import { forumJson, forumPreflight, isAllowedForumOrigin } from '@/lib/forum/cors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ⚠️ WS6 — NOT MIGRATED (all three exports): every response here is built by
// `forumJson`/`forumPreflight`, which set `Access-Control-Allow-Origin`, `Access-Control-Allow-
// Methods: GET, DELETE, OPTIONS`, `Access-Control-Allow-Headers: Authorization, Content-Type`,
// `Access-Control-Max-Age: 86400` and APPEND `Vary: Origin` (src/lib/forum/cors.ts:53-63).
// route() emits a bare `NextResponse.json`, so every branch would lose those five headers and a
// cross-origin caller's browser would discard the response it just fetched. OPTIONS also answers a
// bodyless `new NextResponse(null, { status: 204 })` — which route() CAN pass through
// (handler.ts:232), so the reason to skip it is the empty-options churn, not inexpressibility.
export function OPTIONS(request: Request) {
  return forumPreflight(request, 'GET, DELETE, OPTIONS')
}

// ⚠️ WS6 — NOT MIGRATED: the CORS headers above are the blocker, on every branch.
//
// ⚠️ NOT because the wrapper is cookies-only — an earlier draft claimed that and it is FALSE.
// `getCurrentProfile()` / `getCurrentProfileId()` both pass `bearerToken()` to Supabase
// (src/lib/admin.ts:78, :150), so `auth: 'profile'` answers a bearer-token caller 200, not 401.
// See the fuller note in ../route.svc.ts.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getForumAuth(request)
  if (!auth) return forumJson(request, { error: 'auth_required' }, { status: 401 }, 'GET, DELETE, OPTIONS')
  const itinerary = await db.itinerary.findFirst({
    where: { id, profileId: auth.profile.id, status: { not: 'archived' } },
    include: { dayPlans: { orderBy: { dayNumber: 'asc' } }, stays: { orderBy: { position: 'asc' } } },
  })
  if (!itinerary) return forumJson(request, { error: 'not_found' }, { status: 404 }, 'GET, DELETE, OPTIONS')
  return forumJson(request, {
    itinerary: { ...itinerary, interests: JSON.parse(itinerary.interests) as string[] },
  }, undefined, 'GET, DELETE, OPTIONS')
}

// ⚠️ WS6 — NOT MIGRATED: the CORS headers and the bearer-token caller above, plus one more —
// `isAllowedForumOrigin` runs BEFORE the caller is resolved and answers 403 `origin_not_allowed`.
// route()'s fixed order is auth → rateLimit → body, so a disallowed origin arriving without a
// session would be answered `{"error":"auth_required"}` 401 in place of that 403.
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 }, 'GET, DELETE, OPTIONS')
  const { id } = await params
  const auth = await getForumAuth(request)
  if (!auth) return forumJson(request, { error: 'auth_required' }, { status: 401 }, 'GET, DELETE, OPTIONS')
  const updated = await db.itinerary.updateMany({
    where: { id, profileId: auth.profile.id, status: { not: 'archived' } },
    data: { status: 'archived' },
  })
  if (!updated.count) return forumJson(request, { error: 'not_found' }, { status: 404 }, 'GET, DELETE, OPTIONS')
  return forumJson(request, { ok: true }, undefined, 'GET, DELETE, OPTIONS')
}

