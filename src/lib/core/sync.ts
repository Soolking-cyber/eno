import 'server-only'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { bulkImportCore, rehostListingImage, BULK_MAX_ROWS, type BulkRow } from '@/lib/core/bulk'
import { bulkPostingBudget } from '@/lib/enforcement'
import { updateListingCore, setStatusCore } from '@/lib/core/listings'
import { removeFromIndex } from '@/lib/listing-index'
import { dispatchListingEventsBatch } from '@/lib/webhooks'
import { sellerPublishDecision } from '@/lib/compliance/seller-publish-gate'
import type { IdentityBlockCode } from '@/lib/publish-guard'

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
  seller: { id: string; ownerId?: string | null; trustTier: string; trustScore: number },
  rows: SyncRow[],
  mode: 'partial' | 'full',
): Promise<{ created: number; updated: number; retired: number; failed: number; results: SyncRowResult[]; blocked?: IdentityBlockCode }> {
  // Enforcement ladder in the core (audit P0 #3): a held/suspended seller must not
  // create, re-activate, or otherwise manage listings through sync — from ANY caller
  // (route, MCP, future). Creations additionally inherit the probation create-budget
  // via bulkImportCore below (seller.ownerId passes through).
  if (seller.ownerId) {
    const budget = await bulkPostingBudget(seller.ownerId, seller.id)
    if (budget.blocked) {
      return {
        created: 0, updated: 0, retired: 0, failed: rows.length,
        results: rows.map((row) => ({ external_id: cleanExt(row.externalId ?? row.external_id) || null, action: 'failed' as const, error: budget.blocked!.error })),
      }
    }
  }
  const results: SyncRowResult[] = []

  // Seller identity gate — resolved ONCE for the whole call and handed to both halves below, so a
  // 200-row sync costs one decision, not 200. Gate off → PUBLISH_ALLOWED with no read.
  // A refusal does not fail the sync wholesale: updates to listings that STAY where they are (a price
  // change on a live row, marking something sold) are not publishing and go through. What is refused
  // is every transition INTO public state — each create, and each revive of a sold/hidden row.
  const publishDecision = await sellerPublishDecision({ ownerId: seller.ownerId ?? null })

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
    ? await db.listing.findMany({ where: { sellerId: seller.id, externalId: { in: extIds } }, select: { id: true, externalId: true, status: true } })
    : []
  const idByExt = new Map(existing.map((l) => [l.externalId!, l.id]))
  const statusByExt = new Map(existing.map((l) => [l.externalId!, l.status]))

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
    const res = await bulkImportCore(seller, bulkRows, { publishDecision })
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
    // ⚠️ A REFUSED REVIVE FAILS THE ROW BEFORE ANY WRITE. Checking only at setStatusCore would apply
    // the row's edits and then refuse its status, leaving a half-applied row reported as failed.
    if (!publishDecision.ok && row.status === 'active' && statusByExt.get(ext) !== 'active') {
      results.push({ external_id: ext, id, action: 'failed', error: publishDecision.code })
      continue
    }
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
      if (row.status !== undefined && VALID_STATUS.has(String(row.status))) {
        const st = await setStatusCore(id, String(row.status), undefined, { publishDecision })
        // Only reachable in a race (the row went inactive between the read above and now): report
        // it rather than counting a refused revive as an update.
        if (!st.ok) { results.push({ external_id: ext, id, action: 'failed', error: st.error }); continue }
      }
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
  // Name the identity refusal once when it actually cost a row, so callers can surface it as the
  // reason rather than leaving the partner to spot the code repeated across `results`.
  const blocked = !publishDecision.ok && results.some((x) => x.error === publishDecision.code) ? publishDecision.code : undefined
  return { created: createdIds.length, updated, retired, failed, results, ...(blocked ? { blocked } : {}) }
}
