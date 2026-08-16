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
// ⛔ THE OPEN RUNDE OUTLINES, COPIED VERBATIM FROM public/logo-dotvn.svg — and this file had
// drifted FURTHER than the one it claims to mirror. It carried a 753-wide path that stops at the
// `o`, i.e. it stamped "eno", while src/lib/core/media.ts stamped "eno.vn" at 1353 wide, while
// public/watermark.svg set "eno.vn" as <text> in system-ui. Three consumers, three different
// wordmarks, one of them missing the domain that is the entire point of the mark.
// ⚠️ NONZERO WINDING — the that used to be on both paths below is gone. These
// are font outlines; evenodd fills the counters of `e`, `o` and `n` solid.
const WORDMARK_D = 'M870.0 30.0C1201.0 30.0 1438.0 -111.0 1533.0 -335.0C1560.0 -399.0 1513.0 -443.0 1428.0 -449.0L1270.0 -460.0C1203.0 -464.0 1167.0 -435.0 1122.0 -383.0C1066.0 -320.0 980.0 -288.0 877.0 -288.0C664.0 -288.0 529.0 -429.0 529.0 -658.0V-659.0H1455.0C1533.0 -659.0 1575.0 -700.0 1575.0 -776.0C1575.0 -1298.0 1259.0 -1556.0 853.0 -1556.0C401.0 -1556.0 108.0 -1235.0 108.0 -761.0C108.0 -274.0 397.0 30.0 870.0 30.0ZM529.0 -923.0C538.0 -1098.0 671.0 -1238.0 860.0 -1238.0C1045.0 -1238.0 1173.0 -1106.0 1174.0 -923.0Z M2279.0 -120.0V-888.0C2280.0 -1086.0 2398.0 -1202.0 2570.0 -1202.0C2741.0 -1202.0 2844.0 -1090.0 2843.0 -902.0V-120.0C2843.0 -42.0 2885.0 0.0 2963.0 0.0H3149.0C3227.0 0.0 3269.0 -42.0 3269.0 -120.0V-978.0C3269.0 -1336.0 3059.0 -1556.0 2739.0 -1556.0C2511.0 -1556.0 2346.0 -1444.0 2277.0 -1265.0H2259.0V-1416.0C2259.0 -1494.0 2217.0 -1536.0 2139.0 -1536.0H1973.0C1895.0 -1536.0 1853.0 -1494.0 1853.0 -1416.0V-120.0C1853.0 -42.0 1895.0 0.0 1973.0 0.0H2159.0C2237.0 0.0 2279.0 -42.0 2279.0 -120.0Z M4298.0 30.0C4764.0 30.0 5054.0 -289.0 5054.0 -762.0C5054.0 -1238.0 4764.0 -1556.0 4298.0 -1556.0C3832.0 -1556.0 3542.0 -1238.0 3542.0 -762.0C3542.0 -289.0 3832.0 30.0 4298.0 30.0ZM3975.0 -765.0C3975.0 -1033.0 4085.0 -1231.0 4300.0 -1231.0C4511.0 -1231.0 4621.0 -1033.0 4621.0 -765.0C4621.0 -497.0 4511.0 -300.0 4300.0 -300.0C4085.0 -300.0 3975.0 -497.0 3975.0 -765.0Z M5581.0 26.0C5709.0 26.0 5820.0 -81.0 5821.0 -214.0C5820.0 -345.0 5709.0 -452.0 5581.0 -452.0C5449.0 -452.0 5340.0 -345.0 5341.0 -214.0C5340.0 -81.0 5449.0 26.0 5581.0 26.0Z M7099.0 -97.0 7554.0 -1399.0C7583.0 -1482.0 7544.0 -1536.0 7456.0 -1536.0H7256.0C7185.0 -1536.0 7142.0 -1504.0 7122.0 -1435.0L6833.0 -437.0H6817.0L6527.0 -1435.0C6507.0 -1504.0 6464.0 -1536.0 6393.0 -1536.0H6194.0C6106.0 -1536.0 6067.0 -1482.0 6096.0 -1399.0L6551.0 -97.0C6574.0 -31.0 6618.0 0.0 6688.0 0.0H6962.0C7032.0 0.0 7076.0 -31.0 7099.0 -97.0Z M8246.0 -120.0V-888.0C8247.0 -1086.0 8365.0 -1202.0 8537.0 -1202.0C8708.0 -1202.0 8811.0 -1090.0 8810.0 -902.0V-120.0C8810.0 -42.0 8852.0 0.0 8930.0 0.0H9116.0C9194.0 0.0 9236.0 -42.0 9236.0 -120.0V-978.0C9236.0 -1336.0 9026.0 -1556.0 8706.0 -1556.0C8478.0 -1556.0 8313.0 -1444.0 8244.0 -1265.0H8226.0V-1416.0C8226.0 -1494.0 8184.0 -1536.0 8106.0 -1536.0H7940.0C7862.0 -1536.0 7820.0 -1494.0 7820.0 -1416.0V-120.0C7820.0 -42.0 7862.0 0.0 7940.0 0.0H8126.0C8204.0 0.0 8246.0 -42.0 8246.0 -120.0Z'
const MARK_W = 9132.3, MARK_H = 1588.3, MARK_X = 105.9, MARK_Y = -1556.4
/**
 * ⛔ ONE FLAT PASS — NO SHADOW COPY. This used to draw a black copy offset by 1.2% under a white
 * one, while src/lib/core/media.ts has drawn a single flat mark since 2026-07-14. Both files claim
 * to mirror each other and did not: backfilled photos would have carried a two-tone watermark and
 * newly uploaded ones a flat one, so the library would have been visibly two-tone-by-upload-date.
 * All three reviewers caught it on the typography change; the drift itself is older than that.
 *
 * ⚠️ Tightening MARK_* to the ink bbox also made the old shadow CLIP: the viewBox is now exactly
 * the glyph box, so a copy translated +off had nowhere to go and lost its right and bottom edge.
 * Dropping the shadow removes that failure rather than padding the box back out to hide it — and
 * media.ts already settled the question of which look is right (`pickInk` chooses near-black or
 * white per photo, so a flat mark stays legible without a shadow).
 *
 * ⚠️ THE INK IS STILL FIXED WHITE HERE, unlike media.ts's per-photo `pickInk`. That is a REAL
 * remaining difference and it is deliberate: this script re-stamps in bulk without re-probing each
 * photo. On a bright shot the mark will be fainter than a fresh upload's. Fix it by porting
 * pickInk before any large backfill — do not "fix" it by adding the shadow back.
 */
function watermarkSvg(w) {
  const scale = w / MARK_W
  const h = Math.max(1, Math.round(MARK_H * scale))
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g transform="scale(${scale}) translate(${-MARK_X},${-MARK_Y})"><path fill="#fff" fill-opacity="0.85" d="${WORDMARK_D}"/></g></svg>`)
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
