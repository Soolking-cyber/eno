import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { classroomAudit } from '@/lib/classroom/audit'
import { readCapped } from '@/lib/classroom/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'private, no-store' }

/**
 * PATCH /api/classroom/learners/<id> — the account holder's controls over a learner they own (behind the parent gate in
 * the page): `{ action: 'leave', seatId }` leaves one class; `{ action: 'withdraw' }` withdraws the consents — practice
 * stops in every class. Either way the teacher loses the learner at once (the seat is removed) and the sweep erases the
 * seat's sessions LIMITS.removedRetentionDays later. ⛔ Never switched off by the classroom's mode: taking consent back
 * always works.
 */
export const PATCH = route({ auth: 'profile' }, async ({ req, profile, params }) => {
  const learner = await db.classroomLearner.findFirst({ where: { id: params.id, ownerId: profile.id }, select: { id: true } })
  if (!learner) throw new ApiError('learner_not_found', 404)
  const body = await readCapped(req, 1_000)
  const now = new Date()
  if (body.action === 'leave' && typeof body.seatId === 'string') {
    const n = await db.$transaction(async (tx) => {
      const r = await tx.classroomEnrollment.updateMany({
        where: { id: body.seatId as string, learnerId: learner.id, status: { in: ['active', 'paused'] } },
        data: { status: 'removed', removedAt: now, updatedAt: now },
      })
      if (r.count) await classroomAudit(tx, profile.id, 'classroom.learner.left', { learnerId: learner.id, seatId: body.seatId as string })
      return r.count
    })
    if (!n) throw new ApiError('seat_not_found', 404)
  } else if (body.action === 'withdraw') {
    await db.$transaction(async (tx) => {
      await classroomAudit(tx, profile.id, 'classroom.learner.withdrawn', { learnerId: learner.id })
      await tx.classroomLearner.update({ where: { id: learner.id }, data: { withdrawnAt: now, updatedAt: now } })
      await tx.classroomEnrollment.updateMany({ where: { learnerId: learner.id, status: { in: ['active', 'paused'] } }, data: { status: 'removed', removedAt: now, updatedAt: now } })
    })
  } else {
    throw new ApiError('bad_request', 400)
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
})

/**
 * DELETE /api/classroom/learners/<id> — delete the learner and EVERYTHING of theirs now: seats, sessions, transcripts,
 * reports, plans (database cascades). The parent's right over a child profile; no retention window.
 */
export const DELETE = route({ auth: 'profile' }, async ({ profile, params }) => {
  const learner = await db.classroomLearner.findFirst({ where: { id: params.id, ownerId: profile.id }, select: { id: true, kind: true } })
  if (!learner) throw new ApiError('learner_not_found', 404)
  await db.$transaction(async (tx) => {
    await classroomAudit(tx, profile.id, 'classroom.learner.deleted', { learnerId: learner.id, kind: learner.kind })
    await tx.classroomLearner.delete({ where: { id: learner.id } })
  })
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
})
