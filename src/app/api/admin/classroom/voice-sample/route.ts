import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/admin/classroom/voice-sample?teacher=<teacherProfileId> — a teacher's own-voice sample, for an admin's review. */
export const GET = route({ auth: 'admin' }, async ({ req }) => {
  const teacher = new URL(req.url).searchParams.get('teacher') ?? ''
  if (!teacher || teacher.length > 64) throw new ApiError('bad_request', 400)
  const row = await db.classroomVoice.findUnique({ where: { teacherProfileId: teacher }, select: { status: true, sample: true } })
  if (row?.status !== 'ready' || !row.sample) throw new ApiError('not_found', 404)
  return new Response(new Uint8Array(row.sample), { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, no-store' } })
})
