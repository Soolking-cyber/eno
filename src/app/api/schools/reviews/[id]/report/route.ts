// POST /api/schools/reviews/[id]/report — a report on a review.
// ⛔ NEVER HIDES ANYTHING BY ITSELF (plan review: three throwaway accounts must not be able to delete
// criticism). It lands in the admin Schools queue, where the reporter's trust is shown.
import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'
import { REPORT_REASONS } from '@/lib/schools/constants'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(
  {
    auth: 'profile',
    rateLimit: { bucket: 'school-report', limit: 20, window: '1 h', strict: true },
    body: z.object({ reason: z.enum(REPORT_REASONS), detail: z.string().trim().max(1000).optional() }),
  },
  async ({ profile, body, params }) => {
    const review = await db.schoolReview.findFirst({ where: { id: params.id, status: 'published', school: { status: 'active' } }, select: { id: true, schoolId: true, profileId: true } })
    if (!review) throw new ApiError('not_found', 404)
    if (review.profileId === profile.id) throw new ApiError('cannot_report_self', 400)
    const dup = await db.schoolReport.findFirst({ where: { reviewId: review.id, reporterProfileId: profile.id, status: 'open' }, select: { id: true } })
    if (dup) return { ok: true, duplicate: true }
    await db.schoolReport.create({
      data: { kind: 'review_report', schoolId: review.schoolId, reviewId: review.id, reporterProfileId: profile.id, reason: body.reason, detail: body.detail || null },
    })
    return { ok: true }
  },
)
