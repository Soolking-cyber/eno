// The signed-in teacher's CV: upload (PDF only, private bucket) or remove.
// ⛔ Recruiters never reach this route — they get a signed link from /api/teachers/cv/[listingId]
// only after the teacher taps "Share" in their conversation.
import { route, ApiError } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { writeTombstones } from '@/lib/core/storage-tombstones'
import { TEACHER_CVS_BUCKET } from '@/lib/supabase-admin'
import { MAX_CV_BYTES, looksLikePdf, safeCvFileName, storeTeacherCv } from '@/lib/teachers/cv-store'

export const runtime = 'nodejs'

async function ownProfile(profileId: string) {
  const tp = await db.teacherProfile.findUnique({ where: { profileId }, select: { id: true, private: { select: { cvPath: true } } } })
  if (!tp) throw new ApiError('teacher_profile_missing', 404)
  return tp
}

export const POST = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-cv', limit: 20, window: '1 h', strict: true } },
  async ({ req, profile }) => {
    const tp = await ownProfile(profile.id)
    // Refuse an oversized body BEFORE formData() buffers it (Opus, commit gate 09-30).
    const declared = Number(req.headers.get('content-length') || 0)
    if (declared > MAX_CV_BYTES + 64 * 1024) throw new ApiError('cv_size', 413)
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) throw new ApiError('bad_request', 400)
    if (file.size > MAX_CV_BYTES) throw new ApiError('cv_size', 413)
    const bytes = Buffer.from(await file.arrayBuffer())
    if (!looksLikePdf(bytes)) throw new ApiError('cv_type', 415)
    const path = await storeTeacherCv(profile.id, bytes)
    if (!path) throw new ApiError('cv_store_failed', 502)
    const fileName = safeCvFileName(file.name)
    try {
    await db.$transaction(async (tx) => {
      // The replaced CV is swept by the tombstone queue, never left behind in the private bucket.
      if (tp.private?.cvPath) await writeTombstones(tx, [{ bucket: TEACHER_CVS_BUCKET, path: tp.private.cvPath }], 'teacher_cv_replaced')
      await tx.teacherPrivate.upsert({
        where: { teacherProfileId: tp.id },
        create: { teacherProfileId: tp.id, cvPath: path, cvFileName: fileName },
        update: { cvPath: path, cvFileName: fileName },
      })
    })
    } catch (e) {
      // The PDF is already stored; if the row never points at it, it must not linger in the private
      // bucket with the teacher's contact details on it (Opus, commit gate 09-30).
      await writeTombstones(db, [{ bucket: TEACHER_CVS_BUCKET, path }], 'teacher_cv_replaced').catch(() => {})
      throw e
    }
    return { ok: true, cvFileName: fileName }
  },
)

export const DELETE = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-cv', limit: 20, window: '1 h', strict: true } },
  async ({ profile }) => {
    const tp = await ownProfile(profile.id)
    if (!tp.private?.cvPath) throw new ApiError('cv_missing', 404)
    await db.$transaction(async (tx) => {
      await writeTombstones(tx, [{ bucket: TEACHER_CVS_BUCKET, path: tp.private!.cvPath! }], 'teacher_cv_replaced')
      await tx.teacherPrivate.update({ where: { teacherProfileId: tp.id }, data: { cvPath: null, cvFileName: null } })
    })
    return { ok: true }
  },
)
