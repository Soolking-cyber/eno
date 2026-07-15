import { db } from '@/lib/db'
import { forumJson, forumPreflight } from '@/lib/forum/cors'
import { forumAuthorSelect, serializeForumAuthor } from '@/lib/forum/serialize'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function OPTIONS(request: Request) {
  return forumPreflight(request, 'GET, OPTIONS')
}

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

