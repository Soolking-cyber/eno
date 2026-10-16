import 'server-only'
import { listingObjectKey } from '@/lib/listing-image'
import { logError } from '@/lib/log'
import { kv } from '@/lib/ratelimit'

/**
 * WHO UPLOADED A HEADSHOT (2026-10-16 — the teacher profile photo check, gate review). A signed-in `kind=avatar` upload
 * (/api/upload — the teacher photo, the account avatar, a shop logo) records its uploader for 7 days, so the form's early
 * photo check (POST /api/teachers/me/photo-check) only spends a check, and only files a refusal for the admin queue, on
 * a photo THIS account just uploaded — never on any public listing photo a caller names. A cache: the kv table is
 * UNLOGGED, and a lost record only means the early check says nothing (the save still checks the photo itself).
 */
const TTL_S = 7 * 24 * 3600
const KEY = (objectKey: string) => `image-owner:${objectKey}`

export async function recordImageOwner(url: string, profileId: string): Promise<void> {
  const obj = listingObjectKey(url)
  if (!obj || obj.bucket !== 'listings') return
  await kv.set(KEY(obj.key), profileId, { ex: TTL_S }).catch((e) => logError(e, { op: 'upload.imageOwner' }))
}

/** The account that uploaded this listing photo in the last 7 days, or null (unknown, older, or the record is gone). */
export async function imageOwner(url: string): Promise<string | null> {
  const obj = listingObjectKey(url)
  if (!obj || obj.bucket !== 'listings') return null
  try {
    const v = await kv.get<string>(KEY(obj.key))
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}
