import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin, LISTINGS_BUCKET } from '@/lib/supabase-admin'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'

// Safe raster types only — never SVG (scriptable). Extension + stored content-type
// come from this allowlist, never from the client.
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const MAX_BYTES = 5 * 1024 * 1024 // 5MB per file

// Receives image files (multipart), uploads to Supabase Storage, returns public URLs.
// Kept open (the post wizard is a guest/anonymous flow), but RATE-LIMITED to stop
// the endpoint being abused as free image hosting / for storage-cost bloat:
// generous for signed-in users, tighter per-IP for anonymous uploaders.
export async function POST(req: NextRequest) {
  try {
    const profileId = await getCurrentProfileId()
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon'
    const limit = profileId
      ? await rateLimit('upload-user', profileId, 120, '1 h')
      : await rateLimit('upload-ip', ip, 30, '1 h')
    if (!limit.success) return NextResponse.json({ error: 'rate_limited', urls: [], failed: 0 }, { status: 429 })

    const form = await req.formData()
    const files = form.getAll('files').filter((f): f is File => f instanceof File)
    if (files.length === 0) return NextResponse.json({ urls: [], failed: 0 })

    const supabaseAdmin = getSupabaseAdmin()
    const urls: string[] = []
    let failed = 0
    for (const file of files.slice(0, 8)) {
      const ext = ALLOWED[file.type]
      if (!ext || file.size === 0 || file.size > MAX_BYTES) { failed++; continue }
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const bytes = new Uint8Array(await file.arrayBuffer())
      const { error } = await supabaseAdmin.storage
        .from(LISTINGS_BUCKET)
        .upload(path, bytes, { contentType: file.type, upsert: false })
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
