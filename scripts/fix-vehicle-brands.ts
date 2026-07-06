import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { buildSearchText } from '../src/lib/fold'

// ─────────────────────────────────────────────────────────────────────────────
// FIX VEHICLE BRAND/MODEL COHERENCE — the mock seeder assigned random vehicle
// brands+models to listings regardless of subcategory, so Bicycle listings
// carry Toyota and a "Vision" scooter sits under Car. Now that the brand rail
// scopes by subcategory (2026-07-06), that dirt is visible. This reassigns a
// coherent (brand, model) per subcategory, deterministically per listing id,
// rebuilds searchText (it embeds brand+model), creates any missing Brand rows,
// and recomputes Brand.listingCount. Non-destructive outside vehicles.
//
// Run: set -a; . ./.env; set +a; npx tsx scripts/fix-vehicle-brands.ts
// After: re-run vertex backfill (search docs embed brand/model).
// ─────────────────────────────────────────────────────────────────────────────

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
const db = new PrismaClient({ adapter, log: ['warn', 'error'] })

type Pool = { brand: string; slug: string; models: string[] }[]

const POOLS: Record<string, Pool> = {
  bicycle: [
    { brand: 'Giant', slug: 'giant', models: ['Escape 3', 'ATX 27.5', 'Talon 3'] },
    { brand: 'Trek', slug: 'trek', models: ['Marlin 5', 'FX 2', 'Domane AL 2'] },
    { brand: 'Merida', slug: 'merida', models: ['Crossway 100', 'Scultura 200'] },
    { brand: 'Specialized', slug: 'specialized', models: ['Sirrus X', 'Rockhopper'] },
  ],
  'ebike-scooter': [
    { brand: 'VinFast', slug: 'vinfast', models: ['Evo 200', 'Klara S', 'Feliz S'] },
    { brand: 'Yadea', slug: 'yadea', models: ['G5', 'Odora', 'Voltguard'] },
    { brand: 'Pega', slug: 'pega', models: ['Aura', 'NewTech'] },
    { brand: 'Dat Bike', slug: 'dat-bike', models: ['Weaver 200', 'Quantum'] },
  ],
  motorbike: [
    { brand: 'Honda', slug: 'honda', models: ['Wave Alpha', 'Vision', 'Air Blade', 'Winner X', 'SH 150i'] },
    { brand: 'Yamaha', slug: 'yamaha', models: ['Exciter 155', 'Sirius', 'Janus', 'Grande'] },
    { brand: 'Suzuki', slug: 'suzuki', models: ['Raider R150', 'GSX-R150'] },
    { brand: 'Vespa', slug: 'vespa', models: ['Sprint 125', 'Primavera 125'] },
    { brand: 'Triumph', slug: 'triumph', models: ['Trident 660'] },
  ],
  car: [
    { brand: 'Toyota', slug: 'toyota', models: ['Vios', 'Camry', 'Fortuner', 'Corolla Cross'] },
    { brand: 'Mazda', slug: 'mazda', models: ['Mazda 3', 'CX-5', 'CX-8'] },
    { brand: 'Kia', slug: 'kia', models: ['Morning', 'Cerato', 'Seltos', 'Sonet'] },
    { brand: 'VinFast', slug: 'vinfast', models: ['VF 8', 'VF e34', 'Fadil'] },
    { brand: 'Honda', slug: 'honda', models: ['City', 'CR-V', 'Civic'] },
    { brand: 'BMW', slug: 'bmw', models: ['320i', 'X3'] },
  ],
}

// Deterministic per-id pick so re-runs are idempotent.
function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

async function main() {
  // 1) Ensure every pool brand exists in the catalogue.
  const allPool = Object.values(POOLS).flat()
  const bySlug = new Map(allPool.map((b) => [b.slug, b]))
  for (const b of bySlug.values()) {
    await db.brand.upsert({
      where: { slug: b.slug },
      update: {},
      create: { slug: b.slug, name: b.brand, normalized: normalize(b.brand), aliases: '[]' },
    })
  }

  // 2) Reassign brand+model per vehicles listing, coherent with its subcategory.
  const listings = await db.listing.findMany({
    where: { category: { slug: 'vehicles' }, subcategorySlug: { in: Object.keys(POOLS) } },
    select: {
      id: true, title: true, description: true, district: true, subcategorySlug: true,
      brandSlug: true, model: true, category: { select: { name: true, nameVi: true } },
    },
  })

  let changed = 0
  for (const l of listings) {
    const pool = POOLS[l.subcategorySlug as string]
    const pick = pool[hash(l.id) % pool.length]
    const model = pick.models[hash(l.id + 'm') % pick.models.length]
    if (l.brandSlug === pick.slug && l.model === model) continue
    await db.listing.update({
      where: { id: l.id },
      data: {
        brandSlug: pick.slug,
        model,
        searchText: buildSearchText([l.title, l.description, l.district, l.category.name, l.category.nameVi, pick.slug, model]),
      },
    })
    changed++
  }

  // 3) Recompute listingCount for every brand we may have touched.
  const affected = new Set<string>([...bySlug.keys()])
  for (const l of listings) if (l.brandSlug) affected.add(l.brandSlug)
  for (const slug of affected) {
    const count = await db.listing.count({ where: { brandSlug: slug, verified: true, status: 'active' } })
    await db.brand.update({ where: { slug }, data: { listingCount: count } }).catch(() => {})
  }

  console.log(`Reassigned ${changed}/${listings.length} vehicle listings; ${affected.size} brand counts recomputed.`)
  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
