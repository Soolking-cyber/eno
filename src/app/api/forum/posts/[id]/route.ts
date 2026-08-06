import { z } from 'zod'
import { db } from '@/lib/db'
import { canParticipate, getForumAuth } from '@/lib/forum/auth'
import { withheldHelpTopicSlugs } from '@/lib/help-center'
import { forumJson, forumPreflight, isAllowedForumOrigin } from '@/lib/forum/cors'
import {
  forumAuthorSelect,
  serializeForumComment,
  serializeForumPost,
  type ForumCommentDto,
} from '@/lib/forum/serialize'
import { rateLimit } from '@/lib/ratelimit'
import { logError } from '@/lib/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const editSchema = z.object({
  title: z.string().trim().min(8).max(140),
  body: z.string().trim().min(20).max(30_000),
})

export function OPTIONS(request: Request) {
  return forumPreflight(request, 'GET, PATCH, DELETE, OPTIONS')
}

function commentTree(rows: ReturnType<typeof serializeForumComment>[]): ForumCommentDto[] {
  const byId = new Map(rows.map((row) => [row.id, { ...row, replies: [] as ForumCommentDto[] }]))
  const roots: ForumCommentDto[] = []
  for (const row of byId.values()) {
    const parent = row.parentId ? byId.get(row.parentId) : null
    if (parent) parent.replies.push(row)
    else roots.push(row)
  }
  return roots
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getForumAuth(request)
  const viewerId = auth?.profile.id || '00000000-0000-0000-0000-000000000000'

  try {
    const post = await db.forumPost.findFirst({
      /**
       * ⚠️ EDITION-SCOPED, BECAUSE 404-ING THE PAGE IS NOT WITHHOLDING THE CONTENT.
       *
       * `/help/[id]` refuses services-only help topics on the marketplace edition, and this route
       * served the identical row to anyone who asked for it by id — same database, no community
       * filter, no edition test, and it IS compiled into the marketplace build. So eno.vn went on
       * serving the e-visa help article as JSON while its own page said 404: the licensed
       * marketplace publishing the content it is not licensed to offer, to exactly the automated
       * clients that do not render pages. CORS binds browsers; it does nothing to a crawler or a
       * curl. Found by a verification pass reading this file rather than curling it — line 74
       * increments viewCount, so probing would have written to production.
       *
       * `withheldHelpTopicSlugs()` is empty on the services edition, so eno.forum is unchanged.
       */
      where: {
        id,
        status: { in: ['published', 'locked'] },
        ...(withheldHelpTopicSlugs().length ? { communitySlug: { notIn: withheldHelpTopicSlugs() } } : {}),
      },
      include: {
        author: { select: forumAuthorSelect },
        media: { orderBy: { position: 'asc' } },
        votes: { where: { profileId: viewerId }, select: { value: true } },
        bookmarks: { where: { profileId: viewerId }, select: { postId: true } },
        comments: {
          where: { status: { in: ['published', 'removed'] } },
          orderBy: { createdAt: 'asc' },
          include: {
            author: { select: forumAuthorSelect },
            votes: { where: { profileId: viewerId }, select: { value: true } },
          },
        },
      },
    })
    if (!post) return forumJson(request, { error: 'not_found' }, { status: 404 }, 'GET, PATCH, DELETE, OPTIONS')

    if (auth && post.authorProfileId) {
      const blocked = await db.forumUserBlock.findFirst({
        where: {
          OR: [
            { blockerProfileId: auth.profile.id, blockedProfileId: post.authorProfileId },
            { blockerProfileId: post.authorProfileId, blockedProfileId: auth.profile.id },
          ],
        },
        select: { blockerProfileId: true },
      })
      if (blocked) return forumJson(request, { error: 'not_found' }, { status: 404 }, 'GET, PATCH, DELETE, OPTIONS')
    }

    void db.forumPost.update({ where: { id }, data: { viewCount: { increment: 1 } } }).catch((e) => logError(e, { op: 'forumPost.incrementViews' }))
    const comments = post.comments.map((comment) => serializeForumComment({
      ...comment,
      body: comment.status === 'removed' ? '[removed]' : comment.body,
      author: comment.status === 'removed' ? null : comment.author,
      authorName: comment.status === 'removed' ? null : comment.authorName,
      authorRole: comment.status === 'removed' ? null : comment.authorRole,
    }))
    return forumJson(request, {
      post: serializeForumPost(post),
      comments: commentTree(comments),
    }, undefined, 'GET, PATCH, DELETE, OPTIONS')
  } catch (error) {
    if ((error as { code?: string }).code === 'P2021') {
      return forumJson(request, { error: 'forum_schema_not_ready' }, { status: 503 }, 'GET, PATCH, DELETE, OPTIONS')
    }
    throw error
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 })
  const { id } = await params
  const auth = await getForumAuth(request)
  if (!auth) return forumJson(request, { error: 'auth_required' }, { status: 401 })
  if (!canParticipate(auth.profile)) return forumJson(request, { error: 'account_restricted' }, { status: 403 })
  const limit = await rateLimit('forum-post-edit', auth.profile.id, 30, '1 h')
  if (!limit.success) return forumJson(request, { error: 'rate_limited' }, { status: 429 })
  const parsed = editSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return forumJson(request, { error: 'invalid_post', issues: parsed.error.issues }, { status: 400 })

  const existing = await db.forumPost.findUnique({ where: { id }, select: { authorProfileId: true, title: true, body: true, status: true } })
  if (!existing || existing.status === 'removed') return forumJson(request, { error: 'not_found' }, { status: 404 })
  if (existing.authorProfileId !== auth.profile.id) return forumJson(request, { error: 'forbidden' }, { status: 403 })

  await db.$transaction([
    db.forumPostRevision.create({ data: { postId: id, editorProfileId: auth.profile.id, title: existing.title, body: existing.body } }),
    db.forumPost.update({ where: { id }, data: { ...parsed.data, editedAt: new Date() } }),
  ])
  return forumJson(request, { ok: true })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 })
  const { id } = await params
  const auth = await getForumAuth(request)
  if (!auth) return forumJson(request, { error: 'auth_required' }, { status: 401 })
  const existing = await db.forumPost.findUnique({ where: { id }, select: { authorProfileId: true, communitySlug: true, status: true } })
  if (!existing || existing.status === 'removed') return forumJson(request, { error: 'not_found' }, { status: 404 })
  if (existing.authorProfileId !== auth.profile.id) return forumJson(request, { error: 'forbidden' }, { status: 403 })

  // Claim atomically so two concurrent DELETEs can't both decrement the counters.
  const claimed = await db.forumPost.updateMany({
    where: { id, authorProfileId: auth.profile.id, status: { not: 'removed' } },
    data: { status: 'removed', title: '[removed]', body: '[removed]', editedAt: new Date() },
  })
  if (claimed.count === 1) {
    await db.$transaction([
      db.forumCommunity.update({ where: { slug: existing.communitySlug }, data: { postCount: { decrement: 1 } } }),
      db.forumProfile.update({ where: { profileId: auth.profile.id }, data: { postCount: { decrement: 1 } } }),
    ])
  }
  return forumJson(request, { ok: true })
}

