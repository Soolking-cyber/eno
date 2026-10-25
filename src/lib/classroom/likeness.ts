import 'server-only'
import { db } from '@/lib/db'

/**
 * THE LIKENESSES TO DELETE AT SPATIUS (plan "Erasure"). A teacher's 3D likeness lives in Spatius Studio, where no database
 * cascade reaches. ⛔ THE QUEUE IS FILLED BY THE DATABASE ITSELF — the ClassroomAvatar_queue_likeness trigger
 * (scripts/classroom-ddl.mjs) queues the old Spatius id whenever an avatar row is deleted (an account erasure, a teacher
 * deleting their teacher profile, anything) or its id replaced (a withdrawal) — so no caller can forget it. An admin
 * deletes it in Studio and ticks it off on /admin/classroom.
 */
export async function pendingLikenessDeletions() {
  try {
    return await db.$queryRaw<{ spatius_avatar_id: string; reason: string; queued_at: Date }[]>`
      SELECT spatius_avatar_id, reason, queued_at FROM public.classroom_likeness_deletion WHERE done_at IS NULL ORDER BY queued_at LIMIT 100`
  } catch (e) {
    // A database the classroom DDL has not reached yet has nothing queued.
    if (e instanceof Error && /42P01|classroom_likeness_deletion" does not exist/.test(e.message)) return []
    throw e
  }
}

export async function markLikenessDeleted(spatiusAvatarId: string, admin: string): Promise<number> {
  return db.$executeRaw`
    UPDATE public.classroom_likeness_deletion SET done_at = now(), done_by = ${admin} WHERE spatius_avatar_id = ${spatiusAvatarId} AND done_at IS NULL`
}
