import { route, ApiError } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { NOT_REMOVED } from '@/lib/listing-removed'
import { strippedPhotosOf } from '@/lib/listing-photo-hold'
import { photoPassById, restoreStrippedPhotos } from '@/lib/listing-photo-pass'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * "PHOTO IS FINE" — the human route against a wrong refusal of a listing photo (owner, 2026-11-15; plan A13). Admin ›
 * Catalogue › Listing photos. Only for an object key the photo check held or removed ON THIS LISTING (its audits): an
 * admin never approves a photo out of thin air. Then, in order:
 *  1. in one transaction (listing-photo-pass.ts restoreStrippedPhotos), the durable override — audit
 *     `listing.photo.override` {key}, subject the listing, actor the admin — which every verdict for this listing reads
 *     before the cache (listing-photo-verdict.ts photoOverridden; THIS LISTING ONLY, never the shared cache), and the
 *     restore: a removed photo goes back where it was, around the seller's later edits, its tombstone cancelled. A
 *     restore that fails records no override, so the tab still offers the button;
 *  2. the pass again — a held listing whose photos are now all fine is released (writes as PHOTO_RULES_WRITE says).
 */
export const POST = route({ auth: 'admin' }, async ({ req, admin }) => {
  const body = (await req.json().catch(() => null)) as { listingId?: unknown; key?: unknown } | null
  const listingId = typeof body?.listingId === 'string' ? body.listingId : ''
  const key = typeof body?.key === 'string' ? body.key : ''
  // A cuid or a UUID (both kinds of listing id are live).
  if (!/^(?:[a-z0-9]{20,40}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(listingId) || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,300}$/.test(key) || key.includes('..')) throw new ApiError('bad_request', 400)
  // edition-lint-allow: one listing an admin opened in the console, for a write; nothing is rendered.
  if (!(await db.listing.findFirst({ where: { id: listingId, ...NOT_REMOVED }, select: { id: true } }))) throw new ApiError('not_found', 404)
  const audits = await db.complianceAudit.findMany({
    where: { action: { in: ['listing.photo.held', 'listing.photo.stripped'] }, subjectType: 'listing', subjectId: listingId },
    select: { action: true, detail: true },
  })
  const refused = audits.some((a) => a.action === 'listing.photo.held'
    ? ((a.detail as { photos?: Array<{ key?: unknown }> } | null)?.photos ?? []).some((p) => p?.key === key)
    : !!strippedPhotosOf(a.detail)?.removed.some((r) => r.key === key))
  if (!refused) throw new ApiError('not_found', 404)

  // A compare-and-set: an edit landing under it is read again once; then tap again.
  const restored = (await restoreStrippedPhotos(listingId, [key], admin)) ?? (await restoreStrippedPhotos(listingId, [key], admin))
  if (restored === null) throw new ApiError('retry', 409)
  const pass = await photoPassById(listingId, 'pass')
  return { ok: true, restored: restored.length, pass: 'skip' in pass ? { skip: pass.skip } : { dryRun: pass.dryRun, wrote: pass.wrote } }
})
