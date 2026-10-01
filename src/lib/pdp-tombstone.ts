/**
 * Per-page ISR tombstones for listing ids, both languages — for operator scripts that change a listing's
 * visibility outside the Next runtime (an expiry, a revival). The PDP is ISR for 30 days and a script has
 * no revalidatePath, so without a tombstone an expired row keeps rendering and a revived one keeps its
 * cached 404. Same SQL and tags as scripts/import-jobs.ts. Works only where the container reads
 * tombstones (ENO_ISR_PG=1 — see scripts/purge-isr-listings.mjs).
 */
import type { PrismaClient } from '../generated/prisma/client'
import { pdpTombstoneTags } from './job-listing'

type RawDb = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>

export async function tombstonePdps(db: RawDb, ids: readonly string[]): Promise<string> {
  if (!ids.length) return 'none needed'
  const [{ t }] = await db.$queryRaw<{ t: string | null }[]>`select to_regclass('public.next_cache_tag')::text as t`
  if (!t) return `SKIPPED — no next_cache_tag table here (${ids.length} pages would be tombstoned)`
  const tags = ids.flatMap(pdpTombstoneTags)
  await db.$executeRaw`
    insert into next_cache_tag (tag, stamp, expires_at)
    select tag, ${Date.now()}::bigint, now() + interval '40 days' from unnest(${tags}::text[]) as tag
    on conflict (tag) do update set
      stamp = greatest(next_cache_tag.stamp, excluded.stamp),
      expires_at = greatest(next_cache_tag.expires_at, excluded.expires_at)`
  return `${tags.length} tags (${ids.length} pages × en/vi)`
}
