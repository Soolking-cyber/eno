import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { requireTeacher } from '@/lib/classroom/guards'
import { readCapped } from '@/lib/classroom/http'
import { listSeats, newInvite, seatOfTeacher, settingsOf, validateSeatSettings } from '@/lib/classroom/seats'
import { teacherLock, tutorOfTeacher } from '@/lib/classroom/tutors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'private, no-store' }

/**
 * PATCH /api/classroom/seats/<id> — the teacher changes a seat: its settings, its tutor (`tutorId`, one of their own — the
 * next session meets it; a session already running keeps the tutor it started with), pause/resume (`status`), or a fresh
 * invite (`reinvite: true`, for a seat nobody has claimed — the old code stops working at once).
 */
export const PATCH = route({ auth: 'profile', rateLimit: { bucket: 'classroom-seat-edit', limit: 300, window: '1 h' } }, async ({ req, profile, params }) => {
  const teacher = await requireTeacher(profile.id)
  const seat = await seatOfTeacher(params.id, teacher.id)
  if (!seat || seat.status === 'removed') throw new ApiError('seat_not_found', 404)
  const body = await readCapped(req, 4_000)
  const v = validateSeatSettings(body, settingsOf(seat))
  if (!v.ok) throw new ApiError(v.code, 400)
  let status = seat.status
  if (body.status === 'paused' && seat.status === 'active') status = 'paused'
  else if (body.status === 'active' && seat.status === 'paused') status = 'active'
  else if (body.status !== undefined && body.status !== seat.status) throw new ApiError('bad_request', 400)
  const invite = body.reinvite === true ? (seat.status === 'invited' ? newInvite() : null) : undefined
  if (invite === null) throw new ApiError('bad_request', 400)
  // ⛔ ONLY WHILE THE SEAT IS STILL WHAT WAS READ (2c round 1, codex): a learner who left meanwhile stays gone (the saved
  // status never brings them back), and a seat claimed meanwhile is never re-invited.
  // ⛔ A NEW TUTOR UNDER THE TEACHER'S LOCK (tutors.ts): it cannot be archived between this read and the write.
  const written = await db.$transaction(async (tx) => {
    let avatarId = seat.avatarId
    if (body.tutorId !== undefined) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${teacherLock(teacher.id)}, 0))`
      const tutor = await tutorOfTeacher(body.tutorId, teacher.id, tx)
      if (!tutor) throw new ApiError('tutor_not_found', 404)
      avatarId = tutor.id
    }
    return tx.classroomEnrollment.updateMany({
      where: { id: seat.id, avatarId: seat.avatarId, status: seat.status },
      data: { ...v.value, avatarId, status, ...(invite ?? {}), updatedAt: new Date() },
    })
  })
  if (!written.count) throw new ApiError('seat_inactive', 409)
  return NextResponse.json({ seats: await listSeats(teacher.id) }, { headers: NO_STORE })
})

/**
 * DELETE /api/classroom/seats/<id> — remove the seat. The learner loses the class and the teacher loses the learner's
 * reports at once (report.ts); the learner keeps their own history until the sweep erases the seat's sessions, reports and
 * plans LIMITS.removedRetentionDays later (sweep.ts).
 */
export const DELETE = route({ auth: 'profile' }, async ({ profile, params }) => {
  const teacher = await requireTeacher(profile.id, { open: false })
  const seat = await seatOfTeacher(params.id, teacher.id)
  if (!seat || seat.status === 'removed') throw new ApiError('seat_not_found', 404)
  // An invite nobody claimed holds no learner data — it simply goes; but only if it is STILL unclaimed (2c round 1, codex +
  // opus): one claimed since the read is removed like any claimed seat, never deleted with the family's join.
  const gone = seat.status === 'invited' ? (await db.classroomEnrollment.deleteMany({ where: { id: seat.id, status: 'invited' } })).count : 0
  if (!gone) {
    await db.classroomEnrollment.updateMany({
      where: { id: seat.id, status: { in: ['active', 'paused'] } },
      data: { status: 'removed', removedAt: new Date(), inviteCode: null, updatedAt: new Date() },
    })
  }
  return NextResponse.json({ seats: await listSeats(teacher.id) }, { headers: NO_STORE })
})
