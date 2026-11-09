import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { requireTeacher } from '@/lib/classroom/guards'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * DELETE /api/classroom/backgrounds/<id> — the teacher removes one of their own rooms. Its tutors fall back to their library
 * room at once (backgrounds-upload.ts roomOf); the picture stops being served. Allowed whatever the classroom's mode.
 */
export const DELETE = route({ auth: 'profile' }, async ({ profile, params }) => {
  const teacher = await requireTeacher(profile.id, { open: false })
  const done = await db.classroomBackground.updateMany({
    where: { id: String(params.id ?? ''), teacherProfileId: teacher.id, status: 'ok' },
    data: { status: 'removed', removedBy: 'teacher', removedAt: new Date() },
  })
  if (!done.count) throw new ApiError('background_not_found', 404)
  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'private, no-store' } })
})
