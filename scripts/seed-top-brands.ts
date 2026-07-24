import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import * as fs from 'fs'
import * as path from 'path'

// ─────────────────────────────────────────────────────────────────────────────
// SEED TOP BRANDS — populates the Brand catalogue with the ~100 most-used
// marketplace brands for Vietnam (see scripts/data/top-brands.json), each with a
// real monotone SVG logo where one exists (simple-icons iconSlug or a frozen
// <svg> in logoPath), else a clean monogram. Marks them curated (curatedAt) so
// the /brands wall features them even before they have listings.
//
// Non-destructive & idempotent: upserts by `normalized`, never changes an
// existing brand's slug/aliases/listingCount, and only stamps curatedAt.
//
// Run:  node --env-file=.env node_modules/.bin/tsx scripts/seed-top-brands.ts        (dry-run)
//       APPLY=1 node --env-file=.env node_modules/.bin/tsx scripts/seed-top-brands.ts (write)
// ─────────────────────────────────────────────────────────────────────────────

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL })
const db = new PrismaClient({ adapter, log: ['warn', 'error'] })
const APPLY = process.env.APPLY === '1'

type Row = {
  rank: number; name: string; slug: string; normalized: string
  category: string; source: string; iconSlug: string | null; logoPath: string | null
}

async function main() {
  const rows: Row[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'top-brands.json'), 'utf8'))
  const now = new Date()
  const keep = new Set(rows.map((r) => r.normalized))

  // Existing catalogue (to control slug collisions + decide update vs create).
  const existing = await db.brand.findMany({ select: { id: true, slug: true, normalized: true } })
  const byNorm = new Map(existing.map((b) => [b.normalized, b]))
  const usedSlugs = new Set(existing.map((b) => b.slug))

  let created = 0, updated = 0
  const stats: Record<string, number> = { iconSlug: 0, logoPath: 0, monogram: 0 }
  for (const r of rows) {
    if (r.iconSlug) stats.iconSlug++; else if (r.logoPath) stats.logoPath++; else stats.monogram++
    const hit = byNorm.get(r.normalized)
    if (hit) {
      if (APPLY) await db.brand.update({
        where: { id: hit.id },
        data: { name: r.name, iconSlug: r.iconSlug, logoPath: r.logoPath, status: 'active', curatedAt: now },
      })
      updated++
    } else {
      let slug = r.slug
      if (usedSlugs.has(slug)) slug = `${slug}-${r.normalized.slice(0, 4)}`
      usedSlugs.add(slug)
      if (APPLY) await db.brand.create({
        data: {
          slug, name: r.name, normalized: r.normalized, aliases: '[]',
          iconSlug: r.iconSlug, logoPath: r.logoPath, status: 'active', curatedAt: now,
        },
      })
      created++
    }
  }

  // Cleanup: make curatedAt mean EXACTLY "in the seeded top-100 wall". An earlier
  // logo-repair pass stamped curatedAt on brands whose fake logos it cleared; clear
  // that stray stamp on every brand NOT in this set (any status / listing count) so
  // none can leak onto the wall now or later. A brand's logo (logoPath) is left
  // intact — only its "featured" flag is removed; it still shows if it has listings.
  const staleCurated = await db.brand.findMany({
    where: { curatedAt: { not: null } },
    select: { id: true, name: true, normalized: true },
  })
  const toUnfeature = staleCurated.filter((b) => !keep.has(b.normalized))
  if (APPLY) {
    for (const b of toUnfeature) await db.brand.update({ where: { id: b.id }, data: { curatedAt: null } })
  }

  console.log(`Seed rows: ${rows.length}  (iconSlug ${stats.iconSlug} · logoPath ${stats.logoPath} · monogram ${stats.monogram})`)
  console.log(`  create: ${created}   update: ${updated}`)
  console.log(`  un-featured (cleared stray curatedAt): ${toUnfeature.length}${toUnfeature.length ? ' → ' + toUnfeature.map((b) => b.name).join(', ') : ''}`)
  console.log(APPLY ? '\n✅ APPLIED to DB' : '\n(dry-run — set APPLY=1 to write)')
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
