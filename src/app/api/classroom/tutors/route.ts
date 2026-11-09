import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { validateAvatar } from '@/lib/classroom/avatar'
import { requireTeacher } from '@/lib/classroom/guards'
import { readCapped } from '@/lib/classroom/http'
import { LIMITS } from '@/lib/classroom/constants'
import { createTutor, listTutors, tutorDefaults, withListedVoice } from '@/lib/classroom/tutors'

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
  return NextResponse.json({
    teacher: { fullName: teacher.fullName, photoUrl: teacher.photoUrl, nationality: teacher.nationality },
    tutors: tutors.map((t) => withListedVoice(t, teacher.nationality)),
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
  const tutor = await createTutor(teacher.id, v.value)
  return NextResponse.json({ tutor }, { status: 201, headers: NO_STORE })
})
