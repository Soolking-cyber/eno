import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { validateAvatar } from '@/lib/classroom/avatar'
import { requireTeacher } from '@/lib/classroom/guards'
import { readCapped } from '@/lib/classroom/http'
import { LIMITS } from '@/lib/classroom/constants'
import { okRoomIds, roomOf } from '@/lib/classroom/backgrounds-upload'
import { createTutor, listTutors, tutorDefaults, withListedVoice, backgroundOfTeacher } from '@/lib/classroom/tutors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'private, no-store' }

/**
 * GET /api/classroom/tutors — the teacher's tutors (oldest first, archived ones left out), the defaults a new one starts
 * from, and how many they may keep. Readable while the classroom is closed for them: the pages say so themselves.
 */
export const GET = route({ auth: 'profile' }, async ({ profile }) => {
  const teacher = await requireTeacher(profile.id, { open: false })
  const tutors = await listTutors(teacher.id)
  const okRooms = await okRoomIds(tutors.map((t) => t.backgroundId))
  return NextResponse.json({
    teacher: { fullName: teacher.fullName, photoUrl: teacher.photoUrl, nationality: teacher.nationality },
    // A room taken down (or deleted) is not handed back: the wizard would show a dead picture and send an id a save refuses.
    tutors: tutors.map((t) => ({ ...withListedVoice(t, teacher.nationality), ...roomOf(t, okRooms), backgroundId: t.backgroundId && okRooms.has(t.backgroundId) ? t.backgroundId : null })),
    defaults: tutorDefaults(teacher),
    limit: LIMITS.tutorsPerTeacher,
  }, { headers: NO_STORE })
})

/** POST /api/classroom/tutors — make a tutor (avatar.ts validateAvatar: the text screen on every free text; tutors.ts caps). */
export const POST = route({ auth: 'profile', rateLimit: { bucket: 'classroom-avatar', limit: 60, window: '1 h' } }, async ({ req, profile }) => {
  const teacher = await requireTeacher(profile.id)
  // A new tutor has no likeness of its own: the 3D own-face look is never one it can start with.
  const v = validateAvatar(await readCapped(req, 16_000), 'none')
  if (!v.ok) throw new ApiError(v.code, 400)
  // Only one of the teacher's own uploaded rooms, still ok — never another teacher's, never one taken down.
  if (v.value.backgroundId && !(await backgroundOfTeacher(v.value.backgroundId, teacher.id))) throw new ApiError('background_not_found', 400)
  const tutor = await createTutor(teacher.id, v.value)
  return NextResponse.json({ tutor }, { status: 201, headers: NO_STORE })
})
