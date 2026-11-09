import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { requireTeacher } from '@/lib/classroom/guards'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * DELETE /api/classroom/backgrounds/<id> — the teacher removes one of their own rooms: the row and its picture are DELETED
 * (commit gate, codex + opus — "Remove this photo" means gone, and removed rows must not pile up). Its tutors fall back to
 * their library room at once (no FK: backgrounds-upload.ts roomOf). An admin takedown is different: it keeps the row,
 * marked removed, for the audit trail. Allowed whatever the classroom's mode.
 */
export const DELETE = route({ auth: 'profile' }, async ({ profile, params }) => {
  const teacher = await requireTeacher(profile.id, { open: false })
  const done = await db.classroomBackground.deleteMany({ where: { id: String(params.id ?? ''), teacherProfileId: teacher.id, status: 'ok' } })
  if (!done.count) throw new ApiError('background_not_found', 404)
  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'private, no-store' } })
})
