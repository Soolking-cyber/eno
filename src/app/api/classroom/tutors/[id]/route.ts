import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { AVATAR_SELECT, validateAvatar } from '@/lib/classroom/avatar'
import { requireTeacher } from '@/lib/classroom/guards'
import { readCapped } from '@/lib/classroom/http'
import { archiveTutor, tutorDefaults, tutorOfTeacher, updateTutor, withListedVoice, backgroundOfTeacher } from '@/lib/classroom/tutors'
import { classroomOpenFor } from '@/lib/classroom/config'
import { okRoomIds, roomOf } from '@/lib/classroom/backgrounds-upload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'private, no-store' }

/** GET /api/classroom/tutors/<id> — one of the caller's own tutors (never another teacher's: tutors.ts tutorOfTeacher). */
export const GET = route({ auth: 'profile' }, async ({ profile, params }) => {
  const teacher = await requireTeacher(profile.id, { open: false })
  const found = await tutorOfTeacher(params.id, teacher.id)
  if (!found) throw new ApiError('tutor_not_found', 404)
  const [tutor, students, open] = await Promise.all([
    db.classroomAvatar.findUniqueOrThrow({ where: { id: found.id }, select: AVATAR_SELECT }),
    db.classroomEnrollment.count({ where: { avatarId: found.id, status: { not: 'removed' } } }),
    classroomOpenFor(profile.id).then((r) => r.open),
  ])
  const okRooms = await okRoomIds([tutor.backgroundId])
  return NextResponse.json({
    teacher: { fullName: teacher.fullName, photoUrl: teacher.photoUrl, nationality: teacher.nationality, open },
    // A room taken down (or deleted) is not handed back: the wizard would show a dead picture and send an id a save refuses.
    tutor: { ...withListedVoice(tutor, teacher.nationality), ...roomOf(tutor, okRooms), backgroundId: tutor.backgroundId && okRooms.has(tutor.backgroundId) ? tutor.backgroundId : null, students },
    defaults: tutorDefaults(teacher),
  }, { headers: NO_STORE })
})

/** PUT /api/classroom/tutors/<id> — save a tutor (the same rules as making one). */
export const PUT = route({ auth: 'profile', rateLimit: { bucket: 'classroom-avatar', limit: 60, window: '1 h' } }, async ({ req, profile, params }) => {
  const teacher = await requireTeacher(profile.id)
  const found = await tutorOfTeacher(params.id, teacher.id)
  if (!found) throw new ApiError('tutor_not_found', 404)
  const v = validateAvatar(await readCapped(req, 16_000), found.customStatus)
  if (!v.ok) throw new ApiError(v.code, 400)
  // Only one of the teacher's own uploaded rooms, still ok — never another teacher's, never one taken down.
  if (v.value.backgroundId && !(await backgroundOfTeacher(v.value.backgroundId, teacher.id))) throw new ApiError('background_not_found', 400)
  const tutor = await updateTutor(teacher.id, found.id, v.value)
  return NextResponse.json({ tutor }, { headers: NO_STORE })
})

/**
 * DELETE /api/classroom/tutors/<id> — archive the tutor (never deleted: its sessions and reports keep naming it). Refused
 * while a student still has it, or while it holds the teacher's own face (tutors.ts archiveTutor). Allowed whatever the
 * classroom's mode — tidying up is never switched off.
 */
export const DELETE = route({ auth: 'profile' }, async ({ profile, params }) => {
  const teacher = await requireTeacher(profile.id, { open: false })
  if (typeof params.id !== 'string') throw new ApiError('tutor_not_found', 404)
  await archiveTutor(teacher.id, params.id)
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
})
