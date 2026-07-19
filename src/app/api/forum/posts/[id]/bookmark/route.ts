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

