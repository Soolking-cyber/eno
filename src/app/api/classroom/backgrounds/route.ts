import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { getGeminiVertex } from '@/lib/gemini'
import { rateLimit } from '@/lib/ratelimit'
import { logWarn } from '@/lib/log'
import { requireTeacher } from '@/lib/classroom/guards'
import { readBytesCapped } from '@/lib/classroom/http'
import { BACKGROUND_UPLOADS_OPEN, LIMITS } from '@/lib/classroom/constants'
import { checkRoom, prepareBackground, uploadedRoomUrl } from '@/lib/classroom/backgrounds-upload'
import { teacherLock } from '@/lib/classroom/tutors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The check can take ~19 s at worst (two hedged models).
export const maxDuration = 60

const NO_STORE = { 'cache-control': 'private, no-store' }
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
/** The whole classroom's checks a day, strict (an unreachable limiter refuses): what a runaway loop could cost. Each teacher
 *  may try 10 a day, so 60 teachers retrying refused photos still leave room (commit gate, opus). */
const CHECKS_PER_DAY = 600

const listOf = async (teacherProfileId: string) => (await db.classroomBackground.findMany({
  where: { teacherProfileId, status: 'ok' }, orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true },
})).map((b) => ({ id: b.id, url: uploadedRoomUrl(b.id, 'full'), thumbUrl: uploadedRoomUrl(b.id, 'thumb'), createdAt: b.createdAt.toISOString() }))

/** GET /api/classroom/backgrounds — the teacher's own uploaded rooms (removed ones left out), newest first. */
export const GET = route({ auth: 'profile' }, async ({ profile }) => {
  const teacher = await requireTeacher(profile.id, { open: false })
  return NextResponse.json({ backgrounds: await listOf(teacher.id), open: BACKGROUND_UPLOADS_OPEN, limit: LIMITS.backgroundsPerTeacher }, { headers: NO_STORE })
})

/**
 * POST /api/classroom/backgrounds — upload a room (the image's bytes as the body: JPEG, PNG, WebP or HEIC/AVIF that sharp
 * reads, ≤12 MB). Cropped to the call screen, checked (backgrounds-upload.ts — no person, nothing unsafe, no personal
 * details; NO ANSWER REFUSES), and kept only when it passes. Refusals: `background_refused` + `reason`, or
 * `background_check_unavailable` (try again) — a refused picture is not stored anywhere.
 */
export const POST = route({ auth: 'profile', rateLimit: { bucket: 'classroom-background', limit: 10, window: '1 d' } }, async ({ req, profile }) => {
  if (!BACKGROUND_UPLOADS_OPEN) throw new ApiError('look_invalid', 409)
  const teacher = await requireTeacher(profile.id)
  const bytes = await readBytesCapped(req, MAX_UPLOAD_BYTES)
  if (!bytes.length) throw new ApiError('bad_request', 400)
  // The cap first (cheap), again under the lock at the write.
  if ((await db.classroomBackground.count({ where: { teacherProfileId: teacher.id, status: 'ok' } })) >= LIMITS.backgroundsPerTeacher) throw new ApiError('background_limit', 409)
  let prepared
  try {
    prepared = await prepareBackground(bytes)
  } catch {
    throw new ApiError('background_not_image', 400)
  }
  const ai = getGeminiVertex()
  if (!ai) throw new ApiError('background_check_unavailable', 503)
  if (!(await rateLimit('classroom-background-check', 'all', CHECKS_PER_DAY, '1 d', { strict: true })).success) throw new ApiError('background_check_unavailable', 503)
  let verdict
  try {
    verdict = await checkRoom(ai, prepared.check)
  } catch (e) {
    logWarn('[classroom] a background could not be checked', { error: (e as Error).name })
    throw new ApiError('background_check_unavailable', 503)
  }
  if (!verdict.ok) return NextResponse.json({ error: 'background_refused', reason: verdict.reason }, { status: 422, headers: NO_STORE })
  const saved = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${teacherLock(teacher.id)}, 0))`
    if ((await tx.classroomBackground.count({ where: { teacherProfileId: teacher.id, status: 'ok' } })) >= LIMITS.backgroundsPerTeacher) throw new ApiError('background_limit', 409)
    return tx.classroomBackground.create({ data: { teacherProfileId: teacher.id, image: prepared.image, thumb: prepared.thumb }, select: { id: true } })
  })
  return NextResponse.json({ id: saved.id, backgrounds: await listOf(teacher.id) }, { status: 201, headers: NO_STORE })
})
