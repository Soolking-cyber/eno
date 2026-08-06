import { db } from '@/lib/db'
import { forumJson, forumPreflight } from '@/lib/forum/cors'
import { forumAuthorSelect, serializeForumAuthor } from '@/lib/forum/serialize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function OPTIONS(request: Request) {
  return forumPreflight(request, 'GET, OPTIONS')
}

// ⚠️ WS6 — NOT MIGRATED. Branches: 200 {helpers} · 200 {helpers:[],schemaReady:false} on Prisma
// P2021 · any other Prisma error rethrows. Two blockers:
//   · CORS ON EVERY RESPONSE. forumJson sets Access-Control-Allow-Methods: 'GET, OPTIONS',
//     -Allow-Headers and -Max-Age on both returns (+ -Allow-Origin and Vary: Origin for an
//     allowlisted Origin); route() returns a plain NextResponse.json carrying none of them.
//   · ALL FOUR OPTIONS WOULD BE EMPTY — public, no rate limit, no body, no params. Note also that
//     BOTH branches here are 200s: the missing-table case degrades to an empty rail rather than
//     erroring, so there is no error path for the wrapper to standardise either.
export async function GET(request: Request) {
  try {
    const rows = await db.forumProfile.findMany({
      where: { helpfulAnswerCount: { gt: 0 } },
      take: 10,
      orderBy: [{ helpfulAnswerCount: 'desc' }, { reputation: 'desc' }],
      include: { profile: { select: forumAuthorSelect } },
    })
    const helpers = rows.map((row) => ({
      author: serializeForumAuthor(row.profile),
      reputation: row.reputation,
      helpfulAnswers: row.helpfulAnswerCount,
    }))
    return forumJson(request, { helpers }, undefined, 'GET, OPTIONS')
  } catch (error) {
    if ((error as { code?: string }).code === 'P2021') {
      return forumJson(request, { helpers: [], schemaReady: false }, undefined, 'GET, OPTIONS')
    }
    throw error
  }
}

