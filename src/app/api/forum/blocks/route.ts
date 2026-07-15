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

export function OPTIONS(request: Request) {
  return forumPreflight(request, 'POST, OPTIONS')
}

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

