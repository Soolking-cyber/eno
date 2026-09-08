/**
 * Remove imported listings whose price is a PLACEHOLDER, not a price.
 *
 *   npx tsx scripts/remove-placeholder-price-listings.ts --seller 24hStore --price 100          # DRY RUN
 *   npx tsx scripts/remove-placeholder-price-listings.ts --seller 24hStore --price 100 --apply
 *
 * ⛔ WHY THESE ARE JUNK, NOT CHEAP GOODS. The scraper writes a fixed sentinel into `price` when it
 * cannot parse one off the merchant's page. MEASURED on production 2026-09-08: 24hStore has 206
 * rows at exactly 100 with an EMPTY `priceUnit`, all imported the same day, sitting beside items
 * like "Used iPhone 6 16GB Locked" — a real 100 ₫ iPhone does not exist. They are live in the
 * marketplace and in the Meta/Google product feeds, where they read as a 100 ₫ iPhone to a buyer
 * and to an ad platform's price-quality checks.
 *
 * ⚠️ DELETE, NOT HIDE, AND ONLY BECAUSE NOTHING POINTS AT THEM. Verified before writing this:
 * zero Conversation / Order / Report / Review / ContactReveal / ListingDailyStat / PriceChange
 * rows reference any of them, and none is saved by a buyer. The script RE-CHECKS all of that at
 * run time and refuses the whole batch if anything has appeared since — a listing someone has
 * messaged about is a record, and deleting it destroys the other party's thread.
 *
 * ⚠️ THE IMAGES ARE OURS AND MUST GO TOO. These are not hotlinks: the importer re-hosted them into
 * our own `listings` bucket (sb.eno.vn/storage/v1/object/public/listings/affiliate/…), 815 objects
 * across the 206 rows. deleteListingCore evicts a listing's VIDEO but never its images, so a plain
 * row delete would strand every one of them, billed forever with nothing referencing them.
 *
 * ⚠️ AN OBJECT IS REMOVED ONLY IF NO SURVIVING LISTING STILL REFERENCES IT — the same orphan check
 * removeVideoIfOrphaned applies to clips. The importer can and does reuse one re-hosted photo
 * across variant rows, so deleting by row would blank a listing that is staying.
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { db } from '../src/lib/db'

// ⚠️ NOT src/lib/supabase-admin — that module opens with `import 'server-only'`, which throws under
// tsx. Same client, same bucket, built the way every other script here builds it.
const LISTINGS_BUCKET = 'listings'

const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
const storageSecret = process.env.SUPABASE_SECRET_KEY

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
const SELLER = arg('seller')
const SELLER_ID = arg('id') // the disambiguator the duplicate-name refusal below tells you to use
const PRICE = Number(arg('price'))
if ((!SELLER && !SELLER_ID) || !Number.isFinite(PRICE)) { console.error('--seller <name> | --id <sellerId>, plus --price <n>'); process.exit(1) }

/**
 * Public URL -> object path inside OUR `listings` bucket, or null if the URL is not ours.
 *
 * ⛔ THE ORIGIN IS CHECKED, NOT JUST THE PATH. Matching `/storage/v1/object/public/listings/…`
 * anywhere in the string treats `https://someone-else.example/storage/v1/object/public/listings/
 * shared.jpg` as a local object and hands its path to OUR bucket's remove() — deleting whatever we
 * happen to store under that name. A foreign URL must resolve to nothing, not to a same-named
 * local file.
 */
function listingImagePath(url: string): string | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  if (!storageUrl || u.origin !== new URL(storageUrl).origin) return null
  const m = u.pathname.match(/^\/storage\/v1\/object\/public\/listings\/(.+)$/)
  return m ? decodeURIComponent(m[1]) : null
}

async function main() {
  /**
   * ⛔ `findFirst` ON A NON-UNIQUE NAME WAS THE WRONG RESOLVER FOR A DELETE. `Seller.name` carries
   * no unique constraint and production really does hold duplicates (two "eno Support" rows), so
   * the first match is an arbitrary storefront — and this script's arbitrary storefront loses rows
   * and images permanently. scripts/set-official-partner.mjs refuses an ambiguous name for a
   * merely cosmetic flag; the destructive tool cannot hold itself to a lower standard.
   */
  // ⚠️ `--id` IS PARSED, because the refusal below tells the operator to use it. An error message
  // naming a flag the script does not accept is a dead end, not a recovery path.
  const matches = SELLER_ID
    ? await db.seller.findMany({ where: { id: SELLER_ID }, select: { id: true, name: true } })
    : await db.seller.findMany({ where: { name: SELLER }, select: { id: true, name: true } })
  if (!matches.length) { console.error(`no storefront "${SELLER_ID ?? SELLER}"`); process.exit(1) }
  if (matches.length > 1) {
    console.error(`"${SELLER}" matches ${matches.length} storefronts — refusing. Re-run with --id <sellerId>:`)
    for (const m of matches) console.error(`  ${m.id}`)
    process.exit(1)
  }
  const seller = matches[0]

  const doomed = await db.listing.findMany({
    where: { sellerId: seller.id, price: PRICE },
    select: { id: true, title: true, images: true, brandSlug: true, video: true, status: true, priceUnit: true },
  })
  console.log(`${seller.name}: ${doomed.length} listings at ${PRICE}`)
  if (!doomed.length) { await db.$disconnect(); return }
  const ids = doomed.map((l) => l.id)

  /**
   * ⛔ PROVE THEY ARE PLACEHOLDERS, DO NOT ASSUME IT FROM THE PRICE. Seller + price is not evidence
   * of anything: a real 100,000 ₫ accessory at `--price 100000` matches the same query, and this
   * script would delete it and its photos with no way back. The sentinel rows carry the scraper's
   * fingerprint — an EMPTY `priceUnit`, where a genuine listing has 'VND' — so that is what gets
   * checked. A mixed batch stops rather than guessing which half was meant.
   */
  const genuine = doomed.filter((l) => (l.priceUnit || '').trim() !== '')
  if (genuine.length) {
    console.error(`\n⛔ REFUSING: ${genuine.length} of these ${doomed.length} rows carry a real priceUnit, so they are`)
    console.error(`   priced listings, not scraper placeholders. Narrow the selection before deleting:`)
    for (const l of genuine.slice(0, 5)) console.error(`     ${l.id}  ${l.priceUnit}  ${l.title.slice(0, 50)}`)
    await db.$disconnect(); process.exit(1)
  }
  console.log(`  all ${doomed.length} carry an empty priceUnit — the scraper's placeholder fingerprint`)

  // ── Refuse the batch if anything now references these rows ────────────────────────────────────
  const refs = {
    conversations: await db.conversation.count({ where: { listingId: { in: ids } } }),
    orders: await db.order.count({ where: { listingId: { in: ids } } }),
    reports: await db.report.count({ where: { listingId: { in: ids } } }),
    reviews: await db.review.count({ where: { listingId: { in: ids } } }),
    contactReveals: await db.contactReveal.count({ where: { listingId: { in: ids } } }),
    dailyStats: await db.listingDailyStat.count({ where: { listingId: { in: ids } } }),
    priceChanges: await db.priceChange.count({ where: { listingId: { in: ids } } }),
    saved: doomed.length && await db.listing.count({ where: { id: { in: ids }, savedCount: { gt: 0 } } }),
  }
  const held = Object.entries(refs).filter(([, n]) => n > 0)
  if (held.length) {
    console.error(`\n⛔ REFUSING: these listings are referenced — ${held.map(([k, n]) => `${k}=${n}`).join(', ')}`)
    console.error('   A listing someone has messaged, bought, reported or saved is a record. Hide it instead.')
    await db.$disconnect(); process.exit(1)
  }
  console.log('  no conversations, orders, reports, reviews, contact reveals, stats or saves reference them')

  // ── Which of their images would be orphaned by the delete ─────────────────────────────────────
  const urls = new Set<string>()
  for (const l of doomed) { try { for (const u of JSON.parse(l.images) as string[]) urls.add(u) } catch { /* malformed */ } }
  const mine = [...urls].filter((u) => listingImagePath(u))
  const stillUsed = new Set<string>()
  for (const u of mine) {
    const n = await db.listing.count({ where: { images: { contains: u }, id: { notIn: ids } } })
    if (n > 0) stillUsed.add(u)
  }
  const orphans = mine.filter((u) => !stillUsed.has(u))
  console.log(`  ${urls.size} image URLs, ${mine.length} in our own bucket, ${orphans.length} become orphans (${stillUsed.size} still used elsewhere — kept)`)
  console.log(`\n  sample: ${doomed.slice(0, 5).map((l) => l.title.slice(0, 44)).join(' | ')}`)

  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply.'); await db.$disconnect(); return }

  /**
   * ⛔ ROWS FIRST, THEN STORAGE — THE ORDER WAS THE OTHER WAY AND IT WAS WRONG. The original
   * reasoning ("a stranded object is invisible, a stranded row is not") only weighs one of the two
   * failures. Deleting 815 objects and THEN having deleteMany throw leaves 206 LIVE listings whose
   * every photo 404s, in the marketplace and in both product feeds, and a re-run cannot repair
   * them because the images are already gone. The reverse failure — rows deleted, storage call
   * fails — leaves objects nothing references, which costs storage and shows nobody anything.
   * Pay the invisible cost, never the visible one.
   *
   * ⚠️ AND THE ORPHANS ARE PRINTED WHEN THE REMOVE FAILS, because after the rows are gone nothing
   * can rediscover those paths. The list on stdout is the only way to retry them.
   */
  if (!storageUrl || !storageSecret) {
    console.error('⛔ NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY required — refusing to delete rows and strand 815 objects')
    await db.$disconnect(); process.exit(1)
  }
  const storage = createClient(storageUrl, storageSecret, { auth: { persistSession: false } }).storage.from(LISTINGS_BUCKET)
  const paths = orphans.map(listingImagePath).filter((p): p is string => !!p)

  const del = await db.listing.deleteMany({ where: { id: { in: ids } } })
  console.log(`  deleted ${del.count} listings`)

  let removed = 0
  for (let i = 0; i < paths.length; i += 100) {
    const slice = paths.slice(i, i + 100)
    const { error } = await storage.remove(slice)
    if (error) {
      console.error(`  storage remove FAILED for ${slice.length} objects: ${error.message}`)
      console.error(`  retry these paths by hand — the rows are gone, so nothing can find them again:`)
      for (const path of slice) console.error(`    ${path}`)
    } else removed += slice.length
  }
  console.log(`  removed ${removed}/${paths.length} storage objects`)

  /**
   * ⚠️ THE CLIP TOO. `video` is selected above and was then never used — deleteListingCore evicts a
   * listing's video via removeVideoIfOrphaned() and this script bypassed that entirely, so any
   * clip on a deleted row was stranded in the listing-videos bucket forever. Same orphan test as
   * the images: another listing may legitimately point at the same URL.
   */
  const videos = [...new Set(doomed.map((l) => l.video).filter((v): v is string => !!v))]
  let videosRemoved = 0
  for (const url of videos) {
    if (await db.listing.count({ where: { video: url } })) continue // still referenced
    // Same origin check as the images — a foreign video URL must not name a path in our bucket.
    let vu: URL
    try { vu = new URL(url) } catch { continue }
    if (vu.origin !== new URL(storageUrl).origin) continue
    const m = vu.pathname.match(/^\/storage\/v1\/object\/public\/listing-videos\/(.+)$/)
    if (!m) continue
    const { error } = await createClient(storageUrl, storageSecret, { auth: { persistSession: false } })
      .storage.from('listing-videos').remove([decodeURIComponent(m[1])])
    if (error) console.error(`  video remove failed: ${error.message}`)
    else videosRemoved++
  }
  if (videos.length) console.log(`  removed ${videosRemoved}/${videos.length} listing videos`)

  // ⚠️ THE AI SEARCH INDEX IS NOT TOUCHED HERE. removeFromIndex lives behind `server-only` too, and
  // Vertex drops documents whose listing 404s on the next reindex sweep. Noted, not silently skipped.
  console.log('  NOTE: Vertex AI search documents are cleared by the next reindex sweep, not by this script')
  console.log('\nNEXT: node scripts/purge-isr-listings.mjs   (their PDPs are ISR-baked and would keep 200-ing)')
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
