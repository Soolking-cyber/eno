/**
 * Batdongsan.com.vn HCMC rentals → eno REFERENCE LISTINGS, FACTS ONLY.
 * Owner, 2026-09-21: "also add batdonsan listings".
 *
 * Run (DRY by default):
 *   set -a; . ./.env; set +a; npx tsx scripts/import-batdongsan-rentals.ts --src <all_rentals.json> [--apply]
 *
 * Same shape as import-rever-rentals.ts — outbound `affiliateUrl`, no chat, `negotiable:false`,
 * `listingType:'rent'` (which is also the feed guard) — with TWO deliberate differences:
 *
 * ⛔ 1. THIS SCRIPT IMPORTS NO IMAGES; attach-batdongsan-photos.ts DOES, SEPARATELY. That split is
 * why `images` is create-only below — the two scripts share rows and the importer must never
 * clobber the other's work.
 * ⛔ THE AGENT HEADSHOTS ARE NEVER PUBLISHED. 9,419 of the 31,734 scraped files are `img_2.jpg`,
 * a photograph of a real, identifiable person; Vietnam's PDPD (Decree 13/2023) treats an image of
 * a person as personal data requiring consent. The attach script refuses them on filename AND on
 * decoded dimensions, failing closed.
 * ⚠️ WHAT THE OWNER DID ACCEPT (2026-09-22: "its ok if its watermarked add our watermark on top")
 * is the rival agency's burned-in watermark showing on our cards. ⚠️ SOME OF THOSE BURNED MARKS
 * ALSO CARRY THE AGENT'S NAME (e.g. "VIỆT NAM BHREALTY · Tố Trình Joyce"). That is a named private
 * individual arriving via the photo rather than via a headshot, and it is NOT the same thing the
 * owner was asked about. Flagged to the owner rather than decided here.
 *
 * ⛔ 2. LIVENESS CANNOT BE VERIFIED, SO THERE IS NO RETIRE PASS. Every url returns a Cloudflare
 * interstitial ("Just a moment…", HTTP 403) to anything automated — checked with curl AND a real
 * headless browser. A human's browser solves the challenge, so the outbound links work for readers;
 * we simply cannot re-check the 23,026 the way import-rever-rentals.ts re-checks all 3,555 before
 * every run. ⚠️ THIS IMPORT IS THEREFORE A SNAPSHOT THAT CANNOT SELF-CORRECT. It was fresh when
 * taken (99.8% posted within 7 days) and it will rot with no mechanism to notice. Re-scrape to
 * refresh; do not assume a re-run validates anything.
 *
 * ⚠️ COORDINATES COME FROM THE SOURCE and every row has them — the scrape was re-run at 15:21 on
 * 2026-09-21 adding `latitude`/`longitude`/`price_type`, so an earlier survey of this same file
 * (18 fields, no coordinates) is stale. Check the field list before trusting notes about it.
 */
import { readFileSync } from 'node:fs'
import { invokedDirectly } from '../src/lib/cli-entry'
import { buildSearchText } from '../src/lib/fold'
import { roomAttributes } from '../src/lib/taxonomy'
import { localizeReferenceImportText, untranslatedSummary, type LocalizedImportTexts } from '../src/lib/import-i18n'

/** ⛔ PINNED BY ID, never resolved by display name — `Seller.name` is not unique and IS user
 *  settable (`api/profile/account-type`), so a name lookup could attach these to a real shop. */
export const SELLER_ID = 'bds-vn-import-seller-0001'
const SELLER_NAME = 'Batdongsan.com.vn'

const SUBCAT: Record<string, string | null> = {
  'Căn hộ / Chung cư': 'apartment-rental',
  'Nhà phố / Biệt thự': 'house-rental',
  'Nhà trọ / Phòng trọ': 'room-rental',
  'Mặt bằng / Văn phòng': 'office-rental',
  'Kho xưởng / Đất': null,
  'Bất động sản khác': null,
}

const argv = process.argv
const APPLY = argv.includes('--apply')
const str = (k: string, d: string | null = null) => {
  const i = argv.indexOf(k)
  return i > -1 && argv[i + 1] ? argv[i + 1] : d
}
const SRC = str('--src')
const LIMIT = Number(str('--limit', '0'))

const vnd = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + ' đ'
const inRange = (n: unknown, lo: number, hi: number): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi
/**
 * ⛔ RE-PARSE THE AREA FROM `area_raw`; THE STORED `area_m2` IS WRONG BY 1000× ON 701 ROWS.
 * Vietnamese groups thousands with a DOT, so `'2.040 m²'` is 2,040 m² — the scraper read it as
 * 2.04. It surfaces as absurd rent-per-m² (a 1,080 m² Thảo Điền building at 981 million đ/m²) and
 * would publish "2.04 m²" in the title and in the area facet. Exactly the failure I shipped myself
 * in the Rever price parser (`4.5 tr` → 45,000,000): same separator, opposite direction.
 * ⚠️ The pattern must require GROUPS OF THREE (`1.080`, `2.040`) — a bare `4.5` is a real decimal
 * and must stay 4.5, so a blanket strip of dots would corrupt every small area instead.
 */
function areaOf(raw: unknown, stored: unknown): number | null {
  const m = /([\d.,]+)/.exec(String(raw ?? ''))
  if (m) {
    const t = m[1]
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'))
    const n = Number(t.replace(',', '.'))
    if (Number.isFinite(n) && n > 0) return n
  }
  return typeof stored === 'number' && Number.isFinite(stored) && stored > 0 ? stored : null
}

/** The outbound CTA is only as trustworthy as this check — pin the host, not just the scheme. */
const allowedTarget = (u: unknown): u is string =>
  typeof u === 'string' && /^https:\/\/batdongsan\.com\.vn\//.test(u)

type Row = Record<string, any>

/**
 * The four texts of one row. ⛔ LOCALIZED HERE, INSIDE COMPOSE, because `update: mutable` below
 * REFRESHES title / titleVi / description / descriptionVi on every re-run: a fix made only in the
 * database would be reverted by the next import. localizeReferenceImportText (src/lib/import-i18n.ts)
 * makes the English text English (title location, Type / Location values from the reviewed
 * dictionary, English-grouped rent) and gives the Vietnamese fact block Vietnamese labels
 * ("Loại hình:", "Giá thuê: … đ/tháng"); `missing` lists what the dictionary does not cover yet.
 * scripts/localize-import-listings.ts applies the same function to the rows already stored.
 */
export function compose(r: Row, price: number): LocalizedImportTexts {
  const bits: string[] = []
  if (r.bedrooms) bits.push(`${r.bedrooms} bed`)
  if (r.bathrooms) bits.push(`${r.bathrooms} bath`)
  if (r._area) bits.push(`${r._area} m²`)
  const where = [r.ward, r.district].filter(Boolean).join(', ')
  const kind = r.property_type ?? 'Property'
  const facts = ([
    ['Type', r.property_type], ['Area', r.area_raw], ['Bedrooms', r.bedrooms],
    ['Bathrooms', r.bathrooms], ['Location', r.location], ['Rent', `${vnd(price)}/month`],
  ] as [string, any][]).filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`).join('\n')
  return localizeReferenceImportText({
    title: `${bits.join(' · ') || 'Property'} for rent — ${where}`,
    titleVi: `Cho thuê ${kind}${r.bedrooms ? ` ${r.bedrooms}PN` : ''}${r._area ? ` ${r._area}m²` : ''} — ${where}`,
    description: `Listed on Batdongsan.com.vn. eno links to the original — enquiries and viewings are handled there, not by eno.\n\n${facts}`,
    descriptionVi: `Tin đăng trên Batdongsan.com.vn. eno chỉ dẫn link tới tin gốc — mọi liên hệ và xem nhà do bên đó xử lý, không qua eno.\n\n${facts}`,
  })
}

async function main() {
  if (!SRC) throw new Error('--src <all_rentals.json> is required')
  const { PrismaClient } = await import('../src/generated/prisma/client')
  const { PrismaPg } = await import('@prisma/adapter-pg')
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL }),
    log: ['warn', 'error'],
  })

  const src: Row[] = JSON.parse(readFileSync(SRC, 'utf8'))
  const drop = { priceType: 0, priceRawPerM2: 0, price: 0, target: 0, area: 0, coords: 0 }
  const keep: Row[] = []
  for (const r of src) {
    /** ⛔ `price_type` IS THE SOURCE'S OWN FLAG AND BEATS PARSING `price_raw`. 348 rows are quoted
     *  PER M² — publishing those as the monthly rent shows a 200m² office at 1.12tr instead of
     *  224tr. 219 more are "negotiable", i.e. no real figure at all. */
    if (r.price_type !== 'lump_sum') { drop.priceType++; continue }
    /**
     * ⛔ TWO INDEPENDENT GUARDS, BECAUSE THE SOURCE CONTRADICTS ITSELF. Four rows are flagged
     * `lump_sum` while their own `price_raw` reads "1,12 triệu/m²" — including a 200m² Bitexco
     * office that would publish at 1.12tr/month instead of 224tr. Trusting the structured flag
     * alone is a single point of failure on the one field a renter actually reads, and the dry
     * run surfaced it only because it prints a sample row. Either signal saying per-m² is enough
     * to drop it; agreeing is what lets it through.
     */
    if (String(r.price_raw ?? '').includes('/m')) { drop.priceRawPerM2++; continue }
    if (!Number.isFinite(r.price_vnd) || r.price_vnd < 1_000_000 || r.price_vnd > 2_000_000_000) { drop.price++; continue }
    if (!allowedTarget(r.url)) { drop.target++; continue }
    const area = areaOf(r.area_raw, r.area_m2)
    if (area === null) { drop.area++; continue }
    r._area = area
    if (!inRange(r.latitude, 8, 24) || !inRange(r.longitude, 102, 110)) { drop.coords++; continue }
    keep.push(r)
  }
  const batch = LIMIT ? keep.slice(0, LIMIT) : keep

  const category = await db.category.findFirst({ where: { slug: 'rentals' }, select: { id: true, name: true } })
  if (!category) throw new Error('no `rentals` category')
  const seller = await db.seller.findUnique({ where: { id: SELLER_ID }, select: { id: true, name: true, ownerId: true } })
  const already = await db.listing.count({ where: { sellerId: SELLER_ID } })

  console.log(`source            ${src.length}`)
  console.log(`dropped           ${JSON.stringify(drop)}`)
  console.log(`TO IMPORT         ${batch.length}${LIMIT ? ` (--limit of ${keep.length})` : ''}`)
  console.log(`category          ${category.name}`)
  console.log(`seller            ${seller ? `${seller.name} (${seller.id})` : `(will be created as ${SELLER_ID})`}`)
  console.log(`rows on seller    ${already}`)
  console.log(`images            NONE — see the header; agent headshots + rival watermarks`)
  console.log(`mode              ${APPLY ? 'APPLY — WRITES TO PRODUCTION' : 'DRY RUN'}`)
  console.log(`untranslated      ${untranslatedSummary(batch.flatMap((r) => compose(r, r.price_vnd).missing)) || 'none — every mixed-language segment has a reviewed translation'}`)

  if (!APPLY) {
    const s = batch[0]
    if (s) {
      const c = compose(s, s.price_vnd)
      console.log(`\n── sample ──\n  ${c.title}\n  ${vnd(s.price_vnd)}/mo · ${s.district} · ${SUBCAT[s.property_type] ?? '(no subcategory)'}\n  (${s.latitude}, ${s.longitude})\n  -> ${s.url}`)
    }
    console.log('\nDRY RUN — nothing written. Re-run with --apply.')
    await db.$disconnect(); return
  }

  if (seller && seller.name !== SELLER_NAME) throw new Error(`seller ${SELLER_ID} is "${seller.name}" — refusing`)
  if (seller?.ownerId) throw new Error(`seller ${SELLER_ID} is owned by ${seller.ownerId} — refusing to attach imported rows`)
  if (!seller) {
    await db.seller.create({
      data: { id: SELLER_ID, name: SELLER_NAME, verified: false, verifiedSeller: false, officialPartner: false },
    })
  }

  let created = 0, updated = 0
  for (const r of batch) {
    const price = r.price_vnd as number
    /** The four text columns only — `missing` is a report (the `untranslated` line above), never a column. */
    const { title, titleVi, description, descriptionVi } = compose(r, price)
    const c = { title, titleVi, description, descriptionVi }
    // Bedrooms AND bathrooms, clamped at the taxonomy's open-ended top bucket (6+) — roomAttributes.
    const attributes = roomAttributes({ bedrooms: r.bedrooms, bathrooms: r.bathrooms })
    const externalId = `bds:${r.code}`
    const mutable = {
      ...c,
      price, priceUnit: 'VND', currency: '₫',
      negotiable: false,
      listingType: 'rent',
      categoryId: category.id,
      subcategorySlug: SUBCAT[r.property_type] ?? null,
      sellerId: SELLER_ID,
      location: r.location ?? [r.ward, r.district].filter(Boolean).join(', '),
      district: r.district ?? null,
      city: 'Hồ Chí Minh',
      lat: r.latitude, lng: r.longitude,
      areaM2: r._area,
      attributes,
      affiliateUrl: r.url,
      searchText: buildSearchText([c.title, c.titleVi, r.location, r.district, r.property_type]),
    }
    const res = await db.listing.upsert({
      where: { sellerId_externalId: { sellerId: SELLER_ID, externalId } },
      /** `verified` is the PUBLICATION GATE, not a trust badge — `feed-query` pins
       *  `verifiedFilter = true` for every public caller. Create-only so a moderator can hold a row. */
      /**
       * ⛔ `images` IS CREATE-ONLY OR A RE-IMPORT ERASES EVERY ATTACHED PHOTO. It used to sit in the
       * shared `mutable` payload, so `update: mutable` reset it to '[]' — the next price-refresh run
       * would have silently wiped all 19,152 uploads from attach-batdongsan-photos.ts and left ~1 GB
       * of orphaned objects in storage with nothing pointing at them. hide-imageless-imports would
       * then have hidden the entire import. Both reviewers caught this independently.
       * `[]` not null: serializeListingCard does `safeParse<string[]>(l.images, [])`.
       */
      create: { ...mutable, externalId, status: 'active', verified: true, images: '[]' },
      update: mutable,
      select: { id: true, createdAt: true, updatedAt: true },
    })
    if (res.createdAt.getTime() === res.updatedAt.getTime()) created++; else updated++
    if ((created + updated) % 500 === 0) console.log(`  ${created + updated}/${batch.length}`)
  }

  const active = await db.listing.count({ where: { sellerId: SELLER_ID, status: 'active' } })
  console.log(`\ncreated ${created}   updated ${updated}   active now ${active}`)
  console.log(`\nROLLBACK (safe, reversible):\n  UPDATE "Listing" SET status = 'hidden' WHERE "sellerId" = '${SELLER_ID}';`)
  console.log(`  -- hard delete is NOT paste-safe: Order is onDelete:Restrict and six relations Cascade.`)
  await db.$disconnect()
}
/** Run only when executed — compose() above is imported by the unit test (real paths: src/lib/cli-entry.ts). */
if (invokedDirectly(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
