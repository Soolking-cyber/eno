import 'server-only'
import { ApiError } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { classroomOpenFor } from './config'
import { teacherForClassroom } from './avatar'

/**
 * The two questions every teacher route asks first: is this account a teacher (a TeacherProfile), and is the classroom
 * open for them (config.ts — off / staff / allowlist / all). ⛔ Both are asked on the SERVER on every write; the client's
 * view of either is a hint.
 */
export async function requireTeacher(profileId: string, opts: { open?: boolean } = { open: true }) {
  const teacher = await teacherForClassroom(profileId)
  if (!teacher) throw new ApiError('teacher_profile_required', 403)
  if (opts.open !== false && !(await classroomOpenFor(profileId)).open) throw new ApiError('classroom_closed', 403)
  return teacher
}

/** The teacher's avatar, required (seats and tests hang off it). */
export async function requireAvatar(teacherProfileId: string) {
  const avatar = await db.classroomAvatar.findUnique({ where: { teacherProfileId } })
  if (!avatar) throw new ApiError('avatar_required', 409)
  return avatar
}
