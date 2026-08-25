/**
 * Give imported products a brand (and create the brands they need).
 *
 *   npx tsx scripts/backfill-brands.ts            # DRY RUN
 *   npx tsx scripts/backfill-brands.ts --apply
 *
 * ⛔ WHY: 6,470 of 9,726 imported products (67%) had no `brandSlug`, because the importer matched a
 * hardcoded list of 19 brand NAMES and most titles name a product LINE instead — an "iPhone 16 Pro
 * Max" never contains the word "Apple". Choosing Phones + Apple therefore showed iPads and three
 * old handsets while 267 iPhones sat unreachable (owner, 2026-08-25).
 *
 * ⚠️ ONLY FILLS A NULL. An existing brand is never overwritten: it may have been set by a human, by
 * the partner API, or by a better signal than a title regex.
 */
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { db } from '../src/lib/db'
import { inferBrand, lineBrandSlugs } from '../src/lib/brand-infer'
import { brandSlugify, normalizeBrand } from '../src/lib/brand-normalize'

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const SELLER = arg('seller') ?? 'CellphoneS'
/**
 * ⛔ `--recheck` RE-EVALUATES ROWS THAT ALREADY HAVE A BRAND, because this resolver keeps getting
 * corrected and a fixed function does not fix rows already written. Measured after the first run:
 * 462 of 7,035 branded rows disagreed with the corrected version — "Genuine Spigen case for Samsung
 * Galaxy" filed under samsung, Zagg protectors under apple, Sony televisions under google because
 * their titles begin "Google Tivi".
 * ⚠️ IT HAS NO PROVENANCE, AND THAT IS A REAL LIMITATION, NOT AN OVERSIGHT. Nothing records who
 * set a brandSlug, so a re-check cannot tell its own earlier guess from a human correction and
 * would revert one. It is bounded to `externalId != null` — merchant-imported rows, which no one
 * curates by hand — and that is the only thing making it safe. ⛔ Do not widen it to seller-posted
 * listings without adding provenance first.
 */
const RECHECK = process.argv.includes('--recheck')

/**
 * Brands this catalogue sells that the Brand directory did not know about.
 *
 * ⛔ MEASURED, NOT IMAGINED. Taken from a tally of the leading word of all 6,470 unbranded titles:
 * every entry below appeared at least ~40 times, and each was read to confirm it is a maker rather
 * than a product word. Without them a Tomtoc sleeve or a Ugreen cable can never resolve, because
 * `inferBrand` will not invent a brand that the catalogue does not list — which is the property
 * that stops it inventing nonsense ones.
 */
const SEED_BRANDS = [
  'tomtoc', 'zagg', 'fujihome', 'uag', 'mipow', 'garmin', 'wiwu', 'aula', 'innostyle', 'dreame',
  'spigen', 'sandisk', 'rapoo', 'orico', 'ugreen', 'hitachi', 'cuktech', 'stargo', 'kingston',
  'lexar', 'akko', 'keychron', 'belkin', 'hydroflask', 'elmich', 'kangaroo', 'sharp', 'zeelot',
  'roborock', 'ecovacs', 'jvc', 'edifier', 'soundpeats', 'havit', 'corsair', 'razer', 'steelseries',
  'seagate', 'transcend', 'tp-link', 'totolink', 'mercusys', 'brother', 'epson', 'imou', 'ezviz',
  // ⛔ 'lock&lock' REMOVED. `brandSlugify` would rewrite the `&`, so the Brand row and the value
  // written onto listings would differ — a brandSlug pointing at no brand — and `?brand=lock&lock`
  // splits at the ampersand in any filter URL. A seed must already BE a slug.
  'insta360', 'gopro', 'benq', 'viewsonic', 'gigabyte', 'deepcool', 'noctua',
  // ⛔ 'osmo' REMOVED — it is a DJI PRODUCT LINE, not a maker, and being longer than "dji" it won
  // the longest-first match on "DJI Osmo Pocket 3". A seed must be the company, never the range.
  // ⛔ 'colorful' (a real GPU maker) IS DELIBERATELY ABSENT. It is also an ordinary adjective, and
  // it matched "iPhone 16 Pro Max X Level Colorful Case with MagSafe" — where the maker is X Level.
  // Two products were at stake against a whole class of mislabelling; the trade is not close.
  // Same reasoning would apply to any future seed that is a word before it is a name.
]

async function main() {
  const existing = new Set((await db.brand.findMany({ select: { slug: true } })).map((b) => b.slug))
  /**
   * ⚠️ SEEDED BEFORE RESOLVING, and created even in a dry run's plan, because `inferBrand` only
   * matches names the catalogue already holds. Resolving first would report a far smaller number
   * and hide the fact that the gap is a missing directory, not an unreadable title.
   */
  const toSeed = SEED_BRANDS.filter((b) => !existing.has(b))
  if (toSeed.length) console.log(`${toSeed.length} brands missing from the directory: ${toSeed.join(', ')}\n`)
  if (APPLY) {
    for (const slug of toSeed) {
      const name = slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      await db.brand.create({ data: { slug: brandSlugify(slug), name, normalized: normalizeBrand(name) } }).catch(() => {})
    }
    if (toSeed.length) console.log(`created ${toSeed.length} brands`)
  }
  /**
   * ⚠️ SLUGIFIED BEFORE USE. `known` is what gets written onto a listing's `brandSlug`, so a seed
   * that is not already a valid slug would create a Brand row under one key and point listings at
   * another. Passing every seed through the same function the Brand row uses makes that impossible.
   */
  const known = [...new Set([...existing, ...SEED_BRANDS.map(brandSlugify)])]
  console.log(`${known.length} brands in the catalogue\n`)

  const rows = await db.listing.findMany({
    // ⛔ `ownerId: null` — Seller.name is not unique and this writes in bulk.
    where: { seller: { name: SELLER, ownerId: null }, externalId: { not: null }, ...(RECHECK ? {} : { brandSlug: null }) },
    select: { id: true, title: true, titleVi: true, subcategorySlug: true, brandSlug: true },
  })
  console.log(`${rows.length} listings ${RECHECK ? 'to re-check' : 'have no brand'}`)

  const updates: { id: string; brandSlug: string | null }[] = []
  const tally = new Map<string, number>()
  for (const r of rows) {
    const slug = inferBrand(r.title, r.titleVi, r.subcategorySlug, known)
    if (RECHECK) {
      if (slug === r.brandSlug) continue
      updates.push({ id: r.id, brandSlug: slug })
      tally.set(`${r.brandSlug ?? 'null'} -> ${slug ?? 'null'}`, (tally.get(`${r.brandSlug ?? 'null'} -> ${slug ?? 'null'}`) ?? 0) + 1)
      continue
    }
    if (!slug) continue
    updates.push({ id: r.id, brandSlug: slug })
    tally.set(slug, (tally.get(slug) ?? 0) + 1)
  }
  console.log(`${updates.length} can be resolved (${rows.length - updates.length} stay null)\n`)
  console.table([...tally].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([brand, n]) => ({ brand, n })))

  // Brands the line map can produce but the catalogue does not have yet.
  const haveSet = new Set(known)
  // ⚠️ In --recheck the tally keys are "old -> new" transitions, not slugs — only the fill mode's
  // keys are brand names, and feeding transitions to the creator printed nonsense.
  const produced = RECHECK ? updates.map((u) => u.brandSlug).filter(Boolean) as string[] : [...tally.keys()]
  const missing = [...new Set([...produced, ...lineBrandSlugs()])].filter((s) => !haveSet.has(s))
  if (missing.length) console.log(`brands to create: ${missing.join(', ')}`)

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written.')
    for (const u of updates.slice(0, 6)) {
      const r = rows.find((x) => x.id === u.id)!
      console.log(`  ${(r.brandSlug ?? 'null')} -> ${(u.brandSlug ?? 'null').padEnd(12)} ${r.title.slice(0, 56)}`)
    }
    await db.$disconnect(); return
  }

  for (const slug of missing) {
    const name = slug.charAt(0).toUpperCase() + slug.slice(1)
    // `normalized` is the typo-dedup key (brand-normalize.ts) and is required, so an imported brand
    // collides with a human-typed one instead of becoming a near-duplicate.
    await db.brand.create({ data: { slug: brandSlugify(slug), name, normalized: normalizeBrand(name) } }).catch(() => {})
  }
  if (missing.length) console.log(`created ${missing.length} brands`)

  const snap = `data/brand-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`
  writeFileSync(snap, updates.map((u) => JSON.stringify({ id: u.id, brandSlug: rows.find((r) => r.id === u.id)?.brandSlug ?? null })).join('\n'))
  console.log(`snapshot: ${snap}`)

  let n = 0
  for (let i = 0; i < updates.length; i += 200) {
    /**
     * ⚠️ `updateMany` WITH `brandSlug: null` IN THE WHERE, NOT `update` BY ID. The rows were chosen
     * as unbranded, but this run takes minutes and a human or the partner API can brand one in
     * between — an id-only update would then quietly overwrite a better answer with a title guess.
     * Re-asserting the condition at write time makes the fill genuinely "only if still empty".
     */
    await Promise.all(updates.slice(i, i + 200).map((u) =>
      // ⚠️ The "still empty" guard applies to a FILL, not to a re-check, which exists to correct a
      // value this script itself wrote.
      db.listing.updateMany({ where: { id: u.id, ...(RECHECK ? {} : { brandSlug: null }) }, data: { brandSlug: u.brandSlug } }).catch(() => {})))
    n = Math.min(i + 200, updates.length)
    if (n % 2000 === 0 || n === updates.length) console.log(`  ${n}/${updates.length}`)
  }
  console.log(`\nAPPLIED: ${n} listings branded`)
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
