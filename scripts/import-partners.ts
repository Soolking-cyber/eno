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
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { db } from '../src/lib/db'
import { makeImageHost } from '../src/lib/host-product-image'
import { brandSlugify, normalizeBrand } from '../src/lib/brand-normalize'
import { categoryFor, subcategoryFor, brandFor, FEED_BRANDS } from '../src/lib/feed-taxonomy'
import { modelFor } from '../src/lib/feed-model'
import { buildSearchText } from '../src/lib/fold'
import { browseRankScore } from '../src/lib/ranking-formula'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
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

const BUCKET = 'listings'
const EDGE = 1200
const WEBP_QUALITY = 80

const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
const secret = process.env.SUPABASE_SECRET_KEY
if (APPLY && (!storageUrl || !secret)) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required'); process.exit(1) }
if (APPLY && /supabase\.co$/.test(new URL(storageUrl!).hostname)) { console.error(`Refusing to upload to ${storageUrl} — retired project`); process.exit(1) }
const storage = APPLY ? createClient(storageUrl!, secret!, { auth: { persistSession: false } }).storage.from(BUCKET) : null
const hostImage = makeImageHost({ storage, storageUrl: storageUrl!, bucket: BUCKET, edge: EDGE, quality: WEBP_QUALITY })

type Staged = { domain: string; externalId: string; name: string; price: string | number
                url: string; images: string[] | string; desc?: string; inStock?: boolean | string }
type Store = { domain: string; name: string; city: string; condition: 'used' | 'new' | null }

/** ⚠️ Python's json.dump wrote `True`/`False` for booleans in some rows — accept both spellings. */
const truthy = (v: unknown) => v === true || v === 'True' || v === 'true' || v === 1 || v === '1'

function imagesOf(r: Staged): string[] {
  const raw = r.images
  if (Array.isArray(raw)) return raw.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u))
  if (typeof raw === 'string') { try { const p = JSON.parse(raw.replace(/'/g, '"')); return Array.isArray(p) ? p.filter((u: unknown) => typeof u === 'string') : [] } catch { return [] } }
  return []
}

async function main() {
  const stores: Store[] = JSON.parse(readFileSync('scripts/partner-stores.json', 'utf8'))
  const storeByDomain = new Map(stores.map((s) => [s.domain, s]))
  const all: Staged[] = JSON.parse(readFileSync(FILE!, 'utf8'))
  const rows = (ONLY ? all.filter((r) => r.domain === ONLY) : all).slice(0, LIMIT || undefined)
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${rows.length} staged product(s)${ONLY ? ` from ${ONLY}` : ''}, up to ${MAX_IMAGES} image(s) each\n`)

  const cats = await db.category.findMany({ select: { id: true, slug: true } })
  const catId = new Map(cats.map((c) => [c.slug, c.id]))

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
   * ⚠️ officialPartner STAYS FALSE. These 13 shops have not been contacted yet, so the negotiated-
   * partner badge would be a claim the business has not made.
   */
  const sellerFor = new Map<string, { id: string; trustScore: number }>()
  /**
   * ⚠️ TWO DIFFERENT QUESTIONS, AND CONFLATING THEM BROKE THE PREVIEW. "Is this store allowed?"
   * (known to partner-stores.json, not owned by a real account) is answered here for both modes;
   * "does a Seller row exist?" is only ever true on a dry run for a shop imported before. Gating on
   * the second made a first-ever preview report every product as refused.
   */
  const allowedDomains = new Set<string>()
  for (const domain of new Set(rows.map((r) => r.domain))) {
    const store = storeByDomain.get(domain)
    if (!store) { console.error(`  ⚠️ ${domain}: not in partner-stores.json — skipping its products`); continue }
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

  let seen = 0, created = 0, updated = 0, skipped = 0, imaged = 0
  const failures: string[] = []
  const dropped: Record<string, number> = {}
  const drop = (why: string) => { dropped[why] = (dropped[why] || 0) + 1; skipped++ }

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
      // ⛔ A ZERO PRICE RENDERS AS "Free / Miễn phí" (src/components/marketplace/price.tsx).
      if (!Number.isFinite(price) || price <= 0) { drop('no price'); return }
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
            select: { id: true, images: true, status: true, title: true, titleVi: true, description: true, descriptionVi: true } })
        : null
      if (!APPLY) { existing ? updated++ : created++; return }

      /**
       * ⚠️ IMAGES ARE FETCHED ONCE, like the AccessTrade importer — a listing that already has one
       * is left alone. At five photos across 9,235 products this is ~46k fetch→resize→upload round
       * trips; repeating them on every nightly price refresh would grow storage without bound.
       */
      let images = existing?.images
      const hasImage = (() => { try { return JSON.parse(images || '[]').length > 0 } catch { return false } })()
      if (!hasImage) {
        const hosted = (await Promise.all(srcImages.map((u) => hostImage(u, slug)))).filter((u): u is string => !!u)
        if (hosted.length) { images = JSON.stringify(hosted); imaged += hosted.length }
      }
      if (!images || images === '[]') { drop('image host failed'); return }

      const feedTitle = title.slice(0, 180)
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
        condition: store.condition,
        images, categoryId, location: store.city, city: store.city,
        subcategorySlug: subcategoryFor(slug, feedTitle), brandSlug: brandFor(feedTitle), model: modelFor(feedTitle),
        // ⛔ WITHOUT THIS THE PRODUCT IS INVISIBLE TO SEARCH — feed-query.ts matches the folded
        // blob, and a direct Prisma write never runs the POST path that builds it. Preserve any
        // text a human or the translator wrote rather than collapsing it to the merchant's title.
        searchText: buildSearchText([
          existing?.title ?? feedTitle, feedTitle,
          existing?.titleVi ?? feedTitle,
          existing?.description ?? feedDesc, feedDesc,
          existing?.descriptionVi ?? feedDesc,
          store.city, slug, brandFor(feedTitle), modelFor(feedTitle),
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
         * `verified: false` there, and `officialPartner: false`, deliberately and in the same run.
         * import-accesstrade.ts makes exactly the same pairing for the 9,726 CellphoneS rows.
         */
        verified: true, status: truthy(r.inStock ?? true) ? 'active' : 'sold',
        // ⛔ create-only: rankScore defaults to 0, and 0 is dead last in a feed ordered by it — the
        // first partner import's 152 rows sat invisible for a day because of exactly this.
        rankScore: browseRankScore({ sellerTrustScore: seller?.trustScore ?? 100, postedAt: new Date(), featured: false }),
      }
      const { status, verified, title: _t, description: _d, descriptionVi: _dv, rankScore: _r, ...refreshable } = fields
      /**
       * ⚠️ STOCK MOVES IN BOTH DIRECTIONS, AND ONLY BETWEEN active AND sold. A row a human set to
       * `hidden` (or `draft`) is left exactly as it is — that is the moderation state this refresh
       * must never overwrite, and it is why the stock state needed its own value rather than
       * sharing `hidden`.
       */
      const inStock = truthy(r.inStock ?? true)
      const stock = existing && (existing.status === 'active' || existing.status === 'sold')
        ? { status: inStock ? 'active' : 'sold' }
        : {}
      const update = { ...refreshable, ...stock }

      // ⚠️ ONE ROW'S FAILURE MUST NOT KILL A 9,235-ROW RUN — this talks to the database over an SSH
      // tunnel, and a dropped tunnel surfaces as Prisma `ConnectionClosed`. Retry once, then skip.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await db.listing.upsert({
            where: { sellerId_externalId: { sellerId: seller!.id, externalId } },
            update, create: { ...fields, sellerId: seller!.id, externalId },
          })
          existing ? updated++ : created++
          return
        } catch (e) {
          if (attempt === 1) { skipped++; failures.push((e as Error).message.slice(0, 80)); return }
          await new Promise((res) => setTimeout(res, 1500))
        }
      }
  }

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${created} created, ${updated} updated, ${imaged} images hosted, ${skipped} skipped`)
  if (Object.keys(dropped).length) console.log(`  dropped: ${JSON.stringify(dropped)}`)
  if (failures.length) {
    const kinds: Record<string, number> = {}
    for (const f of failures) kinds[f.split(':')[0]] = (kinds[f.split(':')[0]] || 0) + 1
    console.log(`  write failures: ${JSON.stringify(kinds)}`)
  }
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
