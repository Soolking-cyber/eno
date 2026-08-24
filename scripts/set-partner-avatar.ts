/**
 * Give the affiliate partner's storefront its own logo as the avatar.
 *
 *   npx tsx scripts/set-partner-avatar.ts            # DRY RUN
 *   npx tsx scripts/set-partner-avatar.ts --apply
 *
 * ⚠️ NO WATERMARK ON THIS ONE, and that is not an oversight. src/lib/core/media.ts spells out the
 * rule: the eno wordmark goes on LISTING photos, which get scraped and re-shared, and never on
 * avatars or shop logos. Stamping eno.vn across a partner's own mark would also be the one place
 * on the site where we altered someone else's trademark.
 *
 * ⚠️ THE SOURCE IS THE PARTNER'S OWN PUBLISHED ICON (static.vinwonders.com), not a redraw and not
 * a screenshot. We display it as their affiliate; a traced copy would be both worse-looking and a
 * worse claim to be making.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { db } from '../src/lib/db'

const APPLY = process.argv.includes('--apply')
const BUCKET = 'listings'
const SIZE = 512
/** The partner's own icon, as published on their site. */
const LOGO_URL = 'https://static.vinwonders.com/production/VWs_icon_512.png'

async function main() {
  const cat = JSON.parse(readFileSync(join(process.cwd(), 'data/vinwonders-destinations.json'), 'utf8'))
  const partnerName: string = cat.partner?.name
  if (!partnerName) { console.error('catalogue has no partner.name'); process.exit(1) }

  // ⚠️ IDENTIFIED BY ITS LISTINGS, NOT BY NAME. `Seller.name` is not unique and anyone can open a
  // storefront called "VinWonders"; the storefront we mean is the one our affiliate listings hang
  // off. Writing an avatar onto an impersonator would be handing them the partner's mark.
  const anchor = await db.listing.findFirst({
    where: { affiliateUrl: { not: null } },
    select: { seller: { select: { id: true, name: true, avatarUrl: true, ownerId: true } } },
  })
  const seller = anchor?.seller
  if (!seller) { console.error('no affiliate listing found, so no partner storefront to update'); process.exit(1) }
  if (seller.name !== partnerName) {
    console.error(`storefront behind the affiliate listings is "${seller.name}", not "${partnerName}" — refusing`)
    process.exit(1)
  }
  console.log(`partner storefront: ${seller.name} (${seller.id})`)
  console.log(`current avatar: ${seller.avatarUrl ?? '(none)'}`)

  const res = await fetch(LOGO_URL, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) { console.error(`logo fetch failed: ${res.status}`); process.exit(1) }
  const sharp = (await import('sharp')).default
  const src = Buffer.from(await res.arrayBuffer())
  const meta = await sharp(src).metadata()
  // Flattened onto white rather than left transparent: the avatar renders on several surfaces
  // (dark chips, coloured cards) and a transparent cut-out would pick up whatever sits behind it.
  const out = await sharp(src)
    .resize(SIZE, SIZE, { fit: 'contain', background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .webp({ quality: 92 })
    .toBuffer()
  console.log(`logo: ${meta.width}x${meta.height} ${meta.format} -> ${SIZE}x${SIZE} webp, ${out.length} bytes`)

  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply to upload and set it.'); await db.$disconnect(); return }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required'); process.exit(1) }
  if (/supabase\.co$/.test(new URL(url).hostname)) { console.error(`Refusing to upload to ${url} — retired project`); process.exit(1) }

  const storage = createClient(url, key, { auth: { persistSession: false } }).storage.from(BUCKET)
  const name = `partner/avatar-${seller.id}-${Date.now().toString(36)}.webp`
  const { error } = await storage.upload(name, out, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' })
  if (error) { console.error(`upload failed: ${error.message}`); process.exit(1) }
  const avatarUrl = `${url}/storage/v1/object/public/${BUCKET}/${name}`
  await db.seller.update({ where: { id: seller.id }, data: { avatarUrl } })
  console.log(`\nAPPLIED: ${avatarUrl}`)
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
