import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { requireAvatar, requireTeacher } from '@/lib/classroom/guards'
import { readCapped } from '@/lib/classroom/http'
import { listSeats, newInvite, validateSeatSettings } from '@/lib/classroom/seats'
import { LIMITS } from '@/lib/classroom/constants'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'private, no-store' }

/** GET /api/classroom/seats — the teacher's roster (seats.ts listSeats). Readable while closed: the page explains. */
export const GET = route({ auth: 'profile' }, async ({ profile }) => {
  const teacher = await requireTeacher(profile.id, { open: false })
  const avatar = await db.classroomAvatar.findUnique({ where: { teacherProfileId: teacher.id }, select: { id: true } })
  return NextResponse.json({ seats: avatar ? await listSeats(avatar.id) : [] }, { headers: NO_STORE })
})

/**
 * POST /api/classroom/seats — "Add student": a seat with its settings and a one-use invite (owner: "teacher can assign
 * student accounts"). The teacher decides every seat; a learner can only take a seat the teacher made for them.
 */
export const POST = route({ auth: 'profile', rateLimit: { bucket: 'classroom-seat-create', limit: 60, window: '1 d' } }, async ({ req, profile }) => {
  const teacher = await requireTeacher(profile.id)
  const avatar = await requireAvatar(teacher.id)
  const v = validateSeatSettings(await readCapped(req, 4_000))
  if (!v.ok) throw new ApiError(v.code, 400)
  const seat = await db.$transaction(async (tx) => {
    // The seat cap under the avatar's own lock, so two quick taps cannot both pass the count.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`eno-classroom-seats:${avatar.id}`}, 0))`
    const count = await tx.classroomEnrollment.count({ where: { avatarId: avatar.id, status: { not: 'removed' } } })
    if (count >= LIMITS.seatsPerTeacher) throw new ApiError('seat_limit', 409)
    return tx.classroomEnrollment.create({ data: { avatarId: avatar.id, ...v.value, ...newInvite() }, select: { id: true } })
  })
  return NextResponse.json({ id: seat.id, seats: await listSeats(avatar.id) }, { status: 201, headers: NO_STORE })
})
