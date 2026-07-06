// One-off: bake the eno wordmark onto EXISTING first-party listing images
// (Supabase listings bucket only — mock picsum/loremflickr URLs are external and
// getting purged). Re-uploads to the SAME path (upsert) so listing URLs don't
// change. DO NOT run twice: a second pass would stamp a second mark.
//
// Run:  cd /Users/mk1e3/eno.vn && set -a; . ./.env; set +a; node scripts/watermark-existing.mjs
import pg from 'pg'
import sharp from 'sharp'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!SUPABASE_URL || !SECRET) { console.error('missing supabase env'); process.exit(1) }

// Mirrors src/lib/core/media.ts watermark (keep in sync).
const WORDMARK_D = 'M 476 150 C 476 86 426 35 363 35 C 300 35 249 86 249 150 C 249 214 301 265 364 265 C 415 265 459 233 471 193 L 397 193 C 389 203 377 208 364 208 C 342 208 323 195 315 173 L 472 173 C 475 165 476 158 476 150 Z M 315 127 C 323 107 343 93 364 93 C 385 93 403 106 412 127 Z M 509 263 L 509 151 C 509 85 558 35 622 35 C 686 35 734 85 734 151 L 734 263 L 669 263 L 669 151 C 669 122 650 101 622 101 C 594 101 574 122 574 151 L 574 263 Z M 886 35 C 950 35 1002 87 1002 150 C 1002 213 950 265 886 265 C 823 265 771 213 771 150 C 771 87 823 35 886 35 Z M 886 101 C 913 101 935 123 935 150 C 935 177 913 199 886 199 C 859 199 837 177 837 150 C 837 123 859 101 886 101 Z'
const MARK_W = 753, MARK_H = 230, MARK_X = 249, MARK_Y = 35
function watermarkSvg(w) {
  const scale = w / MARK_W
  const h = Math.max(1, Math.round(MARK_H * scale))
  const off = Math.max(1, Math.round(w * 0.012)) / scale
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g transform="scale(${scale}) translate(${-MARK_X},${-MARK_Y})"><path fill="#000" fill-opacity="0.30" fill-rule="evenodd" transform="translate(${off},${off})" d="${WORDMARK_D}"/><path fill="#fff" fill-opacity="0.55" fill-rule="evenodd" d="${WORDMARK_D}"/></g></svg>`)
}

async function main() {
  const c = new pg.Client({ connectionString: process.env.DIRECT_URL })
  await c.connect()
  const rows = (await c.query(`select id, images from "Listing" where images like '%/storage/v1/object/public/listings/%'`)).rows
  const urls = new Set()
  for (const r of rows) { try { for (const u of JSON.parse(r.images)) if (typeof u === 'string' && u.includes('/storage/v1/object/public/listings/')) urls.add(u) } catch {} }
  console.log(`listings with first-party images: ${rows.length}, unique images: ${urls.size}`)

  let ok = 0, fail = 0
  for (const url of urls) {
    const path = url.split('/storage/v1/object/public/listings/')[1]?.split('?')[0]
    if (!path) { fail++; continue }
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`fetch ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const { data, info } = await sharp(buf, { limitInputPixels: 50_000_000 }).png().toBuffer({ resolveWithObject: true })
      const mw = Math.min(300, Math.max(72, Math.round(info.width * 0.15)))
      const mh = Math.round((mw / MARK_W) * MARK_H)
      const pad = Math.round(info.width * 0.025)
      const out = await sharp(data)
        .composite([{ input: watermarkSvg(mw), left: Math.max(0, info.width - mw - pad), top: Math.max(0, info.height - mh - pad) }])
        .webp({ quality: 82 })
        .toBuffer()
      const up = await fetch(`${SUPABASE_URL}/storage/v1/object/listings/${path}`, {
        method: 'PUT',
        headers: { apikey: SECRET, Authorization: `Bearer ${SECRET}`, 'Content-Type': 'image/webp', 'x-upsert': 'true' },
        body: out,
      })
      if (!up.ok) throw new Error(`upload ${up.status} ${(await up.text()).slice(0, 120)}`)
      ok++
      console.log(`✓ ${path} (${info.width}x${info.height})`)
    } catch (e) {
      fail++
      console.log(`✗ ${path}: ${e.message}`)
    }
  }
  console.log(`done: ${ok} watermarked, ${fail} failed`)
  await c.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
