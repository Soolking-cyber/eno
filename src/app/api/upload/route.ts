import { NextRequest, NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { storeListingImage, IMG_ALLOWED, IMG_MAX_BYTES } from '@/lib/core/media'

export const runtime = 'nodejs'

// Receives image files (multipart), normalizes + stores them via the shared media core,
// returns public URLs. Kept open (the post wizard is a guest/anonymous flow), but
// RATE-LIMITED to stop the endpoint being abused as free image hosting: generous for
// signed-in users, tighter per-IP (fail-closed) for anonymous uploaders.
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

    const urls: string[] = []
    let failed = 0
    for (const file of files.slice(0, 8)) {
      // Cheap pre-check on the client-provided type/size; the core re-decodes with sharp.
      if (!IMG_ALLOWED.has(file.type) || file.size === 0 || file.size > IMG_MAX_BYTES) { failed++; continue }
      const url = await storeListingImage(Buffer.from(await file.arrayBuffer()))
      if (url) urls.push(url)
      else failed++
    }
    return NextResponse.json({ urls, failed })
  } catch (e) {
    console.error('[POST /api/upload]', e)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
