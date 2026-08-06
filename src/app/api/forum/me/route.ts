import { db } from '@/lib/db'
import { getForumAuth } from '@/lib/forum/auth'
import { forumJson, forumPreflight } from '@/lib/forum/cors'
import { forumAuthorSelect, serializeForumAuthor } from '@/lib/forum/serialize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function OPTIONS(request: Request) {
  return forumPreflight(request, 'GET, OPTIONS')
}

// ⚠️ WS6 — NOT MIGRATED. Branches: 200 {"user":null} for a guest · 200 {user} · 200
// {user,schemaReady:false} on Prisma P2021 · any other Prisma error rethrows. Three blockers:
//   · A GUEST GETS 200 `{"user":null}`, NOT 401 — `auth: 'profile'` would answer
//     `{"error":"auth_required"}` 401 to every signed-out visitor. `auth: 'public'` keeps the 200 but
//     then the handler must resolve the caller itself, which is what it already does.
//     (An earlier draft called this "the session probe the forum shell calls on every load". The
//     review grepped the whole tree — `src/`, `apps/forum/`, `apps/ios/`, `apps/android/` — and
//     found ZERO callers of `/api/forum/me`. That does not rescue the route from the skip: a
//     public endpoint's guest response is a contract regardless of who calls it. It does mean the
//     blocker must be stated as bytes, which is how it now reads.)
//   · AUTH IS getForumAuth() — an `Authorization: Bearer` token validated through a second Supabase
//     client, or a cookie session. The bearer path is the one the forum browser actually uses
//     (apps/forum/src/lib/api.ts:22), and no wrapper auth mode expresses either-or.
//   · CORS ON EVERY RESPONSE: forumJson sets Access-Control-Allow-Methods: 'GET, OPTIONS',
//     -Allow-Headers and -Max-Age on all three returns (+ -Allow-Origin and Vary: Origin for an
//     allowlisted Origin). route() carries none.
export async function GET(request: Request) {
  const auth = await getForumAuth(request)
  if (!auth) return forumJson(request, { user: null }, undefined, 'GET, OPTIONS')
  try {
    const profile = await db.profile.findUniqueOrThrow({
      where: { id: auth.profile.id },
      select: {
        ...forumAuthorSelect,
        enforcementState: true,
        forumMemberships: { select: { communitySlug: true, role: true, notifications: true } },
        _count: { select: { forumBookmarks: true, itineraries: true } },
      },
    })
    return forumJson(request, {
      user: {
        ...serializeForumAuthor(profile),
        enforcementState: profile.enforcementState,
        memberships: profile.forumMemberships,
        savedCount: profile._count.forumBookmarks,
        itineraryCount: profile._count.itineraries,
      },
    }, undefined, 'GET, OPTIONS')
  } catch (error) {
    if ((error as { code?: string }).code === 'P2021') {
      return forumJson(request, {
        user: {
          ...serializeForumAuthor({ ...auth.profile, seller: null, forumProfile: null }),
          enforcementState: auth.profile.enforcementState,
          memberships: [],
          savedCount: 0,
          itineraryCount: 0,
        },
        schemaReady: false,
      }, undefined, 'GET, OPTIONS')
    }
    throw error
  }
}

