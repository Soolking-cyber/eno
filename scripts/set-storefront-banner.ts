/**
 * Set (or clear) any storefront's optional cover banner.
 *
 *   npx tsx scripts/set-storefront-banner.ts --seller VinWonders \
 *       --file ~/Downloads/VinWonders_banner/Web.png --file-mobile ~/Downloads/VinWonders_banner/Mobile.png
 *   npx tsx scripts/set-storefront-banner.ts --seller VietKite --url https://…/banner.jpg
 *   npx tsx scripts/set-storefront-banner.ts --seller GMBR --clear
 *
 * ⚠️ TWO CREATIVES, NOT ONE RESIZED. Partners compose the wide and the narrow banner separately —
 * see src/components/marketplace/banner-image.tsx. --file-mobile is optional and falls back to the
 * wide one, which is right for a shop that only has one.
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
// Sized from the creatives partners actually ship, and matching the aspect boxes the components
// reserve: wide 1280x300 (4.3:1), narrow 366x188 (1.9:1). Stored at 2x for retina.
const WEB = { w: 2560, h: 600 }
const MOBILE = { w: 732, h: 376 }

async function main() {
  const name = arg('seller'), id = arg('id'), file = arg('file'), remote = arg('url'), fileMobile = arg('file-mobile')
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
    console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}: banner cleared (both variants)`)
    if (APPLY) await db.seller.update({ where: { id: seller.id }, data: { bannerUrl: null, bannerMobileUrl: null } })
    await db.$disconnect(); return
  }

  const read = async (path?: string, url?: string): Promise<Buffer | null> => {
    if (path) return readFileSync(path.replace(/^~/, process.env.HOME ?? '~')) // a wrong path fails LOUDLY here
    if (!url) return null
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) { console.error(`fetch failed: ${res.status}`); process.exit(1) }
    return Buffer.from(await res.arrayBuffer())
  }
  const sharp = (await import('sharp')).default
  const prepare = async (buf: Buffer, box: { w: number; h: number }, label: string) => {
    const meta = await sharp(buf).metadata()
    // `cover` crops rather than letterboxes: the component renders a fixed ratio, so a letterboxed
    // image would show bars the partner never put in their artwork.
    const out = await sharp(buf, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize(box.w, box.h, { fit: 'cover', position: 'centre' })
      .flatten({ background: '#ffffff' })
      .webp({ quality: 86 })
      .toBuffer()
    const srcRatio = (meta.width ?? 1) / (meta.height ?? 1), boxRatio = box.w / box.h
    console.log(`${label}: ${meta.width}x${meta.height} ${meta.format} -> ${box.w}x${box.h} webp, ${Math.round(out.length / 1024)}KB`)
    // ⚠️ A RATIO MISMATCH IS THE ONE FAILURE THAT LOOKS FINE IN A LOG AND WRONG ON THE PAGE: cover
    // crops the difference away, and what it crops off a banner is usually the CTA.
    if (Math.abs(srcRatio - boxRatio) / boxRatio > 0.12) {
      console.log(`  ⚠️ source is ${srcRatio.toFixed(2)}:1 but the box is ${boxRatio.toFixed(2)}:1 — cover will CROP it. Check the artwork survives.`)
    }
    return out
  }

  const webSrc = await read(file, remote)
  if (!webSrc) { console.error('no wide banner source'); process.exit(1) }
  const webOut = await prepare(webSrc, WEB, 'web   ')
  const mobileSrc = await read(fileMobile)
  const mobileOut = mobileSrc ? await prepare(mobileSrc, MOBILE, 'mobile') : null
  if (!mobileOut) console.log('mobile: none given — phones will use the wide banner')

  if (!APPLY) { console.log('\nDRY RUN — re-run with --apply.'); await db.$disconnect(); return }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) { console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY required'); process.exit(1) }
  if (/supabase\.co$/.test(new URL(url).hostname)) { console.error(`Refusing to upload to ${url} — retired project`); process.exit(1) }

  const storage = createClient(url, key, { auth: { persistSession: false } }).storage.from(BUCKET)
  const put = async (buf: Buffer, kind: string): Promise<string> => {
    const path = `partner/banner-${kind}-${seller.id}-${Date.now().toString(36)}.webp`
    const { error } = await storage.upload(path, buf, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' })
    if (error) { console.error(`upload failed: ${error.message}`); process.exit(1) }
    return `${url}/storage/v1/object/public/${BUCKET}/${path}`
  }
  const bannerUrl = await put(webOut, 'web')
  // ⚠️ ONLY WRITE bannerMobileUrl WHEN A MOBILE FILE WAS ACTUALLY GIVEN. Writing `null`
  // unconditionally means re-running this with just --file to swap the wide banner silently
  // DELETES the narrow creative the shop already had, and nothing in the output would say so.
  // Use --clear to remove both on purpose.
  const bannerMobileUrl = mobileOut ? await put(mobileOut, 'mobile') : null
  await db.seller.update({
    where: { id: seller.id },
    data: { bannerUrl, ...(bannerMobileUrl ? { bannerMobileUrl } : {}) },
  })
  console.log(`\nAPPLIED web:    ${bannerUrl}`)
  console.log(`APPLIED mobile: ${bannerMobileUrl ?? '(unchanged — none supplied this run)'}`)
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
