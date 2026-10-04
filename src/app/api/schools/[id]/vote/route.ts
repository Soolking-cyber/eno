// POST /api/schools/[id]/vote — ▲ / ▼ / clear on a school (2026-10-04).
// Body: { value: 1 | -1 | 0, confirm?: true }. `confirm` is the "I've worked or interviewed here as a
// teacher" tick, required for a non-zero vote. The vote is STORED at once and COUNTED at read time only
// while the account is eligible (src/lib/schools/queries.ts) — so the answer says whether it counts yet.
import { z } from 'zod'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'
import { writeEligibility } from '@/lib/schools/queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = route(
  {
    auth: 'profile',
    // Voting through a whole list is legitimate; 120/h per account still stops a script.
    rateLimit: { bucket: 'school-vote', limit: 120, window: '1 h' },
    body: z.object({ value: z.union([z.literal(1), z.literal(-1), z.literal(0)]), confirm: z.literal(true).optional() }),
  },
  async ({ profile, body, params }) => {
    // Any status: a vote can be TAKEN BACK even while the school is hidden; only a new vote needs it active.
    const school = await db.school.findFirst({ where: { id: params.id }, select: { id: true, status: true, seller: { select: { ownerId: true } } } })
    if (!school || (body.value !== 0 && school.status !== 'active')) throw new ApiError('not_found', 404)
    // Taking a vote BACK is always allowed — for an account that has since become ineligible, and for one
    // that has since come to own the school's shop: a vote left stored against its owner's wish would
    // start counting again the day the rule stops excluding it.
    if (body.value === 0) {
      await db.schoolVote.deleteMany({ where: { schoolId: school.id, profileId: profile.id } })
      return { ok: true, value: 0 }
    }
    // The school's own shop owner is refused HERE, not only uncounted at read time: a stored vote would
    // start counting the day the shop is unlinked (codex, diff review).
    if (school.seller?.ownerId === profile.id) throw new ApiError('forbidden', 403)
    const gate = writeEligibility(profile)
    if (!gate.ok) {
      // Each code spelled out as a literal: errors.test.ts harvests the wire vocabulary from literals.
      if (gate.code === 'business_account') throw new ApiError('business_account', 403)
      if (gate.code === 'phone_required') throw new ApiError('phone_required', 403)
      throw new ApiError('account_restricted', 403)
    }
    if (!body.confirm) throw new ApiError('stint_required', 400)
    await db.schoolVote.upsert({
      where: { schoolId_profileId: { schoolId: school.id, profileId: profile.id } },
      create: { schoolId: school.id, profileId: profile.id, value: body.value },
      update: { value: body.value },
    })
    return { ok: true, value: body.value, countsNow: gate.countsNow, countsFrom: gate.countsFrom.toISOString() }
  },
)
