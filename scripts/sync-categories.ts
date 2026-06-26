import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { TAXONOMY } from '../src/lib/taxonomy'

// ─────────────────────────────────────────────────────────────────────────────
// SYNC CATEGORIES — non-destructive. Upserts the Category rows from the canonical
// taxonomy (name/nameVi/icon/color/description) WITHOUT touching listings, sellers
// or anything else. Unlike prisma/seed.ts (which wipes + regenerates mock data),
// this is safe to run against production after editing src/lib/taxonomy.ts to add
// or rename a category (e.g. the new "Rentals" category).
//
// It never deletes categories — a slug removed from the taxonomy is left in place
// (its listings keep resolving); remove such rows by hand only once they're empty.
//
// Run: set -a; . ./.env; set +a; npx tsx scripts/sync-categories.ts
// ─────────────────────────────────────────────────────────────────────────────

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
const db = new PrismaClient({ adapter, log: ['warn', 'error'] })

async function main() {
  const existing = new Set((await db.category.findMany({ select: { slug: true } })).map((c) => c.slug))
  for (const c of TAXONOMY) {
    await db.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name, nameVi: c.nameVi, icon: c.icon, color: c.color, description: c.description },
      create: { name: c.name, nameVi: c.nameVi, slug: c.slug, icon: c.icon, color: c.color, description: c.description },
    })
    console.log(`  ${existing.has(c.slug) ? 'updated' : 'CREATED'}  ${c.slug.padEnd(22)} ${c.name}`)
  }
  const orphans = [...existing].filter((s) => !TAXONOMY.some((c) => c.slug === s))
  if (orphans.length) console.log(`\n  note: ${orphans.length} DB categories not in taxonomy (left untouched): ${orphans.join(', ')}`)
  console.log(`\nDone. ${TAXONOMY.length} categories synced. No listings/sellers touched.`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
