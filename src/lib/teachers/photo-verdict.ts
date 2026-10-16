import 'server-only'
import { db } from '@/lib/db'
import { getGeminiVertex } from '@/lib/gemini'
import { listingObjectKey } from '@/lib/listing-image'
import { kv, rateLimit } from '@/lib/ratelimit'
import { logError } from '@/lib/log'
import { getSupabaseAdmin, LISTINGS_BUCKET } from '@/lib/supabase-admin'
import { checkTeacherPhoto, photoForCheck, type PhotoReason } from '@/lib/teachers/photo-check'

/**
 * A TEACHER PHOTO'S VERDICT (owner, 2026-10-16 — src/lib/teachers/photo-check.ts says what is checked). One answer per
 * stored object, so the same photo is never sent twice: an admin's "this photo is fine" first (a durable audit row — the
 * human route against a wrong automated refusal), then the cached verdict, then the check itself.
 *
 * ⛔ "COULD NOT CHECK" IS NEVER "YOUR PHOTO IS WRONG": a download, a model or the daily budget failing throws
 * PhotoCheckUnavailable, and the caller refuses the save with "try again" (fail CLOSED — plan review, 2026-10-16), never
 * with a reason. Only a Vertex client that is not configured at all answers 'off': the feature is dark, as the CV door is.
 * ⛔ The cache is a cache (the kv table is UNLOGGED — a crash empties it): the only durable records are the audit rows
 * (asks, refusals, overrides). Objects in the `listings` bucket are never overwritten (upsert:false, a fresh key per
 * upload — core/media.ts), so a verdict keyed by the object key always describes the same bytes.
 */

/** Bump to forget every cached verdict (a change of what is checked). */
const VERDICT_VERSION = 'v1'
/** /privacy says "up to 180 days". */
const CACHE_TTL_S = 180 * 24 * 3600
/**
 * Photo checks across every account, per day — far above real use (a few new teachers a day); the cost cap. TWO budgets
 * (gate review, 2026-10-16): the form's early check (POST /api/teachers/me/photo-check — any signed-in account can call
 * it) never spends the save's, so draining it with throwaway accounts cannot fail every new teacher's Publish closed.
 */
export const PHOTO_CHECK_BUDGETS = {
  check: { name: 'teacher-photo-check-global', perDay: 3_000 },
  save: { name: 'teacher-photo-save-global', perDay: 2_000 },
  // The re-check of the photos already on the site (/api/cron/teacher-photo-recheck): its own, so neither drains it.
  recheck: { name: 'teacher-photo-recheck-global', perDay: 1_000 },
} as const
export type PhotoCheckBudget = keyof typeof PHOTO_CHECK_BUDGETS

export type PhotoVerdictResult = { ok: true } | { ok: false; reason: PhotoReason }
type Cached = { ok: true; model: string; at: string } | { ok: false; reason: PhotoReason; model: string; at: string }

export class PhotoCheckUnavailable extends Error {
  status = 503
  constructor(public why: string) { super(`photo_check_unavailable:${why}`) }
}

const cacheKey = (objectKey: string) => `teacher-photo:${VERDICT_VERSION}:${objectKey}`

/** The object key of a first-party listing photo URL, or null for anything else. */
export function teacherPhotoKey(url: unknown): string | null {
  const obj = listingObjectKey(url)
  return obj && obj.bucket === 'listings' ? obj.key : null
}

/** An admin said this account's photo is fine (audit `teacher.photo.override`, subject the teacher's account). */
export async function photoOverridden(profileId: string, objectKey: string): Promise<boolean> {
  const row = await db.complianceAudit.findFirst({
    where: { action: 'teacher.photo.override', subjectType: 'profile', subjectId: profileId, detail: { path: ['key'], equals: objectKey } },
    select: { id: true },
  })
  return !!row
}

/** The cached verdict, if any (a kv error is a miss — the check then runs, never a guess). */
export async function cachedPhotoVerdict(objectKey: string): Promise<PhotoVerdictResult | null> {
  try {
    const c = await kv.get<Cached>(cacheKey(objectKey))
    if (!c || typeof c !== 'object') return null
    return c.ok ? { ok: true } : { ok: false, reason: c.reason }
  } catch {
    return null
  }
}

/**
 * The verdict for this account's photo: override → cache → the check now (bytes read from storage directly, never
 * through the public URL). 'off' = no Vertex client configured. Throws PhotoCheckUnavailable when it cannot tell.
 */
export async function teacherPhotoVerdict(profileId: string, url: string, budget: PhotoCheckBudget): Promise<PhotoVerdictResult | 'off'> {
  // No Vertex client on this server: the check is off (the feature is dark, as the CV door is) — before anything else.
  const ai = getGeminiVertex()
  if (!ai) return 'off'
  const objectKey = teacherPhotoKey(url)
  if (!objectKey) throw new PhotoCheckUnavailable('not_a_listing_image')
  try {
    if (await photoOverridden(profileId, objectKey)) return { ok: true }
  } catch {
    throw new PhotoCheckUnavailable('override_read')
  }
  const cached = await cachedPhotoVerdict(objectKey)
  if (cached) return cached
  // The cost cap, strict: an unreachable limiter refuses rather than un-limits (ratelimit.ts).
  const cap = PHOTO_CHECK_BUDGETS[budget]
  if (!(await rateLimit(cap.name, 'all', cap.perDay, '1 d', { strict: true })).success) {
    throw new PhotoCheckUnavailable('budget')
  }
  let bytes: Buffer
  try {
    const { data, error } = await getSupabaseAdmin().storage.from(LISTINGS_BUCKET).download(objectKey)
    if (error || !data) throw error ?? new Error('no data')
    bytes = Buffer.from(await data.arrayBuffer())
  } catch {
    throw new PhotoCheckUnavailable('download')
  }
  let jpeg: Buffer
  try {
    jpeg = await photoForCheck(bytes)
  } catch {
    // Every object in the bucket went through the upload's image check; bytes sharp cannot open are our problem.
    throw new PhotoCheckUnavailable('decode')
  }
  let answer: Awaited<ReturnType<typeof checkTeacherPhoto>>
  try {
    answer = await checkTeacherPhoto(ai, jpeg)
  } catch {
    throw new PhotoCheckUnavailable('model')
  }
  const at = new Date().toISOString()
  const stored: Cached = answer.verdict.ok ? { ok: true, model: answer.model, at } : { ok: false, reason: answer.verdict.reason, model: answer.model, at }
  // A cache that did not take: the next save checks again.
  await kv.set(cacheKey(objectKey), stored, { ex: CACHE_TTL_S }).catch((e) => logError(e, { op: 'teachers.photo.cache' }))
  return answer.verdict
}

/**
 * A refusal, recorded for the admin queue (Admin › Catalogue › Teacher photos) — the record the "Photo is fine" override
 * requires, so a wrong refusal always has its human route: from the form's early check AND from a save (gate review,
 * 2026-10-16: a refusal at save left nothing to approve). Once per (account, photo): a claim first, released when the
 * write fails, so a failed write never blocks the next one (gate review). Best effort — the answer never waits on it.
 */
export async function recordPhotoRefusal(profileId: string, objectKey: string, reason: PhotoReason): Promise<void> {
  const claimKey = `teacher-photo:refused-logged:${profileId}:${objectKey}`
  try {
    // A day, not longer: a process that dies between the claim and the record costs at most a day of this photo's record.
    if ((await kv.set(claimKey, 1, { nx: true, ex: 24 * 3600 })) !== 'OK') return
  } catch (e) {
    logError(e, { op: 'teachers.photo.refusal.claim' })
    return
  }
  try {
    // Durable "once": a refusal already on record for this account and photo is not written again (the claim only spaces
    // the attempts — it expires after a day; gate review, 2026-10-16).
    const seen = await db.complianceAudit.findFirst({
      where: { action: 'teacher.photo.refused', subjectType: 'profile', subjectId: profileId, detail: { path: ['key'], equals: objectKey } },
      select: { id: true },
    })
    if (seen) return
    const { appendAudit } = await import('@/lib/compliance/audit')
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('lock_timeout', '1000ms', true)`
      await appendAudit(tx, { actorType: 'system', actorId: null, action: 'teacher.photo.refused', subjectType: 'profile', subjectId: profileId, detail: { key: objectKey, reason } })
    }, { maxWait: 1_000 })
  } catch (e) {
    logError(e, { op: 'teachers.photo.refusal.record' })
    await kv.del(claimKey).catch((err) => logError(err, { op: 'teachers.photo.refusal.release' }))
  }
}

