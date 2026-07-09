import { NextRequest, NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { storeListingVideo, VIDEO_ALLOWED, VIDEO_MAX_BYTES } from '@/lib/core/media'

export const runtime = 'nodejs'
// A 50MB body needs headroom over the default; keep the function alive long enough to
// stream a phone clip to storage.
export const maxDuration = 60

// Receives a SINGLE listing video (multipart, field `file`) and stores it raw in the
// public listing-videos bucket, returning its URL. Duration (≤60s) is gated client-side
// in the wizard; here we enforce type + size. Rate-limited like /api/upload — tighter
// per-IP for anon (videos are heavier), fail-open for accountable signed-in sellers.
export async function POST(req: NextRequest) {
  try {
    const profileId = await getCurrentProfileId()
    const ip = clientIp(req)
    const limit = profileId
      ? await rateLimit('upload-video-user', profileId, 30, '1 h') // authed: fail OPEN
      : await rateLimit('upload-video-ip', ip, 8, '1 h', { strict: true }) // anon: fail CLOSED, tight
    if (!limit.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'no_file' }, { status: 400 })
    if (!VIDEO_ALLOWED.has(file.type)) return NextResponse.json({ error: 'bad_type' }, { status: 415 })
    if (file.size === 0 || file.size > VIDEO_MAX_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 })

    const url = await storeListingVideo(Buffer.from(await file.arrayBuffer()), file.type)
    if (!url) return NextResponse.json({ error: 'store_failed' }, { status: 500 })
    return NextResponse.json({ url })
  } catch (e) {
    console.error('[POST /api/upload/video]', e)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
