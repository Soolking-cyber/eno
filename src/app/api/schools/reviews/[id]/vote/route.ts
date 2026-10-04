// POST /api/schools/reviews/[id]/vote — "helpful" ▲ / ▼ / clear on a PUBLISHED review.
// Counted at read time with the same eligibility as school votes. Nobody votes on their own review.
import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'
import { writeEligibility } from '@/lib/schools/queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(
  {
    auth: 'profile',
    rateLimit: { bucket: 'school-review-vote', limit: 120, window: '1 h' },
    body: z.object({ value: z.union([z.literal(1), z.literal(-1), z.literal(0)]) }),
  },
  async ({ profile, body, params }) => {
    const review = await db.schoolReview.findFirst({ where: { id: params.id }, select: { id: true, profileId: true, status: true, school: { select: { status: true, seller: { select: { ownerId: true } } } } } })
    // Taking a helpful vote back works whatever the review's state; casting one needs it public.
    if (!review || (body.value !== 0 && (review.status !== 'published' || review.school.status !== 'active'))) throw new ApiError('not_found', 404)
    if (body.value === 0) { // taking it back is always allowed (see the school vote route)
      await db.schoolReviewVote.deleteMany({ where: { reviewId: review.id, profileId: profile.id } })
      return { ok: true, value: 0 }
    }
    // Not on your own review, and not by the school's own shop owner on reviews of their school.
    if (review.profileId === profile.id || review.school.seller?.ownerId === profile.id) throw new ApiError('forbidden', 403)
    const gate = writeEligibility(profile)
    if (!gate.ok) {
      // Each code spelled out as a literal: errors.test.ts harvests the wire vocabulary from literals.
      if (gate.code === 'business_account') throw new ApiError('business_account', 403)
      if (gate.code === 'phone_required') throw new ApiError('phone_required', 403)
      throw new ApiError('account_restricted', 403)
    }
    await db.schoolReviewVote.upsert({
      where: { reviewId_profileId: { reviewId: review.id, profileId: profile.id } },
      create: { reviewId: review.id, profileId: profile.id, value: body.value },
      update: { value: body.value },
    })
    return { ok: true, value: body.value, countsNow: gate.countsNow }
  },
)
