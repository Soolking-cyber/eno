import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { requireTeacher } from '@/lib/classroom/guards'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/classroom/own-voice/sample — the sample line in the teacher's OWN voice (made by us when it became ready), to
 * its teacher only. Gone with the voice (404). Private, never stored by a shared cache.
 */
export const GET = route({ auth: 'profile', rateLimit: { bucket: 'classroom-own-voice-sample', limit: 120, window: '1 h' } }, async ({ profile }) => {
  const teacher = await requireTeacher(profile.id, { open: false })
  const row = await db.classroomVoice.findUnique({ where: { teacherProfileId: teacher.id }, select: { status: true, sample: true } })
  if (row?.status !== 'ready' || !row.sample) throw new ApiError('not_found', 404)
  return new Response(new Uint8Array(row.sample), { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, no-store' } })
})
