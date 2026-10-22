import 'server-only'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { containsPhoneNumber } from '@/lib/phone'
import { containsContactInfo, findBannedWord, minPhotosFor, type IdentityBlockCode, type PublishBlockCode } from '@/lib/publish-guard'
import { countDistinctAngles } from '@/lib/image-hash-url'
import { buildSearchText, fold } from '@/lib/fold'
import { findDuplicateListing } from '@/lib/duplicate-guard'
import { bulkPostingBudget } from '@/lib/enforcement'
import { releasedChargeGate } from '@/lib/released-charge-gate'
import { warmTranslations } from '@/lib/translate'
import { isListingImageUrl, isListingVideoUrl } from '@/lib/listing-image'
import { safeFetch } from '@/lib/ssrf'
import { rateLimit } from '@/lib/ratelimit'
import { logError } from '@/lib/log'
import { reindexListing } from '@/lib/listing-index'
import { moderateListingById } from '@/lib/ai-moderation'
import { indexAndCheckProvenance } from '@/lib/image-provenance'
import { storeListingImage, IMG_MAX_BYTES } from '@/lib/core/media'
import { browseRankScore } from '@/lib/ranking'
import { parseVnd } from '@/lib/vnd'
import { isPostableCategory, LICENCE_CHECK_SUBCATEGORIES, paysSalary, resolveListingType, salaryMFromPrice, salaryPriceFor, storesCondition, subcategoriesFor, subcategoryMatchesText, VISA_CATEGORY_SLUG } from '@/lib/taxonomy'
import { isHiringPost, JOB_TEXT_REFUSAL, jobTextProblem } from '@/lib/job-listing'
import { sellerPublishDecision, type SellerPublishDecision } from '@/lib/compliance/seller-publish-gate'
import { cutText } from '@/lib/feed-text'

// Bulk-import core (Phase 0). The business-tier bulk CSV importer, decoupled from auth:
// takes the ALREADY-RESOLVED seller + the rows and returns per-row results. Reused by the
// session route and the future /api/v1/listings/bulk. The caller does auth (business) +
// rate-limit + parse + the row cap; this owns category resolution, per-row validation,
// image re-host, create, and the after() side-effects.
export const BULK_MAX_ROWS = 200
// Global per-import budget on REMOTE image fetches (200 rows × 8 imgs = 1600 potential
// fetch+decode+upload ops). First-party (already-hosted) URLs don't count.
const MAX_IMG_FETCHES = 120

export type BulkRow = { category_slug?: string; title?: string; description?: string; price?: unknown; district?: string; condition?: string; image_urls?: string; video_url?: string; external_id?: string }
export type BulkRowResult = { row: number; id?: string; external_id?: string; error?: string }

// Server-fetch a remote image and re-host it (first-party, validated) via the media core.
// Already-hosted URLs pass through. SSRF-guarded fetch; null on any failure. Exported so the
// sync core's update path re-hosts images the same way.
export async function rehostListingImage(url: string, sellerId?: string): Promise<string | null> {
  return rehost(url, sellerId)
}

/**
 * ⛔ A PER-SELLER HOURLY BUDGET ON REMOTE IMAGE RE-HOSTING (security review 2026-10-22, item 13). Every remote image
 * costs a fetch, a sharp decode and a public-bucket upload on the one VN box, and the three paths that do it — MCP
 * create/update_listing, bulk import, catalogue sync — could be driven far past any honest catalogue: 32 tool calls
 * per MCP request at 600 requests/minute per key, and 200 rows × 8 images per bulk or sync call. MAX_IMG_FETCHES
 * still bounds a single import; this bounds the SELLER across calls, keys and paths. Images already on our bucket
 * pass through free (never fetched, never charged). Over budget, the image is skipped — the listing is still made.
 */
export const REHOST_IMAGES_PER_HOUR = 2000

/**
 * Read a response body with a hard byte ceiling, ABORTING the transfer once it is crossed — the old code buffered the
 * whole body (`arrayBuffer()`) and only then compared the size, so a 1 GB "image" was held in memory first (item 13).
 */
async function readCapped(res: Response, max: number): Promise<Buffer | null> {
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > max) { await res.body?.cancel().catch((e) => logError(e, { op: 'bulk.rehost.cancel' })); return null }
  const reader = res.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) { await reader.cancel().catch((e) => logError(e, { op: 'bulk.rehost.cancel' })); return null }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

async function rehost(url: string, sellerId?: string): Promise<string | null> {
  if (isListingImageUrl(url)) return url
  if (sellerId) {
    // Strict: a limiter outage must not uncap server-side fetching (it fails closed — the image is skipped).
    const budget = await rateLimit('rehost-images', sellerId, REHOST_IMAGES_PER_HOUR, '1 h', { strict: true })
    if (!budget.success) return null
  }
  try {
    const res = await safeFetch(url, { timeoutMs: 8000 })
    if (!res.ok) return null
    const buf = await readCapped(res, IMG_MAX_BYTES)
    if (!buf || buf.byteLength === 0) return null
    return await storeListingImage(buf, { pathPrefix: 'bulk/' })
  } catch {
    return null
  }
}

export async function bulkImportCore(
  seller: { id: string; ownerId?: string | null; trustTier: string; trustScore: number },
  rows: BulkRow[],
  opts?: { publishDecision?: SellerPublishDecision },
): Promise<{ created: number; failed: number; results: BulkRowResult[]; imageBudgetReached: boolean; blocked?: IdentityBlockCode }> {
  // Enforcement ladder lives IN the core (audit P0 #3 + review): every caller — the
  // session route, /api/v1, the MCP tools, anything future — is covered here, not just
  // the routes. Held/suspended → the whole batch fails with the stable code; probation
  // → only the remaining active-listing budget may be created (cap enforced per-row
  // below, so a 7-active probation account can't bulk 200 past the cap of 8).
  let createBudget = Infinity
  if (seller.ownerId) {
    const budget = await bulkPostingBudget(seller.ownerId, seller.id)
    if (budget.blocked) {
      return {
        created: 0,
        failed: rows.length,
        results: rows.map((_, i) => ({ row: i + 1, error: budget.blocked!.error })),
        imageBudgetReached: false,
      }
    }
    if (budget.maxNewActive != null) createBudget = budget.maxNewActive
  }

  // Seller identity gate (NĐ 248/2026) — a bulk import is SELLER-INITIATED, so a refused owner fails
  // the WHOLE batch before any row is touched, exactly like `budget.blocked` above: per-row failures
  // would make a 200-row CSV report 200 identical errors and still re-host every image first.
  // `blocked` names the code once so every caller (session route, /api/v1, MCP) can surface it as a
  // refusal rather than as a pile of failed rows. One decision per import, never per row; the sync
  // core resolves it itself and passes it in. Gate off → no read, and `blocked` is never set.
  // ⚠️ `guestCreate` is NOT set: every caller here is an authenticated shop, and an ownerless shop on
  // these paths is a platform import seller, which the gate deliberately lets through.
  const decision = opts?.publishDecision ?? await sellerPublishDecision({ ownerId: seller.ownerId ?? null })
  if (!decision.ok) {
    const code = decision.code
    return {
      created: 0,
      failed: rows.length,
      // ⚠️ Each refused row carries its `external_id`, normalised exactly as a created row's is below:
      // a partner correlates results by its own id, and /api/v1/listings/bulk answered
      // `external_id: null` for every item of a refused batch.
      results: rows.map((r, i) => ({ row: i + 1, ...(r.external_id ? { external_id: String(r.external_id).trim() } : {}), error: code })),
      imageBudgetReached: false,
      blocked: code,
    }
  }
  // The released-scam-charge regime (released-charge-gate.ts), resolved ONCE per import like the
  // budget above: a seller whose only standing scam charges an admin released is not refused by the
  // restricted tier below, and every standing released charge caps the rows that may be created at
  // the storefront's remaining active-listing allowance. Null (no release marker) for everyone else.
  const released = await releasedChargeGate(seller.ownerId, seller.id)
  const releasedBudget = released ? released.remaining : Infinity
  let createdCount = 0

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
      const title = cutText(String(r.title || '').trim(), 140)
      const description = cutText(String(r.description || '').trim(), 5000)
      const district = r.district ? cutText(String(r.district).trim(), 80) : null
      const condition = r.condition ? cutText(String(r.condition).trim(), 60) : null
      // Numbers (API JSON) pass through; STRINGS (CSV) parse via the canonical
      // digits-only parseVnd — '9.500' is 9,500 đ dot-thousands, never 9.5 (audit P2).
      const price = typeof r.price === 'number' ? r.price : parseVnd(String(r.price ?? ''))
      const cat = catBySlug.get(categorySlug)

      if (!cat) { results.push({ row: rowNo, error: `Unknown category "${categorySlug}"` }); continue }
      // ⛔ A CATEGORY NOBODY POSTS INTO IS REFUSED HERE TOO (2026-10-09) — taxonomy.ts NON_POSTING_CATEGORIES, today
      // `teachers`, whose rows only src/lib/teachers/publish.ts writes, beside the TeacherProfile they need. This core
      // creates with its own `db.listing.create`, so createListingCore's refusal never ran for it: a hand-made request
      // to /api/listings/bulk, /api/v1/listings/bulk, the MCP bulk tool or a partner sync's create made a LIVE, verified
      // teachers listing with NO profile — a priced 'sell' page under Teachers (listingType falls to the column
      // default) and a row the teacher pipeline cannot read.
      // ⚠️ ONE RULE: the same `isPostableCategory` the single path calls (listings.ts) and the same code it throws —
      // never a slug list of this file's own, so a category added to that set is refused on every path at once.
      // Per row and BEFORE anything is read or written for it (no duplicate lookup, no image fetch or upload), so the
      // rest of the batch imports exactly as it does past any other bad row. The web panel never sends one (its slug
      // list is /api/categories, which already hides the category); the code reaches API, MCP and sync callers.
      if (!isPostableCategory(cat.slug)) { results.push({ row: rowNo, error: 'category_not_postable' satisfies PublishBlockCode }); continue }
      if (title.length < 3) { results.push({ row: rowNo, error: 'Title too short (min 3 chars)' }); continue }
      if (!Number.isFinite(price) || price < 0 || price > 1e12) { results.push({ row: rowNo, error: 'Invalid price' }); continue }
      // ⚠️ THE DISTRICT AND THE CONDITION ARE PRINTED TOO — the district as the listing's location — and the single
      // create and edit paths screen both as secondary fields (listings.ts); this path screened only the title and the
      // description, so a CSV or API row could carry a phone or a Zalo handle in them (security review 2026-10-22, item 32).
      const printed = [title, description, district, condition]
      if (printed.some((t) => containsPhoneNumber(t) || containsContactInfo(t))) { results.push({ row: rowNo, error: 'Remove phone / contact info / address from the title, description, district and condition' }); continue }
      { const bw = findBannedWord(printed.filter(Boolean).join(' ')); if (bw) { results.push({ row: rowNo, error: `Contains a banned word ("${bw}")` }); continue } }
      // ⛔ A LICENCE-AISLE SERVICE IS NEVER BULK-IMPORTED (security review 2026-10-22, item 8). This core creates rows live
      // with no subcategory and never runs the licence check, so a Services row titled "Vietnam e-Visa 90 days" or "Work
      // permit renewal" published an unchecked visa or permit offer — the bypass createListingCore closes by re-filing such
      // a post into its aisle and holding it (listings.ts). A row cannot carry the provider's registered name and licence
      // number that check needs, so it is refused, naming the path that works. Title only, the single path's rule.
      if (cat.slug === VISA_CATEGORY_SLUG && LICENCE_CHECK_SUBCATEGORIES.some((a) => subcategoriesFor(cat.slug).some((s) => s.slug === a) && subcategoryMatchesText(cat.slug, a, title))) {
        results.push({ row: rowNo, error: 'e-Visa and legal or permit services are posted one at a time, so eno can check the provider’s licence before they go live' }); continue
      }
      // ⛔ A HIRING ROW GETS THE JOB-TEXT SCREEN TOO (job-listing.ts jobTextProblem — teacher visibility plan §3a item 6,
      // 2026-10-18): this core creates with its own db.listing.create, so createListingCore's screen never runs for a CSV,
      // /api/v1 bulk, MCP bulk or partner-sync row, and a school could post round it. Every Jobs row is stored as a hiring
      // post (the `job` intent, below), on either edition. A row's printed text is its title, its description — read as the
      // page renders it, in formatRichText's blocks ('rich') — and its district (which is also its location; the city is
      // fixed, a BulkRow carries no attributes, and a job's condition is never stored: below). Free prose like the screens
      // above, naming the field, the words that tripped it and the rule; per row, before the duplicate lookup or any image
      // work.
      if (isHiringPost(cat.slug, resolveListingType(cat.slug, 'job'))) {
        const p = jobTextProblem([['title', title], ['description', description, 'rich'], ['district', district]])
        if (p) { results.push({ row: rowNo, error: `In the ${p.field}, “${p.snippet}”: ${JOB_TEXT_REFUSAL[p.code].en}` }); continue }
      }
      // Restricted (low-trust) account → can't publish until its score recovers.
      if (seller.trustTier === 'restricted' && !released?.waivesRestricted) { results.push({ row: rowNo, error: 'Account restricted — wait for your trust score to recover before posting' }); continue }

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
        const h = await rehost(u, seller.id)
        if (h) hosted.push(h)
      }

      // Same bar as the wizard/API, INCLUDING the per-category minimum — service rows need
      // one photo, goods need 3 different angles (re-hosted images carry their dHash in the
      // URL, so the same photo repeated counts once). Importing services through this path
      // would otherwise be held to a stricter rule than posting them in the wizard.
      const minPhotos = minPhotosFor(categorySlug)
      if (countDistinctAngles(hosted) < minPhotos) {
        results.push({
          row: rowNo,
          error: minPhotos === 1
            ? 'Needs at least 1 photo'
            : `Needs at least ${minPhotos} photos from different angles`,
        }); continue
      }
      // Probation cap: creations beyond the remaining active-listing budget fail with
      // the same stable code the single-create gate uses.
      if (createdCount >= createBudget) {
        results.push({ row: rowNo, error: 'probation_listing_cap' }); continue
      }
      // Released-scam-charge cap: same shape, its own stable code (released-charge-gate.ts).
      if (createdCount >= releasedBudget) {
        results.push({ row: rowNo, error: 'released_charge_listing_cap' }); continue
      }
      // ⛔ A JOB ROW IS PAID A SALARY (taxonomy.ts paysSalary), as on every other create path: stored as
      // the category's 'job' intent, its `price` column read as the MONTHLY salary and kept in whole
      // millions (salaryM, ROUNDED DOWN and clamped to the Salary facet's range — taxonomy.ts
      // salaryMFromPrice, the rule every create and edit path shares) so the Salary filter finds it and a
      // later edit re-derives the same figure, per month, and never negotiable — a job takes no offers.
      const jobType = resolveListingType(cat.slug, 'job')
      const salaryRow = paysSalary(jobType)
      const salaryM = salaryRow ? salaryMFromPrice(price, cat.slug) : null
      const listing = await db.listing.create({
        data: {
          title, description, currency: '₫',
          ...(salaryRow
            ? { price: salaryPriceFor(salaryM), priceUnit: 'VND/month', negotiable: false, listingType: jobType, salaryM }
            : { price, priceUnit: 'VND', negotiable: true }),
          location: district || 'Ho Chi Minh City', district, city: 'Ho Chi Minh City',
          // ⛔ None on a job (taxonomy.ts storesCondition): the job page prints no condition, so a Jobs row stores none.
          condition: storesCondition(cat.slug) ? condition : null, images: JSON.stringify(hosted),
          /**
           * ⛔ ONLY A URL WE ALREADY HOST. `video_url` arrives from the client, which uploads the
           * clip through the ordinary signed video flow and sends back what that returned — so the
           * honest test is "is this in our own listing-videos bucket", not "is this a URL". Any
           * other string is DROPPED rather than rejected: a bad clip must not cost the seller the
           * whole row when the photos and the text are fine.
           *
           * ⚠️ NOT RE-HOSTED LIKE AN IMAGE, deliberately. `rehost()` pulls a remote image server-side
           * and re-encodes it; doing that for video would mean pulling up to a 50MB clip into a
           * serverless function per row. The client already put it in the right bucket.
           */
          ...(isListingVideoUrl(r.video_url) ? { video: r.video_url } : {}),
          searchText: buildSearchText([title, description, district, cat.name, cat.nameVi]),
          categoryId: cat.id, sellerId: seller.id, sellerTrustScore: seller.trustScore, verified: true,
          rankScore: browseRankScore({ sellerTrustScore: seller.trustScore, postedAt: new Date(), featured: false }),
          ...(r.external_id ? { externalId: String(r.external_id).trim().slice(0, 128) } : {}),
        },
        select: { id: true },
      })
      results.push({ row: rowNo, id: listing.id, ...(r.external_id ? { external_id: String(r.external_id).trim() } : {}) })
      createdCount++
      warm.push(title, description)
    } catch {
      results.push({ row: rowNo, error: 'Failed to create' })
    }
  }

  if (warm.length) after(() => warmTranslations(warm.filter(Boolean)))
  after(() => { for (const r of results) if (r.id) reindexListing(r.id) }) // index the live imports for AI search
  // Tier-2 illegal-content moderation on the bulk/sync path too (closes the highest-volume
  // ingestion gap). Trust-gated inside; limited concurrency so a 200-row import doesn't spike
  // the Gemini vision quota. Best-effort within the after() window; the inline word-scan +
  // reports still cover the tail of a very large import. Fail-open per listing.
  after(async () => {
    const ids = results.filter((r) => r.id).map((r) => r.id as string)
    const CONCURRENCY = 4
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      await Promise.all(ids.slice(i, i + CONCURRENCY).map(async (id) => {
        await moderateListingById(id)          // AI prohibited-content (trust-gated inside)
        await indexAndCheckProvenance(id)       // cross-app image provenance (indexed, cheap)
      }))
    }
  })

  const created = results.filter((r) => r.id).length
  return { created, failed: results.length - created, results, imageBudgetReached }
}
