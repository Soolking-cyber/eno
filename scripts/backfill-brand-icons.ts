/**
 * Give icon-less brands their `iconSlug` from the simple-icons set we already ship.
 *
 *   set -a; . ./.env; set +a; npx tsx scripts/backfill-brand-icons.ts          # DRY RUN
 *   set -a; . ./.env; set +a; npx tsx scripts/backfill-brand-icons.ts --apply
 *
 * ⛔ THE SOURCE IS simple-icons, WHICH IS ALREADY A DEPENDENCY AND IS CC0. `Brand.iconSlug` is
 * documented in the schema as "simple-icons slug if recognized; null → monogram fallback", so this
 * fills in a mechanism that already exists rather than inventing one. 3,450 marks ship in
 * node_modules; nothing is fetched, nothing is re-hosted, and there is no third party's asset
 * pipeline involved.
 *
 * ⚠️ IT ONLY COVERS ~8% OF THE GAP, AND THAT IS THE HONEST CEILING. Measured 2026-09-21: 531 active
 * brands carry no icon, and 45 of them match simple-icons. The rest are phone-case and accessory
 * makers (Zagg, Tomtoc, UAG, Baseus, Spigen, Wiwu, JCPAL) and Vietnamese home brands (Sunhouse,
 * Fujihome) that simple-icons deliberately does not carry — it indexes tech/dev brands. Those keep
 * the monogram fallback, which is a designed state, not a broken one.
 *
 * ⛔ A WRONG MARK IS WORSE THAN NO MARK, WHICH IS WHY `AMBIGUOUS` EXISTS. Matching is on the
 * normalized brand name, so any brand whose name is an ordinary English word collides with an
 * unrelated company that happens to share it. Putting a crypto-wallet logo on 56 phone listings is
 * a worse outcome than the monogram those listings already show, and nothing downstream would flag
 * it — someone would just have to notice.
 */
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import * as si from 'simple-icons'

const APPLY = process.argv.includes('--apply')

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL }),
  log: ['warn', 'error'],
})

/**
 * ⛔ REFUSED MATCHES — each is a real collision found by reading all 45 candidates, not a guess.
 * The brand on the left is an electronics/accessory maker; the simple-icons entry that shares its
 * normalized name is a different company in a different industry.
 */
const AMBIGUOUS: Record<string, string> = {
  magic: 'simple-icons "Magic" is the auth/wallet company; this brand is a phone line (56 listings)',
  hyper: 'simple-icons "Hyper" is the terminal emulator; this brand makes chargers and hubs',
  matrix: 'simple-icons "Matrix" is the chat protocol, not the accessory brand',
  red: 'simple-icons "Red" is ambiguous — RED Digital Cinema vs. a colour-named brand',
  meta: 'simple-icons "Meta" is the social company; this brand row is unattributed',
}

/**
 * ⚠️ NAMES simple-icons SPELLS DIFFERENTLY. Matching is on the normalized brand name, so a mark
 * whose icon TITLE carries a suffix never matches: "Kingston" vs "Kingston Technology". Found by
 * listing the top 40 misses beside their nearest icon. Kept as an explicit table rather than a
 * fuzzy/prefix match — the same scan showed prefix matching pairs brands with the single-letter
 * icons (`d`, `e`, `r`, `x`) and "Fujihome" with F#, which is worse than no icon.
 */
const ALIAS: Record<string, string> = {
  kingston: 'kingstontechnology',
}

/** Same shape as Brand.normalized: lowercased, de-accented, alphanumeric only. */
const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

async function main() {
  const icons = Object.values(si as Record<string, unknown>).filter(
    (v): v is { title: string; slug: string } =>
      !!v && typeof v === 'object' && 'title' in (v as object) && 'slug' in (v as object),
  )
  const byNorm = new Map<string, { title: string; slug: string }>()
  for (const i of icons) {
    byNorm.set(norm(i.title), i)
    byNorm.set(norm(i.slug), i)
  }

  const gap = await db.brand.findMany({
    where: { status: 'active', iconSlug: null, logoPath: null },
    orderBy: { listingCount: 'desc' },
    select: { id: true, slug: true, name: true, normalized: true, listingCount: true },
  })

  const hits: { id: string; name: string; icon: string; n: number }[] = []
  const refused: { name: string; why: string; n: number }[] = []
  for (const b of gap) {
    const key = b.normalized || norm(b.name)
    const m = byNorm.get(ALIAS[key] ?? key) ?? byNorm.get(key) ?? byNorm.get(norm(b.name))
    if (!m) continue
    const why = AMBIGUOUS[key]
    if (why) { refused.push({ name: b.name, why, n: b.listingCount }); continue }
    hits.push({ id: b.id, name: b.name, icon: m.slug, n: b.listingCount })
  }

  console.log(`  simple-icons available   ${icons.length}`)
  console.log(`  brands with no icon      ${gap.length}`)
  console.log(`  MATCHED (will set)       ${hits.length}  covering ${hits.reduce((a, h) => a + h.n, 0)} listings`)
  console.log(`  refused as ambiguous     ${refused.length}`)
  for (const r of refused) console.log(`      ${String(r.n).padStart(4)}  ${r.name.padEnd(12)} — ${r.why}`)
  console.log(`  left on the monogram     ${gap.length - hits.length}`)
  console.log(`  mode                     ${APPLY ? 'APPLY — WRITES TO PRODUCTION' : 'DRY RUN'}`)

  if (!APPLY) {
    console.log('\n  would set:')
    for (const h of hits.slice(0, 12)) console.log(`      ${String(h.n).padStart(4)}  ${h.name.padEnd(18)} -> ${h.icon}`)
    console.log('\nDRY RUN — nothing written. Re-run with --apply.')
    await db.$disconnect(); return
  }

  let set = 0
  for (const h of hits) {
    /** ⚠️ Scoped to rows that are STILL icon-less: an admin may have curated one since the read
     *  above, and `logoPath` deliberately overrides `iconSlug`. Never overwrite a human's choice. */
    const res = await db.brand.updateMany({
      where: { id: h.id, iconSlug: null, logoPath: null },
      data: { iconSlug: h.icon },
    })
    set += res.count
  }
  const remaining = await db.brand.count({ where: { status: 'active', iconSlug: null, logoPath: null } })
  console.log(`\n  set ${set} icons   brands still icon-less: ${remaining}`)
  console.log(`\nROLLBACK:\n  UPDATE "Brand" SET "iconSlug" = NULL WHERE "iconSlug" IS NOT NULL AND "logoPath" IS NULL;`)
  console.log('  -- ⚠️ that clears EVERY iconSlug, including the 89 set before this run. To undo only')
  console.log('  -- this backfill, restrict it to the slugs printed above.')
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
