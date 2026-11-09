import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { isStaffProfile } from '@/lib/user-blocks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/classroom/backgrounds/<id>/image[?size=thumb] — an uploaded room's picture, ONLY to: its teacher; an account whose
 * learner has a seat (active or paused) in that teacher's class — any of their tutors, so a session started before the teacher
 * switched rooms keeps its picture (commit gate, codex); every upload passed the same check — and admins (the takedown queue). Anyone
 * else — and a removed picture, for everyone but admins — gets 404 (never "forbidden": an id says nothing).
 * ⛔ Private cache only, short: a removed picture stops showing within minutes even in a browser that had it.
 */
export const GET = route({ auth: 'profile', rateLimit: { bucket: 'classroom-background-image', limit: 600, window: '1 h' } }, async ({ req, profile, params }) => {
  const id = String(params.id ?? '')
  if (!id || id.length > 64) throw new ApiError('background_not_found', 404)
  const thumb = new URL(req.url).searchParams.get('size') === 'thumb'
  const bg = await db.classroomBackground.findUnique({ where: { id }, select: { teacherProfileId: true, status: true, teacherProfile: { select: { profileId: true } } } })
  if (!bg) throw new ApiError('background_not_found', 404)
  const staff = await isStaffProfile(profile.id).catch(() => false)
  let allowed = staff
  if (!allowed && bg.status === 'ok') {
    allowed = bg.teacherProfile.profileId === profile.id || !!(await db.classroomEnrollment.findFirst({
      where: { status: { in: ['active', 'paused'] }, learner: { ownerId: profile.id }, avatar: { teacherProfileId: bg.teacherProfileId } },
      select: { id: true },
    }))
  }
  if (!allowed) throw new ApiError('background_not_found', 404)
  // Only the size asked for leaves the database (a thumbnail is ~20 KB, the room ~200 KB).
  const bytes = thumb
    ? (await db.classroomBackground.findUnique({ where: { id }, select: { thumb: true } }))?.thumb
    : (await db.classroomBackground.findUnique({ where: { id }, select: { image: true } }))?.image
  if (!bytes) throw new ApiError('background_not_found', 404)
  return new NextResponse(Buffer.from(bytes), { headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' } })
})
