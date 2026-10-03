/**
 * Import the scraped partner-shop catalogues (scripts/partner-fetch.ts stages them) as listings.
 *
 *   npx tsx --env-file=.env scripts/import-partners.ts --file <staging.json>              # DRY RUN
 *   npx tsx --env-file=.env scripts/import-partners.ts --file <staging.json> --store tystore.vn
 *   npx tsx --env-file=.env scripts/import-partners.ts --file <staging.json> --apply
 *
 * ⛔ THIS SCRIPT DID NOT EXIST, AND THAT IS WHY THE 26 STORES WERE INVISIBLE. partner-fetch.ts ends
 * at `staged → …/staging-full.json  (nothing published; review before importing)`. 9,235 products
 * across 13 shops sat in that file while the site showed 10,220 listings, 9,726 of which are one
 * AccessTrade merchant (CellphoneS). The scrape was never the missing half; the write was.
 *
 * ⛔ IDEMPOTENT ON (sellerId, externalId), exactly like import-accesstrade.ts — re-running refreshes
 * prices and stock instead of multiplying a catalogue. Same compound unique the Partner API uses.
 *
 * ⛔ THIS SCRIPT CANNOT RETIRE A PRODUCT THAT VANISHES FROM THE FEED, AND THE DAILY JOB MUST.
 * It only ever visits rows present in the staging file, so a product the shop delists — or moves
 * into banghethanhly.vn's "Đã bán" category, which our own endpoint deliberately excludes — simply
 * stops appearing and its listing stays `active` for ever. Closing that needs a reconcile pass
 * (everything for this seller NOT seen in a COMPLETE run becomes `sold`), and it must be able to
 * tell a complete scrape from a partial or failed one, or one network blip retires a catalogue.
 *
 * ⚠️ THE CREATE-ONLY SET IS THE SAME ONE, AND FOR THE SAME REASONS (each documented at the field):
 * `title`/`description` hold the ENGLISH translation, `descriptionVi` the good Vietnamese prose,
 * `status`/`verified` are moderation state, and `rankScore` is only right at age 0. A refresh moves
 * price, stock, images, taxonomy and the merchant's own title.
 *
 * ⛔ SECOND-HAND FOCUS (owner, 2026-10-03) — three rules, each closing a way this script could undo it:
 *   · a `retired` shop (src/lib/partner-stores.ts) is refused outright: an import CREATES active rows;
 *   · a `refreshOnly` shop (new AND used stock: Bạch Long, Điện Thoại Giá Kho) gets NO new listing — its
 *     existing live rows refresh; the dry run counts the skipped products and how many of them say used;
 *   · a refresh writes LIVE rows only (active|sold), in a statement that re-checks it, and `condition`
 *     is create-only. The refresh used to upsert every matched row: on a hidden row that bumped
 *     `updatedAt` (and the hide's rollback refuses a row touched after it), and on the 1,014 rows the
 *     owner relabelled used on 2026-10-03 it wrote the store's `condition: null` back over 'used'.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { db } from '../src/lib/db'
import { makeImageHost } from '../src/lib/host-product-image'
import { brandSlugify, normalizeBrand } from '../src/lib/brand-normalize'
import { categoryFor, subcategoryFor, brandFor, FEED_BRANDS, refreshPlacement } from '../src/lib/feed-taxonomy'
import { modelFor } from '../src/lib/feed-model'
import { buildSearchText } from '../src/lib/fold'
import { browseRankScore } from '../src/lib/ranking-formula'
import { PARTNER_STORES } from '../src/lib/partner-stores'
import { isOverlayImageUrl } from '../src/lib/image-mark-url'
// ⛔ Every importer screens a row before it writes it — banned words + advertising-banned goods.
import { ImportScreen } from '../src/lib/import-screen'
import { isUsedTitle } from '../src/lib/used-signal'
import { blockedCreate, isLiveForRefresh } from '../src/lib/partner-import-rules'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
/**
 * `--overlay` — ALSO re-fetch the photos of existing listings that still carry a burned mark. New
 * photos are always hosted CLEAN under `affiliate/m/` for the app-drawn eno.vn mark (owner, 2026-09-13:
 * one size and one corner on every image; see image-mark.tsx) — the flag only widens WHICH listings get
 * photos, so a routine run can never reintroduce a burned mark (a reviewer's catch).
 */
const OVERLAY = process.argv.includes('--overlay')
const FILE = arg('file')
const ONLY = arg('store')
const LIMIT = Number(arg('limit') ?? 0)
const CONCURRENCY = Number(arg('concurrency') ?? 6)
// ⚠️ `--concurrency 0` made `i += CONCURRENCY` an infinite loop, and a negative --limit/--images
// silently took on Array.slice's from-the-end semantics instead of being refused.
if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1) { console.error('--concurrency must be a positive integer'); process.exit(1) }
/** How many photos a listing gets. The owner asked for at least 5; the scraper caps at 5. */
const MAX_IMAGES = Number(arg('images') ?? 5)
if (!Number.isInteger(MAX_IMAGES) || MAX_IMAGES < 1) { console.error('--images must be a positive integer'); process.exit(1) }
if (!Number.isInteger(LIMIT) || LIMIT < 0) { console.error('--limit must be a non-negative integer'); process.exit(1) }
if (!FILE) { console.error('--file <staging.json> required'); process.exit(1) }

/** Per-shop "contact for price" placeholder ceilings (inclusive), measured — see importRow. */
const PLACEHOLDER_PRICE_MAX: Record<string, number> = { 'dienthoaigiakho.vn': 1000 }

const BUCKET = 'listings'
const EDGE = 1200
const WEBP_QUALITY = 80

const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
const secret = process.env.SUPABASE_SECRET_KEY
if (APPLY && (!storageUrl || !secret)) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required'); process.exit(1) }
if (APPLY && /supabase\.co$/.test(new URL(storageUrl!).hostname)) { console.error(`Refusing to upload to ${storageUrl} — retired project`); process.exit(1) }
const storage = APPLY ? createClient(storageUrl!, secret!, { auth: { persistSession: false } }).storage.from(BUCKET) : null
const hostImage = makeImageHost({ storage, storageUrl: storageUrl!, bucket: BUCKET, edge: EDGE, quality: WEBP_QUALITY, mark: 'overlay' })

type Staged = { domain: string; externalId: string; name: string; price: string | number
                url: string; images: string[] | string; desc?: string; inStock?: boolean | string }
type Store = { domain: string; name: string; city: string; condition: 'used' | 'new' | null; retired?: string; refreshOnly?: string }

/** ⚠️ Python's json.dump wrote `True`/`False` for booleans in some rows — accept both spellings. */
const truthy = (v: unknown) => v === true || v === 'True' || v === 'true' || v === 1 || v === '1'

function imagesOf(r: Staged): string[] {
  const raw = r.images
  if (Array.isArray(raw)) return raw.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u))
  // `\x27` is the apostrophe: spelled as an escape so no bare quote sits inside a regex literal — the
  // source scanners in src/lib/compliance/public-state-writes.test.ts read a bare one as a string start.
  if (typeof raw === 'string') { try { const p = JSON.parse(raw.replace(/\x27/g, '"')); return Array.isArray(p) ? p.filter((u: unknown) => typeof u === 'string') : [] } catch { return [] } }
  return []
}

async function main() {
  const stores: Store[] = PARTNER_STORES
  const storeByDomain = new Map(stores.map((s) => [s.domain, s]))
  const all: Staged[] = JSON.parse(readFileSync(FILE!, 'utf8'))
  const rows = (ONLY ? all.filter((r) => r.domain === ONLY) : all).slice(0, LIMIT || undefined)
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${rows.length} staged product(s)${ONLY ? ` from ${ONLY}` : ''}, up to ${MAX_IMAGES} image(s) each\n`)

  const cats = await db.category.findMany({ select: { id: true, slug: true } })
  const catId = new Map(cats.map((c) => [c.slug, c.id]))
  const catSlug = new Map(cats.map((c) => [c.id, c.slug]))

  if (APPLY) {
    const have = new Set((await db.brand.findMany({ select: { slug: true } })).map((b) => b.slug))
    const missing = FEED_BRANDS.map(brandSlugify).filter((b) => !have.has(b))
    for (const slug of missing) {
      const name = slug.charAt(0).toUpperCase() + slug.slice(1)
      await db.brand.create({ data: { slug, name, normalized: normalizeBrand(name) } }).catch(() => {})
    }
    if (missing.length) console.log(`brands created: ${missing.join(', ')}\n`)
  }

  /**
   * ⛔ ONE STOREFRONT PER SHOP, AND A SHOP WITH AN OWNER IS REFUSED — the same rule
   * import-accesstrade.ts learned from VinWonders' seeder. A Seller carrying an `ownerId` belongs
   * to a real account; hanging a scraped catalogue off it hands someone a shop they never posted.
   * ⛔ officialPartner IS FALSE AGAIN SINCE 2026-10-01 — OWNER DECISION, REVERSING 2026-09-17. The
   * badge is kept ONLY for companies with a signed agreement (VietKite, GMBR, Luật Hoàng Phi); every
   * fetched shop shows the neutral Linked shop chip instead (src/lib/linked-seller.ts). History: on
   * 2026-09-17 the owner asked to give all fetching stores a partner badge and this created them with
   * it; before that this comment said the badge STAYS FALSE because these 13 shops had not been
   * contacted, so the negotiated-partner badge would be a claim the business had not made — which is
   * the rule again. Granting it is per-seller work: scripts/set-official-partner.mjs (handle or id).
   * The verified flag stays FALSE — that one is an identity check on the business, which nobody has
   * performed.
   */
  const sellerFor = new Map<string, { id: string; trustScore: number }>()
  /**
   * ⚠️ TWO DIFFERENT QUESTIONS, AND CONFLATING THEM BROKE THE PREVIEW. "Is this store allowed?"
   * (known to partner-stores.ts, not owned by a real account) is answered here for both modes;
   * "does a Seller row exist?" is only ever true on a dry run for a shop imported before. Gating on
   * the second made a first-ever preview report every product as refused.
   */
  const allowedDomains = new Set<string>()
  for (const domain of new Set(rows.map((r) => r.domain))) {
    const store = storeByDomain.get(domain)
    if (!store) { console.error(`  ⚠️ ${domain}: not in partner-stores.ts — skipping its products`); continue }
    // ⛔ A RETIRED SHOP IS NOT IMPORTED — in the dry run too (see the header).
    if (store.retired) { console.error(`  ⛔ ${domain}: retired — ${store.retired}. Skipping its products.`); continue }
    const existing = await db.seller.findFirst({ where: { name: store.name }, select: { id: true, ownerId: true, trustScore: true } })
    if (existing?.ownerId) { console.error(`  ⛔ "${store.name}" is owned by a real account — skipping`); continue }
    allowedDomains.add(domain)
    if (existing) { sellerFor.set(domain, { id: existing.id, trustScore: existing.trustScore }); continue }
    console.log(`  storefront "${store.name}" — ${APPLY ? 'creating' : 'would create'}`)
    if (!APPLY) continue
    const made = await db.seller.create({
      data: { name: store.name, bio: `Products are bought and paid for on the ${store.name} website (${domain}).`,
              location: store.city, officialPartner: false, verified: false },
      select: { id: true, trustScore: true },
    })
    sellerFor.set(domain, made)
  }
  console.log()

  let seen = 0, created = 0, updated = 0, skipped = 0, imaged = 0, rehostKept = 0
  const failures: string[] = []
  const dropped: Record<string, number> = {}
  const drop = (why: string) => { dropped[why] = (dropped[why] || 0) + 1; skipped++ }
  const screen = new ImportScreen('partners', { db })

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(rows.slice(i, i + CONCURRENCY).map(async (r) => {
      /**
       * ⛔ THE WHOLE ROW IS GUARDED, NOT JUST THE UPSERT. The retry below wrapped the write alone,
       * while the `existing` lookup and every `hostImage` call sat outside it — so a dropped SSH
       * tunnel (`ConnectionClosed`) during either rejected `Promise.all`, exited the process, and
       * orphaned the images its siblings had just uploaded. Three reviewers found it. The run is
       * idempotent, so counting a row as skipped and carrying on is always the better failure.
       */
      try { await importRow(r) } catch (e) { skipped++; failures.push((e as Error).message.slice(0, 80)) }
    }))
    if (seen % 200 < CONCURRENCY || seen >= rows.length) {
      console.log(`  ${seen}/${rows.length}  created=${created} updated=${updated} images=${imaged} skipped=${skipped}`)
    }
  }

  async function importRow(r: Staged) {
      seen++
      const seller = sellerFor.get(r.domain)
      // ⚠️ THE DRY RUN REFUSES WHAT APPLY REFUSES. This was `if (!seller && APPLY)`, so a preview
      // counted products from an unknown store — or one owned by a real account — as creations, and
      // overstated the publishable catalogue in exactly the cases an operator reviews it for.
      if (!allowedDomains.has(r.domain)) { drop('store not allowed'); return }
      if (!seller && APPLY) { drop('no storefront'); return }
      const price = Number(r.price)
      /**
       * ⛔ A PLACEHOLDER PRICE IS NOT A PRICE. Measured 2026-09-13 (price/stock audit of every partner
       * shop): 24hstore publishes "Liên hệ" (contact us) products with a machine price of 100đ in its
       * JSON-LD — 205 live listings read "100 đ" — and dienthoaigiakho does the same at 1,000đ on
       * phone cases and screen protectors. hshop sells a genuine 500đ part and 1,000-9,000đ components,
       * so everywhere the floor is BELOW 500đ, and a shop gets a higher ceiling only where measured.
       * A placeholder row is not purchasable at a listed price: an existing listing goes `sold` — the
       * stock rule below revives sold↔active, so the first refresh with a real price brings it back —
       * and a new one is not created. (`sold` on an affiliate listing is not a sale: trust.ts excludes
       * affiliate listings from transaction evidence for exactly this reason.)
       */
      // ⛔ A ZERO / MISSING PRICE IS THE SAME CASE (it renders as "Free / Miễn phí", price.tsx), so it
      // retires an existing listing too rather than leaving yesterday's price live.
      const domain = (() => {
        const raw = String(r.domain || '') || (() => { try { return new URL(r.url).hostname } catch { return '' } })()
        return raw.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
      })()
      if (!Number.isFinite(price) || price < 500 || price <= (PLACEHOLDER_PRICE_MAX[domain] ?? 0)) {
        const ext = String(r.externalId || r.url || '').slice(0, 190)
        // Same key the upsert below writes (externalId || url, 190 chars); never an empty key.
        if (APPLY && seller && ext) {
          await db.listing.updateMany({ where: { sellerId: seller.id, externalId: ext, status: 'active', affiliateUrl: { not: null } }, data: { status: 'sold' } })
        }
        drop(Number.isFinite(price) && price > 0 ? 'placeholder price' : 'no price'); return
      }
      const srcImages = imagesOf(r).slice(0, MAX_IMAGES)
      if (!srcImages.length) { drop('no image'); return }
      const title = String(r.name || '').trim()
      if (title.length < 3) { drop('no title'); return }
      const externalId = String(r.externalId || r.url || '').slice(0, 190)
      if (!externalId) { drop('no externalId'); return }
      /**
       * ⛔ THE OUTBOUND LINK MUST BELONG TO THE SHOP THE ROW IS FILED UNDER. An allowed `domain`
       * said nothing about `url`, so a staged row naming a permitted merchant could publish any
       * destination at all — a redirect off a marketplace listing is exactly the thing worth
       * refusing by construction rather than by trusting the scraper. Measured on the current
       * staging file: 0 of 9,235 rows mismatch, so this refuses nothing today and is a guard
       * against a future adapter, a hand-edited file, or a page that redirected mid-scrape.
       */
      let host = ''
      try { host = new URL(r.url).hostname.replace(/^www\./, '') } catch { drop('bad url'); return }
      if (host !== r.domain.replace(/^www\./, '')) { drop('url is not the shop\'s own domain'); return }
      const slug = categoryFor(title)
      const categoryId = catId.get(slug)
      if (!categoryId) { drop(`unknown category ${slug}`); return }

      const existing = seller
        ? await db.listing.findFirst({ where: { sellerId: seller.id, externalId },
            select: { id: true, images: true, status: true, title: true, titleVi: true, description: true, descriptionVi: true, categoryId: true, subcategorySlug: true, brandSlug: true, model: true } })
        : null
      // ⛔ A TOMBSTONE IS LEFT AS IT IS (src/lib/listing-removed.ts): a listing a moderator or admin REMOVED keeps its externalId, so this SKU lands on it — refreshing its text, price or photos would rewrite the record kept as evidence (Law 122/2025). Not refreshed, not recreated.
      if (existing?.status === 'removed') { drop('removed listing (tombstone)'); return }
      // ⛔ A ROW THAT IS NOT LIVE IS LEFT BYTE-FOR-BYTE (hidden by a journaled hide or a moderator, stale,
      // expired). The write below re-checks this in its own WHERE; this early exit is what keeps the dry
      // run's counts honest and spares the image work.
      if (existing && !isLiveForRefresh(existing.status)) { drop(`not live (${existing.status}) — left untouched`); return }
      // ⛔ A MIXED SHOP CREATES NOTHING (second-hand focus; StoreConfig.refreshOnly). An existing row refreshes as before.
      if (blockedCreate(storeByDomain.get(r.domain)!, existing)) {
        // Counted by what the shop's words say, for the owner's D4 call — never acted on here.
        drop(isUsedTitle(title, null, r.url) ? 'refresh-only shop: new product NOT created (its title/URL says used)' : 'refresh-only shop: new product NOT created')
        return
      }
      // ⛔ CONTENT SCREEN BEFORE ANY WRITE (src/lib/import-screen.ts): a banned word or an
      // advertising-banned product is never created; if it is already LIVE it is not refreshed and
      // finish() hides it (journaled). An ambiguous one goes to the review file — and, if already
      // live, is refreshed as normal rather than frozen on a stale price and stock. Runs in the dry
      // run too (which hides nothing), so the preview shows what would be refused.
      if (!(await screen.check({ title, description: r.desc, category: slug, subcategory: subcategoryFor(slug, title), merchant: r.domain, externalId, url: r.url }, existing ? { id: existing.id, status: existing.status } : null))) {
        drop('content screen'); return
      }
      if (!APPLY) { existing ? updated++ : created++; return }

      /**
       * ⚠️ IMAGES ARE FETCHED ONCE, like the AccessTrade importer — a listing that already has one
       * is left alone. At five photos across 9,235 products this is ~46k fetch→resize→upload round
       * trips; repeating them on every nightly price refresh would grow storage without bound.
       */
      let images = existing?.images
      const current: string[] = (() => { try { const v = JSON.parse(images || '[]'); return Array.isArray(v) ? v.filter((u): u is string => typeof u === 'string') : [] } catch { return [] } })()
      const hasImage = current.length > 0
      const burned = hasImage && !current.every(isOverlayImageUrl)
      if (!hasImage) {
        const hosted = (await Promise.all(srcImages.map((u) => hostImage(u, slug)))).filter((u): u is string => !!u)
        if (hosted.length) { images = JSON.stringify(hosted); imaged += hosted.length }
      } else if (OVERLAY && burned && srcImages.length < current.length) {
        rehostKept++ // the shop now shows fewer photos than we hold — keep ours, never shrink
      } else if (OVERLAY && burned) {
        /**
         * ⛔ NEVER SHRINK A GALLERY, AND ALL-OR-NOTHING. Entered only when the shop returns at least as
         * many photos as the listing holds (checked BEFORE uploading), and written only when every one
         * hosted. A shorter gallery or a partial upload keeps the current photos — a stale burned mark
         * is a blemish, a lost photo is data loss. A partial upload's survivors are orphans for the
         * separate cleanup.
         */
        const hosted = (await Promise.all(srcImages.map((u) => hostImage(u, slug)))).filter((u): u is string => !!u)
        if (hosted.length === srcImages.length) {
          images = JSON.stringify(hosted); imaged += hosted.length
        } else rehostKept++
      }
      if (!images || images === '[]') { drop('image host failed'); return }

      const feedTitle = title.slice(0, 180)
      // ⛔ The row's stored category wins over the title rules on a refresh — see refreshPlacement.
      const placed = refreshPlacement(
        existing ? { categorySlug: catSlug.get(existing.categoryId) ?? null, subcategorySlug: existing.subcategorySlug } : null,
        { categorySlug: slug, subcategorySlug: subcategoryFor(slug, feedTitle) },
      )
      // ⛔ BRAND AND MODEL ARE SET ON CREATE ONLY (2026-09-14). A refresh used to rewrite them from the title rules, which
      // undid every correction the Gemini pass or `backfill-brands --recheck` made — and "fill when missing" refilled a
      // brand those passes had deliberately cleared (an iPhone case is not Apple's). The refresh keeps the stored values;
      // the title rules name a brand/model only for a product seen for the first time (reviewers, three rounds).
      const effBrand = existing ? existing.brandSlug : brandFor(feedTitle)
      const effModel = existing ? existing.model : modelFor(feedTitle)
      const feedDesc = String(r.desc || title).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1800)
      const store = storeByDomain.get(r.domain)!
      const fields = {
        title: feedTitle, description: feedDesc,
        // The merchant's own words live in the *Vi columns; translate-imported-listings.ts fills
        // the English slots later, and a refresh must never write Vietnamese back over them.
        titleVi: feedTitle, descriptionVi: feedDesc,
        // ⛔ THE SYMBOL '₫', NOT 'VND' — three features treat anything else as a FOREIGN currency
        // (dual-currency line, the PDP offer, and the value reported to Meta CAPI). See the long
        // note in import-accesstrade.ts; 9,726 rows once shipped eighteen-million-dollar events.
        price, priceUnit: '', currency: '₫', negotiable: false,
        /**
         * ⛔ PER STORE, FROM THE MEASURED SCRAPE NOTE — NOT A BLANKET 'used'. This said `'used'` for
         * every product of every shop, and four reviewers caught that the comment claimed a
         * distinction the code never read. It is a claim about the GOODS on a licensed marketplace:
         * hshop.vn is an Arduino/components retailer whose own note records "CARRIES NO USED STOCK
         * AT ALL" (1,086 products), and laptopgiare.vn + vnlaptop.vn (214 more) carry no used signal
         * at any of their endpoints. ~1,300 sealed items would have been advertised second-hand.
         *
         * ⚠️ `null` IS A REAL ANSWER AND IS USED FOR THE TWO SHOPS WITH NO SIGNAL. feed-query.ts
         * builds the "used" chip as `condition NOT NULL AND NOT newish`, so a null row appears under
         * neither chip — it declines to make a claim instead of guessing one. Asserting `'new'`
         * there because nothing said "cũ" would be the same error in the other direction.
         */
        // ⛔ CREATE-ONLY since 2026-10-03 (dropped from `refreshable` below).
        condition: store.condition,
        images, categoryId: catId.get(placed.categorySlug) ?? categoryId, location: store.city, city: store.city,
        // Brand/model: set on create only — see effBrand above.
        subcategorySlug: placed.subcategorySlug, brandSlug: effBrand, model: effModel,
        // ⛔ WITHOUT THIS THE PRODUCT IS INVISIBLE TO SEARCH — feed-query.ts matches the folded
        // blob, and a direct Prisma write never runs the POST path that builds it. Preserve any
        // text a human or the translator wrote rather than collapsing it to the merchant's title.
        searchText: buildSearchText([
          existing?.title ?? feedTitle, feedTitle,
          existing?.titleVi ?? feedTitle,
          existing?.description ?? feedDesc, feedDesc,
          existing?.descriptionVi ?? feedDesc,
          store.city, placed.categorySlug, effBrand, effModel,
        ]),
        /**
         * ⚠️ THE MERCHANT'S PRODUCT PAGE, IN THE FIELD THE CARD ALREADY USES FOR "buy on the
         * merchant's site". It is NOT an affiliate link and earns nothing — these shops have no
         * programme — but the column is what serializeListingCard projects to the outbound-link
         * boolean, so putting the honest URL here is what makes the listing reachable at all. A
         * separate column for "same thing, no commission" would duplicate every consumer of it.
         */
        affiliateUrl: r.url,
        /**
         * ⛔ OUT OF STOCK IS `sold`, NOT `hidden`, AND THAT IS WHAT MAKES A RESTOCK RECOVERABLE.
         * This wrote `hidden` and then omitted `status` from the refresh, so a product that sold on
         * Monday stayed invisible after Tuesday's restock — the catalogue could only ever shrink.
         * All four reviewers found it, and each noted the real obstacle: with one `hidden` value the
         * script cannot tell its own stock-hide from an admin's moderation hide, so un-hiding would
         * resurrect moderated listings.
         *
         * `sold` is a state the product already has (it renders a dedicated 200 + noindex page
         * rather than a 404 — see the sold-page feature), it is not a value moderation uses, and it
         * is the truth about the row. So the two are distinguishable and the transition is safe in
         * BOTH directions: active↔sold is stock, hidden is a human's decision and is never touched.
         */
        /**
         * ⚠️ `Listing.verified` IS NOT `Seller.verified`, AND REVIEWERS READ IT AS A MODERATION
         * BYPASS IN EVERY ROUND — so it is written down here. On a Listing it means "passed the
         * publish gate and may appear publicly": feed-query.ts pushes `{ verified: true }` into
         * EVERY public query unconditionally, so `false` does not mean "pending review", it means
         * the row is invisible to the entire site and to search. On a Seller it means "this
         * business's identity has been checked", which these thirteen shops have NOT been — hence
         * `verified: false` there — deliberately, and unchanged by either badge decision (granted
         * 2026-09-17, withdrawn 2026-10-01); `officialPartner` is a separate, per-seller claim.
         * import-accesstrade.ts makes exactly the same pairing for the 9,726 CellphoneS rows.
         */
        verified: true, status: truthy(r.inStock ?? true) ? 'active' : 'sold',
        // ⛔ create-only: rankScore defaults to 0, and 0 is dead last in a feed ordered by it — the
        // first partner import's 152 rows sat invisible for a day because of exactly this.
        rankScore: browseRankScore({ sellerTrustScore: seller?.trustScore ?? 100, postedAt: new Date(), featured: false }),
      }
      // ⛔ `condition` IS CREATE-ONLY (2026-10-03): it is a claim about the goods, and the stored value may be
      // a human's correction — 1,014 rows were relabelled 'used' that day, over the store's `null`.
      const { status, verified, title: _t, description: _d, descriptionVi: _dv, rankScore: _r, condition: _c, ...refreshable } = fields
      /**
       * ⚠️ STOCK MOVES IN BOTH DIRECTIONS, AND ONLY BETWEEN active AND sold. A row a human set to
       * `hidden` (or `draft`, or a `removed` tombstone) is left exactly as it is — that is the
       * moderation state this refresh must never overwrite, and it is why the stock state needed its
       * own value rather than sharing `hidden`.
       * ⛔ AND IT IS NOT PART OF THE UPSERT (2026-10-01). It rode the upsert's `update` branch, gated on
       * the `existing.status` read above — a read that can be stale by the time the upsert lands (a
       * moderator, or scripts/hide-ad-banned.ts, hiding the row in between would be overwritten with
       * `active`). The status now moves inside the refresh's one conditional statement
       * (`refreshLive` below), whose WHERE re-checks active|sold atomically.
       */
      const inStock = truthy(r.inStock ?? true)
      const update = refreshable

      // ⚠️ ONE ROW'S FAILURE MUST NOT KILL A 9,235-ROW RUN — this talks to the database over an SSH
      // tunnel, and a dropped tunnel surfaces as Prisma `ConnectionClosed`. Retry once, then skip.
      /**
       * ⛔ THE REFRESH OF AN EXISTING ROW IS ONE CONDITIONAL STATEMENT: the refreshed fields AND the stock
       * move (active ↔ sold) land together, in a WHERE that re-checks a live status. The `existing.status`
       * read above can be stale by the time it lands (a moderator, hide-ad-banned.ts or the 2026-10-03
       * retirement hiding the row in between); a row hidden since is not written — not its price, and not
       * its `updatedAt`, which its hide's rollback depends on. ONE statement, not a write then a stock move
       * (commit-gate review): a failure between two writes left fresh prices on stale availability.
       * Shared by the existing-row path and a create that lost a race to a sibling task.
       */
      const refreshLive = async (): Promise<boolean> => {
        const { count } = await db.listing.updateMany({
          where: { sellerId: seller!.id, externalId, status: { in: ['active', 'sold'] } },
          data: { ...update, status: inStock ? 'active' : 'sold' },
        })
        return count > 0
      }

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (existing) {
            if (!(await refreshLive())) { drop('not live at write time — left untouched'); return }
          } else {
            /**
             * ⛔ A PLAIN CREATE, AND A LOST RACE FALLS BACK TO THE SAME CONDITIONAL REFRESH (commit-gate
             * review). This was an upsert, whose `update` branch is unconditional: a SKU the feed repeats
             * lets a sibling task insert first, and a row hidden in the moments between would then have
             * been refreshed — `updatedAt` bumped, its rollback lost.
             */
            try {
              await db.listing.create({ data: { ...fields, sellerId: seller!.id, externalId } })
              created++
              return
            } catch (e) {
              // P2002 here can only be Listing_sellerId_externalId_key — Listing's one unique index besides its cuid id.
              if ((e as { code?: string }).code !== 'P2002') throw e
              if (!(await refreshLive())) { drop('not live at write time — left untouched'); return }
            }
          }
          updated++
          return
        } catch (e) {
          if (attempt === 1) { skipped++; failures.push((e as Error).message.slice(0, 80)); return }
          await new Promise((res) => setTimeout(res, 1500))
        }
      }
  }

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${created} created, ${updated} updated, ${imaged} images hosted, ${skipped} skipped${OVERLAY ? `, ${rehostKept} kept their burned photos (shorter or partial re-fetch)` : ''}`)
  if (Object.keys(dropped).length) console.log(`  dropped: ${JSON.stringify(dropped)}`)
  await screen.finish({ apply: APPLY })
  if (failures.length) {
    const kinds: Record<string, number> = {}
    for (const f of failures) kinds[f.split(':')[0]] = (kinds[f.split(':')[0]] || 0) + 1
    console.log(`  write failures: ${JSON.stringify(kinds)}`)
  }
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
