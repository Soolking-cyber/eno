/**
 * Push the deduplicated, watermarked partner galleries from the catalogue onto the listings.
 *
 *   npx tsx scripts/set-vinwonders-images.ts            # DRY RUN
 *   npx tsx scripts/set-vinwonders-images.ts --apply
 *
 * Run AFTER scripts/fetch-vinwonders-images.ts --apply, which is what writes the urls into
 * data/vinwonders-destinations.json. Split from it deliberately: fetching 300 partner images is
 * slow and rate-limited, and re-running it just to correct a database write would re-upload
 * everything. This half is instant and repeatable.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '../src/lib/db'

async function main() {
  const apply = process.argv.includes('--apply')
  const cat = JSON.parse(readFileSync(join(process.cwd(), 'data/vinwonders-destinations.json'), 'utf8'))
  const rows = await db.listing.findMany({
    where: { affiliateUrl: { not: null } },
    select: { id: true, title: true, images: true, affiliateUrl: true },
  })

  let planned = 0, skipped = 0
  for (const dest of cat.destinations as { name: string; affiliateUrl?: string; images?: string[] }[]) {
    // ⚠️ MATCH ON THE AFFILIATE URL, NOT THE TITLE. The url is the one field that identifies the
    // product and never gets edited, localized or prefixed with a promotion; a title match goes
    // silently no-op the first time someone renames a listing in the admin.
    const row = rows.find((r) => dest.affiliateUrl && r.affiliateUrl === dest.affiliateUrl)
      ?? rows.find((r) => r.title === dest.name)
    if (!row) { console.log(`  SKIP  ${dest.name} — no affiliate listing matches its url or title`); skipped++; continue }
    const images = dest.images ?? []
    // ⛔ NEVER WRITE AN EMPTY GALLERY. A partner API outage produces an empty array, and blanking a
    // live product's photos is far worse than leaving yesterday's photos in place.
    if (!images.length) { console.log(`  SKIP  ${dest.name} — catalogue has no images`); skipped++; continue }
    // Every url must be one of ours: an unmigrated partner url here would hotlink the partner's
    // CDN from our product pages, and it would carry no watermark.
    const foreign = images.filter((u) => !/\/storage\/v1\/object\/public\/listings\//.test(u))
    if (foreign.length) { console.log(`  SKIP  ${dest.name} — ${foreign.length} url(s) not in our bucket`); skipped++; continue }

    const before = (() => { try { return JSON.parse(row.images).length } catch { return 0 } })()
    console.log(`  SET   ${dest.name.padEnd(36)} ${before} -> ${images.length} images`)
    planned++
    if (apply) await db.listing.update({ where: { id: row.id }, data: { images: JSON.stringify(images) } })
  }

  console.log(`\n${apply ? 'APPLIED' : 'DRY RUN'}: ${planned} updated, ${skipped} skipped`)
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
