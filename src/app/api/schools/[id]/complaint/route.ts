// POST /api/schools/[id]/complaint — the channel for a school (right of reply / correction / takedown
// request). Lands in the admin Schools queue with a 24 h due-by; staff answer at `contactEmail` and can
// publish the school's response under a review.
// ⚠️ THE SENDER IS NOT VERIFIED HERE — anyone signed in can use it (diff review, both seats). The admin
// card says whether the email is on the school's own website domain, and staff confirm by email before
// acting on a removal or publishing a response. Nothing here hides or changes a review by itself.
import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(
  {
    auth: 'profile',
    rateLimit: { bucket: 'school-complaint', limit: 5, window: '1 h', strict: true },
    body: z.object({
      reviewId: z.string().max(40).optional(),
      reason: z.enum(['reply', 'correction', 'removal_request', 'directory_details']),
      detail: z.string().trim().min(20).max(3000),
      contactEmail: z.string().trim().email().max(200),
    }),
  },
  async ({ profile, body, params }) => {
    const school = await db.school.findFirst({ where: { id: params.id }, select: { id: true } })
    if (!school) throw new ApiError('not_found', 404)
    let reviewId: string | null = null
    if (body.reviewId) {
      const r = await db.schoolReview.findFirst({ where: { id: body.reviewId, schoolId: school.id }, select: { id: true } })
      if (!r) throw new ApiError('not_found', 404)
      reviewId = r.id
    }
    await db.schoolReport.create({
      data: { kind: 'school_complaint', schoolId: school.id, reviewId, reporterProfileId: profile.id, reason: body.reason, detail: body.detail, contactEmail: body.contactEmail },
    })
    return { ok: true }
  },
)
