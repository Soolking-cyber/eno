import 'server-only'
import { randomBytes, randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { recordVideoOwner, videoOwner } from '@/lib/core/video-owner'
import { logError } from '@/lib/log'
import { listingObjectKey } from '@/lib/listing-image'
import { getSupabaseAdmin, LISTING_VIDEOS_BUCKET, TEACHER_VIDEOS_BUCKET } from '@/lib/supabase-admin'
import type { TombstoneRef } from '@/lib/core/storage-tombstones'

/**
 * The intro video's storage half (rules: src/lib/teachers/video.ts). Moves between the PUBLIC `listing-videos` bucket
 * and the PRIVATE `teacher-videos` bucket, the 10-minute signed URL a school watches through, and the upload-ownership
 * lookup (src/lib/core/video-owner.ts) — a SOFT guard on a first private save. ⛔ What keeps somebody else's object from
 * being deleted is the REFERENCE CHECK every listing-videos delete makes (storage-purge isStillReferenced, the tombstone
 * sweep, removeVideoIfOrphaned, video-gc): an object is removed only when no surviving row shows it (gate review, 2026-10-07).
 *
 * ⛔ A MOVE IS DOWNLOAD + UPLOAD, NOT storage-js `copy` WITH `destinationBucket`: whether the self-hosted storage server
 * honours a cross-bucket copy is unverified, and an upload is where the object's Content-Type and Cache-Control are set.
 * A private object gets `max-age=0`, so a signed URL is never served from an edge cache after it expires; a public one
 * gets the pipeline's year (video-upload-client.ts).
 */

const TYPE_BY_EXT: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' }
const extOf = (path: string) => (/\.(mp4|webm|mov)$/i.exec(path)?.[1] ?? 'mp4').toLowerCase()

/** The public URL of a `listing-videos` key. */
export function publicVideoUrlOf(key: string): string {
  return getSupabaseAdmin().storage.from(LISTING_VIDEOS_BUCKET).getPublicUrl(key).data.publicUrl
}

/** Is this canonical public video URL this profile's own upload? */
export async function ownsPublicVideo(url: string, profileId: string): Promise<boolean> {
  const ref = listingObjectKey(url)
  if (!ref || ref.bucket !== LISTING_VIDEOS_BUCKET) return false
  return (await videoOwner(ref.key)) === profileId
}

async function download(bucket: string, path: string): Promise<{ body: Blob; type: string } | null> {
  const { data, error } = await getSupabaseAdmin().storage.from(bucket).download(path)
  if (error || !data) {
    logError(error ?? new Error('empty download'), { op: 'teachers.video.download', bucket })
    return null
  }
  return { body: data, type: data.type && data.type !== 'application/octet-stream' ? data.type : TYPE_BY_EXT[extOf(path)] }
}

/**
 * Where a copy WILL land, chosen before it runs — so the caller can tombstone the destination first (a crash after the
 * upload then cannot orphan it: the sweep deletes it unless the committed row references it).
 */
export function privateVideoPathFor(profileId: string, sourceKeyOrPath: string): string {
  return `${profileId}/${randomUUID()}.${extOf(sourceKeyOrPath)}`
}
/**
 * A new public key in the minted shape every stored listing video must have (media.ts VIDEO_PATH_RE, checked by
 * isCanonicalVideoUrl → parseVideoField). ⚠️ Eight fixed hex characters, never `Math.random().toString(36).slice(…)`:
 * that can come out shorter than VIDEO_PATH_RE's four, and a stored URL that fails the check is IGNORED on the next save
 * — the published video would be dropped (gate review, 2026-10-07).
 */
export function publicVideoKeyFor(sourcePath: string): string {
  return `${Date.now()}-${randomBytes(4).toString('hex')}.${extOf(sourcePath)}`
}

/** Copy a public upload into the private bucket at `path`. True when stored (nothing was stored otherwise). */
export async function copyPublicVideoToPrivate(url: string, path: string): Promise<boolean> {
  const ref = listingObjectKey(url)
  if (!ref || ref.bucket !== LISTING_VIDEOS_BUCKET) return false
  const src = await download(LISTING_VIDEOS_BUCKET, ref.key)
  if (!src) return false
  const { error } = await getSupabaseAdmin()
    .storage.from(TEACHER_VIDEOS_BUCKET)
    .upload(path, src.body, { contentType: src.type, cacheControl: '0', upsert: false })
  if (error) {
    logError(error, { op: 'teachers.video.toPrivate' })
    return false
  }
  return true
}

/** Copy a private video out to the public bucket at `key` (a fresh canonical name). Its public URL, or null. */
export async function copyPrivateVideoToPublic(path: string, key: string, profileId: string): Promise<string | null> {
  const src = await download(TEACHER_VIDEOS_BUCKET, path)
  if (!src) return null
  const admin = getSupabaseAdmin()
  const { error } = await admin.storage
    .from(LISTING_VIDEOS_BUCKET)
    .upload(key, src.body, { contentType: src.type, cacheControl: '31536000', upsert: false })
  if (error) {
    logError(error, { op: 'teachers.video.toPublic' })
    return null
  }
  await recordVideoOwner(key, profileId)
  return admin.storage.from(LISTING_VIDEOS_BUCKET).getPublicUrl(key).data.publicUrl
}

/** A 10-minute INLINE link (no download disposition — it plays in the page). Callers MUST have passed the gate. */
export async function signTeacherVideo(path: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin().storage.from(TEACHER_VIDEOS_BUCKET).createSignedUrl(path, 600)
  if (error) logError(error, { op: 'teachers.video.sign' })
  return error ? null : data?.signedUrl ?? null
}

/**
 * The fast path for displaced PRIVATE videos: delete the objects no TeacherPrivate row points at, and return what was
 * settled so the caller clears those tombstones. Anything not settled stays tombstoned for the sweep.
 */
export async function removeUnreferencedPrivateVideos(paths: string[]): Promise<TombstoneRef[]> {
  if (!paths.length) return []
  const still = await db.teacherPrivate.findMany({ where: { videoPath: { in: paths } }, select: { videoPath: true } })
  const keep = new Set(still.map((r) => r.videoPath))
  const gone = paths.filter((p) => !keep.has(p))
  if (!gone.length) return []
  const { error } = await getSupabaseAdmin().storage.from(TEACHER_VIDEOS_BUCKET).remove(gone)
  if (error) {
    logError(error, { op: 'teachers.video.removePrivate' })
    return []
  }
  return gone.map((path) => ({ bucket: TEACHER_VIDEOS_BUCKET, path }))
}
