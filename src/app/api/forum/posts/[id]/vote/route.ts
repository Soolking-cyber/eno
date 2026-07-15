import { z } from 'zod'
import { db } from '@/lib/db'
import { canParticipate, getForumAuth } from '@/lib/forum/auth'
import { forumJson, forumPreflight, isAllowedForumOrigin } from '@/lib/forum/cors'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const voteSchema = z.object({ value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) })

export function OPTIONS(request: Request) {
  return forumPreflight(request, 'POST, OPTIONS')
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 }, 'POST, OPTIONS')
  const { id } = await params
  const auth = await getForumAuth(request)
  if (!auth) return forumJson(request, { error: 'auth_required' }, { status: 401 }, 'POST, OPTIONS')
  if (!canParticipate(auth.profile)) return forumJson(request, { error: 'account_restricted' }, { status: 403 }, 'POST, OPTIONS')
  const parsed = voteSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return forumJson(request, { error: 'invalid_vote' }, { status: 400 }, 'POST, OPTIONS')
  const limit = await rateLimit('forum-post-vote', auth.profile.id, 240, '1 h')
  if (!limit.success) return forumJson(request, { error: 'rate_limited' }, { status: 429 }, 'POST, OPTIONS')

  const result = await db.$transaction(async (tx) => {
    const post = await tx.forumPost.findFirst({ where: { id, status: 'published' }, select: { id: true } })
    if (!post) return null
    const existing = await tx.forumPostVote.findUnique({
      where: { postId_profileId: { postId: id, profileId: auth.profile.id } },
      select: { value: true },
    })
    const previous = existing?.value || 0
    const next = parsed.data.value
    if (next === 0) {
      if (existing) await tx.forumPostVote.delete({ where: { postId_profileId: { postId: id, profileId: auth.profile.id } } })
    } else {
      await tx.forumPostVote.upsert({
        where: { postId_profileId: { postId: id, profileId: auth.profile.id } },
        create: { postId: id, profileId: auth.profile.id, value: next },
        update: { value: next },
      })
    }
    const updated = await tx.forumPost.update({
      where: { id },
      data: { score: { increment: next - previous }, hotScore: { increment: next - previous } },
      select: { score: true },
    })
    return { score: updated.score, viewerVote: next }
  })
  if (!result) return forumJson(request, { error: 'not_found' }, { status: 404 }, 'POST, OPTIONS')
  return forumJson(request, result, undefined, 'POST, OPTIONS')
}

