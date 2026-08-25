/**
 * Give the affiliate partner's storefront its own logo as the avatar.
 *
 *   npx tsx scripts/set-partner-avatar.ts                                  # DRY RUN (VinWonders)
 *   npx tsx scripts/set-partner-avatar.ts --apply
 *   npx tsx scripts/set-partner-avatar.ts --seller CellphoneS --logo <url> [--official] --apply
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

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined }
const APPLY = process.argv.includes('--apply')
// ⚠️ `officialPartner` IS OPT-IN PER RUN, NEVER IMPLIED BY HAVING A LOGO. import-accesstrade.ts
// deliberately leaves it false — "that badge is for negotiated partners like VinWonders; stamping
// it on an imported datafeed devalues the real one". The owner asked for it on CellphoneS
// specifically (2026-08-25), so it is a flag someone has to type, not a side effect of an avatar.
const OFFICIAL = process.argv.includes('--official')
const BUCKET = 'listings'
const SIZE = 512
/** The partner's own icon, as published on their site. Defaults to VinWonders, the first partner. */
const SELLER_NAME = arg('seller')
/**
 * ⛔ `--seller` REQUIRES `--logo`. The default is VinWonders' mark, kept only for the original
 * no-argument invocation; letting it apply to a NAMED seller meant
 * `set-partner-avatar.ts --seller CellphoneS --apply` would stamp VinWonders' trademark on
 * CellphoneS's storefront and hand it a partner badge. A default that is right for exactly one
 * caller must not silently serve every other one.
 */
if (SELLER_NAME && !arg('logo')) { console.error('--seller requires --logo (refusing to reuse another partner\'s mark)'); process.exit(1) }
const LOGO_URL = arg('logo') ?? 'https://static.vinwonders.com/production/VWs_icon_512.png'

async function main() {
  const partnerName: string = SELLER_NAME
    ?? JSON.parse(readFileSync(join(process.cwd(), 'data/vinwonders-destinations.json'), 'utf8')).partner?.name
  if (!partnerName) { console.error('no --seller and the catalogue has no partner.name'); process.exit(1) }

  // ⚠️ IDENTIFIED BY ITS LISTINGS, NOT BY NAME ALONE. `Seller.name` is not unique and anyone can
  // open a storefront called "VinWonders"; the storefront we mean is one our affiliate listings
  // hang off. Writing an avatar onto an impersonator would be handing them the partner's mark.
  // ⛔ AND IT MUST HAVE NO OWNER. A storefront with an ownerId belongs to a real person, and this
  // script both restyles it and can stamp a partner badge on it.
  const anchor = await db.listing.findFirst({
    where: { affiliateUrl: { not: null }, seller: { name: partnerName } },
    select: { seller: { select: { id: true, name: true, avatarUrl: true, ownerId: true, officialPartner: true } } },
  })
  const seller = anchor?.seller
  if (!seller) { console.error(`no affiliate listing hangs off a storefront named "${partnerName}" — refusing`); process.exit(1) }
  if (seller.ownerId) { console.error(`"${seller.name}" is owned by a real account — refusing`); process.exit(1) }
  /**
   * ⛔ AMBIGUITY IS A REFUSAL, NOT A COIN FLIP. `Seller.name` is not unique, and this script hands
   * out a consumer-facing "Official partner" badge and someone else's trademark. `findFirst` would
   * silently pick one of several same-named ownerless storefronts; if there is more than one, the
   * right answer is to stop and let a human say which.
   */
  const sameName = await db.seller.count({ where: { name: partnerName, ownerId: null } })
  if (sameName > 1) { console.error(`${sameName} ownerless storefronts are named "${partnerName}" — refusing to guess`); process.exit(1) }
  console.log(`partner storefront: ${seller.name} (${seller.id})`)
  console.log(`current avatar: ${seller.avatarUrl ?? '(none)'}`)
  console.log(`officialPartner: ${seller.officialPartner}${OFFICIAL && !seller.officialPartner ? ' -> true' : ''}`)

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

  /**
   * ⛔ REFUSE A LOGO THAT IS INVISIBLE ON THE BACKGROUND WE FLATTENED IT ONTO.
   * A brand usually publishes TWO marks: a colour one, and a WHITE one for dark backgrounds. Both
   * are the right file name, both decode, both upload — and flattening the white one onto white
   * produces a blank circle. That is exactly what shipped for CellphoneS: `Logo-CPS-m.png` is the
   * white mark, the stored avatar came out 254,254,254 with 3.7% non-white pixels, and the
   * storefront showed an empty ring. Everything reported success: HTTP 200, valid webp, 6,218
   * bytes, naturalWidth 512.
   * ⚠️ The check is on the OUTPUT, not the input, because that is the artefact people see. Their
   * colour asset (`logo-cps.png`) measures 81% visible against the same background.
   */
  const { data: grey } = await sharp(out).greyscale().raw().toBuffer({ resolveWithObject: true })
  let visible = 0
  for (const px of grey) if (px < 245) visible++
  const pct = (visible / grey.length) * 100
  console.log(`visible against the white flatten: ${pct.toFixed(1)}%`)
  if (pct < 8) {
    console.error(`\n⛔ REFUSING: only ${pct.toFixed(1)}% of this mark is visible on white — it is almost certainly`)
    console.error('   the light-on-dark variant. Brands publish both; pass the COLOUR one via --logo.')
    console.error('   (CellphoneS: Logo-CPS-m.png is white-on-transparent; logo-cps.png is the colour mark.)')
    process.exit(1)
  }

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
  await db.seller.update({ where: { id: seller.id }, data: { avatarUrl, ...(OFFICIAL ? { officialPartner: true } : {}) } })
  console.log(`\nAPPLIED: ${avatarUrl}`)
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
