/**
 * Rever.vn HCMC rentals → eno REFERENCE LISTINGS.
 * Owner, 2026-09-21: "start with rever unrented properties in hcmc", seller "Rever.vn", prod write ok.
 *
 * Run (DRY by default — prints what it would do and writes nothing):
 *   set -a; . ./.env; set +a; npx tsx scripts/import-rever-rentals.ts \
 *     --src <all_rentals.json> --status <rever-status.jsonl> [--apply] [--year-min 2023] [--limit N]
 *
 * ─── WHAT THESE ROWS ARE, AND THE INVARIANTS THAT KEEP THEM HONEST ──────────────────────────
 *
 * ⛔ 1. THEY ARE NOT OUR SUPPLY, SO `affiliateUrl` IS ALWAYS SET. Nobody at Rever agreed to be
 * here and no eno seller owns these. `affiliateUrl` is the switch the PDP already reads (built for
 * VinWonders) to replace the chat/contact CTA with an outbound button. Clearing it would silently
 * turn ~1,100 un-owned rows into listings buyers can message about, into a void.
 *
 * ⛔ 2. `negotiable: false`, AGAINST THE SCHEMA DEFAULT OF true. An offer needs a counterparty. The
 * default would show the offer UI, the server would 409 the POST, and the buyer's trust score takes
 * the hit for our import.
 *
 * ⛔ 3. `listingType: 'rent'` IS ALSO THE FEED GUARD, AND IT IS LOAD-BEARING. `feedListingTypes()`
 * returns ['sell'] on eno.vn and ['sell','service'] on eno.forum, and BOTH feed routes filter on
 * it — so 'rent' cannot reach the Meta catalogue or Google Shopping. ⚠️ If anyone adds 'rent' to
 * that list, these rows ship to Meta the same hour.
 *
 * ⚠️ IMAGES ARE FETCHED AND CACHED BY OUR OPTIMIZER, NOT HOTLINKED. `next.config.ts` allowlists
 * `photo.rever.vn` on the four prefixes in `IMAGE_PREFIXES` below; without it every one of these
 * 400s at `/_next/image` while loading fine when opened directly. So we hold cached derivatives
 * of Rever's photographs. That is the
 * better trade in both directions — Rever serves us once per variant instead of once per visitor,
 * and users get ~16KB AVIF instead of a 321KB JPEG — but it is a copy, and an earlier version of
 * this header wrongly claimed "hotlinked, never copied". A reviewer caught it.
 *
 * ⚠️ DISTRICTS ARE STORED VERBATIM, ABOLISHED NAMES AND ALL. 48% say `Quận 2`/`Quận 9`, merged into
 * TP Thủ Đức in 2021 — but the explorer's `thu-duc` entry lists both spellings in its `match` array
 * and filters `district LIKE`, so they resolve to the right chip. Rewriting them would be a second,
 * competing normalisation of the same fact.
 */
import { readFileSync, statSync } from 'node:fs'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { buildSearchText } from '../src/lib/fold'

/**
 * ⛔ THE SELLER IS PINNED BY ID, NEVER LOOKED UP BY NAME. `Seller.name` has NO unique constraint
 * and is written straight from user input (`api/profile/account-type` writes `name: businessName`),
 * so `findFirst({ where: { name: 'Rever.vn' } })` could match a real person's shop — and `findFirst`
 * has no ordering, so which one it picks is not even deterministic. The import would then attach
 * every row to that account, whose owner could edit them and would receive the enquiries. A
 * reviewer caught this; it was a live capture risk, not a style point.
 */
const SELLER_ID = 'cmub0wead0000zrq418bqq27m'
const SELLER_NAME = 'Rever.vn'

/**
 * ⚠️ ONLY IMAGES THE OPTIMIZER ALLOWLIST COVERS. Checking `startsWith('https://')` alone (the first
 * version) stored urls `remotePatterns` does not admit, which is a 400 on the card, not a fallback.
 * ⛔ THIS LIST AND `next.config.ts` ARE ONE FACT WRITTEN TWICE. Rever serves four prefixes
 * (/v3/get 13,748 · /photo/v3 3,516 · /v2/get 227 · /photo/v2 110 across 17,601 urls); narrowing
 * either side without the other either drops images we could show or stores images that 400.
 */
const IMAGE_PREFIXES = [
  'https://photo.rever.vn/v3/get/',
  'https://photo.rever.vn/photo/v3/',
  'https://photo.rever.vn/v2/get/',
  'https://photo.rever.vn/photo/v2/',
] as const
const allowedImage = (u: unknown): u is string =>
  typeof u === 'string' && IMAGE_PREFIXES.some((p) => u.startsWith(p))

/** `Bất động sản khác` ("other property") maps to NOTHING on purpose — a null subcategory is
 *  honest, where forcing it into `apartment-rental` would put shops and land in the flat filter. */
const SUBCAT: Record<string, string | null> = {
  'Căn hộ / Chung cư': 'apartment-rental',
  'Nhà phố / Biệt thự': 'house-rental',
  'Mặt bằng / Văn phòng': 'office-rental',
  'Văn phòng': 'office-rental',
  'Bất động sản khác': null,
}

const argv = process.argv
const APPLY = argv.includes('--apply')
const str = (k: string, d: string | null = null) => {
  const i = argv.indexOf(k)
  return i > -1 && argv[i + 1] ? argv[i + 1] : d
}
const num = (k: string, d: number) => Number(str(k, String(d)))
const YEAR_MIN = num('--year-min', 2023)
const LIMIT = num('--limit', 0)
/** ⛔ PATHS ARE ARGUMENTS, NOT CONSTANTS. The first version hardcoded a Claude session's
 *  `/private/tmp/claude-.../scratchpad` and `/Users/mk1e3/...`; a committed script the owner is
 *  told to re-run could not be re-run by anyone, anywhere, once that tmp dir cleared. */
const SRC = str('--src')
const STATUS = str('--status')
/**
 * Optional. JSONL from the building crawl: one `{url, slug, name}` per listing, where `slug` is
 * Rever's PROJECT slug taken from the listing page's own BreadcrumbList JSON-LD. Populates
 * `Listing.buildingKey`, which is what the map groups on.
 * ⚠️ OMITTING IT LEAVES buildingKey UNTOUCHED rather than clearing it — a re-import without the
 * file must not silently un-group 1,084 rows and collapse the map back to overlapping pins.
 */
const BUILDINGS = str('--buildings')

const vnd = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + ' đ'
/**
 * ⚠️ RETURNS NaN FOR A MALFORMED ID, AND THE CALLER MUST TREAT THAT AS TOO OLD. `NaN < YEAR_MIN`
 * is false, so an unparseable id used to sail past `--year-min` — the filter failed OPEN, which is
 * the wrong direction for a vintage cutoff whose whole job is excluding stale rows.
 */
const year = (id: string) => new Date(Number(String(id).split('_')[0])).getUTCFullYear()

/** Finite, and inside a plausible band — `typeof n === 'number'` alone admits NaN. */
const inRange = (n: unknown, lo: number, hi: number): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi

/**
 * ⛔ THE OUTBOUND CTA IS ONLY AS TRUSTWORTHY AS THIS CHECK. `affiliateUrl` becomes a live link on
 * the PDP; an unvalidated value from the source JSON could point anywhere. `safeAffiliateUrl()`
 * already refuses non-https at render, so `javascript:` is dead either way — this pins the HOST
 * too, which nothing downstream does.
 */
const allowedTarget = (u: unknown): u is string =>
  typeof u === 'string' && /^https:\/\/(www\.)?rever\.vn\//.test(u)

type Row = Record<string, any>

function compose(r: Row, price: number) {
  const bits: string[] = []
  if (r.bedrooms) bits.push(`${r.bedrooms} bed`)
  if (r.bathrooms) bits.push(`${r.bathrooms} bath`)
  if (r.area_m2) bits.push(`${r.area_m2} m²`)
  const where = [r.ward, r.district].filter(Boolean).join(', ')
  const kind = r.property_type ?? 'Property'
  const facts = ([
    ['Type', r.property_type], ['Area', r.area_raw], ['Bedrooms', r.bedrooms],
    ['Bathrooms', r.bathrooms], ['Direction', r.direction], ['Address', r.full_address],
    ['Rent', `${vnd(price)}/month`],
  ] as [string, any][]).filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${v}`).join('\n')

  return {
    title: `${bits.join(' · ') || 'Property'} for rent — ${where}`,
    titleVi: `Cho thuê ${kind}${r.bedrooms ? ` ${r.bedrooms}PN` : ''}${r.area_m2 ? ` ${r.area_m2}m²` : ''} — ${where}`,
    description: `Listed on Rever.vn. eno links to the original — enquiries and viewings are handled by Rever, not by eno.\n\n${facts}`,
    descriptionVi: `Tin đăng trên Rever.vn. eno chỉ dẫn link tới tin gốc — mọi liên hệ và xem nhà do Rever xử lý, không qua eno.\n\n${facts}`,
  }
}

async function main() {
  if (!SRC || !STATUS) throw new Error('--src <all_rentals.json> and --status <rever-status.jsonl> are required')
  const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
  const db = new PrismaClient({ adapter, log: ['warn', 'error'] })

  const status = new Map<string, Row>()
  for (const line of readFileSync(STATUS, 'utf8').split('\n')) {
    if (line.trim()) { const s = JSON.parse(line); status.set(s.url, s) }
  }
  const src: Row[] = JSON.parse(readFileSync(SRC, 'utf8'))
  const buildingOf = new Map<string, string>()
  if (BUILDINGS) {
    for (const line of readFileSync(BUILDINGS, 'utf8').split('\n')) {
      if (!line.trim()) continue
      const r = JSON.parse(line)
      if (r.code === 200 && r.slug) buildingOf.set(r.url, r.slug)
    }
  }
  /**
   * ⚠️ mtime IS A PROXY FOR CRAWL AGE AND IT CAN BE DEFEATED. `cp`, `git checkout`, a download or
   * a `touch` all reset it, so a month-old crawl moved into a new directory reads as fresh and
   * passes the `--apply` refusal below. The status records carry no timestamp of their own to
   * check instead. Treat this as a guard against the common accident (an old file left lying
   * around), NOT against a file that has been moved — when in doubt, re-run the status crawler.
   */
  const statusAgeDays = (Date.now() - statSync(STATUS).mtimeMs) / 86_400_000

  const drop = { unchecked: 0, http: 0, rented: 0, noPrice: 0, noImages: 0, badTarget: 0, tooOld: 0 }
  const keep: Row[] = []
  for (const r of src) {
    const s = status.get(r.url)
    if (!s) { drop.unchecked++; continue }
    if (s.code !== 200) { drop.http++; continue }
    if (s.rented !== false) { drop.rented++; continue }
    /**
     * ⛔ TRUTHINESS IS NOT VALIDATION FOR A PRICE THAT GOES STRAIGHT ONTO A PUBLIC CARD. The
     * crawler parses this out of HTML, so a regex change upstream could yield a string, or a value
     * already in millions. Either publishes "15 đ/tháng" or throws mid-loop leaving a partial
     * import. The band is deliberately wide — real HCMC rents here run ~4tr to ~500tr/month.
     */
    if (!Number.isFinite(s.live_price) || s.live_price < 1_000_000 || s.live_price > 2_000_000_000) {
      drop.noPrice++; continue
    }
    if (!(r.images ?? []).some(allowedImage)) { drop.noImages++; continue }
    if (!allowedTarget(r.url)) { drop.badTarget++; continue }
    // ⚠️ `!(y >= YEAR_MIN)`, not `y < YEAR_MIN` — NaN must FAIL the filter, not pass it.
    if (!(year(r.id) >= YEAR_MIN)) { drop.tooOld++; continue }
    keep.push({ ...r, _price: s.live_price })
  }
  const batch = LIMIT ? keep.slice(0, LIMIT) : keep

  const category = await db.category.findFirst({ where: { slug: 'rentals' }, select: { id: true, name: true } })
  if (!category) throw new Error('no `rentals` category — cannot place these rows')
  const seller = await db.seller.findUnique({ where: { id: SELLER_ID }, select: { id: true, name: true, ownerId: true } })
  const already = await db.listing.count({ where: { sellerId: SELLER_ID } })

  /**
   * ⛔ RETIREMENT IS OPT-IN AND OFF BY DEFAULT, BECAUSE ITS REVERSIBILITY IS NOT SOLVED.
   * Rows whose property has since been let are merely absent from `batch`, so without a retire
   * pass they stay `active` for ever. But `status` is deliberately create-only (below), so a row
   * this pass hides can never be re-listed by a later run — and the script cannot tell its own
   * `'hidden'` from a moderator's, so it must not blanket-restore either. Both reviewers found
   * this independently; an earlier comment here claimed "the next run re-lists it", which was
   * simply false. Until there is a distinct marker (a `retiredBy` attribute or its own status),
   * the honest behaviour is to make the one-way door explicit rather than to hide it.
   *
   * ⚠️ COVERAGE COUNTS ONLY DEFINITIVE ANSWERS. It used to be `status.size / src.length`, which
   * counts every entry including errors — so a crawl that 429'd on every request still read as
   * 100% coverage, dropped every row out of `seen`, and would have hidden the whole catalogue.
   */
  /**
   * ⚠️ COVERAGE IS MEASURED OVER THE SOURCE URLS, NOT OVER THE STATUS FILE. Counting status
   * entries lets leftovers from a larger, older crawl push the figure past the threshold while
   * the rows actually being imported went unchecked. A 404/410 counts as answered — it is a
   * definitive "gone", and excluding it would block retirement exactly when churn is highest.
   */
  const definitive = new Set([200, 404, 410])
  const answered = src.filter((r) => definitive.has(status.get(r.url)?.code)).length
  const coverage = answered / src.length
  const RETIRE = argv.includes('--retire')
  const canRetire = RETIRE && coverage >= 0.98 && !LIMIT && statusAgeDays <= 7

  console.log(`source            ${src.length}`)
  console.log(`status file       ${status.size}  (${(coverage * 100).toFixed(1)}% coverage, ${statusAgeDays.toFixed(1)}d old)`)
  console.log(`dropped           ${JSON.stringify(drop)}`)
  console.log(`year-min          ${YEAR_MIN}`)
  console.log(`buildings file    ${BUILDINGS ? `${buildingOf.size} listings mapped` : '(none — buildingKey left untouched)'}`)
  console.log(`TO IMPORT         ${batch.length}${LIMIT ? ` (--limit ${LIMIT} of ${keep.length})` : ''}`)
  console.log(`category          ${category.name} (${category.id})`)
  console.log(`seller            ${seller ? `${seller.name} (${seller.id})` : `(will be created as ${SELLER_ID})`}`)
  console.log(`rows on seller    ${already}`)
  const retireOff = !RETIRE ? '--retire not passed' : LIMIT ? '--limit set'
    : statusAgeDays > 7 ? `status file ${statusAgeDays.toFixed(0)}d old` : `coverage ${(coverage * 100).toFixed(1)}% < 98%`
  console.log(`retire pass       ${canRetire ? 'ON — hides rows no longer available (ONE-WAY)' : `OFF (${retireOff})`}`)
  console.log(`mode              ${APPLY ? 'APPLY — WRITES TO PRODUCTION' : 'DRY RUN'}`)

  /**
   * ⛔ A STALE STATUS FILE REFUSES THE WRITE, IT DOES NOT WARN. Availability and price both come
   * from that file; running `--apply` against a month-old one republishes properties let since,
   * each with a live outbound link to a rented unit. A warning printed above a successful run is
   * read by nobody.
   */
  if (APPLY && statusAgeDays > 7) {
    throw new Error(`status file is ${statusAgeDays.toFixed(1)} days old — re-run the status crawler before --apply`)
  }

  if (!APPLY) {
    const s = batch[0]
    if (s) {
      const c = compose(s, s._price)
      console.log(`\n── sample row ──\n  ${c.title}\n  ${vnd(s._price)}/mo · ${s.district} · ${SUBCAT[s.property_type] ?? '(no subcategory)'}\n  -> ${s.url}`)
    }
    console.log('\nDRY RUN — nothing written. Re-run with --apply.')
    await db.$disconnect(); return
  }

  if (seller && seller.name !== SELLER_NAME) {
    throw new Error(`seller ${SELLER_ID} is named "${seller.name}", expected "${SELLER_NAME}" — refusing to write into someone else's shop`)
  }
  /**
   * ⛔ AN OWNED SELLER MEANS A REAL PERSON. `verify-rever-import.ts` asserts `ownerId` stays null,
   * but asserting it after the fact does not stop the write that broke it. If this row ever gets
   * claimed, that account would receive every enquiry and could edit ~1,100 rows it never posted.
   */
  if (seller?.ownerId) {
    throw new Error(`seller ${SELLER_ID} has ownerId ${seller.ownerId} — a real account owns it; refusing to attach imported rows`)
  }
  if (!seller) {
    await db.seller.create({
      /** ⚠️ `verified:false` and no owner, deliberately: the badge must never imply we vetted these,
       *  and `ownerId` is unique 1:0..1 to a Profile — there is no human behind this row. */
      data: { id: SELLER_ID, name: SELLER_NAME, verified: false, verifiedSeller: false, officialPartner: false },
    })
  }

  const seen = new Set<string>()
  let created = 0, updated = 0
  for (const r of batch) {
    const price = r._price as number
    const c = compose(r, price)
    const images = (r.images as unknown[]).filter(allowedImage)
    /**
     * ⛔ A MISSING BEDROOM COUNT IS NOT A STUDIO. `Number(r.bedrooms || 0)` mapped absent to 0, and
     * the taxonomy's `bedrooms` facet reads '0' as "Studio" — so 446 listings, mostly offices,
     * land and shops, would have been filed under a studio-flat filter. Omit the attribute when
     * there is no value; a null facet is honest, a wrong one is a lie a buyer filters on.
     */
    const beds = Number(r.bedrooms) > 0 ? Math.min(Number(r.bedrooms), 3) : null
    const externalId = `rever:${r.id}`
    seen.add(externalId)

    /**
     * ⛔ `status` AND `verified` ARE CREATE-ONLY. They were in the shared `data` object, so every
     * re-run rewrote them — silently re-publishing any row a moderator had hidden or held, with no
     * warning. Refreshing price and availability must never override a human moderation decision.
     */
    const mutable = {
      ...c,
      price, priceUnit: 'VND', currency: '₫',
      negotiable: false,
      listingType: 'rent',
      categoryId: category.id,
      subcategorySlug: SUBCAT[r.property_type] ?? null,
      sellerId: SELLER_ID,
      location: r.full_address ?? [r.ward, r.district, r.city].filter(Boolean).join(', '),
      district: r.district ?? null,
      city: r.city ?? 'Hồ Chí Minh',
      /**
       * ⛔ COORDINATES ARE RANGE-CHECKED, NOT JUST PASSED THROUGH. A string, a null island (0,0) or
       * a swapped lat/lng puts a map pin in the Gulf of Guinea or the wrong hemisphere — this repo
       * has already shipped a version of that bug once. Bounds are Vietnam's land extent with room
       * to spare; anything outside stores null, which renders no pin rather than a wrong one.
       * A non-finite `area_m2` would also throw mid-loop, leaving a partial import.
       */
      lat: inRange(r.latitude, 8, 24) ? r.latitude : null,
      lng: inRange(r.longitude, 102, 110) ? r.longitude : null,
      areaM2: Number.isFinite(r.area_m2) && r.area_m2 > 0 ? r.area_m2 : null,
      attributes: beds === null ? null : JSON.stringify({ bedrooms: String(beds) }),
      affiliateUrl: r.url,
      /** ⚠️ Spread conditionally: with no --buildings file this key is ABSENT from the update
       *  payload, so Prisma leaves the column alone. Writing `null` would un-group every row. */
      ...(buildingOf.has(r.url) ? { buildingKey: buildingOf.get(r.url)! } : {}),
      searchText: buildSearchText([c.title, c.titleVi, r.full_address, r.district, r.property_type]),
    }
    const res = await db.listing.upsert({
      where: { sellerId_externalId: { sellerId: SELLER_ID, externalId } },
      /**
       * ⛔ `verified` IS THE PUBLICATION GATE, NOT A TRUST BADGE. `feed-query.ts` pins
       * `verifiedFilter = true` with "public callers ALWAYS get verified-only", so `false` means the
       * row exists and is reachable by nobody — it renders "Held" in the dashboard, never on the
       * site. The first run wrote 1,100 rows with `false` and /c/rentals showed "0 listings".
       * The buyer-facing trust signal is `Seller.verified`, a different column, which stays FALSE.
       */
      /**
       * ⛔ `images` IS CREATE-ONLY, AND THIS IS LOAD-BEARING. It used to sit in `mutable`, i.e. in the
       * UPDATE payload, so re-running this importer would have overwritten every re-hosted photo url
       * with a `photo.rever.vn` hotlink again — silently undoing `attach-rever-photos.ts` and taking
       * the eno.vn watermark with it, because the overlay only renders under `listings/affiliate/m/`.
       * A reviewer caught it here; the identical bug was caught on the Batdongsan importer days
       * earlier, which is why it is worth stating twice: a re-import refreshes PRICES and AVAILABILITY,
       * it does not own the pictures.
       * ⚠️ THE COST, STATED: a re-import can no longer REPAIR images either. A row whose photos are
       * still hotlinked or broken stays that way until `attach-rever-photos.ts` runs — that script
       * owns this column now, and it is the one to reach for, not a re-import.
       */
      create: { ...mutable, externalId, status: 'active', verified: true, images: JSON.stringify(images) },
      update: mutable,
      select: { id: true, createdAt: true, updatedAt: true },
    })
    if (res.createdAt.getTime() === res.updatedAt.getTime()) created++; else updated++
    if ((created + updated) % 200 === 0) console.log(`  ${created + updated}/${batch.length}`)
  }

  /**
   * ⛔ RETIRE ONLY WHAT THE SOURCE SAYS IS GONE — NEVER "everything not imported this run".
   * The first version hid every row missing from `seen`, but `seen` holds only rows that passed
   * ALL filters. So a run with `--year-min 2024` hid every 2023 row for good; a run where the
   * crawler's price regex broke hid the entire catalogue; and `status` is create-only, so none of
   * it could ever be undone. Retirement must be driven by a POSITIVE signal — the listing says
   * `Đã thuê`, or the page is 404/410 — not by absence, which conflates "let" with "we filtered
   * it out this time". A reviewer caught this.
   */
  const goneIds = new Set(
    src.filter((r) => {
      const s = status.get(r.url)
      return s && (s.rented === true || s.code === 404 || s.code === 410)
    }).map((r) => `rever:${r.id}`),
  )

  let retired = 0
  if (canRetire) {
    /** `'hidden'`, never `'sold'` — a sold row renders the sold page, which would tell buyers the
     *  property sold through us. It did not; it was let, elsewhere. Same reasoning the schema
     *  applies to takedowns.
     *  ⛔ ONE-WAY: `status` is create-only, so nothing here re-lists a row that comes back on the
     *  market. That is why this pass is behind `--retire`. Re-listing needs a marker that tells
     *  our `'hidden'` from a moderator's; until then, restoring is a manual decision. */
    const res = await db.listing.updateMany({
      where: { sellerId: SELLER_ID, status: 'active', externalId: { in: [...goneIds] } },
      data: { status: 'hidden' },
    })
    retired = res.count
  }

  const active = await db.listing.count({ where: { sellerId: SELLER_ID, status: 'active' } })
  console.log(`\ncreated ${created}   updated ${updated}   retired ${retired}   active now ${active}`)
  /**
   * ⛔ THE ROLLBACK IS A SOFT ONE, AND `DELETE` IS NOT SAFE TO PASTE. `Order` references `Listing`
   * with `onDelete: Restrict`, so a DELETE fails outright the moment any order points at a row;
   * and six other relations are `onDelete: Cascade`, so it would also take saves, views and
   * conversation rows with it. Hiding is immediate, total and reversible — it is what "undo this
   * import" actually means here.
   */
  console.log(`\nROLLBACK (safe, reversible — removes them from every public surface):`)
  console.log(`  UPDATE "Listing" SET status = 'hidden' WHERE "sellerId" = '${SELLER_ID}';`)
  console.log(`  -- hard delete is NOT paste-safe: Order is onDelete:Restrict and six relations Cascade.`)
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
