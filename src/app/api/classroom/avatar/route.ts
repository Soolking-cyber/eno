import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { AVATAR_SELECT, saveAvatar, validateAvatar } from '@/lib/classroom/avatar'
import { requireTeacher } from '@/lib/classroom/guards'
import { defaultVoice, voiceById, voiceFor } from '@/lib/classroom/voices'
import { DEFAULT_TRAITS } from '@/lib/classroom/persona'
import { readCapped } from '@/lib/classroom/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'cache-control': 'private, no-store' }
const MAX_BODY_BYTES = 16_000

/**
 * GET /api/classroom/avatar — the teacher's avatar, or the defaults a new one starts from (their profile's name, photo,
 * and the voice of their own accent). Readable while the classroom is closed for them: the wizard says so itself.
 */
export const GET = route({ auth: 'profile' }, async ({ profile }) => {
  const teacher = await requireTeacher(profile.id, { open: false })
  const saved = await db.classroomAvatar.findUnique({ where: { teacherProfileId: teacher.id }, select: AVATAR_SELECT })
  // A voice saved before the switch to eno's own voices (2026-10-26, an Azure id) is on no list now: the wizard shows the
  // voice the lessons speak with (voiceFor — same gender and accent group), so the next save is valid and nothing changes
  // under the teacher (codex + opus, commit review).
  const avatar = saved && !voiceById(saved.voice) ? { ...saved, voice: (voiceFor(saved.voice) ?? defaultVoice(teacher.nationality)).id } : saved
  return NextResponse.json({
    teacher: { fullName: teacher.fullName, photoUrl: teacher.photoUrl, nationality: teacher.nationality },
    avatar,
    defaults: { name: firstName(teacher.fullName), voice: defaultVoice(teacher.nationality).id, traits: DEFAULT_TRAITS },
  }, { headers: NO_STORE })
})

/** PUT /api/classroom/avatar — create or update the avatar (validate.ts rules; the text screen on every free text). */
export const PUT = route({ auth: 'profile', rateLimit: { bucket: 'classroom-avatar', limit: 60, window: '1 h' } }, async ({ req, profile }) => {
  const teacher = await requireTeacher(profile.id)
  const body = await readCapped(req, MAX_BODY_BYTES)
  const current = await db.classroomAvatar.findUnique({ where: { teacherProfileId: teacher.id }, select: { customStatus: true } })
  const v = validateAvatar(body, current?.customStatus ?? 'none')
  if (!v.ok) throw new ApiError(v.code, 400)
  const avatar = await saveAvatar(teacher.id, v.value)
  return NextResponse.json({ avatar }, { headers: NO_STORE })
})

/** "Anna Smith" → "Anna": the name the avatar starts with ("Ms"/"Mr" is the teacher's to add). */
function firstName(full: string): string {
  return full.trim().split(/\s+/)[0]?.slice(0, 40) ?? ''
}
