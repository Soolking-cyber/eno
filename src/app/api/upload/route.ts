import { NextRequest, NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import sharp from 'sharp'
import { getSupabaseAdmin, LISTINGS_BUCKET } from '@/lib/supabase-admin'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'

// Safe raster types only — never SVG (scriptable). Validated by actually decoding
// with sharp below, not by trusting the client content-type.
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 12 * 1024 * 1024 // 12MB raw in (modern phone photos) — recompressed server-side
// Every upload is normalized to WebP, ≤ this longest edge, at this quality. 1600px
// covers the largest display (detail hero ~60vw → ~770px, ×2 retina ≈ 1540) with no
// visible loss, while cutting stored bytes ~5–10× vs a raw phone photo — a small,
// fast source for Next/Image's AVIF delivery. Also strips EXIF (incl. GPS).
const MAX_EDGE = 1600
const WEBP_QUALITY = 82

// Receives image files (multipart), uploads to Supabase Storage, returns public URLs.
// Kept open (the post wizard is a guest/anonymous flow), but RATE-LIMITED to stop
// the endpoint being abused as free image hosting / for storage-cost bloat:
// generous for signed-in users, tighter per-IP for anonymous uploaders.
export async function POST(req: NextRequest) {
  try {
    const profileId = await getCurrentProfileId()
    const ip = clientIp(req)
    const limit = profileId
      ? await rateLimit('upload-user', profileId, 120, '1 h') // authed seller: fail OPEN — don't block posting on a Redis blip (accountable account)
      : await rateLimit('upload-ip', ip, 30, '1 h', { strict: true }) // anon: fail CLOSED
    if (!limit.success) return NextResponse.json({ error: 'rate_limited', urls: [], failed: 0 }, { status: 429 })

    const form = await req.formData()
    const files = form.getAll('files').filter((f): f is File => f instanceof File)
    if (files.length === 0) return NextResponse.json({ urls: [], failed: 0 })

    const supabaseAdmin = getSupabaseAdmin()
    const urls: string[] = []
    let failed = 0
    for (const file of files.slice(0, 8)) {
      if (!ALLOWED.has(file.type) || file.size === 0 || file.size > MAX_BYTES) { failed++; continue }
      // Decode → auto-orient (bake EXIF rotation, then drop all metadata) → downscale
      // to fit MAX_EDGE → re-encode WebP. sharp throws on anything that isn't a real
      // decodable raster, which also rejects disguised/corrupt files.
      let out: Buffer
      try {
        out = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 50_000_000 })
          .rotate()
          .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: WEBP_QUALITY })
          .toBuffer()
      } catch { failed++; continue }
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`
      const { error } = await supabaseAdmin.storage
        .from(LISTINGS_BUCKET)
        .upload(path, out, { contentType: 'image/webp', upsert: false })
      if (error) {
        console.error('[upload]', error.message)
        failed++
        continue
      }
      const { data } = supabaseAdmin.storage.from(LISTINGS_BUCKET).getPublicUrl(path)
      urls.push(data.publicUrl)
    }
    return NextResponse.json({ urls, failed })
  } catch (e) {
    console.error('[POST /api/upload]', e)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
