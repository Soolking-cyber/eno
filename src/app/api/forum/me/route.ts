import { db } from '@/lib/db'
import { getForumAuth } from '@/lib/forum/auth'
import { forumJson, forumPreflight } from '@/lib/forum/cors'
import { forumAuthorSelect, serializeForumAuthor } from '@/lib/forum/serialize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function OPTIONS(request: Request) {
  return forumPreflight(request, 'GET, OPTIONS')
}

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

