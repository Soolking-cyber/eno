import 'server-only'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { containsPhoneNumber } from '@/lib/phone'
import { containsContactInfo, findBannedWord } from '@/lib/publish-guard'
import { buildSearchText, fold } from '@/lib/fold'
import { findDuplicateListing } from '@/lib/duplicate-guard'
import { warmTranslations } from '@/lib/translate'
import { isListingImageUrl } from '@/lib/listing-image'
import { safeFetch } from '@/lib/ssrf'
import { reindexListing } from '@/lib/listing-index'
import { storeListingImage, IMG_MAX_BYTES } from '@/lib/core/media'
import { browseRankScore } from '@/lib/ranking'

// Bulk-import core (Phase 0). The business-tier bulk CSV importer, decoupled from auth:
// takes the ALREADY-RESOLVED seller + the rows and returns per-row results. Reused by the
// session route and the future /api/v1/listings/bulk. The caller does auth (business) +
// rate-limit + parse + the row cap; this owns category resolution, per-row validation,
// image re-host, create, and the after() side-effects.
export const BULK_MAX_ROWS = 200
// Global per-import budget on REMOTE image fetches (200 rows × 8 imgs = 1600 potential
// fetch+decode+upload ops). First-party (already-hosted) URLs don't count.
const MAX_IMG_FETCHES = 120

export type BulkRow = { category_slug?: string; title?: string; description?: string; price?: unknown; district?: string; condition?: string; image_urls?: string; external_id?: string }
export type BulkRowResult = { row: number; id?: string; external_id?: string; error?: string }

// Server-fetch a remote image and re-host it (first-party, validated) via the media core.
// Already-hosted URLs pass through. SSRF-guarded fetch; null on any failure. Exported so the
// sync core's update path re-hosts images the same way.
export async function rehostListingImage(url: string): Promise<string | null> {
  return rehost(url)
}
async function rehost(url: string): Promise<string | null> {
  if (isListingImageUrl(url)) return url
  try {
    const res = await safeFetch(url, { timeoutMs: 8000 })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > IMG_MAX_BYTES) return null
    return await storeListingImage(buf, { pathPrefix: 'bulk/' })
  } catch {
    return null
  }
}

export async function bulkImportCore(
  seller: { id: string; trustTier: string; trustScore: number },
  rows: BulkRow[],
): Promise<{ created: number; failed: number; results: BulkRowResult[]; imageBudgetReached: boolean }> {
  // Resolve all referenced categories once.
  const slugs = [...new Set(rows.map((r) => String(r.category_slug || '').trim()).filter(Boolean))]
  const cats = await db.category.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true, name: true, nameVi: true } })
  const catBySlug = new Map(cats.map((c) => [c.slug, c]))

  const results: BulkRowResult[] = []
  const warm: string[] = []
  let imgFetched = 0 // counts REMOTE rehosts against MAX_IMG_FETCHES (per-import budget)
  let imageBudgetReached = false
  // Within-file duplicate tracker: two rows with the same (folded title, category) in ONE
  // import are the CSV cousin of repost spam — reject the later row, naming the earlier one.
  const seenInBatch = new Map<string, number>() // "<categoryId>|<foldedTitle>" → row number

  // Process sequentially (image re-hosting is network-bound; pacing avoids a burst).
  // Each row is independent — one bad row never aborts the batch.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const rowNo = i + 1
    try {
      const categorySlug = String(r.category_slug || '').trim()
      const title = String(r.title || '').trim().slice(0, 140)
      const description = String(r.description || '').trim().slice(0, 5000)
      const district = r.district ? String(r.district).trim().slice(0, 80) : null
      const condition = r.condition ? String(r.condition).trim().slice(0, 60) : null
      const price = Number(r.price)
      const cat = catBySlug.get(categorySlug)

      if (!cat) { results.push({ row: rowNo, error: `Unknown category "${categorySlug}"` }); continue }
      if (title.length < 3) { results.push({ row: rowNo, error: 'Title too short (min 3 chars)' }); continue }
      if (!Number.isFinite(price) || price < 0 || price > 1e12) { results.push({ row: rowNo, error: 'Invalid price' }); continue }
      if (containsPhoneNumber(title) || containsPhoneNumber(description) || containsContactInfo(title) || containsContactInfo(description)) { results.push({ row: rowNo, error: 'Remove phone / contact info / address from the title and description' }); continue }
      { const bw = findBannedWord(`${title} ${description}`); if (bw) { results.push({ row: rowNo, error: `Contains a banned word ("${bw}")` }); continue } }
      // Restricted (low-trust) account → can't publish until its score recovers.
      if (seller.trustTier === 'restricted') { results.push({ row: rowNo, error: 'Account restricted — wait for your trust score to recover before posting' }); continue }

      // Duplicate protection. Partner-managed rows (external_id) keep their own identity
      // semantics (the sync flow updates by external_id), so only ad-hoc rows are checked:
      // first against earlier rows in THIS file, then against the seller's live listings.
      if (!r.external_id) {
        const batchKey = `${cat.id}|${fold(title)}`
        const earlier = seenInBatch.get(batchKey)
        if (earlier) { results.push({ row: rowNo, error: `Duplicate of row ${earlier} in this file` }); continue }
        seenInBatch.set(batchKey, rowNo)
        const dup = await findDuplicateListing({
          sellerId: seller.id,
          categoryId: cat.id,
          title,
          searchText: buildSearchText([title, description, district, cat.name, cat.nameVi]),
          price,
          images: [], // bulk re-hosts images AFTER this check → no hashes yet; text signal only
        })
        if (dup) { results.push({ row: rowNo, error: `Duplicate of your live listing "${dup.title}" — edit or bump that one instead` }); continue }
      }

      // Re-host up to 8 images. First-party URLs pass through free; remote URLs each
      // cost one unit of the per-import MAX_IMG_FETCHES budget.
      const rawUrls = String(r.image_urls || '').split(/[|,\n]/).map((u) => u.trim()).filter(Boolean).slice(0, 8)
      const hosted: string[] = []
      for (const u of rawUrls) {
        if (isListingImageUrl(u)) { hosted.push(u); continue }
        if (imgFetched >= MAX_IMG_FETCHES) { imageBudgetReached = true; continue }
        imgFetched++
        const h = await rehost(u)
        if (h) hosted.push(h)
      }

      if (hosted.length < 1) { results.push({ row: rowNo, error: 'Needs at least one photo' }); continue }
      const listing = await db.listing.create({
        data: {
          title, description, price, priceUnit: 'VND', currency: '₫', negotiable: true,
          location: district || 'Ho Chi Minh City', district, city: 'Ho Chi Minh City',
          condition, images: JSON.stringify(hosted),
          searchText: buildSearchText([title, description, district, cat.name, cat.nameVi]),
          categoryId: cat.id, sellerId: seller.id, sellerTrustScore: seller.trustScore, verified: true,
          rankScore: browseRankScore({ sellerTrustScore: seller.trustScore, postedAt: new Date(), featured: false }),
          ...(r.external_id ? { externalId: String(r.external_id).trim().slice(0, 128) } : {}),
        },
        select: { id: true },
      })
      results.push({ row: rowNo, id: listing.id, ...(r.external_id ? { external_id: String(r.external_id).trim() } : {}) })
      warm.push(title, description)
    } catch {
      results.push({ row: rowNo, error: 'Failed to create' })
    }
  }

  if (warm.length) after(() => warmTranslations(warm.filter(Boolean)))
  after(() => { for (const r of results) if (r.id) reindexListing(r.id) }) // index the live imports for AI search

  const created = results.filter((r) => r.id).length
  return { created, failed: results.length - created, results, imageBudgetReached }
}
