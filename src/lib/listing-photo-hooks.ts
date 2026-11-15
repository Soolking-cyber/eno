import 'server-only'
import { after } from 'next/server'
import type { PhotoCheckLane } from '@/lib/ai-guard'
import { db } from '@/lib/db'
import { kv } from '@/lib/ratelimit'
import { logError } from '@/lib/log'
import { PHOTO_HELD_NOTE } from '@/lib/listing-photo-hold'
import { PENDING_PHOTO_TTL_S, pendingPhotoKey } from '@/lib/listing-photo-queue'

/**
 * What the publish paths call around the photo pass (listing-photo-pass.ts) without importing it — the pass imports
 * publish-listings.ts, which calls back here, so the pass is loaded lazily.
 * ⛔ WRITES ARE OFF UNTIL THE OWNER TURNS THEM ON (plan amendment A16): without PHOTO_RULES_WRITE=1 the pass checks and
 * caches but holds, strips and releases nothing, so a deploy alone changes no listing; the owner sees dry-run counts first.
 */
export const photoRulesLive = () => process.env.PHOTO_RULES_WRITE === '1'

/** The photo-held rows among `ids` — what a publish other than the release leaves out and counts (`photoCheck`). */
export async function photoHeldIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  // edition-lint-allow: a pre-filter for a WRITE over ids its caller chose (publishListings); nothing is rendered.
  return new Set((await db.listing.findMany({ where: { id: { in: ids }, verificationNotes: PHOTO_HELD_NOTE }, select: { id: true } })).map((r) => r.id))
}

/** Rows the pass could not decide yet (a photo unavailable): the cron's `recent` scope picks them up (listing-photo-queue.ts). */
export async function enqueuePhotoChecks(ids: string[]): Promise<void> {
  await kv.mset(ids.map((id) => [pendingPhotoKey(id), 1]), PENDING_PHOTO_TTL_S).catch((e) => logError(e, { op: 'listing-photo.enqueue' }))
}

export async function photoCheckDone(id: string): Promise<void> {
  await kv.del(pendingPhotoKey(id)).catch((e) => logError(e, { op: 'listing-photo.done' }))
}

/**
 * After a publish that was not the photo release (admin Publish, moderation approve, the enforcement restores, the
 * identity releases): the pass re-holds what came back with flyers. Queued first, so a request that dies before the pass
 * finishes leaves them to the cron. Never throws; nothing while writes are off.
 */
export function photoPassSoon(ids: string[], lane: PhotoCheckLane = 'sweep'): void {
  if (!ids.length || !photoRulesLive()) return
  const run = async () => {
    try {
      await enqueuePhotoChecks(ids)
      const { photoPassById } = await import('@/lib/listing-photo-pass')
      for (let i = 0; i < ids.length; i += 4) await Promise.allSettled(ids.slice(i, i + 4).map((id) => photoPassById(id, lane)))
    } catch (e) { logError(e, { op: 'listing-photo.soon' }) }
  }
  try { after(run) } catch { void run() }
}
