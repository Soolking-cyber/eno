/**
 * THE PHOTO CHECK'S PENDING SET — kv `listing-photo:pending:<id>`, 30 days: rows the cron (api/cron/listing-photos, scope
 * `recent`) checks on its next run. The app queues through listing-photo-hooks.ts (kv); a script queues here, with its own
 * Prisma client — no `server-only` below this line, so scripts/*.ts can import it.
 * ⚠️ NOT A PROOF (plan amendment A14): an image change by raw SQL that never queues its rows waits for the weekly full pass.
 */
export const PENDING_PHOTO_PREFIX = 'listing-photo:pending:'
export const PENDING_PHOTO_TTL_S = 30 * 24 * 3600
export const pendingPhotoKey = (id: string) => `${PENDING_PHOTO_PREFIX}${id}`

type RawClient = { $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => PromiseLike<unknown> }

/** A script's rows with new or changed photos, queued for the cron. Never throws: a failed queue is the full pass's. */
export async function enqueuePhotoChecks(client: RawClient, ids: Iterable<string>): Promise<number> {
  const keys = [...new Set(ids)].map(pendingPhotoKey)
  try {
    for (let i = 0; i < keys.length; i += 1000) {
      await client.$queryRaw`SELECT kv_set(k, '1'::jsonb, ${PENDING_PHOTO_TTL_S}::int, false) FROM unnest(${keys.slice(i, i + 1000)}::text[]) AS k`
    }
    if (keys.length) console.log(`  photo check queued: ${keys.length} listing(s)`)
    return keys.length
  } catch (e) {
    console.warn(`  ⚠️ photo check queue failed (${(e as Error).message}) — the weekly full pass will check them`)
    return 0
  }
}
