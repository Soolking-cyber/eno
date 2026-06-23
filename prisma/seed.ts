import { PrismaClient, type Prisma } from '@prisma/client'
import { TAXONOMY, type CategoryDef, type ListingType } from '../src/lib/taxonomy'
import { buildSearchText } from '../src/lib/fold'

// ─────────────────────────────────────────────────────────────────────────────
// MOCK SEED — builds the full taxonomy (14 categories) and HUNDREDS of mock
// listings per category for end-to-end testing of the new categories, the
// subcategory column, the listingType (intent) axis, facets, map, and search.
//
// ⚠️  THIS IS TEST DATA. Before launch: run `MOCK_PER_CATEGORY=0` (or delete the
//    generated rows) and remove the loremflickr/picsum hosts from next.config.
//
// Run: set -a; . ./.env; set +a; npx tsx prisma/seed.ts
//   • MOCK_PER_CATEGORY (default 180) — listings generated per category.
// ─────────────────────────────────────────────────────────────────────────────

const db = new PrismaClient({ log: ['warn', 'error'] })

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

// Themed mock photo (removed at launch). loremflickr returns a keyword-matched
// image; ?lock makes it stable per listing.
function images(keyword: string, seed: number, count: number): string {
  const kw = encodeURIComponent(keyword.replace(/\s+/g, ','))
  const urls = Array.from({ length: count }, (_, i) =>
    `https://loremflickr.com/600/450/${kw}?lock=${seed * 10 + i}`,
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

      const title = titleFor(cat, sub.name, type, area.district, adj)
      const titleVi = titleViFor(sub.nameVi, type, area.district)
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
        sellerId: sellerIds[Math.floor(r() * sellerIds.length)],
        verified,
        status: 'active',
        searchText: buildSearchText([title, titleVi, description, area.location, cat.name, sub.name, sub.nameVi]),
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

  console.log(`Done. ${TAXONOMY.length} categories, ${sellerSeeds.length} sellers, ${rows.length} listings.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
