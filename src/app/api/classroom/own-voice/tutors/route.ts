import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { requireTeacher } from '@/lib/classroom/guards'
import { readCapped } from '@/lib/classroom/http'
import { LIMITS } from '@/lib/classroom/constants'
import { readyVoiceId } from '@/lib/classroom/own-voice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/classroom/own-voice/tutors { tutorIds, on } — which of the teacher's tutors speak in their own voice ("Use on my
 * tutors", and a tutor page's switch). On only while the voice is ready (the tutor names that voice); off always. Only the teacher's own tutors that are
 * not archived; each keeps its stock voice behind it. Returns the ids now speaking in it.
 */
export const POST = route({ auth: 'profile', rateLimit: { bucket: 'classroom-own-voice-tutors', limit: 120, window: '1 h' } }, async ({ req, profile }) => {
  const teacher = await requireTeacher(profile.id, { open: false })
  const body = await readCapped(req, 4_096)
  const ids = Array.isArray(body.tutorIds) ? body.tutorIds.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64) : null
  if (!ids || ids.length > LIMITS.tutorsPerTeacher || typeof body.on !== 'boolean') throw new ApiError('bad_request', 400)
  // On = THIS ready voice, by its id: if it is deleted in the same instant, the tutor names a voice that is gone and speaks
  // its stock voice — a voice made later is never switched on by it (commit gate, codex + opus).
  const ready = await readyVoiceId(teacher.id)
  if (body.on && !ready) throw new ApiError('voice_invalid', 409)
  await db.classroomAvatar.updateMany({ where: { id: { in: ids }, teacherProfileId: teacher.id, archivedAt: null }, data: { ownVoiceId: body.on ? ready : null } })
  const now = ready ? await db.classroomAvatar.findMany({ where: { teacherProfileId: teacher.id, archivedAt: null, ownVoiceId: ready }, select: { id: true } }) : []
  return NextResponse.json({ ownVoiceTutorIds: now.map((t) => t.id) }, { headers: { 'cache-control': 'private, no-store' } })
})
