import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { requireTeacher } from '@/lib/classroom/guards'
import { readCapped } from '@/lib/classroom/http'
import { listSeats, newInvite, validateSeatSettings } from '@/lib/classroom/seats'
import { LIMITS } from '@/lib/classroom/constants'
import { defaultTutor, teacherLock, tutorOfTeacher } from '@/lib/classroom/tutors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'private, no-store' }

/** GET /api/classroom/seats — the teacher's roster (seats.ts listSeats). Readable while closed: the page explains. */
export const GET = route({ auth: 'profile' }, async ({ profile }) => {
  const teacher = await requireTeacher(profile.id, { open: false })
  return NextResponse.json({ seats: await listSeats(teacher.id) }, { headers: NO_STORE })
})

/**
 * POST /api/classroom/seats — "Add student": a seat with its settings, its tutor (`tutorId`, one of the teacher's own; the
 * oldest when left out) and a one-use invite (owner: "teacher can assign student accounts"). The teacher decides every
 * seat; a learner can only take a seat the teacher made for them.
 */
export const POST = route({ auth: 'profile', rateLimit: { bucket: 'classroom-seat-create', limit: 60, window: '1 d' } }, async ({ req, profile }) => {
  const teacher = await requireTeacher(profile.id)
  const body = await readCapped(req, 4_000)
  const v = validateSeatSettings(body)
  if (!v.ok) throw new ApiError(v.code, 400)
  const seat = await db.$transaction(async (tx) => {
    // The seat cap under the teacher's lock (tutors.ts), so two quick taps cannot both pass the count, and the tutor read
    // under it cannot be archived before the seat names it.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${teacherLock(teacher.id)}, 0))`
    const tutor = body.tutorId === undefined ? await defaultTutor(teacher.id, tx) : await tutorOfTeacher(body.tutorId, teacher.id, tx)
    if (!tutor) throw new ApiError(body.tutorId === undefined ? 'avatar_required' : 'tutor_not_found', body.tutorId === undefined ? 409 : 404)
    const count = await tx.classroomEnrollment.count({ where: { avatar: { teacherProfileId: teacher.id }, status: { not: 'removed' } } })
    if (count >= LIMITS.seatsPerTeacher) throw new ApiError('seat_limit', 409)
    return tx.classroomEnrollment.create({ data: { avatarId: tutor.id, ...v.value, ...newInvite() }, select: { id: true } })
  })
  return NextResponse.json({ id: seat.id, seats: await listSeats(teacher.id) }, { status: 201, headers: NO_STORE })
})
