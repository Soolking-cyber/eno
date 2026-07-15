import { db } from '@/lib/db'
import { forumJson, forumPreflight } from '@/lib/forum/cors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function OPTIONS(request: Request) {
  return forumPreflight(request, 'GET, OPTIONS')
}

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

