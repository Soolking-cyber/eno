import { PrismaClient, type Prisma } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { TAXONOMY, categoryHasBrand, type CategoryDef, type ListingType } from '../src/lib/taxonomy'
import { buildSearchText } from '../src/lib/fold'

// ─────────────────────────────────────────────────────────────────────────────
// MOCK SEED — builds the full taxonomy (15 categories) and HUNDREDS of mock
// listings per category for end-to-end testing of the new categories, the
// subcategory column, the listingType (intent) axis, facets, map, and search.
//
// ⚠️  THIS IS TEST DATA. Before launch: run `MOCK_PER_CATEGORY=0` (or delete the
//    generated rows) and remove the loremflickr/picsum hosts from next.config.
//
// Run: set -a; . ./.env; set +a; npx tsx prisma/seed.ts
//   • MOCK_PER_CATEGORY (default 180) — listings generated per category.
// ─────────────────────────────────────────────────────────────────────────────

// Seed writes go over the DIRECT connection (bulk inserts, not the txn pooler).
const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
const db = new PrismaClient({ adapter, log: ['warn', 'error'] })

const PER_CAT = Number(process.env.MOCK_PER_CATEGORY ?? 180)

const day = 24 * 60 * 60 * 1000
const now = Date.now()
const agoDays = (d: number) => new Date(now - d * day)

// Deterministic-enough PRNG so reseeds look stable-ish (seeded by index).
function rng(seed: number) {
  let s = seed % 2147483647
  if (s <= 0) s += 2147483646
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}
const pick = <T,>(arr: T[], r: number) => arr[Math.floor(r * arr.length) % arr.length]
const between = (min: number, max: number, r: number) => Math.round(min + (max - min) * r)
// Round to a "nice" VND figure for readability.
const niceVnd = (n: number) => {
  if (n >= 10_000_000) return Math.round(n / 1_000_000) * 1_000_000
  if (n >= 1_000_000) return Math.round(n / 100_000) * 100_000
  if (n >= 100_000) return Math.round(n / 10_000) * 10_000
  return Math.round(n / 1000) * 1000
}

// Expat-relevant areas across the three big cities, with rough coordinates so the
// map view + "near you" have something to render.
const AREAS = [
  { district: 'District 1', location: 'Ben Nghe, District 1', city: 'Ho Chi Minh City', lat: 10.7769, lng: 106.7009 },
  { district: 'District 2', location: 'Thao Dien, District 2', city: 'Ho Chi Minh City', lat: 10.8038, lng: 106.7407 },
  { district: 'District 3', location: 'Vo Thi Sau, District 3', city: 'Ho Chi Minh City', lat: 10.7798, lng: 106.6841 },
  { district: 'District 4', location: 'District 4', city: 'Ho Chi Minh City', lat: 10.7578, lng: 106.7012 },
  { district: 'District 7', location: 'Phu My Hung, District 7', city: 'Ho Chi Minh City', lat: 10.7340, lng: 106.7215 },
  { district: 'Binh Thanh', location: 'Binh Thanh District', city: 'Ho Chi Minh City', lat: 10.8106, lng: 106.7091 },
  { district: 'Phu Nhuan', location: 'Phu Nhuan District', city: 'Ho Chi Minh City', lat: 10.7959, lng: 106.6800 },
  { district: 'Tay Ho', location: 'Tay Ho, Hanoi', city: 'Hanoi', lat: 21.0717, lng: 105.8230 },
  { district: 'Hoan Kiem', location: 'Hoan Kiem, Hanoi', city: 'Hanoi', lat: 21.0285, lng: 105.8542 },
  { district: 'Cau Giay', location: 'Cau Giay, Hanoi', city: 'Hanoi', lat: 21.0309, lng: 105.7967 },
  { district: 'Da Nang', location: 'My Khe, Da Nang', city: 'Da Nang', lat: 16.0544, lng: 108.2466 },
  { district: 'Da Nang', location: 'An Thuong, Da Nang', city: 'Da Nang', lat: 16.0470, lng: 108.2480 },
]

const COND_VALUES = ['New', 'Like new', 'Good', 'Used']
const ADJ = ['Great', 'Clean', 'Barely used', 'Quality', 'Reliable', 'Modern', 'Spacious', 'Cozy', 'Premium', 'Affordable']

// Per-category brand catalogue for mock data — sets Listing.brandSlug + model so the
// brand rail + model chips have real data to show. `icon` = simple-icons slug for the
// logo (empty/missing → monogram fallback, harmless). Brand-relevant categories only.
const BRAND_CATALOG: Record<string, { name: string; icon: string; models: string[] }[]> = {
  vehicles: [
    { name: 'Honda', icon: 'honda', models: ['Wave Alpha', 'Vision', 'Air Blade', 'SH 150i', 'Winner X'] },
    { name: 'Yamaha', icon: 'yamahamotorcorporation', models: ['Exciter 155', 'Sirius', 'Janus', 'Grande', 'NVX'] },
    { name: 'Suzuki', icon: 'suzuki', models: ['Raider', 'Address'] },
    { name: 'Vespa', icon: 'vespa', models: ['Primavera', 'Sprint', 'GTS'] },
    { name: 'Toyota', icon: 'toyota', models: ['Vios', 'Corolla Cross', 'Camry', 'Fortuner'] },
    { name: 'Mazda', icon: 'mazda', models: ['Mazda 3', 'CX-5'] },
    { name: 'Kia', icon: 'kia', models: ['Morning', 'Seltos', 'Sorento'] },
    { name: 'VinFast', icon: '', models: ['Klara S', 'Theon', 'VF e34'] },
  ],
  rentals: [
    { name: 'Honda', icon: 'honda', models: ['Vision', 'Air Blade', 'Wave Alpha', 'PCX'] },
    { name: 'Yamaha', icon: 'yamahamotorcorporation', models: ['Janus', 'Grande', 'NVX'] },
    { name: 'Vespa', icon: 'vespa', models: ['Primavera', 'Sprint'] },
    { name: 'Toyota', icon: 'toyota', models: ['Vios', 'Innova'] },
    { name: 'VinFast', icon: '', models: ['Klara S', 'VF e34'] },
  ],
  electronics: [
    { name: 'Apple', icon: 'apple', models: ['iPhone 15 Pro', 'iPhone 14', 'MacBook Air M2', 'iPad Air', 'AirPods Pro'] },
    { name: 'Samsung', icon: 'samsung', models: ['Galaxy S24', 'Galaxy A55', 'Galaxy Tab S9'] },
    { name: 'Xiaomi', icon: 'xiaomi', models: ['Redmi Note 13', 'Mi 13', 'Pad 6'] },
    { name: 'Sony', icon: 'sony', models: ['WH-1000XM5', 'Alpha A7 IV', 'PlayStation 5'] },
    { name: 'Dell', icon: 'dell', models: ['XPS 13', 'Latitude 5440'] },
    { name: 'Asus', icon: 'asus', models: ['ZenBook 14', 'ROG Strix'] },
  ],
  'fashion-beauty': [
    { name: 'Nike', icon: 'nike', models: ['Air Force 1', 'Air Max', 'Dunk Low'] },
    { name: 'Adidas', icon: 'adidas', models: ['Ultraboost', 'Samba', 'Stan Smith'] },
    { name: 'Uniqlo', icon: 'uniqlo', models: ['Ultra Light Down', 'Airism'] },
    { name: 'Zara', icon: 'zara', models: ['Blazer', 'Linen Dress'] },
    { name: 'Louis Vuitton', icon: 'louisvuitton', models: ['Neverfull', 'Speedy'] },
  ],
  'furniture-appliances': [
    { name: 'IKEA', icon: 'ikea', models: ['MALM', 'BILLY', 'POÄNG'] },
    { name: 'Samsung', icon: 'samsung', models: ['Inverter Fridge', 'WindFree AC'] },
    { name: 'LG', icon: 'lg', models: ['InstaView Fridge', 'Dual Inverter AC'] },
    { name: 'Panasonic', icon: 'panasonic', models: ['Inverter Fridge', 'Nanoe AC'] },
    { name: 'Electrolux', icon: 'electrolux', models: ['UltimateCare Washer'] },
  ],
  'baby-kids': [
    { name: 'Chicco', icon: '', models: ['Bravo Stroller', 'KeyFit Car Seat'] },
    { name: 'Combi', icon: '', models: ['Sugocal Stroller'] },
    { name: 'Fisher-Price', icon: 'fisher-price', models: ['Deluxe Kick Play', 'Jumperoo'] },
    { name: 'Pigeon', icon: '', models: ['SofTouch Bottle'] },
  ],
  'hobbies-sports': [
    { name: 'Nike', icon: 'nike', models: ['Pegasus', 'Mercurial'] },
    { name: 'Adidas', icon: 'adidas', models: ['Predator', 'Adizero'] },
    { name: 'Decathlon', icon: 'decathlon', models: ['Rockrider', 'Quechua Tent'] },
    { name: 'Yonex', icon: 'yonex', models: ['Astrox 88', 'Nanoflare'] },
    { name: 'Specialized', icon: '', models: ['Rockhopper', 'Allez'] },
  ],
}
const brandNorm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
const brandSlugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// Per-listing-type price model (VND). [min, max] of the BASE figure.
function priceModel(cat: CategoryDef, type: ListingType, r: number): { price: number; priceUnit: string } {
  if (type === 'free') return { price: 0, priceUnit: 'VND' }
  if (type === 'wanted') return { price: 0, priceUnit: 'VND' }
  if (type === 'event') return { price: between(0, 300_000, r) === 0 ? 0 : niceVnd(between(50_000, 300_000, r)), priceUnit: 'VND' }
  if (type === 'job') return { price: niceVnd(between(8_000_000, 60_000_000, r)), priceUnit: 'VND/month' }
  if (type === 'service') return { price: niceVnd(between(150_000, 5_000_000, r)), priceUnit: 'VND/service (from)' }
  if (type === 'rent') {
    if (cat.slug === 'property') return { price: niceVnd(between(6_000_000, 45_000_000, r)), priceUnit: 'VND/month' }
    if (cat.slug === 'vehicles') return { price: niceVnd(between(800_000, 4_000_000, r)), priceUnit: 'VND/month' }
    // Rentals span cheap daily bikes → monthly cars, serviced stays & home leases.
    if (cat.slug === 'rentals') return { price: niceVnd(between(700_000, 22_000_000, r)), priceUnit: 'VND/month' }
    return { price: niceVnd(between(500_000, 5_000_000, r)), priceUnit: 'VND/month' }
  }
  // sell
  const sellRanges: Record<string, [number, number]> = {
    vehicles: [8_000_000, 70_000_000],
    property: [1_500_000_000, 9_000_000_000],
    'moving-sale': [200_000, 8_000_000],
    'furniture-appliances': [300_000, 9_000_000],
    electronics: [500_000, 45_000_000],
    'fashion-beauty': [100_000, 6_000_000],
    'baby-kids': [100_000, 5_000_000],
    'hobbies-sports': [100_000, 18_000_000],
    pets: [500_000, 15_000_000],
    'tickets-travel': [100_000, 5_000_000],
    'food-drink': [40_000, 1_500_000],
  }
  const [lo, hi] = sellRanges[cat.slug] ?? [100_000, 5_000_000]
  return { price: niceVnd(between(lo, hi, r)), priceUnit: 'VND' }
}

// Mock photo (removed at launch). picsum.photos is reliable under the next/image
// optimizer's concurrent load (loremflickr rate-limited and broke); the seed makes
// each image stable + varied per listing.
function images(_keyword: string, seed: number, count: number): string {
  const urls = Array.from({ length: count }, (_, i) =>
    `https://picsum.photos/seed/eno${seed * 10 + i}/600/450`,
  )
  return JSON.stringify(urls)
}

function titleFor(cat: CategoryDef, subName: string, type: ListingType, area: string, adj: string): string {
  switch (type) {
    case 'rent': return `${subName} for rent — ${area}`
    case 'wanted': return `Wanted: ${subName} in ${area}`
    case 'free': return `Free ${subName} — ${area} (giveaway)`
    case 'service': return `${subName} — service in ${area}`
    case 'job': return `${subName} — hiring in ${area}`
    case 'event': return `${subName} — ${area}`
    default: return `${adj} ${subName} — ${area}`
  }
}

function titleViFor(subVi: string, type: ListingType, area: string): string {
  switch (type) {
    case 'rent': return `${subVi} cho thuê — ${area}`
    case 'wanted': return `Cần mua: ${subVi} tại ${area}`
    case 'free': return `Cho tặng ${subVi} — ${area}`
    case 'service': return `${subVi} — dịch vụ tại ${area}`
    case 'job': return `${subVi} — tuyển dụng ${area}`
    case 'event': return `${subVi} — ${area}`
    default: return `${subVi} — ${area}`
  }
}

// Weight the listing types so the primary intent dominates (first in cat.types).
function pickType(types: ListingType[], r: number): ListingType {
  if (types.length === 1) return types[0]
  // 60% primary, rest spread across the others.
  if (r < 0.6) return types[0]
  const rest = types.slice(1)
  return rest[Math.floor(((r - 0.6) / 0.4) * rest.length) % rest.length]
}

async function main() {
  console.log(`Seeding ENO — taxonomy + ${PER_CAT} mock listings/category…`)

  // Clean wipe (fresh slugs, no migration — mock data is disposable). Delete in
  // FK order: reviews reference sellers without cascade, so they go first;
  // listings cascade their conversations/reports/contact-reveals.
  await db.review.deleteMany({})
  await db.listing.deleteMany({})
  await db.seller.deleteMany({})
  await db.category.deleteMany({})

  // ---------- Categories (from the canonical taxonomy) ----------
  const catRows = await db.$transaction(
    TAXONOMY.map((c) =>
      db.category.upsert({
        where: { slug: c.slug },
        update: { name: c.name, nameVi: c.nameVi, icon: c.icon, color: c.color, description: c.description },
        create: { name: c.name, nameVi: c.nameVi, slug: c.slug, icon: c.icon, color: c.color, description: c.description },
      }),
    ),
  )
  const catIdBySlug = new Map(catRows.map((c) => [c.slug, c.id]))

  // ---------- Brands (catalogue + per-category map for the brand rail) ----------
  const uniqBrands = new Map<string, { slug: string; name: string; icon: string }>()
  for (const list of Object.values(BRAND_CATALOG)) {
    for (const b of list) {
      const n = brandNorm(b.name)
      if (!uniqBrands.has(n)) uniqBrands.set(n, { slug: brandSlugify(b.name), name: b.name, icon: b.icon })
    }
  }
  await db.$transaction(
    [...uniqBrands.values()].map((b) =>
      db.brand.upsert({
        where: { normalized: brandNorm(b.name) },
        update: { iconSlug: b.icon || null },
        create: { slug: b.slug, name: b.name, normalized: brandNorm(b.name), iconSlug: b.icon || null, aliases: '[]', status: 'active' },
      }),
    ),
  )
  // Per-category brands with resolved canonical slugs (assigned to listings below).
  const catBrands = new Map(
    Object.entries(BRAND_CATALOG).map(([cat, list]) => [cat, list.map((b) => ({ slug: brandSlugify(b.name), name: b.name, models: b.models }))]),
  )
  void categoryHasBrand // (taxonomy gate is mirrored by catBrands presence)

  // ---------- Sellers ----------
  const sellerSeeds = [
    { id: 'seller-minh', name: 'Minh Nguyễn', color: '#375efb', rating: 4.9, reviews: 47, loc: 'Thao Dien, District 2', tier: 'trusted', score: 120 },
    { id: 'seller-linh', name: 'Linh Phạm', color: '#26356d', rating: 5.0, reviews: 38, loc: 'Phu My Hung, District 7', tier: 'exceptional', score: 135 },
    { id: 'seller-david', name: 'David Trần', color: '#4285f4', rating: 4.8, reviews: 22, loc: 'Binh Thanh District', tier: 'trusted', score: 110 },
    { id: 'seller-huong', name: 'Hương Lê', color: '#0ea5e9', rating: 4.9, reviews: 15, loc: 'Da Nang', tier: 'trusted', score: 105 },
    { id: 'seller-sarah', name: 'Sarah Nguyen', color: '#6366f1', rating: 5.0, reviews: 31, loc: 'Thao Dien, District 2', tier: 'exceptional', score: 128 },
    { id: 'seller-quang', name: 'Quang Trần', color: '#8b5cf6', rating: 4.7, reviews: 19, loc: 'Hoan Kiem, Hanoi', tier: 'standard', score: 98 },
    { id: 'seller-mai', name: 'Mai Hoàng', color: '#06b6d4', rating: 4.8, reviews: 12, loc: 'District 4', tier: 'trusted', score: 102 },
    { id: 'seller-james', name: 'James Carter', color: '#f59e0b', rating: 4.6, reviews: 9, loc: 'Tay Ho, Hanoi', tier: 'standard', score: 96 },
    { id: 'seller-trang', name: 'Trang Vũ', color: '#10b981', rating: 4.9, reviews: 26, loc: 'District 3', tier: 'trusted', score: 108 },
    { id: 'seller-tuan', name: 'Tuấn Đoàn', color: '#64748b', rating: 4.2, reviews: 4, loc: 'District 1', tier: 'standard', score: 88 },
  ]
  await db.$transaction(
    sellerSeeds.map((s) =>
      db.seller.upsert({
        where: { id: s.id },
        update: {},
        create: {
          id: s.id,
          name: s.name,
          avatarColor: s.color,
          rating: s.rating,
          reviewCount: s.reviews,
          verified: true,
          verifiedSeller: true,
          trustTier: s.tier,
          trustScore: s.score,
          memberSince: new Date('2022-01-01'),
          responseRate: between(88, 100, Math.random()),
          responseTime: 'within a few hours',
          location: s.loc,
          bio: `${s.name} — verified ENO seller.`,
        },
      }),
    ),
  )
  const sellerIds = sellerSeeds.map((s) => s.id)

  // ---------- Mock listings ----------
  const rows: Prisma.ListingCreateManyInput[] = []
  let globalIdx = 0

  for (const cat of TAXONOMY) {
    const categoryId = catIdBySlug.get(cat.slug)!
    const subs = cat.subcategories
    for (let i = 0; i < PER_CAT; i++) {
      globalIdx++
      const r = rng(globalIdx * 7 + 13)
      const sub = subs[i % subs.length]
      const type = pickType(cat.types, r())
      const area = AREAS[Math.floor(r() * AREAS.length)]
      const adj = pick(ADJ, r())
      const { price, priceUnit } = priceModel(cat, type, r())

      // Attributes drawn from the category's facet options so facet filters hit data.
      const attributes: Record<string, unknown> = {}
      for (const f of cat.facets) {
        if (f.options.length && r() > 0.25) {
          attributes[f.key] = pick(f.options, r()).value
        }
      }
      const condition = cat.facets.some((f) => f.key === 'condition')
        ? pick(COND_VALUES, r())
        : null

      let title = titleFor(cat, sub.name, type, area.district, adj)
      const titleVi = titleViFor(sub.nameVi, type, area.district)
      // Brand + model for brand-relevant product categories → powers the brand rail.
      let brandSlug: string | null = null
      let model: string | null = null
      const catBrandList = catBrands.get(cat.slug)
      if (catBrandList && catBrandList.length && (type === 'sell' || type === 'rent')) {
        const br = catBrandList[Math.floor(r() * catBrandList.length) % catBrandList.length]
        model = pick(br.models, r())
        brandSlug = br.slug
        title = type === 'rent' ? `${br.name} ${model} for rent — ${area.district}` : `${adj} ${br.name} ${model} — ${area.district}`
      }
      const description =
        `${adj} ${sub.name.toLowerCase()} in ${area.location}. ` +
        `${type === 'rent' ? 'Available now for monthly rental. ' : type === 'free' ? 'Free to a good home, pickup only. ' : type === 'wanted' ? 'Looking for this — reasonable condition, fair price. ' : ''}` +
        `Message in-app to arrange. Sample mock listing for testing the ${cat.name} category.`

      const verified = r() > 0.05 // ~5% held/unverified to exercise that filter
      const daysAgo = Math.floor(r() * 60)
      const imgCount = 1 + Math.floor(r() * 3)

      rows.push({
        title,
        titleVi,
        description,
        price,
        priceUnit,
        currency: '₫',
        negotiable: r() > 0.5 && type !== 'job',
        location: area.location,
        district: area.district,
        city: area.city,
        lat: area.lat + (r() - 0.5) * 0.02,
        lng: area.lng + (r() - 0.5) * 0.02,
        condition,
        images: images(sub.keywords[0] || cat.slug, globalIdx, imgCount),
        categoryId,
        subcategorySlug: sub.slug,
        listingType: type,
        brandSlug,
        model,
        sellerId: sellerIds[Math.floor(r() * sellerIds.length)],
        verified,
        status: 'active',
        searchText: buildSearchText([title, titleVi, description, area.location, cat.name, sub.name, sub.nameVi, brandSlug || '', model || '']),
        postedAt: agoDays(daysAgo),
        availabilityConfirmedAt: agoDays(daysAgo),
        views: Math.floor(r() * 2500),
        savedCount: Math.floor(r() * 200),
        featured: r() > 0.95,
        contactCount: Math.floor(r() * 40),
        attributes: Object.keys(attributes).length ? JSON.stringify(attributes) : null,
      })
    }
  }

  // Batched insert (createMany is far faster than per-row create).
  const BATCH = 500
  for (let i = 0; i < rows.length; i += BATCH) {
    await db.listing.createMany({ data: rows.slice(i, i + BATCH) })
    console.log(`  inserted ${Math.min(i + BATCH, rows.length)}/${rows.length}`)
  }

  // Brand directory counts (ranks /brands + powers the brand rail order).
  for (const b of uniqBrands.values()) {
    const slug = brandSlugify(b.name)
    const cnt = await db.listing.count({ where: { brandSlug: slug, verified: true, status: 'active' } })
    await db.brand.update({ where: { slug }, data: { listingCount: cnt } }).catch(() => {})
  }

  // Sync the denormalized ranking key from the seeded seller scores so a fresh seed
  // ranks identically to production (the feed sorts on Listing.sellerTrustScore, a
  // local column — see src/lib/trust.ts for the live dual-write).
  await db.$executeRawUnsafe(`UPDATE "Listing" l SET "sellerTrustScore" = s."trustScore" FROM "Seller" s WHERE l."sellerId" = s.id`)

  console.log(`Done. ${TAXONOMY.length} categories, ${uniqBrands.size} brands, ${sellerSeeds.length} sellers, ${rows.length} listings.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
