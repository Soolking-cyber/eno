import { z } from 'zod'
import { db } from '@/lib/db'
import { canParticipate, getForumAuth } from '@/lib/forum/auth'
import { forumJson, forumPreflight, isAllowedForumOrigin } from '@/lib/forum/cors'
import { forumAuthorSelect, serializeForumComment } from '@/lib/forum/serialize'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const commentSchema = z.object({
  postId: z.string().trim().min(5).max(100),
  parentId: z.string().trim().min(5).max(100).nullable().optional(),
  body: z.string().trim().min(1).max(10_000),
})

export function OPTIONS(request: Request) {
  return forumPreflight(request, 'POST, OPTIONS')
}

export async function POST(request: Request) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 }, 'POST, OPTIONS')
  const auth = await getForumAuth(request)
  if (!auth) return forumJson(request, { error: 'auth_required' }, { status: 401 }, 'POST, OPTIONS')
  if (!canParticipate(auth.profile)) return forumJson(request, { error: 'account_restricted' }, { status: 403 }, 'POST, OPTIONS')
  const limit = await rateLimit('forum-comment-create', auth.profile.id, 60, '1 h')
  if (!limit.success) return forumJson(request, { error: 'rate_limited' }, { status: 429 }, 'POST, OPTIONS')
  const parsed = commentSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return forumJson(request, { error: 'invalid_comment', issues: parsed.error.issues }, { status: 400 }, 'POST, OPTIONS')

  const input = parsed.data
  const post = await db.forumPost.findFirst({
    where: { id: input.postId, status: 'published' },
    select: { id: true, title: true, authorProfileId: true },
  })
  if (!post) return forumJson(request, { error: 'post_not_found_or_locked' }, { status: 404 }, 'POST, OPTIONS')

  const parent = input.parentId
    ? await db.forumComment.findFirst({
        where: { id: input.parentId, postId: input.postId, status: 'published' },
        select: { id: true, authorProfileId: true },
      })
    : null
  if (input.parentId && !parent) return forumJson(request, { error: 'parent_not_found' }, { status: 404 }, 'POST, OPTIONS')

  const commentId = await db.$transaction(async (tx) => {
    const comment = await tx.forumComment.create({
      data: {
        postId: input.postId,
        parentId: parent?.id || null,
        authorProfileId: auth.profile.id,
        authorName: auth.profile.displayName,
        body: input.body,
        score: 1,
        votes: { create: { profileId: auth.profile.id, value: 1 } },
      },
      select: { id: true },
    })
    await Promise.all([
      tx.forumPost.update({ where: { id: input.postId }, data: { commentCount: { increment: 1 }, hotScore: { increment: 0.25 } } }),
      tx.forumProfile.upsert({
        where: { profileId: auth.profile.id },
        create: { profileId: auth.profile.id, commentCount: 1 },
        update: { commentCount: { increment: 1 }, lastSeenAt: new Date() },
      }),
      tx.forumPostSubscription.upsert({
        where: { postId_profileId: { postId: input.postId, profileId: auth.profile.id } },
        create: { postId: input.postId, profileId: auth.profile.id },
        update: {},
      }),
      ...(parent ? [tx.forumComment.update({ where: { id: parent.id }, data: { replyCount: { increment: 1 } } })] : []),
    ])

    const recipientId = parent?.authorProfileId || post.authorProfileId
    if (recipientId && recipientId !== auth.profile.id) {
      const forumUrl = process.env.NEXT_PUBLIC_FORUM_URL || 'https://eno.forum'
      await tx.notification.create({
        data: {
          recipientId,
          type: 'forum_reply',
          title: parent ? 'New reply to your comment' : 'New reply to your post',
          body: input.body.slice(0, 180),
          actorName: auth.profile.displayName || 'eno member',
          url: `${forumUrl}/?post=${encodeURIComponent(input.postId)}`,
        },
      })
    }
    return comment.id
  })

  const created = await db.forumComment.findUniqueOrThrow({
    where: { id: commentId },
    include: {
      author: { select: forumAuthorSelect },
      votes: { where: { profileId: auth.profile.id }, select: { value: true } },
    },
  })
  return forumJson(request, { comment: { ...serializeForumComment(created), replies: [] } }, { status: 201 }, 'POST, OPTIONS')
}

