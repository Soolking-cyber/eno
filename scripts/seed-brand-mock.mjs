// Mock data to CHECK the brand rail + model expansion on the search page.
// Creates a few brands + live listings (brandSlug + model) in Electronics and
// Vehicles, attached to existing mock sellers. Every listing carries the standard
// mock marker so scripts/purge-mock.mjs removes them all before launch.
//
// Run AFTER the `model` column migration:
//   cd ~/eno.vn && set -a; . ./.env; set +a && node scripts/seed-brand-mock.mjs
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const MARKER = 'Sample mock listing for testing'

const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// brand display name → simple-icons slug (wrong/missing → monogram fallback, harmless)
const CATALOG = {
  electronics: [
    { name: 'Apple', icon: 'apple', models: ['iPhone 14 Pro', 'iPhone 13', 'MacBook Air M2', 'iPad Air'] },
    { name: 'Samsung', icon: 'samsung', models: ['Galaxy S23', 'Galaxy A54', 'Galaxy Tab S9'] },
    { name: 'Huawei', icon: 'huawei', models: ['Watch GT 4', 'MatePad 11', 'FreeBuds Pro'] },
    { name: 'Sony', icon: 'sony', models: ['WH-1000XM5', 'Alpha A7 IV'] },
    { name: 'Dell', icon: 'dell', models: ['XPS 13', 'Latitude 5440'] },
  ],
  vehicles: [
    { name: 'Honda', icon: 'honda', models: ['Wave Alpha', 'SH 150i', 'Vision', 'Air Blade'] },
    { name: 'Yamaha', icon: 'yamahamotorcorporation', models: ['Exciter 155', 'Janus', 'Grande'] },
    { name: 'Kia', icon: 'kia', models: ['Morning', 'Cerato', 'Sorento', 'Seltos'] },
    { name: 'Toyota', icon: 'toyota', models: ['Vios', 'Corolla Cross', 'Camry'] },
  ],
}

const LOCS = ['Thao Dien, District 2', 'Phu My Hung, District 7', 'Binh Thanh District', 'Da Nang', 'Hoan Kiem, Hanoi']

const main = async () => {
  const sellers = await db.seller.findMany({ where: { id: { startsWith: 'seller-' } }, select: { id: true } })
  if (sellers.length === 0) { console.error('No mock sellers (seller-*) found. Run the base seed first.'); process.exit(1) }

  let madeBrands = 0, madeListings = 0
  for (const [catSlug, brands] of Object.entries(CATALOG)) {
    const category = await db.category.findUnique({ where: { slug: catSlug }, select: { id: true, name: true, nameVi: true } })
    if (!category) { console.warn(`category ${catSlug} missing, skipping`); continue }

    for (const b of brands) {
      const norm = normalize(b.name)
      const slug = slugify(b.name)
      const brand = await db.brand.upsert({
        where: { normalized: norm },
        update: { iconSlug: b.icon },
        create: { slug, name: b.name, normalized: norm, iconSlug: b.icon, aliases: '[]', status: 'active' },
        select: { slug: true },
      })
      madeBrands++

      let n = 0
      for (const model of b.models) {
        // 1–3 listings per model so counts look real
        const copies = 1 + (model.length % 3)
        for (let i = 0; i < copies; i++) {
          const seller = sellers[(madeListings) % sellers.length]
          const loc = LOCS[madeListings % LOCS.length]
          const price = catSlug === 'vehicles' ? (15 + (madeListings % 60)) * 1_000_000 : (2 + (madeListings % 30)) * 1_000_000
          const title = `${b.name} ${model}`
          await db.listing.create({
            data: {
              title,
              description: `${MARKER} — ${title} in good condition.`,
              price,
              priceUnit: 'VND',
              currency: '₫',
              location: loc,
              district: loc,
              city: loc.includes('Hanoi') ? 'Hanoi' : loc.includes('Da Nang') ? 'Da Nang' : 'Ho Chi Minh City',
              condition: i % 2 === 0 ? 'used' : 'new',
              images: JSON.stringify([`https://picsum.photos/seed/${slug}-${n}-${i}/800/600`]),
              searchText: `${title} ${b.name} ${model} ${category.name} ${loc}`.toLowerCase(),
              categoryId: category.id,
              listingType: 'sell',
              brandSlug: brand.slug,
              model,
              sellerId: seller.id,
              verified: true,
              status: 'active',
            },
          })
          madeListings++; n++
        }
      }
      // Refresh the brand's listingCount (directory ranking).
      const cnt = await db.listing.count({ where: { brandSlug: brand.slug, verified: true, status: 'active' } })
      await db.brand.update({ where: { slug: brand.slug }, data: { listingCount: cnt } })
    }
  }

  console.log(`✓ Seeded ${madeBrands} brands, ${madeListings} mock listings (Electronics + Vehicles).`)
  console.log('  Open the homepage → Electronics or Vehicles → the brand rail + model chips should show.')
  console.log('  Run scripts/purge-mock.mjs to remove all of this before launch.')
  await db.$disconnect()
}

main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1) })
