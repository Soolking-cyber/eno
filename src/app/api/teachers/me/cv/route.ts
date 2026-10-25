// The signed-in teacher's CV: upload (PDF only, private bucket) or remove.
// ⛔ Recruiters never reach this route — they get a signed link from /api/teachers/cv/[listingId]
// only after the teacher taps "Share" in their conversation.
import { randomUUID } from 'node:crypto'
import { route, ApiError } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { logError } from '@/lib/log'
import { rateLimit } from '@/lib/ratelimit'
import { clientIp } from '@/lib/client-ip'
import { writeTombstones } from '@/lib/core/storage-tombstones'
import { TEACHER_CVS_BUCKET } from '@/lib/supabase-admin'
import { MAX_CV_BYTES, cvPathFor, looksLikePdf, safeCvFileName, uploadTeacherCv } from '@/lib/teachers/cv-store'

export const runtime = 'nodejs'

/** The request body, or 'too_big' the moment it passes `cap` bytes (the stream is cancelled). */
async function readCapped(req: Request, cap: number): Promise<Uint8Array | 'too_big'> {
  const reader = req.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > cap) { await reader.cancel().catch((e) => logError(e, { op: 'teachers.cv.cancel' })); return 'too_big' }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.byteLength }
  return out
}

async function ownProfile(profileId: string) {
  const tp = await db.teacherProfile.findUnique({ where: { profileId }, select: { id: true, createdAt: true, private: { select: { cvPath: true } } } })
  if (!tp) throw new ApiError('teacher_profile_missing', 404)
  return tp
}

/**
 * POST — two modes, one set of checks (the size caps, the %PDF- sniff, the rate limit):
 *   · with a profile (the edit form, after its Save) — stored and attached at once, replacing the saved CV;
 *   · `?pending=1` — ⛔ THE JOIN FORM'S UPLOAD, BEFORE ITS FIRST PUBLISH (owner, 2026-10-21 — required then, optional since 2026-10-25; constants.ts
 *     has the history). There is no profile to attach it to yet, so none is read and TeacherPrivate is never
 *     written: the object is TOMBSTONED FIRST ('teacher_cv_pending' — the video's pending copy, publish.ts), then
 *     uploaded, and the answer is its token. The save that CREATES the profile names the token, finds the pending row
 *     under its lock, writes cvPath and deletes the tombstone in its own transaction (publish.ts saveTeacherProfile). A
 *     token no create claims — a Publish refused, a page left — is swept an hour later like any unreferenced CV: the
 *     sweep judges a teacher-cvs object by TeacherPrivate.cvPath alone, whatever the tombstone's reason.
 *     ⚠️ Never attaches to a profile that exists (another tab published meanwhile): that create is refused
 *     (profile_changed), and this upload is swept.
 */
export const POST = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-cv', limit: 20, window: '1 h', strict: true } },
  async ({ req, profile }) => {
    const pending = new URL(req.url).searchParams.get('pending') === '1'
    // ⛔ THE PENDING MODE IS OPEN TO ANY SIGNED-IN ACCOUNT (no profile is needed — that is its point), so it gets limits of
    // its own, BEFORE the body is read (commit gate, opus 2026-10-22: 20 × 10 MB an hour from every throwaway account into
    // the private bucket). A teacher uploads once per Publish (the form reuses a token for half an hour): six an hour is
    // room for retries. The connection's day cap is GENEROUS and said as "busy on this network", never "your limit"
    // (commit gate, codex + opus 2026-10-22): a teacher uploading a CV at Publish, on a school's Wi-Fi or a carrier's shared
    // address (CGNAT — common in Vietnam) must never lock teachers out — site-wide, a few dozen teachers publish a day.
    // One after another, never Promise.all (a denied attempt still counts — ratelimit.ts).
    if (pending) {
      if (!(await rateLimit('teacher-cv-pending', profile.id, 6, '1 h', { strict: true })).success) throw new ApiError('rate_limited', 429)
      if (!(await rateLimit('teacher-cv-pending-ip', clientIp(req), 200, '1 d', { strict: true })).success) throw new ApiError('cv_capacity', 503)
    }
    const tp = pending ? null : await ownProfile(profile.id)
    // Refuse an oversized body BEFORE it is buffered — by the declared length, and by counting the
    // stream itself, since a chunked upload declares none (Opus, commit gate 09-30).
    const cap = MAX_CV_BYTES + 64 * 1024
    if (Number(req.headers.get('content-length') || 0) > cap) throw new ApiError('cv_size', 413)
    const raw = await readCapped(req, cap)
    if (raw === 'too_big') throw new ApiError('cv_size', 413)
    const form = await new Response(Buffer.from(raw), { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) throw new ApiError('bad_request', 400)
    if (file.size > MAX_CV_BYTES) throw new ApiError('cv_size', 413)
    const bytes = Buffer.from(await file.arrayBuffer())
    if (!looksLikePdf(bytes)) throw new ApiError('cv_type', 415)
    const fileName = safeCvFileName(file.name)
    if (!tp) {
      // Only the token leaves: the path is rebuilt from the caller's own Profile id when the create names it (cvPathFor).
      const token = randomUUID()
      const path = cvPathFor(profile.id, token)
      // The tombstone FIRST, so a crash after the upload cannot orphan the file (its contact details) in the private
      // bucket; a failed upload keeps it too — whatever the storage did or did not keep, the sweep removes it.
      await writeTombstones(db, [{ bucket: TEACHER_CVS_BUCKET, path }], 'teacher_cv_pending')
      if (!(await uploadTeacherCv(path, bytes))) throw new ApiError('cv_store_failed', 502)
      return { ok: true, cvUpload: token, cvFileName: fileName }
    }
    // ⛔ TOMBSTONED FIRST here too (commit gate, codex 2026-10-22): the old order — upload, then a tombstone only in the
    // failed write's catch — left the PDF (its contact details) in the private bucket with NO record when the process died
    // between the two. Now the pending row exists before the object, the commit that points TeacherPrivate at it deletes
    // the row, and anything that never commits is the sweep's.
    const path = cvPathFor(profile.id, randomUUID())
    await writeTombstones(db, [{ bucket: TEACHER_CVS_BUCKET, path }], 'teacher_cv_pending')
    if (!(await uploadTeacherCv(path, bytes))) throw new ApiError('cv_store_failed', 502)
    await db.$transaction(async (tx) => {
      // ⛔ ONE CV WRITE AT A TIME PER ACCOUNT — the profile save's own lock (publish.ts) — and the CV it displaces read UNDER
      // it (commit gate, codex 2026-10-22): two tabs replacing at once each tombstoned the same old file read before their
      // transactions, and the first one's new file was left with no row pointing at it and no record — a private PDF the
      // sweep could never find. The replaced CV is swept by the tombstone queue, never left behind in the private bucket.
      await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + profile.id}))`
      const current = await tx.teacherPrivate.findUnique({ where: { teacherProfileId: tp.id }, select: { cvPath: true } })
      if (current?.cvPath && current.cvPath !== path) await writeTombstones(tx, [{ bucket: TEACHER_CVS_BUCKET, path: current.cvPath }], 'teacher_cv_replaced')
      await tx.teacherPrivate.upsert({
        where: { teacherProfileId: tp.id },
        create: { teacherProfileId: tp.id, cvPath: path, cvFileName: fileName },
        update: { cvPath: path, cvFileName: fileName },
      })
      await tx.storageTombstone.deleteMany({ where: { bucket: TEACHER_CVS_BUCKET, path } })
    })
    return { ok: true, cvFileName: fileName }
  },
)

export const DELETE = route(
  { auth: 'profile', rateLimit: { bucket: 'teacher-cv', limit: 20, window: '1 h', strict: true } },
  async ({ profile }) => {
    const tp = await ownProfile(profile.id)
    if (!tp.private?.cvPath) throw new ApiError('cv_missing', 404)
    // ⛔ ANY TEACHER MAY REMOVE THEIR CV (owner, 2026-10-25: "Allow removal" — optional at publish, so never kept against the
    // teacher's will; profiles created from 2026-10-23 could only replace it until the 2026-10-25 deploy).
    await db.$transaction(async (tx) => {
      // Under the same lock as every CV write, and on the CV there NOW (an upload from another tab may have replaced the
      // one read above): that one is tombstoned and cleared — never a newer CV cleared with only the older one recorded.
      await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${'teacher:' + profile.id}))`
      const current = await tx.teacherPrivate.findUnique({ where: { teacherProfileId: tp.id }, select: { cvPath: true } })
      if (!current?.cvPath) throw new ApiError('cv_missing', 404)
      await writeTombstones(tx, [{ bucket: TEACHER_CVS_BUCKET, path: current.cvPath }], 'teacher_cv_replaced')
      await tx.teacherPrivate.update({ where: { teacherProfileId: tp.id }, data: { cvPath: null, cvFileName: null } })
    })
    return { ok: true }
  },
)
