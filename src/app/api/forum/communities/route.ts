import { db } from '@/lib/db'
import { forumJson, forumPreflight } from '@/lib/forum/cors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function OPTIONS(request: Request) {
  return forumPreflight(request, 'GET, OPTIONS')
}

// ⚠️ WS6 — NOT MIGRATED. Branches: 200 {communities} · 503 forum_schema_not_ready (Prisma P2021,
// "table does not exist" — the forum tables live outside the marketplace's own DDL) · any other
// Prisma error rethrows. Two blockers, and the second is the one that decides it:
//   · CORS ON EVERY RESPONSE. forumJson sets Access-Control-Allow-Methods: 'GET, OPTIONS',
//     -Allow-Headers and -Max-Age on both returns (+ -Allow-Origin and Vary: Origin for an
//     allowlisted Origin); route() returns a bare NextResponse.json with no headers.
//   · ALL FOUR OPTIONS WOULD BE EMPTY — public, no rate limit, no request body, no params. Even if
//     the headers were pinned by returning forumJson() from the handler, `route({}, …)` would add a
//     try/catch this route already has and nothing else. That is churn, not a migration.
export async function GET(request: Request) {
  try {
    const communities = await db.forumCommunity.findMany({
      where: { status: 'active' },
      orderBy: [{ postCount: 'desc' }, { name: 'asc' }],
      select: {
        slug: true,
        name: true,
        nameVi: true,
        description: true,
        descriptionVi: true,
        icon: true,
        location: true,
        memberCount: true,
        postCount: true,
      },
    })
    return forumJson(request, { communities }, undefined, 'GET, OPTIONS')
  } catch (error) {
    if ((error as { code?: string }).code === 'P2021') {
      return forumJson(request, { error: 'forum_schema_not_ready' }, { status: 503 }, 'GET, OPTIONS')
    }
    throw error
  }
}

