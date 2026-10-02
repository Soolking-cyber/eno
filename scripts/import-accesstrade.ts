/**
 * Import an AccessTrade campaign's product feed as affiliate listings.
 *
 *   npx tsx scripts/import-accesstrade.ts --campaign cellphones_cps            # DRY RUN
 *   npx tsx scripts/import-accesstrade.ts --campaign cellphones_cps --limit 20 # small slice
 *   npx tsx scripts/import-accesstrade.ts --campaign cellphones_cps --apply
 *
 * ⚠️ ONLY APPROVED CAMPAIGNS EARN. `datafeeds` with no campaign filter reports 16.7M products
 * across AccessTrade's whole network; their aff_links resolve but pay nothing unless the campaign
 * is approved for this publisher. Run scripts/accesstrade-explore.ts to see which are.
 *
 * ⛔ IDEMPOTENT ON (sellerId, externalId) — THE SCHEMA ALREADY HAD THIS. Listing.externalId exists
 * with `@@unique([sellerId, externalId])` for the Partner API's sync/upsert, and it is exactly the
 * right key here: re-running refreshes prices instead of multiplying a 9,728-product catalogue.
 * ⚠️ Do NOT add a global unique index on externalId — `trip-assistance-anchor` is already stored
 * twice by the trips feature, so a global index cannot be created and is not what the column means.
 *
 * ⚠️ IMAGES ARE FETCHED ONCE. A product that already has an image is left alone, because the
 * expensive half of this job is 9,728 fetch→crop→upload round trips, and a nightly price refresh
 * must not repeat them or the storage volume grows by ~1.2GB every run.
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { db } from '../src/lib/db'
import { makeImageHost } from '../src/lib/host-product-image'
import { brandSlugify, normalizeBrand } from '../src/lib/brand-normalize'
import { categoryFor, subcategoryFor, brandFor, FEED_BRANDS, refreshPlacement } from '../src/lib/feed-taxonomy'
import { modelFor } from '../src/lib/feed-model'
import { buildSearchText } from '../src/lib/fold'
// ⚠️ ONE COPY, SHARED WITH THE NIGHTLY REFRESH. This link repair used to live here; the cron job
// needs exactly the same rule, and two copies of "which aff_link shapes do we trust" is how one
// of them quietly rots. It is unit-tested in src/lib/affiliate-price-refresh.test.ts.
import { repairAffLink } from '../src/lib/affiliate-price-refresh'
import { browseRankScore } from '../src/lib/ranking-formula'
// ⛔ Every importer screens a row before it writes it — banned words + advertising-banned goods.
import { ImportScreen } from '../src/lib/import-screen'
// ⛔ Feed text arrives with HTML entities encoded ("Fun &amp; Online"): decoded on the way in, and repaired
// in the stored columns on a refresh (translation audit 2026-10-02, F9). See src/lib/feed-text.ts.
import { cutText, decodeEntities, entityRepairs, feedDescription } from '../src/lib/feed-text'
import { createHash } from 'node:crypto'
/**
 * ⚠️ THE FEED'S aff_links ARE REPAIRED LOCALLY, NOT MINTED PER PRODUCT. `product_link/create`
 * works and would also be correct, but it is one HTTP round trip per product — 9,728 of them for a
 * link whose only defect is a missing campaign id in a known position. The repaired shape was
 * verified end to end: it 302s and resolves 200 at click.accesstrade.vn.
 */

const KEY = process.env.ACCESSTRADE_KEY
if (!KEY) { console.error('ACCESSTRADE_KEY missing from .env'); process.exit(1) }
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const CAMPAIGN = arg('campaign')
const LIMIT = Number(arg('limit') ?? 0)
const CONCURRENCY = Number(arg('concurrency') ?? 6)
/**
 * Import only feed rows whose NAME matches this pattern (case-insensitive) — and, with --cate, only rows
 * in that feed category. Owner, 2026-09-15: bring in the iPhone 18 phones CellphoneS added after the
 * 2026-08-24 import, and nothing else. Without a filter the only option was the whole campaign: 9,688
 * rows refreshed and every product added since created, when the ask was eight phones.
 * ⚠️ --cate IS WHAT KEEPS ACCESSORIES OUT. Measured on the live feed: /iphone\s*18/ matched 115 rows, 107
 * of them cases and screen protectors ("Ốp lưng iPhone 18 Pro/17 Pro …") in `electronic_accessories`;
 * the 8 phones are exactly the `phone_tablets` rows. A name pattern alone would import the cases too.
 * ⚠️ The whole feed is still paged — the datafeeds API ignores `keyword` (measured: identical totals with
 * and without it), so filtering has to happen here.
 */
const MATCH = arg('match') ? new RegExp(arg('match')!, 'i') : null
const CATE = arg('cate') ?? null
if (!CAMPAIGN) { console.error('--campaign <name> required'); process.exit(1) }

const BUCKET = 'listings'
const EDGE = 1200            // product shots; smaller than a listing photo's 1600 — 9.7k of them
const WEBP_QUALITY = 80

type Feed = { name: string; price: number; discount: number; status_discount: number | string
  image: string; url: string; aff_link: string; sku: string; product_id: string; cate: string; desc: string; domain: string }

/**
 * ⛔ THE TITLE→TAXONOMY RULES MOVED TO src/lib/feed-taxonomy.ts (2026-09-07) — do not re-inline
 * them. Same reason `modelFor` left for src/lib/feed-model.ts: this file imports `../src/lib/db`
 * at module scope, so nothing declared here can be unit-tested, and the rule that stayed inline
 * invented a product ("Apple Watch Ultra 4", from the 49 in "49mm") across 6 live listings before
 * anyone could write a test for it. `categoryFor` / `subcategoryFor` / `brandFor` now have their
 * own tests, and the partner-shop importer shares the exact same mapping rather than a copy that
 * would drift on the next fridge-versus-wardrobe question.
 */

async function feedPage(page: number, limit: number): Promise<{ data: Feed[]; total: number }> {
  const url = `https://api.accesstrade.vn/v1/datafeeds?campaign=${encodeURIComponent(CAMPAIGN!)}&limit=${limit}&page=${page}`
  const res = await fetch(url, { headers: { Authorization: `Token ${KEY}` }, signal: AbortSignal.timeout(45_000) })
  if (!res.ok) throw new Error(`datafeeds page ${page}: HTTP ${res.status}`)
  return (await res.json()) as { data: Feed[]; total: number }
}

const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
const secret = process.env.SUPABASE_SECRET_KEY
if (APPLY && (!storageUrl || !secret)) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required'); process.exit(1) }
if (APPLY && /supabase\.co$/.test(new URL(storageUrl!).hostname)) { console.error(`Refusing to upload to ${storageUrl} — retired project`); process.exit(1) }
const storage = APPLY ? createClient(storageUrl!, secret!, { auth: { persistSession: false } }).storage.from(BUCKET) : null

/**
 * ⚠️ MOVED TO src/lib/host-product-image.ts so the enrichment script can use the same one. The
 * behaviour is unchanged — same longest-edge resize, same watermark placement, same bucket path
 * shape. See that file for why there is no square crop and why EXIF orientation is read after
 * `.rotate()`.
 */
const hostImage = makeImageHost({ storage, storageUrl: storageUrl!, bucket: BUCKET, edge: EDGE, quality: WEBP_QUALITY })

async function main() {
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — campaign=${CAMPAIGN}${LIMIT ? ` (first ${LIMIT})` : ''}\n`)

  const first = await feedPage(1, 1)
  const total = LIMIT || first.total
  console.log(`feed reports ${first.total} products; importing ${total}\n`)

  const cats = await db.category.findMany({ select: { id: true, slug: true } })
  const catId = new Map(cats.map((c) => [c.slug, c.id]))
  const catSlug = new Map(cats.map((c) => [c.id, c.slug]))

  // ⛔ IDENTIFIED BY NAME, AND REFUSED IF IT HAS AN OWNER. A storefront with an ownerId belongs to
  // a real person; hanging 9,728 affiliate rows off it would hand them a catalogue they never
  // posted. VinWonders' seeder learned this the same way.
  // The campaign's numeric id, needed to repair every aff_link. Read from the API so this script
  // works for any campaign without a hardcoded table.
  const campList = await (await fetch(`https://api.accesstrade.vn/v1/campaigns?approval=successful&limit=50`, { headers: { Authorization: `Token ${KEY}` } })).json() as { data: { id: string; merchant: string; name?: string }[] }
  const campaign = (campList.data || []).find((c) => c.merchant === CAMPAIGN)
  const campaignId = campaign?.id
  if (!campaignId) {
    // ⛔ Not approved = the links earn nothing. Refuse rather than fill the marketplace with them.
    console.error(`"${CAMPAIGN}" is not an APPROVED campaign for this publisher — refusing.`)
    console.error('Approved:', (campList.data || []).map((c) => c.merchant).join(', ') || '(none)')
    process.exit(1)
  }
  console.log(`campaign id ${campaignId}\n`)

  /**
   * ⛔ THE MERCHANT'S OWN NAME, FROM THE CAMPAIGN — NOT THE SLUG. This read
   * `CAMPAIGN === 'cellphones_cps' ? 'CellphoneS' : CAMPAIGN`, i.e. one hardcoded exception and the
   * raw slug for everyone else. Importing `--campaign ben` would therefore have created a
   * user-facing storefront called "ben" instead of "BỀN COMPUTER".
   * ⚠️ SAFE FOR THE EXISTING CATALOGUE: the API's name for `cellphones_cps` is exactly
   * "CellphoneS", so the 9,726 listings already hanging off that storefront still resolve to the
   * same row by name — verified against the campaigns endpoint before removing the special case.
   * ⚠️ `--name` overrides it, for a merchant whose registered name is not what shoppers should see.
   */
  const merchantName = arg('name') ?? (campaign?.name?.trim() || CAMPAIGN!)
  // The merchant's own city. Only used for the storefront and the listings' fallback map pin.
  const MERCHANT_CITY = arg('city') ?? 'Hồ Chí Minh'
  let seller = await db.seller.findFirst({ where: { name: merchantName }, select: { id: true, name: true, ownerId: true, trustScore: true } })
  if (seller?.ownerId) { console.error(`"${merchantName}" is owned by a real account — refusing`); process.exit(1) }
  if (!seller) {
    console.log(`storefront "${merchantName}" does not exist — ${APPLY ? 'creating' : 'would create'}`)
    if (APPLY) {
      seller = await db.seller.create({
        // ⛔ officialPartner IS FALSE AGAIN SINCE 2026-10-01 — OWNER DECISION, REVERSING 2026-09-17
        // ("also give all fetching stores a partner badge"). The badge is kept ONLY for companies with
        // a signed agreement; an imported datafeed shows the neutral "Linked shop" chip
        // (src/lib/linked-seller.ts). That is what this comment said before 2026-09-17 too: "that
        // badge is for negotiated partners; stamping it on an imported datafeed devalues the real
        // one". Granting it is per-seller: scripts/set-official-partner.mjs.
        // ⚠️ Written from the campaign, not hardcoded: this script takes --campaign, so baking
        // CellphoneS's bio and city in would mislabel the next merchant imported through it.
        data: { name: merchantName, bio: `Products are bought and paid for on the ${merchantName} website.`,
                location: MERCHANT_CITY, officialPartner: false, verified: false },
        // ⚠️ `trustScore` is selected because rankScore is computed from it at create — see the
        // note at the field. A new storefront takes the schema default, which is what a brand-new
        // human seller gets too.
        select: { id: true, name: true, ownerId: true, trustScore: true },
      })
    }
  }
  if (!seller && !APPLY) console.log('(dry run continues without a storefront)\n')

  if (APPLY) {
    // Create only the brands this feed actually uses often enough to be worth a facet entry.
    const have = new Set((await db.brand.findMany({ select: { slug: true } })).map((b) => b.slug))
    const missing = FEED_BRANDS.map(brandSlugify).filter((b) => !have.has(b))
    for (const slug of missing) {
      // `normalized` is the uniqueness/typo-dedup key (see brand-normalize.ts) — required, and
      // computed with the app's own helper so an imported brand collides with a human-typed one.
      const name = slug.charAt(0).toUpperCase() + slug.slice(1)
      await db.brand.create({ data: { slug, name, normalized: normalizeBrand(name) } }).catch(() => {})
    }
    if (missing.length) console.log(`brands created: ${missing.join(', ')}\n`)
  }

  let seen = 0, matched = 0, created = 0, updated = 0, skipped = 0, imaged = 0, entityRows = 0, carried = 0
  const failures: string[] = []
  /**
   * ⚠️ A DECODED TEXT IS A NEW CACHE KEY. The Translation cache is keyed by sha1 of the exact text, so
   * decoding a stored description would orphan its cached translations: 1,047 of the 1,271 Tiki
   * descriptions that carry an entity have an `en` row, measured on the audit export. Each of those
   * would be paid for again on its first English view. So each row's translations are copied to the
   * decoded key, insert-only (skipDuplicates), with the value decoded too. Nothing is translated.
   */
  const sha1 = (t: string) => createHash('sha1').update(t).digest('hex')
  /** true when every pair was copied (or had nothing to copy). */
  async function carryTranslations(pairs: { from: string; to: string }[]): Promise<boolean> {
    for (const { from, to } of pairs) {
      try {
        const rows = await db.translation.findMany({ where: { hash: sha1(from) }, select: { target: true, value: true } })
        if (!rows.length) continue
        const res = await db.translation.createMany({
          data: rows.map((r) => ({ hash: sha1(to), target: r.target, value: decodeEntities(r.value) })),
          skipDuplicates: true,
        })
        carried += res.count
      } catch (e) {
        failures.push(`carryTranslations: ${(e as Error).message.slice(0, 60)}`)
        return false
      }
    }
    return true
  }
  const screen = new ImportScreen(`accesstrade-${CAMPAIGN}`, { db })
  const PAGE = 200
  for (let page = 1; seen < total; page++) {
    /**
     * ⛔ THE LIMIT MUST NEVER SHRINK — offsets are limit-relative, so a smaller last page RE-READS
     * the middle of the feed and the tail is never fetched. Measured: with total=9,728 and a
     * `Math.min(200, total - seen)` limit, page 49 asked for limit=128, i.e. offset (49-1)*128 =
     * 6,144 — rows 6,145-6,272 again — while rows 9,601-9,728 were never requested at all, and the
     * progress line still printed "9728/9728". Ask for a full page every time and trim here.
     */
    const { data: raw } = await feedPage(page, PAGE)
    if (!raw?.length) break
    const data = raw.slice(0, Math.max(0, total - seen))
    if (!data.length) break

    // Bounded concurrency: the merchant CDN and our storage both dislike 200 parallel round trips.
    for (let i = 0; i < data.length; i += CONCURRENCY) {
      await Promise.all(data.slice(i, i + CONCURRENCY).map(async (p) => {
        seen++
        // The DECODED name everywhere below: rules, brand/model, screening and the stored text all read the same words.
        const name = decodeEntities(p.name)
        if (MATCH && !MATCH.test(name)) return
        if (CATE && (p as { cate?: string }).cate !== CATE) return
        matched++
        const price = Number(p.status_discount) === 1 && Number(p.discount) > 0 ? Number(p.discount) : Number(p.price)
        // ⛔ A ZERO PRICE RENDERS AS "Free / Miễn phí" (src/components/marketplace/price.tsx).
        if (!Number.isFinite(price) || price <= 0) { skipped++; return }
        if (!p.image) { skipped++; return }
        const affiliateUrl = repairAffLink(p.aff_link, campaignId)
        if (!affiliateUrl) { skipped++; return }
        const slug = categoryFor(name)
        const categoryId = catId.get(slug)
        if (!categoryId) { skipped++; return }
        const externalId = String(p.sku || p.product_id || '').slice(0, 190)
        if (!externalId) { skipped++; return }
        // ⚠️ The dry run queries too, or it reports every row as "created" forever and can never
        // show that a refresh is an UPDATE — which is the thing worth previewing on a re-run.
        const existing = seller
          // ⚠️ `title`/`description` are read so a REFRESH can keep the text a human or a model
          // wrote (see the searchText build below), not just to decide create-vs-update.
          ? await db.listing.findFirst({ where: { sellerId: seller.id, externalId }, select: { id: true, status: true, images: true, title: true, titleVi: true, description: true, descriptionVi: true, categoryId: true, subcategorySlug: true, brandSlug: true, model: true } })
          : null
        // ⛔ A TOMBSTONE IS LEFT AS IT IS (src/lib/listing-removed.ts): a listing a moderator or admin REMOVED keeps its externalId, so this SKU lands on it — refreshing its text, price or photos would rewrite the record kept as evidence (Law 122/2025). Not refreshed, not recreated.
        if (existing?.status === 'removed') { skipped++; return }
        // ⛔ CONTENT SCREEN BEFORE ANY WRITE (src/lib/import-screen.ts): a banned word or an
        // advertising-banned product (Tiki's spirits, formula, feeding bottles, NexGard…) is never
        // created; if it is already LIVE it is not refreshed and finish() hides it (journaled). An
        // ambiguous one goes to the review file — and, if already live, is refreshed as normal rather
        // than frozen on a stale price. Runs in the dry run too (which hides nothing).
        // ⛔ Screened DECODED, the form that is stored: an entity-encoded banned word must not pass as "&#…;".
        if (!(await screen.check({ title: name, description: decodeEntities(p.desc ?? ''), category: slug, subcategory: subcategoryFor(slug, name), merchant: merchantName, externalId, url: p.url }, existing ? { id: existing.id, status: existing.status } : null))) {
          skipped++; return
        }
        // Stored text that still prints "&amp;": decoded in place, even in the create-only columns.
        const repairs = existing ? entityRepairs(existing) : {}
        if (!APPLY) { if (Object.keys(repairs).length) entityRows++; existing ? updated++ : created++; return }
        let images = existing?.images
        const hasImage = (() => { try { return JSON.parse(images || '[]').length > 0 } catch { return false } })()
        if (!hasImage) {
          const url = await hostImage(p.image, slug)
          if (url) { images = JSON.stringify([url]); imaged++ }
        }
        if (!images || images === '[]') { skipped++; return }

        const feedTitle = cutText(name, 180)
        // ⛔ The row's stored category wins over the title rules on a refresh — see refreshPlacement.
        const placed = refreshPlacement(
          existing ? { categorySlug: catSlug.get(existing.categoryId) ?? null, subcategorySlug: existing.subcategorySlug } : null,
          { categorySlug: slug, subcategorySlug: subcategoryFor(slug, name) },
        )
        // ⛔ BRAND AND MODEL ARE SET ON CREATE ONLY (2026-09-14). A refresh used to rewrite them from the title rules, which
        // undid every correction the Gemini pass or `backfill-brands --recheck` made — and "fill when missing" refilled a
        // brand those passes had deliberately cleared (an iPhone case is not Apple's). The refresh keeps the stored values;
        // the title rules name a brand/model only for a product seen for the first time (reviewers, three rounds).
        const effBrand = existing ? existing.brandSlug : brandFor(name)
        const effModel = existing ? existing.model : modelFor(name)
        const feedDesc = feedDescription(p.desc || p.name)
        // The row's current text, with any entity decoded: what the searchText blob folds below.
        const cur = existing && {
          title: repairs.title?.to ?? existing.title, titleVi: repairs.titleVi?.to ?? existing.titleVi,
          description: repairs.description?.to ?? existing.description, descriptionVi: repairs.descriptionVi?.to ?? existing.descriptionVi,
        }
        const fields = {
          title: feedTitle, description: feedDesc,
          // ⚠️ THE MERCHANT'S OWN WORDS ALWAYS LIVE IN THE *Vi COLUMNS. `title`/`description` are
          // the PRIMARY (English) slots that translate-imported-listings.ts fills; keeping the
          // source separately is what lets a refresh update the source without destroying the
          // translation, and what lets the translator re-run from a clean original.
          titleVi: feedTitle, descriptionVi: feedDesc,
          /**
           * ⛔ THE SYMBOL '₫', NOT THE ISO STRING 'VND'. Three separate features key on
           * `currency === '₫'` and silently treat anything else as a FOREIGN currency:
           *   · price.tsx skips the "≈ $" dual-currency line entirely (owner, 2026-08-25:
           *     "where equivalent prices in usd gone? for all products") and prints
           *     "VND18,290,000" instead of the đồng format "18.290.000 đ";
           *   · listings/[id]/page.tsx picks the OFFER currency from it;
           *   · api/track/view reports the value to Meta CAPI as USD — so 9,726 products were
           *     sending eighteen-million-DOLLAR view events into ad optimisation.
           * Only 47 pre-existing listings were right and 9,726 imported ones were wrong, which is
           * how a one-character mistake stayed invisible: every page still rendered a price.
           */
          price, priceUnit: '', currency: '₫', negotiable: false, condition: 'new',
          images, categoryId: catId.get(placed.categorySlug) ?? categoryId, location: MERCHANT_CITY, city: MERCHANT_CITY,
          // Brand/model: set on create only — see effBrand above.
          subcategorySlug: placed.subcategorySlug, brandSlug: effBrand, model: effModel,
          /**
           * ⛔ WITHOUT THIS EVERY IMPORTED PRODUCT IS INVISIBLE TO SEARCH. feed-query.ts matches
           * keywords against this folded blob, and it is built in core/listings.ts on the POST
           * path — which a direct Prisma write never runs, so the column keeps its @default("").
           * Measured on production: all 9,726 imports had an empty one, and a catalogue holding
           * 1,193 phone cases returned nothing for "iphone case".
           * ⚠️ Built from the FEED's Vietnamese here because that is all this script knows. After
           * translate-imported-listings.ts fills the English slots, run rebuild-search-text.ts —
           * it folds both languages in, which is what makes "ốp lưng" and "case" find one product.
           */
          /**
           * ⛔ FOLD THE ROW'S CURRENT TEXT, NOT ONLY THE FEED'S. `searchText` is in the refresh set,
           * so on every re-import this line decides what the whole catalogue is searchable by. Built
           * from feed values alone it collapses the blob to the merchant's VIETNAMESE title — which
           * silently destroys the bilingual index that exists today (measured: 400/400 sampled rows
           * currently contain every word of their English title) and any description a model wrote.
           * ⚠️ AND THE REPAIR PATH CANNOT SEE IT: scripts/rebuild-search-text.ts selects
           * `where: { searchText: '' }`, and a clobbered blob is wrong, not empty — so nothing in
           * the repo could detect or fix it. Preserving here is cheaper than detecting later.
           * ⚠️ Deliberately NOT solved by making searchText create-only: `titleVi` stays refreshable, so a
           * create-only blob would silently stop matching a renamed product. Brand and model are the row's
           * STORED values (title rules only for a new product), so the blob and columns agree. The CATEGORY token is the row's
           * effective placement (refreshPlacement), never the title rule's guess over a re-filed row.
           */
          // ⚠️ BOTH DESCRIPTION COLUMNS. Folding only the English one dropped the model's
          // VIETNAMESE prose out of the blob on every re-import — silently un-indexing the text
          // most buyers actually read, with nothing to re-select the row afterwards.
          searchText: buildSearchText([
            cur?.title ?? feedTitle, feedTitle,
            cur?.titleVi ?? feedTitle,
            cur?.description ?? feedDesc, feedDesc,
            cur?.descriptionVi ?? feedDesc,
            MERCHANT_CITY, placed.categorySlug, effBrand, effModel,
          ]),
          affiliateUrl, verified: true, status: 'active',
          /**
           * ⛔ WITHOUT THIS EVERY IMPORTED LISTING IS INVISIBLE UNTIL THE NIGHTLY CRON. `rankScore`
           * defaults to 0 in the schema and this importer never set it, so the 152 rows of the
           * first partner import all sat at 0.0000 — dead last in a browse feed ordered by
           * rankScore desc — while every other seller scored 0.48–0.58. Measured on production
           * 2026-09-07, an hour after the import. `recomputeRankScoreAllActive()` in the
           * daily-reminders cron repairs it, but "correct within 24 hours" is not correct for the
           * listings a merchant just handed us.
           *
           * ⚠️ CREATE-ONLY, like `verified` and `status` below. A nightly price refresh must not
           * reset the score — the cron owns re-decay, and `browseRankScore` at age 0 is only the
           * right value at the moment of creation. Same helper the post wizard uses
           * (core/listings.ts), so an imported listing and a human's listing start comparable.
           */
          // ⚠️ `seller?.` NOT `seller!.` — on a DRY RUN for a storefront that does not exist yet, the
          // create is skipped and `seller` is null, so the non-null assertion threw a TypeError and
          // killed the preview on its first row. `!` is a compile-time claim with no runtime effect;
          // a reviewer caught it before it shipped. 100 is the schema default a new seller gets.
          rankScore: browseRankScore({ sellerTrustScore: seller?.trustScore ?? 100, postedAt: new Date(), featured: false }),
        }
        /**
         * ⛔ `status` IS SET ONLY ON CREATE — A REFRESH MUST NOT RESURRECT A MODERATED LISTING.
         * An admin who deactivates one of these (complaint, wrong price, takedown) would otherwise
         * have it silently republished by the next nightly run, with no record that it happened.
         *
         * ⚠️ AND THIS IS AN UPSERT, NOT find-then-create. With CONCURRENCY parallel tasks, a feed
         * that repeats a SKU lets two of them both see `existing === null` and both insert, which
         * violates @@unique([sellerId, externalId]) and rejects the whole Promise.all — killing the
         * run thousands of products in. The compound key makes it one atomic statement.
         */
        /**
         * ⛔ `title`/`description` ARE CREATE-ONLY, AND THIS IS THE EXPENSIVE BUG THE REVIEW CAUGHT.
         * They hold the ENGLISH translation once translate-imported-listings.ts has run. Leaving
         * them in the refresh set meant the next nightly import wrote the merchant's Vietnamese
         * back over the English — while `titleVi` stayed set, so the translator's own idempotency
         * check skipped every one of those rows and could never repair them. Vietnamese in all four
         * slots, English readers seeing Vietnamese, and the translation spend silently lost.
         *
         * ⛔ `verified` AND `status` ARE CREATE-ONLY FOR THE SAME REASON as each other: both are
         * moderation state. An admin who un-verifies or deactivates one of these must not have the
         * next run quietly re-stamp it.
         *
         * A refresh therefore updates: price, images, affiliateUrl, a MISSING category or
         * subcategory (refreshPlacement), and the merchant's own Vietnamese text. Everything a human or a translator decided is left alone.
         */
        /**
         * ⛔ `descriptionVi` IS CREATE-ONLY TOO. It was refreshable, so a re-import overwrote it with
         * the feed's `desc` — which is the title repeated. The damage is invisible and permanent:
         * `description` is create-only so English readers keep the good prose, while `useLocalized`
         * serves `descriptionVi` verbatim to every Vietnamese reader (the dominant traffic), and the
         * describe script's resume predicate is "description still equals title" — which is now
         * false — so it would never re-select the row to repair it.
         */
        const { status, verified, title, description, descriptionVi, rankScore, ...refreshable } = fields
        /**
         * ⛔ THE ONE EXCEPTION TO CREATE-ONLY: an entity decode of the STORED value. It keeps every word
         * a translator or a model wrote and only stops "&amp;" printing, so the next refresh repairs the
         * 1,576 live rows without touching what the comment above protects.
         */
        /**
         * ⚠️ THE CACHE IS CARRIED FIRST, AND THE DECODE WAITS FOR IT. Once a stored column is decoded, the old
         * key is gone from the row, and no later run could find it to copy (review). So the copies go in
         * first (insert-only; harmless if the listing write then fails). If one fails, this run leaves the
         * stored text encoded, including titleVi, and the next run tries again.
         * titleVi is refreshed from the feed name anyway. Its old key is carried only when the stored value
         * becomes the decoded old text; a renamed product is a different text, and its translation
         * does not belong to it.
         */
        const carryOk = !Object.keys(repairs).length || await carryTranslations(
          Object.entries(repairs).filter(([k, r]) => k !== 'titleVi' || r!.to === feedTitle).map(([, r]) => r!))
        const decoded = carryOk ? {
          ...(repairs.title ? { title: repairs.title.to } : {}),
          ...(repairs.description ? { description: repairs.description.to } : {}),
          ...(repairs.descriptionVi ? { descriptionVi: repairs.descriptionVi.to } : {}),
        } : (repairs.titleVi ? { titleVi: repairs.titleVi.from } : {})
        /**
         * ⚠️ ONE ROW'S FAILURE MUST NOT KILL A 9,728-ROW RUN. This job talks to the database over
         * an SSH tunnel, and a dropped tunnel surfaces as Prisma `ConnectionClosed` — which,
         * unguarded inside Promise.all, rejected the whole batch and ended the import at 8,354 with
         * a stack trace and no summary. Retry once (the adapter reconnects), then count it as
         * skipped and keep going; the run is idempotent, so a later pass picks it up.
         */
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await db.listing.upsert({
              where: { sellerId_externalId: { sellerId: seller!.id, externalId } },
              update: { ...refreshable, ...decoded },
              create: { ...fields, sellerId: seller!.id, externalId },
            })
            existing ? updated++ : created++
            if (Object.keys(repairs).length && carryOk) entityRows++
            return
          } catch (e) {
            if (attempt === 1) { skipped++; failures.push((e as Error).message.slice(0, 80)); return }
            await new Promise((r) => setTimeout(r, 1500))
          }
        }
      }))
    }
    if (page % 2 === 0 || seen >= total) console.log(`  ${seen}/${total}${MATCH || CATE ? `  matched=${matched}` : ''}  created=${created} updated=${updated} images=${imaged} skipped=${skipped}`)
  }
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${created} created, ${updated} updated, ${imaged} images hosted, ${skipped} skipped`)
  console.log(`  HTML entities decoded in stored text: ${entityRows} rows${APPLY ? ` · ${carried} cached translations carried to the decoded text` : ' (would be)'}`)
  await screen.finish({ apply: APPLY })
  // ⚠️ Name the failures rather than leaving "skipped" to mean four different things.
  if (failures.length) {
    const kinds: Record<string, number> = {}
    for (const f of failures) kinds[f.split(':')[0]] = (kinds[f.split(':')[0]] || 0) + 1
    console.log(`  write failures: ${JSON.stringify(kinds)}`)
  }
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
