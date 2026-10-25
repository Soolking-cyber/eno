import { NextResponse } from 'next/server'
import { ApiError, route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { requireAvatar, requireTeacher } from '@/lib/classroom/guards'
import { readCapped } from '@/lib/classroom/http'
import { classroomAudit, noticeSha } from '@/lib/classroom/audit'
import { PHOTO_NOTICE_VERSION, photoNoticeBody } from '@/lib/classroom/notices'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NOTICE_SHA = noticeSha(photoNoticeBody())
const NO_STORE = { 'cache-control': 'private, no-store' }

/**
 * POST /api/classroom/avatar/photo — "Use my photo": the teacher asks for a 3D likeness made from their PROFILE photo
 * (owner, 2026-10-25: "own face on request"). Only that photo — already on their public profile and through its checks —
 * so nobody can make an avatar of someone else's face. The request joins the admin queue (/admin/classroom), where it is
 * made by hand in Spatius Studio once Spatius has confirmed in writing (plan, owner action 2); the teacher's class keeps
 * its current look meanwhile. The consent and the request are written together.
 */
export const POST = route({ auth: 'profile', rateLimit: { bucket: 'classroom-photo', limit: 10, window: '1 d' } }, async ({ req, profile }) => {
  const teacher = await requireTeacher(profile.id)
  const avatar = await requireAvatar(teacher.id)
  const body = await readCapped(req, 2_000)
  if (body.notice !== PHOTO_NOTICE_VERSION) {
    return NextResponse.json({ error: 'notice_changed', notice: 'classroom_photo' }, { status: 409, headers: NO_STORE })
  }
  if (!teacher.photoUrl) throw new ApiError('photo_required', 409)
  if (avatar.customStatus === 'requested' || avatar.customStatus === 'ready') {
    return NextResponse.json({ customStatus: avatar.customStatus }, { headers: NO_STORE })
  }
  // The last request was withdrawn before its likeness was finished: what was made for it is deleted first (the DDL's
  // trigger refuses a new request until then; this answers 409 instead of a 500).
  const pending = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM public.classroom_likeness_deletion WHERE spatius_avatar_id = ${`request:${avatar.id}`} AND done_at IS NULL`
  if (pending[0]?.n) throw new ApiError('likeness_deleting', 409)
  const now = new Date()
  await db.$transaction(async (tx) => {
    // …and WHICH photo (2c round 2, opus): the profile photo's address at the moment of consent.
    await classroomAudit(tx, profile.id, 'classroom.photo.consent', { notice: PHOTO_NOTICE_VERSION, noticeSha: NOTICE_SHA, avatarId: avatar.id, photoUrl: teacher.photoUrl })
    await tx.classroomAvatar.update({
      where: { id: avatar.id },
      data: { customStatus: 'requested', photoConsentVersion: PHOTO_NOTICE_VERSION, photoConsentAt: now, photoWithdrawnAt: null, updatedAt: now },
    })
  })
  return NextResponse.json({ customStatus: 'requested' }, { headers: NO_STORE })
})

/**
 * DELETE /api/classroom/avatar/photo — withdraw: the likeness stops being used AT ONCE (the class falls back to the
 * teacher's photo, voice-only) and the admin queue lists it for deletion at Spatius. Allowed whatever the classroom's
 * mode — taking consent back is never switched off.
 */
export const DELETE = route({ auth: 'profile' }, async ({ profile }) => {
  const teacher = await requireTeacher(profile.id, { open: false })
  const avatar = await requireAvatar(teacher.id)
  if (avatar.customStatus === 'none' || avatar.customStatus === 'removed') return NextResponse.json({ customStatus: avatar.customStatus }, { headers: NO_STORE })
  const now = new Date()
  await db.$transaction(async (tx) => {
    await classroomAudit(tx, profile.id, 'classroom.photo.withdrawn', { avatarId: avatar.id, was: avatar.customStatus })
    // A likeness already made at Spatius is forgotten here at once; the database queues it for deletion there
    // (the ClassroomAvatar_queue_likeness trigger — src/lib/classroom/likeness.ts).
    await tx.classroomAvatar.update({
      where: { id: avatar.id },
      data: {
        customStatus: 'removed', photoWithdrawnAt: now, updatedAt: now, spatiusAvatarId: null,
        ...(avatar.look === 'custom' ? { look: 'photo', libraryAvatarId: null } : {}),
      },
    })
  })
  return NextResponse.json({ customStatus: 'removed' }, { headers: NO_STORE })
})
