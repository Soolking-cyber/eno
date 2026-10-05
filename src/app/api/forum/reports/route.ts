import { z } from 'zod'
import { db } from '@/lib/db'
import { getForumAuth } from '@/lib/forum/auth'
import { forumJson, forumPreflight, isAllowedForumOrigin } from '@/lib/forum/cors'
import { rateLimit } from '@/lib/ratelimit'
import { appReviewGate } from '@/lib/app-review-gates'
import { reporterStanding } from '@/lib/enforcement-machine'
import { fileContentReport } from '@/lib/reported-content'
import { isContentId } from '@/lib/reported-content-pointer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const reportSchema = z.object({
  postId: z.string().trim().min(5).max(100).nullable().optional(),
  commentId: z.string().trim().min(5).max(100).nullable().optional(),
  reason: z.enum(['spam', 'scam', 'harassment', 'hate', 'privacy', 'misinformation', 'off_topic', 'other']),
  detail: z.string().trim().max(2000).nullable().optional(),
}).refine((value) => Boolean(value.postId || value.commentId), { message: 'A report target is required' })

/**
 * App Store gate `ugc-safety` (plan R5): the forum reasons, mapped onto the moderation queue's own. The
 * queue speaks Report's vocabulary (api/report REASONS); anything without a counterpart is 'other', and
 * the reporter's own words still travel in `detail`. Only the three reasons a content case takes on
 * /api/report (scam / offensive / other — opus, gate round 4): spam is 'other', not the 'severe' scam
 * (trust.ts severityForReason; round 2), and misinformation is 'other' too.
 */
const TO_REPORT_REASON: Record<z.infer<typeof reportSchema>['reason'], string> = {
  spam: 'other', scam: 'scam', harassment: 'offensive', hate: 'offensive', privacy: 'other', misinformation: 'other', off_topic: 'other', other: 'other',
}

export function OPTIONS(request: Request) {
  return forumPreflight(request, 'POST, OPTIONS')
}

// ⚠️ WS6 — NOT MIGRATED. Branches: 403 origin_not_allowed · 401 auth_required · 403 report_cooldown
// · 429 rate_limited · 400 invalid_report(+issues) · 404 not_found · 400 cannot_report_self · 200
// {reportId,duplicate:true} · 201 {reportId,duplicate:false}. Five blockers:
//   · THE LIMITER MUST RUN AFTER AN EARLY-OUT ON PROFILE STATE. `reportCooldownUntil` 403s a
//     cooled-down reporter BEFORE `forum-report` is consulted, so that caller never spends a token.
//     route()'s order is fixed at auth → rateLimit → handler, so hoisting the limiter would both
//     charge the cooled-down reporter and turn their 403 report_cooldown into 429 once the window
//     filled. The cooldown lives on the Profile row, which only the handler has.
//   · THE ERROR ENVELOPE IS NOT THE WRAPPER'S — a bad body answers
//     `{"error":"invalid_report","issues":[…]}`, and apiFail() emits only `{"error":"<code>"}`.
//   · THE ORIGIN GUARD RUNS BEFORE AUTH (403 origin_not_allowed to a guest, not 401).
//   · CORS ON EVERY RESPONSE: Access-Control-Allow-Methods: 'POST, OPTIONS', -Allow-Headers and
//     -Max-Age on all nine branches (+ -Allow-Origin and Vary: Origin for an allowlisted Origin).
//   · AUTH IS getForumAuth() (bearer or cookie; its bearer path fails closed on absent
//     Supabase env — NOT a cookies-only-wrapper issue, see forum/posts/[id]/route.ts:138).
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

  /**
   * ⛔ App Store gate `ugc-safety` (plan R5): FILED INTO THE MODERATION QUEUE, NOT INTO ForumReport.
   * Nothing in the app reads ForumReport — no admin surface lists it — so a report filed below reaches
   * no human (opus + agy, plan review). With the gate on, a help-centre report becomes the same CONTENT
   * case POST /api/report files (src/lib/reported-content.ts): /admin/moderation, the reporter's
   * /disputes, takedown on Confirm. The forum's own gates above (origin, auth, cooldown, rate limit) have
   * run; the reporter ladder's hard stop is added here because ForumReport never had one.
   * Answers keep this route's shape: 201 {reportId, duplicate:false} · 200 {reportId, duplicate:true} ·
   * 200 {reportId:null, duplicate:false} for a silent refile-cooldown accept. Off ⇒ exactly as before.
   */
  if (appReviewGate('ugc-safety')) {
    if (reporterStanding(auth.profile.falseReportStrikes) === 'blocked') return forumJson(request, { error: 'reporting_blocked' }, { status: 403 }, 'POST, OPTIONS')
    // Exactly one target, as /api/report requires — a body naming both is ambiguous about what is
    // reported, so it is refused rather than guessed (codex, gate round 1).
    if (input.postId && input.commentId) return forumJson(request, { error: 'invalid_report' }, { status: 400 }, 'POST, OPTIONS')
    const target = input.commentId ? { kind: 'help-comment' as const, id: input.commentId } : { kind: 'help-post' as const, id: input.postId ?? '' }
    if (!isContentId(target.id)) return forumJson(request, { error: 'not_found' }, { status: 404 }, 'POST, OPTIONS')
    const r = await fileContentReport({ id: auth.profile.id, falseReportStrikes: auth.profile.falseReportStrikes }, target, TO_REPORT_REASON[input.reason], input.detail || null)
    if (r.outcome === 'not_found') return forumJson(request, { error: 'not_found' }, { status: 404 }, 'POST, OPTIONS')
    if (r.outcome === 'cannot_report_self') return forumJson(request, { error: 'cannot_report_self' }, { status: 400 }, 'POST, OPTIONS')
    if (r.outcome === 'suppressed') return forumJson(request, { reportId: null, duplicate: false }, undefined, 'POST, OPTIONS')
    if (r.outcome === 'duplicate') return forumJson(request, { reportId: r.id, duplicate: true }, undefined, 'POST, OPTIONS')
    return forumJson(request, { reportId: r.id, duplicate: false }, { status: 201 }, 'POST, OPTIONS')
  }

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

