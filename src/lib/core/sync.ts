import 'server-only'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { bulkImportCore, rehostListingImage, BULK_MAX_ROWS, type BulkRow } from '@/lib/core/bulk'
import { updateListingCore, setStatusCore } from '@/lib/core/listings'
import { removeFromIndex } from '@/lib/listing-index'
import { dispatchListingEventsBatch } from '@/lib/webhooks'

// Catalogue sync core (Phase 3). Upserts the shop's listings by the partner's OWN id
// (externalId, unique per shop). `partial` only touches the rows you send; `full` also
// RETIRES (hides) any active listing whose externalId isn't in the payload — i.e. removed
// from the partner's catalogue. New rows go through the lean bulk importer; existing rows
// reuse updateListingCore (so searchText/reindex/webhook stay identical to a normal edit).

export const SYNC_MAX_ROWS = BULK_MAX_ROWS // 200 per call

export type SyncRow = {
  externalId?: string
  external_id?: string // snake_case alias (matches the bulk endpoint's field name)
  categorySlug?: string
  title?: string
  description?: string
  price?: unknown
  district?: string
  condition?: string
  images?: unknown[]
  status?: string
}
export type SyncRowResult = { external_id: string | null; id?: string; action: 'created' | 'updated' | 'failed'; error?: string }

const VALID_STATUS = new Set(['active', 'sold', 'hidden'])
const cleanExt = (v: unknown) => (v != null ? String(v).trim().slice(0, 128) : '')

export async function syncListingsCore(
  seller: { id: string; trustTier: string; trustScore: number },
  rows: SyncRow[],
  mode: 'partial' | 'full',
): Promise<{ created: number; updated: number; retired: number; failed: number; results: SyncRowResult[] }> {
  const results: SyncRowResult[] = []

  // Every row must carry an externalId (the upsert key, camelCase or snake_case). Rows
  // without one are reported. DEDUPE within the payload — last occurrence of an externalId
  // wins — so a duplicated id maps to exactly one create/update (no unique-constraint failure
  // on a doubled create, no double 'listing.updated' webhook).
  const byExt = new Map<string, SyncRow>()
  for (const row of rows) {
    const ext = cleanExt(row.externalId ?? row.external_id)
    if (!ext) { results.push({ external_id: null, action: 'failed', error: 'externalId is required' }); continue }
    byExt.set(ext, row)
  }
  const valid = [...byExt.entries()].map(([ext, row]) => ({ row, ext }))
  const extIds = valid.map((v) => v.ext)

  // Which externalIds already exist for THIS shop → update; the rest → create.
  const existing = extIds.length
    ? await db.listing.findMany({ where: { sellerId: seller.id, externalId: { in: extIds } }, select: { id: true, externalId: true } })
    : []
  const idByExt = new Map(existing.map((l) => [l.externalId!, l.id]))

  const toCreate = valid.filter((v) => !idByExt.has(v.ext))
  const toUpdate = valid.filter((v) => idByExt.has(v.ext))

  const createdIds: string[] = []
  let updated = 0

  // CREATE — reuse the lean bulk importer (validation + image re-host + autoPublish + rank).
  if (toCreate.length) {
    const bulkRows: BulkRow[] = toCreate.map(({ row, ext }) => ({
      category_slug: row.categorySlug,
      title: row.title,
      description: row.description,
      price: row.price,
      district: row.district,
      condition: row.condition,
      image_urls: Array.isArray(row.images) ? row.images.map((u) => String(u).trim()).filter(Boolean).join('|') : undefined,
      external_id: ext,
    }))
    const res = await bulkImportCore(seller, bulkRows)
    res.results.forEach((rr, i) => {
      const ext = toCreate[i].ext
      if (rr.id) { createdIds.push(rr.id); results.push({ external_id: ext, id: rr.id, action: 'created' }) }
      else results.push({ external_id: ext, action: 'failed', error: rr.error || 'create failed' })
    })
    // The bulk importer is lean (no per-row webhook) — fan the events out once.
    if (createdIds.length) after(() => dispatchListingEventsBatch('listing.created', createdIds, seller.id))
  }

  // UPDATE — sparse, by id. Re-host any provided images, then reuse updateListingCore
  // (searchText rebuild + reindex + its own 'listing.updated' webhook). Status via setStatusCore.
  for (const { row, ext } of toUpdate) {
    const id = idByExt.get(ext)!
    try {
      const body: Record<string, unknown> = {}
      if (row.title !== undefined) body.title = row.title
      if (row.description !== undefined) body.description = row.description
      if (row.price !== undefined) body.price = row.price
      if (row.district !== undefined) body.district = row.district
      if (row.condition !== undefined) body.condition = row.condition
      if (Array.isArray(row.images)) {
        const hosted: string[] = []
        for (const u of row.images.slice(0, 8)) { const h = await rehostListingImage(String(u)); if (h) hosted.push(h) }
        body.images = hosted
      }
      if (Object.keys(body).length) {
        const u = await updateListingCore(id, body)
        if (!u.ok) { results.push({ external_id: ext, id, action: 'failed', error: u.error }); continue }
      }
      if (row.status !== undefined && VALID_STATUS.has(String(row.status))) await setStatusCore(id, String(row.status))
      updated++
      results.push({ external_id: ext, id, action: 'updated' })
    } catch {
      results.push({ external_id: ext, id, action: 'failed', error: 'update failed' })
    }
  }

  // FULL sync — retire (hide) the shop's active listings absent from this payload. Capture
  // ids first so we can drop them from AI search; PARTIAL never retires.
  let retired = 0
  // Guard: never retire on an EMPTY key set. Prisma compiles `notIn: []` to always-true, so
  // a full sync where no row had a valid externalId would otherwise hide the ENTIRE catalogue.
  if (mode === 'full' && extIds.length) {
    const toRetire = await db.listing.findMany({
      where: { sellerId: seller.id, status: 'active', externalId: { not: null, notIn: extIds } },
      select: { id: true },
    })
    if (toRetire.length) {
      const ids = toRetire.map((l) => l.id)
      await db.listing.updateMany({ where: { id: { in: ids } }, data: { status: 'hidden' } })
      retired = ids.length
      after(() => { for (const id of ids) removeFromIndex(id) })
    }
  }

  const failed = results.filter((x) => x.action === 'failed').length
  return { created: createdIds.length, updated, retired, failed, results }
}
