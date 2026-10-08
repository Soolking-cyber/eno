import 'server-only'
import { kv } from '@/lib/ratelimit'
import { logError } from '@/lib/log'

/**
 * WHO UPLOADED A `listing-videos` OBJECT (2026-10-07). The bucket is flat — `<ms>-<rand>.<ext>`, no owner prefix — and
 * any canonical URL is accepted on a listing, so nothing could tell an uploader from someone who pasted the URL. The
 * teacher intro video's private move needs to know (src/lib/teachers/video.ts: it copies the object and then deletes
 * the public one), so the pipeline records the uploader: the sign route for the raw upload, the transcode route for
 * its output — only when the raw upload is the caller's. A record that has expired reads as "not yours" (the upload is
 * re-done, never adopted); video-gc deletes an unsaved upload after 24 h anyway.
 */
const TTL_S = 2 * 24 * 3600
const key = (path: string) => `vown:${path}`

export async function recordVideoOwner(path: string, profileId: string): Promise<void> {
  try {
    await kv.set(key(path), profileId, { ex: TTL_S })
  } catch (e) {
    logError(e, { op: 'video.recordOwner' })
  }
}

export async function videoOwner(path: string): Promise<string | null> {
  try {
    const v = await kv.get<string>(key(path))
    return typeof v === 'string' ? v : null
  } catch (e) {
    logError(e, { op: 'video.owner' })
    return null
  }
}
