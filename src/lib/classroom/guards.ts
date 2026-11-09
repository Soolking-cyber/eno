import 'server-only'
import { ApiError } from '@/lib/api/handler'
import { classroomOpenFor } from './config'
import { teacherForClassroom } from './avatar'
import { defaultTutor } from './tutors'

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

/** The teacher's default tutor (the oldest not archived), required: a teacher with no tutor has no class yet. */
export async function requireDefaultTutor(teacherProfileId: string) {
  const avatar = await defaultTutor(teacherProfileId)
  if (!avatar) throw new ApiError('avatar_required', 409)
  return avatar
}
