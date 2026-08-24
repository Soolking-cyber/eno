/**
 * Set (or clear) any storefront's optional cover banner.
 *
 *   npx tsx scripts/set-storefront-banner.ts --seller VinWonders --file ~/Desktop/vw-banner.png
 *   npx tsx scripts/set-storefront-banner.ts --seller VietKite  --url https://…/banner.jpg
 *   npx tsx scripts/set-storefront-banner.ts --seller GMBR --clear
 *   (add --apply; without it this only reports what it would do)
 *
 * ⚠️ NO WATERMARK. This is the seller's own artwork, like the avatar. src/lib/core/media.ts sets
 * the rule: the eno mark goes on LISTING photos, which get scraped and re-shared, never on a
 * shop's own branding.
 *
 * ⚠️ --seller MATCHES A NAME, AND NAMES ARE NOT UNIQUE, so an ambiguous match refuses rather than
 * picking one. Pass --id <sellerId> when two shops share a name.
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { db } from '../src/lib/db'

const argv = process.argv
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const APPLY = argv.includes('--apply')
const CLEAR = argv.includes('--clear')
const BUCKET = 'listings'
/** 1600×400 — the 4:1 the storefront reserves at desktop. Wider than any card image, but this is
 *  one request per shop page and it is the LCP element when present. */
const W = 1600, H = 400

async function main() {
  const name = arg('seller'), id = arg('id'), file = arg('file'), remote = arg('url')
  if (!name && !id) { console.error('pass --seller <name> or --id <sellerId>'); process.exit(1) }
  if (!CLEAR && !file && !remote) { console.error('pass --file <path>, --url <https://…>, or --clear'); process.exit(1) }

  const matches = id
    ? await db.seller.findMany({ where: { id }, select: { id: true, name: true, bannerUrl: true } })
    : await db.seller.findMany({ where: { name }, select: { id: true, name: true, bannerUrl: true } })
  if (!matches.length) { console.error(`no storefront matches ${id ?? name}`); process.exit(1) }
  if (matches.length > 1) {
    console.error(`"${name}" matches ${matches.length} storefronts — rerun with --id <sellerId>:`)
    for (const m of matches) console.error(`  ${m.id}`)
    process.exit(1)
  }
  const seller = matches[0]
  console.log(`storefront: ${seller.name} (${seller.id})`)
  console.log(`current banner: ${seller.bannerUrl ?? '(none)'}`)

  if (CLEAR) {
    console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: banner cleared`)
    if (APPLY) await db.seller.update({ where: { id: seller.id }, data: { bannerUrl: null } })
    await db.$disconnect(); return
  }

  const src = file
    // ⚠️ readFileSync, so a wrong path fails LOUDLY here rather than uploading an empty object.
    ? readFileSync(file.replace(/^~/, process.env.HOME ?? '~'))
    : await (async () => {
        const res = await fetch(remote!, { signal: AbortSignal.timeout(30_000) })
        if (!res.ok) { console.error(`fetch failed: ${res.status}`); process.exit(1) }
        return Buffer.from(await res.arrayBuffer())
      })()

  const sharp = (await import('sharp')).default
  const meta = await sharp(src).metadata()
  // `cover` crops rather than letterboxes: the storefront renders the box at a fixed ratio, so a
  // letterboxed image would show bars the seller never put there.
  const out = await sharp(src, { limitInputPixels: 50_000_000 })
    .rotate()
    .resize(W, H, { fit: 'cover', position: 'centre' })
    .flatten({ background: '#ffffff' })
    .webp({ quality: 86 })
    .toBuffer()
  console.log(`banner: ${meta.width}x${meta.height} ${meta.format} -> ${W}x${H} webp, ${Math.round(out.length / 1024)}KB`)
  if (meta.width && meta.width < W) console.log(`  ⚠️ source is narrower than ${W}px — it will be upscaled and may look soft`)

  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply.'); await db.$disconnect(); return }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required'); process.exit(1) }
  if (/supabase\.co$/.test(new URL(url).hostname)) { console.error(`Refusing to upload to ${url} — retired project`); process.exit(1) }

  const storage = createClient(url, key, { auth: { persistSession: false } }).storage.from(BUCKET)
  const path = `partner/banner-${seller.id}-${Date.now().toString(36)}.webp`
  const { error } = await storage.upload(path, out, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' })
  if (error) { console.error(`upload failed: ${error.message}`); process.exit(1) }
  const bannerUrl = `${url}/storage/v1/object/public/${BUCKET}/${path}`
  await db.seller.update({ where: { id: seller.id }, data: { bannerUrl } })
  console.log(`\nAPPLIED: ${bannerUrl}`)
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
