import { z } from 'zod'
import { db } from '@/lib/db'
import { getForumAuth } from '@/lib/forum/auth'
import { forumJson, forumPreflight, isAllowedForumOrigin } from '@/lib/forum/cors'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const reportSchema = z.object({
  postId: z.string().trim().min(5).max(100).nullable().optional(),
  commentId: z.string().trim().min(5).max(100).nullable().optional(),
  reason: z.enum(['spam', 'scam', 'harassment', 'hate', 'privacy', 'misinformation', 'off_topic', 'other']),
  detail: z.string().trim().max(2000).nullable().optional(),
}).refine((value) => Boolean(value.postId || value.commentId), { message: 'A report target is required' })

export function OPTIONS(request: Request) {
  return forumPreflight(request, 'POST, OPTIONS')
}

export async function POST(request: Request) {
  if (!isAllowedForumOrigin(request)) return forumJson(request, { error: 'origin_not_allowed' }, { status: 403 }, 'POST, OPTIONS')
  const auth = await getForumAuth(request)
  if (!auth) return forumJson(request, { error: 'auth_required' }, { status: 401 }, 'POST, OPTIONS')
  if (auth.profile.reportCooldownUntil && auth.profile.reportCooldownUntil > new Date()) {
    return forumJson(request, { error: 'report_cooldown' }, { status: 403 }, 'POST, OPTIONS')
  }
  const limit = await rateLimit('forum-report', auth.profile.id, 10, '1 h', { strict: true })
  if (!limit.success) return forumJson(request, { error: 'rate_limited' }, { status: 429 }, 'POST, OPTIONS')
  const parsed = reportSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return forumJson(request, { error: 'invalid_report', issues: parsed.error.issues }, { status: 400 }, 'POST, OPTIONS')
  const input = parsed.data

  const [post, comment] = await Promise.all([
    input.postId ? db.forumPost.findUnique({ where: { id: input.postId }, select: { id: true, authorProfileId: true } }) : null,
    input.commentId ? db.forumComment.findUnique({ where: { id: input.commentId }, select: { id: true, authorProfileId: true, postId: true } }) : null,
  ])
  if ((input.postId && !post) || (input.commentId && !comment)) return forumJson(request, { error: 'not_found' }, { status: 404 }, 'POST, OPTIONS')
  const targetProfileId = comment?.authorProfileId || post?.authorProfileId || null
  if (targetProfileId === auth.profile.id) return forumJson(request, { error: 'cannot_report_self' }, { status: 400 }, 'POST, OPTIONS')

  const existing = await db.forumReport.findFirst({
    where: {
      reporterProfileId: auth.profile.id,
      postId: input.postId || null,
      commentId: input.commentId || null,
      status: 'open',
    },
    select: { id: true },
  })
  if (existing) return forumJson(request, { reportId: existing.id, duplicate: true }, undefined, 'POST, OPTIONS')

  const report = await db.forumReport.create({
    data: {
      reporterProfileId: auth.profile.id,
      targetProfileId,
      postId: input.postId || null,
      commentId: input.commentId || null,
      reason: input.reason,
      detail: input.detail || null,
    },
    select: { id: true },
  })
  return forumJson(request, { reportId: report.id, duplicate: false }, { status: 201 }, 'POST, OPTIONS')
}

