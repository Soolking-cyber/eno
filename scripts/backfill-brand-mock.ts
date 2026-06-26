import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// ─────────────────────────────────────────────────────────────────────────────
// BACKFILL BRAND MOCK — non-destructive. Assigns brandSlug + model to EXISTING mock
// listings (picsum/loremflickr images) in brand categories that don't have a brand
// yet, so the brand rail + model chips render without a full reseed (prisma/seed.ts
// wipes everything). Upserts the Brand rows (logos) + refreshes listingCount.
//
// Run: set -a; . ./.env; set +a; npx tsx scripts/backfill-brand-mock.ts
// ─────────────────────────────────────────────────────────────────────────────

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
const db = new PrismaClient({ adapter, log: ['warn', 'error'] })

const CATALOG: Record<string, { name: string; icon: string; models: string[] }[]> = {
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

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const isMock = (images: string) => images.includes('picsum') || images.includes('loremflickr') || images.includes('placehold')

async function main() {
  let touched = 0
  const allSlugs = new Set<string>()
  for (const [catSlug, brands] of Object.entries(CATALOG)) {
    const category = await db.category.findUnique({ where: { slug: catSlug }, select: { id: true } })
    if (!category) { console.warn(`category ${catSlug} missing, skip`); continue }

    // Upsert the brand rows (logos + catalogue).
    for (const b of brands) {
      const slug = slugify(b.name); allSlugs.add(slug)
      await db.brand.upsert({
        where: { normalized: norm(b.name) },
        update: { iconSlug: b.icon || null },
        create: { slug, name: b.name, normalized: norm(b.name), iconSlug: b.icon || null, aliases: '[]', status: 'active' },
      })
    }

    // Assign a brand + model to brand-less MOCK listings (sell/rent only).
    const rows = await db.listing.findMany({
      where: { categoryId: category.id, brandSlug: null, listingType: { in: ['sell', 'rent'] } },
      select: { id: true, images: true, searchText: true },
    })
    let i = 0
    for (const l of rows) {
      if (!isMock(l.images)) continue
      const b = brands[i % brands.length]
      const model = b.models[i % b.models.length]
      const slug = slugify(b.name)
      await db.listing.update({
        where: { id: l.id },
        data: { brandSlug: slug, model, searchText: `${l.searchText} ${b.name} ${model}`.toLowerCase().slice(0, 1000) },
      })
      i++; touched++
    }
    console.log(`  ${catSlug.padEnd(22)} branded ${i} listings`)
  }

  // Refresh directory counts.
  for (const slug of allSlugs) {
    const cnt = await db.listing.count({ where: { brandSlug: slug, verified: true, status: 'active' } })
    await db.brand.update({ where: { slug }, data: { listingCount: cnt } }).catch(() => {})
  }
  console.log(`\nDone. Branded ${touched} mock listings across ${Object.keys(CATALOG).length} categories.`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
