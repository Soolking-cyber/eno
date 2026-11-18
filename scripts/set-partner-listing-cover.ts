/**
 * REPLACE AN OFFICIAL PARTNER'S SERVICE LISTING GALLERY WITH ONE CARD (owner, 2026-11-18, of Luật Hoàng Phi's company
 * formation listing: "remake hoang phi too card only names service large all info in description english primary").
 *
 *   npx tsx scripts/set-partner-listing-cover.ts --listing=<id> --seller=<id> --file=<png> --slug=<name>           # DRY RUN
 *   … --apply
 *
 * The card is the service's name only; every price and inclusion stays in the description, so the gallery becomes exactly
 * that one image (the old price-table images go). Stored CLEAN under affiliate/m/ with the app-drawn eno mark, as every
 * partner gallery (src/lib/host-product-image.ts 'overlay').
 *
 * ⛔ Only a SERVICE listing of an OFFICIAL PARTNER, matched by listing id AND seller id — never a member's own post.
 * ⛔ It never touches status, verified, the aisle or the attributes, so a licence approval (src/lib/licence-stamp.ts) and
 *    a moderator's hide survive it. The previous gallery is printed first: that line is the rollback.
 * The PDP is ISR for 30 days and a script has no revalidatePath, so its page is tombstoned (src/lib/pdp-tombstone.ts);
 * cards in the home/browse ISR pages refresh on their own cycle, or with the Cloudflare tag purge.
 */
import 'dotenv/config'
import { readFileSync, existsSync } from 'node:fs'
import sharp from 'sharp'
import { createClient } from '@supabase/supabase-js'
import { db } from '../src/lib/db'
import { makeImageHost } from '../src/lib/host-product-image'
import { tombstonePdps } from '../src/lib/pdp-tombstone'
import { enqueuePhotoChecks } from '../src/lib/listing-photo-queue'

const flag = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const APPLY = process.argv.includes('--apply')
const LISTING = flag('listing'), SELLER = flag('seller'), FILE = flag('file'), SLUG = flag('slug')

async function main() {
  if (!LISTING || !SELLER || !FILE || !SLUG) throw new Error('usage: --listing=<id> --seller=<id> --file=<png> --slug=<name> [--apply]')
  if (!/^[a-z0-9-]{3,60}$/.test(SLUG)) throw new Error('--slug: lowercase letters, digits and dashes only')
  if (!existsSync(FILE)) throw new Error(`missing ${FILE}`)
  const m = await sharp(FILE).metadata()
  if (m.width !== m.height || (m.width ?? 0) < 1200) throw new Error(`the card must be square and at least 1200px (got ${m.width}x${m.height})`)

  const row = await db.listing.findUnique({ where: { id: LISTING }, select: { id: true, sellerId: true, listingType: true, status: true, images: true, title: true, seller: { select: { name: true, officialPartner: true } } } })
  if (!row) throw new Error(`listing ${LISTING} not found`)
  if (row.sellerId !== SELLER) throw new Error(`listing ${LISTING} belongs to seller ${row.sellerId}, not ${SELLER}`)
  if (!row.seller?.officialPartner) throw new Error(`seller ${SELLER} is not an official partner — refusing`)
  if (row.listingType !== 'service') throw new Error(`listing ${LISTING} is a ${row.listingType}, not a service — refusing`)
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — "${row.title}" (${row.status}) by ${row.seller.name}`)
  console.log(`  card     ${FILE} ${m.width}x${m.height}`)
  console.log(`  previous gallery (rollback): ${row.images}`)
  if (!APPLY) { await db.$disconnect(); return }

  const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!storageUrl || !secret) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required')
  if (/supabase\.co$/.test(new URL(storageUrl).hostname)) throw new Error(`Refusing to upload to ${storageUrl} — retired project`)
  const storage = createClient(storageUrl, secret, { auth: { persistSession: false } }).storage.from('listings')
  const host = makeImageHost({ storage, storageUrl, bucket: 'listings', edge: 1600, quality: 86, mark: 'overlay' })
  const url = await host.fromBuffer(readFileSync(FILE), SLUG)
  if (!url) throw new Error('image host failed — nothing written')
  // Compare-and-set on the gallery this run read: an edit landing in between is never overwritten.
  const { count } = await db.listing.updateMany({ where: { id: LISTING, sellerId: SELLER, images: row.images }, data: { images: JSON.stringify([url]) } })
  if (count !== 1) throw new Error('the gallery changed since it was read — nothing written; re-run')
  console.log(`  APPLIED  ${url}`)
  console.log(`  PDP tombstones: ${await tombstonePdps(db, [LISTING])}`)
  // A new photo goes through the photo check like every script-written one (listing-photo-queue.ts).
  await enqueuePhotoChecks(db, [LISTING])
  await db.$disconnect()
}
main().catch(async (e) => { console.error(e instanceof Error ? e.message : e); await db.$disconnect(); process.exit(1) })
