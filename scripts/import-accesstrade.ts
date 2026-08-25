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
import { watermarkSvg, watermarkPlacement, inkForLuminance } from '../src/lib/core/watermark-mark'
import { brandSlugify, normalizeBrand } from '../src/lib/brand-normalize'
import { buildSearchText } from '../src/lib/fold'
// ⚠️ ONE COPY, SHARED WITH THE NIGHTLY REFRESH. This link repair used to live here; the cron job
// needs exactly the same rule, and two copies of "which aff_link shapes do we trust" is how one
// of them quietly rots. It is unit-tested in src/lib/affiliate-price-refresh.test.ts.
import { repairAffLink } from '../src/lib/affiliate-price-refresh'
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
if (!CAMPAIGN) { console.error('--campaign <name> required'); process.exit(1) }

const BUCKET = 'listings'
const EDGE = 1200            // product shots; smaller than a listing photo's 1600 — 9.7k of them
const WEBP_QUALITY = 80

type Feed = { name: string; price: number; discount: number; status_discount: number | string
  image: string; url: string; aff_link: string; sku: string; product_id: string; cate: string; desc: string; domain: string }

/**
 * Feed category → our taxonomy.
 * ⚠️ DERIVED FROM THE TITLE, because `cate` is EMPTY on 93% of rows (measured on 1,000 CellphoneS
 * products: 934 blank, 66 "camera"). Keyword order matters — "đồng hồ" before "phụ kiện" so a
 * watch is not filed as an accessory.
 */
const RULES: [RegExp, string][] = [
  [/tủ lạnh|máy giặt|điều hòa|máy lạnh|lò vi sóng|nồi chiên|máy hút bụi|quạt |bếp /i, 'furniture-appliances'],
  [/xe đạp|xe điện|scooter/i, 'vehicles'],
  [/đồng hồ|watch band|dây đeo/i, 'fashion-beauty'],
  [/loa |tai nghe|headphone|earbud|airpod/i, 'electronics'],
]
function categoryFor(name: string): string {
  for (const [re, slug] of RULES) if (re.test(name)) return slug
  return 'electronics' // CellphoneS is an electronics retailer; this is the honest default
}

/**
 * Subcategory, as ORDERED rules per category rather than the taxonomy's own keyword arrays.
 *
 * ⛔ THE TAXONOMY'S KEYWORDS CANNOT BE USED RAW HERE, AND THE REASON IS A REAL MIS-FILING: the
 * `storage` subcategory lists `tủ` (cabinet) and `tủ lạnh` is a REFRIGERATOR, so a first-match scan
 * files every fridge in the feed as a wardrobe. `white-goods` would have caught it, but its
 * keywords are English-only (`fridge|refrigerator|washer`) and this feed is Vietnamese. Order is
 * the fix: the specific two-word appliance terms are tested before the generic one-word ones.
 *
 * ⚠️ NO MATCH LEAVES IT NULL. Half this feed is appliances and accessories with no good home in
 * our taxonomy; guessing would put a phone case under "Phones" and make the facet useless. An
 * unset subcategory is honest and the category filter still works.
 */
const SUBCATS: Record<string, [RegExp, string][]> = {
  electronics: [
    [/iphone|ipad|galaxy tab|điện thoại|máy tính bảng|smartphone|tablet/i, 'phones-tablets'],
    [/macbook|laptop|thinkpad|máy tính xách tay|pc |desktop/i, 'laptops-pcs'],
    [/màn hình|monitor|smart tivi|\btivi\b|\btv\b|television/i, 'tv-monitors'],
    [/tai nghe|headphone|earbud|airpod|\bloa\b|speaker|soundbar/i, 'audio'],
    [/máy ảnh|camera|ống kính|\blens\b|gopro|\bdji\b|flycam/i, 'cameras'],
    [/playstation|\bps5\b|xbox|nintendo|switch|tay cầm chơi game/i, 'gaming'],
    [/sạc|cáp|ốp lưng|bàn phím|chuột|phụ kiện|adapter|charger|cable|keyboard|mouse/i, 'accessories'],
  ],
  'furniture-appliances': [
    // ⛔ These four FIRST — "tủ lạnh" contains "tủ", which `storage` claims.
    [/tủ lạnh|tủ đông|máy giặt|máy sấy|điều hòa|máy lạnh|máy rửa (bát|chén)/i, 'white-goods'],
    [/nồi|chảo|bếp |lò vi sóng|máy xay|ấm |máy pha cà phê/i, 'kitchenware'],
    [/đèn |lamp|light/i, 'lighting-decor'],
    [/tủ |kệ |wardrobe|cabinet|shelf/i, 'storage'],
  ],
}
function subcategoryFor(categorySlug: string, name: string): string | null {
  for (const [re, slug] of SUBCATS[categorySlug] ?? []) if (re.test(name)) return slug
  return null
}

/**
 * Brands worth having, chosen by FREQUENCY not by recognition.
 *
 * ⚠️ MEASURED ON 2,000 FEED ROWS: these are every brand appearing 15+ times. Twenty more appeared
 * fewer than 15 times and are deliberately left out — the brand facet is a navigation aid, and a
 * list with a 3-product long tail is worse than a short one (owner: "keep tight not too many").
 * A product whose brand is not here simply gets none, which is also true of ~43% of this feed.
 */
const BRANDS = ['apple', 'samsung', 'lg', 'panasonic', 'toshiba', 'sharp', 'sony', 'asus', 'canon',
  'dji', 'msi', 'honor', 'fujifilm', 'logitech', 'electrolux', 'xiaomi', 'hp', 'philips', 'casio']
const BRAND_RE = new RegExp(`\\b(${BRANDS.join('|')})\\b`, 'i')
/**
 * The MODEL — "iPhone 16 Pro Max", "Galaxy S24 Ultra" — so a shopper can filter to their exact
 * device and find its accessories (owner, 2026-08-24: "easier to find accessories for designated
 * brand model"). `model` is already a live filter (feed-query.ts pushes `{ model }`) and every
 * listing in the database had it null, so this is pure gain.
 *
 * ⚠️ THE CANONICAL CASING IS THE POINT, NOT DECORATION. The filter matches on the STRING, so
 * "Macbook Pro" and "MacBook Pro" are two different filter entries listing half the stock each —
 * and the feed contains both spellings. Measured on 4,000 real titles: 23% carry a model,
 * 122 distinct once canonicalised.
 *
 * ⚠️ NO MATCH LEAVES IT NULL. Most of this feed is appliances and cables with no model; inventing
 * one would fill the facet with noise, which is the opposite of "easier to find".
 */
const MODEL_RES: RegExp[] = [
  /\b(iPhone\s?\d{1,2}(?:\s?Pro\s?Max|\s?Pro|\s?Plus|\s?Mini|e)?)/i,
  /\b(Galaxy\s(?:Z\s)?(?:Fold|Flip|Note|Tab|Watch|Buds)?\s?[A-Z]?\d{1,3}(?:\s?Ultra|\s?Plus|\s?FE)?)/i,
  /\b(MacBook\s(?:Air|Pro)(?:\s?M\d)?)/i,
  /\b(iPad(?:\s(?:Pro|Air|Mini))?(?:\s?M\d)?)/i,
  /\b(Apple\sWatch\s(?:Series\s\d+|Ultra\s?\d?|SE\s?\d?))/i,
  /\b(AirPods(?:\s(?:Pro|Max))?\s?\d?)/i,
  /\b(Redmi\s(?:Note\s)?\d{1,2}[A-Za-z]?)/i,
  /\b(Xiaomi\s\d{1,2}[A-Za-z]?)/i,
]
/** Spellings the feed uses inconsistently, mapped to one display form. */
const MODEL_CASE: [RegExp, string][] = [
  [/^macbook/i, 'MacBook'], [/^iphone/i, 'iPhone'], [/^ipad/i, 'iPad'],
  [/^airpods/i, 'AirPods'], [/^apple watch/i, 'Apple Watch'], [/^galaxy/i, 'Galaxy'],
  [/^redmi/i, 'Redmi'], [/^xiaomi/i, 'Xiaomi'],
]
function modelFor(name: string): string | null {
  for (const re of MODEL_RES) {
    const m = name.match(re)
    if (!m) continue
    const raw = m[1].replace(/\s+/g, ' ').trim()
    // ⚠️ WORD-CASE FIRST, CANONICAL HEAD SECOND — the other order lowercases the canonical form it
    // just applied and turns "MacBook Pro" back into "Macbook Pro", which is the exact split this
    // function exists to prevent. Caught by running both spellings through it.
    const cased = raw.split(' ').map((w) => /^(M\d|SE|FE)$/i.test(w) ? w.toUpperCase()
      : /^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
    for (const [head, canon] of MODEL_CASE) {
      if (head.test(cased)) return cased.replace(head, canon)
    }
    return cased
  }
  return null
}

function brandFor(name: string): string | null {
  const m = name.match(BRAND_RE)
  return m ? brandSlugify(m[1]) : null
}

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

/** Square-crop, stamp, encode — the same mark and ink rule the app uses (see watermark-mark.ts). */
async function hostImage(src: string, slug: string): Promise<string | null> {
  try {
    const res = await fetch(encodeURI(src), { signal: AbortSignal.timeout(25_000) })
    if (!res.ok) return null
    const sharp = (await import('sharp')).default
    const buf = Buffer.from(await res.arrayBuffer())
    const img = sharp(buf, { limitInputPixels: 50_000_000 }).rotate()
    const meta = await img.metadata()
    /**
     * ⛔ NO SQUARE CROP. This read `side = min(width, height, EDGE)` and then `fit: 'cover'`, which
     * takes a centre square out of every image — so a 1200x600 marketing banner lost half its
     * width, and the text on it was sliced through the middle. Owner, 2026-08-25: "we have to
     * import images without cropping since most products have broken bad looking images."
     * Measured: every stored image was exactly 1:1 (1100x1100, 800x800, 600x600).
     * ⚠️ `fit: 'inside'` + `withoutEnlargement` keeps the WHOLE frame and never upscales a small
     * source into a blurry big one. Cards still show a square thumbnail — that crop belongs in CSS,
     * where it is reversible, not baked into the file we store forever.
     */
    /**
     * ⚠️ EXIF ORIENTATION SWAPS THE AXES, AND `metadata()` REPORTS THE PRE-ROTATION FRAME.
     * `.rotate()` applies the EXIF flag at render time, so for orientations 5-8 the rendered image
     * is H x W while `meta` still says W x H. Computing the target from the unrotated numbers makes
     * `watermarkPlacement` place the mark outside the real canvas and `composite` throws
     * "image to composite must have same dimensions or smaller" — killing that image, and with it
     * the whole batch. Swapping here costs nothing; re-encoding to measure would cost a decode.
     */
    const swapped = (meta.orientation ?? 1) >= 5
    const srcW = (swapped ? meta.height : meta.width) ?? EDGE
    const srcH = (swapped ? meta.width : meta.height) ?? EDGE
    const scale = Math.min(1, EDGE / Math.max(srcW, srcH))
    const outW = Math.max(1, Math.round(srcW * scale))
    const outH = Math.max(1, Math.round(srcH * scale))
    // Product shots are usually on white already; flatten keeps a transparent PNG from going black.
    const png = await img.resize({ width: outW, height: outH, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).png().toBuffer()
    const { markWidth, left, top, region } = watermarkPlacement(outW, outH)
    let mean: number | null = null
    try { const { channels } = await sharp(png).extract(region).greyscale().stats(); mean = (channels[0]?.mean ?? 0) / 255 } catch {}
    const out = await sharp(png).composite([{ input: watermarkSvg(markWidth, inkForLuminance(mean)).svg, left, top }])
      .webp({ quality: WEBP_QUALITY }).toBuffer()
    const path = `affiliate/${slug}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.webp`
    const { error } = await storage!.upload(path, out, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' })
    if (error) return null
    return `${storageUrl}/storage/v1/object/public/${BUCKET}/${path}`
  } catch { return null }
}

async function main() {
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — campaign=${CAMPAIGN}${LIMIT ? ` (first ${LIMIT})` : ''}\n`)

  const first = await feedPage(1, 1)
  const total = LIMIT || first.total
  console.log(`feed reports ${first.total} products; importing ${total}\n`)

  const cats = await db.category.findMany({ select: { id: true, slug: true } })
  const catId = new Map(cats.map((c) => [c.slug, c.id]))

  // ⛔ IDENTIFIED BY NAME, AND REFUSED IF IT HAS AN OWNER. A storefront with an ownerId belongs to
  // a real person; hanging 9,728 affiliate rows off it would hand them a catalogue they never
  // posted. VinWonders' seeder learned this the same way.
  // The campaign's numeric id, needed to repair every aff_link. Read from the API so this script
  // works for any campaign without a hardcoded table.
  const campList = await (await fetch(`https://api.accesstrade.vn/v1/campaigns?approval=successful&limit=50`, { headers: { Authorization: `Token ${KEY}` } })).json() as { data: { id: string; merchant: string }[] }
  const campaignId = (campList.data || []).find((c) => c.merchant === CAMPAIGN)?.id
  if (!campaignId) {
    // ⛔ Not approved = the links earn nothing. Refuse rather than fill the marketplace with them.
    console.error(`"${CAMPAIGN}" is not an APPROVED campaign for this publisher — refusing.`)
    console.error('Approved:', (campList.data || []).map((c) => c.merchant).join(', ') || '(none)')
    process.exit(1)
  }
  console.log(`campaign id ${campaignId}\n`)

  const merchantName = CAMPAIGN === 'cellphones_cps' ? 'CellphoneS' : CAMPAIGN!
  // The merchant's own city. Only used for the storefront and the listings' fallback map pin.
  const MERCHANT_CITY = arg('city') ?? 'Hồ Chí Minh'
  let seller = await db.seller.findFirst({ where: { name: merchantName }, select: { id: true, name: true, ownerId: true } })
  if (seller?.ownerId) { console.error(`"${merchantName}" is owned by a real account — refusing`); process.exit(1) }
  if (!seller) {
    console.log(`storefront "${merchantName}" does not exist — ${APPLY ? 'creating' : 'would create'}`)
    if (APPLY) {
      seller = await db.seller.create({
        // ⚠️ officialPartner STAYS FALSE. That badge is for negotiated partners like VinWonders;
        // stamping it on an imported datafeed devalues the real one.
        // ⚠️ Written from the campaign, not hardcoded: this script takes --campaign, so baking
        // CellphoneS's bio and city in would mislabel the next merchant imported through it.
        data: { name: merchantName, bio: `Products are bought and paid for on the ${merchantName} website.`,
                location: MERCHANT_CITY, officialPartner: false, verified: false },
        select: { id: true, name: true, ownerId: true },
      })
    }
  }
  if (!seller && !APPLY) console.log('(dry run continues without a storefront)\n')

  if (APPLY) {
    // Create only the brands this feed actually uses often enough to be worth a facet entry.
    const have = new Set((await db.brand.findMany({ select: { slug: true } })).map((b) => b.slug))
    const missing = BRANDS.map(brandSlugify).filter((b) => !have.has(b))
    for (const slug of missing) {
      // `normalized` is the uniqueness/typo-dedup key (see brand-normalize.ts) — required, and
      // computed with the app's own helper so an imported brand collides with a human-typed one.
      const name = slug.charAt(0).toUpperCase() + slug.slice(1)
      await db.brand.create({ data: { slug, name, normalized: normalizeBrand(name) } }).catch(() => {})
    }
    if (missing.length) console.log(`brands created: ${missing.join(', ')}\n`)
  }

  let seen = 0, created = 0, updated = 0, skipped = 0, imaged = 0
  const failures: string[] = []
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
        const price = Number(p.status_discount) === 1 && Number(p.discount) > 0 ? Number(p.discount) : Number(p.price)
        // ⛔ A ZERO PRICE RENDERS AS "Free / Miễn phí" (src/components/marketplace/price.tsx).
        if (!Number.isFinite(price) || price <= 0) { skipped++; return }
        if (!p.image) { skipped++; return }
        const affiliateUrl = repairAffLink(p.aff_link, campaignId)
        if (!affiliateUrl) { skipped++; return }
        const slug = categoryFor(p.name)
        const categoryId = catId.get(slug)
        if (!categoryId) { skipped++; return }
        const externalId = String(p.sku || p.product_id || '').slice(0, 190)
        if (!externalId) { skipped++; return }
        // ⚠️ The dry run queries too, or it reports every row as "created" forever and can never
        // show that a refresh is an UPDATE — which is the thing worth previewing on a re-run.
        const existing = seller
          // ⚠️ `title`/`description` are read so a REFRESH can keep the text a human or a model
          // wrote (see the searchText build below), not just to decide create-vs-update.
          ? await db.listing.findFirst({ where: { sellerId: seller.id, externalId }, select: { id: true, images: true, title: true, titleVi: true, description: true, descriptionVi: true } })
          : null
        if (!APPLY) { existing ? updated++ : created++; return }
        let images = existing?.images
        const hasImage = (() => { try { return JSON.parse(images || '[]').length > 0 } catch { return false } })()
        if (!hasImage) {
          const url = await hostImage(p.image, slug)
          if (url) { images = JSON.stringify([url]); imaged++ }
        }
        if (!images || images === '[]') { skipped++; return }

        const feedTitle = p.name.slice(0, 180)
        const feedDesc = (p.desc || p.name).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 1800)
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
          images, categoryId, location: MERCHANT_CITY, city: MERCHANT_CITY,
          subcategorySlug: subcategoryFor(slug, p.name), brandSlug: brandFor(p.name), model: modelFor(p.name),
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
           * ⚠️ Deliberately NOT solved by making searchText create-only: `titleVi`, `brandSlug`,
           * `model` and the category all stay refreshable, so a create-only blob would silently
           * stop matching a renamed or re-branded product — a different silent regression.
           */
          // ⚠️ BOTH DESCRIPTION COLUMNS. Folding only the English one dropped the model's
          // VIETNAMESE prose out of the blob on every re-import — silently un-indexing the text
          // most buyers actually read, with nothing to re-select the row afterwards.
          searchText: buildSearchText([
            existing?.title ?? feedTitle, feedTitle,
            existing?.titleVi ?? feedTitle,
            existing?.description ?? feedDesc, feedDesc,
            existing?.descriptionVi ?? feedDesc,
            MERCHANT_CITY, slug, brandFor(p.name), modelFor(p.name),
          ]),
          affiliateUrl, verified: true, status: 'active',
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
         * A refresh therefore updates: price, images, affiliateUrl, category/brand/model, and the
         * merchant's own Vietnamese text. Everything a human or a translator decided is left alone.
         */
        /**
         * ⛔ `descriptionVi` IS CREATE-ONLY TOO. It was refreshable, so a re-import overwrote it with
         * the feed's `desc` — which is the title repeated. The damage is invisible and permanent:
         * `description` is create-only so English readers keep the good prose, while `useLocalized`
         * serves `descriptionVi` verbatim to every Vietnamese reader (the dominant traffic), and the
         * describe script's resume predicate is "description still equals title" — which is now
         * false — so it would never re-select the row to repair it.
         */
        const { status, verified, title, description, descriptionVi, ...refreshable } = fields
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
              update: refreshable,
              create: { ...fields, sellerId: seller!.id, externalId },
            })
            existing ? updated++ : created++
            return
          } catch (e) {
            if (attempt === 1) { skipped++; failures.push((e as Error).message.slice(0, 80)); return }
            await new Promise((r) => setTimeout(r, 1500))
          }
        }
      }))
    }
    if (page % 2 === 0 || seen >= total) console.log(`  ${seen}/${total}  created=${created} updated=${updated} images=${imaged} skipped=${skipped}`)
  }
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: ${created} created, ${updated} updated, ${imaged} images hosted, ${skipped} skipped`)
  // ⚠️ Name the failures rather than leaving "skipped" to mean four different things.
  if (failures.length) {
    const kinds: Record<string, number> = {}
    for (const f of failures) kinds[f.split(':')[0]] = (kinds[f.split(':')[0]] || 0) + 1
    console.log(`  write failures: ${JSON.stringify(kinds)}`)
  }
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
