import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { AVATAR_SELECT, validateAvatar } from '@/lib/classroom/avatar'
import { requireTeacher } from '@/lib/classroom/guards'
import { readCapped } from '@/lib/classroom/http'
import { createTutor, defaultTutor, tutorDefaults, updateTutor, withListedVoice } from '@/lib/classroom/tutors'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'private, no-store' }
const MAX_BODY_BYTES = 16_000

/**
 * GET /api/classroom/avatar — the teacher's DEFAULT tutor (the oldest not archived), or the defaults a new one starts from
 * (their profile's name, photo, and the voice of their own accent). Readable while the classroom is closed for them: the
 * wizard says so itself. Several tutors since 2026-11-09: /api/classroom/tutors is the full list; this stays for the first
 * tutor and for a page opened before the change.
 */
export const GET = route({ auth: 'profile' }, async ({ profile }) => {
  const teacher = await requireTeacher(profile.id, { open: false })
  const first = await defaultTutor(teacher.id)
  const saved = first && (await db.classroomAvatar.findUnique({ where: { id: first.id }, select: AVATAR_SELECT }))
  return NextResponse.json({
    teacher: { fullName: teacher.fullName, photoUrl: teacher.photoUrl, nationality: teacher.nationality },
    avatar: saved && withListedVoice(saved, teacher.nationality),
    defaults: tutorDefaults(teacher),
  }, { headers: NO_STORE })
})

/** PUT /api/classroom/avatar — save the default tutor, or make the first one (validate.ts rules; the text screen on every free text). */
export const PUT = route({ auth: 'profile', rateLimit: { bucket: 'classroom-avatar', limit: 60, window: '1 h' } }, async ({ req, profile }) => {
  const teacher = await requireTeacher(profile.id)
  const body = await readCapped(req, MAX_BODY_BYTES)
  const current = await defaultTutor(teacher.id)
  const v = validateAvatar(body, current?.customStatus ?? 'none')
  if (!v.ok) throw new ApiError(v.code, 400)
  const avatar = current ? await updateTutor(teacher.id, current.id, v.value) : await createTutor(teacher.id, v.value)
  return NextResponse.json({ avatar }, { headers: NO_STORE })
})
